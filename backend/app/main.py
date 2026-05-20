"""FastAPI 진입점.

Phase 1 스캐폴딩 단계 — `/health` 엔드포인트와 v1 라우터 마운트만 수행하며,
각 라우터의 실제 핸들러는 Phase 2 에서 구현한다.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import auth, boreholes, pdf_extraction, projects, templates, tiles
from app.core.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 시작 시: DB 연결 풀 워밍업 등은 Phase 2 에서 추가
    yield
    # 종료 시: 리소스 정리 (Phase 2)


app = FastAPI(
    title="GeoBIM Stratum API",
    description="시추공 데이터 기반 3D 지층 모델링 플랫폼 API",
    version="0.1.0",
    lifespan=lifespan,
)

# ----- CORS -----
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ----- 헬스 체크 -----
@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    """단순 헬스 체크 (DB 핑은 포함하지 않음)."""
    return {"status": "ok", "version": app.version}


# ----- v1 라우터 마운트 -----
API_V1_PREFIX = "/api/v1"
app.include_router(auth.router, prefix=f"{API_V1_PREFIX}/auth", tags=["auth"])
app.include_router(projects.router, prefix=f"{API_V1_PREFIX}/projects", tags=["projects"])
app.include_router(boreholes.router, prefix=f"{API_V1_PREFIX}/boreholes", tags=["boreholes"])
app.include_router(
    pdf_extraction.router,
    prefix=f"{API_V1_PREFIX}/pdf-extraction",
    tags=["pdf-extraction"],
)
app.include_router(templates.router, prefix=f"{API_V1_PREFIX}/templates", tags=["templates"])
app.include_router(tiles.router, prefix=f"{API_V1_PREFIX}/tiles", tags=["tiles"])
