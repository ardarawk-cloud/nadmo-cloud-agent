from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class MarketRegime(StrEnum):
    TRENDING = "TRENDING"
    RANGING = "RANGING"
    BREAKOUT = "BREAKOUT"
    HIGH_VOLATILITY = "HIGH_VOLATILITY"
    LOW_VOLATILITY = "LOW_VOLATILITY"
    UNSAFE = "UNSAFE"


@dataclass(frozen=True)
class KaiFactors:
    trend_alignment: float
    market_structure: float
    momentum: float
    volatility: float
    entry_quality: float
    reward_risk: float
    spread_acceptable: bool = True
    data_fresh: bool = True
    market_safe: bool = True


@dataclass(frozen=True)
class KaiDecision:
    score: int
    regime: MarketRegime
    decision: str
    reasons: tuple[str, ...]


class KaiCore:
    """Deterministic multi-factor scoring engine.

    Inputs are normalized 0..1 factor strengths calculated by strategy modules.
    The engine never overrides RiskEngine and never predicts future prices.
    """

    WEIGHTS = {
        "trend_alignment": 20,
        "market_structure": 20,
        "momentum": 15,
        "volatility": 15,
        "entry_quality": 15,
        "reward_risk": 15,
    }

    def __init__(self, min_score: int = 75) -> None:
        if not 0 <= min_score <= 100:
            raise ValueError("INVALID_MIN_SCORE")
        self.min_score = min_score

    @staticmethod
    def _bounded(value: float) -> float:
        return max(0.0, min(1.0, float(value)))

    def score(self, factors: KaiFactors) -> int:
        total = 0.0
        for name, weight in self.WEIGHTS.items():
            total += self._bounded(getattr(factors, name)) * weight
        return int(round(total))

    @staticmethod
    def classify_regime(*, trend_strength: float, volatility_percentile: float, breakout_strength: float, range_strength: float, market_safe: bool = True) -> MarketRegime:
        if not market_safe:
            return MarketRegime.UNSAFE
        vol = max(0.0, min(1.0, volatility_percentile))
        trend = max(0.0, min(1.0, trend_strength))
        breakout = max(0.0, min(1.0, breakout_strength))
        ranging = max(0.0, min(1.0, range_strength))
        if vol >= 0.90:
            return MarketRegime.HIGH_VOLATILITY
        if vol <= 0.10:
            return MarketRegime.LOW_VOLATILITY
        if breakout >= 0.70:
            return MarketRegime.BREAKOUT
        if trend >= 0.65:
            return MarketRegime.TRENDING
        if ranging >= 0.60:
            return MarketRegime.RANGING
        return MarketRegime.RANGING

    def evaluate(
        self,
        factors: KaiFactors,
        *,
        trend_strength: float,
        volatility_percentile: float,
        breakout_strength: float,
        range_strength: float,
    ) -> KaiDecision:
        reasons: list[str] = []
        regime = self.classify_regime(
            trend_strength=trend_strength,
            volatility_percentile=volatility_percentile,
            breakout_strength=breakout_strength,
            range_strength=range_strength,
            market_safe=factors.market_safe,
        )
        value = self.score(factors)

        if not factors.data_fresh:
            reasons.append("STALE_MARKET_DATA")
        if not factors.spread_acceptable:
            reasons.append("HIGH_SPREAD")
        if not factors.market_safe or regime is MarketRegime.UNSAFE:
            reasons.append("MARKET_UNSAFE")
        if value < self.min_score:
            reasons.append("KAI_SCORE_BELOW_THRESHOLD")

        decision = "NO_TRADE" if reasons else "SIGNAL_ELIGIBLE"
        return KaiDecision(score=value, regime=regime, decision=decision, reasons=tuple(reasons))
