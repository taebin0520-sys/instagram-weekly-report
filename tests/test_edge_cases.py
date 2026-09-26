"""엣지 케이스 검증 — CSV 로드 · 주 분리 · 리포트 생성까지 통째로 확인한다.

test_kpi.py 와 나눠 둔 이유:
  test_kpi.py 는 dict 만 넘기는 순수 함수 단위 테스트라 pandas 가 없어도 돈다.
  이 파일은 실제 CSV 파일을 만들어 load_posts -> split_by_week ->
  build_weekly_report 를 통과시키므로 pandas 가 반드시 필요하다.
  성격이 다른 테스트를 한 파일에 섞으면 실패 원인을 좁히기 어려워진다.
"""
import os
import sys
from datetime import date

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.data_loader import load_posts, split_by_week, week_bounds
from src.report import build_weekly_report

HEADER = (
    "date,type,topic,reach,likes,comments,saves,shares,"
    "profile_visits,dm_inquiries,signups"
)


def make_row(
    day,
    topic="후기",
    reach=100,
    likes=10,
    comments=1,
    saves=5,
    shares=2,
    visits=3,
    dm=0,
    signups=0,
    kind="카드뉴스",
):
    return (
        f"{day},{kind},{topic},{reach},{likes},{comments},"
        f"{saves},{shares},{visits},{dm},{signups}"
    )


def write_csv(tmp_path, rows):
    path = tmp_path / "posts.csv"
    path.write_text("\n".join([HEADER, *rows]) + "\n", encoding="utf-8")
    return str(path)


# --- reach = 0 ---------------------------------------------------------------


def test_zero_reach_reports_unavailable_without_sort_error(tmp_path):
    """도달 0 게시물이 섞여도 정렬이 깨지지 않고 '확인 불가'로 표시된다.

    저장률이 None 이면 열이 object dtype 이 되어 정렬이 값 비교에 실패할 수 있다.
    또 0% 로 표시하면 '성과 없음'과 '측정 불가'가 구분되지 않는다 (규칙 3).
    """
    csv_path = write_csv(
        tmp_path,
        [
            make_row("2026-10-05", topic="후기", reach=100, saves=5),
            make_row(
                "2026-10-06",
                topic="제품",
                reach=0,
                likes=0,
                comments=0,
                saves=0,
                shares=0,
            ),
            make_row("2026-10-07", topic="협동조합소개", reach=200, saves=2),
        ],
    )

    out = build_weekly_report(load_posts(csv_path))  # 정렬에서 터지지 않아야 한다

    assert "확인 불가" in out
    # 산출 불가를 nan 이나 0% 로 흘리지 않는다
    assert "nan" not in out.lower()


def test_zero_reach_post_is_not_picked_as_bottom(tmp_path):
    """하위 게시물에는 '확인 불가'가 아니라 실제로 저장률이 낮은 게시물이 뽑힌다."""
    csv_path = write_csv(
        tmp_path,
        [
            make_row("2026-10-05", topic="후기", reach=100, saves=9),
            make_row(
                "2026-10-06",
                topic="제품",
                reach=0,
                likes=0,
                comments=0,
                saves=0,
                shares=0,
            ),
            make_row("2026-10-07", topic="협동조합소개", reach=200, saves=2),
        ],
    )

    out = build_weekly_report(load_posts(csv_path))
    bottom_block = out.split("[하위 게시물 - 저장률 기준]")[1].split("[")[0]

    # 협동조합소개 1.0% < 후기 9.0% 이므로 하위는 협동조합소개여야 한다
    assert "협동조합소개" in bottom_block
    assert "제품" not in bottom_block


# --- 한 주만 있는 CSV --------------------------------------------------------


def test_single_week_marks_wow_unavailable(tmp_path):
    """지난주 데이터가 없으면 전주 대비는 '확인 불가'이고 사유가 붙는다."""
    csv_path = write_csv(
        tmp_path,
        [
            make_row("2026-10-05", topic="후기"),
            make_row("2026-10-07", topic="제품"),
        ],
    )
    df = load_posts(csv_path)

    latest, previous = split_by_week(df)
    assert previous is None

    out = build_weekly_report(df)
    assert "확인 불가 — 지난주 데이터 없음" in out
    # 비교가 막혔어도 이번 주 절대 지표는 그대로 나와야 한다 (R4.5)
    assert "총 도달 200" in out


# --- ISO 주 경계 (일요일 / 월요일) ------------------------------------------


def test_sunday_and_monday_split_by_iso_week(tmp_path):
    """일요일은 그 주에, 월요일은 다음 주에 속한다.

    %U(일요일 시작)를 쓰면 2026-10-11(일)이 새 주를 시작해버린다.
    ISO(%G-W%V, 월요일 시작)에서는 10-05(월)~10-11(일)이 한 주다.
    """
    csv_path = write_csv(
        tmp_path,
        [
            make_row("2026-10-05", topic="후기"),         # 월 — W41 시작
            make_row("2026-10-11", topic="제품"),         # 일 — W41 끝
            make_row("2026-10-12", topic="협동조합소개"),  # 월 — W42 시작
        ],
    )
    latest, previous = split_by_week(load_posts(csv_path))

    assert list(latest["date"].dt.strftime("%Y-%m-%d")) == ["2026-10-12"]
    assert sorted(previous["date"].dt.strftime("%Y-%m-%d")) == [
        "2026-10-05",
        "2026-10-11",
    ]
    assert week_bounds(previous) == (date(2026, 10, 5), date(2026, 10, 11))
    assert week_bounds(latest) == (date(2026, 10, 12), date(2026, 10, 18))


# --- 연말 경계 ---------------------------------------------------------------


def test_year_end_dates_stay_in_same_iso_week(tmp_path):
    """2026-12-31(목)과 2027-01-03(일)은 같은 ISO 주(2026-W53)다.

    %Y + %V 를 섞으면 여기서 깨진다. %G(ISO 연도)를 써야 한 주로 묶인다.
    %U 를 쓰면 2027-01-03 이 2027-W01 로 튄다.
    """
    csv_path = write_csv(
        tmp_path,
        [
            make_row("2026-12-31", topic="후기"),
            make_row("2027-01-03", topic="제품"),
        ],
    )
    latest, previous = split_by_week(load_posts(csv_path))

    assert len(latest) == 2  # 두 날짜가 같은 주로 묶였다
    assert previous is None
    assert week_bounds(latest) == (date(2026, 12, 28), date(2027, 1, 3))


# --- 음수 검증 ---------------------------------------------------------------


def test_negative_value_is_rejected(tmp_path):
    """음수는 검증을 통과하지 못하고, 줄 번호·컬럼·값이 메시지에 담긴다."""
    csv_path = write_csv(
        tmp_path,
        [
            make_row("2026-10-05", topic="후기"),
            make_row("2026-10-06", topic="제품", reach=-100),
        ],
    )

    with pytest.raises(ValueError) as excinfo:
        load_posts(csv_path)

    message = str(excinfo.value)
    assert "reach" in message
    assert "-100" in message
    assert "3번째 줄" in message  # 헤더 1줄 + 데이터 2줄째


def test_blank_value_is_rejected(tmp_path):
    """빈칸도 0으로 자동 보정하지 않고 거부한다 (규칙 5)."""
    csv_path = write_csv(
        tmp_path,
        [
            make_row("2026-10-05", topic="후기"),
            make_row("2026-10-06", topic="제품", saves=""),
        ],
    )

    with pytest.raises(ValueError) as excinfo:
        load_posts(csv_path)

    assert "saves" in str(excinfo.value)
