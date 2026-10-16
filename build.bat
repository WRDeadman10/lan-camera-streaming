@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo  LAN Camera Streaming - Automated Build Pipeline
echo ===================================================
echo.

cd /d "%~dp0"

:: 1. Bump the last digit of the version in package.json
echo [1/4] Updating project version...
node scripts/bump-version.js
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to update project version.
    pause
    exit /b %ERRORLEVEL%
)
echo.

:: 2. Build C++ DirectShow Virtual Camera Driver
echo [2/4] Building C++ virtual camera driver + Inno Setup installer...
if exist "vcam\build.bat" (
    call "vcam\build.bat"
    if !ERRORLEVEL! neq 0 (
        echo [ERROR] DirectShow C++ driver build failed.
        pause
        exit /b !ERRORLEVEL!
    )
) else (
    echo [SKIP] vcam\build.bat not found.
)
echo.

:: 3. Build C++ Remote Desktop Control Helper
echo [3/4] Building C++ remote desktop control helper + Inno Setup installer...
if exist "remote-control-helper\build.bat" (
    call "remote-control-helper\build.bat"
    if !ERRORLEVEL! neq 0 (
        echo [ERROR] Remote control helper build failed.
        pause
        exit /b !ERRORLEVEL!
    )
) else (
    echo [SKIP] remote-control-helper\build.bat not found.
)
echo.

:: 4. Execute the standalone executable build
echo [4/4] Building standalone executable (.exe)...
call npm run build:exe
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Build failed.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ===================================================
echo  BUILD SUCCEEDED!
echo  Main App:      dist\lan-camera-streaming.exe
echo  Virtual Camera: dist\lan-camera-setupv^<version^>.exe
echo  Control Helper: dist\control-helper-setup.exe
echo  Config:        dist\.env
echo ===================================================
echo.

pause
