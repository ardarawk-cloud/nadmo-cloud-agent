from datetime import datetime, timedelta, timezone

import pytest

from app.paper_engine import PaperEngine


def test_paper_round_trip_buy():
    engine = PaperEngine(starting_balance=1000.0)
    position = engine.open_position(
        symbol="BTCUSDT",
        side="BUY",
        quantity=0.01,
        entry_price=100.0,
        stop_loss=95.0,
        take_profit=110.0,
        idempotency_key="order-0001",
        kai_score=80,
    )
    trade = engine.close_position(position["id"], 110.0, "TAKE_PROFIT")
    assert trade["net_pnl"] == pytest.approx(0.1)
    assert trade["kai_score"] == 80
    assert engine.account()["completed_trades"] == 1
    assert engine.account()["open_positions"] == 0


def test_duplicate_order_is_rejected():
    engine = PaperEngine()
    kwargs = dict(
        symbol="BTCUSDT",
        side="BUY",
        quantity=0.01,
        entry_price=100.0,
        stop_loss=95.0,
        take_profit=110.0,
        idempotency_key="order-0002",
    )
    engine.open_position(**kwargs)
    with pytest.raises(ValueError, match="DUPLICATE_ORDER"):
        engine.open_position(**kwargs)


def test_invalid_protection_is_rejected():
    engine = PaperEngine()
    with pytest.raises(ValueError, match="INVALID_PROTECTION_LEVELS"):
        engine.open_position(
            symbol="BTCUSDT",
            side="BUY",
            quantity=0.01,
            entry_price=100.0,
            stop_loss=105.0,
            take_profit=110.0,
            idempotency_key="order-0003",
        )


def test_paper_state_survives_restart_and_tracks_costs(tmp_path):
    state_file = tmp_path / "paper_state.json"
    engine = PaperEngine(
        starting_balance=1000.0,
        state_file=str(state_file),
        fee_pct=0.30,
        slippage_pct=0.05,
    )
    position = engine.open_position(
        symbol="BTCIDR",
        side="BUY",
        quantity=0.01,
        entry_price=100.0,
        stop_loss=95.0,
        take_profit=110.0,
        idempotency_key="persist-0001",
        kai_score=82,
    )
    trade = engine.close_position(position["id"], 110.0, "TAKE_PROFIT")
    assert trade["fees"] > 0
    assert trade["slippage_cost"] > 0
    assert trade["net_pnl"] < trade["gross_pnl"]

    restored = PaperEngine(
        starting_balance=500.0,
        state_file=str(state_file),
        fee_pct=0.30,
        slippage_pct=0.05,
    )
    assert restored.account()["completed_trades"] == 1
    assert restored.account()["balance"] == pytest.approx(engine.account()["balance"])
    assert restored.performance()["average_kai_score"] == pytest.approx(82.0)
    assert restored.journal()[0]["exit_reason"] == "TAKE_PROFIT"


def test_loss_lock_expires_after_cooldown():
    engine = PaperEngine(starting_balance=1000.0)

    for index in range(3):
        position = engine.open_position(
            symbol="BTCIDR",
            side="BUY",
            quantity=0.01,
            entry_price=100.0,
            stop_loss=95.0,
            take_profit=110.0,
            idempotency_key=f"loss-{index}",
            kai_score=80,
        )
        engine.close_position(position["id"], 90.0, "STOP_LOSS")

    locked = engine.loss_lock_status(24.0)
    assert locked["consecutive_losses"] == 3
    assert locked["risk_consecutive_losses"] == 3
    assert locked["cooldown_active"] is True
    assert locked["seconds_remaining"] > 0

    engine.trades[-1].closed_at = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
    expired = engine.loss_lock_status(24.0)
    assert expired["consecutive_losses"] == 3
    assert expired["risk_consecutive_losses"] == 0
    assert expired["cooldown_active"] is False
    assert expired["seconds_remaining"] == 0
