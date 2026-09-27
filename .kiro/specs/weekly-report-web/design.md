# Design — 인스타 주간 리포트 웹버전 (weekly-report-web)

대응 문서: `requirements.md`, `tasks.md`
계산 규칙의 원본: `src/data_loader.py`, `src/kpi.py`, `src/report.py` (이 문서 작성 시점 `main` = `15878d0`)

---

## 1. 한 줄 요약

`src/`의 계산을 JS 파일 하나로 옮기고(`docs/report.js`), 같은 fixture를 Python과 Node에 넣어
출력 텍스트가 한 글자도 다르지 않은지 CI가 매번 확인한다. Python은 건드리지 않는다.

## 2. 파일 구성

```
docs/
  index.html        화면 (입력 영역, 버튼, 결과 표시) — 로직 없음
  app.js            화면 동작 (붙여넣기·파일 읽기·버튼·클립보드) — 계산 없음
  report.js         계산 + 리포트 텍스트 생성 (브라우저·Node 공용, 순수 함수)
web/
  cli.mjs           Node 실행 진입점: node web/cli.mjs <CSV>  (main.py 대응)
  fixtures/         비교용 CSV (가상 데이터만)
  compare.sh        fixture마다 python/node 출력 비교 (CI에서 실행)
```

### 왜 `web/report.js`가 아니라 `docs/report.js`인가 (결정 D1)

GitHub Pages가 `/docs`를 공개 폴더로 쓰면 **`docs/` 밖의 파일은 URL이 없다**.
`web/report.js`에 두면 `docs/index.html`이 불러올 방법이 없다. 선택지는 두 가지다.

| 안 | 방식 | 장점 | 단점 |
|---|---|---|---|
| A (권장) | `docs/report.js`에 두고 `<script src="report.js">` | 가장 단순. 빌드 단계 없음 | 파일이 1개가 아니라 3개 (전부 같은 출처라 CDN 금지 취지에는 맞음) |
| B | `web/report.js`를 원본으로 두고 스크립트로 `docs/index.html`에 인라인 + CI에서 최신 여부 비교 | 진짜 단일 HTML 파일 | 생성 스크립트·CI 스텝 추가. 원본과 결과물 두 곳 관리 |

"외부 CDN 금지"의 목적은 데이터가 밖으로 나갈 경로를 없애는 것이고, 같은 출처 파일은 그 목적에 어긋나지 않는다.
그래서 A를 권장한다. `web/`에는 Node 전용 파일(CLI·fixture·비교 스크립트)만 둔다.

### `report.js` 공용 방식

번들러 없이 양쪽에서 쓰기 위해 파일 끝에서 환경을 판별한다.

```js
// 브라우저: window.WeeklyReport / Node: require('../docs/report.js')
if (typeof module !== "undefined" && module.exports) module.exports = api;
else globalThis.WeeklyReport = api;
```

`report.js`는 DOM·`fetch`·저장소 API를 쓰지 않는다. 문자열 입력 → 결과 객체 출력만 한다.

## 3. `report.js` 구조 (Python 대응표)

| JS 함수 | 대응 Python | 역할 |
|---|---|---|
| `parseTable(text)` | `pd.read_csv` | 탭/쉼표 자동 판별, 따옴표 필드, BOM·빈 줄 처리 → 헤더 + 행 배열 |
| `validateRows(table)` | `load_posts` | 필수 컬럼, `isCount`, 날짜 형식 검증 → `{ok, rows}` 또는 `{ok:false, errors}` |
| `isCount(v)` | `_is_count` | 공백 제거 후 `/^[0-9]+$/` |
| `isoWeekKey(dayNumber)` | `strftime("%G-W%V")` | ISO 연도·주 |
| `splitByWeek(rows)` | `split_by_week` | 이번 주 / 달력상 직전 주 |
| `weekBounds(rows)` | `week_bounds` | 월요일·일요일 |
| `saveRate`, `engagementRate` | `kpi.save_rate`, `kpi.engagement_rate` | 도달 0 → `null` |
| `weekOverWeek`, `diffPp` | `kpi.week_over_week`, `kpi.diff_pp` | `null` 전파 |
| `topicSummary(rows)` | `kpi.topic_summary` | 주제별 평균 |
| `fmtPct`, `fmtDeltaPct`, `fmtDeltaPp`, `fmtInt` | `_fmt_pct` 등 | **`확인 불가` 변환은 여기서만** |
| `buildWeeklyReport(rows)` | `build_weekly_report` | 줄 배열을 `\n`으로 합친 문자열 |
| `run(text)` | `main` | 파싱→검증→리포트. `{ok, report}` 또는 `{ok:false, message}` |

