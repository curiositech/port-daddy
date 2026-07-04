#!/usr/bin/env bash
# pd-app-watch.sh — keep the operator's app lanes fresh, automatically.
#
# Two triggers, one watcher (launchd label com.portdaddy.appwatch, installed by
# scripts/install-app-watch.sh, runs this script every few minutes):
#
#   LATEST — origin/main moved (merge queue, direct push, anything):
#            rebuild + relaunch  ~/Applications/pd-console-latest.app
#                            and ~/Applications/Port Daddy/FleetBar (dev-latest).app
#
#   PROD   — the Homebrew tap cut a new port-daddy version:
#            brew update + upgrade port-daddy, then rebuild + relaunch the prod
#            pair (pd-console-prod.app / FleetBar.app) from that release tag.
#
# Why polling and not a git hook: main mostly advances via the GitHub merge
# queue, so no local hook ever fires. The existing pd-console post-merge hook
# still covers the interactive `git pull` path; this watcher covers everything.
#
# Builds happen in a DEDICATED clone (~/.port-daddy/app-watch/repo), never in
# the operator's working checkout — their branch state, dirty tree, and cargo
# locks are untouched. The clone's target/ persists so rebuilds are incremental.
#
# State lives in ~/.port-daddy/app-watch/ as one-line files:
#   built-main-sha        last origin/main SHA whose latest-lane build SUCCEEDED
#   attempted-main-sha    last SHA we TRIED — a broken build is not retried until
#                         main moves again (the failure notification tells you;
#                         rerun manually with --force-latest after a fix)
#   built-prod-version / attempted-prod-version   same pattern for the tap
#
# Usage:
#   pd-app-watch.sh                  # one poll pass (what launchd runs)
#   pd-app-watch.sh --force-latest   # rebuild latest lanes even if SHA unchanged/failed
#   pd-app-watch.sh --force-prod     # rebuild prod lanes even if version unchanged/failed
set -uo pipefail

REPO_URL="https://github.com/curiositech/port-daddy.git"
TAP_FORMULA_RAW="https://raw.githubusercontent.com/curiositech/homebrew-tap/HEAD/Formula/port-daddy.rb"
BASE="$HOME/.port-daddy/app-watch"
REPO="$BASE/repo"
BUILD_LOGS="$BASE/builds"
LOCK="$BASE/lock"

FORCE_LATEST=0; FORCE_PROD=0
for a in "$@"; do
  case "$a" in
    --force-latest) FORCE_LATEST=1 ;;
    --force-prod)   FORCE_PROD=1 ;;
    -h|--help) sed -n '2,33p' "$0"; exit 0 ;;
    *) echo "✗ unknown argument: $a" >&2; exit 2 ;;
  esac
done

# launchd gives agents a bare PATH; builds need brew (node, magick), cargo, swift.
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "$BASE" "$BUILD_LOGS"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
notify() { # notify <title> <message> — best-effort operator toast
  # AppleScript string escaping: backslashes FIRST, then quotes (fleet red-team:
  # tap-controlled text reaches this — never let it break out of the literal).
  local t="$1" m="$2"
  t="${t//\\/\\\\}"; t="${t//\"/\\\"}"
  m="${m//\\/\\\\}"; m="${m//\"/\\\"}"
  osascript -e "display notification \"$m\" with title \"$t\"" >/dev/null 2>&1 || true
}
state_get() { cat "$BASE/$1" 2>/dev/null || true; }
state_set() { printf '%s' "$2" > "$BASE/$1"; }

# ── Single-flight lock (builds run many minutes; polls every few) ──────────────
# Fail-closed discipline (fleet review finding): every path that does not WIN
# the mkdir exits this tick. Stale detection uses dead-pid OR an age ceiling —
# the age check breaks the PID-reuse wedge (holder pid recycled by an unrelated
# long-lived process would otherwise hold the lock forever).
LOCK_MAX_AGE_S=$((3 * 3600))
lock_acquire() {
  mkdir "$LOCK" 2>/dev/null && printf '%s' $$ > "$LOCK/pid" && trap 'rm -rf "$LOCK"' EXIT
}
if ! lock_acquire; then
  HOLDER="$(cat "$LOCK/pid" 2>/dev/null || true)"
  LOCK_BORN="$(stat -f %m "$LOCK" 2>/dev/null || stat -c %Y "$LOCK" 2>/dev/null || echo 0)"
  LOCK_AGE=$(( $(date +%s) - LOCK_BORN ))
  if [ -n "$HOLDER" ] && kill -0 "$HOLDER" 2>/dev/null && [ "$LOCK_AGE" -lt "$LOCK_MAX_AGE_S" ]; then
    exit 0   # a build is in flight; this poll tick simply yields
  fi
  log "removing stale lock (pid ${HOLDER:-?}, age ${LOCK_AGE}s)"
  rm -rf "$LOCK"
  # If another tick wins the re-acquire race, YIELD — never continue unlocked.
  lock_acquire || exit 0
fi

# ── Ensure the build clone exists and is current ───────────────────────────────
if [ ! -d "$REPO/.git" ]; then
  log "seeding build clone → $REPO (blobless; first build will be a cold one)"
  git clone --filter=blob:none "$REPO_URL" "$REPO" || { log "✗ clone failed"; exit 1; }
fi
git -C "$REPO" fetch --quiet origin main --tags 2>/dev/null || { log "✗ git fetch failed (offline?)"; exit 0; }

