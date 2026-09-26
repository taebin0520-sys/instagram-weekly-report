# Design — 아벤투라 인스타 주간 리포트

대응 요구사항: `requirements.md`
**기준 코드**: `main` 브랜치 `6dec7af` (실제 구현 기준으로 작성됨)

## 1. 설계 원칙

1. **기존 4모듈 구조 유지.** 새 폴더·새 레이어·새 추상화 계층을 만들지 않는다.
2. **한 방향 흐름.** CSV → 검증 → 주 분리 → 계산 → 문자열. 역방향 의존 없음.
3. **계산과 표현의 분리.** `kpi.py`는 숫자(또는 `None`)만, 문자열은 `report.py`만.
4. **순수 함수 우선.** `kpi.py`의 지표 함수는 `row`(dict 또는 Series)만 받는다.
   파일을 읽지도, print하지도 않는다. → pandas 없이도 테스트된다.
5. **최소 수정.** **기존 함수의 시그니처와 동작을 바꾸지 않는다.**
   새 동작이 필요하면 **함수를 추가**한다. 기존 6개 테스트가 baseline이므로
   `engagement_rate` / `save_rate` / `week_over_week`는 건드리지 않는다.

## 2. 실제 모듈 구성 (현재 코드)

```
main.py
  │  sys.argv[1] (없으면 sample_data/instagram_posts.csv)
  ▼
src/data_loader.py
  │  load_posts(csv_path) -> DataFrame
  │      · REQUIRED_COLUMNS 11개 존재 확인
  │      · NUMERIC_COLUMNS 8개 숫자 검증 → astype(int)
  │      · pd.to_datetime(date), date 기준 정렬
  │  split_by_week(df) -> (latest_df, previous_df | None)
  │      · year_week 열 추가 후 최신 주 / 그 이전 주 반환
  ▼
src/kpi.py
  │  engagement_rate(row) -> float | None     reach==0 이면 None
  │  save_rate(row)       -> float | None     reach==0 이면 None
  │  add_rates(df)        -> df + engagement_rate, save_rate 열
  │  week_over_week(this, last) -> float | None   상대 증감률
  │  topic_summary(df)    -> 주제별 집계 DataFrame
  ▼
src/report.py
  │  _fmt_pct(v)   None -> "확인 불가"          ← 문자열화 유일 지점
  │  _fmt_delta(v) None -> "(지난주 데이터 없음 → 비교 불가)"
  │  build_weekly_report(df) -> str
  ▼
main.py  print(...)
```

**의존 방향**: `main` → `data_loader`, `report`.
`report` → `data_loader`(`split_by_week`), `kpi`.
`kpi`는 pandas 외 아무것도 import하지 않는다.

> ⚠️ 주 분리(`split_by_week`)가 `kpi.py`가 아니라 **`data_loader.py`에 있다.**
> 이전 버전 설계 문서는 이를 `kpi.py`에 있다고 잘못 적었다. 위치를 옮기지 않는다
> (옮기면 import 경로가 바뀌어 최소 수정 원칙에 어긋난다).

## 3. 이미 잘 되어 있는 것

규칙 3("확인 불가")의 **핵심 골격은 이미 구현되어 있다.** 새로 만들 필요가 없다.

| 구현된 것 | 위치 |
|---|---|
| `reach == 0` → `None` 반환 | `kpi.engagement_rate`, `kpi.save_rate` |
| 지난주 없음/0 → `None` 반환 | `kpi.week_over_week` |
| `None` → `"확인 불가"` 문자열화 | `report._fmt_pct` |
| 계산 계층에 한국어 문자열 없음 | `kpi.py` 전체 |

따라서 이 설계는 **재작성이 아니라 "새는 구멍 막기 + spec 위반 교정"** 이다.

## 4. 교정 대상 (CI smoke 로그에서 확인된 실제 출력 기준)

