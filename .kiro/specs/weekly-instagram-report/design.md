# Design — 아벤투라 인스타 주간 리포트

대응 요구사항: `requirements.md`

## 1. 설계 원칙

1. **기존 4모듈 구조 유지.** 새 폴더·새 레이어·새 추상화 계층을 만들지 않는다.
2. **한 방향 흐름.** CSV → 검증 → 집계·계산 → 문자열. 역방향 의존 없음.
3. **계산과 표현의 분리.** `kpi.py`는 숫자만, 문자열은 `report.py`만.
   이 경계가 "확인 불가" 처리의 핵심이다 (3절).
4. **순수 함수 우선.** `kpi.py`의 함수는 입력만 보고 값을 돌려준다.
   파일을 읽지도, print하지도 않는다. → 테스트가 쉬워진다.
5. **최소 수정.** 기존 함수 시그니처를 바꿔야 할 때는 인자 추가(기본값 있음)를 우선한다.

## 2. 모듈 책임 및 데이터 흐름

```
main.py
  │  sys.argv[1] → csv_path
  ▼
src/data_loader.py        load_posts(csv_path) -> DataFrame
  │                        · 파일/열/타입/음수 검증
  │                        · date를 datetime으로 파싱
  │                        · 실패 시 DataValidationError
  ▼
src/kpi.py                 aggregate_weeks(df)   -> dict[WeekKey, WeekTotals]
  │                        select_target_week(...) -> (this_week, prev_week|None)
  │                        build_week_metrics(...)  -> WeekMetrics
  │                        compare_weeks(...)       -> WoWMetrics
  │                        ※ 숫자 또는 None만 반환. 문자열 없음.
  ▼
src/report.py              render_weekly_report(...) -> str
  │                        · None → "확인 불가"로 변환하는 유일한 지점
  │                        · 지표 순서 강제 (저장률 먼저)
  ▼
main.py                    print(report)
```

**의존 방향**: `main` → `report` → `kpi`, `main` → `data_loader` → `kpi`.
`kpi.py`는 아무것도 import하지 않는다 (pandas 제외). 그래서 단위 테스트가 가볍다.

## 3. 핵심 설계 결정: "확인 불가"를 어떻게 표현하나

이게 이 프로젝트에서 가장 중요한 설계 판단이라서 따로 설명한다.

### 선택한 방식: 계산 단계는 `None`, 문자열화는 `report.py`에서만

```python
# src/kpi.py
def rate(numerator: int, denominator: int) -> float | None:
    """비율 계산. 분모가 0이면 None (= 산출 불가)."""
    if denominator <= 0:
        return None            # ← 0.0이 아니라 None
    return numerator / denominator
```

```python
# src/report.py
UNAVAILABLE = "확인 불가"

def fmt_pct(value: float | None, reason: str = "") -> str:
    if value is None:
        return f"{UNAVAILABLE} ({reason})" if reason else UNAVAILABLE
    return f"{value * 100:.2f}%"
```

### 왜 이렇게 하나 (대안과 비교)

| 방식 | 문제 |
|---|---|
| `0.0` 반환 | **치명적.** "성과 없음"과 "측정 불가"가 같은 값이 된다. 요구사항 R5 위반 |
| `kpi.py`가 `"확인 불가"` 문자열 반환 | 이후 정렬·최대값·평균 계산에서 타입 에러. 계산 계층에 표현이 섞임 |
| `float('nan')` | 전파는 되지만 `nan == nan`이 False라서 테스트가 까다롭고, 사유를 담을 수 없음 |
| **`None` + 표현 계층 변환** | ✅ 전파가 자연스럽고, `is None`으로 테스트 명확, 타입 힌트로 의도가 드러남 |

### 전파 규칙

`None`은 **계산을 통과할 때 계속 `None`으로 남는다.** 중간에 0으로 눌러서 이어가지 않는다.

```python
def diff_pp(this: float | None, prev: float | None) -> float | None:
    """비율 지표의 전주 대비 (percentage point).
    한쪽이라도 산출 불가면 비교 자체가 불가능하다."""
    if this is None or prev is None:
        return None
    return (this - prev) * 100
```

### 사유(reason) 전달

"확인 불가"만 나오면 운영자가 원인을 모른다. 그래서 사유를 같이 전달한다.

| 상황 | 리포트 출력 |
|---|---|
| 이번 주 `reach == 0` | `확인 불가 (도달 0)` |
| 지난주 주 데이터 없음 | `확인 불가 (지난주 데이터 없음)` |
| 지난주 `reach == 0` | `확인 불가 (지난주 도달 0)` |

사유는 `kpi.py`가 아니라 **`report.py`가 상태를 보고 판단**한다.
(`prev_week is None`인지, `prev.reach == 0`인지는 report가 알 수 있다)
→ `kpi.py`에 한국어 문자열이 들어가지 않는다.

## 4. 데이터 구조

