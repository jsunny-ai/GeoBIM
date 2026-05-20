"""프로젝트 라우터.

- GET /          : 프로젝트 목록 (borehole_count 포함)
- GET /{id}      : 프로젝트 상세 (borehole_count 포함)
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models import Borehole, Project, User
from app.schemas import ProjectRead

router = APIRouter()


def _project_with_count(project: Project, borehole_count: int) -> dict:
    data = ProjectRead.model_validate(project).model_dump()
    data["borehole_count"] = borehole_count
    return data


@router.get("/")
async def list_projects(
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> list[dict]:
    """전체 프로젝트 목록 (soft delete 제외, borehole_count 포함)."""
    stmt = (
        select(Project, func.count(Borehole.id).label("borehole_count"))
        .outerjoin(Borehole, (Borehole.project_id == Project.id) & Borehole.deleted_at.is_(None))
        .where(Project.deleted_at.is_(None))
        .group_by(Project.id)
        .order_by(Project.created_at.desc())
    )
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
