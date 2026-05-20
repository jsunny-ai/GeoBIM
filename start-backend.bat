@echo off
set ROOT=%~dp0
echo GeoBIM Backend - FastAPI :8000
echo.
start "GeoBIM backend :8000" cmd /k "cd /d "%ROOT%backend" && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
echo Backend starting at http://localhost:8000
echo.
pause
