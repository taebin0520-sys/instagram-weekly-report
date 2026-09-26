"""실행: python main.py sample_data/instagram_posts.csv"""
import sys
from src.data_loader import load_posts
from src.report import build_weekly_report

if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "sample_data/instagram_posts.csv"
    df = load_posts(path)
    print(build_weekly_report(df))