현재 출력:
```
[이번 주 요약]
- 총 도달 3,050 (-6.7%p 전주 대비)          ← ① 단위 오류
- 저장 47건 / 공유 9건                       ← ③ 저장률 없음
- 평균 참여율 9.1%
- (참고) 문의 3건 / 신청 2건                  ← ② 요약에 있으면 안 됨
...
2026-10-06 ~ 2026-10-09 (4건)                ← ④ 주 경계 아님
- 릴스·제품 … (도달 1,200로 가장 넓었는지 확인 필요)   ← ⑤ 문구
```

---

## 5. 핵심 설계 결정

### 5.1 "확인 불가"는 `None` — 문자열화는 `report.py`에서만

```python
# src/kpi.py  (현재 코드, 유지)
def save_rate(row):
    if row["reach"] == 0:
        return None            # ← 0.0 이 아니라 None
    return row["saves"] / row["reach"]
```

**왜 `None`인가** — `0.0`을 쓰면 "성과 없음"과 "측정 불가"가 같은 값이 되어 규칙 3을
정면으로 위반한다. 반대로 `kpi.py`가 `"확인 불가"` 문자열을 반환하면 이후 정렬·최대값
계산에서 문자열과 숫자를 비교하다 터진다. `float('nan')`은 전파는 되지만
`nan == nan`이 False라서 테스트가 까다롭고 사유를 담을 수 없다.
`None`은 전파가 자연스럽고 `is None`으로 테스트가 명확하다.

**실제 구현**: 계산 계층이 돌려주는 `None`과 `NaN`을 **`report._fmt_pct`가 함께
받아 `확인 불가`로 변환한다** — pandas의 `groupby().mean()`은 그룹 값이 전부 `None`이면
`None`이 아니라 `NaN`을 돌려주므로(`topic_summary`), 단일 관문에서 두 형태를 모두 막는다.

### 5.2 ① 전주 대비 단위 — 지표 종류에 따라 단위가 다르다

이게 이번 교정에서 가장 헷갈리기 쉬운 부분이다.

| 지표 종류 | 예시 | 비교 방법 | 단위 | 근거 |
|---|---|---|---|---|
| **비율 지표** | 저장률, 참여율 | `이번주 - 지난주` (차이) | **`%p`** | 이미 %인 값끼리의 차이는 퍼센트포인트 |
| **절대 수치** | 도달, 저장, 공유 | `(이번주-지난주)/지난주` (상대) | **`%`** | 비율이 아닌 수의 증감은 상대 비율 |

**왜 섞으면 안 되는가** — 저장률이 1.4% → 1.5%로 올랐을 때, 차이는 `+0.1%p`이지만
상대 증감률로 계산하면 `+7.2%`가 된다. 둘 다 "맞는 숫자"지만 의미가 전혀 다르다.
현재 코드는 도달(절대 수치)에 상대 증감률을 계산하면서 `%p`를 붙인다 —
**숫자는 맞고 단위 라벨만 틀렸다.** 도달은 비율이 아니므로 `%p`가 성립하지 않는다.

**구현 방침 (최소 수정)**

`week_over_week`는 **기존 6개 테스트가 검증하는 함수이므로 수정하지 않는다.**
절대 수치용으로 그대로 쓰고, 비율 지표용 함수를 **추가**한다.

```python
# src/kpi.py  (추가)
def diff_pp(this_rate, last_rate):
    """비율 지표의 전주 대비 차이 (percentage point).

    week_over_week 와 의도적으로 분리한다.
    week_over_week 는 절대 수치의 '상대 증감률(%)',
    diff_pp 는 비율 지표의 '차이(%p)' 다.

    한쪽이라도 산출 불가(None)면 비교 자체가 불가능하므로 None.
    """
    if this_rate is None or last_rate is None:
        return None
    return (this_rate - last_rate) * 100
```

