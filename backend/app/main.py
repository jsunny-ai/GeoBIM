"""FastAPI 진입점."""

# Passlib bcrypt 4.x compatibility patch
import bcrypt
if not hasattr(bcrypt, "__about__"):
    class About:
        __version__ = bcrypt.__version__
    bcrypt.__about__ = About()

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.v1 import auth, boreholes, pdf_extraction, projects, templates, tiles, rbf, export
from app.core.config import settings
from app.core.database import engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await asyncio.wait_for(_ensure_dev_schema(), timeout=2)
    except Exception as exc:
        print(f"Development schema check skipped: {exc}")
    yield


async def _ensure_dev_schema() -> None:
    """Keep local dev DBs compatible when a migration was not applied yet."""
    if settings.environment != "development":
        return

    statements = [
        """
        ALTER TABLE boreholes
        ADD COLUMN IF NOT EXISTS is_supplementary BOOLEAN NOT NULL DEFAULT FALSE
        """,
        """
        ALTER TABLE pdf_extraction_jobs
        ADD COLUMN IF NOT EXISTS is_supplementary BOOLEAN NOT NULL DEFAULT FALSE
        """,
    ]
    async with engine.begin() as conn:
        for statement in statements:
            await conn.execute(text(statement))


app = FastAPI(
    title="GeoBIM Stratum API",
    description="시추공 데이터 기반 3D 지층 모델링 플랫폼 API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    return {"status": "ok", "version": app.version}


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request, exc: Exception):
    if settings.environment == "development":
        return JSONResponse(status_code=500, content={"detail": str(exc)})
    return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})


PREFIX = "/api/v1"
app.include_router(auth.router,           prefix=PREFIX + "/auth",           tags=["auth"])
app.include_router(projects.router,       prefix=PREFIX + "/projects",       tags=["projects"])
app.include_router(boreholes.router,      prefix=PREFIX + "/boreholes",      tags=["boreholes"])
app.include_router(pdf_extraction.router, prefix=PREFIX + "/pdf-extraction", tags=["pdf-extraction"])
app.include_router(templates.router,      prefix=PREFIX + "/templates",      tags=["templates"])
app.include_router(tiles.router,          prefix=PREFIX + "/tiles",          tags=["tiles"])
app.include_router(rbf.router,            prefix=PREFIX + "/rbf",            tags=["rbf"])
app.include_router(export.router,         prefix=PREFIX + "/export",         tags=["export"])
