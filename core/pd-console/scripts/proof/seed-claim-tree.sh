#!/usr/bin/env bash
# seed-claim-tree.sh — seed a REAL daemon (HTTP only, never SQL) with the three
# claim-tree states the Claims pane must witness for PR proof:
#
#   1. LIVE claims        — sessions A + B hold unreleased file/symbol claims.
#   2. A GENUINE CONFLICT — A and B force-claim the SAME file and the SAME
#      symbol region; the forest dual-write defaults to mode X, so the tree's
#      Gray-1976 check marks both nodes conflicted (Tone::Conflicted).
#   3. DEAD-SESSION CLAIMS — session C's agent goes through the real zombie
#      path: a `draining` heartbeat (5-minute dead threshold) goes stale, the
#      resurrection reaper marks the agent dead, and `abandonByAgent` flips the
#      session to 'abandoned' WITHOUT releasing forest claims. Those unreleased
#      dead-session claims render dimmed (Tone::Resting, † marker).
#
# Everything goes through public daemon HTTP routes — the same writes real
# agents produce — so the captured pane shows daemon truth, not fixture data.
#
# Usage:
#   scripts/proof/seed-claim-tree.sh
#   PD_PROOF_PANES="claims" scripts/proof/capture-proof.sh   # then capture
#
# Env:
#   PD_BASE               daemon base URL (default http://127.0.0.1:9876)
#   PD_SEED_SKIP_ZOMBIE=1 seed only states 1+2 and skip the zombie wait
#   PD_SEED_ZOMBIE_TIMEOUT  seconds to wait for the reaper (default 900).
#     The wait is real: `draining` dead threshold is 5 min (lib/agents.ts
#     DEAD_THRESHOLDS) and the cleanup sweep runs every config.cleanup
#     .interval_ms (5 min default), so ~10 min worst case. Shrink
#     cleanup.interval_ms in config.json for faster proof runs.
set -euo pipefail

BASE="${PD_BASE:-http://127.0.0.1:9876}"
SKIP_ZOMBIE="${PD_SEED_SKIP_ZOMBIE:-0}"
ZOMBIE_TIMEOUT="${PD_SEED_ZOMBIE_TIMEOUT:-900}"
STAMP="$(date +%s)"

req() { # method path json-body
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -X "$method" "$BASE$path" -H 'content-type: application/json' -d "$body"
  else
    curl -sS -X "$method" "$BASE$path"
  fi
}

need_ok() { # label json
  local label="$1" json="$2"
  if ! grep -q '"success":true' <<<"$json"; then
    echo "✗ $label failed: $json" >&2
    exit 1
  fi
  echo "✓ $label"
}

command -v curl >/dev/null 2>&1 || { echo "✗ curl not found" >&2; exit 1; }

if ! curl -sS --max-time 3 "$BASE/health" | grep -q '"status"'; then
  echo "✗ no daemon at $BASE — start one first (npm run daemon:start," >&2
  echo "  or PORT_DADDY_PREFIX=/tmp/pd-proof PORT_DADDY_PORT=9877 npx tsx server.ts" >&2
  echo "  and re-run with PD_BASE=http://127.0.0.1:9877)" >&2
  exit 1
fi
echo "✓ daemon at $BASE"

AGENT_A="proof-alpha-$STAMP"
AGENT_B="proof-beta-$STAMP"
AGENT_C="proof-gamma-$STAMP"

# ── 1. Register agents + start sessions (real routes, real ownership) ─────────
need_ok "register $AGENT_A" "$(req POST /agents "{\"id\":\"$AGENT_A\",\"name\":\"alpha\",\"purpose\":\"claim-tree-proof\"}")"
need_ok "register $AGENT_B" "$(req POST /agents "{\"id\":\"$AGENT_B\",\"name\":\"beta\",\"purpose\":\"claim-tree-proof\"}")"
need_ok "register $AGENT_C" "$(req POST /agents "{\"id\":\"$AGENT_C\",\"name\":\"gamma\",\"purpose\":\"claim-tree-proof\"}")"

