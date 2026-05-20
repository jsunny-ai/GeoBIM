"""타일 프록시 라우터.

GET /api/v1/tiles/vworld/{layer}/{z}/{x}/{y}
    → V-World WMTS 타일 프록시 (API 키 서버사이드 보호)

GET /api/v1/tiles/terrain/{z}/{x}/{y}
    → AWS Terrain Tiles (Terrarium RGB 인코딩, 무료)
"""

import httpx
from fastapi import APIRouter, HTTPException, Path
from fastapi.responses import Response

from app.core.config import settings

router = APIRouter()

_VWORLD_LAYERS = frozenset({"Satellite", "Hybrid", "Base", "gray", "midnight"})
_TILE_EXT: dict[str, str] = {
    "Satellite": "jpeg",
    "Hybrid":    "png",
    "Base":      "png",
    "gray":      "png",
    "midnight":  "png",
}

# AWS Terrain Tiles — Terrarium 인코딩, API 키 불필요
_TERRAIN_BASE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium"


@router.get("/vworld/{layer}/{z}/{x}/{y}", name="vworld_tile")
async def vworld_tile(
    layer: str = Path(..., description="V-World 레이어 (Satellite|Hybrid|Base|gray|midnight)"),
    z: int = Path(..., ge=0, le=20),
    x: int = Path(..., ge=0),
    y: int = Path(..., ge=0),
) -> Response:
    """V-World WMTS 타일 프록시.

    클라이언트는 API 키를 절대 볼 수 없음 — 서버에서만 환경변수 참조.
    캐시: 브라우저 24h / CDN 1h / stale-while-revalidate 7d.
    """
    if layer not in _VWORLD_LAYERS:
        raise HTTPException(status_code=400, detail=f"Invalid layer '{layer}'. Allowed: {sorted(_VWORLD_LAYERS)}")

    api_key = getattr(settings, "vworld_api_key", None)
    if not api_key:
        raise HTTPException(status_code=500, detail="VWORLD_API_KEY 가 설정되지 않았습니다.")

    base = getattr(settings, "vworld_api_base", "https://api.vworld.kr")
    ext = _TILE_EXT[layer]
    url = f"{base}/req/wmts/1.0.0/{api_key}/{layer}/{z}/{y}/{x}.{ext}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            r = await client.get(url, headers={"User-Agent": "GeoBIM-Stratum/0.1"})
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="V-World 응답 시간 초과")
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"V-World 요청 오류: {e}")

    if not r.is_success:
        raise HTTPException(
            status_code=502,
            detail=f"V-World upstream HTTP {r.status_code}",
        )

    content_type = r.headers.get("content-type", "image/png")

    # V-World가 줌 레벨 0~5 등에서 200 OK와 함께 XML 에러 문서를 반환하는 경우 차단
    # (브라우저가 이미지로 디코딩하다 InvalidStateError 발생 방지)
    if "xml" in content_type.lower() or r.content[:5] == b"<?xml":
        raise HTTPException(status_code=404, detail="Tile not available (V-World returned XML error)")

    return Response(
        content=r.content,
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=86400, s-maxage=3600, stale-while-revalidate=604800",
            "X-Tile-Source": "V-World",
        },
    )


@router.get("/terrain/{z}/{x}/{y}", name="terrain_tile")
async def terrain_tile(
    z: int = Path(..., ge=0, le=14),
    x: int = Path(..., ge=0),
    y: int = Path(..., ge=0),
) -> Response:
    """AWS Terrain Tiles 프록시 (Terrarium RGB 인코딩).

    표고(m) = R*256 + G + B/256 - 32768
    zoom 0~14, 해상도 256px 타일.
    """
    url = f"{_TERRAIN_BASE}/{z}/{x}/{y}.png"

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            r = await client.get(url, headers={"User-Agent": "GeoBIM-Stratum/0.1"})
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="지형 타일 응답 시간 초과")
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"지형 타일 요청 오류: {e}")

    if not r.is_success:
        raise HTTPException(
            status_code=502,
            detail=f"Terrain upstream HTTP {r.status_code}",
        )

    return Response(
        content=r.content,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=604800",
            "X-Tile-Source": "AWS-Terrain",
            "Access-Control-Allow-Origin": "*",
        },
    )
