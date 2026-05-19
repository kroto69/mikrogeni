#!/bin/bash
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT="${BACKEND_PORT:-1997}"
NGINX_PORT="${NGINX_PORT:-80}"
FRONTEND_DIR="$APP_DIR/frontend"
DIST_DIR="$FRONTEND_DIR/dist"
NGINX_CONF="/tmp/mikrogeni-nginx.conf"

GREEN='\033[0;32m'
NC='\033[0m'
log() { echo -e "${GREEN}[mikrogeni]${NC} $1"; }

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo "ERROR: $1 not found."
    exit 1
  fi
}

check_cmd nginx
check_cmd node
check_cmd npm

# ─── Build frontend ──────────────────────────────────────────────────────────
log "Building frontend..."
cd "$FRONTEND_DIR"
npm install --silent
VITE_API_BASE_URL="/api" npm run build
log "Frontend built: $DIST_DIR"

# ─── Generate nginx config ───────────────────────────────────────────────────
cat > "$NGINX_CONF" <<EOF
worker_processes auto;
pid /tmp/mikrogeni-nginx.pid;
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

        location /api/ {
            proxy_pass http://backend/api/;
            proxy_http_version 1.1;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            proxy_read_timeout 300s;
        }

        location / {
            try_files \$uri \$uri/ /index.html;
        }

        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
            expires 30d;
            add_header Cache-Control "public, immutable";
        }
    }
}
EOF

# ─── Stop previous nginx ─────────────────────────────────────────────────────
nginx -s stop -c "$NGINX_CONF" 2>/dev/null || true

# ─── Start nginx ─────────────────────────────────────────────────────────────
log "Starting nginx on port $NGINX_PORT (proxy API to backend:$BACKEND_PORT)..."
nginx -c "$NGINX_CONF"

echo ""
log "✓ Frontend running at http://localhost:${NGINX_PORT}"
log "  API proxied to http://localhost:${BACKEND_PORT}"
log "  Stop: ./stop.sh"
