"""PDF extraction service backed by the ported PDF_Convert engine."""

from __future__ import annotations

import os
from collections import defaultdict
from pathlib import Path
from typing import Any

import fitz
from geoalchemy2.elements import WKTElement
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Borehole, Project, Stratum
from pdf_convert.core.coordinate_transformer import normalize_coordinates
from pdf_convert.core.master_hybrid_extractor import MasterHybridExtractor
from pdf_convert.parsers.hwp_indexed_extractor import clean_float, parse_coordinates


class PdfService:
    """Run PDF_Convert and persist normalized borehole/stratum records."""

    def __init__(self, *, output_dir: str | None = None, java_bin: str | None = None) -> None:
        backend_dir = Path(__file__).resolve().parents[2]
        configured_dir = Path(output_dir or settings.pdf_convert_data_dir)
        if not configured_dir.is_absolute():
            configured_dir = backend_dir / configured_dir

        self.output_dir = str(configured_dir)
        self.java_bin = java_bin or settings.java_bin_path or None
        os.environ.setdefault("PDF_CONVERT_DATA_DIR", os.path.join(self.output_dir, "data"))

    def auto_extract(self, pdf_path: str, project_name: str) -> list[dict[str, Any]]:
        """Run the automatic hybrid extraction pipeline."""
        extractor = MasterHybridExtractor(output_dir=self.output_dir, java_bin=self.java_bin)
        rows = extractor.process_file(pdf_path, project_name)
        if not rows:
            raise ValueError("PDF에서 유효한 시추공/지층 데이터를 추출하지 못했습니다.")
        return rows

    def run_extraction(
        self,
        *,
        db: Session,
        pdf_path: str,
        project_id: int,
        project_name: str,
        auto_project: bool = False,
    ) -> dict[str, Any]:
        """Extract rows and persist them to Borehole/Stratum tables."""
        rows = self.auto_extract(pdf_path, project_name)
        project_id, project_name = self.resolve_project(
            db=db,
            rows=rows,
            project_id=project_id,
            project_name=project_name,
            auto_project=auto_project,
            fallback_project_name=Path(pdf_path).stem,
        )
        created = self.persist_rows(db=db, rows=rows, project_id=project_id, source_file=pdf_path)
        return {
            "project_id": project_id,
            "project_name": project_name,
            "borehole_count": created["borehole_count"],
            "stratum_count": created["stratum_count"],
            "source_file": pdf_path,
        }

    def preview_extraction(
        self,
        *,
        db: Session,
        pdf_path: str,
        project_id: int,
        project_name: str,
        auto_project: bool = False,
    ) -> dict[str, Any]:
        """Extract rows and return a review payload without saving boreholes."""
        rows = self.auto_extract(pdf_path, project_name)
        project_id, project_name = self.resolve_project(
            db=db,
            rows=rows,
            project_id=project_id,
            project_name=project_name,
            auto_project=auto_project,
            fallback_project_name=Path(pdf_path).stem,
        )
        summary = _summarize_rows(rows)
        return {
            "project_id": project_id,
            "project_name": project_name,
            "source_file": pdf_path,
            "borehole_count": summary["borehole_count"],
            "stratum_count": summary["stratum_count"],
            "rows": rows,
        }

    def resolve_project(
        self,
        *,
        db: Session,
        rows: list[dict[str, Any]],
        project_id: int,
        project_name: str,
        auto_project: bool,
        fallback_project_name: str | None = None,
    ) -> tuple[int, str]:
        """Resolve the target project from extracted rows or the selected project."""
        if auto_project:
            owner_id = db.execute(
                select(Project.owner_id).where(Project.id == project_id)
            ).scalar_one()
            project_name = (
                _extract_project_name(rows)
                or _safe_project_name(fallback_project_name)
                or _safe_project_name(project_name)
                or "프로젝트명 확인 필요"
            )
            for row in rows:
                row["프로젝트명"] = project_name
            project = _find_or_create_project(db, name=project_name, owner_id=owner_id, rows=rows)
            project_id = project.id
        return project_id, project_name

    def persist_rows(
        self,
        *,
        db: Session,
        rows: list[dict[str, Any]],
        project_id: int,
        source_file: str,
    ) -> dict[str, int]:
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            name = str(row.get("시추공명") or "UNKNOWN").strip() or "UNKNOWN"
            grouped[name].append(row)

        borehole_count = 0
        stratum_count = 0
        for name, borehole_rows in grouped.items():
            first = borehole_rows[0]
            lon = _to_float(first.get("lon_wgs84"))
            lat = _to_float(first.get("lat_wgs84"))
            if lon is None or lat is None:
                raise ValueError(f"{name} 좌표가 없어 DB에 저장할 수 없습니다.")

            borehole = Borehole(
                project_id=project_id,
                name=name,
                location=WKTElement(f"POINT({lon} {lat})", srid=4326),
                elevation=_to_float(first.get("표고")),
                source_crs=_to_text(first.get("meta_crs")),
                source_file=source_file,
            )
            db.add(borehole)
            db.flush()
            borehole_count += 1

            for row in sorted(borehole_rows, key=lambda r: _to_float(r.get("상심도")) or 0.0):
                depth_top = _to_float(row.get("상심도"))
                depth_bottom = _to_float(row.get("하심도"))
                soil_type = _to_text(row.get("지층명")) or "미분류"
                if depth_top is None or depth_bottom is None or depth_bottom <= depth_top:
                    continue

                db.add(
                    Stratum(
                        borehole_id=borehole.id,
                        depth_top=depth_top,
                        depth_bottom=depth_bottom,
                        soil_type=soil_type,
                        raw_text=str(row),
                        source_file=source_file,
                    )
                )
                stratum_count += 1

        if borehole_count == 0 or stratum_count == 0:
            raise ValueError("저장 가능한 시추공 또는 지층 데이터가 없습니다.")

        return {"borehole_count": borehole_count, "stratum_count": stratum_count}

    def extract_with_template(self, pdf_path: str, box_definitions: dict[str, Any]) -> dict[str, str]:
        """Extract text using normalized page boxes."""
        doc = fitz.open(pdf_path)
        try:
            result: dict[str, str] = {}
            for box in box_definitions.get("boxes", []):
                label = box["label"]
                page_index = int(box["page"]) - 1
                rect = box["rect"]
                page = doc[page_index]
                width, height = page.rect.width, page.rect.height
                clip = fitz.Rect(
                    rect[0] * width,
                    rect[1] * height,
                    rect[2] * width,
                    rect[3] * height,
                )
                result[label] = page.get_text("text", clip=clip).strip()
            return result
        finally:
            doc.close()

    def extract_rows_with_template(
        self,
        pdf_path: str,
        box_definitions: dict[str, Any],
        project_name: str,
    ) -> list[dict[str, Any]]:
        """Extract normalized rows from user-drawn field/column boxes."""
        fields = self.extract_with_template(pdf_path, box_definitions)
        extracted_project_name = _to_text(fields.get("project_name")) or project_name
        borehole_name = _to_text(fields.get("borehole_name")) or "BH-1"
        source_crs = _to_text(fields.get("crs"))

        raw_x, raw_y = _coordinates_from_fields(fields)
        lon, lat, tmx, tmy, final_epsg = normalize_coordinates(
            raw_x,
            raw_y,
            borehole_id=borehole_name,
            source_crs=source_crs,
        )

        top_depths = _split_lines(fields.get("top_depth"))
        bottom_depths = _split_lines(fields.get("bottom_depth"))
        strata_names = _split_lines(fields.get("stratum_name"))

        row_count = max(len(bottom_depths), len(strata_names))
        if row_count == 0:
            raise ValueError("하심도 또는 지층명 컬럼 박스에서 행 데이터를 찾지 못했습니다.")

        rows: list[dict[str, Any]] = []
        previous_bottom = 0.0
        for index in range(row_count):
            bottom = clean_float(bottom_depths[index]) if index < len(bottom_depths) else None
            if bottom is None:
                continue

            top = clean_float(top_depths[index]) if index < len(top_depths) else previous_bottom
            if top is None:
                top = previous_bottom

            stratum_name = strata_names[index] if index < len(strata_names) else "미분류"
            rows.append(
                {
                    "프로젝트명": extracted_project_name,
                    "시추공명": borehole_name,
                    "경도": raw_x,
                    "위도": raw_y,
                    "표고": clean_float(fields.get("elevation")),
                    "상심도": top,
                    "하심도": bottom,
                    "지층명": stratum_name or "미분류",
                    "lon_wgs84": lon,
                    "lat_wgs84": lat,
                    "tm_x": tmx,
                    "tm_y": tmy,
                    "meta_crs": final_epsg,
                }
            )
            previous_bottom = bottom

        if not rows:
            raise ValueError("저장 가능한 지층 행을 만들지 못했습니다.")
        return rows


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.upper() == "N/A":
        return None
    try:
        return float(text.replace(",", ""))
    except ValueError:
        return None


