@echo off
cd /d "%~dp0"
echo GeoBIM 백엔드 500 에러 진단 중...
echo.
uv run python scratch_diagnose_500.py
echo.
pause
