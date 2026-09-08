#!/usr/bin/env bash
# activate-accounts.sh — one-shot activation of ADR-0101 accounts/login/run-pages.
#
# The relay + fleet-executor Workers ship this code DISABLED (fail-closed):
#   • GitHub login returns 503 LOGIN_UNCONFIGURED until GITHUB_OAUTH_CLIENT_SECRET
#     and USER_TOKEN_WRAPPING_KEY are both set (auth-github.ts:129).
#   • "Port Daddy Fleet" check runs carry NO details_url until RUN_PAGE_SECRET is
#     set on BOTH workers (run-page.ts:39). The two must be byte-identical.
#
# This script sets those runtime secrets via `wrangler secret put`. It:
#   • GENERATES the two random secrets (RUN_PAGE_SECRET shared across both
#     workers; USER_TOKEN_WRAPPING_KEY on the relay),
#   • PROMPTS for the two you obtain externally (GitHub OAuth client secret;
#     optional Stripe keys),
#   • prints the exact GitHub/Stripe URLs you must register by hand.
#
# It never prints secret values and never writes them to disk. Re-runnable:
# `wrangler secret put` overwrites. Requires an authenticated `wrangler`
# (`wrangler login` or CLOUDFLARE_API_TOKEN in env).
#
# Usage:
#   scripts/activate-accounts.sh            # login + run-pages (+ optional Stripe)
#   scripts/activate-accounts.sh --no-stripe   # skip Stripe (BYOK-only launch)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELAY_DIR="$REPO_ROOT/apps/relay"
EXECUTOR_DIR="$REPO_ROOT/apps/fleet-executor"
RELAY_CFG="wrangler.deploy.toml"
EXECUTOR_CFG="wrangler.deploy.toml"

WANT_STRIPE=1
for arg in "$@"; do
  case "$arg" in
    --no-stripe) WANT_STRIPE=0 ;;
    -h|--help) sed -n '2,32p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# The relay origin is the committed source of truth for the redirect/webhook base.