```python
# src/report.py  (_fmt_delta 를 두 개로 분리)
def _fmt_delta_pct(v, reason=""):      # 절대 수치용 → %
    if v is None:
        return f"(확인 불가 — {reason})" if reason else "(확인 불가)"
    return f"({v*100:+.1f}% 전주 대비)"

def _fmt_delta_pp(v, reason=""):       # 비율 지표용 → %p
    if v is None:
        return f"(확인 불가 — {reason})" if reason else "(확인 불가)"
    return f"({v:+.1f}%p 전주 대비)"
```

> `diff_pp`는 이미 100을 곱해서 pp 값을 반환하고, `week_over_week`는 소수 비율을
> 반환한다. 포맷터에서 `*100` 여부가 다른 이유다. 단위를 함수 이름에 박아두면
> 호출부에서 잘못 쓰기 어렵다.

### 5.3 ④ 주 경계를 ISO(월~일)로

현재: `df["date"].dt.strftime("%Y-W%U")` → `%U`는 **일요일 시작** 주번호.

**최소 수정: 포맷 문자열만 `"%G-W%V"`로 바꾼다.**
- `%V` = ISO 주번호(월요일 시작), `%G` = ISO 주 기준 연도
- **`%Y`가 아니라 `%G`를 써야 한다.** `%Y`(달력 연도) + `%V`(ISO 주) 조합은 연말에 깨진다.
- `%V`는 2자리 zero-pad이므로 `sorted()` 문자열 정렬이 그대로 유효하다
  (`"2026-W09" < "2026-W10"`, `"2026-W53" < "2027-W01"`).

실측 비교:

| 날짜 | 요일 | 현재 `%Y-W%U` | ISO `%G-W%V` | ISO 주 경계 |
|---|---|---|---|---|
| 2026-09-29 | 화 | 2026-W39 | **2026-W40** | 09-28 ~ 10-04 |
| 2026-10-06 | 화 | 2026-W40 | **2026-W41** | 10-05 ~ 10-11 |
| 2026-10-11 | **일** | 2026-W41 | **2026-W41** | 10-05 ~ 10-11 |
| 2027-01-03 | **일** | 2027-W01 | **2026-W53** | 12-28 ~ 01-03 |

샘플 데이터는 일/월요일 게시물이 없어서 **우연히 묶음 결과가 같다**(라벨만 밀림).
하지만 **일요일에 게시하면 주가 잘못 갈린다.** `2026-10-11(일)`은 ISO로 W41(이번 주)인데
`%U`로는 W41이라는 *다른 의미의* 주가 되고, `2027-01-03(일)`은 **다음 해 W01로 튄다.**

**기간 표시** — 게시물 최소/최대 날짜가 아니라 ISO 주 경계를 쓴다.

```python
# src/data_loader.py  (추가 — split_by_week 시그니처는 건드리지 않는다)
def week_bounds(week_df):
    """주 DataFrame 에서 그 주의 월요일·일요일을 구한다.

    아무 날짜 하나에서 요일 오프셋을 빼면 월요일이 나온다.
    ISO 주는 항상 월요일 시작이므로 이 계산이 곧 주 경계다.
    """
    any_date = week_df["date"].iloc[0].date()
    monday = any_date - timedelta(days=any_date.weekday())
    return monday, monday + timedelta(days=6)
```

**"지난주" 정의** — `weeks[-2]`(두 번째로 최신인 주)는 **달력상 직전 주가 아니다.**
9월에 올리고 11월에 다시 올리면 2개월 전 데이터와 비교하면서 "전주 대비"라고 표시한다.
반드시 이번 주 월요일 − 7일로 키를 계산하고, 그 키가 없으면 `None`(→ 확인 불가)로 둔다.

```python
# src/data_loader.py  (split_by_week 내부 로직 교정)
latest_key = weeks[-1]
prev_monday = monday_of(latest_key) - timedelta(days=7)
prev_key = prev_monday.strftime("%G-W%V")
previous = df[df["year_week"] == prev_key] if prev_key in set(weeks) else None
```

