from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import time

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .config import TradingMode, settings
from .kai_core import KaiCore, KaiFactors
from .market_data import IndodaxPublicMarketData, MarketDataError
from .paper_engine import PaperEngine
from .risk_engine import RiskContext, RiskDecision, RiskEngine
from .scanner import scan_market


app = FastAPI(title="KAI TRADE X API", version="0.8.0")
risk_engine = RiskEngine(
    max_risk_per_trade_pct=settings.max_risk_per_trade_pct,
    max_daily_loss_pct=settings.max_daily_loss_pct,
    max_consecutive_losses=settings.max_consecutive_losses,
    max_positions=settings.max_simultaneous_positions,
    min_kai_score=settings.min_kai_score,
    min_reward_risk=settings.min_reward_risk,
)
kai_core = KaiCore(min_score=settings.min_kai_score)
market_data = IndodaxPublicMarketData()
paper_engine = PaperEngine(
    starting_balance=settings.paper_starting_balance,
    state_file=settings.paper_state_file,
    fee_pct=settings.paper_fee_pct,
    slippage_pct=settings.paper_slippage_pct,
)


class RiskCheckRequest(BaseModel):
    equity: float
    requested_risk_pct: float
    daily_pnl: float
    consecutive_losses: int
    open_positions: int
    kai_score: int
    reward_risk: float
    has_stop_loss: bool
    market_data_fresh: bool
    broker_state_known: bool
    spread_acceptable: bool
    market_safe: bool


class KaiScoreRequest(BaseModel):
    trend_alignment: float = Field(ge=0, le=1)
    market_structure: float = Field(ge=0, le=1)
    momentum: float = Field(ge=0, le=1)
    volatility: float = Field(ge=0, le=1)
    entry_quality: float = Field(ge=0, le=1)
    reward_risk: float = Field(ge=0, le=1)
    trend_strength: float = Field(ge=0, le=1)
    volatility_percentile: float = Field(ge=0, le=1)
    breakout_strength: float = Field(ge=0, le=1)
    range_strength: float = Field(ge=0, le=1)
    spread_acceptable: bool = True
    data_fresh: bool = True
    market_safe: bool = True


class PaperOpenRequest(BaseModel):
    symbol: str = Field(min_length=2, max_length=20)
    side: str
    quantity: float = Field(gt=0)
    stop_loss: float = Field(gt=0)
    take_profit: float = Field(gt=0)
    kai_score: int = Field(ge=0, le=100)
    market_safe: bool = True
    idempotency_key: str = Field(min_length=8, max_length=128)


class PaperCloseRequest(BaseModel):
    exit_price: float = Field(gt=0)
    reason: str = Field(default="MANUAL", max_length=64)


paper_auto_state: dict = {
    "enabled": bool(settings.paper_auto_enabled),
    "running": False,
    "last_cycle_at": None,
    "last_action": "NOT_STARTED",
    "last_error": None,
    "last_scans": {},
}
paper_auto_task: asyncio.Task | None = None


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _paper_cost_rate() -> float:
    """Combined one-side fee + slippage assumption as a decimal rate."""
    return (settings.paper_fee_pct + settings.paper_slippage_pct) / 100.0


def _net_risk_reward_per_unit(
    *, entry_price: float, stop_loss: float, take_profit: float, side: str
) -> tuple[float, float]:
    side = side.upper()
    cost_rate = _paper_cost_rate()
    if side == "BUY":
        if not (stop_loss < entry_price < take_profit):
            raise ValueError("INVALID_PROTECTION_LEVELS")
        risk_move = entry_price - stop_loss
        reward_move = take_profit - entry_price
    elif side == "SELL":
        if not (take_profit < entry_price < stop_loss):
            raise ValueError("INVALID_PROTECTION_LEVELS")
        risk_move = stop_loss - entry_price
        reward_move = entry_price - take_profit
    else:
        raise ValueError("INVALID_SIDE")

    # PaperEngine charges fee+slippage on entry and exit notional. Include the
    # same cost model before RiskEngine approval so net risk cannot bypass caps.
    risk_cost = (entry_price + stop_loss) * cost_rate
    reward_cost = (entry_price + take_profit) * cost_rate
    risk_per_unit = risk_move + risk_cost
    reward_per_unit = reward_move - reward_cost
    return risk_per_unit, reward_per_unit


