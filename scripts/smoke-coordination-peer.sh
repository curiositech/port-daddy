#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
BIN="${PORT_DADDY_BIN:-$REPO_ROOT/dist/port-daddy}"
SMOKE_ROOT="${PORT_DADDY_SMOKE_ROOT:-$HOME/coding/tmp/pd-coordination-peer-smoke-$$}"
PROJECT="port-daddy"
CLOUD_PORT=$((22000 + $$ % 8000))
LOCAL_PORT=$((CLOUD_PORT + 1))

case "$SMOKE_ROOT" in
  "$HOME"/coding/tmp/pd-coordination-peer-smoke-*) ;;
  *) echo "FAIL: smoke root must be under ~/coding/tmp/pd-coordination-peer-smoke-*" >&2; exit 1 ;;
esac
[ -x "$BIN" ] || { echo "FAIL: compiled binary missing; run npm run build:bin" >&2; exit 1; }

mkdir -p "$SMOKE_ROOT/cloud" "$SMOKE_ROOT/local" "$SMOKE_ROOT/relay"
relay_pid=
cloud_pid=
local_pid=
cleanup() {
  [ -z "$local_pid" ] || kill "$local_pid" 2>/dev/null || true
  [ -z "$cloud_pid" ] || kill "$cloud_pid" 2>/dev/null || true
  [ -z "$relay_pid" ] || kill "$relay_pid" 2>/dev/null || true
  [ -z "$local_pid" ] || wait "$local_pid" 2>/dev/null || true
  [ -z "$cloud_pid" ] || wait "$cloud_pid" 2>/dev/null || true
  [ -z "$relay_pid" ] || wait "$relay_pid" 2>/dev/null || true
  case "$SMOKE_ROOT" in
    "$HOME"/coding/tmp/pd-coordination-peer-smoke-*) rm -rf "$SMOKE_ROOT" ;;
  esac
}
trap cleanup EXIT

"$REPO_ROOT/node_modules/.bin/tsx" "$REPO_ROOT/tests/helpers/coordination-peer-relay.ts" "$SMOKE_ROOT/relay" \
  > "$SMOKE_ROOT/relay.log" 2>&1 &
relay_pid=$!
for _ in $(seq 1 50); do
  [ -f "$SMOKE_ROOT/relay/relay.port" ] \
    && [ -f "$SMOKE_ROOT/relay/cloud-smoke.macaroon" ] \
    && [ -f "$SMOKE_ROOT/relay/local-smoke.macaroon" ] && break
  kill -0 "$relay_pid" 2>/dev/null || { sed -n '1,160p' "$SMOKE_ROOT/relay.log" >&2; exit 1; }
  sleep 0.1
done
[ -f "$SMOKE_ROOT/relay/relay.port" ] || { echo "FAIL: relay did not publish a port" >&2; exit 1; }
RELAY_PORT="$(sed -n '1p' "$SMOKE_ROOT/relay/relay.port")"
RELAY_URL="http://127.0.0.1:$RELAY_PORT"
CLOUD_MACAROON="$(sed -n '1p' "$SMOKE_ROOT/relay/cloud-smoke.macaroon")"
LOCAL_MACAROON="$(sed -n '1p' "$SMOKE_ROOT/relay/local-smoke.macaroon")"

PORT_DADDY_PORT="$CLOUD_PORT" \
PORT_DADDY_DB="$SMOKE_ROOT/cloud/registry.db" \
PORT_DADDY_PREFIX="$SMOKE_ROOT/cloud" \
PORT_DADDY_SOCK="$SMOKE_ROOT/cloud/port-daddy.sock" \
PORT_DADDY_BIN_OVERRIDE="$BIN" \
PORT_DADDY_COORDINATION_URL="$RELAY_URL" \
PORT_DADDY_COORDINATION_PROJECT="$PROJECT" \
PORT_DADDY_COORDINATION_ACTOR="cloud-smoke" \
PORT_DADDY_COORDINATION_REPLICA="cloud-smoke-peer" \
PORT_DADDY_COORDINATION_MACAROON="$CLOUD_MACAROON" \
PORT_DADDY_COORDINATION_INTERVAL_MS=500 \
PORT_DADDY_NO_FLEET=1 PORT_DADDY_NO_FLEETBAR=1 PORT_DADDY_SILENT=1 PORT_DADDY_DISABLE_KEYCHAIN=1 \
"$BIN" __daemon > "$SMOKE_ROOT/cloud.log" 2>&1 &
cloud_pid=$!

PORT_DADDY_PORT="$LOCAL_PORT" \
PORT_DADDY_DB="$SMOKE_ROOT/local/registry.db" \
PORT_DADDY_PREFIX="$SMOKE_ROOT/local" \
PORT_DADDY_SOCK="$SMOKE_ROOT/local/port-daddy.sock" \
PORT_DADDY_BIN_OVERRIDE="$BIN" \
PORT_DADDY_COORDINATION_URL="$RELAY_URL" \
PORT_DADDY_COORDINATION_PROJECT="$PROJECT" \
PORT_DADDY_COORDINATION_ACTOR="local-smoke" \
PORT_DADDY_COORDINATION_REPLICA="local-smoke-peer" \
PORT_DADDY_COORDINATION_MACAROON="$LOCAL_MACAROON" \
PORT_DADDY_COORDINATION_INTERVAL_MS=500 \
PORT_DADDY_NO_FLEET=1 PORT_DADDY_NO_FLEETBAR=1 PORT_DADDY_SILENT=1 PORT_DADDY_DISABLE_KEYCHAIN=1 \
"$BIN" __daemon > "$SMOKE_ROOT/local.log" 2>&1 &
local_pid=$!

