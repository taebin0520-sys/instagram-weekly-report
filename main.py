"""실행: python main.py sample_data/instagram_posts.csv"""
import sys

from src.data_loader import load_posts
from src.report import build_weekly_report

DEFAULT_CSV = "sample_data/instagram_posts.csv"
USAGE = (
    "사용법: python main.py <CSV 경로>\n"
    f"예시:   python main.py {DEFAULT_CSV}"
)


def main(argv) -> int:
    """CSV를 읽어 주간 리포트를 출력한다. 종료 코드를 반환한다.

    입력 데이터 문제는 '사용자가 CSV를 고쳐야 하는 일'이다.
    스택 트레이스는 어디를 고쳐야 하는지 알려주지 못하므로,
    파이썬 예외를 그대로 노출하지 않고 한국어 안내로 바꿔서 보여준다.
    """
    path = argv[1] if len(argv) > 1 else DEFAULT_CSV

    try:
        df = load_posts(path)
    except FileNotFoundError:
        print(f"[오류] CSV 파일을 찾을 수 없습니다: {path}\n\n{USAGE}", file=sys.stderr)
        return 1
    except ValueError as e:
        # load_posts 가 '몇 번째 줄 / 어떤 컬럼 / 어떤 값'을 담아 던진다.
        print(f"[입력 데이터 오류] {path}\n{e}", file=sys.stderr)
        return 1

    print(build_weekly_report(df))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