연말 경계도 이 방식이면 자동으로 맞다 — 2027-W01의 직전 주는 `2026-W53`으로 계산된다
(주 번호를 직접 −1 하면 연초에 깨진다).

### 5.4 ③ 주 단위 비율은 **합계 기준**으로 계산

요약에 저장률을 넣으려면 "주 전체 저장률"을 정의해야 한다. 두 방식이 있다.

| 방식 | 계산 | 문제 |
|---|---|---|
| 게시물별 비율의 평균 | `mean(각 게시물 저장률)` | 도달 40인 글과 4,000인 글이 같은 비중. 저도달 게시물이 과대 반영 |
| **합계 기준 (채택)** | `총저장 / 총도달` | 도달로 자연 가중. 주 전체 성과를 정확히 반영 |

현재 코드는 참여율을 `latest["engagement_rate"].mean(skipna=True)`로 계산한다 —
**게시물별 비율의 평균**이다. 합계 기준으로 바꾼다.

**이건 규칙 3과도 관련된 구멍이다.** `add_rates`가 만든 열은 `None`이 섞이면 object
dtype이 되고, 그 열의 `.mean()`은 상황에 따라 `None`이 아니라 `nan`을 돌려줄 수 있다.
그러면 `_fmt_pct(nan)`이 `"확인 불가"`가 아니라 **`"nan%"`** 를 출력한다.
합계 기준으로 바꾸면 `reach` 합계가 분모라서 이 경로가 아예 사라진다.

**구현이 간단하다** — 기존 함수가 dict를 받으므로 **새 함수가 필요 없다.**

```python
# src/report.py
totals = {
    "reach":    int(latest["reach"].sum()),
    "likes":    int(latest["likes"].sum()),
    "comments": int(latest["comments"].sum()),
    "saves":    int(latest["saves"].sum()),
    "shares":   int(latest["shares"].sum()),
}
week_save_rate = save_rate(totals)          # 기존 함수 재사용
week_engagement = engagement_rate(totals)   # 기존 함수 재사용
```

`save_rate(row)` / `engagement_rate(row)`는 `row["reach"]` 같은 키 접근만 하므로
Series든 dict든 그대로 동작한다. 주 합계가 모두 0이어도 `reach == 0` 분기가
살아 있어서 `None` → `"확인 불가"`가 된다.

> ⚠️ **출력이 바뀐다**: 참여율 `9.1%` → `9.0%`.
> (게시물별 평균 9.0525% → 합계 기준 9.0492%. 반올림 자리가 넘어간다)
> 기존 6개 테스트는 이 경로를 건드리지 않으므로 baseline은 유지된다.

### 5.5 ② 문의·신청은 별도 구획, 스터디모집만

규칙 4: 상단 요약/헤드라인에 문의·신청을 넣지 않고, `topic == "스터디모집"`만 집계.

현재는 `[이번 주 요약]` 4번째 줄에 **전체 게시물 합계**(문의 3건/신청 2건)가 있다.
실제 스터디모집 게시물은 **문의 1건 / 신청 0건**이다. 위치도 집계 대상도 틀렸다.

```python
study = latest[latest["topic"] == "스터디모집"]
study_inquiries = int(study["dm_inquiries"].sum())
study_signups   = int(study["signups"].sum())
```

`topic_summary()`가 반환하는 `총문의`/`총신청` 열은 **출력에 쓰지 않으므로 그대로 둔다**
(계산만 하고 표시하지 않는 것은 규칙 4 위반이 아니다).

### 5.6 ⑤ 하위 게시물 문구

```
현재:  — 저장률 0.5% (도달 1,200로 가장 넓었는지 확인 필요)
변경:  — 저장률 0.5% (도달 1,200명, 저장 6건)
```

