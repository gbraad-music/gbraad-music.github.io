@echo off
echo "Regroove Meister"
echo.

REM Check if electron-builder is installed
call npm list electron-builder >nul 2>&1
if errorlevel 1 (
    echo "Installing electron-builder..."
    call npm install --save-dev electron-builder
    if errorlevel 1 (
        echo "Failed to install electron-builder"
        exit /b 1
    )
)

echo "Select build target:"
echo "  1) Current platform only"
echo "  2) Windows"
echo "  3) macOS"
echo "  4) Linux"
echo "  5) All platforms"
echo "  6) Development (unpacked)"
echo.
set /p choice="Choice (1-6): "

if "%choice%"=="1" (
    echo "Building for current platform..."
    call npm run build
) else if "%choice%"=="2" (
    echo "Building for Windows..."
    call npm run build:win
) else if "%choice%"=="3" (
    echo "Building for macOS..."
    call npm run build:mac
) else if "%choice%"=="4" (
    echo "Building for Linux..."
    call npm run build:linux
) else if "%choice%"=="5" (
    echo "Building for all platforms..."
    call npm run build:all
) else if "%choice%"=="6" (
    echo "Building development version (unpacked)..."
    call npm run build -- --dir
) else (
    echo "Invalid choice"
    exit /b 1
)

echo.
echo "Build complete!"
echo "Output: dist\"
echo.
dir /b dist\ 2>nul || echo No files found in dist\
