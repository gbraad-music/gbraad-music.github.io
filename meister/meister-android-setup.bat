@echo off
echo Regroove Meister
echo.

REM Check if adb exists (Android SDK)
where adb >nul 2>&1
if errorlevel 1 (
    echo "Android SDK not found!"
    echo "   Please install Android Studio first:"
    echo "   https://developer.android.com/studio"
    echo.
    pause
)

REM Check if dependencies are installed
if not exist "node_modules\" (
    echo "Installing dependencies..."
    call npm install
    if errorlevel 1 (
        echo "Failed to install dependencies"
        exit /b 1
    )
)

REM Check if Android platform exists
if not exist "android\" (
    echo "Setting up Android platform..."
    echo.
    echo "You will be prompted for app details:"
    echo "  App name: Regroove Meister"
    echo "  App ID: nl.gbraad.meister"
    echo "  Web directory: . (dot - current directory)"
    echo.
    pause

    REM Initialize Capacitor (only if not done)
    if not exist "capacitor.config.ts" (
        call npx cap init "Regroove Meister" "nl.gbraad.meister" --web-dir=.
    )

    REM Add Android platform
    call npx cap add android

    if errorlevel 1 (
        echo "Failed to add Android platform"
        exit /b 1
    )

    echo "Android platform added"
) else (
    echo "Android platform already exists"
)

REM Sync web code to Android
echo.
echo "Syncing web code to Android..."
call npx cap sync

echo.
echo "Android setup complete!"
echo.
echo "Next steps:"
echo "  1. Open Android Studio: npm run cap:open:android:"
echo "  2. Click Run ▶ to test on device/emulator"
echo "  3. Or Build → Generate Signed APK for release"
echo.
pause
