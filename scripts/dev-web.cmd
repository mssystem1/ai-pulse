@echo off
REM Start Vite only if 5173 is free; otherwise tell user it's already running.
netstat -ano | findstr ":5173" | findstr "LISTENING" >nul
if %ERRORLEVEL%==0 (
  echo.
  echo [PULSE] UI already running on port 5173
  echo Open:  http://127.0.0.1:5173/
  echo.
  echo To restart: kill the old process first:
  echo   for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5173 ^| findstr LISTENING') do taskkill /F /PID %%a
  echo   then run: npm run dev:web
  echo.
  exit /b 0
)
cd /d "%~dp0.."
call npm.cmd run dev -w @pulse/web
