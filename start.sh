#!/bin/bash

# Quick Start Script for Newsletter Aggregator

echo "Newsletter Aggregator - Quick Start"
echo "======================================"
echo ""

# Check if Bun is installed
if ! command -v bun &> /dev/null; then
    echo "Bun is not installed!"
    echo "Install it with: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

echo "Bun is installed: $(bun --version)"
echo ""

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    bun install
    echo ""
fi

# Start the server
echo "Starting server on http://localhost:8080"
echo ""
echo "Instructions:"
echo "   - Open your browser and go to: http://localhost:8080"
echo "   - Click on a catalog to view all pages"
echo "   - Press Ctrl+C to stop the server"
echo ""
echo "======================================"
echo ""

bun run src/server.ts
