# =============================================================================
# export.py — LandXML / Civil 3D 내보내기 API
# POST /api/v1/export/landxml
# =============================================================================

import json
from datetime import date, datetime

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import cast, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from geoalchemy2 import Geometry

from app.api.deps import get_db
from app.api.v1.boreholes import _borehole_dict
from app.api.v1.rbf import RBFInterpolationRequest
from app.models import Borehole
from app.services.landxml_export import grid_to_landxml
from app.services.phantom_points import generate_phantom_points
from app.services.rbf_interpolation import GeologicalRBF, merge_nearby_boreholes

router = APIRouter()

AVAILABLE_LAYERS = [
    "ground_surface",
    "soil",
    "weathered_rock",
    "soft_rock",
    "normal_rock",
    "hard_rock",
]


class LandXMLExportRequest(BaseModel):
    bbox: list[float]                          # [min_lng, min_lat, max_lng, max_lat]
    project_id: int | None = None
    grid_res: int = 48
    boreholes: list[dict] | None = None        # None → DB에서 조회
    borehole_ids: list[int] | None = None
    layers: list[str] = ["weathered_rock", "soft_rock", "normal_rock", "hard_rock"]
    mode: str = "merge"                        # "merge" | "new_only"


@router.post("/landxml")
async def export_landxml(
    body: LandXMLExportRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    RBF 보간 결과를 Civil 3D 호환 LandXML 1.2 TIN Surface 파일로 내보냅니다.

    - mode="merge"    : DB 기존 시추공 + body.boreholes 신규 시추공 합산 보간
    - mode="new_only" : body.boreholes 신규 시추공만으로 독립 보간
    """
    if len(body.bbox) != 4:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="bbox는 [min_lng, min_lat, max_lng, max_lat] 형식이어야 합니다.")

    min_lng, min_lat, max_lng, max_lat = body.bbox

    # ── 1. 시추공 데이터 준비 ──────────────────────────────────────────────────
    if body.mode == "new_only" and body.boreholes:
        # 신규 데이터만 사용
        all_bhs = body.boreholes
    else:
        # DB에서 기존 시추공 조회
        stmt = select(Borehole).options(selectinload(Borehole.strata)).where(
            Borehole.deleted_at.is_(None)
        )
        if body.project_id is not None:
            stmt = stmt.where(Borehole.project_id == body.project_id)
        if body.borehole_ids:
            stmt = stmt.where(Borehole.id.in_(body.borehole_ids))
        rows = (await db.execute(stmt)).scalars().all()

        loc_stmt = select(
            Borehole.id,
            cast(Borehole.location, Geometry).ST_AsGeoJSON().label("loc_json"),
        ).where(Borehole.id.in_([r.id for r in rows]))
        loc_map = {row.id: row.loc_json for row in (await db.execute(loc_stmt)).all()}

        db_bhs: list[dict] = []
        for b in rows:
            loc_json = loc_map.get(b.id)
            if not loc_json:
                continue
            coords = json.loads(loc_json)["coordinates"]
            lng, lat = coords[0], coords[1]
            if min_lng <= lng <= max_lng and min_lat <= lat <= max_lat:
                db_bhs.append(_borehole_dict(b, loc_json, include_strata=True))

        # 신규 시추공이 있으면 merge 모드로 합산
        extra_bhs = body.boreholes or []
        all_bhs = db_bhs + extra_bhs

    if not all_bhs:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail="보간에 사용할 시추공 데이터가 없습니다.")

    # ── 2. RBF 보간 ──────────────────────────────────────────────────────────
    # 근접/중복 시추공(같은 부지 다중 로그·재시추)을 먼저 병합한다.
    # 좌표가 cm 단위로 겹친 채 보간에 들어가면 RBF 행렬이 특이해져
    # 격자 Z가 전역 발산하므로, 팬텀 생성·보간 이전에 반드시 수행한다.
    all_bhs = merge_nearby_boreholes(all_bhs, threshold_m=2.0)

    phantom_bhs = generate_phantom_points(all_bhs, scale=1.8, count=12)
    rbf_engine = GeologicalRBF(all_bhs, phantom_bhs)
    grid_result = rbf_engine.build_grid(body.bbox, res=body.grid_res)

    # ── 3. LandXML 생성 ──────────────────────────────────────────────────────
    valid_layers = [l for l in body.layers if l in AVAILABLE_LAYERS]
    xml_content = grid_to_landxml(
        bbox=body.bbox,
        grids=grid_result["grids"],
        layers=valid_layers,
        date_str=date.today().isoformat(),
        time_str=datetime.now().strftime("%H:%M:%S"),
    )

    filename = f"geobim_stratum_{date.today().strftime('%Y%m%d')}.xml"

    return Response(
        content=xml_content.encode("utf-8"),
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
