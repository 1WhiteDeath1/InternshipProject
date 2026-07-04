#!/bin/bash

echo "=========================================="
echo "  SAM Hotel & Mess Management System"
echo "=========================================="
echo "Starting server..."
echo ""

# Change to script directory
cd "$(dirname "$0")"

# Start the FastAPI server with the React frontend served statically
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 "$@"
