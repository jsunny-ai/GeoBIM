"""PDF 박스 추출 라우터 — Phase 2 에서 구현.

핵심 차별 기능: 사용자가 PDF 위에서 박스를 그려 정보 위치를 지정 → 템플릿화.

예정 엔드포인트:
- POST /upload                : PDF 파일 업로드 → job 생성
- GET  /jobs/{id}             : 추출 job 상태 조회
- POST /jobs/{id}/auto-match  : 첫 페이지 키워드 기반 템플릿 자동 매칭
- POST /jobs/{id}/extract     : 템플릿 적용 추출 실행 (Celery 태스크)
- GET  /jobs/{id}/preview     : 추출 결과 미리보기
- POST /jobs/{id}/approve     : 미리보기 승인 → DB 반영
"""

from fastapi import APIRouter

router = APIRouter()
