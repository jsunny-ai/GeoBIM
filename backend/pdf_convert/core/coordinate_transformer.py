"""TM ↔ WGS84 좌표 변환 모듈.

순수 Python 수식 경로 (엑셀 수식 기반):
  TM경위도변환.xls (국토지리정보원 공개 참조 자료)
  - '!' 시트: TM(X,Y) → 경위도
  - '!!' 시트: 경위도 → TM(X,Y)

GRS80 계열(EPSG:5181/5183/5186/5187): 순수 Python 경로만 사용.
Bessel 계열(EPSG:5174/5176): 순수 Python으로 TM→Bessel 지리좌표 변환 후
    pyproj로 Bessel→WGS84 7-파라미터 Helmert 변환.
"""
import logging
import math
import re

logger = logging.getLogger(__name__)


# ===========================================================================
# 1. 타원체 및 TM 파라미터 (엑셀 Q열 상수)
# ===========================================================================

class _TmParams:
    """TM 투영 파라미터 컨테이너.

    ellipsoid : 'bessel' 또는 'grs80'
    central_meridian : 투영 원점 경도(°)
    false_northing   : 원점 X(N) 가산수 (m)
    false_easting    : 원점 Y(E) 가산수 (m)  — 고정 200000
    central_latitude : 투영 원점 위도(°)    — 고정 38
    scale_factor     : 축척계수              — 고정 1
    """

    def __init__(self, ellipsoid='grs80', central_meridian=127.0,
                 false_northing=500000.0, false_easting=200000.0,
                 central_latitude=38.0, scale_factor=1.0):

        # 엑셀 Q1: 장반경 a
        # 엑셀 Q2: 편평률 f
        if ellipsoid == 'bessel':
            self.a = 6377397.155
            self.f = 1.0 / 299.1528128
        else:  # grs80
            self.a = 6378137.0
            self.f = 1.0 / 298.257222101

        # 엑셀 Q3: 단반경 b = a*(1-f)
        self.b = self.a * (1.0 - self.f)
        # 엑셀 Q9: 제1이심률² e² = (a²-b²)/a²
        self.e2 = (self.a**2 - self.b**2) / self.a**2
        # 엑셀 Q10: 제2이심률² e'² = (a²-b²)/b²
        self.ep2 = (self.a**2 - self.b**2) / self.b**2
        # 엑셀 Q12: e1 = (1-√(1-e²))/(1+√(1-e²))
        self.e1 = (1.0 - math.sqrt(1.0 - self.e2)) / (1.0 + math.sqrt(1.0 - self.e2))

        # 엑셀 Q4: 축척계수 ko
        self.ko = scale_factor
        # 엑셀 Q5: 원점 X(N) 가산수
        self.fn = false_northing
        # 엑셀 Q6: 원점 Y(E) 가산수
        self.fe = false_easting
        # 엑셀 Q7(=R7 변환): 원점 위도 φo (radians)
        self.phi0 = math.radians(central_latitude)
        # 엑셀 Q8(=R8 변환): 원점 경도 λo (radians)
        self.lam0 = math.radians(central_meridian)

        # 엑셀 Q11: 원점에서의 자오선호 Mo
        e2, a, phi0 = self.e2, self.a, self.phi0
        self.Mo = a * (
            (1 - e2/4 - 3*e2**2/64 - 5*e2**3/256) * phi0
            - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024) * math.sin(2*phi0)
            + (15*e2**2/256 + 45*e2**3/1024) * math.sin(4*phi0)
            - (35*e2**3/3072) * math.sin(6*phi0)
        )


def _p(ellipsoid, lon0, fn):
    return _TmParams(ellipsoid=ellipsoid, central_meridian=lon0, false_northing=fn)


# 한국 좌표계 프리셋
_PRESETS = {
    # GRS80 기반 (현행)
    'EPSG:5186': _p('grs80',   127.0,                600000.0),
    'EPSG:5187': _p('grs80',   129.0,                600000.0),
    'EPSG:5181': _p('grs80',   127.0,                500000.0),
    'EPSG:5183': _p('grs80',   129.0,                500000.0),
    # Bessel 기반 (구형)
    'EPSG:5174': _p('bessel',  127.0028902777778,    500000.0),
    'EPSG:5176': _p('bessel',  129.0028902777778,    500000.0),
}

