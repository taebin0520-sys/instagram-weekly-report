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
 * W2 범위: 입력 파싱·검증까지. 리포트 텍스트(buildWeeklyReport)는 W3에서 채운다.
 * 검증 규칙의 원본은 src/data_loader.py 의 load_posts 다.
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

  /**
   * 주간 리포트 텍스트 생성 (Python build_weekly_report 대응).
   * W3에서 구현한다. 지금은 "아직 없음"을 뜻하는 null 을 돌려준다.
   */
  function buildWeeklyReport(rows) {
    return null;
  }

  /**
   * 파싱 → 검증 → 리포트. (Python main 대응)
   *
   * 반환: { ok: true, rows, report }          report 는 W3 전까지 null
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
    buildWeeklyReport: buildWeeklyReport,
    run: run,
  };

  // 브라우저에는 module 이 없고 Node 에는 있다. 이 차이로 어느 쪽에서 실행 중인지 구분한다 (design §2).
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.WeeklyReport = api;
})();
