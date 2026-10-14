from abc import ABC, abstractmethod
from typing import Any


class BrokerAdapter(ABC):
    @abstractmethod
    async def connect(self) -> None: ...

    @abstractmethod
    async def authenticate(self) -> None: ...

    @abstractmethod
    async def get_account(self) -> dict[str, Any]: ...

    @abstractmethod
    async def get_market_data(self, symbol: str) -> dict[str, Any]: ...

    @abstractmethod
    async def place_order(self, payload: dict[str, Any], idempotency_key: str) -> dict[str, Any]: ...

    @abstractmethod
    async def modify_order(self, order_id: str, payload: dict[str, Any]) -> dict[str, Any]: ...

    @abstractmethod
    async def cancel_order(self, order_id: str) -> dict[str, Any]: ...

    @abstractmethod
    async def close_position(self, position_id: str) -> dict[str, Any]: ...

    @abstractmethod
    async def get_positions(self) -> list[dict[str, Any]]: ...

    @abstractmethod
    async def get_history(self) -> list[dict[str, Any]]: ...
