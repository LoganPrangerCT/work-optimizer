@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or newer is required. Install Node.js and try again.
  pause
  exit /b 1
)
if "%~1"=="--foreground" (
  node scripts\launch.mjs --foreground
) else (
  wscript //nologo "%~dp0scripts\launch.vbs" 2>nul
  if errorlevel 1 (
    node scripts\launch.mjs
  )
)
