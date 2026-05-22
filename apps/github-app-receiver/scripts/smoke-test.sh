#!/usr/bin/env bash
#
# smoke-test.sh — POST a synthetic pull_request.opened webhook with a
# valid HMAC signature to the Worker (local `wrangler dev` by default).
# The Worker should respond 204 and forward the envelope to whatever
# DAEMON_FORWARD_URL points at.
#
# Usage:
#   GITHUB_WEBHOOK_SECRET=local-dev-secret \
#   ./scripts/smoke-test.sh
#
#   # Or against a deployed Worker:
#   WORKER_URL=https://github-app-receiver.<acct>.workers.dev \
#   GITHUB_WEBHOOK_SECRET=<prod-secret> \
#   ./scripts/smoke-test.sh
#
# Requires: curl, openssl, bash 4+.

set -euo pipefail

WORKER_URL="${WORKER_URL:-http://127.0.0.1:8787}"
SECRET="${GITHUB_WEBHOOK_SECRET:-}"
EVENT="${EVENT:-pull_request}"
DELIVERY="${DELIVERY:-smoke-$(date +%s)}"

if [[ -z "$SECRET" ]]; then
  echo "ERROR: GITHUB_WEBHOOK_SECRET must be set (matching the Worker's secret)" >&2
  exit 2
fi

PAYLOAD=$(cat <<'JSON'
{
  "action": "opened",
  "number": 42,
  "pull_request": {
    "id": 1,
    "number": 42,
    "title": "smoke test PR",
    "user": { "login": "smoke-bot", "id": 1 },
    "head": { "ref": "feat/smoke", "sha": "deadbeef" },
    "base": { "ref": "main", "sha": "cafef00d" }
  },
  "repository": { "id": 100, "full_name": "curiositech/port-daddy" },
  "installation": { "id": 9999 },
  "sender": { "login": "smoke-bot", "id": 1 }
}
JSON
)

# Compute HMAC SHA-256 the same way GitHub does.
SIG=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')

echo "→ POST $WORKER_URL"
echo "  X-GitHub-Event:    $EVENT"
echo "  X-GitHub-Delivery: $DELIVERY"
echo "  X-Hub-Signature-256: sha256=${SIG:0:12}…"

HTTP_STATUS=$(curl -sS -o /tmp/smoke-resp.$$ -w '%{http_code}' \
  -X POST "$WORKER_URL" \
  -H 'content-type: application/json' \
  -H "x-github-event: $EVENT" \
  -H "x-github-delivery: $DELIVERY" \
  -H "x-hub-signature-256: sha256=$SIG" \
  --data-binary "$PAYLOAD") || HTTP_STATUS="000"

BODY=$(cat /tmp/smoke-resp.$$ || true)
rm -f /tmp/smoke-resp.$$

echo "← HTTP $HTTP_STATUS"
if [[ -n "$BODY" ]]; then echo "  body: $BODY"; fi

if [[ "$HTTP_STATUS" == "204" ]]; then
  echo "PASS: valid signature accepted, envelope forwarded"
else
  echo "FAIL: expected 204, got $HTTP_STATUS" >&2
  echo "Hint: a 502 means the Worker accepted the signature but DAEMON_FORWARD_URL is unreachable." >&2
  exit 1
fi

# Tamper test: same payload, wrong signature, should be 401.
echo
echo "→ POST $WORKER_URL (with tampered signature)"
BAD_SIG="sha256=$(printf '0%.0s' {1..64})"
TAMPER_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$WORKER_URL" \
  -H 'content-type: application/json' \
  -H "x-github-event: $EVENT" \
  -H "x-github-delivery: ${DELIVERY}-bad" \
  -H "x-hub-signature-256: $BAD_SIG" \
  --data-binary "$PAYLOAD") || TAMPER_STATUS="000"
echo "← HTTP $TAMPER_STATUS"
if [[ "$TAMPER_STATUS" == "401" ]]; then
  echo "PASS: tampered signature rejected"
else
  echo "FAIL: expected 401 on tampered signature, got $TAMPER_STATUS" >&2
  exit 1
fi

echo
echo "smoke test complete"
