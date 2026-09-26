import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from src.kpi import diff_pp, engagement_rate, save_rate, week_over_week


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


# --- diff_pp: 비율 지표의 전주 대비 (percentage point) ---


def test_diff_pp_normal():
    """저장률 1.4373% -> 1.5410% 는 +0.1037%p."""
    this_rate, last_rate = 47 / 3050, 47 / 3270
    assert diff_pp(this_rate, last_rate) == pytest.approx(0.1037, abs=1e-4)


def test_diff_pp_none_this_rate():
    """이번 주가 산출 불가면 비교도 불가 (0으로 눌러 계산하지 않는다)."""
    assert diff_pp(None, 0.014) is None


def test_diff_pp_none_last_rate():
    """지난주가 산출 불가면 비교도 불가."""
    assert diff_pp(0.015, None) is None


def test_diff_pp_is_not_relative_change():
    """diff_pp 와 week_over_week 는 같은 입력에서 다른 값을 낸다.

    같은 저장률 변화(1.4373% -> 1.5410%)를
      diff_pp        = +0.1037  -> 리포트에 '+0.1%p'
      week_over_week = +0.07213 -> 리포트에 '+7.2%'
    로 표시한다. 둘을 섞으면 단위가 틀린 리포트가 나오므로
    함수를 분리해 둔 의도를 테스트로 고정한다.
    """
    this_rate, last_rate = 47 / 3050, 47 / 3270
    assert diff_pp(this_rate, last_rate) == pytest.approx(0.1037, abs=1e-4)
    assert week_over_week(this_rate, last_rate) == pytest.approx(0.0721, abs=1e-4)