`1,200로` → 조사 오류(`1,200으로`)이고, 애초에 되묻는 문장이 필요 없다.
도달이 가장 넓다는 건 이미 데이터에 있고, 판단은 `[다음 주 액션]`에서 사람이 한다.
**사실만 제시하고 해석을 강요하지 않는다.**

---

## 6. 함수별 변경 요약

| 파일 | 함수 | 변경 | 시그니처 |
|---|---|---|---|
| `kpi.py` | `engagement_rate` | **변경 없음** (baseline 보호) | 유지 |
| `kpi.py` | `save_rate` | **변경 없음** (baseline 보호) | 유지 |
| `kpi.py` | `week_over_week` | **변경 없음** (baseline 보호) | 유지 |
| `kpi.py` | `add_rates` | 변경 없음 | 유지 |
| `kpi.py` | `topic_summary` | 변경 없음 | 유지 |
| `kpi.py` | **`diff_pp`** | **신규 추가** (① 비율 지표 %p) | — |
| `data_loader.py` | `load_posts` | 변경 없음 | 유지 |
| `data_loader.py` | `split_by_week` | `%U`→`%G-W%V`, 지난주를 달력 직전 주로 (④) | **유지** |
| `data_loader.py` | **`week_bounds`** | **신규 추가** (④ 기간 표시) | — |
| `report.py` | `_fmt_pct` | 변경 없음 | 유지 |
| `report.py` | `_fmt_delta` | **`_fmt_delta_pct` / `_fmt_delta_pp`로 분리** (①) | 교체 |
| `report.py` | `build_weekly_report` | 요약 재구성 (①②③④⑤) | **유지** |

**외부에서 보이는 시그니처는 하나도 바뀌지 않는다.** `main.py`는 수정 불필요.

---

## 7. 변경 후 목표 출력 (샘플 데이터 실측 계산)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
아벤투라 인스타 주간 리포트 (브랜드 강화 기준)
2026-10-05(월) ~ 2026-10-11(일) (4건)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[이번 주 요약]
- 저장률 1.5% (+0.1%p 전주 대비) — 저장 47 / 도달 3,050
- 참여율 9.0% (-0.2%p 전주 대비)
- 공유 9건 (+0.0% 전주 대비)
- 총 도달 3,050 (-6.7% 전주 대비)

[TOP 게시물 - 저장률 기준]
- 카드뉴스·후기 (2026-10-08) — 저장률 3.3%, 저장 20건, 공유 4건
- 카드뉴스·협동조합소개 (2026-10-06) — 저장률 2.1%, 저장 18건, 공유 4건

[하위 게시물 - 저장률 기준]
- 릴스·제품 (2026-10-07) — 저장률 0.5% (도달 1,200명, 저장 6건)

[주제별 평균 저장률 — 브랜드 각인 기준]
- 후기: 저장률 3.3%, 참여율 14.5% (게시물 1건)
- 협동조합소개: 저장률 2.1%, 참여율 7.9% (게시물 1건)
- 스터디모집: 저장률 0.8%, 참여율 5.5% (게시물 1건)
- 제품: 저장률 0.5%, 참여율 8.3% (게시물 1건)

[참고 지표 — 문의 · 신청]
※ 브랜드 홍보 목적 게시물의 성과는 저장률·참여율로 판단합니다.
   아래는 스터디모집 게시물에 한해 참고용으로만 확인하며,
   성과 판단에 사용하지 않습니다.
- 스터디모집 게시물 1건 — DM 문의 1건 / 신청 0건

[다음 주 액션] (직접 작성)
1. ___________________
2. ___________________
3. ___________________
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 계산 근거

| 항목 | W41 (이번 주) | W40 (지난주) | 전주 대비 |
|---|---|---|---|
| 도달 | 3,050 | 3,270 | `-6.7%` (절대 수치 → %) |
| 저장 | 47 | 47 | `+0.0%` |
| 공유 | 9 | 9 | `+0.0%` |
| **저장률** | 47/3,050 = **1.5410%** | 47/3,270 = 1.4373% | **`+0.1%p`** (비율 → %p) |
| **참여율** | 276/3,050 = **9.0492%** | 302/3,270 = 9.2355% | **`-0.2%p`** |

