from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import time

import httpx


class MarketDataError(RuntimeError):
    pass


@dataclass(frozen=True)
class MarketQuote:
    symbol: str
    pair_id: str
    price: float
    buy: float | None
    sell: float | None
    source: str
    timestamp: str


@dataclass(frozen=True)
class OhlcCandle:
    timestamp: int
    open: float
    high: float
    low: float
    close: float
    volume: float


class IndodaxPublicMarketData:
    """Official public INDODAX market-data adapter for PAPER validation."""

    BASE_URL = "https://indodax.com"
    ALLOWED_TIMEFRAMES = {"1", "15", "30", "60", "240", "1D", "3D", "1W"}

    @staticmethod
    def normalize_pair(symbol: str) -> tuple[str, str]:
        raw = symbol.upper().replace("-", "/").replace("_", "/").strip()
        if "/" not in raw:
            if raw.endswith("IDR") and len(raw) > 3:
                raw = f"{raw[:-3]}/IDR"
            else:
                raise MarketDataError("INVALID_PAIR")
        base, quote = raw.split("/", 1)
        if not base or not quote or not base.isalnum() or not quote.isalnum():
            raise MarketDataError("INVALID_PAIR")
        return f"{base}/{quote}", f"{base.lower()}{quote.lower()}"

    async def ticker_price(self, symbol: str) -> MarketQuote:
        display, pair_id = self.normalize_pair(symbol)
        timeout = httpx.Timeout(5.0, connect=3.0)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.get(f"{self.BASE_URL}/api/ticker/{pair_id}")
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise MarketDataError("MARKET_DATA_UNAVAILABLE") from exc

        ticker = payload.get("ticker") if isinstance(payload, dict) else None
        if not isinstance(ticker, dict):
            raise MarketDataError("INVALID_MARKET_DATA")
        try:
            last = float(ticker["last"])
            buy = float(ticker["buy"]) if ticker.get("buy") is not None else None
            sell = float(ticker["sell"]) if ticker.get("sell") is not None else None
        except (TypeError, ValueError, KeyError) as exc:
            raise MarketDataError("INVALID_MARKET_DATA") from exc
        if last <= 0:
            raise MarketDataError("INVALID_MARKET_DATA")
        return MarketQuote(display, pair_id, last, buy, sell, "INDODAX_PUBLIC_OFFICIAL", datetime.now(timezone.utc).isoformat())

    async def ohlc_history(self, symbol: str, timeframe: str = "15", limit: int = 120) -> list[OhlcCandle]:
        display, _ = self.normalize_pair(symbol)
        if timeframe not in self.ALLOWED_TIMEFRAMES:
            raise MarketDataError("INVALID_TIMEFRAME")
        limit = max(30, min(int(limit), 500))
        minutes = {"1": 1, "15": 15, "30": 30, "60": 60, "240": 240, "1D": 1440, "3D": 4320, "1W": 10080}[timeframe]
        now = int(time.time())
        start = now - (minutes * 60 * (limit + 5))
        params = {"from": start, "to": now, "tf": timeframe, "symbol": display.replace("/", "")}
        timeout = httpx.Timeout(8.0, connect=3.0)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.get(f"{self.BASE_URL}/tradingview/history_v2", params=params)
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise MarketDataError("OHLC_DATA_UNAVAILABLE") from exc
        if not isinstance(payload, list):
            raise MarketDataError("INVALID_OHLC_DATA")
        candles: list[OhlcCandle] = []
        try:
            for item in payload[-limit:]:
                candles.append(OhlcCandle(int(item["Time"]), float(item["Open"]), float(item["High"]), float(item["Low"]), float(item["Close"]), float(item.get("Volume", 0))))
        except (KeyError, TypeError, ValueError) as exc:
            raise MarketDataError("INVALID_OHLC_DATA") from exc
        if len(candles) < 30:
            raise MarketDataError("INSUFFICIENT_OHLC_DATA")
        candles.sort(key=lambda x: x.timestamp)
        return candles