run_lanes() { # run_lanes <lane-flag> <log-slug>  → 0 iff both apps built+launched
  local flag="$1" slug="$2" stamp blog rc=0
  stamp="$(date +%Y%m%d-%H%M%S)"
  blog="$BUILD_LOGS/$stamp-$slug.log"
  log "building $slug lanes (log: $blog)"
  bash "$REPO/core/pd-console/scripts/package-console.sh" "$flag" >>"$blog" 2>&1 || rc=1
  if [ -f "$REPO/apps/FleetBar/scripts/package-fleetbar-lane.sh" ]; then
    bash "$REPO/apps/FleetBar/scripts/package-fleetbar-lane.sh" "$flag" >>"$blog" 2>&1 || rc=1
  else
    log "⚠ FleetBar lane script not on this ref yet — console only" | tee -a "$blog"
  fi
  return $rc
}

# ── LATEST: did origin/main move? ──────────────────────────────────────────────
MAIN_SHA="$(git -C "$REPO" rev-parse origin/main)"
if [ "$FORCE_LATEST" = 1 ] || { [ "$MAIN_SHA" != "$(state_get built-main-sha)" ] && [ "$MAIN_SHA" != "$(state_get attempted-main-sha)" ]; }; then
  state_set attempted-main-sha "$MAIN_SHA"
  log "origin/main → ${MAIN_SHA:0:10}; refreshing latest lanes"
  git -C "$REPO" checkout --quiet --force --detach origin/main
  if run_lanes --latest latest; then
    state_set built-main-sha "$MAIN_SHA"
    log "✓ latest lanes refreshed to ${MAIN_SHA:0:10}"
    notify "Port Daddy apps" "latest lanes rebuilt + relaunched (main @ ${MAIN_SHA:0:10})"
    # Self-update: the copy launchd runs lives outside the repo; refresh it (and
    # the installer) from the ref we just built so the watcher tracks main too.
    # ATOMIC (fleet review HIGH): a plain cp onto the RUNNING script truncates
    # the open inode mid-execution and bash reads misaligned bytes — write a
    # temp file and mv over it, which swaps the directory entry while the
    # running shell keeps its old inode until exit.
    for f in pd-app-watch.sh install-app-watch.sh; do
      if [ -f "$REPO/scripts/$f" ] && ! cmp -s "$REPO/scripts/$f" "$HOME/.port-daddy/bin/$f"; then
        TMPF="$HOME/.port-daddy/bin/.$f.new.$$"
        cp "$REPO/scripts/$f" "$TMPF" && chmod +x "$TMPF" && mv -f "$TMPF" "$HOME/.port-daddy/bin/$f"
        log "self-updated $f from main (atomic swap; takes effect next tick)"
      fi
    done
  else
    log "✗ latest lane build FAILED for ${MAIN_SHA:0:10} — see newest log in $BUILD_LOGS"
    notify "Port Daddy apps" "latest lane build FAILED @ ${MAIN_SHA:0:10} — check $BUILD_LOGS"
  fi
fi

# ── PROD: did the Homebrew tap cut a new version? ──────────────────────────────
TAP_VERSION="$(curl -fsSL --max-time 20 "$TAP_FORMULA_RAW" 2>/dev/null | sed -nE 's/^ *version "([^"]+)".*/\1/p' | head -1)"
if [ -z "$TAP_VERSION" ]; then
  log "⚠ could not read tap formula version (offline or tap moved) — skipping prod check"
elif [ "$FORCE_PROD" = 1 ] || { [ "$TAP_VERSION" != "$(state_get built-prod-version)" ] && [ "$TAP_VERSION" != "$(state_get attempted-prod-version)" ]; }; then
  state_set attempted-prod-version "$TAP_VERSION"
  log "homebrew tap → v$TAP_VERSION; refreshing prod"

  # 1. The formula itself (the pd daemon/CLI). brew upgrade is a no-op when the
  #    local install already matches.
  if command -v brew >/dev/null 2>&1; then
    brew update --quiet >/dev/null 2>&1 || true
    brew upgrade port-daddy >/dev/null 2>&1 || true
    # Brew churn is exactly what unloads the daemon's launchd job (silent daemon
    # death — see pd doctor supervision-integrity). Re-start the service if the
    # upgrade left it unloaded.
    # [[:space:]] not \s — BSD grep has no \s and this net must actually fire.
    if brew services list 2>/dev/null | grep -E '^port-daddy[[:space:]]' | grep -qv started; then
      log "daemon service not running after upgrade — brew services start port-daddy"
      brew services start port-daddy >/dev/null 2>&1 || true
    fi
  fi

  # 2. The prod apps, built from the release tag the cut corresponds to.
  if git -C "$REPO" rev-parse -q --verify "refs/tags/v$TAP_VERSION" >/dev/null; then
    git -C "$REPO" checkout --quiet --force --detach "v$TAP_VERSION"
    if run_lanes --prod prod; then
      state_set built-prod-version "$TAP_VERSION"
      log "✓ prod lanes refreshed to v$TAP_VERSION"
      notify "Port Daddy apps" "prod lanes rebuilt + relaunched (v$TAP_VERSION)"
    else
      log "✗ prod lane build FAILED for v$TAP_VERSION — see newest log in $BUILD_LOGS"
      notify "Port Daddy apps" "prod lane build FAILED @ v$TAP_VERSION — check $BUILD_LOGS"
    fi
    # Leave the clone back on main so the next latest build starts from the right ref.
    git -C "$REPO" checkout --quiet --force --detach origin/main
  else
    log "✗ tag v$TAP_VERSION not found on origin — tap moved before the tag was pushed? Skipping prod app build."
    notify "Port Daddy apps" "tap cut v$TAP_VERSION but tag is missing — prod apps NOT rebuilt"
  fi
fi

exit 0
