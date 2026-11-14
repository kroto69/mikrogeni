#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:1997/api}"
AUTH_USERNAME="${AUTH_USERNAME:-admin}"
AUTH_PASSWORD="${AUTH_PASSWORD:-admin123}"
DEVICE_ID="${DEVICE_ID:-}"
SMOKE_WRITE="${SMOKE_WRITE:-0}"
KICK_ACTIVE="${KICK_ACTIVE:-0}"
TASK_TIMEOUT_SEC="${TASK_TIMEOUT_SEC:-45}"
TASK_POLL_INTERVAL_SEC="${TASK_POLL_INTERVAL_SEC:-2}"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage: scripts/mikrotik_smoke.sh

Environment variables:
  BASE_URL                 API base URL (default: http://localhost:1997/api)
  AUTH_USERNAME            Login username (default: admin)
  AUTH_PASSWORD            Login password (default: admin123)
  DEVICE_ID                Optional target device ID (default: first /mikrotik/devices)
  SMOKE_WRITE              1 to run create/update/delete secret/profile tests (default: 0)
  KICK_ACTIVE              1 to kick one PPP active session when available (default: 0)
  TASK_TIMEOUT_SEC         Async task wait timeout in seconds (default: 45)
  TASK_POLL_INTERVAL_SEC   Poll interval in seconds (default: 2)
EOF
  exit 0
fi

for cmd in curl jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[error] missing dependency: $cmd" >&2
    exit 1
  fi
done

login_response=$(curl -sS -X POST "$BASE_URL/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$AUTH_USERNAME\",\"password\":\"$AUTH_PASSWORD\"}")

TOKEN=$(jq -er '.access_token' <<<"$login_response") || {
  echo "[error] login failed: $login_response" >&2
  exit 1
}

auth_header=( -H "Authorization: Bearer $TOKEN" )
json_header=( -H "Content-Type: application/json" )

api_get() {
  local path="$1"
  curl -sS "$BASE_URL$path" "${auth_header[@]}"
}

api_post() {
  local path="$1"
  local body="$2"
  curl -sS -X POST "$BASE_URL$path" "${auth_header[@]}" "${json_header[@]}" -d "$body"
}

api_patch() {
  local path="$1"
  local body="$2"
  curl -sS -X PATCH "$BASE_URL$path" "${auth_header[@]}" "${json_header[@]}" -d "$body"
}

api_delete() {
  local path="$1"
  curl -sS -X DELETE "$BASE_URL$path" "${auth_header[@]}"
}

await_task() {
  local task_id="$1"
  local max_polls=$(( TASK_TIMEOUT_SEC / TASK_POLL_INTERVAL_SEC ))
  local i

  for ((i=1; i<=max_polls; i++)); do
    local task_response
    task_response=$(api_get "/tasks/$task_id")
    local status
    status=$(jq -r '.status // empty' <<<"$task_response")

    case "$status" in
      success)
        echo "[task] $task_id success"
        return 0
        ;;
      failed)
        echo "[task] $task_id failed: $(jq -r '.error // .response_body // "unknown error"' <<<"$task_response")" >&2
        return 1
        ;;
      queued|processing)
        sleep "$TASK_POLL_INTERVAL_SEC"
        ;;
      *)
        echo "[task] $task_id unknown status: $status" >&2
        echo "$task_response" >&2
        sleep "$TASK_POLL_INTERVAL_SEC"
        ;;
    esac
  done

  echo "[task] timeout waiting for $task_id" >&2
  return 1
}

enqueue_and_wait() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local response

  if [[ "$method" == "POST" ]]; then
    response=$(api_post "$path" "$body")
  elif [[ "$method" == "PATCH" ]]; then
    response=$(api_patch "$path" "$body")
  elif [[ "$method" == "DELETE" ]]; then
    response=$(api_delete "$path")
  else
    echo "[error] unsupported method for enqueue_and_wait: $method" >&2
    return 1
  fi

  local task_id
  task_id=$(jq -r '.task.id // empty' <<<"$response")
  if [[ -z "$task_id" ]]; then
    echo "[error] missing task id in async response: $response" >&2
    return 1
  fi

  await_task "$task_id"
}

if [[ -z "$DEVICE_ID" ]]; then
  DEVICE_ID=$(api_get "/mikrotik/devices" | jq -r '.[0].id // empty')
