@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 18+ first: https://nodejs.org
  pause
  exit /b 1
)
node server\serve.js
echo.
pause
