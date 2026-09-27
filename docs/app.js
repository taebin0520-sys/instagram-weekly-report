/*
 * 인스타 주간 리포트 — 화면 동작 (docs/index.html 전용)
 *
 * 계산은 하지 않는다. 계산은 전부 report.js(WeeklyReport)가 한다 — python main.py 와 같은 결과를 내는 곳이 한 곳뿐이어야
 * 화면 결과와 CI 비교 결과가 같다고 말할 수 있기 때문이다.
 *
 * 이 파일이 하는 일:
 *   1) 파일 읽기 (UTF-8)
 *   2) WeeklyReport.run 호출
 *   3) 결과 표시(잠정: 빈 topic → "(미분류)") · 오류 표시 · 복사
 *
 * 입력 데이터를 어디에도 보내지 않고 저장하지 않는다 (requirements R4).
 * 위쪽의 순수 함수들은 Node 에서도 불러와 확인할 수 있게 내보낸다 (web/compare.sh).
 */
(function () {
  "use strict";

  const inNode = typeof module !== "undefined" && module.exports;
  const WeeklyReport = inNode ? require("./report.js") : globalThis.WeeklyReport;

  /**
   * 파일 바이트 → 글자.
   *
   * UTF-8 로 읽는다. fatal: true 라서 UTF-8 이 아니면 깨진 글자(�)로 읽지 않고 실패한다.
   * 실패하면 오류로 알린다 — 틀린 글자로 조용히 계산하지 않는다.
   */
  function decodeBytes(bytes) {
    try {
      return { ok: true, encoding: "UTF-8", text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
    } catch (e) {
      return {
        ok: false,
        message: "파일을 UTF-8 로 읽을 수 없습니다.\n" +
          "엑셀에서 \"CSV UTF-8(쉼표로 분리)\"로 다시 저장해 주세요.",
      };
    }
  }

  /**
   * [잠정 처리, 정식 결정 대기 — design §5.4 ④, requirements R3.5]
   * topic 이 빈칸·공백뿐인 게시물을 리포트 텍스트에서 "(미분류)"로 보여 준다.
   *
   * 계산은 바꾸지 않는다. report.js 가 만든 텍스트에서 그 게시물의 줄 머리만 글자 그대로 찾아 바꾼다.
   *   TOP/하위:  "- 카드뉴스· (2026-10-07) — 저장률" → "- 카드뉴스·(미분류) (2026-10-07) — 저장률"
   *   주제별:    "- : 저장률"                        → "- (미분류): 저장률"
   * 정규식으로 넓게 찾지 않고 행 데이터로 정확한 줄 머리를 만들어 비교한다 — 다른 줄을 잘못 바꾸지 않기 위해.
   * 빈 topic 이 없으면 텍스트를 한 글자도 바꾸지 않는다 (python main.py 결과와 그대로 같음).
   */
  const UNCLASSIFIED = "(미분류)";

  function labelUnclassified(reportText, rows) {
    const blank = rows.filter((r) => r.topic.trim() === "");
    if (blank.length === 0) return reportText;

    const postPrefixes = blank.map((r) => ({
      from: "- " + r.type + "·" + r.topic + " (" + r.date + ") — 저장률 ",
      to: "- " + r.type + "·" + UNCLASSIFIED + " (" + r.date + ") — 저장률 ",
    }));
    const topicPrefixes = Array.from(new Set(blank.map((r) => r.topic))).map((t) => ({
      from: "- " + t + ": 저장률 ",
      to: "- " + UNCLASSIFIED + ": 저장률 ",
    }));

    let section = "";
    return reportText.split("\n").map((line) => {
      if (line.startsWith("[")) {
        section = line;
        return line;
      }
      const table = section.startsWith("[TOP") || section.startsWith("[하위") ? postPrefixes
        : section.startsWith("[주제별") ? topicPrefixes : [];
      const hit = table.find((p) => line.startsWith(p.from));
      return hit ? hit.to + line.slice(hit.from.length) : line;
    }).join("\n");
  }

  /** 입력 글자 → 화면에 보일 결과. 계산은 WeeklyReport.run 이 전부 한다. */
  function makeReport(text) {
    const result = WeeklyReport.run(text);
    if (!result.ok) return result;
    return { ok: true, rows: result.rows, report: labelUnclassified(result.report, result.rows) };
  }

  const api = { decodeBytes: decodeBytes, labelUnclassified: labelUnclassified, makeReport: makeReport };
  if (inNode) {
    module.exports = api;
    return; // Node 에는 화면이 없다
  }

  // ────────────────────────────────────────────────────────────
  // 화면 연결 (브라우저에서만)
  // 결과·오류는 textContent 로만 넣는다. innerHTML 을 쓰면 CSV 칸에 적힌 글자가
  // HTML 로 해석될 수 있기 때문이다.
  // ────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const fileInput = $("file");
  const input = $("input");
  const reportEl = $("report");
  const copyStatus = $("copy-status");

  function showError(title, message) {
    $("result").hidden = true;
    $("error-title").textContent = title;
    $("error-text").textContent = message;
    $("error").hidden = false;
  }

  function render(text) {
    copyStatus.textContent = "";
    if (text.trim() === "") {
      showError("입력이 비어 있습니다", "CSV 파일을 고르거나 표를 붙여넣어 주세요.");
      return;
    }
    const out = makeReport(text);
    if (!out.ok) {
      // report.js 안내문에 "N번째 줄 / 컬럼 / 값"이 들어 있다 (requirements R1.7).
      showError(
        "리포트를 만들지 않았습니다 — 아래 줄을 고친 뒤 다시 시도해 주세요",
        out.message + "\n\n※ 줄 번호는 첫 줄(제목 줄)을 1번째 줄로 셉니다."
      );
      return;
    }
    $("error").hidden = true;
    reportEl.textContent = out.report;
    $("result").hidden = false;
  }

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const decoded = decodeBytes(new Uint8Array(await file.arrayBuffer()));
    fileInput.value = ""; // 같은 파일을 고쳐서 다시 골라도 다시 읽히도록
    if (!decoded.ok) {
      $("file-status").textContent = "";
      showError("파일을 읽지 못했습니다", decoded.message);
      return;
    }
    $("file-status").textContent = file.name + " 을(를) 읽었습니다 (" + decoded.encoding + ").";
    input.value = decoded.text;
    render(decoded.text);
  });

  $("run").addEventListener("click", () => {
    $("file-status").textContent = "";
    render(input.value);
  });

  // 복사: 클립보드 API → 안 되면 결과를 전체 선택해 복사 명령 → 그것도 안 되면 직접 복사 안내 (requirements R3.4)
  $("copy").addEventListener("click", async () => {
    const text = reportEl.textContent;
    try {
      await navigator.clipboard.writeText(text);
      copyStatus.textContent = "복사했습니다. 카카오톡·노션에 붙여넣으세요.";
      return;
    } catch (e) {
      // 권한이 막힌 브라우저(일부 인앱 브라우저 등) → 아래 방법으로
    }
    const range = document.createRange();
    range.selectNodeContents(reportEl);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (e) {
      copied = false;
    }
    copyStatus.textContent = copied
      ? "복사했습니다. 카카오톡·노션에 붙여넣으세요."
      : "자동 복사가 막혀 있습니다. 결과가 선택되어 있으니 길게 누르거나 Ctrl+C 로 복사해 주세요.";
  });
})();
