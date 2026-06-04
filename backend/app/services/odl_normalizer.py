"""Normalize OpenDataLoader PDF JSON into searchable page elements."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class PdfElement:
    page_number: int
    type: str
    text: str
    bbox: tuple[float, float, float, float]
    row: int | None = None
    col: int | None = None


def flatten_odl_json(data: dict[str, Any] | None) -> list[PdfElement]:
    """Flatten ODL's nested JSON into text-bearing elements."""
    if not data:
        return []

    elements: list[PdfElement] = []
    for child in data.get("kids") or []:
        _visit_node(child, elements)
    return elements


def find_elements_in_box(
    elements: list[PdfElement],
    *,
    page_number: int,
    box: tuple[float, float, float, float],
    min_overlap: float = 0.05,
) -> list[PdfElement]:
    """Return ODL elements whose bbox intersects the requested PDF-space box."""
    matches = [
        element
        for element in elements
        if element.page_number == page_number and _overlap_ratio(element.bbox, box) >= min_overlap
    ]
    return sorted(matches, key=lambda item: (item.bbox[1], item.bbox[0]))


def text_from_elements(elements: list[PdfElement]) -> str:
    """Join element text in visual order while preserving row-like breaks."""
    lines: list[str] = []
    for element in elements:
        text = " ".join(str(element.text).split())
        if text:
            lines.append(text)
    return "\n".join(lines)


def _visit_node(
    node: dict[str, Any],
    elements: list[PdfElement],
    *,
    inherited_page: int | None = None,
    row: int | None = None,
    col: int | None = None,
) -> None:
    page_number = _to_int(node.get("page number")) or inherited_page
    node_type = str(node.get("type") or "")
    bbox = _bbox(node.get("bounding box"))
    text = _node_text(node)

    if page_number is not None and bbox is not None and text:
        elements.append(
            PdfElement(
                page_number=page_number,
                type=node_type,
                text=text,
                bbox=bbox,
                row=row or _to_int(node.get("row number")),
                col=col or _to_int(node.get("column number")),
            )
        )

    if node_type == "table":
        for table_row in node.get("rows") or []:
            row_number = _to_int(table_row.get("row number"))
            for cell in table_row.get("cells") or []:
                _visit_node(
                    cell,
                    elements,
                    inherited_page=page_number,
                    row=row_number,
                    col=_to_int(cell.get("column number")),
                )
        return

    for key in ("kids", "children", "content", "contents"):
        children = node.get(key)
        if isinstance(children, list):
            for child in children:
                if isinstance(child, dict):
                    _visit_node(
                        child,
                        elements,
                        inherited_page=page_number,
                        row=row or _to_int(node.get("row number")),
                        col=col or _to_int(node.get("column number")),
                    )


def _node_text(node: dict[str, Any]) -> str:
    direct = node.get("content") or node.get("text")
    if isinstance(direct, str):
        return direct.strip()

    texts: list[str] = []
    for child in node.get("kids") or []:
        if isinstance(child, dict):
            child_text = _node_text(child)
            if child_text:
                texts.append(child_text)
    return "\n".join(texts)


def _bbox(value: Any) -> tuple[float, float, float, float] | None:
    if not isinstance(value, list | tuple) or len(value) != 4:
        return None
    try:
        left, bottom, right, top = [float(item) for item in value]
    except (TypeError, ValueError):
        return None
    return (min(left, right), min(bottom, top), max(left, right), max(bottom, top))


def _overlap_ratio(
    candidate: tuple[float, float, float, float],
    target: tuple[float, float, float, float],
) -> float:
    left = max(candidate[0], target[0])
    bottom = max(candidate[1], target[1])
    right = min(candidate[2], target[2])
    top = min(candidate[3], target[3])
    if right <= left or top <= bottom:
        return 0.0

    intersection = (right - left) * (top - bottom)
    candidate_area = max((candidate[2] - candidate[0]) * (candidate[3] - candidate[1]), 0.0)
    target_area = max((target[2] - target[0]) * (target[3] - target[1]), 0.0)
    denominator = min(candidate_area, target_area)
    if denominator <= 0:
        return 0.0
    return intersection / denominator


def _to_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
