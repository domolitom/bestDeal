#!/bin/bash

# Quick Start Script for Newsletter Aggregator

echo "🛒 Newsletter Aggregator - Quick Start"
echo "======================================"
echo ""

# Check if Go is installed
if ! command -v go &> /dev/null; then
    echo "❌ Go is not installed!"
    echo "Please install Go from: https://golang.org/dl/"
    exit 1
fi

echo "✅ Go is installed: $(go version)"
echo ""

# Navigate to backend directory
cd backend || exit

# Download dependencies
echo "📦 Downloading Go dependencies..."
go mod download

if [ $? -ne 0 ]; then
    echo "❌ Failed to download dependencies"
    exit 1
fi

echo "✅ Dependencies downloaded"
echo ""

# Start the server
echo "🚀 Starting server on http://localhost:8080"
echo ""
echo "📝 Instructions:"
echo "   - Open your browser and go to: http://localhost:8080"
echo "   - Click on a catalog to view all pages"
echo "   - Press Ctrl+C to stop the server"
echo ""
echo "===================================="
echo ""

# Run the server
go run main.go
