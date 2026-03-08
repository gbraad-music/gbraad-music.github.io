@echo off
echo "Meister"
echo.

REM Check if node_modules exists
if not exist "node_modules\" (
    echo "Installing dependencies..."
    call npm install
    if errorlevel 1 (
        echo "Failed to install dependencies"
        exit /b 1
    )
    echo "Dependencies installed"
    echo.
)

call npm start
