@echo off
set ROOT=%~dp0

echo GeoBIM Stratum - starting backend + 4 sites...
echo.

start "GeoBIM backend :8000" cmd /k "cd /d "%ROOT%backend" && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

start "GeoBIM auth :5170"     cmd /k "cd /d "%ROOT%sites\auth"     && npm run dev"
start "GeoBIM projects :5171" cmd /k "cd /d "%ROOT%sites\projects" && npm run dev"
start "GeoBIM map :5172"      cmd /k "cd /d "%ROOT%sites\map"      && npm run dev"
start "GeoBIM upload :5174"   cmd /k "cd /d "%ROOT%sites\upload"   && npm run dev"

echo Waiting 8 seconds for servers to start...
timeout /t 8 /nobreak > nul

start "" "http://localhost:5170"
start "" "http://localhost:5171"
start "" "http://localhost:5172"
start "" "http://localhost:5174"

echo Done.
pause