SA_JSON="$(req POST /sessions "{\"purpose\":\"revive claim-tree viz\",\"agentId\":\"$AGENT_A\"}")"
SB_JSON="$(req POST /sessions "{\"purpose\":\"refactor sessions facade\",\"agentId\":\"$AGENT_B\"}")"
SC_JSON="$(req POST /sessions "{\"purpose\":\"doomed zombie work\",\"agentId\":\"$AGENT_C\"}")"
need_ok "session A" "$SA_JSON"
need_ok "session B" "$SB_JSON"
need_ok "session C" "$SC_JSON"
SA="$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' <<<"$SA_JSON")"
SB="$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' <<<"$SB_JSON")"
SC="$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' <<<"$SC_JSON")"

# ── 2. Conflict: A and B claim the SAME file + the SAME symbol region ─────────
# B needs force=true — the daemon honestly 409s the second X claim otherwise.
need_ok "A claims lib/claim-forest.ts" \
  "$(req POST "/sessions/$SA/files" "{\"files\":[\"lib/claim-forest.ts\"],\"agentId\":\"$AGENT_A\"}")"
need_ok "B force-claims lib/claim-forest.ts (CONFLICT)" \
  "$(req POST "/sessions/$SB/files" "{\"files\":[\"lib/claim-forest.ts\"],\"agentId\":\"$AGENT_B\",\"force\":true}")"
need_ok "A claims symbol createSessions.getClaimTree" \
  "$(req POST "/sessions/$SA/files" "{\"regions\":[{\"path\":\"lib/sessions.ts\",\"symbol\":\"getClaimTree\",\"symbolPath\":\"createSessions.getClaimTree\",\"startLine\":2110,\"endLine\":2125}],\"agentId\":\"$AGENT_A\"}")"
need_ok "B force-claims same symbol (CONFLICT)" \
  "$(req POST "/sessions/$SB/files" "{\"regions\":[{\"path\":\"lib/sessions.ts\",\"symbol\":\"getClaimTree\",\"symbolPath\":\"createSessions.getClaimTree\",\"startLine\":2110,\"endLine\":2125}],\"agentId\":\"$AGENT_B\",\"force\":true}")"

# ── 3. Dead-session claims: C claims, then its agent dies for real ────────────
need_ok "C claims core/pd-console/src/claims_pane.rs" \
  "$(req POST "/sessions/$SC/files" "{\"files\":[\"core/pd-console/src/claims_pane.rs\"],\"agentId\":\"$AGENT_C\"}")"
# `draining` has the shortest dead threshold (5 min). After this heartbeat the
# agent goes silent; the reaper's next sweep past the threshold emits
# agent:dead → sessions.abandonByAgent → unreleased dead-session claims.
need_ok "C heartbeats draining (last heartbeat ever)" \
  "$(req POST "/agents/$AGENT_C/heartbeat" '{"status":"draining"}')"

tree_stats() { req GET /claims/tree | sed -n 's/.*"stats":{\([^}]*\)}.*/\1/p'; }

echo
echo "▸ /claims/tree stats now: $(tree_stats)"

if [[ "$SKIP_ZOMBIE" == "1" ]]; then
  echo "▸ PD_SEED_SKIP_ZOMBIE=1 — skipping the zombie wait (no deadClaims state)."
else
  echo "▸ waiting for the resurrection reaper to zombie $AGENT_C"
  echo "  (draining dead threshold 5 min + cleanup sweep interval; timeout ${ZOMBIE_TIMEOUT}s)…"
  WAITED=0
  while true; do
    STATS="$(tree_stats)"
    if grep -q '"deadClaims":[1-9]' <<<"$STATS"; then
      echo "✓ dead-session claims surfaced: $STATS"
      break
    fi
    if (( WAITED >= ZOMBIE_TIMEOUT )); then
      echo "✗ timed out after ${ZOMBIE_TIMEOUT}s waiting for deadClaims > 0 — stats: $STATS" >&2
      echo "  (is config.cleanup.interval_ms very large? shrink it and re-run)" >&2
      exit 1
    fi
    sleep 20; WAITED=$((WAITED + 20))
    echo "  …still waiting (${WAITED}s): $STATS"
  done
fi

echo
echo "Seeded. Verify + capture:"
echo "  curl -s $BASE/claims/tree | jq '.stats'"
echo "  PD_BASE=$BASE PD_PROOF_PANES=\"claims\" scripts/proof/capture-proof.sh"
