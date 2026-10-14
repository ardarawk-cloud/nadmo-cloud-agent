from __future__ import annotations

from dataclasses import dataclass


class IndodaxBrokerError(RuntimeError):
    pass


@dataclass(frozen=True)
class IndodaxBrokerCapabilities:
    public_market_data: bool = True
    private_account_read: bool = False
    live_trade: bool = False
    withdrawal: bool = False
    safety_tests_passed: bool = False


class IndodaxBrokerAdapter:
    """Fail-closed INDODAX broker adapter.

    LIVE methods intentionally remain unavailable until server-side API credentials
    are provisioned, permissions are verified (withdrawal disabled), and critical
    safety tests pass. Secrets must never be embedded in the Android APK.
    """

    name = "INDODAX"

    def __init__(self) -> None:
        self.capabilities = IndodaxBrokerCapabilities()

    def status(self) -> dict:
        return {
            "broker": self.name,
            "connected": False,
            "authenticated": False,
            "private_account_read": self.capabilities.private_account_read,
            "live_trade": self.capabilities.live_trade,
            "withdrawal": self.capabilities.withdrawal,
            "safety_tests_passed": self.capabilities.safety_tests_passed,
            "state": "LIVE_LOCKED",
        }

    async def authenticate(self, *_args, **_kwargs):
        raise IndodaxBrokerError("LIVE_CREDENTIALS_NOT_PROVISIONED")

    async def get_account(self):
        raise IndodaxBrokerError("PRIVATE_API_NOT_ENABLED")

    async def place_order(self, *_args, **_kwargs):
        raise IndodaxBrokerError("LIVE_EXECUTION_LOCKED")

    async def cancel_order(self, *_args, **_kwargs):
        raise IndodaxBrokerError("LIVE_EXECUTION_LOCKED")

    async def close_position(self, *_args, **_kwargs):
        raise IndodaxBrokerError("LIVE_EXECUTION_LOCKED")
