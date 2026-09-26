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
    """지난주 대비 증감률. 지난주 데이터 없거나 0이면 None (비교 불가).

    절대 수치(도달·저장·공유)에 쓴다. 반환값은 소수 비율이며 리포트에서
    '%'로 표시한다. 비율 지표(저장률·참여율)에는 diff_pp 를 쓴다.
    """
    if last_value is None or last_value == 0:
        return None
    return (this_value - last_value) / last_value


def diff_pp(this_rate, last_rate):
    """비율 지표의 전주 대비 '차이'. 단위는 percentage point(%p).

    week_over_week 와 의도적으로 분리한다.
      week_over_week : 절대 수치의 상대 증감률 → '%'
      diff_pp        : 비율 지표의 차이       → '%p'

    저장률이 1.4% -> 1.5% 로 올랐을 때
      diff_pp        = +0.1  (%p)
      week_over_week = +0.072 (= +7.2%)
    둘 다 맞는 숫자지만 의미가 다르다. 도달처럼 비율이 아닌 값에
    '%p'를 붙이면 단위가 성립하지 않으므로 함수를 나눠 둔다.

    한쪽이라도 산출 불가(None)면 비교 자체가 불가능하므로 None.
    (0으로 눌러서 계산을 이어가지 않는다 — '확인 불가'는 전파된다)
    """
    if this_rate is None or last_rate is None:
        return None
    return (this_rate - last_rate) * 100


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