`null` 규칙은 steering 규칙 3과 같다. 계산 함수는 `null`만 반환하고, `NaN`·`0`·문자열로 바꾸지 않는다.

## 4. Python ↔ JS가 어긋날 위험이 큰 지점 3가지

아래 세 곳은 "로직은 같게 썼는데 출력이 다르게 나오는" 지점이다. 전부 이 문서 작성 중 실제로 확인했다.

### 위험 ① 숫자 반올림·표기 (가장 높음)

**현상** — 소수점 1자리 반올림 규칙이 다르다.
- Python `f"{v:.1f}"`: 정확히 중간값이면 **짝수 쪽**(banker's rounding)
- JS `v.toFixed(1)`: 정확히 중간값이면 **큰 쪽**

**실측** — 저장 49 / 도달 400 = 12.25%

```
Python: f"{49/400*100:.1f}"   → 12.2
Node:   (49/400*100).toFixed(1) → 12.3
```

도달이 400, 800, 2000처럼 딱 떨어지는 수면 충분히 나올 수 있다. 팀원이 붙여넣은 결과와 Python 결과가 0.1 차이 나면 도구 신뢰가 깨진다.

**같은 계열의 작은 차이**
- 부호: Python `:+.1f`는 `-0.0`을 `-0.0`으로 찍는다. JS에서 `v >= 0 ? "+" : "-"`로 부호를 붙이면 `-0`이 `+0.0`이 된다.
- 천 단위 쉼표: Python `:,`는 항상 `3,050`. JS `toLocaleString()`은 기기 언어 설정에 따라 달라질 수 있다 → 쓰지 않고 직접 구현한다.
- 평균: pandas `groupby().mean()`의 합산 방식과 JS 단순 합산이 마지막 비트에서 다를 수 있고, 그 값이 하필 중간값 근처면 반올림이 갈린다. [확인 필요: pandas 3.0.6 group mean 합산 방식] 게시물 수가 적어 가능성은 낮지만 0은 아니다.

**대응**
- `fmtFixed1(x)`를 직접 구현: `toFixed(1)` 결과를 쓰되, `x`의 정확한 이진값이 딱 중간값인 경우만 짝수 쪽으로 보정한다.
  (정확한 중간값 판별: `x.toFixed(100)`으로 전개한 뒤 둘째 자리 이후가 `5` 다음 전부 `0`인지 확인)
- 부호는 `x < 0 || Object.is(x, -0)`이면 `-`.
- 천 단위 쉼표는 정규식으로 직접 삽입.
- fixture `rounding_tie.csv`(12.25%, 0.25% 등 중간값 케이스)와 `negative_zero_delta.csv`를 둔다.

**W3 실측 (PR #14)**
- 표기 함수 대량 비교 (로컬, Python 3.11 `f"{v:.1f}"`·`f"{v:+.1f}"` vs JS): 값 158,241개 중 `fixed1`·`signedFixed1` 불일치 **0개**. 그냥 `toFixed(1)`을 썼다면 불일치 **66개** (예: 6.25 → Python `6.2` / toFixed `6.3`).
- `rounding_tie.csv`: 딱 중간값 6개가 실제로 나온다 — 12.25, 0.25, 6.25(주 저장률), 17.25(주 참여율), +56.25(도달 전주 대비), −56.25(공유 전주 대비). CI에서 Python 출력과 **완전 일치** (`12.2%`, `0.2%`, `6.2%`, `17.2%`, `+56.2%`, `-56.2%`).
- `negative_zero_delta.csv`: `-0.0%p` 2곳, `+0.0%` 2곳 모두 Python과 완전 일치.
- 천 단위 쉼표: 9개 값 Python `:,`와 일치.
- 평균: pandas 3.0.6 `_libs/groupby.pyx` `group_mean`은 **Kahan 보정 합산** 후 개수로 나눈다 (소스 확인). JS `mean()`도 같은 순서로 구현했다. 단, 단순 합산과 Kahan의 차이가 출력(소수 첫째 자리)까지 드러나는 fixture는 만들지 못했다 — 출력 수준의 차이는 미관측.

### 위험 ② 날짜 → 주 계산 (시간대·ISO 연도·입력 형식)

**현상 1 — 시간대.** JS `new Date("2026-09-29")`는 **UTC 자정**으로 해석되고, `getDay()`는 **기기 시간대** 기준으로 요일을 준다.

```
TZ=UTC                 node -e 'new Date("2026-09-29").getDay()' → 2 (화)
TZ=Asia/Seoul          node -e 'new Date("2026-09-29").getDay()' → 2 (화)
TZ=America/Los_Angeles node -e 'new Date("2026-09-29").getDay()' → 1 (월)  ← 하루 밀림
```

UTC보다 느린 시간대(예: LA)에서만 틀린다. 한국(UTC+9)에서도, 기본 UTC CI에서도 우연히 맞게 나오므로
팀원 테스트로도 기본 CI로도 잡히지 않는다. 그래서 `TZ=America/Los_Angeles` CI 스텝이 **필수**다.
주 경계가 하루 밀리면 일·월요일 게시물이 다른 주로 가고 요약 수치 전체가 바뀐다.

**현상 2 — ISO 연도.** `2027-01-03(일)`은 ISO 기준 `2026-W53`이다. 달력 연도(2027)와 ISO 주(53)를 섞으면 연말에 깨진다.
Python은 `%G-W%V`로 이미 막아 두었다 (T5). JS에는 이 기능이 내장되어 있지 않아 직접 구현해야 한다.

**현상 3 — 입력 형식.** Python `pd.to_datetime`은 `2026/9/29`도 받는다. 엑셀 붙여넣기는 셀 표시 형식대로 날짜가 들어온다 (`2026. 9. 29.` 등).
JS에서 형식을 넓게 받으려 하면 Python과 해석이 다른 경우가 생긴다.

**대응**
- 날짜를 `Date` 객체로 다루지 않는다. `YYYY-MM-DD`를 정수로 쪼개 **1970-01-01 기준 일수(정수)**로 바꾸고 요일·주 계산은 전부 정수 산술로 한다. 시간대가 개입할 여지를 없앤다.
- ISO 주: 그 주 목요일이 속한 연도 = ISO 연도, 그 연도 1월 4일이 속한 주 = 1주차.
- 지난주 = `이번 주 월요일 일수 - 7`의 ISO 주 키. 두 번째로 최신인 주를 쓰지 않는다.
- 날짜 형식은 `YYYY-MM-DD`만 허용하고, 다르면 줄 번호와 함께 "엑셀에서 날짜 셀 형식을 yyyy-mm-dd로 바꿔 주세요"라고 안내한다.
  Python보다 좁게 받는 차이이므로 정답지 비교는 `YYYY-MM-DD` 입력으로만 한다 (requirements R1.9).
- CI의 Node 비교 스텝을 `TZ=America/Los_Angeles`로 한 번 더 돌려 시간대 의존이 없는지 확인한다 (필수 — 기본 UTC 스텝만으로는 이 버그가 드러나지 않는다).

**W3 실측 (PR #14)**
- 구현은 "1970-01-01 기준 일수" 대신 Python `date.toordinal()`과 같은 서수(0001-01-01 = 1)를 썼다. 0001-01-01이 월요일이라 요일이 `(서수 − 1) % 7`로 바로 나오고, Python과 숫자를 그대로 대조할 수 있다.
- 로컬 대조 (Python `datetime` vs JS): 1990-01-01 ~ 2060-12-31 **25,933일** 전부에 대해 서수·요일·`%G-W%V`·월요일·"월요일−7일" 주 키 불일치 **0개**.
- CI: compare.sh를 UTC / `America/Los_Angeles` / `Asia/Seoul` 세 번 실행한 결과가 세 시간대 모두 같다 (JS 출력이 시간대에 따라 바뀌지 않음).
- `edge_sunday_monday.csv`, `edge_year_end.csv`(2026-12-28 ~ 2027-01-03 한 주)가 Python과 완전 일치.

### 위험 ③ 정렬·그룹 순서 (동률과 `확인 불가`의 위치)

**현상 1 — 문자열 순서.** 주제별 구획에서 평균 저장률이 같으면 pandas `groupby`의 기본 순서(유니코드 코드포인트 오름차순)가 남는다.
JS에서 흔히 쓰는 `localeCompare`는 이와 다르다.

```
Python sorted(["Zeta","alpha"])                     → ['Zeta', 'alpha']
JS ["Zeta","alpha"].sort((a,b)=>a.localeCompare(b)) → [ 'alpha', 'Zeta' ]
```

한글끼리는 지금은 같게 나오지만, topic에 영문·숫자·공백이 섞이면 갈린다.

**현상 2 — `확인 불가`의 위치.**
- TOP/하위: Python은 "저장률 산출 가능 여부"를 1차 기준으로 써서 `확인 불가`를 항상 뒤로 보낸다 (T10). JS에서 `null`을 0으로 치환해 정렬하면 도달 0 게시물이 **하위 게시물**로 뽑혀 "성과가 나빴다"로 오독된다.
- 주제별: pandas `sort_values`는 `NaN`을 내림차순에서도 **맨 뒤**에 둔다. JS 비교 함수에서 `NaN`을 빼면 결과가 불규칙해진다.

**현상 3 — 같은 저장률·같은 날짜.** Python은 날짜 정렬 후 (저장률 가능 여부, 저장률)로 다시 정렬한다. 동률이면 앞 단계 순서가 남는다.
JS `Array.prototype.sort`는 안정 정렬이라 같은 규칙을 그대로 옮기면 같게 나오지만, 비교 키를 하나라도 빼먹으면 순서가 바뀐다.
[확인 필요] pandas 단일 컬럼 `sort_values` 기본값(quicksort)은 안정 정렬을 보장하지 않는다. 한 주 게시물이 적을 때는 사실상 안정적으로 동작하지만, 같은 날짜 게시물이 많으면 파일 순서와 달라질 수 있다.
같은 문제가 **주제별 구획에도** 있다. `kpi.topic_summary`는 `.sort_values("평균저장률", ascending=False)`로 컬럼 하나만 정렬(quicksort)하므로,
평균 저장률이 같은 주제끼리 `groupby`의 코드포인트 순서가 남는다는 것(현상 1)도 보장되지 않는다.
불안정할 수 있는 정렬은 `load_posts`의 날짜 정렬과 `topic_summary` 두 곳이다. TOP/하위 정렬(`["_rate_known", "_rate_value"]`)은 여러 컬럼 정렬이라 pandas가 안정 정렬을 쓴다.

**대응**
- 문자열 비교는 `a < b ? -1 : a > b ? 1 : 0` (코드포인트)만 쓴다. `localeCompare` 금지.
- 정렬 단계와 키를 Python과 1:1로 맞춘다: ① 날짜 오름차순(파일 순서 유지) → ② (가능 여부 내림차순, 저장률) 정렬.
- 주제별: 코드포인트 오름차순으로 묶은 뒤 평균 내림차순, `null` 평균은 맨 뒤.
- fixture `tie_order.csv`: 같은 저장률 게시물, 같은 날짜 게시물, 영문 topic, 전부 도달 0인 topic을 포함.

**W3 실측 (PR #14)** — 환경: CI ubuntu-24.04, Python 3.11, pandas 3.0.6, numpy 2.4.6

1. **JS `a < b`는 코드포인트 비교가 아니다.** UTF-16 조각 단위 비교라서 이모지가 `ｅ`(U+FF45)보다 앞에 온다. Python은 반대다.
   로컬 19개 문자열 정렬: Python `sorted` = JS `compareCodePoints`(한 글자씩 `codePointAt`) / JS `<`는 `😀이벤트`·`ｅ굿즈`·`\uffff` 순서가 다름 / `localeCompare`는 대부분 다름.
   → 구현은 위 대응의 `a < b` 대신 `compareCodePoints`를 쓴다.
2. **TOP/하위 정렬은 안정 정렬이 맞다.** `tie_order.csv`(행 13개: 같은 저장률 여러 개, 같은 날짜, 영문 topic, 도달 0 topic)가 Python과 **완전 일치**. 하위 게시물 동률도 파일 순서대로 뽑혔다.
3. **주제별 평균이 딱 같으면 Python 순서는 코드포인트 순서가 아니다.** `topic_avg_tie.csv` — 평균 2.0%인 주제 6개, 1.0%인 주제 2개:
   ```
   Python: Zeta, alpha, 스터디모집, 제품, 😀이벤트, ｅ굿즈 | 후기, 협동조합소개
   JS:     Zeta, alpha, 스터디모집, 제품, ｅ굿즈, 😀이벤트 | 협동조합소개, 후기   (코드포인트, 안정 정렬)
   ```
   원인 (소스 확인): numpy 2.4.6 `npysort/quicksort.cpp`에서 실수(double) argsort는 CPU SIMD 정렬(x86-simd-sort)로 넘어가고, 이 정렬은 안정 정렬이 아니다.
   일반 경로(행 16개 이하는 삽입 정렬)였다면 JS와 같은 순서가 나와야 하는데 실제로 다르게 나왔으므로, SIMD 경로를 탄 것으로 본다.
   SIMD 경로는 CPU 기능(AVX2/AVX-512)에 따라 달라지므로 **다른 PC에서는 Python 순서도 달라질 수 있다** — 이 부분은 실측하지 않았다.
   → JS가 이 순서를 재현하는 것은 현실적으로 불가능하다. **결정 필요 D4** (requirements §7). → D4 확정(#15)
4. **날짜 정렬은 행이 16개를 넘으면 같은 날짜의 파일 순서가 깨진다.** `same_date_many_rows.csv` — 행 22개, 그중 2026-10-07이 11개(저장률 전부 2.0%):
   ```
   TOP 2번째 — Python: 카드뉴스·후기 (2026-10-07) 저장 2건  (파일상 데이터 19번째 행)
               JS:     카드뉴스·후기 (2026-10-07) 저장 10건 (파일상 데이터 1번째 행, 안정 정렬)
   ```
   원인 (소스 확인 + 재현): 날짜(datetime64) argsort는 SIMD로 넘어가지 않고 numpy 일반 introsort를 쓴다. 16개 이하는 삽입 정렬(안정)이지만 넘으면 분할 정렬이라 순서가 섞인다.
   numpy `aquicksort_`를 JS로 그대로 옮겨 이 fixture 날짜에 돌리면 10-07 행 순서가 `19,17,15,13,1,21,9,7,5,3,11`이 되어 **Python 출력과 같은 행(19번째)이 첫 번째**로 나온다.
   이 경로는 CPU에 따라 바뀌지 않으므로 JS가 재현할 수는 있다. **결정 필요 D5** (requirements §7). → D5 확정(#15)

**결정 (D4·D5, fix/stable-sort)** — PR #14 CI 실측에서 위 [확인 필요] 두 곳이 실제로 Python·JS 불일치를 냈다
(주제별 평균이 딱 같은 주제의 순서, 행 16개 초과 시 같은 날짜 게시물 순서). 원인은 pandas 기본 정렬(`kind="quicksort"`)이
numpy의 불안정 정렬(실수는 CPU별 SIMD 정렬, 날짜는 분할 정렬)로 넘어가는 것이다. JS로 numpy 정렬을 재현하지 않고,
Python `load_posts`의 날짜 정렬과 `topic_summary`의 평균 저장률 정렬에 `kind="stable"`을 붙여 두 곳 모두 안정 정렬로 바꾼다.
이후 규칙은 양쪽이 같다: 같은 날짜는 파일 순서, 평균이 같은 주제는 코드포인트 순서.
동률이 없는 입력(예: `sample_data`)은 출력이 바뀌지 않는다. 정렬 방식 외 Python 코드는 수정하지 않는다 (requirements R5.1 예외).

## 5. 입력 처리 상세

### 5.1 붙여넣기 판별
- 첫 줄에 탭이 있으면 TSV, 없으면 CSV.
- 따옴표로 감싼 필드(`"1,000"`)는 한 칸으로 읽는다. 값은 그대로 두고 `isCount`에서 거부한다 (Python과 동일한 결과).
- 완전히 빈 줄은 끝이든 중간이든 행으로 읽지 않는다 (pandas `skip_blank_lines=True`와 동일). 단, 오류 안내의 줄 번호는 실제 파일 줄 번호를 쓴다 (§5.4 ②).
- 값의 앞뒤 공백: 숫자 컬럼은 `isCount`에서 `strip`, 문자열 컬럼(`topic` 등)은 **그대로 둔다** (Python이 `"스터디모집 "`을 스터디모집으로 세지 않으므로 같게 한다).

### 5.2 파일 인코딩
`TextDecoder("utf-8", {fatal:true})` 실패 시 `TextDecoder("euc-kr")`. 한국어 엑셀 "CSV(쉼표로 분리)" 저장 파일을 받기 위한 웹 전용 보완이다.
Python은 이 파일을 거부하므로 정답지 비교에서 제외한다.

### 5.3 오류 안내와 Python과의 차이 (결정 D3)
Python은 숫자 컬럼에 빈칸 또는 소수가 하나라도 있으면 pandas가 그 컬럼 전체를 실수(float)로 읽어서, **정상 행도 `100.0`으로 표시되며 오류 목록에 나온다**.
원인: Python은 원문이 아니라 pandas가 변환한 값을 검사한다 (`str(100.0)` = `"100.0"` → `isdigit()` 실패).
CI 실측 (PR #13): `error_blank.csv` → 2·3·4번째 줄 전부 안내 (`900.0`, `nan`, `650.0`), `error_decimal.csv` → 2·3·4번째 줄 전부 안내 (`15.0`, `7.0`, `1.5`).

```
'reach' 컬럼에 0 이상의 정수가 아닌 값이 있습니다.
  - 2번째 줄 (date=2026-09-29): reach = 100.0   ← 정상 값
  - 3번째 줄 (date=2026-09-30): reach = nan     ← 실제 문제
```

JS는 원문 문자열을 검사하므로 3번째 줄만 안내한다. 권장안은 **JS가 이 동작을 따라 하지 않는 것**이다.
그래서 오류 fixture의 비교 기준은 텍스트 일치가 아니라:
1. 둘 다 리포트를 만들지 않는다 (Python 종료코드 1, JS `ok:false`)
2. JS가 안내한 (줄, 컬럼)이 Python이 안내한 (줄, 컬럼) 목록에 포함된다

Python 쪽 현상은 이번 범위에서 고치지 않고 GitHub Issue로 따로 남긴다.

### 5.4 알려진 차이 (Python을 따라 하지 않는 것)

**① 전각 숫자·위첨자 (`isdigit` 차이)**
Python `_is_count`는 `str.isdigit()`을 쓰는데, 이 함수는 ASCII `0-9` 밖의 숫자 문자도 True로 본다.

```
Python 3.11: "１".isdigit() → True (전각 숫자)   "²".isdigit() → True (위첨자)
JS:          /^[0-9]+$/.test("１") → false        /^[0-9]+$/.test("²") → false
```

JS는 ASCII `0-9`만 허용한다 (더 좁게 받음). 이런 값이 들어간 입력은 Python·JS 결과가 같을 수 없으므로 정답지 비교에서 제외한다.
[확인 필요] Python이 `_is_count` 통과 뒤 `astype(int)`에서 이 값을 어떻게 처리하는지는 실측하지 않았다.

**② 파일 중간 빈 줄 → Python 줄 번호 밀림**
pandas는 끝뿐 아니라 파일 중간의 빈 줄도 건너뛰고, `_csv_line_no`는 `index + 2`로 계산한다.
그래서 빈 줄 **뒤에 있는** 행은 Python이 실제 파일보다 앞선 줄 번호로 안내한다.
JS는 사용자가 파일에서 찾을 수 있도록 **실제 파일 줄 번호**를 쓴다.
- 유효 입력: 리포트 텍스트에는 줄 번호가 없으므로 그대로 완전 일치 비교한다.
- 오류 입력: 중간 빈 줄이 있는 fixture는 §5.3 판정에서 **줄 번호 비교를 제외**하고 (둘 다 거부 + 컬럼 일치)만 본다.

CI 실측 확인 (Python 4번째 줄 / JS 5번째 줄, PR #13): `error_middle_blank_line.csv`의 5번째 줄 `reach = -5`.

**③ 부호 붙은 숫자 (`"+5"`, `"-0"`)**
pandas는 숫자 칸의 앞 부호(`+`, `-`)를 읽고 정수로 바꾼다. 그래서 Python `_is_count`는 원문이 아니라 변환된 값을 본다.
`"+5"`는 `5`, `"-0"`은 `0`이 되어 `isdigit()`을 통과한다.

CI 실측 (PR #13, `jsonly_sign_prefix.csv`: 3번째 줄 `likes = +5`, 4번째 줄 `comments = -0`):
- Python: 거부하지 않는다 (종료코드 0, 리포트 출력)
- JS: 거부한다 (3번째 줄 `likes = "+5"` 안내)

JS는 거부를 유지한다. 개수 칸에 부호를 쓰는 것은 입력 실수일 가능성이 높고, `-0`을 받으면 "음수 거부" 안내와 어긋난다.
이 fixture는 "JS 전용 거부"로 등록해 Python과 비교하지 않는다.

**④ 빈 topic·type 및 pandas NA 문자열 (`NA`, `N/A`, `null`, `nan` 등)**
빈 topic·type 및 pandas NA 문자열(NA, N/A, null, nan 등) — Python은 nan으로 출력하거나 주제별 집계에서 빠질 수 있음. 미실측. 처리 방식은 W3 이후 결정.
잠정 처리, 정식 결정 대기(§5.4 ④): 오류로 막지 않고 입력 그대로 계산·출력하며, 화면(`docs/app.js`)에서만 topic이 빈칸·공백뿐이면 `(미분류)`로 표시를 바꾼다 (계산값 불변).

## 6. 데이터 보호를 기술적으로 강제하는 방법

`docs/index.html` `<head>`에 CSP를 넣는다.

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
               connect-src 'none'; img-src 'self' data:; font-src 'none';
               form-action 'none'; base-uri 'none'">
```

- `connect-src 'none'`: `fetch`·`XMLHttpRequest`·WebSocket이 전부 차단된다. 코드에 실수로 네트워크 호출이 들어가도 브라우저가 막는다.
- `script-src 'self'`: 외부 CDN·인라인 스크립트 실행 불가. 그래서 화면 동작은 `app.js`로 분리한다.
- 저장소 API 금지는 CSP로 막을 수 없으므로 CI에서 `docs/*.js`를 검사한다:
  `localStorage|sessionStorage|indexedDB|document.cookie|fetch(|XMLHttpRequest|http://|https://` 가 나오면 실패.
- `<form>`을 쓰지 않는다 (제출 동작 자체를 없앰).

[확인 필요] 카카오톡 인앱 브라우저에서 링크를 열었을 때 파일 선택·클립보드 복사가 제한될 수 있다. 실제 기기로 확인 후 "외부 브라우저로 열기" 안내 문구 필요 여부를 정한다.

## 7. 화면 구성 (모바일 우선)

```
[제목] 아벤투라 인스타 주간 리포트
[안내] 입력한 데이터는 이 브라우저 밖으로 전송되지 않습니다.
[입력]  (탭) 붙여넣기 | 파일 선택
        [헤더 복사] [예시 데이터 불러오기]
        <textarea>
        [리포트 만들기]
[오류]  n번째 줄 · reach · "-5" …        (있을 때만)
[결과]  리포트 텍스트 (white-space: pre-wrap, 16px 이상)
        [리포트 텍스트 복사]
```

- 결과는 Python과 같은 텍스트를 그대로 보여준다. 구획별 카드로 다시 그리지 않는다 → 화면과 복사 결과가 항상 같고, 비교 대상이 하나로 줄어든다.
- `━` 구분선(33자)은 360px에서 줄바꿈될 수 있으므로 `pre-wrap` + `overflow-wrap:anywhere`로 가로 스크롤을 막는다. 복사 텍스트는 바꾸지 않는다.
- 예시 데이터는 `report.js` 안에 문자열 상수로 넣고, CI에서 `sample_data/instagram_posts.csv`와 같은지 비교한다.

## 8. CI 변경

기존 스텝은 그대로 두고 아래를 추가한다 (결정 D2에 따라 "데모 페이지 최신 여부" 스텝만 제거).

1. `actions/setup-node@v4` (Node 22, npm 설치 없음)
2. `bash web/compare.sh` — 유효 fixture: 텍스트 완전 일치 / 오류 fixture: §5.3 기준
3. `TZ=America/Los_Angeles bash web/compare.sh` — 시간대 의존 검사 (필수, 위험 ②)
4. 예시 데이터 동기화 검사
5. §6 금지 API 검사
6. `pytest -v` → 17 passed 유지 (기존 스텝)

## 9. steering 수정 (W1에서 적용)

현재 steering과 충돌하는 곳이 한 줄이 아니라 **세 곳**이다.

| 위치 | 현재 | 제안 |
|---|---|---|
| 만들지 않는 것 | `Streamlit / 웹 대시보드 (텍스트 리포트만)` | `서버·Streamlit 웹 대시보드. 웹 UI는 브라우저 내 계산 방식(docs/)만 허용하며, 출력은 텍스트 리포트와 동일해야 한다` |
| 규칙 1 구조 유지 | 폴더 목록에 `docs/`, `web/` 없음 + "새 폴더 만들지 않는다". 이미 있는 `render_html.py`, `docs/`, `tests/test_edge_cases.py`도 빠져 있음 | 목록을 실제 저장소 파일 기준으로 맞추고(`render_html.py`, `tests/test_edge_cases.py` 추가), `docs/ 웹버전 화면·계산(report.js)`, `web/ Node 비교 검증 전용` 두 줄 추가 |
| 규칙 7 데모 페이지 | `docs/index.html`은 sample_data 데모 전용 | `docs/index.html`은 브라우저 내 계산 도구. 저장소에는 가상 데이터(예시·fixture)만 커밋한다 |

## 10. 롤백

웹버전은 `docs/`, `web/`, CI 스텝 추가뿐이고 Python 코드는 그대로다.
문제가 생기면 해당 PR revert로 끝난다. 팀원은 그 사이 기존 방식(개발자가 대신 실행)으로 돌아간다.
