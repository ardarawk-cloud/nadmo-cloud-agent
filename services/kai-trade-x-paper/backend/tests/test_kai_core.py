from app.kai_core import KaiCore, KaiFactors, MarketRegime


def test_high_quality_signal_is_only_eligible_not_executed():
    core = KaiCore(min_score=75)
    decision = core.evaluate(
        KaiFactors(0.9, 0.85, 0.8, 0.8, 0.9, 0.9),
        trend_strength=0.8,
        volatility_percentile=0.5,
        breakout_strength=0.3,
        range_strength=0.2,
    )
    assert decision.score >= 75
    assert decision.regime == MarketRegime.TRENDING
    assert decision.decision == "SIGNAL_ELIGIBLE"


def test_stale_data_forces_no_trade_even_with_high_score():
    core = KaiCore(min_score=75)
    decision = core.evaluate(
        KaiFactors(1, 1, 1, 1, 1, 1, data_fresh=False),
        trend_strength=1,
        volatility_percentile=0.5,
        breakout_strength=0,
        range_strength=0,
    )
    assert decision.score == 100
    assert decision.decision == "NO_TRADE"
    assert "STALE_MARKET_DATA" in decision.reasons


def test_unsafe_market_has_highest_regime_rejection():
    core = KaiCore()
    decision = core.evaluate(
        KaiFactors(1, 1, 1, 1, 1, 1, market_safe=False),
        trend_strength=1,
        volatility_percentile=0.5,
        breakout_strength=1,
        range_strength=0,
    )
    assert decision.regime == MarketRegime.UNSAFE
    assert decision.decision == "NO_TRADE"