저장 건수는 47 → 47로 변화가 없는데 **저장률은 올랐다**(도달이 줄어서).
브랜드 각인 기준에서는 이게 개선 신호다 — ①의 단위 구분이 왜 필요한지 보여주는 사례다.

---

## 8. "확인 불가" 출력 케이스

### 지난주 데이터가 없을 때
```
[이번 주 요약]
- 저장률 1.5% (확인 불가 — 지난주 데이터 없음)
- 참여율 9.0% (확인 불가 — 지난주 데이터 없음)
- 공유 9건 (확인 불가 — 지난주 데이터 없음)
- 총 도달 3,050 (확인 불가 — 지난주 데이터 없음)
```
**이번 주 절대 지표는 그대로 나온다** (R4.5). 비교만 막힌다.

### 도달이 0일 때
```
- 피드·공지 (2026-10-10) — 저장률 확인 불가 (도달 0명, 저장 0건)
```

### 이번 주 전체 도달이 0일 때
```
- 저장률 확인 불가 (확인 불가 — 지난주와 비교 불가)
- 참여율 확인 불가 (확인 불가 — 지난주와 비교 불가)
```
`save_rate(totals)`가 `None` → `diff_pp(None, ...)`도 `None`. **전파된다.**

---

## 9. 테스트 전략

`tests/test_kpi.py`의 **기존 6개는 수정하지 않는다.** baseline이다.

```
현재 baseline (CI 검증됨, pandas 3.0.6 / pytest 9.1.1 / Python 3.11.16)
  6 passed
```

`diff_pp` 추가 시 함께 넣을 테스트 후보 (사용자 승인 후):

| 테스트 | 검증 |
|---|---|
| `test_diff_pp_normal` | `diff_pp(0.015410, 0.014373)` ≈ `+0.1037` |
| `test_diff_pp_none_this` | 이번주 None → None |
| `test_diff_pp_none_last` | 지난주 None → None |
| `test_diff_pp_is_not_relative` | `diff_pp`와 `week_over_week` 결과가 다름을 명시 |

`split_by_week`·`build_weekly_report`는 pandas가 필요하므로 CI에서만 검증된다.
CI의 **smoke 스텝**(`python main.py`)이 이 경로를 커버한다.

---

## 10. 변경하지 않는 것

- 폴더 구조 (`src/`, `tests/`, `sample_data/`, `main.py`)
- CSV 스키마 (11개 열)
- 텍스트 출력 방식 (대시보드 없음)
- 수기 입력 전제 (API 없음)
- `engagement_rate`, `save_rate`, `week_over_week` 의 동작 (baseline)
- 외부에서 보이는 모든 함수 시그니처

## 11. 범위 제외 및 미확정

### 이번 범위 제외 (사용자 결정)

- **⑥ 주제별 평균의 표본 부족** — 한 주에 주제별 1건이면 "평균"이 그 게시물 값과 같다.
  여러 주 누적이 필요하다. README "알려진 한계"에 한 줄로만 기록한다.

### T10에서 해결됨

- ✅ **정렬 시 `None` 처리** — 12절 참고. `_rate_known` 불리언 열을 1차 정렬 기준으로
  써서 "확인 불가"를 항상 뒤로 보낸다.
- ✅ **`load_posts`의 음수 통과** — `lstrip("-")`를 제거하고 `str.isdigit()`만 쓴다.
  음수·소수·빈칸·`nan`이 모두 거부된다 (R1.4).
- ✅ **`main.py` 오류 처리** — `FileNotFoundError`·`ValueError`를 잡아 한국어 안내로
  바꾸고 종료 코드 1을 반환한다 (R8.2·R8.3).
