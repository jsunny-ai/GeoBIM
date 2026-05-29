"""시추공 라우터.

- GET  /              : 시추공 목록 (페이지네이션 + 지층 선택 포함)
- GET  /{id}          : 시추공 상세 + 지층 목록
- PATCH /{id}         : 좌표/표고 수정
- PUT  /{id}/strata   : 지층 전체 교체
- POST /by-area       : 폴리곤 내 시추공 목록 (ST_Contains)

응답 형식 (GET /) — BoreholeApiResponse 와 정합:
  {
    "boreholes": [...],
    "count": 42,
    "total": 42,
    "limit": 10000,
    "offset": 0
  }
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2 import Geometry
from pydantic import BaseModel
from sqlalchemy import cast, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user, get_db
from app.models import Borehole, Stratum, User
from app.services.normalization import normalize_strata_group

router = APIRouter()


# ---------------------------------------------------------------------------
# 내부 헬퍼
# ---------------------------------------------------------------------------

def _loc_to_lng_lat(loc_json: str | None) -> tuple[float, float]:
    """ST_AsGeoJSON 결과 → (longitude, latitude)."""
    if not loc_json:
        return 0.0, 0.0
    coords = json.loads(loc_json)["coordinates"]
    return coords[0], coords[1]


def _borehole_dict(b: Borehole, loc_json: str | None, *, include_strata: bool = False) -> dict:
    """Borehole ORM → 직렬화 가능한 dict."""
    lng, lat = _loc_to_lng_lat(loc_json)
    data: dict = {
        "id": b.id,
        "project_id": b.project_id,
        "name": b.name,
        "longitude": lng,
        "latitude": lat,
        "elevation": b.elevation,
        "source_crs": b.source_crs,
        "source_file": b.source_file,
        "created_at": b.created_at.isoformat(),
    }
    if include_strata and hasattr(b, "strata"):
        data["strata"] = sorted(
            [_stratum_dict(s) for s in b.strata],
            key=lambda x: x["depth_top"],
        )
    return data


def _stratum_dict(s: Stratum) -> dict:
    """Stratum ORM → dict (정규화 그룹 포함)."""
    return {
        "id": s.id,
        "borehole_id": s.borehole_id,
        "depth_top": s.depth_top,
        "depth_bottom": s.depth_bottom,
        "soil_type": s.soil_type,
        "strata_group": normalize_strata_group(s.soil_type),  # 정규화 그룹 추가
        "raw_text": s.raw_text,
        "n_value": s.n_value,
        "uscs_code": s.uscs_code,
    }


# ---------------------------------------------------------------------------
# GET / — 시추공 목록
# ---------------------------------------------------------------------------

@router.get("/")
async def list_boreholes(
    project_id: int | None = None,
    include_strata: bool = Query(False, description="True 시 각 시추공에 strata 배열 포함"),
    limit: int = Query(10000, ge=1, le=50000, description="최대 반환 건수"),
    offset: int = Query(0, ge=0, description="건너뛸 건수"),
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> dict:
    """시추공 목록. BoreholeApiResponse 형식으로 반환.

    - project_id: 필터링 (없으면 전체)
    - include_strata: True 면 각 시추공에 strata 배열 포함 (3D 뷰어용)
    - limit / offset: 페이지네이션
    """
    base_stmt = select(
        Borehole,
        func.ST_AsGeoJSON(Borehole.location).label("loc_json"),
    ).where(Borehole.deleted_at.is_(None))

    if project_id is not None:
        base_stmt = base_stmt.where(Borehole.project_id == project_id)

    # 전체 건수 (페이지네이션 UI용)
    count_stmt = select(func.count()).select_from(
        base_stmt.subquery()
    )
    total: int = (await db.execute(count_stmt)).scalar_one()

    # 실제 데이터 조회
    data_stmt = base_stmt.limit(limit).offset(offset)

    if include_strata:
        # strata selectinload: Borehole 쿼리를 먼저 수행 후 in-배치 로드
        borehole_ids_stmt = (
            select(Borehole.id)
            .where(Borehole.deleted_at.is_(None))
        )
        if project_id is not None:
            borehole_ids_stmt = borehole_ids_stmt.where(Borehole.project_id == project_id)
        borehole_ids_stmt = borehole_ids_stmt.limit(limit).offset(offset)

        orm_stmt = (
            select(Borehole)
            .options(selectinload(Borehole.strata))
            .where(
                Borehole.id.in_(borehole_ids_stmt),
                Borehole.deleted_at.is_(None),
            )
        )
        boreholes_orm = (await db.execute(orm_stmt)).scalars().all()

        # 위경도 일괄 조회
        loc_stmt = select(
            Borehole.id,
            func.ST_AsGeoJSON(Borehole.location).label("loc_json"),
        ).where(Borehole.id.in_([b.id for b in boreholes_orm]))
        loc_map: dict[int, str] = {
            row.id: row.loc_json
            for row in (await db.execute(loc_stmt)).all()
        }

        boreholes_list = [
            _borehole_dict(b, loc_map.get(b.id), include_strata=True)
            for b in boreholes_orm
        ]
    else:
        rows = (await db.execute(data_stmt)).all()
        boreholes_list = [_borehole_dict(b, loc) for b, loc in rows]

    return {
        "boreholes": boreholes_list,
        "count": len(boreholes_list),
        "total": total,
        "limit": limit,
        "offset": offset,
    }


# ---------------------------------------------------------------------------
# GET /{borehole_id} — 시추공 상세 + 지층
# ---------------------------------------------------------------------------

@router.get("/{borehole_id}")
async def get_borehole(
    borehole_id: int,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> dict:
    """시추공 상세 + 지층 목록 (strata 항상 포함)."""
    borehole_result = await db.execute(
        select(Borehole)
        .options(selectinload(Borehole.strata))
        .where(Borehole.id == borehole_id, Borehole.deleted_at.is_(None))
    )
    borehole = borehole_result.scalar_one_or_none()
    if borehole is None:
        raise HTTPException(status_code=404, detail="시추공을 찾을 수 없습니다.")

    loc_result = await db.execute(
        select(func.ST_AsGeoJSON(Borehole.location)).where(Borehole.id == borehole_id)
    )
    loc_json = loc_result.scalar()

    return _borehole_dict(borehole, loc_json, include_strata=True)


# ---------------------------------------------------------------------------
# PATCH /{borehole_id} — 좌표/표고 수정
# ---------------------------------------------------------------------------

class BoreholeUpdate(BaseModel):
    latitude: float | None = None
    longitude: float | None = None
    elevation: float | None = None


@router.patch("/{borehole_id}")
async def update_borehole(
    borehole_id: int,
    body: BoreholeUpdate,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> dict:
    """시추공 위도/경도/표고 수정."""
    result = await db.execute(
        select(Borehole).where(Borehole.id == borehole_id, Borehole.deleted_at.is_(None))
    )
    borehole = result.scalar_one_or_none()
    if borehole is None:
        raise HTTPException(status_code=404, detail="시추공을 찾을 수 없습니다.")

    if body.latitude is not None or body.longitude is not None:
        loc_result = await db.execute(
            select(func.ST_AsGeoJSON(Borehole.location)).where(Borehole.id == borehole_id)
        )
        cur_lng, cur_lat = _loc_to_lng_lat(loc_result.scalar())
        new_lng = body.longitude if body.longitude is not None else cur_lng
        new_lat = body.latitude if body.latitude is not None else cur_lat
        borehole.location = func.ST_SetSRID(func.ST_MakePoint(new_lng, new_lat), 4326)  # type: ignore[assignment]

    if body.elevation is not None:
        borehole.elevation = body.elevation

    await db.commit()
    await db.refresh(borehole)

    loc_result = await db.execute(
        select(func.ST_AsGeoJSON(Borehole.location)).where(Borehole.id == borehole_id)
    )
    return _borehole_dict(borehole, loc_result.scalar())


# ---------------------------------------------------------------------------
# PUT /{borehole_id}/strata — 지층 전체 교체
# ---------------------------------------------------------------------------

class StratumInput(BaseModel):
    depth_top: float
    depth_bottom: float
    soil_type: str
    raw_text: str | None = None
    n_value: float | None = None
    uscs_code: str | None = None


@router.put("/{borehole_id}/strata")
async def replace_strata(
    borehole_id: int,
    strata: list[StratumInput],
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> list[dict]:
    """지층 전체 교체 (DELETE + INSERT 트랜잭션)."""
    borehole_result = await db.execute(
        select(Borehole).where(Borehole.id == borehole_id, Borehole.deleted_at.is_(None))
    )
    if borehole_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="시추공을 찾을 수 없습니다.")

    for s in strata:
        if s.depth_bottom <= s.depth_top:
            raise HTTPException(
                status_code=422,
                detail=f"depth_bottom({s.depth_bottom}) > depth_top({s.depth_top}) 이어야 합니다.",
            )

    await db.execute(delete(Stratum).where(Stratum.borehole_id == borehole_id))

    new_strata = [
        Stratum(
            borehole_id=borehole_id,
            depth_top=s.depth_top,
            depth_bottom=s.depth_bottom,
            soil_type=s.soil_type,
            raw_text=s.raw_text,
            n_value=s.n_value,
            uscs_code=s.uscs_code,
        )
        for s in strata
    ]
    db.add_all(new_strata)
    await db.commit()
    for s in new_strata:
        await db.refresh(s)

    return sorted([_stratum_dict(s) for s in new_strata], key=lambda x: x["depth_top"])


# ---------------------------------------------------------------------------
# POST /by-area — 폴리곤 내 시추공 목록
# ---------------------------------------------------------------------------

class ByAreaRequest(BaseModel):
    polygon: dict  # GeoJSON Polygon
    project_id: int | None = None
    include_strata: bool = False
    borehole_ids: list[int] | None = None


@router.post("/by-area")
async def boreholes_by_area(
    body: ByAreaRequest,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> dict:
    """폴리곤 내부 시추공 목록 (ST_Contains 공간 쿼리). BoreholeApiResponse 형식."""
    geojson_str = json.dumps(body.polygon)

    stmt = select(
        Borehole,
        func.ST_AsGeoJSON(Borehole.location).label("loc_json"),
    ).where(
        Borehole.deleted_at.is_(None),
        func.ST_Contains(
            func.ST_GeomFromGeoJSON(geojson_str),
            cast(Borehole.location, Geometry),
        ),
    )

    if body.project_id is not None:
        stmt = stmt.where(Borehole.project_id == body.project_id)

    if body.borehole_ids:
        stmt = stmt.where(Borehole.id.in_(body.borehole_ids))

    rows = (await db.execute(stmt)).all()

    if body.include_strata:
        ids = [b.id for b, _loc in rows]
        if ids:
            orm_stmt = (
                select(Borehole)
                .options(selectinload(Borehole.strata))
                .where(Borehole.id.in_(ids), Borehole.deleted_at.is_(None))
            )
            boreholes_orm = (await db.execute(orm_stmt)).scalars().all()
            loc_map = {b.id: loc for b, loc in rows}
            boreholes_list = [
                _borehole_dict(b, loc_map.get(b.id), include_strata=True)
                for b in boreholes_orm
            ]
        else:
            boreholes_list = []
    else:
        boreholes_list = [_borehole_dict(b, loc) for b, loc in rows]

    return {
        "boreholes": boreholes_list,
        "count": len(boreholes_list),
        "total": len(boreholes_list),
        "limit": len(boreholes_list),
        "offset": 0,
    }
