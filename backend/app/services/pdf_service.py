"""PDF extraction service backed by the ported PDF_Convert engine."""

from __future__ import annotations

import os
import re
from io import BytesIO
from collections import defaultdict
from pathlib import Path
from typing import Any

import fitz
from geoalchemy2.elements import WKTElement
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Borehole, Project, Stratum
from app.services.odl_normalizer import PdfElement, find_elements_in_box, flatten_odl_json, text_from_elements
from app.services.odl_pdf_service import OdlPdfService
from pdf_convert.core.coordinate_transformer import normalize_coordinates
from pdf_convert.core.table_merger import STRATA_GROUP_MAP
from pdf_convert.core.master_hybrid_extractor import MasterHybridExtractor
from pdf_convert.parsers.hwp_indexed_extractor import clean_float, normalize_bh_id, normalize_strata, parse_coordinates

try:
    import pytesseract
    from PIL import Image
except Exception:  # pragma: no cover - optional OCR runtime
    pytesseract = None
    Image = None


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
        self.last_odl_metadata: dict[str, Any] | None = None

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
        is_supplementary: bool = False,
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
                is_supplementary=is_supplementary,
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

    def extract_with_template(
        self,
        pdf_path: str,
        box_definitions: dict[str, Any],
        *,
        odl_elements: list[PdfElement] | None = None,
    ) -> dict[str, str]:
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
                text = page.get_text("text", clip=clip).strip()
                odl_text = _extract_odl_text_for_box(odl_elements, page, box)
                ocr_text = _ocr_text_for_clip(page, clip) if not text and not odl_text else ""
                text = _choose_best_box_text(
                    pymupdf_text=text,
                    odl_text=odl_text,
                    ocr_text=ocr_text,
                    field=str(label),
                )
                result[label] = text
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
        odl_elements = self._load_odl_elements(pdf_path)
        if _uses_auto_page_classification(box_definitions):
            return self.extract_rows_with_page_templates(
                pdf_path,
                box_definitions,
                project_name,
                odl_elements=odl_elements,
            )

        fields = self.extract_with_template(pdf_path, box_definitions, odl_elements=odl_elements)
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

        top_depths = _split_depth_values(fields.get("top_depth"))
        bottom_depths = _split_depth_values(fields.get("depth")) or _split_depth_values(fields.get("bottom_depth"))
        strata_names = _split_strata_lines(fields.get("stratum_name"))

        row_count = max(len(bottom_depths), len(strata_names))
        if row_count == 0:
            raise ValueError("심도 또는 지층명 컬럼 박스에서 행 데이터를 찾지 못했습니다.")

        rows: list[dict[str, Any]] = []
        previous_bottom = 0.0
        for index in range(row_count):
            bottom = clean_float(bottom_depths[index]) if index < len(bottom_depths) else None
            if bottom is None:
                continue

            top = clean_float(top_depths[index]) if index < len(top_depths) else previous_bottom
            if top is None:
                top = previous_bottom

            stratum_name = _normalize_stratum_name(strata_names[index] if index < len(strata_names) else None)
            rows.append(
                {
                    "프로젝트명": extracted_project_name,
                    "시추공명": borehole_name,
                    "경도": raw_x,
                    "위도": raw_y,
                    "표고": clean_float(fields.get("elevation")),
                    "상심도": top,
                    "하심도": bottom,
                    "지층명": stratum_name,
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

    def extract_rows_with_page_templates(
        self,
        pdf_path: str,
        box_definitions: dict[str, Any],
        project_name: str,
        *,
        odl_elements: list[PdfElement] | None = None,
    ) -> list[dict[str, Any]]:
        """Apply first/continuation page templates across all PDF pages."""
        boxes = box_definitions.get("boxes", [])
        page_mode = box_definitions.get("page_mode") or "split"
        first_boxes = [box for box in boxes if box.get("template") == "first"]
        continuation_boxes = [] if page_mode == "same" else [
            box for box in boxes if box.get("template") == "continuation"
        ]
        if not first_boxes:
            raise ValueError("첫 페이지 형식 박스가 필요합니다.")

        borehole_boxes = [box for box in first_boxes if box.get("label") == "borehole_name"]
        if not borehole_boxes:
            raise ValueError("첫 페이지 형식에는 시추공명 박스가 필요합니다.")

        doc = fitz.open(pdf_path)
        try:
            rows: list[dict[str, Any]] = []
            current_meta: dict[str, Any] | None = None
            previous_bottom = 0.0

            for page_number in range(1, len(doc) + 1):
                probe_fields = _extract_fields_on_page(
                    doc,
                    page_number,
                    borehole_boxes,
                    odl_elements=odl_elements,
                )
                detected_borehole = _normalize_borehole_name(probe_fields.get("borehole_name"))
                is_start_page = detected_borehole is not None

                if is_start_page or current_meta is None:
                    first_fields = _extract_fields_on_page(
                        doc,
                        page_number,
                        first_boxes,
                        odl_elements=odl_elements,
                    )
                    current_meta = _metadata_from_fields(first_fields, project_name)
                    if detected_borehole:
                        current_meta["borehole_name"] = detected_borehole
                    previous_bottom = 0.0
                    page_fields = dict(first_fields)

                    if not _has_table_fields(page_fields) and continuation_boxes:
                        page_fields.update(
                            _extract_fields_on_page(
                                doc,
                                page_number,
                                continuation_boxes,
                                odl_elements=odl_elements,
                            )
                        )
                else:
                    table_boxes = continuation_boxes or _table_boxes(first_boxes)
                    page_fields = _extract_fields_on_page(
                        doc,
                        page_number,
                        table_boxes,
                        odl_elements=odl_elements,
                    )

                if current_meta is None:
                    continue

                page_rows, previous_bottom = _rows_from_manual_fields(
                    fields=page_fields,
                    meta=current_meta,
                    previous_bottom=previous_bottom,
                )
                rows.extend(page_rows)
        finally:
            doc.close()

        if not rows:
            raise ValueError("저장 가능한 지층 행을 만들지 못했습니다.")
        return rows

    def _load_odl_elements(self, pdf_path: str) -> list[PdfElement] | None:
        """Load optional ODL JSON elements for manual box text correction."""
        metadata = OdlPdfService().extract_json_with_metadata(
            pdf_path,
            job_key=Path(pdf_path).parent.name,
        )
        self.last_odl_metadata = {key: value for key, value in metadata.items() if key != "data"}
        if not metadata.get("ok"):
            return None
        return flatten_odl_json(metadata.get("data"))


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


_DEPTH_NUMBER_RE = re.compile(r"[-+]?(?:\d+(?:[,.]\d+)?|[,.]\s*\d+)")

_STRATA_TOKEN_RE = re.compile(
    r"(매립층|매립토|퇴적층|퇴적토|충적층|충적토|풍화토|풍화암|보통암|리핑암|발파암|화강암|연암|경암|토사)"
)

_STRATA_ALIASES = {
    "매립층": "토사",
    "매립토": "토사",
    "퇴적층": "토사",
    "퇴적토": "토사",
    "충적층": "토사",
    "충적토": "토사",
    "풍화토": "토사",
    "리핑암": "연암",
    "발파암": "경암",
    "화강암": "경암",
}


def _split_depth_values(value: Any) -> list[str]:
    text = _to_text(value)
    if not text:
        return []

    values: list[str] = []
    for line in _split_lines(text):
        normalized = (
            line.replace("O", "0")
            .replace("o", "0")
            .replace("|", " ")
            .replace("_", " ")
        )
        matches = _DEPTH_NUMBER_RE.findall(normalized)
        for match in matches:
            cleaned = re.sub(r"\s+", "", match).replace(",", ".")
            if cleaned.startswith("."):
                cleaned = cleaned[1:]
            if cleaned.endswith("."):
                cleaned = cleaned[:-1]
            if clean_float(cleaned) is not None:
                values.append(cleaned)
    return values


def _split_strata_lines(value: Any) -> list[str]:
    lines = _split_lines(value)
    if not lines:
        return []

    compact = re.sub(r"[^가-힣]", "", "".join(lines))
    tokens = _STRATA_TOKEN_RE.findall(compact)
    if tokens:
        return [_normalize_stratum_name(token) for token in tokens]

    normalized_lines = [_normalize_stratum_name(line) for line in lines]
    return normalized_lines


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


def _normalize_stratum_name(value: Any) -> str:
    text = _to_text(value) or ""
    compact = re.sub(r"\s+", "", text)
    for alias, group in _STRATA_ALIASES.items():
        if alias in compact:
            return group
    normalized = normalize_strata(text)
    return STRATA_GROUP_MAP.get(normalized, normalized)


def _uses_auto_page_classification(box_definitions: dict[str, Any]) -> bool:
    boxes = box_definitions.get("boxes", [])
    return (
        box_definitions.get("mode") == "auto_borehole_pages"
        or any(box.get("template") in {"first", "continuation"} for box in boxes)
    )


def _extract_fields_on_page(
    doc: fitz.Document,
    page_number: int,
    boxes: list[dict[str, Any]],
    *,
    odl_elements: list[PdfElement] | None = None,
) -> dict[str, str]:
    if page_number < 1 or page_number > len(doc):
        return {}
    page = doc[page_number - 1]
    result: dict[str, str] = {}
    for box in boxes:
        label = box.get("label")
        rect = box.get("rect")
        if not label or not rect or len(rect) != 4:
            continue
        width, height = page.rect.width, page.rect.height
        clip = fitz.Rect(
            float(rect[0]) * width,
            float(rect[1]) * height,
            float(rect[2]) * width,
            float(rect[3]) * height,
        )
        text = page.get_text("text", clip=clip).strip()
        odl_text = _extract_odl_text_for_box(odl_elements, page, box)
        ocr_text = _ocr_text_for_clip(page, clip) if not text and not odl_text else ""
        text = _choose_best_box_text(
            pymupdf_text=text,
            odl_text=odl_text,
            ocr_text=ocr_text,
            field=str(label),
        )
        if text:
            result[label] = text
    return result


def _extract_odl_text_for_box(
    odl_elements: list[PdfElement] | None,
    page: fitz.Page,
    box: dict[str, Any],
) -> str:
    if not odl_elements:
        return ""
    rect = box.get("rect")
    if not rect or len(rect) != 4:
        return ""
    width, height = page.rect.width, page.rect.height
    pdf_space_box = (
        float(rect[0]) * width,
        height - (float(rect[3]) * height),
        float(rect[2]) * width,
        height - (float(rect[1]) * height),
    )
    elements = find_elements_in_box(
        odl_elements,
        page_number=page.number + 1,
        box=pdf_space_box,
    )
    return text_from_elements(elements)


def _ocr_text_for_clip(page: fitz.Page, clip: fitz.Rect) -> str:
    if not settings.pdf_box_ocr_enabled or pytesseract is None or Image is None:
        return ""
    if clip.is_empty or clip.width <= 0 or clip.height <= 0:
        return ""
    try:
        scale = max(float(settings.pdf_box_ocr_scale or 3.0), 1.0)
        pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip, alpha=False)
        image = Image.open(BytesIO(pixmap.tobytes("png")))
        text = pytesseract.image_to_string(
            image,
            lang=settings.pdf_box_ocr_lang,
            config="--psm 6",
        )
        return text.strip()
    except Exception:
        return ""


def _choose_best_box_text(*, pymupdf_text: str, odl_text: str, ocr_text: str = "", field: str) -> str:
    pymupdf_text = (pymupdf_text or "").strip()
    odl_text = (odl_text or "").strip()
    ocr_text = (ocr_text or "").strip()
    candidates = [text for text in [pymupdf_text, odl_text, ocr_text] if text]
    if not candidates:
        return ""
    if len(candidates) == 1:
        return candidates[0]

    field = field.lower()
    if field in {"depth", "bottom_depth", "top_depth", "x_coord", "y_coord", "tm_x", "tm_y", "elevation"}:
        return max(candidates, key=_numeric_text_score)
    if field in {"stratum_name", "soil_type"}:
        return max(candidates, key=_strata_text_score)
    if field in {"project_name", "borehole_name", "crs", "coordinates"}:
        return max(candidates, key=_general_text_score)
    return pymupdf_text


def _numeric_text_score(value: str) -> int:
    numbers = re.findall(r"[-+]?\d+(?:[,.]\d+)?", value)
    score = len(numbers) * 10
    score += min(len(value.strip()), 20)
    if re.search(r"\d\s*\n\s*\d", value):
        score -= 5
    return score


def _strata_text_score(value: str) -> int:
    compact = re.sub(r"\s+", "", value)
    tokens = _STRATA_TOKEN_RE.findall(compact)
    score = len(tokens) * 20
    lines = _split_lines(value)
    score += sum(10 for line in lines if _STRATA_TOKEN_RE.fullmatch(re.sub(r"\s+", "", line)))
    score += sum(1 for line in lines if _normalize_stratum_name(line) != "토사")
    score -= sum(3 for line in lines if len(re.sub(r"\s+", "", line)) == 1)
    score += min(len(compact), 30)
    return score


def _general_text_score(value: str) -> int:
    compact = re.sub(r"\s+", "", value)
    score = len(compact)
    if "�" in value:
        score -= 20
    if re.search(r"[가-힣A-Za-z0-9]", value):
        score += 10
    return score


def _normalize_borehole_name(value: Any) -> str | None:
    text = _to_text(value)
    if not text:
        return None
    for line in _split_lines(text):
        if _looks_like_elevation_text(line):
            continue
        normalized = normalize_bh_id(line)
        if _looks_like_borehole_id(normalized):
            return normalized
    if _looks_like_elevation_text(text):
        return None
    normalized = normalize_bh_id(text)
    if _looks_like_borehole_id(normalized):
        return normalized
    return None


def _looks_like_elevation_text(value: Any) -> bool:
    text = str(value or "").strip()
    if not text:
        return False
    if re.search(r"(표고|지반고|EL\.?|ELEV|ELEVATION|GROUND\s*LEVEL)", text, re.IGNORECASE):
        return True
    return bool(re.fullmatch(r"[-+]?\d+(?:[.,]\d+)?\s*(?:m|M)?", text))


def _looks_like_borehole_id(value: Any) -> bool:
    text = str(value or "").strip().upper()
    if not text:
        return False
    if not any(ch.isdigit() for ch in text):
        return False
    if not re.search(r"[A-Z]", text):
        return False
    if re.fullmatch(r"EL\d+|ELEV\d+|GL\d+", text):
        return False
    return bool(re.fullmatch(r"[A-Z]{1,8}-?\d+[A-Z0-9-]*", text))


def _metadata_from_fields(fields: dict[str, str], fallback_project_name: str) -> dict[str, Any]:
    borehole_name = _normalize_borehole_name(fields.get("borehole_name")) or "BH-1"
    source_crs = _to_text(fields.get("crs"))
    raw_x, raw_y = _coordinates_from_fields(fields)
    lon, lat, tmx, tmy, final_epsg = normalize_coordinates(
        raw_x,
        raw_y,
        borehole_id=borehole_name,
        source_crs=source_crs,
    )
    return {
        "project_name": _to_text(fields.get("project_name")) or fallback_project_name,
        "borehole_name": borehole_name,
        "raw_x": raw_x,
        "raw_y": raw_y,
        "elevation": clean_float(fields.get("elevation")),
        "lon_wgs84": lon,
        "lat_wgs84": lat,
        "tm_x": tmx,
        "tm_y": tmy,
        "meta_crs": final_epsg,
    }


def _has_table_fields(fields: dict[str, str]) -> bool:
    return bool(_split_lines(fields.get("depth")) or _split_lines(fields.get("bottom_depth"))) and bool(
        _split_lines(fields.get("stratum_name"))
    )


def _table_boxes(boxes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [box for box in boxes if box.get("label") in {"depth", "bottom_depth", "top_depth", "stratum_name"}]


def _rows_from_manual_fields(
    *,
    fields: dict[str, str],
    meta: dict[str, Any],
    previous_bottom: float,
) -> tuple[list[dict[str, Any]], float]:
    top_depths = _split_depth_values(fields.get("top_depth"))
    bottom_depths = _split_depth_values(fields.get("depth")) or _split_depth_values(fields.get("bottom_depth"))
    strata_names = _split_strata_lines(fields.get("stratum_name"))
    row_count = max(len(bottom_depths), len(strata_names))

    rows: list[dict[str, Any]] = []
    current_bottom = previous_bottom
    for index in range(row_count):
        bottom = clean_float(bottom_depths[index]) if index < len(bottom_depths) else None
        if bottom is None or bottom <= current_bottom:
            continue

        top = clean_float(top_depths[index]) if index < len(top_depths) else current_bottom
        if top is None:
            top = current_bottom

        stratum_name = _normalize_stratum_name(strata_names[index] if index < len(strata_names) else None)
        rows.append(
            {
                "프로젝트명": meta["project_name"],
                "시추공명": meta["borehole_name"],
                "경도": meta["raw_x"],
                "위도": meta["raw_y"],
                "표고": meta["elevation"],
                "상심도": top,
                "하심도": bottom,
                "지층명": stratum_name,
                "lon_wgs84": meta["lon_wgs84"],
                "lat_wgs84": meta["lat_wgs84"],
                "tm_x": meta["tm_x"],
                "tm_y": meta["tm_y"],
                "meta_crs": meta["meta_crs"],
            }
        )
        current_bottom = bottom

    return rows, current_bottom
