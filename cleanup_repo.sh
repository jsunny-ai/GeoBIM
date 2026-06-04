#!/usr/bin/env bash
# ============================================================================
# GeoBIM Stratum - 저장소 정리 스크립트
# ----------------------------------------------------------------------------
# Cowork 세션에서 git index.lock 이 호스트(IDE)에 의해 점유되어 있어
# 직접 실행하지 못했습니다. Antigravity/VSCode 등 git 을 쓰는 IDE를 닫은 뒤
# 저장소 루트(geobim-stratum)에서 이 스크립트를 실행하세요.
#
#   cd /path/to/geobim-stratum
#   bash cleanup_repo.sh
#
# git rm --cached 는 "추적만 해제"하고 작업본은 디스크에 남깁니다(안전).
# 실제 파일 삭제는 빈 파일/캐시 등 확실한 것만 수행합니다.
# 실행 전 git status 로 현재 변경사항을 확인하고, 필요시 커밋/스태시하세요.
# ============================================================================
set -e
cd "$(dirname "$0")"

echo "==> 1) 추적 중인 잡파일 추적 해제 (작업본은 유지)"
git rm --cached --ignore-unmatch -q \
  backend/scratch_check_db.py \
  backend/scratch_check_strata.py \
  backend/scratch_test_api.py \
  backend/test_tile.py \
  backend/tile.jpg \
  backend/cookies.txt \
  sites/auth/auth-dev.log.err \
  sites/map/tsconfig.tsbuildinfo \
  sites/viewer-3d/tsconfig.tsbuildinfo

echo "==> 2) 구버전 백업 폴더 추적 해제 (디스크에는 유지)"
git rm -r --cached --ignore-unmatch -q frontend.phase1-backup

echo "==> 3) 빈 파일 / 캐시 삭제"
rm -f strata_check.txt start-backend.bat reinstall-map.bat backend/run_diagnose.bat
rm -rf .vite-cache .vite-cache2

echo "==> 4) .gitignore 보강 (중복 시 무시)"
add_ignore() { grep -qxF "$1" .gitignore || echo "$1" >> .gitignore; }
{
  echo ""
  echo "# --- 정리 스크립트 추가분 ---"
} >> .gitignore
add_ignore "*.tsbuildinfo"
add_ignore "*.err"
add_ignore "cookies.txt"
add_ignore "scratch_*.py"
add_ignore "frontend.phase1-backup/"
add_ignore "*.db"
add_ignore "backend/*_count.txt"
add_ignore "backend/*_results.txt"
add_ignore "backend/proj*_strata.txt"

echo ""
echo "완료. 'git status' 로 확인 후 커밋하세요."
echo "참고: backend/cookies.txt 는 git '히스토리'에 이미 들어가 있을 수 있습니다."
echo "      인증 쿠키가 들어있다면 해당 세션/자격증명을 폐기(rotate)하는 것을 권장합니다."
