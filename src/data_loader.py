"""CSV 게시물 데이터를 불러오고 검증한다."""
from datetime import timedelta

import pandas as pd

REQUIRED_COLUMNS = [
    "date", "type", "topic", "reach", "likes", "comments",
    "saves", "shares", "profile_visits", "dm_inquiries", "signups",
]
NUMERIC_COLUMNS = [
    "reach", "likes", "comments", "saves", "shares",
    "profile_visits", "dm_inquiries", "signups",
]


def _is_count(value) -> bool:
    """0 이상의 정수인지 검사한다.

    str.isdigit() 은 '-5', '1.5', '', 'nan' 을 모두 False 로 본다.
    기존 코드는 lstrip("-") 로 부호를 떼고 검사해서 '-5' 가 통과했다.
    도달·좋아요·저장 같은 값은 셀 수 있는 개수이므로 음수가 될 수 없다.
    음수가 들어오면 입력 오류로 보고 거부한다.
    """
    return str(value).strip().isdigit()


def _csv_line_no(index) -> int:
    """pandas 인덱스를 CSV 파일의 실제 줄 번호로 바꾼다.

    헤더가 1줄이고 인덱스는 0부터이므로 +2 다.
    검증은 정렬(reset_index) 전에 하므로 인덱스가 파일 순서와 일치한다.
    사용자는 pandas 인덱스가 아니라 '파일 몇 번째 줄'로 찾아야 고칠 수 있다.
    """
    return int(index) + 2


def load_posts(csv_path: str) -> pd.DataFrame:
    """CSV를 읽고 필수 컬럼과 숫자 타입을 검증한다.

    문제가 있으면 몇 번째 줄 / 어떤 컬럼 / 어떤 값이 잘못됐는지 알려주는
    에러를 던진다. (조용히 잘못된 데이터로 계산하지 않기 위함)
    누락값을 0으로 자동 보정하지 않는다 — 0은 '성과가 없었다'는 실제
    관측값이므로 '입력을 안 했다'와 섞이면 지표가 오염된다.
    """
    df = pd.read_csv(csv_path)

    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"필수 컬럼이 없습니다: {missing}")

    for col in NUMERIC_COLUMNS:
        invalid = df[~df[col].apply(_is_count)]
        if not invalid.empty:
            details = "\n".join(
                f"  - {_csv_line_no(idx)}번째 줄 (date={r['date']}): "
                f"{col} = {r[col]!r}"
                for idx, r in invalid.iterrows()
            )
            raise ValueError(
                f"'{col}' 컬럼에 0 이상의 정수가 아닌 값이 있습니다.\n"
                f"{details}\n"
                f"  도달·좋아요·저장 같은 값은 음수가 될 수 없습니다. "
                f"빈칸이면 0을 직접 입력해 주세요."
            )
        df[col] = df[col].astype(int)

    df["date"] = pd.to_datetime(df["date"])
    return df.sort_values("date", kind="stable").reset_index(drop=True)


def week_bounds(week_df: pd.DataFrame):
    """한 주의 DataFrame에서 그 주의 (월요일, 일요일)을 구한다.

    ISO 주는 항상 월요일에 시작하므로, 그 주의 아무 날짜에서
    weekday()(월=0 … 일=6)만큼 빼면 그 주 월요일이 나온다.

    게시물의 최소/최대 날짜와 다르다는 점이 중요하다.
    최소/최대는 "게시가 있었던 범위"일 뿐이고, 이 함수는
    게시가 없던 날까지 포함한 "주 전체 기간"을 돌려준다.
    """
    any_date = week_df["date"].iloc[0].date()
    monday = any_date - timedelta(days=any_date.weekday())
    return monday, monday + timedelta(days=6)


def split_by_week(df: pd.DataFrame):
    """date 기준 ISO 주(월~일)로 나눈다. 이번 주 / 달력상 직전 주를 반환.

    ISO 주(%G-W%V)를 쓰는 이유:
      조합 기준이 월요일 시작이다. %U는 일요일 시작이라 일요일 게시물이
      의도와 다른 주로 갈린다. 또 %Y(달력 연도)와 %V(ISO 주)를 섞으면
      연말에 깨진다 — 2027-01-03(일)은 ISO로 2026-W53이다.
      그래서 연도도 반드시 ISO 기준인 %G를 쓴다.
      %V는 2자리 zero-pad이므로 문자열 sorted()가 그대로 유효하다.

    "지난주"를 weeks[-2]로 잡지 않는 이유:
      weeks[-2]는 "두 번째로 최신인 주"이지 달력상 직전 주가 아니다.
      9월에 올리고 11월에 다시 올리면 2개월 전 데이터와 비교하면서
      "전주 대비"라고 표시하게 된다. 반드시 이번 주 월요일에서 7일을
      뺀 주를 찾고, 그 주가 없으면 None으로 둬서 "확인 불가"가 되게 한다.
    """
    df = df.copy()
    df["year_week"] = df["date"].dt.strftime("%G-W%V")
    weeks = sorted(df["year_week"].unique())
    if not weeks:
        return None, None

    latest = df[df["year_week"] == weeks[-1]]

    prev_monday = week_bounds(latest)[0] - timedelta(days=7)
    prev_key = prev_monday.strftime("%G-W%V")
    previous = df[df["year_week"] == prev_key] if prev_key in set(weeks) else None
    return latest, previous
