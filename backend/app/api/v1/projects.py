"""프로젝트 라우터.

- GET /          : 프로젝트 목록 (borehole_count 포함)
- GET /{id}      : 프로젝트 상세 (borehole_count 포함)
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models import Borehole, Project, User
from app.schemas import ProjectRead, ProjectCreate

router = APIRouter()


def _project_with_count(project: Project, borehole_count: int) -> dict:
    data = ProjectRead.model_validate(project).model_dump()
    data["borehole_count"] = borehole_count
    return data


@router.get("/")
async def list_projects(
    has_bbox: bool | None = None,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> list[dict]:
    """전체 프로젝트 목록 (soft delete 제외, borehole_count 포함)."""
    stmt = (
        select(Project, func.count(Borehole.id).label("borehole_count"))
        .outerjoin(Borehole, (Borehole.project_id == Project.id) & Borehole.deleted_at.is_(None))
        .where(Project.deleted_at.is_(None))
    )
    
    if has_bbox is not None:
        if has_bbox:
            stmt = stmt.where(Project.bbox.is_not(None))
        else:
            stmt = stmt.where(Project.bbox.is_(None))
            
    stmt = stmt.group_by(Project.id).order_by(Project.created_at.desc())
    rows = (await db.execute(stmt)).all()
    return [_project_with_count(p, cnt) for p, cnt in rows]


@router.get("/{project_id}")
async def get_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> dict:
    """프로젝트 상세 (borehole_count 포함)."""
    stmt = (
        select(Project, func.count(Borehole.id).label("borehole_count"))
        .outerjoin(Borehole, (Borehole.project_id == Project.id) & Borehole.deleted_at.is_(None))
        .where(Project.id == project_id, Project.deleted_at.is_(None))
        .group_by(Project.id)
    )
    row = (await db.execute(stmt)).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    project, borehole_count = row
    return _project_with_count(project, borehole_count)


@router.post("/", response_model=ProjectRead)
async def create_project(
    project_in: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> Project:
    """새 프로젝트 생성."""
    project = Project(
        name=project_in.name,
        description=project_in.description,
        region=project_in.region,
        source_crs=project_in.source_crs,
        bbox=project_in.bbox,
        owner_id=_current_user.id,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


@router.put("/{project_id}", response_model=ProjectRead)
async def update_project(
    project_id: int,
    project_in: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> Project:
    """기존 프로젝트 수정 (영역 BBox 및 선택 시추공 리스트 업데이트)."""
    stmt = select(Project).where(Project.id == project_id, Project.deleted_at.is_(None))
    project = (await db.execute(stmt)).scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
        
    if project.owner_id != _current_user.id and _current_user.role != "admin":
        raise HTTPException(status_code=403, detail="프로젝트 수정 권한이 없습니다.")
        
    project.name = project_in.name
    project.description = project_in.description
    project.region = project_in.region
    project.source_crs = project_in.source_crs
    project.bbox = project_in.bbox
    
    await db.commit()
    await db.refresh(project)
    return project


@router.delete("/{project_id}")
async def delete_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> dict:
    """프로젝트 삭제 (soft delete)."""
    stmt = select(Project).where(Project.id == project_id, Project.deleted_at.is_(None))
    project = (await db.execute(stmt)).scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    
    # 간이 권한 검사 (소유자 또는 관리자만 삭제 가능)
    if project.owner_id != _current_user.id and _current_user.role != "admin":
        raise HTTPException(status_code=403, detail="프로젝트 삭제 권한이 없습니다.")
        
    project.deleted_at = func.now()
    await db.commit()
    return {"status": "success"}
