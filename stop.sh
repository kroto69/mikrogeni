#!/bin/bash
PID_DIR="/tmp/mikrogeni-pids"
NGINX_CONF="/tmp/mikrogeni-nginx.conf"

echo "[mikrogeni] Stopping..."

if [ -f "$PID_DIR/backend.pid" ]; then
  kill "$(cat "$PID_DIR/backend.pid")" 2>/dev/null && echo "  Backend stopped" || true
  rm -f "$PID_DIR/backend.pid"
fi

nginx -s stop -c "$NGINX_CONF" 2>/dev/null && echo "  Nginx stopped" || true

echo "[mikrogeni] Done."
