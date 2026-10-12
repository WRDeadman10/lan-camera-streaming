@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo  LAN Camera Streaming - Automated Build Pipeline
echo ===================================================
echo.

cd /d "%~dp0"

:: 1. Bump the last digit of the version in package.json
echo [1/2] Updating project version...
node scripts/bump-version.js
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to update project version.
    pause
    exit /b %ERRORLEVEL%
)
echo.

:: 2. Execute the standalone executable build
echo [2/2] Building standalone executable (.exe)...
call npm run build:exe
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Build failed.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ===================================================
echo  BUILD SUCCEEDED!
echo  Executable: dist\lan-camera-streaming.exe
echo  Config:     dist\.env
echo ===================================================
echo.

pause
