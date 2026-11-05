#!/bin/bash
docker stop mikrogeni-nginx 2>/dev/null && echo "[mikrogeni] Nginx stopped." || echo "[mikrogeni] Nginx not running."
