"""CSV 게시물 데이터를 불러오고 검증한다."""
import pandas as pd

REQUIRED_COLUMNS = [
    "date", "type", "topic", "reach", "likes", "comments",
    "saves", "shares", "profile_visits", "dm_inquiries", "signups",
]
NUMERIC_COLUMNS = [
    "reach", "likes", "comments", "saves", "shares",
    "profile_visits", "dm_inquiries", "signups",
]


def load_posts(csv_path: str) -> pd.DataFrame:
    """CSV를 읽고 필수 컬럼과 숫자 타입을 검증한다.

    문제가 있으면 어떤 행/컬럼이 문제인지 알려주는 에러를 던진다.
    (조용히 잘못된 데이터로 계산하지 않기 위함)
    """
    df = pd.read_csv(csv_path)

    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"필수 컬럼이 없습니다: {missing}")

    for col in NUMERIC_COLUMNS:
        non_numeric = df[~df[col].apply(lambda v: str(v).strip().lstrip("-").isdigit())]
        if not non_numeric.empty:
            raise ValueError(
                f"'{col}' 컬럼에 숫자가 아닌 값이 있습니다. 문제 행:\n{non_numeric[['date', col]]}"
            )
        df[col] = df[col].astype(int)

    df["date"] = pd.to_datetime(df["date"])
    return df.sort_values("date").reset_index(drop=True)


def split_by_week(df: pd.DataFrame):
    """date 기준으로 (연도, 주차)별로 나눈다. 최신 주 / 그 이전 주를 반환."""
    df = df.copy()
    df["year_week"] = df["date"].dt.strftime("%Y-W%U")
    weeks = sorted(df["year_week"].unique())
    if not weeks:
        return None, None
    latest = df[df["year_week"] == weeks[-1]]
    previous = df[df["year_week"] == weeks[-2]] if len(weeks) >= 2 else None
    return latest, previous