for target in "$CLOUD_PORT" "$LOCAL_PORT"; do
  ready=0
  for _ in $(seq 1 80); do
    if curl -fsS -o /dev/null "http://127.0.0.1:$target/health" 2>/dev/null; then ready=1; break; fi
    sleep 0.25
  done
  [ "$ready" = 1 ] || { echo "FAIL: daemon $target did not become healthy" >&2; sed -n '1,160p' "$SMOKE_ROOT/cloud.log" "$SMOKE_ROOT/local.log" >&2; exit 1; }
done

cloud_pd() {
  env PORT_DADDY_PORT="$CLOUD_PORT" PORT_DADDY_PREFIX="$SMOKE_ROOT/cloud" \
    PORT_DADDY_SOCK="$SMOKE_ROOT/cloud/port-daddy.sock" \
    PORT_DADDY_CONTEXT_DIR="$SMOKE_ROOT/cloud/context" "$BIN" "$@"
}
local_pd() {
  env PORT_DADDY_PORT="$LOCAL_PORT" PORT_DADDY_PREFIX="$SMOKE_ROOT/local" \
    PORT_DADDY_SOCK="$SMOKE_ROOT/local/port-daddy.sock" \
    PORT_DADDY_CONTEXT_DIR="$SMOKE_ROOT/local/context" "$BIN" "$@"
}
wait_for() {
  local needle="$1"
  shift
  for _ in $(seq 1 60); do
    if "$@" 2>/dev/null | grep -Fq "$needle"; then return 0; fi
    sleep 0.25
  done
  return 1
}
wait_for_peer_durability() {
  local port="$1"
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:$port/coordination/status" 2>/dev/null \
      | node -e 'let raw="";process.stdin.on("data",c=>raw+=c);process.stdin.on("end",()=>{try{const s=JSON.parse(raw);process.exit(s.connected===true&&s.outbox===0&&s.cursor>0?0:1)}catch{process.exit(1)}})'; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

cloud_pd begin "Cloud smoke session" --identity "port-daddy:cloud-smoke" \
  --agent cloud-smoke --lifecycle durable --sidequest "ADR-0092 cloud peer acceptance smoke" \
  --allow-main-worktree --json >/dev/null
CLOUD_SESSION="$(node -e 'const fs=require("node:fs");const p=process.argv[1];process.stdout.write(JSON.parse(fs.readFileSync(p,"utf8")).sessionId)' "$SMOKE_ROOT/cloud/context/current.json")"
cloud_pd session files add src/cloud-smoke.ts --session "$CLOUD_SESSION" --json >/dev/null
cloud_pd note "cloud note crosses the room" --session "$CLOUD_SESSION" --json >/dev/null

wait_for "$CLOUD_SESSION" local_pd sessions --all-worktrees --json || { echo "FAIL: cloud pd begin did not appear locally" >&2; exit 1; }
wait_for 'cloud-smoke' local_pd who-owns src/cloud-smoke.ts --json || { echo "FAIL: cloud claim did not appear locally" >&2; exit 1; }
wait_for 'cloud note crosses the room' local_pd notes "$CLOUD_SESSION" --json || { echo "FAIL: cloud note did not appear locally" >&2; exit 1; }
wait_for_peer_durability "$CLOUD_PORT" || { echo "FAIL: cloud peer never received durable room acknowledgement" >&2; exit 1; }

local_pd begin "Local partition session" --identity "port-daddy:local-smoke" \
  --agent local-smoke --lifecycle durable --sidequest "ADR-0092 local peer acceptance smoke" \
  --allow-main-worktree --json >/dev/null
LOCAL_SESSION="$(node -e 'const fs=require("node:fs");const p=process.argv[1];process.stdout.write(JSON.parse(fs.readFileSync(p,"utf8")).sessionId)' "$SMOKE_ROOT/local/context/current.json")"

touch "$SMOKE_ROOT/relay/partition-all"
cloud_pd session files add src/cloud-partition.ts --session "$CLOUD_SESSION" --json >/dev/null
local_pd session files add src/local-partition.ts --session "$LOCAL_SESSION" --json >/dev/null
sleep 1
rm "$SMOKE_ROOT/relay/partition-all"

wait_for 'local-smoke' cloud_pd who-owns src/local-partition.ts --json || { echo "FAIL: local partition claim was lost" >&2; exit 1; }
wait_for 'cloud-smoke' local_pd who-owns src/cloud-partition.ts --json || { echo "FAIL: cloud partition claim was lost" >&2; exit 1; }

local_pd note "local reply crosses the room" --session "$LOCAL_SESSION" --json >/dev/null
wait_for 'local reply crosses the room' cloud_pd notes "$LOCAL_SESSION" --json || { echo "FAIL: local note did not appear in cloud" >&2; exit 1; }

echo "COORDINATION PEER SMOKE PASS: cloud begin, claim visibility, bidirectional notes, partition reconvergence"