fi

if [[ -z "$DEVICE_ID" ]]; then
  echo "[error] no MikroTik device found. Seed first using scripts/mikrotik_seed.sh" >&2
  exit 1
fi

echo "[info] target device: $DEVICE_ID"

echo "[step] test connection"
api_post "/mikrotik/devices/$DEVICE_ID/test-connection" '{}' | jq . >/dev/null

echo "[step] sync facts"
api_post "/mikrotik/devices/$DEVICE_ID/sync" '{}' | jq . >/dev/null

echo "[step] read interfaces"
interfaces_json=$(api_get "/mikrotik/devices/$DEVICE_ID/interfaces")
jq 'if type=="array" then . else error("invalid interfaces response") end' <<<"$interfaces_json" >/dev/null

echo "[step] read ppp active"
ppp_active_json=$(api_get "/mikrotik/devices/$DEVICE_ID/ppp/active")
jq 'if type=="array" then . else error("invalid ppp active response") end' <<<"$ppp_active_json" >/dev/null

echo "[step] read ppp secrets"
ppp_secrets_json=$(api_get "/mikrotik/devices/$DEVICE_ID/ppp/secrets")
jq 'if type=="array" then . else error("invalid ppp secrets response") end' <<<"$ppp_secrets_json" >/dev/null

echo "[step] read ppp profiles"
ppp_profiles_json=$(api_get "/mikrotik/devices/$DEVICE_ID/ppp/profiles")
jq 'if type=="array" then . else error("invalid ppp profiles response") end' <<<"$ppp_profiles_json" >/dev/null

if [[ "$KICK_ACTIVE" == "1" ]]; then
  session_id=$(jq -r '.[0][".id"] // empty' <<<"$ppp_active_json")
  if [[ -n "$session_id" ]]; then
    encoded_session_id=$(jq -nr --arg v "$session_id" '$v|@uri')
    echo "[step] kick one ppp active session: $session_id"
    enqueue_and_wait "DELETE" "/mikrotik/devices/$DEVICE_ID/ppp/active/$encoded_session_id"
  else
    echo "[skip] no active PPP session to kick"
  fi
fi

if [[ "$SMOKE_WRITE" == "1" ]]; then
  suffix=$(date +%s)
  profile_name="SMOKE_PROFILE_$suffix"
  secret_name="SMOKE_SECRET_$suffix"

  echo "[step] create ppp profile: $profile_name"
  enqueue_and_wait "POST" "/mikrotik/devices/$DEVICE_ID/ppp/profiles" "$(jq -nc --arg name "$profile_name" '{name:$name,rate_limit:"2M/2M",comment:"smoke-create"}')"

  echo "[step] update ppp profile: $profile_name"
  encoded_profile_name=$(jq -nr --arg v "$profile_name" '$v|@uri')
  enqueue_and_wait "PATCH" "/mikrotik/devices/$DEVICE_ID/ppp/profiles/$encoded_profile_name" "$(jq -nc '{rate_limit:"4M/4M",comment:"smoke-update"}')"

  echo "[step] create ppp secret: $secret_name"
  enqueue_and_wait "POST" "/mikrotik/devices/$DEVICE_ID/ppp/secrets" "$(jq -nc --arg name "$secret_name" --arg profile "$profile_name" '{name:$name,password:"smoke-pass-123",profile:$profile,service:"pppoe",comment:"smoke-create"}')"

  echo "[step] update ppp secret: $secret_name"
  encoded_secret_name=$(jq -nr --arg v "$secret_name" '$v|@uri')
  enqueue_and_wait "PATCH" "/mikrotik/devices/$DEVICE_ID/ppp/secrets/$encoded_secret_name" "$(jq -nc '{password:"smoke-pass-456",comment:"smoke-update"}')"

  echo "[step] delete ppp secret: $secret_name"
  enqueue_and_wait "DELETE" "/mikrotik/devices/$DEVICE_ID/ppp/secrets/$encoded_secret_name"

  echo "[step] delete ppp profile: $profile_name"
  enqueue_and_wait "DELETE" "/mikrotik/devices/$DEVICE_ID/ppp/profiles/$encoded_profile_name"
fi

echo "[done] MikroTik smoke test completed for $DEVICE_ID"
