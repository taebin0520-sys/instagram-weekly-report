"""데모 페이지 생성: python render_html.py

build_weekly_report() 결과를 HTML 로 감싸 docs/index.html 로 저장한다.
GitHub Pages 가 docs/ 폴더를 그대로 공개한다.

⚠️ 이 페이지는 sample_data(가상 데이터) 전용 데모다.
   실제 조합 데이터로 이 스크립트를 돌려 커밋하지 않는다 — 저장소가 public 이다.
   그래서 입력 경로를 인자로 받지 않고 샘플 경로로 고정해 두었다.

report.py 는 수정하지 않는다. 리포트 문자열을 받아 감싸기만 한다.
"""
import html
from pathlib import Path

SAMPLE_CSV = "sample_data/instagram_posts.csv"
OUTPUT = Path("docs/index.html")
REPO_URL = "https://github.com/taebin0520-sys/instagram-weekly-report"


def render(report_text: str) -> str:
    """리포트 텍스트를 데모 HTML 페이지로 감싼다. (pandas 불필요한 순수 함수)

    html.escape 를 쓰는 이유: topic 등에 < > & 가 들어가도 페이지가 깨지지 않게.
    생성 시각을 넣지 않는 이유: 같은 입력이면 항상 같은 HTML 이 나와야
    CI 에서 '커밋된 페이지가 최신인지' 비교할 수 있다.
    """
    return f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>아벤투라 인스타 주간 리포트 — 데모</title>
<style>
  body {{ font-family: -apple-system, "Malgun Gothic", sans-serif;
         max-width: 760px; margin: 2rem auto; padding: 0 1rem; color: #222; }}
  .demo {{ background: #fff1e6; border: 2px solid #e8590c; border-radius: 8px;
           padding: 1rem 1.25rem; margin-bottom: 1.5rem; }}
  .badge {{ display: inline-block; background: #e8590c; color: #fff;
            font-weight: 700; padding: .2rem .7rem; border-radius: 999px;
            font-size: .9rem; }}
  .demo p {{ margin: .6rem 0 0; font-weight: 700; color: #a33a00; }}
  pre {{ background: #f7f7f7; padding: 1rem; overflow-x: auto;
         line-height: 1.55; font-size: .95rem; }}
  footer {{ color: #777; font-size: .85rem; margin-top: 1.5rem; }}
</style>
</head>
<body>
<div class="demo">
  <span class="badge">데모 · 가상 데이터</span>
  <p>이 수치는 샘플 데이터이며 실제 운영 성과가 아닙니다.</p>
</div>
<pre>{html.escape(report_text)}</pre>
<footer>입력: {SAMPLE_CSV} · <a href="{REPO_URL}">소스 코드</a></footer>
</body>
</html>
"""


if __name__ == "__main__":
    from src.data_loader import load_posts
    from src.report import build_weekly_report

    report = build_weekly_report(load_posts(SAMPLE_CSV))
    OUTPUT.parent.mkdir(exist_ok=True)
    OUTPUT.write_text(render(report), encoding="utf-8")
    print(f"저장: {OUTPUT}")