경량 `dataclass`를 쓴다. 클래스 계층이나 ORM은 만들지 않는다.

```python
# src/kpi.py

WeekKey = tuple[int, int]        # (ISO year, ISO week) 예: (2026, 41)

@dataclass(frozen=True)
class WeekTotals:
    """한 주의 원시 합계. 비율 없음."""
    key: WeekKey
    start: date                  # 월요일
    end: date                    # 일요일
    post_count: int
    reach: int
    likes: int
    comments: int
    saves: int
    shares: int
    profile_visits: int
    dm_inquiries: int            # 참고 지표
    signups: int                 # 참고 지표
    study_dm_inquiries: int      # topic == "스터디모집" 만
    study_signups: int

@dataclass(frozen=True)
class WeekMetrics:
    """비율 지표. None = 확인 불가."""
    totals: WeekTotals
    save_rate: float | None          # 1순위
    engagement_rate: float | None    # 2순위

@dataclass(frozen=True)
class PostMetrics:
    date: date
    type: str
    topic: str
    reach: int
    save_rate: float | None
    engagement_rate: float | None

@dataclass(frozen=True)
class WoWMetrics:
    """전주 대비. 모든 필드가 None일 수 있다."""
    save_rate_pp: float | None
    engagement_rate_pp: float | None
    reach_delta: int | None
    reach_pct: float | None
    saves_delta: int | None
    shares_delta: int | None
```

**왜 `WeekTotals`와 `WeekMetrics`를 나누나**: 합계는 항상 계산 가능하지만 비율은 아니다.
둘을 한 객체에 섞으면 "이 객체는 유효한가"를 필드별로 따져야 한다. 분리하면
"합계는 믿을 수 있고, 비율만 None 검사하면 된다"가 된다.

## 5. 함수 시그니처

```python
# src/data_loader.py
class DataValidationError(Exception): ...

REQUIRED_COLUMNS: list[str]
def load_posts(csv_path: str) -> pd.DataFrame: ...
```

```python
# src/kpi.py
def rate(numerator: int, denominator: int) -> float | None: ...
def diff_pp(this: float | None, prev: float | None) -> float | None: ...

def iso_week_key(d: date) -> WeekKey: ...
def week_bounds(key: WeekKey) -> tuple[date, date]: ...

def aggregate_weeks(df: pd.DataFrame) -> dict[WeekKey, WeekTotals]: ...
def latest_week_key(weeks: dict[WeekKey, WeekTotals]) -> WeekKey: ...
def previous_week_key(key: WeekKey) -> WeekKey: ...      # 달력상 직전 주

def build_week_metrics(totals: WeekTotals) -> WeekMetrics: ...
def build_post_metrics(df: pd.DataFrame, key: WeekKey) -> list[PostMetrics]: ...
def compare_weeks(this: WeekMetrics, prev: WeekMetrics | None) -> WoWMetrics: ...
```

```python
# src/report.py
UNAVAILABLE = "확인 불가"
def fmt_pct(value: float | None, reason: str = "") -> str: ...
def fmt_pp(value: float | None, reason: str = "") -> str: ...
def render_weekly_report(
    this: WeekMetrics,
    prev: WeekMetrics | None,
    wow: WoWMetrics,
    posts: list[PostMetrics],
) -> str: ...
```

### `previous_week_key`에 대한 주의

"지난주"는 **달력상 직전 주**다. `sorted(weeks)[-2]`로 구하면 안 된다.
9월에 게시하고 11월에 다시 게시한 경우, 두 번째로 최신인 주가 "지난주"가 되어
**2개월 전 데이터와 비교**하는 왜곡이 생긴다. 반드시 `key - 1`을 계산하고,
그 키가 `weeks`에 없으면 `None`으로 두어 "확인 불가"가 되게 한다.

ISO 연도 경계(1월 1주차의 직전 주는 전년도 52주 또는 53주)는
`date` 산술로 처리한다 — 해당 주 월요일에서 7일을 빼고 다시 `isocalendar()`를 부른다.
주 번호를 직접 -1 하면 연초에 깨진다.

## 6. 리포트 출력 형식 (샘플 데이터 실측값)

첨부된 `instagram_posts.csv`로 실제 계산해 확인한 수치다.

- W40 (09-29~10-02): 도달 3,270 / 저장 47 / 저장률 **1.44%** / 참여율 **9.24%**
- W41 (10-06~10-09): 도달 3,050 / 저장 47 / 저장률 **1.54%** / 참여율 **9.05%**
- 전주 대비: 저장률 **+0.10pp**, 참여율 **-0.19pp**

