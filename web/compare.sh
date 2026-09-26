#!/usr/bin/env bash
# 웹버전(Node)과 Python 버전에 같은 fixture를 넣어 결과를 비교한다. CI에서 실행한다.
#
# 실행 (저장소 루트에서, pandas 가 설치된 Python 과 Node 22 필요):
#   bash web/compare.sh
#
# 판정 방식 — fixture마다 아래 목록에서 하나를 정해 둔다 (design.md §5.3, §5.4)
#   error        둘 다 거부 + 안내한 컬럼이 같음 + JS가 안내한 줄 ⊆ Python이 안내한 줄
#   error_noline 둘 다 거부 + 안내한 컬럼이 같음. 줄 번호는 비교하지 않음
#                (§5.4 ② 파일 중간 빈 줄: Python 줄 번호가 밀리므로)
#   js_only      JS만 거부하면 통과. Python 결과는 참고로만 출력 (R1.9 날짜 형식은 JS가 더 좁게 받음)
#   same_rows    쉼표·탭·BOM 형식을 JS가 모두 같은 행으로 읽는지
#   report       리포트 텍스트가 python main.py 출력과 완전히 같은지 (requirements §4 "동일")
#
# 시간대 검사: CI 가 이 스크립트를 TZ=America/Los_Angeles, TZ=Asia/Seoul 로 한 번씩 더 돌린다.
#   JS 가 시간대에 기대면 UTC 에서는 맞고 LA 에서만 틀린다 (design §4 위험 ②).
#
# "거부" = 종료코드 1 + 안내문에 "[입력 데이터 오류]" 가 있음.
# 종료코드만 보지 않는 이유: Python 은 예상 못 한 예외로 죽어도 종료코드가 1이라 구분이 안 된다.
set -u
cd "$(dirname "$0")/.."

PYTHON="${PYTHON:-python}"
NODE="${NODE:-node}"
FIXTURES=web/fixtures
failures=0
listed=" "   # 아래에서 판정한 fixture 이름. 목록에 없는 파일이 있으면 마지막에 실패시킨다.

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }
indent() { printf '%s\n' "$1" | sed 's/^/        | /'; }

# 표준오류만 받는다 (표준출력은 버림). 종료코드는 py_code / js_code 에 남긴다.
run_python() { py_err=$("$PYTHON" main.py "$1" 2>&1 >/dev/null); py_code=$?; }
run_node()   { js_err=$("$NODE" web/cli.mjs "$1" 2>&1 >/dev/null); js_code=$?; }

rejected() {  # $1=종료코드 $2=표준오류
  [ "$1" -eq 1 ] && printf '%s' "$2" | grep -qF '[입력 데이터 오류]'
}

# 안내문에서 컬럼 이름을 뽑는다. 두 형식을 모두 읽는다.
#   'reach' 컬럼에 0 이상의 정수가 아닌 값이 있습니다.   → reach
#   필수 컬럼이 없습니다: ['saves']   (Python)            → saves
#   필수 컬럼이 없습니다: 'saves'     (JS)                → saves
columns_in() {
  {
    printf '%s\n' "$1" | grep -oE "'[a-z_]+' 컬럼에" | grep -oE "[a-z_]+"
    printf '%s\n' "$1" | grep '필수 컬럼이 없습니다' | grep -oE "'[a-z_]+'" | tr -d "'"
  } | sort -u | paste -sd, -
}

# 안내문에서 "N번째 줄"의 N만 뽑는다.
lines_in() {
  printf '%s\n' "$1" | grep -oE '[0-9]+번째 줄' | grep -oE '^[0-9]+' | sort -un | paste -sd, -
}

