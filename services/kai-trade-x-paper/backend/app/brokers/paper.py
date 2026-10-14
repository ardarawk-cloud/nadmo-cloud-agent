from typing import Any
from .base import BrokerAdapter


class PaperBrokerAdapter(BrokerAdapter):
    """In-memory simulated adapter. Never sends real orders."""

    def __init__(self, starting_balance: float = 1000.0) -> None:
        self.balance = starting_balance
        self.equity = starting_balance
        self.connected = False
        self.positions: list[dict[str, Any]] = []
        self.orders: dict[str, dict[str, Any]] = {}
        self.used_idempotency_keys: set[str] = set()

    async def connect(self) -> None:
        self.connected = True

    async def authenticate(self) -> None:
        if not self.connected:
            raise RuntimeError("PAPER_BROKER_NOT_CONNECTED")

    async def get_account(self) -> dict[str, Any]:
        return {
            "mode": "PAPER",
            "balance": self.balance,
            "equity": self.equity,
            "currency": "USD",
            "simulated": True,
        }

    async def get_market_data(self, symbol: str) -> dict[str, Any]:
        return {
            "symbol": symbol,
            "status": "AWAITING_MARKET_DATA",
            "simulated": True,
        }

    async def place_order(self, payload: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
        if idempotency_key in self.used_idempotency_keys:
            return {"status": "DUPLICATE_REJECTED", "idempotency_key": idempotency_key}
        if not payload.get("stop_loss"):
            return {"status": "REJECTED", "reason": "STOP_LOSS_REQUIRED"}

        self.used_idempotency_keys.add(idempotency_key)
        order_id = f"paper-{len(self.orders) + 1}"
        order = {
            "order_id": order_id,
            "status": "SIMULATED_EXECUTION",
            "simulated": True,
            **payload,
        }
        self.orders[order_id] = order
        return order

    async def modify_order(self, order_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        if order_id not in self.orders:
            return {"status": "NOT_FOUND"}
        self.orders[order_id].update(payload)
        return self.orders[order_id]

    async def cancel_order(self, order_id: str) -> dict[str, Any]:
        order = self.orders.get(order_id)
        if not order:
            return {"status": "NOT_FOUND"}
        order["status"] = "CANCELLED"
        return order

    async def close_position(self, position_id: str) -> dict[str, Any]:
        for position in self.positions:
            if position.get("position_id") == position_id:
                position["status"] = "CLOSED"
                return position
        return {"status": "NOT_FOUND"}

    async def get_positions(self) -> list[dict[str, Any]]:
        return list(self.positions)

    async def get_history(self) -> list[dict[str, Any]]:
        return list(self.orders.values())
