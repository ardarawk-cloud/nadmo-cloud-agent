import pytest

from app.brokers.indodax_adapter import IndodaxBrokerAdapter, IndodaxBrokerError
from app.market_data import IndodaxPublicMarketData, MarketDataError


def test_indodax_pair_normalization():
    assert IndodaxPublicMarketData.normalize_pair("BTC/IDR") == ("BTC/IDR", "btcidr")
    assert IndodaxPublicMarketData.normalize_pair("btc_idr") == ("BTC/IDR", "btcidr")
    assert IndodaxPublicMarketData.normalize_pair("BTCIDR") == ("BTC/IDR", "btcidr")


def test_invalid_pair_fails_closed():
    with pytest.raises(MarketDataError):
        IndodaxPublicMarketData.normalize_pair("BTC")


@pytest.mark.asyncio
async def test_indodax_live_execution_locked_without_credentials():
    adapter = IndodaxBrokerAdapter()
    status = adapter.status()
    assert status["state"] == "LIVE_LOCKED"
    assert status["withdrawal"] is False
    with pytest.raises(IndodaxBrokerError, match="LIVE_EXECUTION_LOCKED"):
        await adapter.place_order(symbol="btc_idr", side="buy")
