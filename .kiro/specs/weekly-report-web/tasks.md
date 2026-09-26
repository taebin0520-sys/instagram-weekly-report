# Tasks — 인스타 주간 리포트 웹버전 (weekly-report-web)

대응 문서: `requirements.md`, `design.md`
**기준 baseline**: `17 passed` (tests/test_kpi.py 10 + tests/test_edge_cases.py 7), `main` = `15878d0`

## 공통 규칙 (모든 Task)

- Task 1개 = 브랜치 1개 = PR 1개. 끝나면 멈추고 검토를 받는다.
- `src/`, `main.py`, `tests/`는 수정하지 않는다. `pytest -v` → **17 passed** 유지를 PR 본문에 첨부한다.
- 외부 npm 패키지를 설치하지 않는다 (Node 22 내장 모듈만).
- fixture·예시 데이터는 **가상 데이터만** 커밋한다. 실제 조합 데이터 금지.
- 구현 중 Python과 다른 출력이 나오면 JS를 Python에 맞춘다. Python을 고치지 않는다. Python 쪽 문제로 보이면 Issue로만 남긴다.

## 진행 순서

```
W0 스펙(#11 완료) → W1 steering·결정 반영 → W2 입력·검증 → W3 계산·리포트 → W4 화면 → W5 보호 점검·QA
```

W2·W3는 화면 없이 Node로만 검증한다. 계산이 Python과 일치하기 전에 화면을 만들지 않는다.

---

### W0. 스펙 작성 — 완료 (#11)

- 산출물: `.kiro/specs/weekly-report-web/requirements.md`, `design.md`, `tasks.md`
- 완료 기준
  - [x] 위험 지점 3가지가 실측 근거와 함께 design.md §4에 있다
  - [x] 결정 필요 D1~D3이 requirements.md §7에 있다
  - [x] 코드 변경 0줄

### W1. steering 수정 + 결정 사항 반영

- 선행: W0 머지, D1~D3 확정
- 범위: `.kiro/steering/aventura-instagram-report.md` 3곳 수정 (design.md §9), 확정된 D1~D3을 requirements.md §7에 "확정"으로 표기
- 완료 기준
  - [ ] steering에 "웹 UI는 브라우저 내 계산(docs/)만 허용, 서버·Streamlit 금지"가 명시된다
  - [ ] 규칙 1 폴더 목록에 `docs/`, `web/`가 추가된다
  - [ ] 코드 변경 0줄, pytest 17 passed

### W2. 입력 파싱·검증 + Node CLI + 오류 비교

- 선행: W1
- 범위
  - `docs/report.js`: `parseTable`, `isCount`, `validateRows`, `run`(검증까지만, 리포트는 자리만)
  - `web/cli.mjs`: `node web/cli.mjs <CSV>` — 오류 시 stderr + 종료코드 1 (main.py와 같은 규약)
  - `web/fixtures/`: 오류 케이스 — 음수, 빈칸, 소수, `"1,000"`, 필수 컬럼 누락, 날짜 형식 오류(`2026/9/29`, JS 전용 거부),
    중간 빈 줄 + 숫자 오류가 있는 fixture (줄 번호 비교 제외, 거부 여부만 비교)
  - `web/compare.sh`: 오류 fixture 비교 (design.md §5.3 기준)
  - CI: setup-node + compare.sh 스텝 추가
- 완료 기준
  - [ ] 오류 fixture 전부: Python·Node 둘 다 거부, JS가 안내한 (줄, 컬럼) ⊆ Python이 안내한 (줄, 컬럼)
  - [ ] 오류 메시지에 줄 번호·컬럼·값이 한국어로 들어간다 (줄 번호는 헤더=1번째 줄 기준)
  - [ ] 탭 구분·쉼표 구분·BOM 있는 입력을 모두 같은 행으로 읽는다
  - [ ] 날짜 형식 오류 fixture는 "JS 전용 거부"로 표시되고 비교 대상에서 빠진다
  - [ ] CI 초록, pytest 17 passed

### W3. 계산·리포트 텍스트 + 정답지 비교