_GRS80_EPSG = {'EPSG:5186', 'EPSG:5187', 'EPSG:5181', 'EPSG:5183'}
_BESSEL_EPSG = {'EPSG:5174', 'EPSG:5176'}


# ===========================================================================
# 2. 순수 Python TM 변환 (엑셀 수식 1:1 대응)
# ===========================================================================

def tm_to_latlon(x_northing: float, y_easting: float,
                 params: _TmParams) -> tuple:
    """TM(X=Northing, Y=Easting) → (위도°, 경도°).

    엑셀 '!' 시트 열 대응:
      A = 보정 자오선호 M
      B = 초기 풋프린트 위도 φ1
      C = Bowring 보정 풋프린트 위도 φ1 (확정)
      D = 자오선 곡률반경 R
      E = C1 = e'²·cos²φ1
      F = T1 = tan²φ1
      G = 묘유선 곡률반경 N
      H = 무차원 동서거리 D
      I = 위도(°)
      J = 경도(°)
    """
    a, e2, ep2, e1, ko = params.a, params.e2, params.ep2, params.e1, params.ko
    fn, fe, Mo, lam0 = params.fn, params.fe, params.Mo, params.lam0

    # 엑셀 A열: M = Mo + (X - FN) / ko
    M = Mo + (x_northing - fn) / ko

    # 엑셀 B열: 초기 풋프린트 위도
    phi1_init = M / (a * (1 - e2/4 - 3*e2**2/64 - 5*e2**3/256))

    # 엑셀 C열: Bowring 급수 보정
    phi1 = (phi1_init
            + (3*e1/2    - 27*e1**3/32)  * math.sin(2*phi1_init)
            + (21*e1**2/16 - 55*e1**4/32) * math.sin(4*phi1_init)
            + (151*e1**3/96)              * math.sin(6*phi1_init)
            + (1097*e1**4/512)            * math.sin(8*phi1_init))

    # 엑셀 D열: 자오선 곡률반경 R
    R = (a * (1 - e2)) / (1 - e2 * math.sin(phi1)**2) ** 1.5

    # 엑셀 E열: C1
    C = ep2 * math.cos(phi1)**2

    # 엑셀 F열: T1
    T = math.tan(phi1)**2

    # 엑셀 G열: 묘유선 곡률반경 N
    N = a / math.sqrt(1 - e2 * math.sin(phi1)**2)

    # 엑셀 H열: D (무차원 동서 거리)
    D = (y_easting - fe) / (N * ko)

    # 엑셀 I열: 위도 (도)
    lat_rad = (phi1
               - (N * math.tan(phi1) / R)
               * (  D**2 / 2
                  - D**4 / 24 * (5 + 3*T + 10*C - 4*C**2 - 9*ep2)
                  + D**6 / 720 * (61 + 90*T + 298*C + 45*T**2 - 252*ep2 - 3*C**2)))

    # 엑셀 J열: 경도 (도) — 10.405" 보정 없음 (N13=FALSE)
    lon_deg = (math.degrees(lam0)
               + math.degrees(
                   (1.0 / math.cos(phi1))
                   * (  D
                      - D**3 / 6   * (1 + 2*T + C)
                      + D**5 / 120 * (5 - 2*C + 28*T - 3*C**2 + 8*ep2 + 24*T**2))))

    return math.degrees(lat_rad), lon_deg


