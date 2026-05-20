"""SQLAlchemy ORM 모델 정의.

전체 7개 테이블 + 공통 베이스 클래스.

스타일 가이드:
- SQLAlchemy 2.x DeclarativeBase + Mapped[] / mapped_column
- 모든 테이블에 공통 컬럼(id, created_at, updated_at, deleted_at) 적용
- deleted_at IS NOT NULL → soft delete
- 시추공 location 은 PostGIS Geography(POINT, 4326) — 위경도(WGS84)
"""

from __future__ import annotations

import enum
from datetime import datetime

from geoalchemy2 import Geography
from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


# ============================================================================
# 베이스 / 공통 믹스인
# ============================================================================
class Base(DeclarativeBase):
    """모든 ORM 모델의 베이스 클래스."""


class TimestampMixin:
    """공통 타임스탬프 컬럼 (생성/수정/soft delete)."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )


# ============================================================================
# 열거형
# ============================================================================
class UserRole(str, enum.Enum):
    """사용자 역할.

    - DESIGNER : 토목 설계자
    - EXPERT   : 지반 전문가
    - REVIEWER : 발주처 / 감리
    - ADMIN    : 시스템 관리자
    """

    DESIGNER = "designer"
    EXPERT = "expert"
    REVIEWER = "reviewer"
    ADMIN = "admin"


class ProjectMemberRole(str, enum.Enum):
    """프로젝트 내 멤버 역할 (User.role 과는 별개로 프로젝트별 권한)."""

    OWNER = "owner"
    EDITOR = "editor"
    VIEWER = "viewer"


class ExtractionJobStatus(str, enum.Enum):
    """PDF 추출 작업 상태."""

    PENDING = "pending"
    RUNNING = "running"
    AWAITING_REVIEW = "awaiting_review"
    APPROVED = "approved"
    FAILED = "failed"


# ============================================================================
# User
# ============================================================================
class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=UserRole.DESIGNER,
    )
    full_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)

    # 관계
    owned_projects: Mapped[list[Project]] = relationship(
        back_populates="owner", foreign_keys="Project.owner_id"
    )
    memberships: Mapped[list[ProjectMember]] = relationship(back_populates="user")
    owned_templates: Mapped[list[PdfTemplate]] = relationship(back_populates="owner")


# ============================================================================
# Project
# ============================================================================
class Project(Base, TimestampMixin):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False, index=True
    )
    region: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    # 원본 좌표계 EPSG 코드 (예: 5174~5187 한국 중부원점 시리즈)
    source_crs: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # 프로젝트 경계 박스 (GeoJSON BBox: [minX, minY, maxX, maxY])
    bbox: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # 관계
    owner: Mapped[User] = relationship(
        back_populates="owned_projects", foreign_keys=[owner_id]
    )
    members: Mapped[list[ProjectMember]] = relationship(back_populates="project")
    boreholes: Mapped[list[Borehole]] = relationship(back_populates="project")
    extraction_jobs: Mapped[list[PdfExtractionJob]] = relationship(back_populates="project")


# ============================================================================
# ProjectMember (Project ↔ User 다대다 + 역할)
# ============================================================================
class ProjectMember(Base, TimestampMixin):
    __tablename__ = "project_members"

    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[ProjectMemberRole] = mapped_column(
        Enum(ProjectMemberRole, name="project_member_role", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=ProjectMemberRole.VIEWER,
    )

    # 관계
    project: Mapped[Project] = relationship(back_populates="members")
    user: Mapped[User] = relationship(back_populates="memberships")


# ============================================================================
# Borehole (시추공)
# ============================================================================
class Borehole(Base, TimestampMixin):
    __tablename__ = "boreholes"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)

    # PostGIS Geography (POINT, WGS84). 항상 위경도로 저장 — 원본 좌표계는 source_crs 에 별도 기록.
    location: Mapped[str] = mapped_column(
        Geography(geometry_type="POINT", srid=4326),
        nullable=False,
    )
    elevation: Mapped[float | None] = mapped_column(Float, nullable=True)

    # 원본 좌표계 (EPSG:5174 등)
    source_crs: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # 원본 파일 경로 (또는 외부 식별자)
    source_file: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # 관계
    project: Mapped[Project] = relationship(back_populates="boreholes")
    strata: Mapped[list[Stratum]] = relationship(
        back_populates="borehole", cascade="all, delete-orphan"
    )


# ============================================================================
# Stratum (지층)
# ============================================================================
class Stratum(Base, TimestampMixin):
    """시추공 1개 안의 지층 1개 레이어.

    soil_type 은 4대 대분류로 정규화 (PDF_Convert 의 정규화 함수 통과 후):
      - 토사 (soil)
      - 풍화암 (weathered_rock)
      - 연암 (soft_rock)
      - 경암 (hard_rock)
    """

    __tablename__ = "strata"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    borehole_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("boreholes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    depth_top: Mapped[float] = mapped_column(Float, nullable=False)
    depth_bottom: Mapped[float] = mapped_column(Float, nullable=False)
    soil_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    n_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    uscs_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    source_file: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # 관계
    borehole: Mapped[Borehole] = relationship(back_populates="strata")


# ============================================================================
# PdfTemplate (박스 추출 템플릿)
# ============================================================================
class PdfTemplate(Base, TimestampMixin):
    """PDF 박스 추출 템플릿.

    box_definitions JSONB 스키마 (자세히는 docs/PDF_EXTRACTION_DESIGN.md 참고):
      {
        "boxes": [
          {"label": "borehole_id", "page": 1, "rect": [0.1, 0.05, 0.3, 0.1]},
          ...
        ]
      }
    rect 는 페이지 기준 정규화 좌표(0~1).
    """

    __tablename__ = "pdf_templates"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    owner_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False, index=True
    )
    region: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    # 박스 정의 JSONB
    box_definitions: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # 자동 매칭에 사용할 키워드 목록 (JSONB 배열 권장)
    match_keywords: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # 샘플 PDF 경로
    sample_pdf: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # 관계
    owner: Mapped[User] = relationship(back_populates="owned_templates")
    extraction_jobs: Mapped[list[PdfExtractionJob]] = relationship(back_populates="template")


# ============================================================================
# PdfExtractionJob (PDF 추출 작업)
# ============================================================================
class PdfExtractionJob(Base, TimestampMixin):
    __tablename__ = "pdf_extraction_jobs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[ExtractionJobStatus] = mapped_column(
        Enum(ExtractionJobStatus, name="extraction_job_status", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=ExtractionJobStatus.PENDING,
        index=True,
    )
    template_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("pdf_templates.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # 추출 결과 (JSONB) — 박스별 텍스트 + 파싱된 시추공/지층 데이터
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Celery task id (취소/재시도용)
    celery_task_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # 관계
    project: Mapped[Project] = relationship(back_populates="extraction_jobs")
    template: Mapped[PdfTemplate | None] = relationship(back_populates="extraction_jobs")


# ============================================================================
# 명시적 export 목록 (Alembic autogenerate 가 모든 모델을 인식하도록)
# ============================================================================
__all__ = [
    "Base",
    "TimestampMixin",
    "UserRole",
    "ProjectMemberRole",
    "ExtractionJobStatus",
    "User",
    "Project",
    "ProjectMember",
    "Borehole",
    "Stratum",
    "PdfTemplate",
    "PdfExtractionJob",
]
