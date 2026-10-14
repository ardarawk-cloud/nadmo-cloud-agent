from enum import StrEnum
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class TradingMode(StrEnum):
    PAPER = "PAPER"
    LIVE = "LIVE"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "KAI TRADE X"
    environment: str = "development"
    trading_mode: TradingMode = TradingMode.PAPER

    database_url: str = "postgresql+asyncpg://kai:kai@postgres:5432/kaitradex"
    redis_url: str = "redis://redis:6379/0"

    jwt_secret: str = Field(default="CHANGE_ME_BEFORE_DEPLOYMENT", min_length=16)
    live_trading_enabled: bool = False
    broker_verified: bool = False
    broker_safety_tests_passed: bool = False

    default_risk_per_trade_pct: float = 0.50
    max_risk_per_trade_pct: float = 1.00
    max_daily_loss_pct: float = 1.50
    max_consecutive_losses: int = 3
    max_simultaneous_positions: int = 1
    min_kai_score: int = 75
    min_reward_risk: float = 1.50
    max_spread_pct: float = 0.50

    # PAPER v0.7: persistent autonomous validation only. These settings never
    # enable LIVE execution and can be overridden from .env on the backend HP.
    paper_starting_balance: float = Field(default=1000.0, gt=0)
    paper_state_file: str = "data/paper_state.json"
    paper_fee_pct: float = Field(default=0.30, ge=0, le=5)
    paper_slippage_pct: float = Field(default=0.05, ge=0, le=5)
    paper_auto_enabled: bool = True
    paper_auto_symbols: str = "BTCIDR,ETHIDR,SOLIDR"
    paper_auto_timeframe: str = "15"
    paper_auto_poll_seconds: int = Field(default=60, ge=15, le=3600)
    paper_auto_atr_stop_mult: float = Field(default=1.50, gt=0, le=10)
    paper_loss_lock_cooldown_hours: float = Field(default=24.0, ge=1.0, le=168.0)

    def paper_symbol_list(self) -> list[str]:
        return [x.strip().upper() for x in self.paper_auto_symbols.split(",") if x.strip()]

    def live_execution_allowed(self) -> bool:
        return bool(
            self.trading_mode == TradingMode.LIVE
            and self.live_trading_enabled
            and self.broker_verified
            and self.broker_safety_tests_passed
        )


settings = Settings()