def latlon_to_tm(lat_deg: float, lon_deg: float,
                 params: _TmParams) -> tuple:
    """(위도°, 경도°) → TM(X=Northing, Y=Easting).

    엑셀 '!!' 시트 열 대응:
      A = φ (radians)
      B = λ (radians)
      C = T = tan²φ
      D = C = e'²·cos²φ
      E = A_val = (λ-λo)·cosφ
      F = N (묘유선 곡률반경)
      G = M (자오선호)
      H = X(N)
      I = Y(E)
    """
    a, e2, ep2, ko = params.a, params.e2, params.ep2, params.ko
    fn, fe, Mo, lam0 = params.fn, params.fe, params.Mo, params.lam0

    # 엑셀 A열: φ (rad)
    phi = math.radians(lat_deg)

    # 엑셀 B열: λ (rad) — 10.405" 보정 없음
    lam = math.radians(lon_deg)

    # 엑셀 C열: T = tan²φ
    T = math.tan(phi)**2

    # 엑셀 D열: C = e²/(1-e²) · cos²φ  [= e'²·cos²φ]
    C = (e2 / (1 - e2)) * math.cos(phi)**2

    # 엑셀 E열: A_val = (λ - λo) · cosφ
    A_val = (lam - lam0) * math.cos(phi)

    # 엑셀 F열: N (묘유선 곡률반경)
    N = a / math.sqrt(1 - e2 * math.sin(phi)**2)

    # 엑셀 G열: 자오선호 M
    M = a * (
        (1 - e2/4 - 3*e2**2/64 - 5*e2**3/256) * phi
        - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024) * math.sin(2*phi)
        + (15*e2**2/256 + 45*e2**3/1024) * math.sin(4*phi)
        - 35*e2**3/3072 * math.sin(6*phi)
    )

    # 엑셀 H열: X(N)
    x_northing = (fn + ko * (
        M - Mo
        + N * math.tan(phi) * (
              A_val**2 / 2
            + A_val**4 / 24  * (5 - T + 9*C + 4*C**2)
            + A_val**6 / 720 * (61 - 58*T + T**2 + 600*C - 330*ep2)
        )
    ))

    # 엑셀 I열: Y(E)
    y_easting = (fe + ko * N * (
          A_val
        + A_val**3 / 6   * (1 - T + C)
        + A_val**5 / 120 * (5 - 18*T + T**2 + 72*C - 58*ep2)
    ))

    return x_northing, y_easting


# ===========================================================================
# 3. Bessel → WGS84 Helmert 변환 (pyproj 위임, GRS80 불필요)
# ===========================================================================

_bessel_transformers = {}
try:
    from pyproj import Transformer
    for _epsg in _BESSEL_EPSG:
        _bessel_transformers[_epsg] = Transformer.from_crs(
            _PRESETS[_epsg].__dict__.get('_proj_str', _epsg),
            'EPSG:4326', always_xy=True
        )
    _bessel_transformers = {}  # reset — use proj string directly below
    for _epsg, _ps in {
        'EPSG:5174': ('+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 '
                      '+x_0=200000 +y_0=500000 +ellps=bessel +units=m '
                      '+towgs84=-145.907,505.034,685.756,-1.162,2.347,1.592,6.342 +no_defs'),
        'EPSG:5176': ('+proj=tmerc +lat_0=38 +lon_0=129.0028902777778 +k=1 '
                      '+x_0=200000 +y_0=500000 +ellps=bessel +units=m '
                      '+towgs84=-145.907,505.034,685.756,-1.162,2.347,1.592,6.342 +no_defs'),
    }.items():
        _bessel_transformers[_epsg] = Transformer.from_crs(_ps, 'EPSG:4326', always_xy=True)

    # WGS84 → EPSG:5186 (tm_x/tm_y 역산용)
    _to_5186 = Transformer.from_crs('EPSG:4326', 'EPSG:5186', always_xy=True)
    _pyproj_ok = True
except Exception as _e:
    logger.warning(f"pyproj 초기화 실패 — Bessel 변환 불가: {_e}")
    _pyproj_ok = False

from pdf_convert.core.spatial_validator import SpatialValidator
_validator = SpatialValidator()


# ===========================================================================
# 4. 공개 API
# ===========================================================================

