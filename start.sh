#!/bin/bash
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$APP_DIR/frontend"

GREEN='\033[0;32m'
NC='\033[0m'
log() { echo -e "${GREEN}[mikrogeni]${NC} $1"; }

# ─── Build frontend ──────────────────────────────────────────────────────────
log "Installing dependencies..."
cd "$FRONTEND_DIR"
npm install --silent

log "Building frontend..."
VITE_API_BASE_URL="/api" npm run build

log "✓ Frontend built: $FRONTEND_DIR/dist"
log "Restarting nginx container to pick up changes..."
docker restart mikrogeni-nginx 2>/dev/null || log "Note: restart nginx manually if needed"

echo ""
log "✓ Done! Frontend served at http://localhost"