async def _open_paper_internal(body: PaperOpenRequest, *, market_data_fresh: bool = True) -> dict:
    if settings.trading_mode != TradingMode.PAPER:
        raise RuntimeError("PAPER_MODE_DISABLED")

    quote = await market_data.ticker_price(body.symbol)
    entry_price = quote.price
    risk_per_unit, reward_per_unit = _net_risk_reward_per_unit(
        entry_price=entry_price,
        stop_loss=body.stop_loss,
        take_profit=body.take_profit,
        side=body.side,
    )
    if risk_per_unit <= 0:
        raise ValueError("NO_TRADE_INVALID_STOP_DISTANCE")

    account = paper_engine.account()
    equity = float(account["equity"])
    loss_lock = paper_engine.loss_lock_status(settings.paper_loss_lock_cooldown_hours)
    requested_risk_pct = ((risk_per_unit * body.quantity) / equity) * 100.0
    reward_risk = max(0.0, reward_per_unit) / risk_per_unit

    spread_acceptable = False
    spread_pct = None
    if quote.buy is not None and quote.sell is not None and quote.buy > 0 and quote.sell > 0:
        midpoint = (quote.buy + quote.sell) / 2.0
        if midpoint > 0:
            spread_pct = abs(quote.sell - quote.buy) / midpoint * 100.0
            spread_acceptable = spread_pct <= settings.max_spread_pct

    risk = risk_engine.evaluate(
        RiskContext(
            equity=equity,
            requested_risk_pct=requested_risk_pct,
            daily_pnl=paper_engine.today_pnl(),
            consecutive_losses=int(loss_lock["risk_consecutive_losses"]),
            open_positions=len(paper_engine.positions),
            kai_score=body.kai_score,
            reward_risk=reward_risk,
            has_stop_loss=True,
            market_data_fresh=market_data_fresh,
            broker_state_known=True,
            spread_acceptable=spread_acceptable,
            market_safe=body.market_safe,
        )
    )
    if risk.decision is not RiskDecision.ALLOW:
        raise ValueError(f"{risk.decision.value}:{risk.reason}")

    position = paper_engine.open_position(
        symbol=body.symbol,
        side=body.side,
        quantity=body.quantity,
        entry_price=entry_price,
        stop_loss=body.stop_loss,
        take_profit=body.take_profit,
        idempotency_key=body.idempotency_key,
        kai_score=body.kai_score,
    )
    return {
        "status": "SIMULATED_EXECUTION",
        "position": position,
        "risk": {
            "decision": risk.decision.value,
            "approved_risk_pct": risk.approved_risk_pct,
            "net_reward_risk": reward_risk,
            "spread_pct": spread_pct,
            "fee_pct": settings.paper_fee_pct,
            "slippage_pct": settings.paper_slippage_pct,
        },
        "market_source": quote.source,
    }


async def _monitor_paper_position() -> bool:
    for position in list(paper_engine.positions.values()):
        try:
            quote = await market_data.ticker_price(position.symbol)
        except MarketDataError as exc:
            paper_auto_state["last_error"] = f"MONITOR:{position.symbol}:{exc}"
            return False

        reason = None
        if position.side == "BUY":
            if quote.price <= position.stop_loss:
                reason = "STOP_LOSS"
            elif quote.price >= position.take_profit:
                reason = "TAKE_PROFIT"
        else:
            if quote.price >= position.stop_loss:
                reason = "STOP_LOSS"
            elif quote.price <= position.take_profit:
                reason = "TAKE_PROFIT"

        if reason:
            trade = paper_engine.close_position(position.id, quote.price, reason)
            paper_auto_state["last_action"] = f"AUTO_CLOSE:{position.symbol}:{reason}:{trade['net_pnl']:.8f}"
            paper_auto_state["last_error"] = None
            return True
    return False


