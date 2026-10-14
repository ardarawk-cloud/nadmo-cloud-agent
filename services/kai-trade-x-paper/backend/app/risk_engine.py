from dataclasses import dataclass
from enum import StrEnum


class RiskDecision(StrEnum):
    ALLOW = "ALLOW"
    DO_NOT_TRADE = "DO_NOT_TRADE"
    RISK_LOCK = "RISK_LOCK"


@dataclass(slots=True)
class RiskContext:
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


@dataclass(slots=True)
class RiskResult:
    decision: RiskDecision
    reason: str
    approved_risk_pct: float = 0.0


class RiskEngine:
    """Highest-authority pre-trade gate. Fail closed on uncertainty."""

    def __init__(
        self,
        max_risk_per_trade_pct: float = 1.0,
        max_daily_loss_pct: float = 1.5,
        max_consecutive_losses: int = 3,
        max_positions: int = 1,
        min_kai_score: int = 75,
        min_reward_risk: float = 1.5,
    ) -> None:
        self.max_risk_per_trade_pct = max_risk_per_trade_pct
        self.max_daily_loss_pct = max_daily_loss_pct
        self.max_consecutive_losses = max_consecutive_losses
        self.max_positions = max_positions
        self.min_kai_score = min_kai_score
        self.min_reward_risk = min_reward_risk

    def evaluate(self, ctx: RiskContext) -> RiskResult:
        if ctx.equity <= 0:
            return RiskResult(RiskDecision.DO_NOT_TRADE, "INVALID_EQUITY")

        if not ctx.market_data_fresh:
            return RiskResult(RiskDecision.DO_NOT_TRADE, "STALE_MARKET_DATA")
        if not ctx.broker_state_known:
            return RiskResult(RiskDecision.DO_NOT_TRADE, "UNKNOWN_BROKER_STATE")
        if not ctx.market_safe:
            return RiskResult(RiskDecision.DO_NOT_TRADE, "MARKET_UNSAFE")
        if not ctx.spread_acceptable:
            return RiskResult(RiskDecision.DO_NOT_TRADE, "ENTRY_REJECTED_HIGH_SPREAD")
        if not ctx.has_stop_loss:
            return RiskResult(RiskDecision.DO_NOT_TRADE, "STOP_LOSS_REQUIRED")

        daily_loss_limit = ctx.equity * (self.max_daily_loss_pct / 100.0)
        if ctx.daily_pnl <= -daily_loss_limit:
            return RiskResult(RiskDecision.RISK_LOCK, "MAX_DAILY_LOSS_REACHED")
        if ctx.consecutive_losses >= self.max_consecutive_losses:
            return RiskResult(RiskDecision.RISK_LOCK, "MAX_CONSECUTIVE_LOSSES_REACHED")
        if ctx.open_positions >= self.max_positions:
            return RiskResult(RiskDecision.DO_NOT_TRADE, "MAX_POSITIONS_REACHED")
        if ctx.kai_score < self.min_kai_score:
            return RiskResult(RiskDecision.DO_NOT_TRADE, "KAI_SCORE_BELOW_THRESHOLD")
        if ctx.reward_risk < self.min_reward_risk:
            return RiskResult(RiskDecision.DO_NOT_TRADE, "REWARD_RISK_BELOW_THRESHOLD")
        if ctx.requested_risk_pct <= 0 or ctx.requested_risk_pct > self.max_risk_per_trade_pct:
            return RiskResult(RiskDecision.DO_NOT_TRADE, "RISK_PERCENT_OUT_OF_BOUNDS")

        return RiskResult(
            RiskDecision.ALLOW,
            "RISK_CHECK_PASSED",
            approved_risk_pct=ctx.requested_risk_pct,
        )
