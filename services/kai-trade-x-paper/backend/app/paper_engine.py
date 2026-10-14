from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
from threading import Lock
from uuid import uuid4


@dataclass
class PaperPosition:
    id: str
    symbol: str
    side: str
    quantity: float
    entry_price: float
    stop_loss: float
    take_profit: float
    kai_score: int
    opened_at: str


@dataclass
class PaperTrade:
    id: str
    position_id: str
    symbol: str
    side: str
    quantity: float
    entry_price: float
    exit_price: float
    gross_pnl: float
    fees: float
    slippage_cost: float
    net_pnl: float
    kai_score: int
    exit_reason: str
    opened_at: str
    closed_at: str


class PaperEngine:
    """Persistent PAPER execution engine.

    No real orders are sent. State can be written atomically to a JSON file so
    balance, open positions, idempotency keys and journal survive process/HP
    restarts. Fee and slippage are configurable simulation costs.
    """

    def __init__(
        self,
        starting_balance: float = 1000.0,
        *,
        state_file: str | None = None,
        fee_pct: float = 0.0,
        slippage_pct: float = 0.0,
    ) -> None:
        self._lock = Lock()
        self.state_file = Path(state_file).expanduser() if state_file else None
        self.fee_pct = max(0.0, float(fee_pct))
        self.slippage_pct = max(0.0, float(slippage_pct))
        self.starting_balance = float(starting_balance)
        self.balance = float(starting_balance)
        self.positions: dict[str, PaperPosition] = {}
        self.trades: list[PaperTrade] = []
        self.idempotency_keys: set[str] = set()
        if self.state_file and self.state_file.exists():
            self._load()
        elif self.state_file:
            self._persist()

    def _load(self) -> None:
        assert self.state_file is not None
        payload = json.loads(self.state_file.read_text(encoding="utf-8"))
        self.starting_balance = float(payload.get("starting_balance", self.starting_balance))
        self.balance = float(payload.get("balance", self.starting_balance))
        self.positions = {}
        for item in payload.get("positions", []):
            p = PaperPosition(
                id=str(item["id"]),
                symbol=str(item["symbol"]),
                side=str(item["side"]),
                quantity=float(item["quantity"]),
                entry_price=float(item["entry_price"]),
                stop_loss=float(item["stop_loss"]),
                take_profit=float(item["take_profit"]),
                kai_score=int(item.get("kai_score", 0)),
                opened_at=str(item["opened_at"]),
            )
            self.positions[p.id] = p
        self.trades = [
            PaperTrade(
                id=str(item["id"]),
                position_id=str(item["position_id"]),
                symbol=str(item["symbol"]),
                side=str(item["side"]),
                quantity=float(item["quantity"]),
                entry_price=float(item["entry_price"]),
                exit_price=float(item["exit_price"]),
                gross_pnl=float(item["gross_pnl"]),
                fees=float(item.get("fees", 0.0)),
                slippage_cost=float(item.get("slippage_cost", 0.0)),
                net_pnl=float(item["net_pnl"]),
                kai_score=int(item.get("kai_score", 0)),
                exit_reason=str(item.get("exit_reason", "UNKNOWN")),
                opened_at=str(item["opened_at"]),
                closed_at=str(item["closed_at"]),
            )
            for item in payload.get("trades", [])
        ]
        self.idempotency_keys = set(str(x) for x in payload.get("idempotency_keys", []))

    def _state(self) -> dict:
        return {
            "version": 1,
            "starting_balance": self.starting_balance,
            "balance": self.balance,
            "positions": [asdict(p) for p in self.positions.values()],
            "trades": [asdict(t) for t in self.trades],
            "idempotency_keys": sorted(self.idempotency_keys),
        }

    def _persist(self) -> None:
        if not self.state_file:
            return
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        temp = self.state_file.with_suffix(self.state_file.suffix + ".tmp")
        temp.write_text(json.dumps(self._state(), indent=2, sort_keys=True), encoding="utf-8")
        temp.replace(self.state_file)

    def account(self, marks: dict[str, float] | None = None) -> dict:
        marks = marks or {}
        floating = 0.0
        for p in self.positions.values():
            current = marks.get(p.symbol, p.entry_price)
            direction = 1.0 if p.side == "BUY" else -1.0
            floating += (current - p.entry_price) * p.quantity * direction
        return {
            "mode": "PAPER",
            "balance": round(self.balance, 8),
            "equity": round(self.balance + floating, 8),
            "floating_pnl": round(floating, 8),
            "realized_pnl": round(self.balance - self.starting_balance, 8),
            "today_pnl": round(self.today_pnl(), 8),
            "consecutive_losses": self.consecutive_losses(),
            "open_positions": len(self.positions),
            "completed_trades": len(self.trades),
            "fee_pct": self.fee_pct,
            "slippage_pct": self.slippage_pct,
            "persistent": self.state_file is not None,
        }

    def today_pnl(self) -> float:
        today = datetime.now(timezone.utc).date()
        total = 0.0
        for trade in self.trades:
            try:
                closed = datetime.fromisoformat(trade.closed_at)
            except ValueError:
                continue
            if closed.date() == today:
                total += trade.net_pnl
        return total

    def consecutive_losses(self) -> int:
        count = 0
        for trade in reversed(self.trades):
            if trade.net_pnl < 0:
                count += 1
            else:
                break
        return count

    def loss_lock_status(self, cooldown_hours: float) -> dict:
        streak = self.consecutive_losses()
        if streak <= 0 or not self.trades:
            return {
                "consecutive_losses": streak,
                "risk_consecutive_losses": 0,
                "cooldown_active": False,
                "unlock_at": None,
                "seconds_remaining": 0,
            }

        last_trade = self.trades[-1]
        try:
            closed_at = datetime.fromisoformat(last_trade.closed_at)
            if closed_at.tzinfo is None:
                closed_at = closed_at.replace(tzinfo=timezone.utc)
            closed_at = closed_at.astimezone(timezone.utc)
        except (TypeError, ValueError):
            # Fail closed if persisted timing metadata is malformed.
            return {
                "consecutive_losses": streak,
                "risk_consecutive_losses": streak,
                "cooldown_active": True,
                "unlock_at": None,
                "seconds_remaining": None,
            }

        cooldown_seconds = max(0.0, float(cooldown_hours) * 3600.0)
        unlock_at = closed_at.timestamp() + cooldown_seconds
        now_ts = datetime.now(timezone.utc).timestamp()
        remaining = max(0, int(round(unlock_at - now_ts)))
        active = remaining > 0

        return {
            "consecutive_losses": streak,
            "risk_consecutive_losses": streak if active else 0,
            "cooldown_active": active,
            "unlock_at": datetime.fromtimestamp(unlock_at, timezone.utc).isoformat(),
            "seconds_remaining": remaining,
        }

    def open_position(
        self,
        *,
        symbol: str,
        side: str,
        quantity: float,
        entry_price: float,
        stop_loss: float,
        take_profit: float,
        idempotency_key: str,
        kai_score: int = 0,
    ) -> dict:
        side = side.upper()
        if side not in {"BUY", "SELL"}:
            raise ValueError("INVALID_SIDE")
        if quantity <= 0 or entry_price <= 0 or stop_loss <= 0 or take_profit <= 0:
            raise ValueError("INVALID_ORDER_PARAMETERS")
        if not idempotency_key:
            raise ValueError("IDEMPOTENCY_KEY_REQUIRED")

        with self._lock:
            if idempotency_key in self.idempotency_keys:
                raise ValueError("DUPLICATE_ORDER")
            if self.positions:
                raise ValueError("MAX_POSITIONS_REACHED")
            if side == "BUY" and not (stop_loss < entry_price < take_profit):
                raise ValueError("INVALID_PROTECTION_LEVELS")
            if side == "SELL" and not (take_profit < entry_price < stop_loss):
                raise ValueError("INVALID_PROTECTION_LEVELS")

            position = PaperPosition(
                id=str(uuid4()),
                symbol=symbol.upper(),
                side=side,
                quantity=float(quantity),
                entry_price=float(entry_price),
                stop_loss=float(stop_loss),
                take_profit=float(take_profit),
                kai_score=int(kai_score),
                opened_at=datetime.now(timezone.utc).isoformat(),
            )
            self.idempotency_keys.add(idempotency_key)
            self.positions[position.id] = position
            self._persist()
            return asdict(position)

    def close_position(self, position_id: str, exit_price: float, reason: str) -> dict:
        if exit_price <= 0:
            raise ValueError("INVALID_EXIT_PRICE")
        with self._lock:
            position = self.positions.pop(position_id, None)
            if position is None:
                raise ValueError("POSITION_NOT_FOUND")
            direction = 1.0 if position.side == "BUY" else -1.0
            exit_price = float(exit_price)
            gross = (exit_price - position.entry_price) * position.quantity * direction
            entry_notional = abs(position.entry_price * position.quantity)
            exit_notional = abs(exit_price * position.quantity)
            fees = (entry_notional + exit_notional) * (self.fee_pct / 100.0)
            slippage_cost = (entry_notional + exit_notional) * (self.slippage_pct / 100.0)
            net = gross - fees - slippage_cost
            self.balance += net
            trade = PaperTrade(
                id=str(uuid4()),
                position_id=position.id,
                symbol=position.symbol,
                side=position.side,
                quantity=position.quantity,
                entry_price=position.entry_price,
                exit_price=exit_price,
                gross_pnl=gross,
                fees=fees,
                slippage_cost=slippage_cost,
                net_pnl=net,
                kai_score=position.kai_score,
                exit_reason=reason or "MANUAL",
                opened_at=position.opened_at,
                closed_at=datetime.now(timezone.utc).isoformat(),
            )
            self.trades.append(trade)
            self._persist()
            return asdict(trade)

    def journal(self) -> list[dict]:
        return [asdict(t) for t in reversed(self.trades)]

    def performance(self) -> dict:
        trades = self.trades
        wins = [t.net_pnl for t in trades if t.net_pnl > 0]
        losses = [t.net_pnl for t in trades if t.net_pnl < 0]
        gross_profit = sum(wins)
        gross_loss = abs(sum(losses))
        profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else None

        equity = self.starting_balance
        peak = equity
        max_drawdown = 0.0
        max_drawdown_pct = 0.0
        for t in trades:
            equity += t.net_pnl
            peak = max(peak, equity)
            drawdown = peak - equity
            drawdown_pct = (drawdown / peak * 100.0) if peak > 0 else 0.0
            max_drawdown = max(max_drawdown, drawdown)
            max_drawdown_pct = max(max_drawdown_pct, drawdown_pct)

        scores = [t.kai_score for t in trades if t.kai_score > 0]
        return {
            "completed_trades": len(trades),
            "wins": len(wins),
            "losses": len(losses),
            "win_rate_pct": round((len(wins) / len(trades) * 100.0) if trades else 0.0, 4),
            "net_pnl": round(sum(t.net_pnl for t in trades), 8),
            "gross_profit": round(gross_profit, 8),
            "gross_loss": round(gross_loss, 8),
            "profit_factor": round(profit_factor, 4) if profit_factor is not None else None,
            "max_drawdown": round(max_drawdown, 8),
            "max_drawdown_pct": round(max_drawdown_pct, 4),
            "average_win": round(sum(wins) / len(wins), 8) if wins else 0.0,
            "average_loss": round(sum(losses) / len(losses), 8) if losses else 0.0,
            "total_fees": round(sum(t.fees for t in trades), 8),
            "total_slippage_cost": round(sum(t.slippage_cost for t in trades), 8),
            "average_kai_score": round(sum(scores) / len(scores), 2) if scores else 0.0,
        }
