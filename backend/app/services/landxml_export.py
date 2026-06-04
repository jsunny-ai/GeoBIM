# =============================================================================
# landxml_export.py — RBF 보간 그리드 → LandXML 1.2 TIN Surface 변환
#
# Civil 3D 호환 LandXML 1.2 포맷으로 각 지층 경계면을 TIN Surface로 직렬화합니다.
# 좌표계: WGS84 경위도 → 미터 단위 평면 좌표 (pyproj 없이 순수 수학 변환)
# 포맷: Northing(m) Easting(m) Elevation(m) — Civil 3D 미터 단위 정상 표시
# =============================================================================

from datetime import date, datetime
import math, sys, logging
logging.getLogger(__name__).warning(f"[LANDXML] 로드된 파일: {__file__}")

LAYER_LABELS: dict[str, str] = {
    "ground_surface": "지표면",
    "soil":           "풍화암_상부면",
    "weathered_rock": "연암_상부면",
    "soft_rock":      "보통암_상부면",
    "normal_rock":    "경암_상부면",
    "hard_rock":      "최하단_경계면",
}

# GRS80 타원체 상수
_A  = 6_378_137.0          # 장반경 (m)
_F  = 1 / 298.257222101    # 편평률
_E2 = 2 * _F - _F ** 2    # 이심률 제곱

# EPSG:5186 (한국 2000 중부원점) Transverse Mercator 파라미터
_LAT0  = math.radians(38.0)   # 원점 위도
_LON0  = math.radians(127.0)  # 중앙 경선
_K0    = 1.0                   # 축척 계수
_FE    = 200_000.0             # 가산 동거리 (m)
_FN    = 600_000.0             # 가산 북거리 (m)


def _meridian_arc(phi: float) -> float:
    """원점에서 위도 phi까지의 자오선 호장(m)."""
    e2 = _E2
    e4 = e2 ** 2
    e6 = e2 ** 3
    return _A * (
        (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
        - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * math.sin(2 * phi)
        + (15 * e4 / 256 + 45 * e6 / 1024) * math.sin(4 * phi)
        - (35 * e6 / 3072) * math.sin(6 * phi)
    )


def _wgs84_to_tm(lng_deg: float, lat_deg: float) -> tuple[float, float]:
    """
    WGS84 경위도 → EPSG:5186 Transverse Mercator (Easting, Northing) 미터 변환.
    pyproj 없이 순수 수학으로 구현합니다.
    """
    phi = math.radians(lat_deg)
    lam = math.radians(lng_deg)
    dlam = lam - _LON0

    e2 = _E2
    N = _A / math.sqrt(1 - e2 * math.sin(phi) ** 2)  # 묘유 곡률 반경
    T = math.tan(phi) ** 2
    C = e2 / (1 - e2) * math.cos(phi) ** 2
    Ap = math.cos(phi) * dlam

    M  = _meridian_arc(phi)
    M0 = _meridian_arc(_LAT0)

    easting = _FE + _K0 * N * (
        Ap
        + (1 - T + C) * Ap ** 3 / 6
        + (5 - 18 * T + T ** 2 + 72 * C - 58 * e2 / (1 - e2)) * Ap ** 5 / 120
    )

    northing = _FN + _K0 * (
        (M - M0)
        + N * math.tan(phi) * (
            Ap ** 2 / 2
            + (5 - T + 9 * C + 4 * C ** 2) * Ap ** 4 / 24
            + (61 - 58 * T + T ** 2 + 600 * C - 330 * e2 / (1 - e2)) * Ap ** 6 / 720
        )
    )

    return easting, northing


def grid_to_landxml(
    bbox: list[float],
    grids: dict[str, list[list[float]]],
    layers: list[str],
    date_str: str | None = None,
    time_str: str | None = None,
) -> str:
    date_str = date_str or date.today().isoformat()
    time_str = time_str or datetime.now().strftime("%H:%M:%S")

    min_lng, min_lat, max_lng, max_lat = bbox

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
        '  <CoordinateSystem name="Korea 2000 Central Belt 2010" epsgCode="5186"/>\n'
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

    # ── Points (Northing Easting Elevation, 단위 m) ──────────────────────────
    pnts_lines: list[str] = []
    pid = 1
    for j in range(res):
        lat = lats[j]
        for i in range(res):
            lng = lngs[i]
            elev = grid[j][i]
            easting, northing = _wgs84_to_tm(lng, lat)
            pnts_lines.append(
                f'          <P id="{pid}">{northing:.3f} {easting:.3f} {elev:.4f}</P>'
            )
            pid += 1

    # ── Faces (2×2 셀 → 삼각형 2개) ─────────────────────────────────────────
    face_lines: list[str] = []
    for j in range(res - 1):
        for i in range(res - 1):
            a = j * res + i + 1
            b = j * res + i + 2
            c = (j + 1) * res + i + 1
            d = (j + 1) * res + i + 2
            face_lines.append(f"          <F>{a} {b} {d}</F>")
            face_lines.append(f"          <F>{a} {d} {c}</F>")

    pnts_block  = "\n".join(pnts_lines)
    faces_block = "\n".join(face_lines)

    return (
        f'    <Surface name="{name}">\n'
        '      <Definition surfType="TIN">\n'
        "        <Pnts>\n"
        f"{pnts_block}\n"
        "        </Pnts>\n"
        "        <Faces>\n"
        f"{faces_block}\n"
        "        </Faces>\n"
        "      </Definition>\n"
        "    </Surface>"
    )
