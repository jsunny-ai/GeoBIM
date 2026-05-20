"""좌표계 변환 서비스 — Phase 2 에서 구현.

책임:
- 원본 좌표계(EPSG:5174~5187 한국 중부원점 시리즈) → WGS84(EPSG:4326) 변환
- PDF_Convert 의 좌표계 자동 판별 로직 재사용 (또는 pyproj 직접 사용)
"""

from __future__ import annotations


class CoordinateService:
    """좌표계 변환.

    TODO(Phase 2):
        - pyproj.Transformer 캐싱
        - PDF_Convert 의 자동 판별 결과를 신뢰할지, 본 모듈에서 재검증할지 결정
    """

    def to_wgs84(self, x: float, y: float, source_epsg: str) -> tuple[float, float]:
        """원본 좌표를 WGS84 (lon, lat) 로 변환."""
        raise NotImplementedError("Phase 2 에서 구현")

    def detect_crs(self, x: float, y: float) -> str | None:
        """좌표값으로부터 한국 좌표계 자동 판별."""
        raise NotImplementedError("Phase 2 에서 구현")
