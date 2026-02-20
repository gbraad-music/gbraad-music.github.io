#!/bin/bash
echo "Meister"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "Failed to install dependencies"
        exit 1
    fi
    echo "Dependencies installed"
fi

# Start the app
npm start
