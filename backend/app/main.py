"""FastAPI 진입점."""

# Passlib bcrypt 4.x compatibility patch
import bcrypt
if not hasattr(bcrypt, "__about__"):
    class About:
        __version__ = bcrypt.__version__
    bcrypt.__about__ = About()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import auth, boreholes, coordinates, csv_ingestion, pdf_extraction, projects, templates, tiles, rbf, export, virtual_boreholes
from app.core.config import settings
from app.core.database import engine


app = FastAPI(
    title="GeoBIM Stratum API",
    description="시추공 데이터 기반 3D 지층 모델링 플랫폼 API",
    version="0.1.0",
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
app.include_router(virtual_boreholes.router, prefix=PREFIX + "/projects", tags=["virtual-boreholes"])
app.include_router(boreholes.router,      prefix=PREFIX + "/boreholes",      tags=["boreholes"])
app.include_router(coordinates.router,    prefix=PREFIX + "/coordinates",    tags=["coordinates"])
app.include_router(pdf_extraction.router, prefix=PREFIX + "/pdf-extraction", tags=["pdf-extraction"])
app.include_router(csv_ingestion.router,  prefix=PREFIX + "/csv-ingestion",   tags=["csv-ingestion"])
app.include_router(templates.router,      prefix=PREFIX + "/templates",      tags=["templates"])
app.include_router(tiles.router,          prefix=PREFIX + "/tiles",          tags=["tiles"])
app.include_router(rbf.router,            prefix=PREFIX + "/rbf",            tags=["rbf"])
app.include_router(export.router,         prefix=PREFIX + "/export",         tags=["export"])
