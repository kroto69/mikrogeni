#!/bin/bash
set -e

# ─── Config ───────────────────────────────────────────────────────────────────
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT="${PORT:-1997}"
NGINX_PORT="${NGINX_PORT:-80}"
FRONTEND_DIR="$APP_DIR/frontend"
DIST_DIR="$FRONTEND_DIR/dist"
NGINX_CONF="/tmp/mikrogeni-nginx.conf"
PID_DIR="/tmp/mikrogeni-pids"

mkdir -p "$PID_DIR"

# ─── Colors ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[mikrogeni]${NC} $1"; }
warn() { echo -e "${YELLOW}[mikrogeni]${NC} $1"; }

# ─── Check dependencies ──────────────────────────────────────────────────────
check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo "ERROR: $1 not found. Please install it first."
    exit 1
  fi
}

check_cmd nginx
check_cmd go
check_cmd node
check_cmd npm

# ─── Build backend ───────────────────────────────────────────────────────────
log "Building backend..."
cd "$APP_DIR"
CGO_ENABLED=1 go build -o "$APP_DIR/mikrogeni-server" ./cmd/server
log "Backend built: $APP_DIR/mikrogeni-server"

# ─── Build frontend ──────────────────────────────────────────────────────────
log "Building frontend..."
cd "$FRONTEND_DIR"
npm install --silent
VITE_API_BASE_URL="/api" npm run build
log "Frontend built: $DIST_DIR"

# ─── Generate nginx config ───────────────────────────────────────────────────
cat > "$NGINX_CONF" <<EOF
worker_processes auto;
pid $PID_DIR/nginx.pid;
error_log /tmp/mikrogeni-nginx-error.log;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    sendfile on;
    keepalive_timeout 65;
    client_max_body_size 20m;

    access_log /tmp/mikrogeni-nginx-access.log;

    upstream backend {
        server 127.0.0.1:${BACKEND_PORT};
    }

    server {
        listen ${NGINX_PORT};
        server_name _;
        root ${DIST_DIR};
        index index.html;

        # API proxy
        location /api/ {
            proxy_pass http://backend/api/;
            proxy_http_version 1.1;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            proxy_read_timeout 300s;
        }

        # SPA fallback
        location / {
            try_files \$uri \$uri/ /index.html;
        }

        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
            expires 30d;
            add_header Cache-Control "public, immutable";
        }
    }
}
EOF
log "Nginx config generated: $NGINX_CONF"

# ─── Stop previous instances ─────────────────────────────────────────────────
stop_previous() {
  if [ -f "$PID_DIR/backend.pid" ]; then
    kill "$(cat "$PID_DIR/backend.pid")" 2>/dev/null || true
    rm -f "$PID_DIR/backend.pid"
  fi
  nginx -s stop -c "$NGINX_CONF" 2>/dev/null || true
}
stop_previous

# ─── Start backend ───────────────────────────────────────────────────────────
log "Starting backend on port $BACKEND_PORT..."
cd "$APP_DIR"
./mikrogeni-server &
echo $! > "$PID_DIR/backend.pid"
sleep 1

# ─── Start nginx ─────────────────────────────────────────────────────────────
log "Starting nginx on port $NGINX_PORT..."
nginx -c "$NGINX_CONF"

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
log "✓ Mikrogeni running!"
log "  Frontend: http://localhost:${NGINX_PORT}"
log "  API:      http://localhost:${NGINX_PORT}/api/"
log "  Backend:  http://localhost:${BACKEND_PORT}"
echo ""
log "To stop: $APP_DIR/stop.sh"

# Keep alive
wait
