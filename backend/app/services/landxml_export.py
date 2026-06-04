# =============================================================================
# landxml_export.py — RBF 보간 그리드 → LandXML 1.2 TIN Surface 변환
#
# Civil 3D 호환 LandXML 1.2 포맷으로 각 지층 경계면을 TIN Surface로 직렬화합니다.
# 좌표 포맷: Northing(lat) Easting(lng) Elevation  (LandXML 표준 순서)
# =============================================================================

from datetime import date, datetime


LAYER_LABELS: dict[str, str] = {
    "soil":           "토사_하한면",
    "weathered_rock": "풍화암_하한면",
    "soft_rock":      "연암_하한면",
    "normal_rock":    "보통암_하한면",
    "hard_rock":      "경암_하한면",
}


def grid_to_landxml(
    bbox: list[float],
    grids: dict[str, list[list[float]]],
    layers: list[str],
    date_str: str | None = None,
    time_str: str | None = None,
) -> str:
    """
    RBF 보간 결과 그리드를 LandXML 1.2 문서로 변환합니다.

    Args:
        bbox:     [min_lng, min_lat, max_lng, max_lat]
        grids:    {layer_name: res×res 2D 절대표고 격자}  (ex. grids["soil"][j][i])
        layers:   내보낼 지층 키 목록 (순서대로 Surface 생성)
        date_str: "YYYY-MM-DD"  (기본: 오늘)
        time_str: "HH:MM:SS"   (기본: 현재 시각)

    Returns:
        LandXML 1.2 XML 문자열
    """
    date_str = date_str or date.today().isoformat()
    time_str = time_str or datetime.now().strftime("%H:%M:%S")

    min_lng, min_lat, max_lng, max_lat = bbox

    # 첫 번째 그리드로 해상도 결정
    first_grid = next((grids[k] for k in layers if k in grids), None)
    if first_grid is None:
        raise ValueError("내보낼 수 있는 지층 데이터가 없습니다.")

    res = len(first_grid)
    lngs = [min_lng + (max_lng - min_lng) * i / (res - 1) for i in range(res)]
    lats = [min_lat + (max_lat - min_lat) * j / (res - 1) for j in range(res)]

    surfaces_xml_parts: list[str] = []
    for layer_name in layers:
        if layer_name not in grids:
            continue
        label = LAYER_LABELS.get(layer_name, layer_name)
        surfaces_xml_parts.append(
            _surface_xml(label, lngs, lats, grids[layer_name], res)
        )

    surfaces_block = "\n".join(surfaces_xml_parts)

    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<LandXML version="1.2" xmlns="http://www.landxml.org/schema/LandXML-1.2"\n'
        f'  date="{date_str}" time="{time_str}" language="Korean" readOnly="false">\n'
        "  <Units>\n"
        '    <Metric linearUnit="meter" areaUnit="squareMeter" volumeUnit="cubicMeter"\n'
        '      temperatureUnit="celsius" pressureUnit="milliBars"\n'
        '      angularUnit="decimal dd.mm.ss" directionUnit="decimal dd.mm.ss"/>\n'
        "  </Units>\n"
        '  <CoordinateSystem name="GRS80" epsgCode="4326"/>\n'
        "  <Surfaces>\n"
        f"{surfaces_block}\n"
        "  </Surfaces>\n"
        "</LandXML>"
    )


def _surface_xml(
    name: str,
    lngs: list[float],
    lats: list[float],
    grid: list[list[float]],
    res: int,
) -> str:
    """NxN 격자 하나를 <Surface> 블록으로 변환합니다."""

    # ── Points ────────────────────────────────────────────────────────────────
    pnts_lines: list[str] = []
    pid = 1
    for j in range(res):
        lat = lats[j]
        for i in range(res):
            lng = lngs[i]
            elev = grid[j][i]
            pnts_lines.append(f'          <P id="{pid}">{lat:.8f} {lng:.8f} {elev:.4f}</P>')
            pid += 1

    # ── Faces (각 2×2 셀 → 삼각형 2개) ─────────────────────────────────────
    face_lines: list[str] = []
    for j in range(res - 1):
        for i in range(res - 1):
            a = j * res + i + 1        # 상좌
            b = j * res + i + 2        # 상우
            c = (j + 1) * res + i + 1  # 하좌
            d = (j + 1) * res + i + 2  # 하우
            face_lines.append(f"          <F>{a} {b} {d}</F>")
            face_lines.append(f"          <F>{a} {d} {c}</F>")

    pnts_block = "\n".join(pnts_lines)
    faces_block = "\n".join(face_lines)

    return (
        f'    <Surface name="{name}">\n'
        "      <Definition surfType=\"TIN\">\n"
        "        <Pnts>\n"
        f"{pnts_block}\n"
        "        </Pnts>\n"
        "        <Faces>\n"
        f"{faces_block}\n"
        "        </Faces>\n"
        "      </Definition>\n"
        "    </Surface>"
    )
