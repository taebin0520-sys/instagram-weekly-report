"""주간 리포트를 텍스트로 생성한다. (브랜드 강화 기준)"""
from src.data_loader import split_by_week, week_bounds
from src.kpi import (
    add_rates,
    diff_pp,
    engagement_rate,
    save_rate,
    topic_summary,
    week_over_week,
)


def _fmt_pct(v):
    return "확인 불가" if v is None else f"{v*100:.1f}%"


def _fmt_delta_pct(v, reason=""):
    """절대 수치(도달·저장·공유)의 전주 대비 → '%'.

    비율이 아닌 값의 증감은 상대 증감률로 보므로 단위가 '%'다.
    """
    if v is None:
        return f"(확인 불가 — {reason})" if reason else "(확인 불가)"
    return f"({v*100:+.1f}% 전주 대비)"


def _fmt_delta_pp(v, reason=""):
    """비율 지표(저장률·참여율)의 전주 대비 → '%p'.

    이미 %인 값끼리의 차이이므로 단위가 percentage point 다.
    diff_pp 가 이미 100을 곱해서 pp 값을 주므로 여기서는 곱하지 않는다.
    (_fmt_delta_pct 와 *100 여부가 다른 이유)
    """
    if v is None:
        return f"(확인 불가 — {reason})" if reason else "(확인 불가)"
    return f"({v:+.1f}%p 전주 대비)"


def _totals(week_df):
    """한 주의 합계. 주 단위 비율의 분자·분모로 쓴다.

    kpi.save_rate / kpi.engagement_rate 는 row["reach"] 처럼 키 접근만 하므로
    Series 가 아닌 dict 도 그대로 받는다. 덕분에 '게시물 1건'용 함수를
    '주 전체'에 재사용할 수 있고, reach == 0 -> None 분기도 함께 따라온다.
    """
    return {
        "reach": int(week_df["reach"].sum()),
        "likes": int(week_df["likes"].sum()),
        "comments": int(week_df["comments"].sum()),
        "saves": int(week_df["saves"].sum()),
        "shares": int(week_df["shares"].sum()),
    }


def _delta_reason(previous):
    """전주 대비를 계산할 수 없는 사유.

    사유 판정은 report 계층에서 한다. kpi 계층은 None 만 돌려주고
    한국어 문자열을 갖지 않는다.
    모든 비율 지표의 분모가 도달이므로, 지난주가 존재하는데도 비교가
    불가능한 경우는 지난주 도달이 0인 경우다.
    """
    if previous is None:
        return "지난주 데이터 없음"
    return "지난주 도달 0"


