#!/usr/bin/env bash
# Fresh-install smoke — "does the SHIPPED release actually work on a clean machine?"
#
# Every other smoke (scripts/smoke-compiled-*.sh) runs a binary built IN the repo
# checkout, where Gatekeeper quarantine, code signatures, and the published feed
# never apply. This one is the opposite: it downloads the PUBLISHED GitHub release
# artifacts a real user gets, verifies them against latest.json, and proves the
# binary runs, the daemon serves, `pd mcp install` works, and — on macOS — that
# Gatekeeper accepts the .app AND latest.json's `signed` flag tells the truth.
#
# Usage:  scripts/fresh-install-smoke.sh [<release-tag>]   (default: latest)
# Env:    GH_TOKEN / GITHUB_TOKEN for `gh` (present on Actions runners).
set -euo pipefail

TAG="${1:-${PD_RELEASE_TAG:-}}"
# The smoke cd's into a throwaway dir before downloading, so `gh` cannot infer
# the repo from a git checkout — every scheduled run since this script landed
# died at step 1 with "failed to run git: not a git repository". Resolve the
# repo explicitly: Actions provides GITHUB_REPOSITORY; local runs default to
# the canonical repo.
REPO="${PD_RELEASE_REPO:-${GITHUB_REPOSITORY:-curiositech/port-daddy}}"
OS="$(uname -s)"; ARCH="$(uname -m)"

case "$OS/$ARCH" in
  Darwin/arm64)  DAEMON_ART="pd-darwin-arm64.tar.gz"; FLEETBAR_ART="PortDaddy-FleetBar-macOS-arm64.zip" ;;
  Linux/x86_64)  DAEMON_ART="pd-linux-x64.tar.gz";    FLEETBAR_ART="" ;;
  *) echo "FAIL: unsupported platform $OS/$ARCH" >&2; exit 1 ;;
esac

WORK="$(mktemp -d)"
DAEMON_PID=""
cleanup() { [ -n "$DAEMON_PID" ] && kill "$DAEMON_PID" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT
cd "$WORK"

FAILED=0
fail() { echo "::error::$*"; echo "FAIL: $*" >&2; FAILED=1; }
ok()   { echo "  ✓ $*"; }

echo "== Fresh-install smoke ($OS/$ARCH, tag=${TAG:-latest}) =="

# 0. On release-published triggers this workflow starts the moment the Release
#    is created — but release.yml uploads its assets DURING its own run, with
#    latest.json landing last (its checksums require every artifact job to be
#    done). Racing the download guarantees a false failure, so when asked
#    (PD_WAIT_FOR_ASSETS=1), poll until latest.json exists on the release.
if [ "${PD_WAIT_FOR_ASSETS:-}" = "1" ]; then
  deadline=$(( $(date +%s) + ${PD_WAIT_TIMEOUT_SECONDS:-2700} ))
  until gh release view "${TAG:-$(gh release list --repo "$REPO" --limit 1 --json tagName --jq '.[0].tagName')}" \
        --repo "$REPO" --json assets --jq '.assets[].name' 2>/dev/null | grep -qx 'latest.json'; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "FAIL: latest.json never appeared on the release within the wait window — release.yml likely failed; check its run." >&2
      exit 1
    fi
    echo "  … release assets not complete yet (latest.json absent); sleeping 60s"
    sleep 60
  done
  ok "release assets complete (latest.json present)"
fi

# 1. Download the published artifacts + the release feed.
DL=(gh release download --repo "$REPO"); [ -n "$TAG" ] && DL+=("$TAG")
DL+=(-p latest.json -p "$DAEMON_ART" --clobber -D .)
[ -n "$FLEETBAR_ART" ] && DL+=(-p "$FLEETBAR_ART")
"${DL[@]}"
[ -f latest.json ] || { echo "FAIL: latest.json not in release" >&2; exit 1; }
ok "downloaded $DAEMON_ART${FLEETBAR_ART:+ + $FLEETBAR_ART} + latest.json"

# 2. SHA-256 must match what latest.json advertises (catches truncated/corrupt
#    uploads and a feed that points at the wrong bytes).
verify_sha() {
  local art="$1"
  local want; want="$(node -e 'const f=require("./latest.json");const a=f.artifacts.find(x=>x.filename===process.argv[1]);process.stdout.write(a?a.sha256:"")' "$art")"
  [ -n "$want" ] || { fail "$art has no entry in latest.json"; return; }
  local got; got="$(shasum -a 256 "$art" | awk '{print $1}')"
  if [ "$want" = "$got" ]; then ok "$art sha256 matches latest.json"; else fail "$art sha256 mismatch (feed=$want disk=$got)"; fi
}
verify_sha "$DAEMON_ART"
[ -n "$FLEETBAR_ART" ] && verify_sha "$FLEETBAR_ART"

# 3. The daemon binary must EXECUTE on a clean machine (not quarantined / not the
#    wrong arch) and report a version matching the feed.
tar xzf "$DAEMON_ART"
chmod +x pd port-daddy 2>/dev/null || true
FEED_VERSION="$(node -e 'process.stdout.write(require("./latest.json").version)')"
if BIN_VERSION="$(./port-daddy --version 2>/dev/null | tr -d '[:space:]')"; then
  ok "port-daddy --version → ${BIN_VERSION:-<empty>}"
  case "$BIN_VERSION" in *"$FEED_VERSION"*) ok "binary version contains feed version $FEED_VERSION" ;;
    *) fail "binary version '$BIN_VERSION' does not contain feed version '$FEED_VERSION'" ;; esac
