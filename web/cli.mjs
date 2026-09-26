/*
 * 웹버전 계산(docs/report.js)을 터미널에서 실행한다. python main.py 대응.
 *
 * 실행: node web/cli.mjs <CSV 경로>
 *       node web/cli.mjs --rows <CSV 경로>   검증을 통과한 행을 JSON으로 출력 (형식별 읽기 결과 비교용)
 *
 * main.py 와 같은 규약:
 *   - 정상: 표준출력에 결과, 종료코드 0
 *   - 입력 오류: 표준오류에 "[입력 데이터 오류] 경로" + 안내문, 종료코드 1
 * 규약을 맞춰야 web/compare.sh 가 두 프로그램을 같은 방식으로 실행해 비교할 수 있다.
 *
 * 외부 npm 패키지 없이 Node 내장 모듈만 쓴다 (requirements R5.4).
 */
import { readFileSync } from "node:fs";
// report.js 는 브라우저와 같이 쓰는 CommonJS 파일이다. Node 는 이걸 default import 로 불러올 수 있다.
import WeeklyReport from "../docs/report.js";

const DEFAULT_CSV = "sample_data/instagram_posts.csv";
const USAGE = `사용법: node web/cli.mjs <CSV 경로>\n예시:   node web/cli.mjs ${DEFAULT_CSV}`;

function main(argv) {
  const args = argv.slice(2);
  const showRows = args[0] === "--rows";
  const path = (showRows ? args[1] : args[0]) || DEFAULT_CSV;

  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (e) {
    if (e.code === "ENOENT") {
      console.error(`[오류] CSV 파일을 찾을 수 없습니다: ${path}\n\n${USAGE}`);
      return 1;
    }
    throw e;
  }

  // fatal: true — UTF-8이 아닌 파일을 깨진 글자(�)로 조용히 바꿔 읽지 않고 거부한다.
  // (엑셀 한글 기본 저장인 EUC-KR 보완은 브라우저 파일 선택과 함께 W4에서 다룬다, requirements R1.8)
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    console.error(
      `[입력 데이터 오류] ${path}\nUTF-8로 읽을 수 없는 파일입니다. 엑셀에서 "CSV UTF-8(쉼표로 분리)"로 다시 저장해 주세요.`
    );
    return 1;
  }

  const result = WeeklyReport.run(text);
  if (!result.ok) {
    console.error(`[입력 데이터 오류] ${path}\n${result.message}`);
    return 1;
  }

  if (showRows) {
    console.log(JSON.stringify(result.rows, null, 2));
  } else if (result.report === null) {
    console.log(`검증 통과: ${result.rows.length}건. 리포트 텍스트 생성은 아직 구현 전입니다 (W3).`);
  } else {
    console.log(result.report);
  }
  return 0;
}

process.exitCode = main(process.argv);
