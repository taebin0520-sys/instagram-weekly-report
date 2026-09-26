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

# 정상 입력은 두 프로그램 모두 받아야 한다. (탭 파일은 붙여넣기 전용이라 Python 대상 아님)
check_valid() {  # $1=경로
  run_python "$1"; run_node "$1"
  if [ "$py_code" -eq 0 ] && [ "$js_code" -eq 0 ]; then
    pass "$1 — 정상 입력, 둘 다 통과"
  else
    fail "$1 — 정상 입력인데 거부됨 (Python $py_code / JS $js_code)"
    indent "$py_err"; indent "$js_err"
  fi
}

echo "== 오류 fixture (design §5.3) =="
check_error error_negative.csv        line
check_error error_blank.csv           line
check_error error_decimal.csv         line
check_error error_comma_number.csv    line
check_error error_missing_column.csv  line
check_error error_middle_blank_line.csv noline

echo "== JS 전용 거부 (R1.9) =="
check_js_only jsonly_date_format.csv
check_js_only jsonly_sign_prefix.csv

echo "== 형식별 읽기 (쉼표·탭·BOM) =="
check_bytes
check_same_rows format_comma.csv format_tab.tsv format_bom.csv

echo "== 정상 입력 =="
check_valid sample_data/instagram_posts.csv
check_valid "$FIXTURES/format_comma.csv"
check_valid "$FIXTURES/format_bom.csv"

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