def build_weekly_report(df) -> str:
    latest, previous = split_by_week(df)
    if latest is None:
        return "데이터가 없습니다."

    latest = add_rates(latest)
    # 게시물 최소/최대 날짜가 아니라 ISO 주 경계(월~일)를 쓴다.
    # "이번 주"가 어디까지인지가 게시 여부에 따라 달라지면 안 된다.
    start, end = week_bounds(latest)

    this_totals = _totals(latest)
    prev_totals = _totals(previous) if previous is not None else None

    total_reach = this_totals["reach"]
    total_shares = this_totals["shares"]
    # 문의·신청은 참고 지표다. 전체 게시물 합계가 아니라
    # 스터디모집 게시물만 센다 — 브랜드 홍보 게시물에서 나온 문의는
    # 성과 판단 근거가 아니기 때문이다 (규칙 4).
    study = latest[latest["topic"] == "스터디모집"]
    study_inquiries = int(study["dm_inquiries"].sum())
    study_signups = int(study["signups"].sum())

    # 주 단위 비율은 '게시물별 비율의 평균'이 아니라 '합계 기준'으로 낸다.
    # 평균을 쓰면 도달 40인 글과 4,000인 글이 같은 비중이 되어
    # 저도달 게시물이 과대 반영된다. 합계 기준은 도달로 자연 가중된다.
    #
    # 규칙 3 관련: 예전 방식인 engagement_rate 열의 .mean(skipna=True) 은
    # None 이 섞인 object dtype 에서 None 이 아니라 nan 을 돌려줄 수 있고,
    # 그러면 _fmt_pct 가 '확인 불가'가 아니라 'nan%'를 출력한다.
    # 합계 기준으로 바꾸면 분모가 reach 합계라서 그 경로가 사라진다.
    week_save_rate = save_rate(this_totals)
    week_engagement_rate = engagement_rate(this_totals)
    prev_save_rate = save_rate(prev_totals) if prev_totals is not None else None
    prev_engagement_rate = (
        engagement_rate(prev_totals) if prev_totals is not None else None
    )

    delta_reason = _delta_reason(previous)
    save_rate_delta = diff_pp(week_save_rate, prev_save_rate)
    engagement_delta = diff_pp(week_engagement_rate, prev_engagement_rate)
    shares_delta = week_over_week(
        total_shares, prev_totals["shares"] if prev_totals is not None else None
    )
    reach_delta = week_over_week(
        total_reach, prev_totals["reach"] if prev_totals is not None else None
    )

    top = latest.sort_values("save_rate", ascending=False).head(2)
    bottom = latest.sort_values("save_rate", ascending=True).head(1)

    lines = []
    lines.append("━" * 33)
    lines.append("아벤투라 인스타 주간 리포트 (브랜드 강화 기준)")
    lines.append(f"{start}(월) ~ {end}(일) ({len(latest)}건)")
    lines.append("━" * 33)
    lines.append("")
    # 지표 우선순위: 저장률(브랜드 각인 1순위) -> 참여율 -> 공유 -> 도달
    lines.append("[이번 주 요약]")
    lines.append(
        f"- 저장률 {_fmt_pct(week_save_rate)} "
        f"{_fmt_delta_pp(save_rate_delta, delta_reason)}"
    )
    lines.append(
        f"- 참여율 {_fmt_pct(week_engagement_rate)} "
        f"{_fmt_delta_pp(engagement_delta, delta_reason)}"
    )
    lines.append(f"- 공유 {total_shares}건 {_fmt_delta_pct(shares_delta, delta_reason)}")
    lines.append(f"- 총 도달 {total_reach:,} {_fmt_delta_pct(reach_delta, delta_reason)}")
    lines.append("")
    lines.append("[TOP 게시물 - 저장률 기준]")
    for _, r in top.iterrows():
        lines.append(
            f"- {r['type']}·{r['topic']} ({r['date'].date()}) "
            f"— 저장률 {_fmt_pct(r['save_rate'])}, 저장 {r['saves']}건, 공유 {r['shares']}건"
        )
    lines.append("")
    lines.append("[하위 게시물 - 저장률 기준]")
    for _, r in bottom.iterrows():
        lines.append(
            f"- {r['type']}·{r['topic']} ({r['date'].date()}) "
            f"— 저장률 {_fmt_pct(r['save_rate'])} (도달 {r['reach']:,}명, 저장 {r['saves']}건)"
        )
    lines.append("")
    lines.append("[주제별 평균 저장률 — 브랜드 각인 기준]")
    summary = topic_summary(latest)
    for topic, row in summary.iterrows():
        lines.append(
            f"- {topic}: 저장률 {_fmt_pct(row['평균저장률'])}, "
            f"참여율 {_fmt_pct(row['평균참여율'])} (게시물 {int(row['게시물수'])}건)"
        )
    lines.append("")
    lines.append("[참고 지표 — 문의 · 신청]")
    lines.append("※ 브랜드 홍보 목적 게시물의 성과는 저장률·참여율로 판단합니다.")
    lines.append("   아래는 스터디모집 게시물에 한해 참고용으로만 확인하며,")
    lines.append("   성과 판단에 사용하지 않습니다.")
    lines.append(
        f"- 스터디모집 게시물 {len(study)}건 — "
        f"DM 문의 {study_inquiries}건 / 신청 {study_signups}건"
    )
    lines.append("")
    lines.append("[다음 주 액션] (직접 작성)")
    lines.append("1. ___________________")
    lines.append("2. ___________________")
    lines.append("3. ___________________")
    lines.append("━" * 33)
    return "\n".join(lines)
