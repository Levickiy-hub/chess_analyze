@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or later is required. https://nodejs.org/
  pause
  exit /b 1
)
echo Starting personal chess analytics. Open http://127.0.0.1:3000 after the ready message.
node index.js
if errorlevel 1 pause
