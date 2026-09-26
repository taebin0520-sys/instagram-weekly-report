"""주간 리포트를 텍스트로 생성한다. (브랜드 강화 기준)"""
from src.data_loader import split_by_week, week_bounds
from src.kpi import add_rates, week_over_week, topic_summary


def _fmt_pct(v):
    return "확인 불가" if v is None else f"{v*100:.1f}%"


def _fmt_delta(v):
    if v is None:
        return "(지난주 데이터 없음 → 비교 불가)"
    sign = "+" if v >= 0 else ""
    return f"({sign}{v*100:.1f}%p 전주 대비)"


def build_weekly_report(df) -> str:
    latest, previous = split_by_week(df)
    if latest is None:
        return "데이터가 없습니다."

    latest = add_rates(latest)
    # 게시물 최소/최대 날짜가 아니라 ISO 주 경계(월~일)를 쓴다.
    # "이번 주"가 어디까지인지가 게시 여부에 따라 달라지면 안 된다.
    start, end = week_bounds(latest)

    total_reach = int(latest["reach"].sum())
    total_saves = int(latest["saves"].sum())
    total_shares = int(latest["shares"].sum())
    total_inquiries = int(latest["dm_inquiries"].sum())
    total_signups = int(latest["signups"].sum())
    avg_engagement = latest["engagement_rate"].mean(skipna=True)

    prev_reach = int(previous["reach"].sum()) if previous is not None else None
    reach_delta = week_over_week(total_reach, prev_reach)

    top = latest.sort_values("save_rate", ascending=False).head(2)
    bottom = latest.sort_values("save_rate", ascending=True).head(1)

    lines = []
    lines.append("━" * 33)
    lines.append("아벤투라 인스타 주간 리포트 (브랜드 강화 기준)")
    lines.append(f"{start}(월) ~ {end}(일) ({len(latest)}건)")
    lines.append("━" * 33)
    lines.append("")
    lines.append("[이번 주 요약]")
    lines.append(f"- 총 도달 {total_reach:,} {_fmt_delta(reach_delta)}")
    lines.append(f"- 저장 {total_saves}건 / 공유 {total_shares}건")
    lines.append(f"- 평균 참여율 {_fmt_pct(avg_engagement)}")
    lines.append(f"- (참고) 문의 {total_inquiries}건 / 신청 {total_signups}건")
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
            f"— 저장률 {_fmt_pct(r['save_rate'])} (도달 {r['reach']:,}로 가장 넓었는지 확인 필요)"
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
    lines.append("[다음 주 액션] (직접 작성)")
    lines.append("1. ___________________")
    lines.append("2. ___________________")
    lines.append("3. ___________________")
    lines.append("━" * 33)
    return "\n".join(lines)
