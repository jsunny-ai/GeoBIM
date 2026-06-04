"""시추공 라우터."""

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
# Pydantic 스키마
# ---------------------------------------------------------------------------

class StratumCreate(BaseModel):
    depth_top: float
    depth_bottom: float
    soil_type: str
    raw_text: str | None = None
    n_value: float | None = None
    uscs_code: str | None = None


class BoreholeCreate(BaseModel):
    project_id: int
    name: str
    latitude: float
    longitude: float
    elevation: float | None = None
    source_crs: str | None = "EPSG:4326"
    strata: list[StratumCreate] = []
    is_supplementary: bool = False  # True=신규 보완, False=원본 기존


class StratumInput(BaseModel):
    depth_top: float
    depth_bottom: float
    soil_type: str
    raw_text: str | None = None
    n_value: float | None = None
    uscs_code: str | None = None


class BoreholeUpdate(BaseModel):
    latitude: float | None = None
    longitude: float | None = None
    elevation: float | None = None


class ByAreaRequest(BaseModel):
    polygon: dict
    project_id: int | None = None
    include_strata: bool = False
    borehole_ids: list[int] | None = None


# ---------------------------------------------------------------------------
# 내부 헬퍼
# ---------------------------------------------------------------------------

def _loc_to_lng_lat(loc_json: str | None) -> tuple[float, float]:
    if not loc_json:
        return 0.0, 0.0
    coords = json.loads(loc_json)["coordinates"]
    return coords[0], coords[1]


def _borehole_dict(b: Borehole, loc_json: str | None, *, include_strata: bool = False) -> dict:
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
        "is_supplementary": getattr(b, "is_supplementary", False),
        "created_at": b.created_at.isoformat(),
    }
    if include_strata and hasattr(b, "strata"):
        data["strata"] = sorted(
            [_stratum_dict(s) for s in b.strata],
            key=lambda x: x["depth_top"],
        )
    return data


def _stratum_dict(s: Stratum) -> dict:
    return {
        "id": s.id,
        "borehole_id": s.borehole_id,
        "depth_top": s.depth_top,
        "depth_bottom": s.depth_bottom,
        "soil_type": s.soil_type,
        "strata_group": normalize_strata_group(s.soil_type),
        "raw_text": s.raw_text,
        "n_value": s.n_value,
        "uscs_code": s.uscs_code,
    }


# ---------------------------------------------------------------------------
# POST / — 시추공 직접 생성
# ---------------------------------------------------------------------------