else
  fail "port-daddy --version failed to run (quarantined? wrong arch?)"
fi

# 4. The daemon must boot and serve /health from the downloaded binary, isolated
#    into a throwaway HOME/prefix so nothing on the runner is touched.
PORT=$(( 9700 + (RANDOM % 200) ))
BASE="http://127.0.0.1:$PORT"
export HOME="$WORK/home"; mkdir -p "$HOME"
PORT_DADDY_PORT="$PORT" PORT_DADDY_PREFIX="$WORK/pdprefix" PORT_DADDY_DB="$WORK/registry.db" \
  PORT_DADDY_NO_FLEET=1 PORT_DADDY_NO_FLEETBAR=1 PORT_DADDY_SILENT=1 \
  ./port-daddy start --foreground >"$WORK/daemon.log" 2>&1 &
DAEMON_PID=$!
ready=0
for _ in $(seq 1 40); do
  if curl -fsS -o /dev/null "$BASE/health" 2>/dev/null; then ready=1; break; fi
  kill -0 "$DAEMON_PID" 2>/dev/null || { fail "daemon process exited before /health (see log)"; cat "$WORK/daemon.log" >&2; break; }
  sleep 0.5
done
if [ "$ready" = 1 ]; then
  ok "daemon /health responded on :$PORT"
  curl -fsS "$BASE/health" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const h=JSON.parse(s);if(h.status!=="ok")process.exit(1);console.log("  ✓ /health status=ok version="+h.version)})' || fail "/health did not report status=ok"
elif [ "$FAILED" = 0 ]; then
  fail "daemon did not become healthy in time"
fi

# 5. `pd mcp install --list` must work from the shipped binary (the agent-wiring
#    command real users run to connect Cursor/Claude/etc.).
if ./pd mcp install --list >"$WORK/mcp.log" 2>&1; then ok "pd mcp install --list ran"; else fail "pd mcp install --list failed (see log)"; cat "$WORK/mcp.log" >&2; fi

[ -n "$DAEMON_PID" ] && kill "$DAEMON_PID" 2>/dev/null || true; DAEMON_PID=""

# 6. macOS only — the part every in-repo smoke is blind to: Gatekeeper on the
#    downloaded .app, cross-checked against the feed's `signed` claim. An app the
#    feed calls `signed:true` that Gatekeeper rejects is the exact "quarantined on
#    first download" failure that ships green today.
if [ -n "$FLEETBAR_ART" ]; then
  ditto -x -k "$FLEETBAR_ART" app
  APP="app/FleetBar.app"
  [ -d "$APP" ] || fail "FleetBar.app not found in $FLEETBAR_ART"
  if [ -d "$APP" ]; then
    AUTH="$(codesign -dvv "$APP" 2>&1 | grep '^Authority=' | head -n1 || true)"
    echo "  · FleetBar.app ${AUTH:-<unsigned>}"
    SIGNED_FLAG="$(node -e 'const f=require("./latest.json");const a=f.artifacts.find(x=>x.filename===process.argv[1]);process.stdout.write(a&&a.signed?"true":"false")' "$FLEETBAR_ART")"
    if spctl --assess --type execute --verbose=2 "$APP" 2>"$WORK/spctl.log"; then GK=pass; else GK=reject; fi
    echo "  · Gatekeeper assessment: $GK ($(tr -d '\n' < "$WORK/spctl.log"))"
    if [ "$SIGNED_FLAG" = "true" ]; then
      if [ "$GK" = "pass" ] && printf '%s' "$AUTH" | grep -q 'Developer ID Application'; then
        ok "FleetBar advertised signed:true and Gatekeeper accepts it"
      else
        fail "latest.json advertises FleetBar signed:true, but Gatekeeper says '$GK' (auth: ${AUTH:-none}). The feed is lying — users get a quarantined app. Fixed by signing FleetBar in release (PR #531) + correcting the latest.json signed flag."
      fi
    else
      echo "::warning::FleetBar is shipped UNSIGNED (latest.json signed:false) — Gatekeeper '$GK'. Sign it (PR #531) so downloads aren't quarantined."
    fi
  fi
fi

echo "== $([ "$FAILED" = 0 ] && echo PASS || echo FAIL): fresh-install smoke =="
exit "$FAILED"
