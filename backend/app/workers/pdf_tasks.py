"""Celery 앱 정의 + PDF 처리 태스크 스텁.

실행 방법 (Phase 2 이후):
    uv run celery -A app.workers worker --loglevel=info --pool=solo
        # Windows 에서는 --pool=solo (prefork 불가)
"""

from __future__ import annotations

from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "geobim",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery_app.conf.update(
    task_track_started=True,
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Seoul",
    enable_utc=True,
)


@celery_app.task(name="pdf.extract_with_template")
def extract_with_template_task(job_id: int) -> dict:
    """박스 템플릿으로 PDF 추출.

    TODO(Phase 2):
        - DB 에서 job 조회
        - PdfService.extract_with_template 호출
        - 결과를 job.result 에 저장하고 status 갱신
    """
    raise NotImplementedError("Phase 2 에서 구현")


@celery_app.task(name="pdf.auto_extract")
def auto_extract_task(job_id: int) -> dict:
    """PDF_Convert 자동 파이프라인 실행.

    TODO(Phase 2): PdfService.auto_extract 호출.
    """
    raise NotImplementedError("Phase 2 에서 구현")
