import numpy as np
from scipy.interpolate import RBFInterpolator

class GeologicalRBF:
    """
    RBF(Radial Basis Function)를 이용하여 다중 지층의 3D 연속 곡면 격자를 생성하는 보간기입니다.
    """
    def __init__(self, actual_boreholes: list[dict], phantom_boreholes: list[dict]):
        self.all_boreholes = actual_boreholes + phantom_boreholes
        
        # 5,000배의 평면 vs 수직 고도 스케일 왜곡 방지를 위해 실제 미터(meters) 단위 좌표계 매핑
        mid_lat = np.mean([bh["latitude"] for bh in self.all_boreholes]) if self.all_boreholes else 37.26
        cos_lat = np.cos(np.radians(mid_lat))
        
        coords = []
        for bh in self.all_boreholes:
            xm = bh["longitude"] * 111320 * cos_lat
            ym = bh["latitude"] * 110540
            coords.append([xm, ym])
        self.points = np.array(coords)

        # 수치 연산 발산 방지 및 정확도 극대화를 위한 Center Shift(중심 이동 상대 좌표화)
        if len(self.points) > 0:
            self.center_x = np.mean(self.points[:, 0])
            self.center_y = np.mean(self.points[:, 1])
            self.shifted_points = self.points - [self.center_x, self.center_y]
        else:
            self.center_x = 0.0
            self.center_y = 0.0
            self.shifted_points = self.points

    def get_layer_boundary_elevations(self, layer_name: str) -> np.ndarray:
        """
        각 시추공의 특정 지층 하한면(Bottom) 절대 표고를 추출합니다.
        지층 데이터가 누락된 시추공의 경우 인접 시추공 보간법이나 NaN 대체 처리를 합니다.
        """
        elevations = []
        for bh in self.all_boreholes:
            elev = bh["elevation"]
            strata = bh.get("strata", [])
            
            # 특정 지층의 depth_bottom 찾기
            found = False
            for s in strata:
                if s.get("strata_group") == layer_name:
                    # 절대 표고 = 시추공 표고 - 하한 심도
                    elevations.append(elev - s.get("depth_bottom", 0.0))
                    found = True
                    break
            
            if not found:
                # 해당 지층이 없는 시추공의 경우, 레이어 스택 순서에 따른 표고를 대략적으로 추정
                # 토사의 하한면이 없으면 시추공 표고 자체를 리턴 (두께 0)
                if layer_name == "soil":
                    elevations.append(elev)
                elif layer_name == "weathered_rock":
                    # 이전 지층(soil)의 바닥 높이 활용
                    soil_bot = self._get_bh_layer_bottom(bh, "soil")
                    elevations.append(soil_bot if soil_bot is not None else elev)
                elif layer_name == "soft_rock":
                    wr_bot = self._get_bh_layer_bottom(bh, "weathered_rock")
                    elevations.append(wr_bot if wr_bot is not None else elev)
                else: # hard_rock
                    sr_bot = self._get_bh_layer_bottom(bh, "soft_rock")
                    elevations.append(sr_bot if sr_bot is not None else elev)
                    
        return np.array(elevations)

    def _get_bh_layer_bottom(self, bh: dict, layer_name: str) -> float | None:
        elev = bh["elevation"]
        for s in bh.get("strata", []):
            if s.get("strata_group") == layer_name:
                return elev - s.get("depth_bottom", 0.0)
        return None

    def interpolate_boundary(self, layer_name: str, grid_x: np.ndarray, grid_y: np.ndarray) -> np.ndarray:
        """
        단일 지층 경계면의 2D 격자 보간을 수행합니다 (Thin Plate Spline Kernel).
        """
        vals = self.get_layer_boundary_elevations(layer_name)
        
        # 1. 시추공 좌표와 보간 고도 매핑
        # 만약 유효한 데이터가 아예 없는 예외 케이스 처리
        if len(self.points) == 0 or len(vals) == 0:
            return np.zeros_like(grid_x)

        # 2. RBFInterpolator 생성 및 예측
        # thin_plate_spline 기저 함수와 1차 다항식(degree=1) 트렌드를 결합하여 광역 안정성 확보
        rbf = RBFInterpolator(self.points, vals, kernel="thin_plate_spline", degree=1)
        
        # 격자 좌표 플랫화
        grid_pts = np.vstack([grid_x.ravel(), grid_y.ravel()]).T
        grid_vals = rbf(grid_pts)
        
        return grid_vals.reshape(grid_x.shape)

    def build_grid(self, bbox: list[float], res: int = 48,
                   surf_elev_grid: np.ndarray | None = None) -> dict:
        """
        비례 심도 보간(Proportional Depth Interpolation)을 통해 이중 레이어 현상을 해결하고 지층 형태를 보존합니다.
        """
        min_lng, min_lat, max_lng, max_lat = bbox

        # 1. 2D 격자 좌표 생성 및 중심 이동 상대 격자 생성
        x = np.linspace(min_lng, max_lng, res)
        y = np.linspace(min_lat, max_lat, res)
        grid_x, grid_y = np.meshgrid(x, y)
        mid_lat = (min_lat + max_lat) / 2
        cos_lat = np.cos(np.radians(mid_lat))
        
        # 상대 좌표 격자화
        grid_xm = (grid_x * 111320 * cos_lat) - self.center_x
        grid_ym = (grid_y * 110540) - self.center_y

        # 2. 각 시추공별 실제 최대 시추 깊이(max_depth) 추출 및 보간
        bh_max_depths = []
        for bh in self.all_boreholes:
            depths = [s.get("depth_bottom", 0.0) for s in bh.get("strata", [])]
            bh_max_depths.append(max(depths) if depths else 10.0) # 기본 10m
        bh_max_depths = np.array(bh_max_depths)

        # max_depth RBF 보간 (상대 좌표 shifted_points 기반)
        rbf_depth = RBFInterpolator(self.shifted_points, bh_max_depths, kernel="thin_plate_spline", degree=1)
        grid_max_depth = rbf_depth(np.vstack([grid_xm.ravel(), grid_ym.ravel()]).T).reshape(grid_x.shape)
        grid_max_depth = np.maximum(grid_max_depth, 1.0) # 음수/0 방지 최소 1m

        # 3. 각 시추공별 지층 경계의 비율(fraction) 추출 및 RBF 보간
        layers = ["soil", "weathered_rock", "soft_rock", "hard_rock"]
        fraction_grids = {}
        
        for l in layers:
            bh_fractions = []
            for bh_idx, bh in enumerate(self.all_boreholes):
                max_d = bh_max_depths[bh_idx]
                
                # 해당 지층 바닥 깊이 가져오기
                bot_d = 0.0
                found = False
                for s in bh.get("strata", []):
                    if s.get("strata_group") == l:
                        bot_d = s.get("depth_bottom", 0.0)
                        found = True
                        break
                
                if not found:
                    # 누락 시 이전 지층 바닥 복제
                    if l == "soil":
                        bot_d = 0.0
                    elif l == "weathered_rock":
                        bot_d = self._get_bh_layer_bottom_depth(bh, "soil")
                    elif l == "soft_rock":
                        bot_d = self._get_bh_layer_bottom_depth(bh, "weathered_rock")
                    else:
                        bot_d = self._get_bh_layer_bottom_depth(bh, "soft_rock")
                
                fraction = bot_d / max_d if max_d > 0 else 0.0
                bh_fractions.append(np.clip(fraction, 0.0, 1.0))
                
            # 상대 좌표 shifted_points 기반 RBF
            rbf_frac = RBFInterpolator(self.shifted_points, np.array(bh_fractions), kernel="thin_plate_spline", degree=1)
            frac_grid = rbf_frac(np.vstack([grid_xm.ravel(), grid_ym.ravel()]).T).reshape(grid_x.shape)
            fraction_grids[l] = np.clip(frac_grid, 0.0, 1.0)

        # 4. 비율 누적 역전 방지
        fraction_grids["soil"] = np.maximum(fraction_grids["soil"], 0.0)
        fraction_grids["weathered_rock"] = np.maximum(fraction_grids["weathered_rock"], fraction_grids["soil"])
        fraction_grids["soft_rock"] = np.maximum(fraction_grids["soft_rock"], fraction_grids["weathered_rock"])
        fraction_grids["hard_rock"] = np.maximum(fraction_grids["hard_rock"], fraction_grids["soft_rock"])

        # 5. 절대 표고 복원
        if surf_elev_grid is not None:
            surf_ceil = np.array(surf_elev_grid, dtype=np.float64)
        else:
            # 전체 시추공의 실제 지표면 표고(elevation)를 상대 좌표 shifted_points 기반 RBF 보간하여 지표면 고도 격자 구축
            bh_elevations = np.array([bh["elevation"] for bh in self.all_boreholes])
            rbf_surf = RBFInterpolator(self.shifted_points, bh_elevations, kernel="thin_plate_spline", degree=1)
            surf_ceil = rbf_surf(np.vstack([grid_xm.ravel(), grid_ym.ravel()]).T).reshape(grid_x.shape)

        grids = {}
        for l in layers:
            grids[l] = surf_ceil - (fraction_grids[l] * grid_max_depth)

        # 6. JSON 반환용 리스트 변환
        result = {}
        for l in layers:
            result[l] = grids[l].tolist()

        return {
            "bbox": bbox,
            "res": res,
            "grids": result
        }

        # 4. 비율 누적 역전 방지
        fraction_grids["soil"] = np.maximum(fraction_grids["soil"], 0.0)
        fraction_grids["weathered_rock"] = np.maximum(fraction_grids["weathered_rock"], fraction_grids["soil"])
        fraction_grids["soft_rock"] = np.maximum(fraction_grids["soft_rock"], fraction_grids["weathered_rock"])
        fraction_grids["hard_rock"] = np.maximum(fraction_grids["hard_rock"], fraction_grids["soft_rock"])

        # 5. 절대 표고 복원
        if surf_elev_grid is not None:
            surf_ceil = np.array(surf_elev_grid, dtype=np.float64)
        else:
            max_bh_elev = max((bh["elevation"] for bh in self.all_boreholes), default=0.0)
            surf_ceil = np.full((res, res), max_bh_elev, dtype=np.float64)

        grids = {}
        for l in layers:
            grids[l] = surf_ceil - (fraction_grids[l] * grid_max_depth)

        # 6. JSON 반환용 리스트 변환
        result = {}
        for l in layers:
            result[l] = grids[l].tolist()

        return {
            "bbox": bbox,
            "res": res,
            "grids": result
        }

    def _get_bh_layer_bottom_depth(self, bh: dict, layer_name: str) -> float:
        for s in bh.get("strata", []):
            if s.get("strata_group") == layer_name:
                return s.get("depth_bottom", 0.0)
        # 상위 지층 없을 경우 재귀적으로 아래 탐색
        if layer_name == "weathered_rock":
            return self._get_bh_layer_bottom_depth(bh, "soil")
        elif layer_name == "soft_rock":
            return self._get_bh_layer_bottom_depth(bh, "weathered_rock")
        return 0.0
