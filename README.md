# 아벤투라 인스타 주간 리포트 (브랜드 강화 기준)

※ sample_data의 수치는 모두 가상 데이터이며, 실제 운영 성과가 아닙니다.

인스타그램 게시물 성과를 CSV로 기록하면 자동으로 주간 리포트를 만들어주는 도구.
카드뉴스는 판매용이 아니라 협동조합 브랜드 홍보용이라는 전제로, "문의·신청"이
아니라 "저장·공유·참여율"을 핵심 지표로 본다.

## 실행 방법
```bash
pip install -r requirements.txt
python main.py sample_data/instagram_posts.csv
```

테스트 실행:
```bash
pytest
```

> Python 3.11 이상이 필요하다 (pandas 3.0 요구사항).
> 버전은 `requirements.txt`에 고정되어 있다.

## 폴더 구조
```
src/data_loader.py   CSV 로드 및 검증
src/kpi.py            참여율/저장률/전주대비 계산 (0 나누기 방지)
src/report.py         주간 리포트 텍스트 생성
main.py               실행 진입점
tests/test_kpi.py     계산 로직 테스트
sample_data/          샘플 데이터
```

## 매주 하는 일
1. `sample_data/instagram_posts.csv`에 이번 주 게시물 한 줄씩 추가
2. `python main.py sample_data/instagram_posts.csv` 실행
3. 나온 리포트 아래 "다음 주 액션" 칸을 직접 채움

## 핵심 지표
- 저장률 = 저장 / 도달 (브랜드 각인 핵심 지표)
- 참여율 = (좋아요+댓글+저장+공유) / 도달
- 문의·신청은 참고 지표 (스터디모집 게시물에서만 의미 있음)

도달이 0이거나 지난주 데이터가 없으면 0%로 표시하지 않고
"확인 불가"로 표시한다 (숫자 왜곡 방지).

## 하지 않는 것
- Instagram API 자동 수집 (입력은 수기)
- 대시보드 화면(Streamlit) — 텍스트 리포트만
- 목표 수치 자동 생성 — 항상 실제 입력값 기반

## 알려진 한계
- 주제별 평균 저장률은 한 주에 주제별 게시물이 1건이면 "평균"이 그 게시물 값과 같다. 여러 주가 누적돼야 의미가 생긴다.
