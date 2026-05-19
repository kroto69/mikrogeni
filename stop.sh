#!/bin/bash
NGINX_CONF="/tmp/mikrogeni-nginx.conf"
nginx -s stop -c "$NGINX_CONF" 2>/dev/null && echo "[mikrogeni] Nginx stopped." || echo "[mikrogeni] Nginx not running."