@router.post("/", status_code=201)
async def create_borehole(
    body: BoreholeCreate,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> dict:
    """수동 입력으로 시추공 + 지층을 직접 생성합니다."""
    for s in body.strata:
        if s.depth_bottom <= s.depth_top:
            raise HTTPException(
                status_code=422,
                detail=f"depth_bottom({s.depth_bottom}) > depth_top({s.depth_top}) 이어야 합니다.",
            )

    borehole = Borehole(
        project_id=body.project_id,
        name=body.name,
        elevation=body.elevation,
        source_crs=body.source_crs or "EPSG:4326",
        location=func.ST_SetSRID(func.ST_MakePoint(body.longitude, body.latitude), 4326),
        is_supplementary=body.is_supplementary,
    )
    db.add(borehole)
    await db.flush()

    if body.strata:
        db.add_all([
            Stratum(
                borehole_id=borehole.id,
                depth_top=s.depth_top,
                depth_bottom=s.depth_bottom,
                soil_type=s.soil_type,
                raw_text=s.raw_text,
                n_value=s.n_value,
                uscs_code=s.uscs_code,
            )
            for s in body.strata
        ])

    await db.commit()

    loc_result = await db.execute(
        select(func.ST_AsGeoJSON(Borehole.location)).where(Borehole.id == borehole.id)
    )
    bh_result = await db.execute(
        select(Borehole).options(selectinload(Borehole.strata)).where(Borehole.id == borehole.id)
    )
    return _borehole_dict(bh_result.scalar_one(), loc_result.scalar(), include_strata=True)


# ---------------------------------------------------------------------------
# GET / — 시추공 목록
# ---------------------------------------------------------------------------

@router.get("/")
async def list_boreholes(
    project_id: int | None = None,
    include_strata: bool = Query(False),
    limit: int = Query(10000, ge=1, le=50000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> dict:
    base_stmt = select(
        Borehole,
        func.ST_AsGeoJSON(Borehole.location).label("loc_json"),
    ).where(Borehole.deleted_at.is_(None))

    if project_id is not None:
        base_stmt = base_stmt.where(Borehole.project_id == project_id)

    count_stmt = select(func.count()).select_from(base_stmt.subquery())
    total: int = (await db.execute(count_stmt)).scalar_one()

    if include_strata:
        ids_stmt = (
            select(Borehole.id)
            .where(Borehole.deleted_at.is_(None))
        )
        if project_id is not None:
            ids_stmt = ids_stmt.where(Borehole.project_id == project_id)
        ids_stmt = ids_stmt.limit(limit).offset(offset)

        orm_stmt = (
            select(Borehole)
            .options(selectinload(Borehole.strata))
            .where(Borehole.id.in_(ids_stmt), Borehole.deleted_at.is_(None))
        )
        boreholes_orm = (await db.execute(orm_stmt)).scalars().all()

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
        rows = (await db.execute(base_stmt.limit(limit).offset(offset))).all()
        boreholes_list = [_borehole_dict(b, loc) for b, loc in rows]

    return {
        "boreholes": boreholes_list,
        "count": len(boreholes_list),
        "total": total,
        "limit": limit,
        "offset": offset,
    }


# ---------------------------------------------------------------------------
# GET /{borehole_id}
# ---------------------------------------------------------------------------

@router.get("/{borehole_id}")
async def get_borehole(
    borehole_id: int,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> dict:
    result = await db.execute(
        select(Borehole)
        .options(selectinload(Borehole.strata))
        .where(Borehole.id == borehole_id, Borehole.deleted_at.is_(None))
    )
    borehole = result.scalar_one_or_none()
    if borehole is None:
        raise HTTPException(status_code=404, detail="시추공을 찾을 수 없습니다.")

    loc_result = await db.execute(
        select(func.ST_AsGeoJSON(Borehole.location)).where(Borehole.id == borehole_id)
    )
    return _borehole_dict(borehole, loc_result.scalar(), include_strata=True)


# ---------------------------------------------------------------------------
# PATCH /{borehole_id}
# ---------------------------------------------------------------------------

@router.patch("/{borehole_id}")
async def update_borehole(
    borehole_id: int,
    body: BoreholeUpdate,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> dict:
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
        borehole.location = func.ST_SetSRID(func.ST_MakePoint(new_lng, new_lat), 4326)

    if body.elevation is not None:
        borehole.elevation = body.elevation

    await db.commit()
    await db.refresh(borehole)

    loc_result = await db.execute(
        select(func.ST_AsGeoJSON(Borehole.location)).where(Borehole.id == borehole_id)
    )
    return _borehole_dict(borehole, loc_result.scalar())


# ---------------------------------------------------------------------------
# PUT /{borehole_id}/strata
# ---------------------------------------------------------------------------

@router.put("/{borehole_id}/strata")
async def replace_strata(
    borehole_id: int,
    strata: list[StratumInput],
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> list[dict]:
    result = await db.execute(
        select(Borehole).where(Borehole.id == borehole_id, Borehole.deleted_at.is_(None))
    )
    if result.scalar_one_or_none() is None:
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
# POST /by-area
# ---------------------------------------------------------------------------

@router.post("/by-area")
async def boreholes_by_area(
    body: ByAreaRequest,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> dict:
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