```
============================================================
아벤투라협동조합 인스타그램 주간 리포트
대상 주: 2026-10-05(월) ~ 2026-10-11(일)  ·  게시물 4건
============================================================

[1] 저장률 — 브랜드 각인 핵심 지표
    이번 주 : 1.54%   (저장 47 / 도달 3,050)
    지난주   : 1.44%   (저장 47 / 도달 3,270)
    전주 대비: +0.10pp

[2] 참여율 — (좋아요+댓글+저장+공유) / 도달
    이번 주 : 9.05%   (반응 276 / 도달 3,050)
    지난주   : 9.24%
    전주 대비: -0.19pp

[3] 확산 · 노출
    공유     : 9건     (전주 대비 +0건)
    도달     : 3,050   (전주 대비 -220, -6.7%)
    프로필방문: 119건

------------------------------------------------------------
게시물별 성과 (저장률 높은 순)
------------------------------------------------------------
날짜         유형       주제           도달    저장률    참여율
2026-10-08  카드뉴스   후기            600    3.33%    14.50%
2026-10-06  카드뉴스   협동조합소개     850    2.12%     7.88%
2026-10-09  피드       스터디모집       400    0.75%     5.50%
2026-10-07  릴스       제품           1,200    0.50%     8.33%

▶ 이번 주 가장 각인된 콘텐츠: 2026-10-08 카드뉴스 / 후기 (저장률 3.33%)

------------------------------------------------------------
참고 지표 — 문의 · 신청
------------------------------------------------------------
※ 브랜드 홍보 목적 게시물의 성과는 저장률·참여율로 판단합니다.
   아래는 스터디모집 게시물에 한해 참고용으로만 확인합니다.

   스터디모집 게시물 (1건): DM 문의 1건 / 신청 0건
   그 외 게시물의 문의·신청은 성과 판단에 사용하지 않습니다.

------------------------------------------------------------
다음 주 액션 (직접 작성)
------------------------------------------------------------
1.
2.
3.
============================================================
```

### 지난주 데이터가 없을 때

```
[1] 저장률 — 브랜드 각인 핵심 지표
    이번 주 : 1.54%   (저장 47 / 도달 3,050)
    지난주   : 확인 불가 (지난주 데이터 없음)
    전주 대비: 확인 불가 (지난주 데이터 없음)
```

이번 주 절대 지표는 그대로 나온다 (R4.5). 비교만 막힌다.

### 도달이 0일 때

```
2026-10-10  피드       공지              0   확인 불가 (도달 0)   확인 불가 (도달 0)
```

**정렬 주의**: 게시물을 저장률 내림차순으로 정렬할 때 `None`은 비교 불가다.
`key=lambda p: (p.save_rate is not None, p.save_rate or 0)` 로 **None을 맨 뒤로** 보낸다.
그리고 "가장 각인된 콘텐츠"는 `save_rate is not None`인 게시물 중에서만 뽑는다.
전부 None이면 그 줄도 `확인 불가`로 출력한다.

## 7. 테스트 전략

`tests/test_kpi.py`는 `kpi.py`의 순수 함수만 본다. CSV 파일도, print도 필요 없다.

| 테스트 | 검증 내용 |
|---|---|
| `test_save_rate_normal` | `rate(47, 3050)` ≈ 0.01541 |
| `test_engagement_rate_normal` | `rate(276, 3050)` ≈ 0.09049 |
| `test_rate_zero_reach_returns_none` | `rate(5, 0) is None` — **0.0이 아님** |
| `test_diff_pp_normal` | `diff_pp(0.01541, 0.01437)` ≈ +0.104 |
| `test_diff_pp_propagates_none` | 한쪽 None → 결과 None |
| `test_iso_week_assignment` | 2026-10-02 → (2026,40), 2026-10-06 → (2026,41) |
| `test_previous_week_is_calendar_adjacent` | 공백 주가 있으면 prev는 None |
| `test_previous_week_across_year_boundary` | 2027-01-04 주의 직전 주 = (2026, 53) |
| `test_compare_weeks_without_prev` | `prev=None` → 모든 WoW 필드 None |

**추가 테스트는 사용자 요청 시에만.** 기존 테스트는 절대 깨지 않으며,
모든 수정 후 `pytest` 재실행으로 확인한다.

## 8. 실행 환경

현재 샌드박스: Python 3.9, **pandas·pytest 미설치**.

⚠️ Python 3.9는 `float | None` 문법을 런타임에서 지원하지 않는다.
두 선택지 중 하나가 필요하다.

- (A) 각 모듈 최상단에 `from __future__ import annotations` 추가 — 최소 수정, 권장
- (B) `Optional[float]` 사용 — 더 장황함

기존 코드가 이미 `Optional`을 쓰고 있으면 그 스타일을 따른다 (일관성 우선).

```bash
pip install pandas pytest
python main.py sample_data/instagram_posts.csv
pytest
```

## 9. 변경하지 않는 것

- 폴더 구조 (`src/`, `tests/`, `sample_data/`, `main.py`)
- CSV 스키마 (11개 열)
- 텍스트 출력 방식 (대시보드 없음)
- 수기 입력 전제 (API 없음)