def _timeframe_seconds(timeframe: str) -> int:
    return {
        "1": 60,
        "15": 900,
        "30": 1800,
        "60": 3600,
        "240": 14400,
        "1D": 86400,
        "3D": 259200,
        "1W": 604800,
    }.get(timeframe, 900)


def _auto_levels_and_quantity(*, side: str, price: float, atr: float, equity: float) -> tuple[float, float, float]:
    stop_distance = max(atr * settings.paper_auto_atr_stop_mult, price * 0.001)
    side = side.upper()
    if side == "BUY":
        stop_loss = price - stop_distance
    elif side == "SELL":
        stop_loss = price + stop_distance
    else:
        raise ValueError("INVALID_SIDE")
    if stop_loss <= 0:
        raise ValueError("INVALID_PROTECTION_LEVELS")

    cost_rate = _paper_cost_rate()
    risk_per_unit = stop_distance + ((price + stop_loss) * cost_rate)
    risk_budget = equity * (settings.default_risk_per_trade_pct / 100.0)
    quantity = risk_budget / risk_per_unit
    if quantity <= 0:
        raise ValueError("INVALID_QUANTITY")

    target_rr = max(settings.min_reward_risk, 1.5)
    required_net_reward = target_rr * risk_per_unit
    if side == "BUY":
        denominator = 1.0 - cost_rate
        if denominator <= 0:
            raise ValueError("INVALID_COST_ASSUMPTION")
        target_distance = (required_net_reward + (2.0 * price * cost_rate)) / denominator
        take_profit = price + target_distance
    else:
        denominator = 1.0 + cost_rate
        target_distance = (required_net_reward + (2.0 * price * cost_rate)) / denominator
        take_profit = price - target_distance
        if take_profit <= 0:
            raise ValueError("INVALID_PROTECTION_LEVELS")

    return stop_loss, take_profit, quantity


async def _paper_auto_cycle() -> None:
    paper_auto_state["last_cycle_at"] = _utc_now()
    paper_auto_state["last_error"] = None

    closed = await _monitor_paper_position()
    if closed:
        return
    if paper_engine.positions:
        paper_auto_state["last_action"] = "HOLD_OPEN_POSITION"
        return

    timeframe = settings.paper_auto_timeframe
    for symbol in settings.paper_symbol_list():
        try:
            quote = await market_data.ticker_price(symbol)
            candles = await market_data.ohlc_history(symbol, timeframe=timeframe, limit=120)
            result = scan_market(candles, quote, kai_core, timeframe)
        except MarketDataError as exc:
            paper_auto_state["last_scans"][symbol] = {"error": str(exc), "at": _utc_now()}
            paper_auto_state["last_error"] = f"SCAN:{symbol}:{exc}"
            continue

        paper_auto_state["last_scans"][symbol] = {
            "at": _utc_now(),
            "price": result.price,
            "kai_score": result.kai_score,
            "decision": result.decision,
            "market_regime": result.market_regime,
            "breakout": result.metrics.get("breakout"),
            "market_safe": result.metrics.get("market_safe"),
            "data_fresh": result.metrics.get("data_fresh"),
            "data_age_seconds": result.metrics.get("data_age_seconds"),
        }

        if result.decision != "SIGNAL_ELIGIBLE":
            continue
        breakout = str(result.metrics.get("breakout", "NONE"))
        if breakout not in {"UP", "DOWN"}:
            continue

        atr = float(result.metrics.get("atr14", 0.0))
        if atr <= 0 or result.price <= 0:
            continue

        side = "BUY" if breakout == "UP" else "SELL"
        account = paper_engine.account()
        equity = float(account["equity"])
        try:
            stop_loss, take_profit, quantity = _auto_levels_and_quantity(
                side=side,
                price=result.price,
                atr=atr,
                equity=equity,
            )
        except ValueError as exc:
            paper_auto_state["last_error"] = f"SIZING:{symbol}:{exc}"
            continue

        bucket = int(time.time()) // _timeframe_seconds(timeframe)
        key = f"auto-{symbol}-{timeframe}-{bucket}"
        request = PaperOpenRequest(
            symbol=symbol,
            side=side,
            quantity=quantity,
            stop_loss=stop_loss,
            take_profit=take_profit,
            kai_score=result.kai_score,
            market_safe=bool(result.metrics.get("market_safe", False)),
            idempotency_key=key,
        )
        try:
            opened = await _open_paper_internal(
                request,
                market_data_fresh=bool(result.metrics.get("data_fresh", False)),
            )
        except (MarketDataError, RuntimeError, ValueError) as exc:
            paper_auto_state["last_error"] = f"ENTRY:{symbol}:{exc}"
            continue

        position = opened["position"]
        paper_auto_state["last_action"] = f"AUTO_OPEN:{position['symbol']}:{position['side']}:KAI_{position['kai_score']}"
        paper_auto_state["last_error"] = None
        return

    paper_auto_state["last_action"] = "NO_ELIGIBLE_SIGNAL"


