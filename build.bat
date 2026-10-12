@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo  LAN Camera Streaming - Automated Build Pipeline
echo ===================================================
echo.

cd /d "%~dp0"

:: 1. Bump the last digit of the version in package.json
echo [1/3] Updating project version...
node scripts/bump-version.js
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to update project version.
    pause
    exit /b %ERRORLEVEL%
)
echo.

:: 2. Build C++ DirectShow Virtual Camera Driver
echo [2/3] Building C++ DirectShow Virtual Camera Driver...
if exist "vcam\build.bat" (
    call "vcam\build.bat"
    if !ERRORLEVEL! neq 0 (
        echo [ERROR] DirectShow C++ driver build failed.
        pause
        exit /b !ERRORLEVEL!
    )
    echo Packaging DirectShow driver setup zip...
    if not exist "dist" mkdir "dist"
    tar.exe -a -c -f dist\lancam-vcam-setup.zip -C vcam\build lancam-setup.exe LanCamFilter.dll
    if !ERRORLEVEL! neq 0 (
        echo [ERROR] Failed to package lancam-vcam-setup.zip.
        pause
        exit /b !ERRORLEVEL!
    )
) else (
    echo [SKIP] vcam\build.bat not found.
)
echo.

:: 3. Execute the standalone executable build
echo [3/3] Building standalone executable (.exe)...
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
echo  Driver Zip: dist\lancam-vcam-setup.zip
echo  Config:     dist\.env
echo ===================================================
echo.

pause