check_error() {  # $1=파일 이름  $2=line(줄 번호 비교) | noline(비교 안 함)
  local name=$1 mode=$2 f="$FIXTURES/$1"
  listed="$listed$name "
  run_python "$f"
  run_node "$f"
  local py_cols js_cols py_lines js_lines info
  py_cols=$(columns_in "$py_err"); js_cols=$(columns_in "$js_err")
  py_lines=$(lines_in "$py_err");  js_lines=$(lines_in "$js_err")
  info="컬럼 Python=[$py_cols] JS=[$js_cols] / 줄 Python=[$py_lines] JS=[$js_lines]"
  [ "$mode" = noline ] && info="$info (줄 번호 비교 제외)"

  local problem=""
  if ! rejected "$py_code" "$py_err"; then
    problem="Python이 거부하지 않음 (종료코드 $py_code)"
  elif ! rejected "$js_code" "$js_err"; then
    problem="JS가 거부하지 않음 (종료코드 $js_code)"
  elif [ -z "$js_cols" ] || [ "$py_cols" != "$js_cols" ]; then
    problem="컬럼 불일치"
  elif [ "$mode" = line ]; then
    if [ -n "$py_lines" ] && [ -z "$js_lines" ]; then
      problem="JS가 줄 번호를 안내하지 않음"
    fi
    local n
    for n in ${js_lines//,/ }; do
      # ,4,5, 안에 ,5, 가 있는지로 포함 여부를 본다 (4 와 14 를 헷갈리지 않도록 쉼표로 감쌈)
      case ",$py_lines," in *",$n,"*) ;; *) problem="JS가 안내한 ${n}번째 줄이 Python 목록에 없음" ;; esac
    done
  fi

  if [ -z "$problem" ]; then pass "$name — $info"; else fail "$name — $problem. $info"; fi
  echo "      Python 안내:"; indent "$py_err"
  echo "      JS 안내:";     indent "$js_err"
}

check_js_only() {  # $1=파일 이름
  local name=$1 f="$FIXTURES/$1"
  listed="$listed$name "
  run_node "$f"
  run_python "$f"
  if rejected "$js_code" "$js_err"; then
    pass "$name — JS 전용 거부 (비교 대상 아님). 참고: Python 종료코드 $py_code"
  else
    fail "$name — JS가 거부해야 하는데 통과함 (종료코드 $js_code)"
  fi
  echo "      JS 안내:"; indent "$js_err"
}

check_same_rows() {  # $@=파일 이름들. 첫 파일의 읽기 결과를 기준으로 비교한다.
  local base="" base_name="" name out code
  for name in "$@"; do
    listed="$listed$name "
    out=$("$NODE" web/cli.mjs --rows "$FIXTURES/$name" 2>&1); code=$?
    if [ "$code" -ne 0 ]; then
      fail "$name — JS가 읽지 못함 (종료코드 $code)"; indent "$out"; continue
    fi
    if [ -z "$base_name" ]; then
      base=$out; base_name=$name
      pass "$name — 기준 ($(printf '%s' "$out" | grep -c '"line"')행)"
    elif [ "$out" = "$base" ]; then
      pass "$name — $base_name 과 같은 행"
    else
      fail "$name — $base_name 과 읽은 행이 다름"; indent "$out"
    fi
  done
}

# fixture 파일이 편집기 저장 등으로 바뀌어 검사 의미가 사라지지 않았는지 확인한다.
check_bytes() {
  [ "$(head -c 3 "$FIXTURES/format_bom.csv" | od -An -tx1 | tr -d ' \n')" = "efbbbf" ] \
    && pass "format_bom.csv — 맨 앞 BOM 있음" || fail "format_bom.csv — 맨 앞에 BOM이 없음"
  grep -q $'\t' "$FIXTURES/format_tab.tsv" && grep -q $'\r' "$FIXTURES/format_tab.tsv" \
    && pass "format_tab.tsv — 탭 구분 + CRLF 줄바꿈" || fail "format_tab.tsv — 탭 또는 CRLF가 없음"
}