- 선행: W2
- 범위
  - `docs/report.js`: 주 분리, KPI, 전주 대비, TOP/하위, 주제별, 포맷 함수, `buildWeeklyReport`
  - `web/fixtures/`: `sample_data` 복사본 + 기존 엣지 케이스 7종을 CSV로 옮긴 것 + 위험 지점 전용 3종
    (`rounding_tie.csv`, `negative_zero_delta.csv`, `tie_order.csv`)
    + 중간 빈 줄 케이스 `middle_blank_line.csv` (파일 중간에 빈 줄이 있는 유효 입력, design.md §5.4 ②)
  - `web/compare.sh`: 유효 fixture 텍스트 완전 일치 비교 추가
  - CI: `TZ=America/Los_Angeles`로 compare.sh 한 번 더
- 완료 기준
  - [ ] 유효 fixture 전부 `node web/cli.mjs` 출력 == `python main.py` 출력 (줄바꿈 정규화 후 완전 일치)
  - [ ] `rounding_tie.csv`에서 12.25% → `12.2%` (Python과 같음)
  - [ ] 도달 0·지난주 없음 케이스에 `NaN`, `nan%`, `0.0%`(위장), `undefined`, `null` 문자열이 출력에 없다
  - [ ] UTC·Asia/Seoul·America/Los_Angeles 세 시간대에서 결과가 같다
  - [ ] 코드에 `localeCompare`, `toLocaleString`, `new Date(`가 없다 (design.md 위험 ②③)
  - [ ] CI 초록, pytest 17 passed

### W4. 화면 (docs/index.html + docs/app.js)

- 선행: W3
- 범위
  - 붙여넣기 / 파일 선택, 헤더 복사, 예시 데이터 불러오기, 리포트 만들기, 결과 표시, 리포트 텍스트 복사
  - 데이터 미전송 안내 문구, CSP meta (design.md §6)
  - D2 확정안 적용: `render_html.py`와 CI "데모 페이지 최신 여부" 스텝 제거(권장안 기준)
  - CI: 예시 데이터 == `sample_data/instagram_posts.csv` 검사
- 완료 기준
  - [ ] "예시 데이터 불러오기 → 리포트 만들기 → 복사" 결과가 `python main.py sample_data/instagram_posts.csv` 출력과 같다 (수동 확인 1회, PR에 첨부)
  - [ ] 오류 입력 시 결과 영역 대신 줄·컬럼·값 안내가 보인다
  - [ ] 360px 폭에서 가로 스크롤 없음, 본문 16px 이상 (스크린샷 첨부)
  - [ ] 새로고침하면 입력·결과가 모두 사라진다
  - [ ] CI 초록, pytest 17 passed

### W5. 데이터 보호 점검 + README + 실기기 QA

- 선행: W4
- 범위
  - CI: `docs/*.js` 금지 API 검사 (design.md §6 목록)
  - README: "팀원용 사용법"(링크 → 붙여넣기 → 복사) 3단계, 알려진 차이(날짜 형식, EUC-KR, 빈칸 오류 안내)
  - Python 빈칸 오류 목록 현상 Issue 등록 (D3)
  - 실기기 QA 체크리스트 기록
- 완료 기준
  - [ ] 개발자도구 Network 탭에서 페이지 로드 후 `docs/` 파일 외 요청 0건 (스크린샷)
  - [ ] 금지 API 검사가 CI에서 돈다 (일부러 `fetch(` 넣은 커밋에서 실패하는 것 확인 후 되돌림)
  - [ ] PC Chrome, PC Edge, iPhone Safari, Android Chrome, 카카오톡 인앱 브라우저 5곳에서 붙여넣기·복사 결과 기록 [확인 필요: 인앱 브라우저 제한]
  - [ ] 팀원 1명이 설명 없이 README만 보고 리포트를 만들어 카톡에 붙여넣는다 (결과만 기록, 이름 등 개인정보 기록하지 않음)
  - [ ] pytest 17 passed

---

## 이번 범위에서 하지 않는 것

Instagram API 수집, 로그인·서버·DB, 차트, 여러 주 누적, 헤더 한글화, Python 동작 수정.
