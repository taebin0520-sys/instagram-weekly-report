"""브랜드 강화 기준 KPI 계산.

핵심 지표: 저장률, 공유, 참여율 (문의·신청은 부가 지표로만 취급)
0으로 나누는 상황은 절대 0%나 None이 아닌 값으로 위장하지 않고
명시적으로 None을 반환해서 리포트에서 '확인 불가'로 표시하게 한다.
"""
import pandas as pd


def engagement_rate(row):
    """(좋아요+댓글+저장+공유) / 도달. 도달 0이면 None."""
    if row["reach"] == 0:
        return None
    return (row["likes"] + row["comments"] + row["saves"] + row["shares"]) / row["reach"]


def save_rate(row):
    """저장 / 도달. 브랜드 강화 기준의 핵심 지표."""
    if row["reach"] == 0:
        return None
    return row["saves"] / row["reach"]


def add_rates(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["engagement_rate"] = df.apply(engagement_rate, axis=1)
    df["save_rate"] = df.apply(save_rate, axis=1)
    return df


def week_over_week(this_value: float, last_value):
    """지난주 대비 증감률. 지난주 데이터 없거나 0이면 None (비교 불가)."""
    if last_value is None or last_value == 0:
        return None
    return (this_value - last_value) / last_value


def topic_summary(df: pd.DataFrame) -> pd.DataFrame:
    """주제(topic)별 평균 저장률/참여율. 브랜드 각인에 뭐가 잘 먹히는지 확인용."""
    df = add_rates(df)
    return (
        df.groupby("topic")
        .agg(
            게시물수=("date", "count"),
            평균저장률=("save_rate", "mean"),
            평균참여율=("engagement_rate", "mean"),
            총문의=("dm_inquiries", "sum"),
            총신청=("signups", "sum"),
        )
        .sort_values("평균저장률", ascending=False)
    )