# 리포트 텍스트 완전 일치 비교.
# "동일" = 줄바꿈 정규화(\r\n → \n, 끝 개행 정리) 후 문자 단위로 같음 (requirements §4).
# $(...) 는 끝의 줄바꿈을 모두 지우므로 "끝 개행"은 여기서 자연히 맞춰진다.
check_report() {  # $1=파일 이름
  local name=$1 f="$FIXTURES/$1" py_out js_out
  listed="$listed$name "
  py_out=$("$PYTHON" main.py "$f" 2>&1 | tr -d '\r'); py_code=${PIPESTATUS[0]}
  js_out=$("$NODE" web/cli.mjs "$f" 2>&1 | tr -d '\r'); js_code=${PIPESTATUS[0]}

  if [ "$py_code" -ne 0 ] || [ "$js_code" -ne 0 ]; then
    fail "$name — 정상 입력인데 실패함 (Python $py_code / JS $js_code)"
    indent "$py_out"; indent "$js_out"; return
  fi
  if [ "$py_out" != "$js_out" ]; then
    fail "$name — 리포트 텍스트가 다름 (< Python / > JS)"
    if command -v diff >/dev/null; then
      diff <(printf '%s\n' "$py_out") <(printf '%s\n' "$js_out") | sed 's/^/        | /'
    else
      echo "      Python:"; indent "$py_out"; echo "      JS:"; indent "$js_out"
    fi
    return
  fi
  # 계산 불가가 NaN·nan·undefined·null 같은 글자로 새어 나오지 않았는지 (규칙 3)
  local leak
  leak=$(printf '%s\n' "$js_out" | grep -nE 'NaN|nan|undefined|null')
  if [ -n "$leak" ]; then
    fail "$name — 텍스트는 같지만 금지 글자가 있음"; indent "$leak"; return
  fi
  pass "$name — 텍스트 완전 일치 ($(printf '%s\n' "$js_out" | wc -l | tr -d ' ')줄)"
}

# 주제별 평균이 딱 같은 주제끼리의 순서만 비교에서 뺀다 (design §4 위험 ③ 실측, 결정 D4).
# pandas 는 이 순서를 정하지 않는다 — numpy 의 불안정 정렬(SIMD)이 CPU 에 따라 순서를 바꾼다.
# 그래서: 주제별 구획 밖은 완전 일치, 구획 안은 "줄 목록이 같은지"만 본다. 두 순서는 기록용으로 출력한다.
check_report_topic_tie() {  # $1=파일 이름
  local name=$1 f="$FIXTURES/$1" py_out js_out
  listed="$listed$name "
  py_out=$("$PYTHON" main.py "$f" 2>&1 | tr -d '\r'); py_code=${PIPESTATUS[0]}
  js_out=$("$NODE" web/cli.mjs "$f" 2>&1 | tr -d '\r'); js_code=${PIPESTATUS[0]}
  topic_lines() { printf '%s\n' "$1" | awk '/^\[주제별/{s=1;next} s&&/^$/{s=0} s'; }
  other_lines() { printf '%s\n' "$1" | awk '/^\[주제별/{s=1;print;next} s&&/^$/{s=0} !s'; }

  if [ "$py_code" -ne 0 ] || [ "$js_code" -ne 0 ]; then
    fail "$name — 정상 입력인데 실패함 (Python $py_code / JS $js_code)"
  elif [ "$(other_lines "$py_out")" != "$(other_lines "$js_out")" ]; then
    fail "$name — 주제별 구획 밖의 텍스트가 다름"
  elif [ "$(topic_lines "$py_out" | LC_ALL=C sort)" != "$(topic_lines "$js_out" | LC_ALL=C sort)" ]; then
    fail "$name — 주제별 줄 목록(순서 무시)이 다름"
  elif [ "$(topic_lines "$py_out")" = "$(topic_lines "$js_out")" ]; then
    pass "$name — 동률 순서까지 완전 일치"
  else
    pass "$name — 주제별 동률 순서만 다름 (순서 제외 일치, D4)"
  fi
  echo "      Python 주제 순서:"; indent "$(topic_lines "$py_out")"
  echo "      JS 주제 순서 (코드포인트):"; indent "$(topic_lines "$js_out")"
}