- ✅ **소수점 자리수** — `requirements.md` R3.4를 **1자리**로 확정했다.
  팀원 공유용 리포트라 가독성을 우선하며, 표본이 작아 2자리는 실질적 의미가 없다.

### 미확정 / 범위 제외

- **CI 액션 버전** — `actions/checkout@v4`, `actions/setup-python@v5`가 Node 20 기반
  deprecated 경고를 낸다. 동작에는 문제없어 범위에서 제외했다.
- **⑥ 주제별 평균의 표본 부족** — README "알려진 한계"에 기록만.

---

## 12. 정렬과 입력 검증 (T10)

### 12.1 "확인 불가"를 정렬에서 어떻게 다루나

`save_rate`에 `None`이 섞이면 그 열은 object dtype이 되고, pandas 정렬이 값 비교에
실패할 수 있다. 그리고 더 중요한 문제가 있다 — **"확인 불가"가 하위 게시물로 뽑히면
"성과가 나빴다"는 오독을 유발한다.** 측정이 안 된 것과 성과가 낮은 것은 다르다.

`na_position="last"`만으로는 부족하다. TOP(내림차순)과 하위(오름차순) **양쪽에서**
`None`이 뒤로 가야 하는데, 정렬 방향이 반대라서 한 옵션으로는 해결되지 않는다.

**해결: "산출 가능 여부"를 1차 정렬 기준으로 분리한다.**

```python
ranked = latest.assign(
    _rate_known=[v is not None for v in latest["save_rate"]],
    _rate_value=[0.0 if v is None else v for v in latest["save_rate"]],
)
top    = ranked.sort_values(["_rate_known", "_rate_value"], ascending=[False, False]).head(2)
bottom = ranked.sort_values(["_rate_known", "_rate_value"], ascending=[False, True]).head(1)
```

`_rate_known`을 **항상 내림차순**(True 먼저)으로 두면 정렬 방향과 무관하게 `None`이
맨 뒤로 간다. `_rate_value`는 산출 가능한 것들끼리의 순서만 정한다.
리스트 컴프리헨션으로 만들어서 pandas dtype 추론에 의존하지 않는다.

### 12.2 입력 검증 — 0 이상의 정수만 허용

```python
def _is_count(value) -> bool:
    return str(value).strip().isdigit()
```

`str.isdigit()`는 `'-5'`, `'1.5'`, `''`, `'nan'`을 **모두 False**로 본다.
기존 코드는 `lstrip("-")`로 부호를 떼고 검사해서 음수가 통과했다.
도달·좋아요·저장은 셀 수 있는 개수이므로 음수가 될 수 없다.

**오류 메시지는 CSV 줄 번호로 알린다.**

```
'reach' 컬럼에 0 이상의 정수가 아닌 값이 있습니다.
  - 3번째 줄 (date=2026-10-06): reach = '-100'
  도달·좋아요·저장 같은 값은 음수가 될 수 없습니다. 빈칸이면 0을 직접 입력해 주세요.
```

pandas 인덱스가 아니라 **파일 몇 번째 줄**로 알려야 사용자가 찾아서 고칠 수 있다.
헤더 1줄 + 0-based 인덱스이므로 `index + 2`다. 검증은 `reset_index` 전에 하므로
인덱스가 파일 순서와 일치한다.

### 12.3 테스트 파일 분리

`tests/test_edge_cases.py`를 `tests/test_kpi.py`와 **따로 둔다.**

| 파일 | 성격 | pandas |
|---|---|---|
| `test_kpi.py` | dict를 넘기는 순수 함수 단위 테스트 | 불필요 |
| `test_edge_cases.py` | 임시 CSV → 로드 → 주 분리 → 리포트 통합 검증 | **필요** |

성격이 다른 테스트를 한 파일에 섞으면 실패 원인을 좁히기 어렵다.
새 폴더를 만들지 않으므로 규칙 1(구조 유지)에 어긋나지 않는다.