def normalize_coordinates(x_val, y_val, borehole_id='Unknown', source_crs=None):
    """TM 또는 WGS84 입력 좌표를 WGS84(lon, lat)로 정규화.

    Parameters
    ----------
    x_val : str | float   경도/X(N) 원시값
    y_val : str | float   위도/Y(E) 원시값
    borehole_id : str     로그 식별자
    source_crs  : str     문서에서 추출한 EPSG 코드 (예: 'EPSG:5186')

    Returns
    -------
    (lon_wgs84, lat_wgs84, tm_x, tm_y, final_epsg)  — 실패 시 ('','','','', epsg)
    """
    # --- 입력 정규화 ---
    try:
        if not x_val or not y_val:
            return '', '', '', '', source_crs or 'UNKNOWN'
        x_str = re.sub(r'[^\d.\-]', '', str(x_val).replace(',', '').strip())
        y_str = re.sub(r'[^\d.\-]', '', str(y_val).replace(',', '').strip())
        if not x_str or not y_str:
            return '', '', '', '', source_crs or 'UNKNOWN'
        x = float(x_str)
        y = float(y_str)
    except Exception:
        return '', '', '', '', source_crs or 'UNKNOWN'

    lon_wgs84 = lat_wgs84 = None
    final_epsg = source_crs or 'UNKNOWN'

    # [Scale Error 보정] 동부원점(lon_0=129)은 제외
    _DONGBU = ('EPSG:5187', 'EPSG:5183', 'EPSG:5176')
    if x < 30000 and source_crs != 'WGS84' and source_crs not in _DONGBU:
        x *= 10

    # --- WGS84 직접 입력 ---
    if source_crs == 'WGS84':
        lon_wgs84, lat_wgs84 = x, y

    # --- GRS80 TM → WGS84 (순수 Python, 엑셀 수식) ---
    elif source_crs in _GRS80_EPSG:
        params = _PRESETS[source_crs]
        easting, northing = (x, y) if x < y else (y, x)
        try:
            lat, lon = tm_to_latlon(northing, easting, params)
            lon_wgs84, lat_wgs84 = lon, lat
        except Exception as e:
            logger.error(f'[GRS80 변환 실패: {borehole_id}] {e}')

    # --- Bessel TM → WGS84 (pyproj Helmert 변환) ---
    elif source_crs in _BESSEL_EPSG and _pyproj_ok:
        easting, northing = (x, y) if x < y else (y, x)
        try:
            lon_temp, lat_temp = _bessel_transformers[source_crs].transform(easting, northing)
            lon_wgs84, lat_wgs84 = lon_temp, lat_temp
        except Exception as e:
            logger.error(f'[Bessel 변환 실패: {borehole_id}] {e}')

    # --- CRS 미확정: Northing 수치로 추정 ---
    elif source_crs is None and max(x, y) > 100000:
        northing_val = max(x, y)
        inferred = 'EPSG:5186' if northing_val > 550000 else 'EPSG:5181'
        if 480000 <= northing_val <= 550000:
            logger.warning(f'[Ambiguous FN: {borehole_id}] Northing={northing_val:.0f} — {inferred} 추정')
        params = _PRESETS[inferred]
        easting, northing = (x, y) if x < y else (y, x)
        try:
            lat, lon = tm_to_latlon(northing, easting, params)
            lon_wgs84, lat_wgs84 = lon, lat
            final_epsg = inferred + '_INFERRED'
        except Exception as e:
            logger.error(f'[추정 CRS 변환 실패: {borehole_id}] {e}')

    else:
        logger.warning(f'[Missing CRS: {borehole_id}] 좌표계 미확인 — WGS84 변환 생략.')

    # --- 역산: WGS84 → EPSG:5186 TM (tm_x, tm_y) ---
    tm_x = tm_y = ''
    if lon_wgs84 is not None and lat_wgs84 is not None:
        try:
            if _pyproj_ok:
                _tx, _ty = _to_5186.transform(lon_wgs84, lat_wgs84)
            else:
                _ty, _tx = latlon_to_tm(lat_wgs84, lon_wgs84, _PRESETS['EPSG:5186'])
            tm_x = round(_tx, 3)
            tm_y = round(_ty, 3)
            lon_wgs84 = round(lon_wgs84, 7)
            lat_wgs84 = round(lat_wgs84, 7)
        except Exception:
            pass
    else:
        lon_wgs84 = lat_wgs84 = ''

    return lon_wgs84, lat_wgs84, tm_x, tm_y, final_epsg