# 도달 0 인 주제의 줄이 0.0% 로 위장되지 않고 '확인 불가'로 나오는지 (규칙 3)
check_unavailable() {  # $1=파일 이름  $2=도달 0 게시물만 있는 주제
  local name=$1 topic=$2 lines
  lines=$("$NODE" web/cli.mjs "$FIXTURES/$name" | grep -F -- "$topic")
  if printf '%s\n' "$lines" | grep -qE '(^|[^0-9])0\.0%'; then   # 10.0% 는 걸리지 않게
    fail "$name — '$topic'(도달 0)이 0.0% 로 표시됨"; indent "$lines"
  elif ! printf '%s\n' "$lines" | grep -q '확인 불가'; then
    fail "$name — '$topic'(도달 0)에 '확인 불가'가 없음"; indent "$lines"
  else
    pass "$name — 도달 0 '$topic' → 확인 불가"
  fi
}

# 코드 금지어 (design §4 위험 ②③): 시간대·언어 설정에 따라 결과가 바뀌는 API
check_code() {
  local found
  found=$(grep -nE 'localeCompare|toLocaleString|new Date\(' docs/report.js web/cli.mjs)
  if [ -n "$found" ]; then fail "코드 금지어 발견"; indent "$found"; else pass "코드에 localeCompare / toLocaleString / new Date( 없음"; fi
}

echo "TZ=${TZ:-(설정 없음 = UTC)}"

echo "== 코드 검사 =="
check_code

echo "== 오류 fixture (design §5.3) =="
check_error error_negative.csv        line
check_error error_blank.csv           line
check_error error_decimal.csv         line
check_error error_comma_number.csv    line
check_error error_missing_column.csv  line
check_error error_edge_negative.csv   line
check_error error_edge_blank.csv      line
check_error error_middle_blank_line.csv noline

echo "== JS 전용 거부 (R1.9) =="
check_js_only jsonly_date_format.csv
check_js_only jsonly_sign_prefix.csv

echo "== 형식별 읽기 (쉼표·탭·BOM) =="
check_bytes
check_same_rows format_comma.csv format_tab.tsv format_bom.csv

echo "== 리포트 텍스트 완전 일치 (Python vs JS) =="
# sample_data 복사본이 원본과 달라지면 비교 의미가 사라진다
if [ "$(cat sample_data/instagram_posts.csv)" = "$(cat "$FIXTURES/sample_data_copy.csv")" ]; then
  pass "sample_data_copy.csv — sample_data/instagram_posts.csv 와 같음"
else
  fail "sample_data_copy.csv — sample_data/instagram_posts.csv 와 다름. 다시 복사하세요"
fi
check_report sample_data_copy.csv
check_report format_comma.csv
check_report format_bom.csv
check_report edge_zero_reach.csv
check_report edge_zero_reach_bottom.csv
check_report edge_single_week.csv
check_report edge_sunday_monday.csv
check_report edge_year_end.csv
check_report rounding_tie.csv          # 위험 ① 딱 중간값 반올림
check_report negative_zero_delta.csv   # 위험 ① -0.0 부호
check_report tie_order.csv             # 위험 ③ 같은 저장률·같은 날짜·영문 topic·확인 불가 위치
check_report middle_blank_line.csv     # §5.4 ② 중간 빈 줄 (유효 입력)
check_report same_date_many_rows.csv   # 위험 ③ 행 22개(>16)·같은 날짜 11개 — 날짜 정렬이 파일 순서를 지키는지

echo "== 주제별 평균 동률 (순서 제외 비교, D4) =="
check_report_topic_tie topic_avg_tie.csv   # 위험 ③ 평균이 같은 주제 순서 (Zeta·alpha·ｅ·😀 코드포인트)

echo "== 도달 0 → 확인 불가 =="
check_unavailable edge_zero_reach.csv        제품
check_unavailable edge_zero_reach_bottom.csv 제품
check_unavailable tie_order.csv              휴무안내
check_unavailable topic_avg_tie.csv          휴무안내

echo "== fixture 목록 누락 검사 =="
for f in "$FIXTURES"/*; do
  name=$(basename "$f")
  case "$listed" in
    *" $name "*) ;;
    *) fail "$name — compare.sh 목록에 없음. 판정 방식을 정해 목록에 추가하세요" ;;
  esac
done

echo
if [ "$failures" -gt 0 ]; then
  echo "실패 ${failures}건"
  exit 1
fi
echo "전부 통과"
