/*
 * 인스타 주간 리포트 — 계산 파일 (브라우저·Node 공용)
 *
 * 브라우저: <script src="report.js"> 뒤에 window.WeeklyReport 로 쓴다 (W4).
 * Node:     web/cli.mjs 가 이 파일을 불러와 python main.py 와 같은 규약으로 실행한다.
 *
 * 이 파일은 "문자열 입력 → 결과 객체"만 한다.
 * 화면(DOM)·네트워크·브라우저 저장소 API를 쓰지 않는다 (requirements R4, design §6).
 * (주석에도 그 API 이름을 쓰지 않는다 — CI 금지어 검사가 주석까지 검사하기 때문이다.)
 *
 * 원본(Python)과 1:1 대응:
 *   입력 검증     src/data_loader.py  load_posts          (W2)
 *   주 분리       src/data_loader.py  split_by_week, week_bounds
 *   지표 계산     src/kpi.py          save_rate, engagement_rate, week_over_week, diff_pp, topic_summary
 *   리포트 텍스트 src/report.py       _fmt_*, build_weekly_report
 * 출력은 python main.py 와 한 글자도 다르지 않아야 한다 (web/compare.sh 가 CI에서 확인).
 */
(function () {
  "use strict";
  // 파일 전체를 함수로 감싼 이유: 브라우저에서 <script>로 불러오면
  // 최상위 함수가 전부 전역 변수가 된다. 감싸 두면 WeeklyReport 하나만 밖에 보인다.

  // src/data_loader.py 와 같은 이름·같은 순서.
  // 순서가 중요하다 — 숫자 오류는 이 순서대로 검사해서 처음 걸린 컬럼 하나만 안내한다 (Python과 동일).
  const REQUIRED_COLUMNS = [
    "date", "type", "topic", "reach", "likes", "comments",
    "saves", "shares", "profile_visits", "dm_inquiries", "signups",
  ];
  const NUMERIC_COLUMNS = [
    "reach", "likes", "comments", "saves", "shares",
    "profile_visits", "dm_inquiries", "signups",
  ];

  /**
   * 붙여넣은 표(탭 구분)나 CSV 텍스트를 헤더 + 행 목록으로 나눈다. (pd.read_csv 대응)
   *
   * 반환: { ok: true, header: [...], rows: [{ line, values: [...] }] }
   *       { ok: false, errors: [...] }
   *
   * - line 은 실제 파일 줄 번호다 (헤더가 1번째 줄). 사용자가 파일에서 그 줄을 찾아 고칠 수 있어야 한다.
   *   pandas 는 빈 줄을 건너뛰고 번호를 세서 빈 줄 뒤에서 번호가 밀린다 — JS는 따라 하지 않는다 (design §5.4 ②).
   * - 완전히 빈 줄은 행으로 읽지 않는다 (pandas skip_blank_lines 와 같음).
   * - 따옴표로 감싼 칸("1,000")은 쉼표가 있어도 한 칸이다. 값은 그대로 두고 검증에서 거부한다.
   */
  function parseTable(text) {
    let s = String(text);
    // 엑셀 "CSV UTF-8" 저장 파일은 맨 앞에 BOM(보이지 않는 표시 문자)이 붙는다.
    // 지우지 않으면 첫 컬럼 이름이 "\uFEFFdate" 가 되어 date 컬럼이 없다고 나온다.
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    // 윈도우 엑셀은 줄 끝이 \r\n 이다. 한 가지(\n)로 통일해야 아래 로직이 단순해진다.
    s = s.replace(/\r\n?/g, "\n");

    // 첫 번째 비어 있지 않은 줄에 탭이 있으면 엑셀 붙여넣기(TSV), 아니면 CSV (design §5.1)
    const firstLine = s.split("\n").find((l) => l !== "") || "";
    const delimiter = firstLine.includes("\t") ? "\t" : ",";

    // 한 글자씩 읽는다. split(",")을 쓰지 않는 이유: "1,000" 처럼 따옴표 안의 쉼표를 구분자로 잘라 버린다.
    const records = [];
    let fields = [];
    let field = "";
    let inQuotes = false; // 지금 따옴표 안을 읽는 중인가
    let recordHadQuote = false; // 이 행에 따옴표가 있었나 ("" 한 칸짜리 행을 빈 줄로 오해하지 않기 위해)
    let line = 1; // 지금 읽는 글자가 있는 줄
    let recordLine = 1; // 지금 행이 시작된 줄 (오류 안내에 쓰는 번호)

    function endRecord() {
      fields.push(field);
      const isBlankLine = fields.length === 1 && fields[0] === "" && !recordHadQuote;
      if (!isBlankLine) records.push({ line: recordLine, fields: fields });
      fields = [];
      field = "";
      recordHadQuote = false;
    }

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inQuotes) {
        if (ch === '"' && s[i + 1] === '"') {
          field += '"'; // 따옴표 안의 "" 는 따옴표 글자 하나
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          if (ch === "\n") line++; // 칸 안의 줄바꿈도 파일 줄 수에는 들어간다
          field += ch;
        }
      } else if (ch === '"' && field === "") {
        inQuotes = true; // 칸의 첫 글자가 따옴표일 때만 따옴표 칸으로 본다
        recordHadQuote = true;
      } else if (ch === delimiter) {
        fields.push(field);
        field = "";
      } else if (ch === "\n") {
        endRecord();
        line++;
        recordLine = line;
      } else {
        field += ch;
      }
    }
    if (inQuotes) {
      return { ok: false, errors: [{ kind: "unclosed_quote", line: recordLine }] };
    }
    endRecord(); // 마지막 줄 끝에 줄바꿈이 없는 경우. 있으면 빈 줄로 처리되어 버려진다.

    if (records.length === 0) {
      return { ok: false, errors: [{ kind: "empty" }] };
    }

    const header = records[0].fields;
    const rows = records.slice(1).map((r) => ({ line: r.line, values: r.fields }));

    // 칸이 헤더보다 많으면 어느 값이 어느 컬럼인지 알 수 없다. pandas 도 이 경우 읽기를 거부한다.
    const tooWide = rows.find((r) => r.values.length > header.length);
    if (tooWide) {
      return {
        ok: false,
        errors: [{
          kind: "too_many_fields",
          line: tooWide.line,
          count: tooWide.values.length,
          expected: header.length,
        }],
      };
    }
    return { ok: true, delimiter: delimiter, header: header, rows: rows };
  }

  /**
   * 0 이상의 정수인지 검사한다. (Python _is_count 대응)
   *
   * Python 은 str(value).strip().isdigit() 이다. 같은 결과를 내도록 앞뒤 공백을 지우고
   * 숫자 문자로만 되어 있는지 본다. "-5", "1.5", "", "1,000" 은 모두 거부된다.
   * 단, [0-9] 는 ASCII 숫자만 허용한다. Python isdigit 은 전각 숫자(１)·위첨자(²)도 받지만
   * JS는 거부한다 (design §5.4 ①, requirements R1.7).
   */
  function isCount(value) {
    return /^[0-9]+$/.test(String(value).trim());
  }

  /**
   * YYYY-MM-DD 이고 실제로 있는 날짜인지 검사한다. (requirements R1.9)
   *
   * Date 객체를 쓰지 않는다. Date 는 기기 시간대에 따라 날짜가 하루 밀릴 수 있다 (design §4 위험 ②).
   * 연·월·일을 정수로 떼어 달력 규칙(윤년 포함)으로만 확인한다.
   */
  function isIsoDate(value) {
    const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
    if (!m) return false;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1) return false;
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= daysInMonth[month - 1];
  }

  /**
   * 필수 컬럼·숫자·날짜를 검증한다. (Python load_posts 대응)
   *
   * 반환: { ok: true, rows: [{ line, date, type, ..., signups }] }
   *       { ok: false, errors: [...] }
   *
   * 검사 순서는 Python 과 같다: 필수 컬럼 → 숫자 컬럼(NUMERIC_COLUMNS 순서) → 날짜.
   * 처음 걸린 문제 하나만 돌려준다 (errors 는 design §3 형식을 따라 배열이지만 지금은 항상 1개).
   *
   * Python 과 다른 점 (design §5.3, 결정 D3):
   *   Python 은 숫자 컬럼에 빈칸이 하나라도 있으면 그 컬럼의 정상 값까지 100.0 으로 바뀌어 오류로 나열된다.
   *   JS 는 입력된 글자 그대로 검사하므로 실제로 잘못된 줄만 안내한다.
   *
   * 누락값을 0으로 채우지 않는다. 빈칸은 오류다 (steering 규칙 5).
   */
  function validateRows(table) {
    // 컬럼 이름 → 몇 번째 칸인지. 순서가 달라도 되고 추가 컬럼은 무시한다 (requirements R1.3).
    // 같은 이름이 두 번 있으면 앞의 것을 쓴다 (pandas 도 앞의 것을 원래 이름으로 둔다).
    // 일반 객체({}) 대신 Map 을 쓰는 이유: 컬럼 이름이 "constructor" 같은 값이어도 오동작하지 않는다.
    const colIndex = new Map();
    table.header.forEach((name, i) => {
      if (!colIndex.has(name)) colIndex.set(name, i);
    });

    const missing = REQUIRED_COLUMNS.filter((c) => !colIndex.has(c));
    if (missing.length > 0) {
      return { ok: false, errors: [{ kind: "missing_columns", columns: missing }] };
    }

    // 칸이 모자란 행은 뒤쪽 값이 없다. undefined 대신 빈칸("")으로 보고 검증에서 걸러지게 한다.
    function get(row, col) {
      const v = row.values[colIndex.get(col)];
      return v === undefined ? "" : v;
    }

    for (const col of NUMERIC_COLUMNS) {
      const bad = table.rows
        .filter((r) => !isCount(get(r, col)))
        .map((r) => ({ line: r.line, date: get(r, "date"), value: get(r, col) }));
      if (bad.length > 0) {
        return { ok: false, errors: [{ kind: "invalid_count", column: col, items: bad }] };
      }
    }

    const badDates = table.rows
      .filter((r) => !isIsoDate(get(r, "date")))
      .map((r) => ({ line: r.line, value: get(r, "date") }));
    if (badDates.length > 0) {
      return { ok: false, errors: [{ kind: "invalid_date", column: "date", items: badDates }] };
    }

    const rows = table.rows.map((r) => {
      const row = { line: r.line };
      for (const col of REQUIRED_COLUMNS) {
        const v = get(r, col);
        // 숫자 컬럼은 isCount 를 통과했으므로 Number 변환이 안전하다.
        // topic 같은 문자열은 앞뒤 공백을 지우지 않는다 — Python 도 "스터디모집 " 을 스터디모집으로 세지 않는다 (design §5.1).
        row[col] = NUMERIC_COLUMNS.includes(col) ? Number(v.trim()) : v;
      }
      return row;
    });
    return { ok: true, rows: rows };
  }

  // 오류 안내에 값을 보여줄 때 빈칸이 안 보이는 문제를 막는다.
  function showValue(v) {
    return v === "" ? "(빈칸)" : '"' + v + '"';
  }

  /**
   * 오류 목록을 한국어 안내문으로 바꾼다.
   *
   * 형식은 Python 안내문과 맞춘다: "'컬럼' 컬럼에 …", "N번째 줄 (date=…)".
   * web/compare.sh 가 두 안내문에서 같은 방식으로 줄 번호·컬럼을 뽑아 비교하기 때문이다.
   */
  function formatErrors(errors) {
    return errors.map((e) => {
      switch (e.kind) {
        case "empty":
          return "데이터가 비어 있습니다. 첫 줄에 헤더(" + REQUIRED_COLUMNS.join(", ") + ")를 넣어 주세요.";
        case "unclosed_quote":
          return e.line + "번째 줄에서 시작한 따옴표(\")가 닫히지 않았습니다.";
        case "too_many_fields":
          return e.line + "번째 줄의 칸 수(" + e.count + "칸)가 헤더 칸 수(" + e.expected + "칸)보다 많습니다.";
        case "missing_columns":
          return (
            "필수 컬럼이 없습니다: " + e.columns.map((c) => "'" + c + "'").join(", ") + "\n" +
            "  첫 줄(헤더)에 위 이름의 칸이 있는지 확인해 주세요. 이름은 영문 소문자 그대로 써야 합니다."
          );
        case "invalid_count":
          return (
            "'" + e.column + "' 컬럼에 0 이상의 정수가 아닌 값이 있습니다.\n" +
            e.items
              .map((it) => "  - " + it.line + "번째 줄 (date=" + it.date + "): " + e.column + " = " + showValue(it.value))
              .join("\n") + "\n" +
            "  도달·좋아요·저장 같은 값은 음수가 될 수 없습니다. 빈칸이면 0을 직접 입력해 주세요."
          );
        case "invalid_date":
          return (
            "'date' 컬럼에 YYYY-MM-DD 형식이 아닌 날짜가 있습니다.\n" +
            e.items.map((it) => "  - " + it.line + "번째 줄: date = " + showValue(it.value)).join("\n") + "\n" +
            "  엑셀에서 날짜 셀 형식을 yyyy-mm-dd로 바꿔 주세요. (예: 2026-09-29)"
          );
        default:
          return "알 수 없는 입력 오류입니다.";
      }
    }).join("\n");
  }

  // ────────────────────────────────────────────────────────────
  // 날짜 → 주 (design §4 위험 ②)
  //
  // 날짜를 Date 객체로 다루지 않는다. Date 는 기기 시간대에 따라 요일이 하루 밀린다
  // (LA 시간대에서 2026-09-29 가 월요일로 나옴). 대신 날짜를 "1년 1월 1일부터 몇 번째 날"인
  // 정수(서수)로 바꾸고, 요일·주 계산을 전부 정수 덧셈·나눗셈으로 한다.
  // Python date.toordinal() 과 같은 번호다 (0001-01-01 = 1).
  // ────────────────────────────────────────────────────────────

  function isLeapYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }
  function daysInYear(y) {
    return isLeapYear(y) ? 366 : 365;
  }
  function daysInMonth(y, m) {
    return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }

  // 연·월·일 → 서수. 앞 해들의 날 수 + 올해 앞 달들의 날 수 + 일.
  // 반복문이 최대 수천 번이지만 게시물 수십 건에는 충분히 빠르고, 공식보다 읽기 쉽다.
  function toOrdinal(y, m, d) {
    let n = 0;
    for (let yy = 1; yy < y; yy++) n += daysInYear(yy);
    for (let mm = 1; mm < m; mm++) n += daysInMonth(y, mm);
    return n + d;
  }

  // "YYYY-MM-DD" → 서수. 형식은 validateRows 에서 이미 확인했다.
  function ordinalOfDate(dateStr) {
    return toOrdinal(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)), Number(dateStr.slice(8, 10)));
  }

  // 서수 → { year, month, day }. toOrdinal 의 반대.
  function fromOrdinal(n) {
    let rest = n - 1; // 1년 1월 1일에서 지난 날 수
    let y = 1;
    while (rest >= daysInYear(y)) {
      rest -= daysInYear(y);
      y++;
    }
    let m = 1;
    while (rest >= daysInMonth(y, m)) {
      rest -= daysInMonth(y, m);
      m++;
    }
    return { year: y, month: m, day: rest + 1 };
  }

  function pad(n, width) {
    return String(n).padStart(width, "0");
  }

  // 서수 → "YYYY-MM-DD" (Python str(date) 와 같은 모양)
  function formatOrdinal(n) {
    const d = fromOrdinal(n);
    return pad(d.year, 4) + "-" + pad(d.month, 2) + "-" + pad(d.day, 2);
  }

  // 월=0 … 일=6 (Python date.weekday() 와 같음). 0001-01-01 이 월요일이라 (n - 1) % 7 이다.
  function weekday(n) {
    return (n - 1) % 7;
  }

  /**
   * ISO 연도·주 → "2026-W41". (Python strftime("%G-W%V") 대응)
   *
   * ISO 규칙: 주는 월요일에 시작하고, "그 주의 목요일이 속한 해"가 그 주의 연도다.
   * 그래서 2027-01-03(일)은 목요일이 2026-12-31 이므로 2026-W53 이다.
   * 주 번호는 그 해 1월 1일부터 목요일까지 며칠 지났는지를 7로 나눠 구한다.
   */
  function isoWeekKey(n) {
    const thursday = n - weekday(n) + 3;
    const isoYear = fromOrdinal(thursday).year;
    const week = Math.floor((thursday - toOrdinal(isoYear, 1, 1)) / 7) + 1;
    return pad(isoYear, 4) + "-W" + pad(week, 2);
  }

  /** 한 주의 게시물 목록 → [월요일 서수, 일요일 서수]. (Python week_bounds 대응) */
  function weekBounds(weekPosts) {
    const anyDay = weekPosts[0].ordinal;
    const monday = anyDay - weekday(anyDay);
    return [monday, monday + 6];
  }

  /**
   * 이번 주 / 달력상 직전 주로 나눈다. (Python split_by_week 대응)
   *
   * 지난주는 "두 번째로 최신인 주"가 아니라 "이번 주 월요일 − 7일이 속한 주"다.
   * 그 주 데이터가 없으면 null → 리포트에서 '확인 불가'가 된다 (requirements R2.2).
   */
  function splitByWeek(posts) {
    const weeks = Array.from(new Set(posts.map((p) => p.week))).sort(compareCodePoints);
    if (weeks.length === 0) return { latest: null, previous: null };

    const latest = posts.filter((p) => p.week === weeks[weeks.length - 1]);
    const prevKey = isoWeekKey(weekBounds(latest)[0] - 7);
    const previous = weeks.includes(prevKey) ? posts.filter((p) => p.week === prevKey) : null;
    return { latest: latest, previous: previous };
  }

  // ────────────────────────────────────────────────────────────
  // 정렬 (design §4 위험 ③)
  // ────────────────────────────────────────────────────────────

  /**
   * 문자열을 유니코드 코드포인트 순서로 비교한다 (Python 문자열 비교와 같음).
   *
   * 언어별 비교 함수(locale 비교)를 쓰지 않는다 — 언어 설정에 따라 "Zeta"와 "alpha" 순서가 뒤바뀐다.
   * (주석에도 그 함수 이름을 쓰지 않는다 — CI 코드 검사가 주석까지 본다)
   * a < b 도 그대로 쓰지 않는다 — JS 의 < 는 UTF-16 조각 단위 비교라서
   * 이모지(😀 등)가 전각 문자(ｅ 등)보다 앞에 온다. Python 은 반대다.
   * 그래서 한 글자씩 codePointAt 으로 꺼내 비교한다.
   */
  function compareCodePoints(a, b) {
    const ca = Array.from(a); // 이모지도 한 글자로 나뉜다
    const cb = Array.from(b);
    const n = Math.min(ca.length, cb.length);
    for (let i = 0; i < n; i++) {
      const d = ca[i].codePointAt(0) - cb[i].codePointAt(0);
      if (d !== 0) return d < 0 ? -1 : 1;
    }
    return ca.length - cb.length < 0 ? -1 : ca.length > cb.length ? 1 : 0;
  }

  // 숫자 비교. 같으면 0 을 돌려줘야 안정 정렬이 원래 순서를 지킨다.
  function compareNumbers(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  // ────────────────────────────────────────────────────────────
  // 지표 계산 (src/kpi.py 대응)
  //
  // 규칙 3: 계산할 수 없으면 null 만 돌려준다. 0, NaN, 문자열로 바꾸지 않는다.
  // '확인 불가' 글자로 바꾸는 것은 아래 fmt* 함수에서만 한다.
  // ────────────────────────────────────────────────────────────

  /** 저장 / 도달. 도달 0이면 null. 게시물 1건에도, 주 합계에도 쓴다. */
  function saveRate(t) {
    if (t.reach === 0) return null;
    return t.saves / t.reach;
  }

  /** (좋아요+댓글+저장+공유) / 도달. 도달 0이면 null. 더하는 순서도 Python 과 같게 둔다. */
  function engagementRate(t) {
    if (t.reach === 0) return null;
    return (t.likes + t.comments + t.saves + t.shares) / t.reach;
  }

  /** 절대 수치(도달·공유)의 전주 대비 증감률. 지난주 없음·0 이면 null. 리포트에서 '%'. */
  function weekOverWeek(thisValue, lastValue) {
    if (lastValue === null || lastValue === 0) return null;
    return (thisValue - lastValue) / lastValue;
  }

  /** 비율 지표(저장률·참여율)의 전주 대비 차이. 단위 %p. 한쪽이라도 null 이면 null. */
  function diffPp(thisRate, lastRate) {
    if (thisRate === null || lastRate === null) return null;
    return (thisRate - lastRate) * 100;
  }

  /** 한 주의 합계 (Python _totals 대응). 주 단위 비율은 이 합계로 낸다 (R2.5). */
  function totals(weekPosts) {
    const t = { reach: 0, likes: 0, comments: 0, saves: 0, shares: 0 };
    for (const p of weekPosts) {
      t.reach += p.reach;
      t.likes += p.likes;
      t.comments += p.comments;
      t.saves += p.saves;
      t.shares += p.shares;
    }
    return t;
  }

  /**
   * null 을 뺀 평균. 계산할 값이 없으면 null.
   *
   * 단순히 전부 더해 나누지 않고 pandas groupby().mean() 과 같은 "Kahan 보정 합산"을 쓴다.
   * (pandas 3.0.6 _libs/groupby.pyx group_mean 에서 확인)
   * 실수 덧셈은 순서·방식에 따라 마지막 자리가 달라지고, 그 값이 반올림 경계에 걸리면
   * 소수 첫째 자리가 달라질 수 있기 때문이다 (design §4 위험 ①).
   */
  function mean(values) {
    let sum = 0;
    let compensation = 0; // 앞 덧셈에서 잘려 나간 오차
    let count = 0;
    for (const v of values) {
      if (v === null) continue;
      count++;
      const y = v - compensation;
      const t = sum + y;
      compensation = t - sum - y;
      sum = t;
    }
    return count === 0 ? null : sum / count;
  }

  /**
   * 주제별 게시물 수·평균 저장률·평균 참여율. (Python topic_summary 대응)
   *
   * 순서를 Python 과 1:1로 맞춘다:
   *   ① 주제 이름을 코드포인트 순으로 묶는다 (pandas groupby 기본 동작)
   *   ② 평균 저장률 내림차순. 같으면 ①의 순서 유지. 확인 불가(null)는 맨 뒤.
   *      (pandas sort_values 는 NaN 을 내림차순에서도 맨 뒤에 둔다)
   * JS 의 sort 는 안정 정렬이라 비교 결과가 0 이면 원래 순서가 남는다.
   */
  function topicSummary(weekPosts) {
    const groups = new Map();
    for (const p of weekPosts) {
      if (!groups.has(p.topic)) groups.set(p.topic, []);
      groups.get(p.topic).push(p);
    }
    const summary = Array.from(groups.keys())
      .sort(compareCodePoints)
      .map((topic) => {
        const g = groups.get(topic);
        return {
          topic: topic,
          count: g.length,
          avgSaveRate: mean(g.map((p) => p.saveRate)),
          avgEngagementRate: mean(g.map((p) => p.engagementRate)),
        };
      });
    return summary.sort((a, b) => {
      if (a.avgSaveRate === null || b.avgSaveRate === null) {
        return (a.avgSaveRate === null ? 1 : 0) - (b.avgSaveRate === null ? 1 : 0);
      }
      return compareNumbers(b.avgSaveRate, a.avgSaveRate);
    });
  }

  /**
   * 저장률 순위. 저장률 확인 불가(null) 게시물은 TOP 이든 하위든 항상 뒤로 보낸다 (R2.8).
   * Python 은 ["산출 가능 여부", "저장률"] 두 기준으로 정렬한다. 여기도 같은 두 기준이다.
   * null 을 0 으로 바꿔 정렬하면 도달 0 게시물이 '하위 게시물'로 뽑혀 성과가 나빴다고 오독된다.
   */
  function rankBySaveRate(weekPosts, ascending) {
    return weekPosts.slice().sort((a, b) => {
      const aKnown = a.saveRate !== null;
      const bKnown = b.saveRate !== null;
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      if (!aKnown) return 0;
      return ascending ? compareNumbers(a.saveRate, b.saveRate) : compareNumbers(b.saveRate, a.saveRate);
    });
  }

  // ────────────────────────────────────────────────────────────
  // 숫자 표기 (design §4 위험 ①)
  // ────────────────────────────────────────────────────────────

  /**
   * 소수점 1자리 문자열. Python f"{x:.1f}" 와 같은 결과를 낸다.
   *
   * 차이는 "딱 중간값"에서만 난다:
   *   Python f"{12.25:.1f}" → "12.2"  (짝수 쪽으로)
   *   JS     (12.25).toFixed(1) → "12.3"  (큰 쪽으로)
   * 그래서 toFixed(1) 결과를 쓰되, 딱 중간값일 때만 짝수 쪽으로 고친다.
   * 딱 중간값인지는 toFixed(100) 으로 이진수 값을 10진수로 끝까지 펼쳐서
   * 소수 둘째 자리부터가 "5" 다음 전부 "0" 인지로 판단한다 (12.25 → "12.25000…0").
   * 0.15 처럼 이진수로 정확히 못 적는 값은 펼치면 "0.1499999…" 라서 중간값이 아니다 — Python 도 같게 본다.
   *
   * 음수는 크기만 반올림하고 부호를 붙인다. -0.04 는 Python 처럼 "-0.0" 이 된다.
   */
  function fixed1(x) {
    const negative = x < 0 || Object.is(x, -0);
    const a = Math.abs(x);
    let s = a.toFixed(1);
    const expanded = a.toFixed(100);
    const dot = expanded.indexOf(".");
    if (/^50*$/.test(expanded.slice(dot + 2))) {
      const lower = expanded.slice(0, dot + 2); // 12.25 → "12.2" (버림한 쪽)
      if (Number(lower[lower.length - 1]) % 2 === 0) s = lower;
    }
    return (negative ? "-" : "") + s;
  }

  /** Python f"{x:+.1f}": 0 이상이면 "+", 음수(-0.0 포함)면 "-". */
  function signedFixed1(x) {
    const negative = x < 0 || Object.is(x, -0);
    return negative ? fixed1(x) : "+" + fixed1(x);
  }

  /** Python f"{n:,}": 세 자리마다 쉼표. 언어별 숫자 표기 함수는 기기 언어 설정에 따라 결과가 달라서 쓰지 않는다. */
  function fmtInt(n) {
    return String(n).replace(/\B(?=([0-9]{3})+(?![0-9]))/g, ",");
  }

  /** 비율 → "12.2%". 계산 불가(null)면 '확인 불가'. (Python _fmt_pct 대응) */
  function fmtPct(v) {
    if (v === null) return "확인 불가";
    return fixed1(v * 100) + "%";
  }

  /** 절대 수치의 전주 대비 → "(+5.0% 전주 대비)". (Python _fmt_delta_pct 대응) */
  function fmtDeltaPct(v, reason) {
    if (v === null) return reason ? "(확인 불가 — " + reason + ")" : "(확인 불가)";
    return "(" + signedFixed1(v * 100) + "% 전주 대비)";
  }

  /** 비율 지표의 전주 대비 → "(+0.3%p 전주 대비)". diffPp 가 이미 100을 곱했다. (Python _fmt_delta_pp 대응) */
  function fmtDeltaPp(v, reason) {
    if (v === null) return reason ? "(확인 불가 — " + reason + ")" : "(확인 불가)";
    return "(" + signedFixed1(v) + "%p 전주 대비)";
  }

  // 전주 대비를 못 낸 사유. Python _delta_reason 과 똑같이 "지난주가 있느냐"만 본다.
  function deltaReason(previous) {
    return previous === null ? "지난주 데이터 없음" : "지난주 도달 0";
  }

  /**
   * 주간 리포트 텍스트. (Python build_weekly_report 대응)
   *
   * rows 는 validateRows 가 돌려준 행 목록이다.
   * 줄 하나하나가 src/report.py 의 lines.append(...) 와 같은 순서·같은 글자다.
   */
  function buildWeeklyReport(rows) {
    // Python load_posts 는 날짜순으로 정렬한다. JS sort 는 안정 정렬이라 같은 날짜는 파일 순서가 남는다.
    const posts = rows
      .map((r) => {
        const ordinal = ordinalOfDate(r.date);
        return Object.assign({}, r, {
          ordinal: ordinal,
          week: isoWeekKey(ordinal),
          saveRate: saveRate(r),
          engagementRate: engagementRate(r),
        });
      })
      .sort((a, b) => a.ordinal - b.ordinal);

    const split = splitByWeek(posts);
    const latest = split.latest;
    const previous = split.previous;
    if (latest === null) return "데이터가 없습니다.";

    const bounds = weekBounds(latest);
    const thisTotals = totals(latest);
    const prevTotals = previous !== null ? totals(previous) : null;

    // 문의·신청은 스터디모집 게시물만 센다 (R2.6, steering 규칙 4)
    const study = latest.filter((p) => p.topic === "스터디모집");
    const studyInquiries = study.reduce((s, p) => s + p.dm_inquiries, 0);
    const studySignups = study.reduce((s, p) => s + p.signups, 0);

    const weekSaveRate = saveRate(thisTotals);
    const weekEngagementRate = engagementRate(thisTotals);
    const prevSaveRate = prevTotals !== null ? saveRate(prevTotals) : null;
    const prevEngagementRate = prevTotals !== null ? engagementRate(prevTotals) : null;

    const reason = deltaReason(previous);
    const saveRateDelta = diffPp(weekSaveRate, prevSaveRate);
    const engagementDelta = diffPp(weekEngagementRate, prevEngagementRate);
    const sharesDelta = weekOverWeek(thisTotals.shares, prevTotals !== null ? prevTotals.shares : null);
    const reachDelta = weekOverWeek(thisTotals.reach, prevTotals !== null ? prevTotals.reach : null);

    const top = rankBySaveRate(latest, false).slice(0, 2);
    const bottom = rankBySaveRate(latest, true).slice(0, 1);

    const rule = "━".repeat(33);
    const lines = [];
    lines.push(rule);
    lines.push("아벤투라 인스타 주간 리포트 (브랜드 강화 기준)");
    lines.push(formatOrdinal(bounds[0]) + "(월) ~ " + formatOrdinal(bounds[1]) + "(일) (" + latest.length + "건)");
    lines.push(rule);
    lines.push("");
    lines.push("[이번 주 요약]");
    lines.push(
      "- 저장률 " + fmtPct(weekSaveRate) + " " + fmtDeltaPp(saveRateDelta, reason) +
      " — 저장 " + thisTotals.saves + " / 도달 " + fmtInt(thisTotals.reach)
    );
    lines.push("- 참여율 " + fmtPct(weekEngagementRate) + " " + fmtDeltaPp(engagementDelta, reason));
    lines.push("- 공유 " + thisTotals.shares + "건 " + fmtDeltaPct(sharesDelta, reason));
    lines.push("- 총 도달 " + fmtInt(thisTotals.reach) + " " + fmtDeltaPct(reachDelta, reason));
    lines.push("");
    lines.push("[TOP 게시물 - 저장률 기준]");
    for (const p of top) {
      lines.push(
        "- " + p.type + "·" + p.topic + " (" + p.date + ") — 저장률 " + fmtPct(p.saveRate) +
        ", 저장 " + p.saves + "건, 공유 " + p.shares + "건"
      );
    }
    lines.push("");
    lines.push("[하위 게시물 - 저장률 기준]");
    for (const p of bottom) {
      lines.push(
        "- " + p.type + "·" + p.topic + " (" + p.date + ") — 저장률 " + fmtPct(p.saveRate) +
        " (도달 " + fmtInt(p.reach) + "명, 저장 " + p.saves + "건)"
      );
    }
    lines.push("");
    lines.push("[주제별 평균 저장률 — 브랜드 각인 기준]");
    for (const t of topicSummary(latest)) {
      lines.push(
        "- " + t.topic + ": 저장률 " + fmtPct(t.avgSaveRate) + ", 참여율 " + fmtPct(t.avgEngagementRate) +
        " (게시물 " + t.count + "건)"
      );
    }
    lines.push("");
    lines.push("[참고 지표 — 문의 · 신청]");
    lines.push("※ 브랜드 홍보 목적 게시물의 성과는 저장률·참여율로 판단합니다.");
    lines.push("   아래는 스터디모집 게시물에 한해 참고용으로만 확인하며,");
    lines.push("   성과 판단에 사용하지 않습니다.");
    lines.push("- 스터디모집 게시물 " + study.length + "건 — DM 문의 " + studyInquiries + "건 / 신청 " + studySignups + "건");
    lines.push("");
    lines.push("[다음 주 액션] (직접 작성)");
    lines.push("1. ___________________");
    lines.push("2. ___________________");
    lines.push("3. ___________________");
    lines.push(rule);
    return lines.join("\n");
  }

  /**
   * 파싱 → 검증 → 리포트. (Python main 대응)
   *
   * 반환: { ok: true, rows, report }
   *       { ok: false, errors, message }      message 는 한국어 안내문
   */
  function run(text) {
    const table = parseTable(text);
    if (!table.ok) return { ok: false, errors: table.errors, message: formatErrors(table.errors) };

    const checked = validateRows(table);
    if (!checked.ok) return { ok: false, errors: checked.errors, message: formatErrors(checked.errors) };

    return { ok: true, rows: checked.rows, report: buildWeeklyReport(checked.rows) };
  }

  const api = {
    REQUIRED_COLUMNS: REQUIRED_COLUMNS,
    NUMERIC_COLUMNS: NUMERIC_COLUMNS,
    parseTable: parseTable,
    isCount: isCount,
    isIsoDate: isIsoDate,
    validateRows: validateRows,
    formatErrors: formatErrors,
    ordinalOfDate: ordinalOfDate,
    formatOrdinal: formatOrdinal,
    weekday: weekday,
    isoWeekKey: isoWeekKey,
    compareCodePoints: compareCodePoints,
    saveRate: saveRate,
    engagementRate: engagementRate,
    weekOverWeek: weekOverWeek,
    diffPp: diffPp,
    mean: mean,
    fixed1: fixed1,
    signedFixed1: signedFixed1,
    fmtInt: fmtInt,
    fmtPct: fmtPct,
    buildWeeklyReport: buildWeeklyReport,
    run: run,
  };

  // 브라우저에는 module 이 없고 Node 에는 있다. 이 차이로 어느 쪽에서 실행 중인지 구분한다 (design §2).
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.WeeklyReport = api;
})();
