"""PDF 추출 서비스 — Phase 2 에서 구현.

책임:
- backend/pdf_convert/ 의 PDF_Convert 엔진 래핑
- 자동 추출 (4-Stage 하이브리드 파이프라인) 호출
- 박스 기반 추출 (fitz.Page.get_text("text", clip=Rect(...)))
- 추출 결과 후처리 (PDF_Convert 정규화 함수 통과)
"""

from __future__ import annotations


class PdfService:
    """PDF 추출 서비스.

    TODO(Phase 2):
        - PDF_Convert 의 core/parsers 를 import 하여 자동 추출 실행
        - 박스 좌표를 fitz.Rect 로 변환해 영역 텍스트 추출
        - 손상 유니코드 키워드 매핑 (PDF_Convert 의 기존 로직 재사용)
    """

    async def extract_with_template(
        self,
        pdf_path: str,
        box_definitions: dict,
    ) -> dict:
        """템플릿 박스 정의를 적용해 PDF 에서 텍스트 영역 추출.

        Args:
            pdf_path: PDF 파일 절대 경로
            box_definitions: {"boxes": [{"label", "page", "rect"}, ...]}

        Returns:
            {label: extracted_text, ...} 형식의 dict
        """
        raise NotImplementedError("Phase 2 에서 구현")

    async def auto_extract(self, pdf_path: str) -> dict:
        """PDF_Convert 자동 파이프라인 실행.

        TODO(Phase 2): PDF_Convert 의 진입점 함수 호출.
        """
        raise NotImplementedError("Phase 2 에서 구현")
