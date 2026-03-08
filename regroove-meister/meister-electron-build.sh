#!/bin/bash
set -e

echo "Regroove Meister"

# Check if electron-builder is installed
if ! npm list electron-builder &>/dev/null; then
    echo "Installing electron-builder..."
    npm install --save-dev electron-builder
fi

# Menu
echo "Select build target:"
echo "  1) Current platform only"
echo "  2) Windows"
echo "  3) macOS"
echo "  4) Linux"
echo "  5) All platforms"
echo "  6) Development (unpacked)"
echo ""
read -p "Choice (1-6): " choice

case $choice in
    1)
        echo "Building for current platform..."
        npm run build
        ;;
    2)
        echo "Building for Windows..."
        npm run build:win
        ;;
    3)
        echo "Building for macOS..."
        npm run build:mac
        ;;
    4)
        echo "Building for Linux..."
        npm run build:linux
        ;;
    5)
        echo "Building for all platforms..."
        npm run build:all
        ;;
    6)
        echo "Building development version (unpacked)..."
        npm run build -- --dir
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "Build complete!"
echo "Output: dist/"
echo ""
ls -lh dist/ 2>/dev/null || echo "No files found in dist/"