async def _paper_auto_loop() -> None:
    paper_auto_state["running"] = True
    paper_auto_state["last_action"] = "RUNNER_STARTED"
    try:
        while True:
            try:
                await _paper_auto_cycle()
            except Exception as exc:  # runner must survive a failed cycle
                paper_auto_state["last_error"] = f"CYCLE:{type(exc).__name__}:{exc}"
                paper_auto_state["last_action"] = "CYCLE_FAILED"
            await asyncio.sleep(settings.paper_auto_poll_seconds)
    finally:
        paper_auto_state["running"] = False


@app.on_event("startup")
async def start_paper_auto_runner() -> None:
    global paper_auto_task
    if settings.paper_auto_enabled and settings.trading_mode == TradingMode.PAPER:
        paper_auto_task = asyncio.create_task(_paper_auto_loop(), name="kai-paper-auto-runner")
    else:
        paper_auto_state["last_action"] = "RUNNER_DISABLED"


@app.on_event("shutdown")
async def stop_paper_auto_runner() -> None:
    global paper_auto_task
    if paper_auto_task:
        paper_auto_task.cancel()
        try:
            await paper_auto_task
        except asyncio.CancelledError:
            pass
        paper_auto_task = None


@app.get("/health")
async def health() -> dict:
    return {
        "service": settings.app_name,
        "status": "SYSTEM_ONLINE",
        "version": "0.8.0",
        "trading_mode": settings.trading_mode,
        "live_execution_allowed": settings.live_execution_allowed(),
        "broker": "INDODAX_LIVE_NOT_CONNECTED",
        "paper_engine": "ACTIVE",
        "paper_auto": "ACTIVE" if paper_auto_state["running"] else "INACTIVE",
        "paper_persistence": "ACTIVE",
        "market_data": "INDODAX_PUBLIC_READY",
        "risk_engine": "ACTIVE",
        "kai_core": "ACTIVE",
        "scanner": "ACTIVE",
    }


@app.get("/system/safety")
async def system_safety() -> dict:
    return {
        "fail_closed": True,
        "live_trading_enabled": settings.live_trading_enabled,
        "broker_verified": settings.broker_verified,
        "broker_safety_tests_passed": settings.broker_safety_tests_passed,
        "live_execution_allowed": settings.live_execution_allowed(),
        "withdrawal_permission_required": False,
        "paper_mode": settings.trading_mode == TradingMode.PAPER,
        "paper_auto_enabled": settings.paper_auto_enabled,
        "exchange_target": "INDODAX",
    }


@app.get("/market/ticker/{symbol}")
async def market_ticker(symbol: str) -> dict:
    try:
        quote = await market_data.ticker_price(symbol)
    except MarketDataError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "symbol": quote.symbol,
        "pair_id": quote.pair_id,
        "price": quote.price,
        "buy": quote.buy,
        "sell": quote.sell,
        "source": quote.source,
        "timestamp": quote.timestamp,
        "execution": "PAPER_ONLY",
    }


