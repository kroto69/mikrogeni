#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:1997/api}"
AUTH_USERNAME="${AUTH_USERNAME:-admin}"
AUTH_PASSWORD="${AUTH_PASSWORD:-admin123}"
SEED_FILE="${SEED_FILE:-scripts/mikrotik.seed.json}"
UPDATE_EXISTING="${UPDATE_EXISTING:-false}"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage: scripts/mikrotik_seed.sh

Environment variables:
  BASE_URL         API base URL (default: http://localhost:1997/api)
  AUTH_USERNAME    Login username (default: admin)
  AUTH_PASSWORD    Login password (default: admin123)
  SEED_FILE        Seed JSON path (default: scripts/mikrotik.seed.json)
  UPDATE_EXISTING  true|false (default: false)

Prepare seed file:
  cp scripts/mikrotik.seed.json.example scripts/mikrotik.seed.json
  # then edit host/username/password values
EOF
  exit 0
fi

for cmd in curl jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[error] missing dependency: $cmd" >&2
    exit 1
  fi
done

if [[ ! -f "$SEED_FILE" ]]; then
  echo "[error] seed file not found: $SEED_FILE" >&2
  echo "[hint] copy scripts/mikrotik.seed.json.example first" >&2
  exit 1
fi

if ! jq -e '.devices and (.devices | type == "array")' "$SEED_FILE" >/dev/null; then
  echo "[error] invalid seed file format, expected: {"devices": [...] }" >&2
  exit 1
fi

token_response=$(curl -sS -X POST "$BASE_URL/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$AUTH_USERNAME\",\"password\":\"$AUTH_PASSWORD\"}")

TOKEN=$(jq -er '.access_token' <<<"$token_response") || {
  echo "[error] failed to login" >&2
  echo "$token_response" >&2
  exit 1
}

auth_header=( -H "Authorization: Bearer $TOKEN" )
json_header=( -H "Content-Type: application/json" )

existing_devices=$(curl -sS "$BASE_URL/mikrotik/devices" "${auth_header[@]}")

created=0
updated=0
skipped=0

while IFS= read -r row; do
  name=$(jq -r '.name // ""' <<<"$row")
  host=$(jq -r '.host // ""' <<<"$row")
  username=$(jq -r '.username // ""' <<<"$row")
  password=$(jq -r '.password // ""' <<<"$row")

  if [[ -z "$name" || -z "$host" || -z "$username" || -z "$password" ]]; then
    echo "[warn] skipping entry with missing required fields (name/host/username/password)" >&2
    ((skipped+=1))
    continue
  fi

  current_id=$(jq -r --arg host "$host" --arg name "$name" 'map(select(.host == $host and .name == $name)) | .[0].id // empty' <<<"$existing_devices")

  if [[ -n "$current_id" ]]; then
    if [[ "$UPDATE_EXISTING" == "true" ]]; then
      body=$(jq -c '{name,host,port,username,password,use_tls,skip_tls_verify,site,tags}' <<<"$row")
      response=$(curl -sS -X PATCH "$BASE_URL/mikrotik/devices/$current_id" "${auth_header[@]}" "${json_header[@]}" -d "$body")
      _id=$(jq -r '.id // empty' <<<"$response")
      if [[ -n "$_id" ]]; then
        echo "[update] $name ($host) -> $_id"
        ((updated+=1))
      else
        echo "[error] failed to update $name ($host): $response" >&2
      fi
    else
      echo "[skip] exists $name ($host)"
      ((skipped+=1))
    fi
    continue
  fi

  body=$(jq -c '{name,host,port,username,password,use_tls,skip_tls_verify,site,tags}' <<<"$row")
  response=$(curl -sS -X POST "$BASE_URL/mikrotik/devices" "${auth_header[@]}" "${json_header[@]}" -d "$body")
  created_id=$(jq -r '.id // empty' <<<"$response")

  if [[ -n "$created_id" ]]; then
    echo "[create] $name ($host) -> $created_id"
    ((created+=1))
  else
    echo "[error] failed to create $name ($host): $response" >&2
  fi
done < <(jq -c '.devices[]' "$SEED_FILE")

echo
echo "Seed summary: created=$created updated=$updated skipped=$skipped"
