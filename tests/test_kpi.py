import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.kpi import engagement_rate, save_rate, week_over_week


def test_engagement_rate_normal():
    row = {"reach": 100, "likes": 10, "comments": 2, "saves": 5, "shares": 3}
    assert engagement_rate(row) == 0.20


def test_engagement_rate_zero_reach_returns_none():
    row = {"reach": 0, "likes": 10, "comments": 2, "saves": 5, "shares": 3}
    assert engagement_rate(row) is None


def test_save_rate_normal():
    row = {"reach": 200, "saves": 10}
    assert save_rate(row) == 0.05


def test_week_over_week_no_previous_data():
    assert week_over_week(100, None) is None


def test_week_over_week_previous_zero():
    assert week_over_week(100, 0) is None


def test_week_over_week_normal():
    assert week_over_week(120, 100) == 0.2