def _to_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.upper() == "N/A":
        return None
    return text


def _extract_project_name(rows: list[dict[str, Any]]) -> str | None:
    for row in rows:
        name = _safe_project_name(row.get("프로젝트명"))
        if name:
            return name
    return None


def _safe_project_name(value: Any) -> str | None:
    name = _to_text(value)
    if not name:
        return None
    if name.startswith(("PDF 자동 감지 대기-", "PDF 직접 지정 대기-")):
        return None
    return name


def _find_or_create_project(
    db: Session,
    *,
    name: str,
    owner_id: int,
    rows: list[dict[str, Any]],
) -> Project:
    existing = db.execute(
        select(Project).where(Project.name == name, Project.deleted_at.is_(None))
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    source_crs = None
    for row in rows:
        source_crs = _to_text(row.get("meta_crs"))
        if source_crs:
            break

    project = Project(
        name=name,
        owner_id=owner_id,
        region=None,
        source_crs=source_crs,
    )
    db.add(project)
    db.flush()
    return project


def _summarize_rows(rows: list[dict[str, Any]]) -> dict[str, int]:
    boreholes = {
        str(row.get("시추공명") or "UNKNOWN").strip() or "UNKNOWN"
        for row in rows
    }
    valid_strata = 0
    for row in rows:
        depth_top = _to_float(row.get("상심도"))
        depth_bottom = _to_float(row.get("하심도"))
        if depth_top is not None and depth_bottom is not None and depth_bottom > depth_top:
            valid_strata += 1
    return {"borehole_count": len(boreholes), "stratum_count": valid_strata}


def _split_lines(value: Any) -> list[str]:
    text = _to_text(value)
    if not text:
        return []
    return [line.strip() for line in text.replace("\r", "\n").split("\n") if line.strip()]


def _coordinates_from_fields(fields: dict[str, str]) -> tuple[Any, Any]:
    lon = _to_text(fields.get("x_coord")) or _to_text(fields.get("tm_x"))
    lat = _to_text(fields.get("y_coord")) or _to_text(fields.get("tm_y"))
    if lon and lat:
        return clean_float(lon) or lon, clean_float(lat) or lat

    combined = _to_text(fields.get("coordinates"))
    if combined:
        parsed_lon, parsed_lat = parse_coordinates(combined)
        if parsed_lon is not None and parsed_lat is not None:
            return parsed_lon, parsed_lat

    return lon, lat
