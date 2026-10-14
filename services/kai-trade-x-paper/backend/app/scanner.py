from __future__ import annotations

from dataclasses import dataclass
from math import sqrt
import time

from .kai_core import KaiCore, KaiFactors
from .market_data import MarketQuote, OhlcCandle


@dataclass(frozen=True)
class ScanResult:
    symbol: str
    timeframe: str
    price: float
    kai_score: int
    market_regime: str
    decision: str
    reasons: tuple[str, ...]
    metrics: dict[str, float | str | bool]


def _ema(values: list[float], period: int) -> float:
    alpha = 2.0 / (period + 1.0)
    out = values[0]
    for value in values[1:]:
        out = alpha * value + (1.0 - alpha) * out
    return out


def _rsi(values: list[float], period: int = 14) -> float:
    diffs = [b - a for a, b in zip(values[-period-1:-1], values[-period:])]
    gains = sum(max(x, 0.0) for x in diffs) / period
    losses = sum(max(-x, 0.0) for x in diffs) / period
    if losses == 0:
        return 100.0 if gains > 0 else 50.0
    rs = gains / losses
    return 100.0 - (100.0 / (1.0 + rs))


def _atr(candles: list[OhlcCandle], period: int = 14) -> float:
    sample = candles[-period:]
    trs: list[float] = []
    prev_close = candles[-period-1].close
    for c in sample:
        trs.append(max(c.high-c.low, abs(c.high-prev_close), abs(c.low-prev_close)))
        prev_close = c.close
    return sum(trs) / len(trs)


def scan_market(candles: list[OhlcCandle], quote: MarketQuote, kai_core: KaiCore, timeframe: str) -> ScanResult:
    closes = [c.close for c in candles]
    highs = [c.high for c in candles]
    lows = [c.low for c in candles]
    volumes = [c.volume for c in candles]
    price = quote.price

    ema20 = _ema(closes[-40:], 20)
    ema50 = _ema(closes[-80:], 50)
    rsi14 = _rsi(closes, 14)
    atr14 = _atr(candles, 14)
    atr_pct = atr14 / price if price > 0 else 1.0
    roc = (closes[-1] / closes[-6] - 1.0) if closes[-6] else 0.0

    recent20 = closes[-20:]
    mean20 = sum(recent20) / len(recent20)
    stdev20 = sqrt(sum((x-mean20)**2 for x in recent20) / len(recent20))
    bb_width = (4.0 * stdev20 / mean20) if mean20 > 0 else 1.0

    trend_alignment = 1.0 if price > ema20 > ema50 or price < ema20 < ema50 else 0.45
    recent_high = max(highs[-20:-1])
    recent_low = min(lows[-20:-1])
    breakout_up = price > recent_high
    breakout_down = price < recent_low
    breakout_strength = 0.85 if (breakout_up or breakout_down) else 0.20
    range_span = max(recent_high - recent_low, 1e-9)
    range_strength = max(0.0, min(1.0, 1.0 - abs(price-((recent_high+recent_low)/2.0))/(range_span/2.0)))

    hh = highs[-1] >= max(highs[-5:-1])
    hl = lows[-1] >= min(lows[-5:-1])
    lh = highs[-1] <= max(highs[-5:-1])
    ll = lows[-1] <= min(lows[-5:-1])
    structure = 0.9 if (hh and hl) or (lh and ll) else 0.5

    momentum = max(0.0, min(1.0, 0.5 + roc * 8.0))
    if rsi14 > 70 or rsi14 < 30:
        momentum *= 0.75
    volatility = max(0.0, min(1.0, 1.0 - abs(atr_pct-0.012)/0.03))
    entry_quality = 0.85 if (breakout_up or breakout_down) else (0.65 if range_strength >= 0.65 else 0.45)
    reward_risk = 0.80 if entry_quality >= 0.65 else 0.45

    spread_pct = None
    spread_ok = False
    if quote.buy and quote.sell and quote.buy > 0 and quote.sell > 0:
        midpoint = (quote.buy + quote.sell) / 2.0
        spread_pct = abs(quote.sell-quote.buy) / midpoint * 100.0
        spread_ok = spread_pct <= 0.50

    step_seconds = {"1":60,"15":900,"30":1800,"60":3600,"240":14400,"1D":86400,"3D":259200,"1W":604800}[timeframe]
    data_age_seconds = max(0, int(time.time()) - int(candles[-1].timestamp))
    data_fresh = data_age_seconds <= step_seconds * 3
    market_safe = atr_pct <= 0.08 and bb_width <= 0.30
    vol_percentile = max(0.0, min(1.0, atr_pct / 0.05))
    trend_strength = max(0.0, min(1.0, abs(ema20-ema50)/price * 30.0))

    decision = kai_core.evaluate(
        KaiFactors(trend_alignment, structure, momentum, volatility, entry_quality, reward_risk, spread_ok, data_fresh, market_safe),
        trend_strength=trend_strength,
        volatility_percentile=vol_percentile,
        breakout_strength=breakout_strength,
        range_strength=range_strength,
    )

    metrics = {
        "ema20": round(ema20, 8), "ema50": round(ema50, 8), "rsi14": round(rsi14, 2),
        "atr14": round(atr14, 8), "atr_pct": round(atr_pct*100, 4), "roc_5": round(roc*100, 4),
        "bollinger_width_pct": round(bb_width*100, 4), "spread_pct": round(spread_pct, 4) if spread_pct is not None else -1.0,
        "breakout": "UP" if breakout_up else ("DOWN" if breakout_down else "NONE"),
        "data_fresh": data_fresh, "data_age_seconds": float(data_age_seconds), "market_safe": market_safe, "source": quote.source,
    }
    return ScanResult(quote.symbol, timeframe, price, decision.score, decision.regime.value, decision.decision, decision.reasons, metrics)
