"""지층명 정규화 유틸.

공유 TypeScript 로직(shared/strataColor.ts)과 동일한 동의어 맵·정규화 알고리즘을
Python 으로 구현. PDF 추출 결과 후처리 및 CSV 인제스트 시 사용.

변경 시 shared/strataColor.ts 와 동기화할 것.
"""

from __future__ import annotations

import re
from typing import Literal

StrataGroup = Literal["soil", "weathered_rock", "soft_rock", "hard_rock", "unknown"]

# ---------------------------------------------------------------------------
# 동의어 맵 (shared/strataColor.ts 의 STRATA_SYNONYMS 와 동일)
# ---------------------------------------------------------------------------
_SYNONYMS: dict[str, StrataGroup] = {
    # 토사 계열
    "토사":       "soil",
    "매립토":     "soil",
    "매립층":     "soil",
    "퇴적토":     "soil",
    "퇴적층":     "soil",
    "충적층":     "soil",
    "붕적층":     "soil",
    "풍화토":     "soil",
    "잔류토":     "soil",
    # 풍화암
    "풍화암":     "weathered_rock",
    "풍화대":     "weathered_rock",
    "풍화기반암": "weathered_rock",
    # 연암
    "연암":       "soft_rock",
    "리핑암":     "soft_rock",
    # 경암 (보통암 포함)
    "경암":       "hard_rock",
    "보통암":     "hard_rock",
    "발파암":     "hard_rock",
    "극경암":     "hard_rock",
}

# 부분 일치용: 긴 키 우선 정렬 (1회만 계산)
_SYNONYMS_BY_LEN = sorted(_SYNONYMS.keys(), key=len, reverse=True)

# ---------------------------------------------------------------------------
# 색상 정의 (CSS hex / RGB) — DB 저장 없이 API 응답 조립 시 사용
# ---------------------------------------------------------------------------
STRATA_COLORS_HEX: dict[StrataGroup, str] = {
    "soil":          "#8B7355",
    "weathered_rock":"#C4A57B",
    "soft_rock":     "#6B8E5A",
    "hard_rock":     "#3D3D3D",
    "unknown":       "#B4B4B4",
}

STRATA_COLORS_RGB: dict[StrataGroup, tuple[int, int, int]] = {
    "soil":          (139, 115,  85),
    "weathered_rock":(196, 165, 123),
    "soft_rock":     (107, 142,  90),
    "hard_rock":     ( 61,  61,  61),
    "unknown":       (180, 180, 180),
}


def normalize_strata_group(raw: str | None) -> StrataGroup:
    """원본 지층명 텍스트 → 표준 StrataGroup.

    1) 공백·괄호·한글 외 문자 제거 후 완전 일치
    2) 부분 일치 (가장 긴 키 우선)
    3) 매칭 실패 → "unknown"
    """
    if not raw:
        return "unknown"

    cleaned = re.sub(r"\s+", "", raw.strip())
    cleaned = re.sub(r"\(.*?\)", "", cleaned)
    cleaned = re.sub(r"[^가-힣]", "", cleaned)  # 한글만 남김

    # 완전 일치
    if cleaned in _SYNONYMS:
        return _SYNONYMS[cleaned]

    # 부분 일치 (긴 키 우선)
    for key in _SYNONYMS_BY_LEN:
        if key in cleaned:
            return _SYNONYMS[key]

    return "unknown"


def get_strata_color_hex(raw: str | None) -> str:
    """원본 지층명 → CSS hex 색상."""
    return STRATA_COLORS_HEX[normalize_strata_group(raw)]


def get_strata_color_rgb(raw: str | None) -> tuple[int, int, int]:
    """원본 지층명 → (R, G, B) 튜플."""
    return STRATA_COLORS_RGB[normalize_strata_group(raw)]