RELAY_ORIGIN="$(grep -E '^PUBLIC_BASE_URL' "$RELAY_DIR/$RELAY_CFG" | head -1 | sed -E 's/.*= *"([^"]+)".*/\1/')"
: "${RELAY_ORIGIN:?could not read PUBLIC_BASE_URL from $RELAY_DIR/$RELAY_CFG}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }

command -v wrangler >/dev/null 2>&1 || { echo "wrangler not found on PATH" >&2; exit 1; }
command -v openssl  >/dev/null 2>&1 || { echo "openssl not found on PATH"  >&2; exit 1; }

# put_secret <dir> <config> <NAME>   — value read from stdin, never echoed.
put_secret() {
  local dir="$1" cfg="$2" name="$3"
  ( cd "$dir" && wrangler secret put "$name" --config "$cfg" )
}

bold "Port Daddy — accounts / login / run-page activation"
echo "Relay origin: $RELAY_ORIGIN"
echo "This sets Cloudflare Worker secrets on 'port-daddy-relay' and 'port-daddy-fleet-executor'."
echo "You must be logged in to wrangler for the right Cloudflare account."

# ── 1. Shared run-page HMAC secret (Phase 0) ─────────────────────────────────
step "1/4  RUN_PAGE_SECRET (generated, shared by relay + executor)"
RUN_PAGE_SECRET="$(openssl rand -hex 32)"
printf '%s' "$RUN_PAGE_SECRET" | put_secret "$RELAY_DIR"    "$RELAY_CFG"    RUN_PAGE_SECRET
printf '%s' "$RUN_PAGE_SECRET" | put_secret "$EXECUTOR_DIR" "$EXECUTOR_CFG" RUN_PAGE_SECRET
unset RUN_PAGE_SECRET
echo "✓ RUN_PAGE_SECRET set identically on both workers — check-run details_url will now render."

# ── 2. Token wrapping key (Phase 1) ──────────────────────────────────────────
step "2/4  USER_TOKEN_WRAPPING_KEY (generated, relay only)"
echo "AES-GCM key that encrypts each user's GitHub token at rest. Keep it safe —"
echo "losing it means stored tokens can't be decrypted and users must re-login."
# printf '%s' (no trailing newline): the relay fromHex()-decodes this value
# (auth-github.ts:144), so a stray newline would corrupt the AES key.
printf '%s' "$(openssl rand -hex 32)" | put_secret "$RELAY_DIR" "$RELAY_CFG" USER_TOKEN_WRAPPING_KEY
echo "✓ USER_TOKEN_WRAPPING_KEY set."

# ── 3. GitHub OAuth client secret (Phase 1) ──────────────────────────────────
step "3/4  GITHUB_OAUTH_CLIENT_SECRET (obtained from the GitHub App)"
echo "Generate at: GitHub → Settings → Developer settings → GitHub Apps →"
echo "  Port Daddy Fleet → Client secrets → 'Generate a new client secret'."
echo "On that same page, set the OAuth Callback URL to:"
bold  "  $RELAY_ORIGIN/auth/github/callback"
echo "Paste the client secret below (input hidden):"
put_secret "$RELAY_DIR" "$RELAY_CFG" GITHUB_OAUTH_CLIENT_SECRET
echo "✓ GITHUB_OAUTH_CLIENT_SECRET set — GitHub login is now live (was 503)."

# ── 3b. GitHub App private key (bot identity: checks + run-page details_url) ──
# Distinct from the OAuth client secret above. This is the App's PEM private
# key (GITHUB_APP_PRIVATE_KEY) used to mint installation tokens — it's what lets
# the 'port-daddy-fleet' bot post check runs and stamp the run-page details_url.
# Consumed by BOTH the relay (fleet-control.ts) and fleet-executor (execute.ts).
# GITHUB_APP_ID is already a committed var (fleet-executor = 3810450).
step "3b/4  GITHUB_APP_PRIVATE_KEY (the App's .pem — relay + fleet-executor)"
DEFAULT_PEM="$(ls -t "$HOME"/coding/port-daddy*.private-key.pem 2>/dev/null | head -1 || true)"
printf 'Path to the GitHub App private key .pem'
[ -n "$DEFAULT_PEM" ] && printf ' [%s]' "$DEFAULT_PEM"
printf ': '
read -r PEM_PATH
PEM_PATH="${PEM_PATH:-$DEFAULT_PEM}"
if [ -n "$PEM_PATH" ] && [ -f "$PEM_PATH" ]; then
  # BEGIN header is present on a real PEM; guards against pasting the wrong file.
  if ! grep -q 'BEGIN.*PRIVATE KEY' "$PEM_PATH"; then
    echo "⚠ $PEM_PATH is not a PEM private key — skipping (this is NOT the OAuth secret)." >&2
  else
    cat "$PEM_PATH" | put_secret "$RELAY_DIR"    "$RELAY_CFG"    GITHUB_APP_PRIVATE_KEY
    cat "$PEM_PATH" | put_secret "$EXECUTOR_DIR" "$EXECUTOR_CFG" GITHUB_APP_PRIVATE_KEY
    echo "✓ GITHUB_APP_PRIVATE_KEY set on relay + fleet-executor."
  fi
else
  echo "• No .pem given — skipping (bot check-runs/run-pages need it later)."
fi

# ── 4. Stripe (Phase 3 managed credits) — optional ───────────────────────────
if [ "$WANT_STRIPE" -eq 1 ]; then
  step "4/4  Stripe keys (obtained from the Stripe dashboard) — optional"
  echo "Skip this (Ctrl-C, re-run with --no-stripe) if launching BYOK-only."
  echo "STRIPE_SECRET_KEY = Developers → API keys → Secret key (sk_live_… / sk_test_…)."
  echo "Paste STRIPE_SECRET_KEY below (input hidden):"
  put_secret "$RELAY_DIR" "$RELAY_CFG" STRIPE_SECRET_KEY
  echo "Register a webhook endpoint in Stripe → Developers → Webhooks at:"
  bold  "  $RELAY_ORIGIN/billing/webhook"
  echo "Then paste its signing secret (STRIPE_WEBHOOK_SECRET, whsec_…) below:"
  put_secret "$RELAY_DIR" "$RELAY_CFG" STRIPE_WEBHOOK_SECRET
  echo "✓ Stripe keys set — managed credits + billing portal are now live."
else
  step "4/4  Stripe — SKIPPED (--no-stripe). BYOK-only launch."
fi

step "Done. Manual follow-ups:"
echo "  • GitHub App OAuth callback URL: $RELAY_ORIGIN/auth/github/callback"
if [ "$WANT_STRIPE" -eq 1 ]; then
  echo "  • Stripe webhook endpoint:       $RELAY_ORIGIN/billing/webhook"
fi
echo "  • Redeploy is NOT required for secret changes, but deploy latest code with:"
echo "      (cd $RELAY_DIR    && wrangler deploy --config $RELAY_CFG)"
echo "      (cd $EXECUTOR_DIR && wrangler deploy --config $EXECUTOR_CFG)"
echo "  • Verify login:  curl -sS $RELAY_ORIGIN/auth/github/login -o /dev/null -w '%{http_code}\\n'"
echo "      (302 → live; 503 → a login secret is still missing)"