@app.get("/market/scan/{symbol}")
async def market_scan(symbol: str, timeframe: str = "15") -> dict:
    try:
        quote = await market_data.ticker_price(symbol)
        candles = await market_data.ohlc_history(symbol, timeframe=timeframe, limit=120)
        result = scan_market(candles, quote, kai_core, timeframe)
    except MarketDataError as exc:
        raise HTTPException(status_code=503, detail=f"NO_TRADE:{exc}") from exc
    return {
        "symbol": result.symbol,
        "timeframe": result.timeframe,
        "price": result.price,
        "kai_score": result.kai_score,
        "market_regime": result.market_regime,
        "decision": result.decision,
        "reasons": list(result.reasons),
        "metrics": result.metrics,
        "execution": "ANALYSIS_ONLY",
        "risk_engine_required": True,
    }


@app.post("/analysis/kai-score")
async def analysis_kai_score(body: KaiScoreRequest) -> dict:
    factors = KaiFactors(
        trend_alignment=body.trend_alignment,
        market_structure=body.market_structure,
        momentum=body.momentum,
        volatility=body.volatility,
        entry_quality=body.entry_quality,
        reward_risk=body.reward_risk,
        spread_acceptable=body.spread_acceptable,
        data_fresh=body.data_fresh,
        market_safe=body.market_safe,
    )
    result = kai_core.evaluate(
        factors,
        trend_strength=body.trend_strength,
        volatility_percentile=body.volatility_percentile,
        breakout_strength=body.breakout_strength,
        range_strength=body.range_strength,
    )
    return {
        "kai_score": result.score,
        "market_regime": result.regime.value,
        "decision": result.decision,
        "reasons": list(result.reasons),
        "note": "SIGNAL_ELIGIBLE is not an execution approval; Risk Engine still has final authority.",
    }


@app.get("/paper/account")
async def paper_account() -> dict:
    return paper_engine.account()


@app.get("/paper/positions")
async def paper_positions() -> dict:
    return {"positions": [vars(p) for p in paper_engine.positions.values()]}


@app.get("/paper/journal")
async def paper_journal() -> dict:
    return {"trades": paper_engine.journal()}


@app.get("/paper/performance")
async def paper_performance() -> dict:
    return paper_engine.performance()


@app.get("/paper/auto")
async def paper_auto_status() -> dict:
    return {
        **paper_auto_state,
        "symbols": settings.paper_symbol_list(),
        "timeframe": settings.paper_auto_timeframe,
        "poll_seconds": settings.paper_auto_poll_seconds,
        "risk_per_trade_pct": settings.default_risk_per_trade_pct,
        "min_kai_score": settings.min_kai_score,
        "min_reward_risk": settings.min_reward_risk,
        "fee_pct": settings.paper_fee_pct,
        "slippage_pct": settings.paper_slippage_pct,
        "loss_lock_cooldown_hours": settings.paper_loss_lock_cooldown_hours,
        "loss_lock": paper_engine.loss_lock_status(settings.paper_loss_lock_cooldown_hours),
        "live_execution_allowed": settings.live_execution_allowed(),
    }


@app.post("/paper/positions")
async def paper_open(body: PaperOpenRequest) -> dict:
    try:
        return await _open_paper_internal(body)
    except RuntimeError as exc:
        raise HTTPException(status_code=423, detail=str(exc)) from exc
    except MarketDataError as exc:
        raise HTTPException(status_code=503, detail="NO_TRADE_MARKET_DATA_UNAVAILABLE") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/paper/positions/{position_id}/close")
async def paper_close(position_id: str, body: PaperCloseRequest) -> dict:
    try:
        trade = paper_engine.close_position(position_id, body.exit_price, body.reason)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "SIMULATED_EXECUTION", "trade": trade}


@app.post("/risk/check")
async def risk_check(body: RiskCheckRequest) -> dict:
    result = risk_engine.evaluate(RiskContext(**body.model_dump()))
    return {"decision": result.decision, "reason": result.reason, "approved_risk_pct": result.approved_risk_pct}
