@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or newer is required. Install Node.js and try again.
  pause
  exit /b 1
)
node scripts/launch.mjs
if errorlevel 1 (
  echo The app could not start. See the error above.
  pause
  exit /b 1
)
