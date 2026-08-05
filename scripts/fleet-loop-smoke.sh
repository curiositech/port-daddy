#!/usr/bin/env bash
#
# fleet-loop-smoke.sh — Day-one witness for the autonomous fleet loop.
#
# Walks the operator through every verb in the loop:
#   pre-flight -> dispatch propose -> dispatch show -> dispatch run --dry-run
#   -> (optional --really-run) -> pd review --accept -> harbormaster merges
#   -> verify on origin/main.
#
# Defaults to SAFE / dry-run only.  Real spawning costs money and time; pass
# --really-run to actually fire one dispatch end-to-end (~5 min, ~$0.10-1.00).
#
# Exit codes:
#   0  success (every verb invoked produced the expected shape, or was
#      cleanly skipped because the corresponding PR has not landed yet)
#   1  hard failure (a verb that should exist returned an unexpected shape)
#   2  configuration error (no daemon, no session, missing PD binary)
#
# DOES NOT WRITE TO /tmp.  All scratch goes under "$SCRATCH" (default:
# $HOME/coding/tmp/fleet-loop-smoke-$$).
#
# Companion doc: docs/operator/fleet-loop-runbook.md

set -u  # NOT -e -- we want graceful degradation when verbs are missing.
set -o pipefail

# ----------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------

REALLY_RUN=0
DISPATCH_GOAL="${FLEET_LOOP_SMOKE_GOAL:-Add a one-line copyright header to docs/operator/fleet-loop-runbook.md}"
DISPATCH_BUDGET_USD="${FLEET_LOOP_SMOKE_BUDGET:-2.00}"
DISPATCH_TIMEOUT_SEC="${FLEET_LOOP_SMOKE_TIMEOUT:-1800}"  # 30 min
DISPATCH_TAGS="${FLEET_LOOP_SMOKE_TAGS:-loop-smoke,benign}"
DISPATCH_BACKEND="${FLEET_LOOP_SMOKE_BACKEND:-cli:claude-code}"
MERGE_POLICY="${FLEET_LOOP_SMOKE_MERGE_POLICY:-review}"
SCRATCH="${FLEET_LOOP_SMOKE_SCRATCH:-$HOME/coding/tmp/fleet-loop-smoke-$$}"
PD_BIN="${PORT_DADDY_CLI:-}"

if [ -n "$PD_BIN" ] && [[ "$PD_BIN" != */* ]]; then
  PD_BIN="$(command -v "$PD_BIN" 2>/dev/null || true)"
elif [ -z "$PD_BIN" ]; then
  PD_BIN="$(command -v pd 2>/dev/null || true)"
fi

# Every invocation in this witness must use the same selected CLI. In
# particular, a named development daemon commonly exports PORT_DADDY_URL plus
# PORT_DADDY_CLI; silently falling back to Homebrew's older `pd` makes the test
# claim it exercised one daemon while actually speaking an incompatible client.
pd() {
  "$PD_BIN" "$@"
}

for arg in "$@"; do
  case "$arg" in
    --really-run)   REALLY_RUN=1 ;;
    --goal=*)       DISPATCH_GOAL="${arg#*=}" ;;
    --budget=*)     DISPATCH_BUDGET_USD="${arg#*=}" ;;
    --timeout=*)    DISPATCH_TIMEOUT_SEC="${arg#*=}" ;;
    --backend=*)    DISPATCH_BACKEND="${arg#*=}" ;;
    --tags=*)       DISPATCH_TAGS="${arg#*=}" ;;
    --merge-policy=*) MERGE_POLICY="${arg#*=}" ;;
    --scratch=*)    SCRATCH="${arg#*=}" ;;
    -h|--help)
      sed -n '/^# fleet-loop-smoke/,/^# Companion doc:/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown arg: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

mkdir -p "$SCRATCH"

# ----------------------------------------------------------------------
# Output helpers
# ----------------------------------------------------------------------

if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then
  C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'
  C_RESET=$'\033[0m'
else
  C_BOLD=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_RESET=""
fi

step() { echo; echo "${C_BOLD}${C_BLUE}== $* ==${C_RESET}"; }
ok()    { echo "${C_GREEN}  OK${C_RESET}  $*"; OK_COUNT=$((OK_COUNT+1)); }
warn()  { echo "${C_YELLOW}  WARN${C_RESET} $*"; WARN_COUNT=$((WARN_COUNT+1)); }
fail()  { echo "${C_RED}  FAIL${C_RESET} $*"; FAIL_COUNT=$((FAIL_COUNT+1)); }
skip()  { echo "${C_DIM}  SKIP${C_RESET} $*"; SKIP_COUNT=$((SKIP_COUNT+1)); }
note()  { echo "${C_DIM}      $*${C_RESET}"; }

FAIL_COUNT=0
SKIP_COUNT=0
OK_COUNT=0
WARN_COUNT=0
declare -a SKIPPED_VERBS=()

# Run a pd subcommand; if the verb does not exist on the installed daemon,
# mark it skipped and continue.  Argument 1 is the human label.  The rest
# are passed to pd.  Captures stdout+stderr to "$SCRATCH/<slug>.out".
pd_try() {
  local label="$1"; shift
  local slug
  slug=$(echo "$label" | tr -cs 'a-zA-Z0-9' '-' | sed 's/^-//;s/-$//')
  local out="$SCRATCH/${slug}.out"
  if pd "$@" > "$out" 2>&1; then
    ok "$label"
    return 0
  fi
  local rc=$?
  if grep -q "Unknown command\|unknown subcommand\|usage:" "$out" 2>/dev/null; then
    SKIPPED_VERBS+=("pd $*")
    skip "$label  (verb not yet present on installed daemon; see runbook §a)"
    return 2
  fi
  fail "$label  (exit $rc; see $out)"
  return 1
}

# ----------------------------------------------------------------------
# 0. Pre-flight
# ----------------------------------------------------------------------

step "0. Pre-flight"

if [ -z "$PD_BIN" ] || [ ! -x "$PD_BIN" ]; then
  fail "no executable Port Daddy CLI was selected (PORT_DADDY_CLI or pd on PATH)"
  echo "    install via 'brew install curiositech/tap/port-daddy' (see runbook §b)"
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  fail "jq is not on PATH (required for JSON shape assertions)"
  echo "    install via 'brew install jq'"
  exit 2
fi

PD_VERSION=$(pd --version 2>/dev/null | head -1 || echo "unknown")
note "pd version: $PD_VERSION"

STATUS_OUT="$SCRATCH/status.json"
if pd status --json > "$STATUS_OUT" 2>&1; then
  ok "selected daemon is responsive and healthy"
elif jq -e '(.data.status // .status) == "ok"' "$STATUS_OUT" >/dev/null 2>&1; then
  warn "selected daemon is responsive but reports degraded control-plane health"
else
  fail "selected daemon is unreachable (see $STATUS_OUT)"
  exit 2
fi

# guard status must be 'enforce'.
if pd guard status 2>&1 | grep -q "enforce"; then
  ok "Coordination Guard: enforce"
else
  warn "Coordination Guard is NOT enforce.  Install: pd guard install --mode enforce"
fi

# Session presence (whoami).  If no session, this script can still run --
# pd dispatch propose does not require an open session today.
if pd whoami 2>&1 | grep -qi "no active session"; then
  warn "no active pd session — start one with 'pd begin --identity loop-smoke:test --lifecycle durable'"
else
  ok "active pd session"
fi

# Backend list (PR #138 surface).  Skipped silently if not yet shipped.
pd_try "backend list reports at least one backend" backend list || true

# Operator inbox (PR #169).
pd_try "pd attention is callable" attention || true

# ----------------------------------------------------------------------
# 1. Propose one benign dispatch
# ----------------------------------------------------------------------

step "1. Propose ONE benign dispatch"

note "goal:         $DISPATCH_GOAL"
note "budget:       \$$DISPATCH_BUDGET_USD"
note "timeout:      ${DISPATCH_TIMEOUT_SEC}s"
note "backend:      $DISPATCH_BACKEND"
note "merge_policy: $MERGE_POLICY"
note "tags:         $DISPATCH_TAGS"

PROPOSE_OUT="$SCRATCH/propose.json"
if pd dispatch propose "$DISPATCH_GOAL" \
    --tags="$DISPATCH_TAGS" \
    --backend="$DISPATCH_BACKEND" \
    --budget="$DISPATCH_BUDGET_USD" \
    --timeout="$DISPATCH_TIMEOUT_SEC" \
    --merge-policy="$MERGE_POLICY" \
    -j > "$PROPOSE_OUT" 2>&1; then
  DISPATCH_ID=$(jq -r '.dispatch.id // empty' "$PROPOSE_OUT" 2>/dev/null || true)
  if [ -n "$DISPATCH_ID" ]; then
    ok "proposed dispatch ${DISPATCH_ID:0:8} (full id in $PROPOSE_OUT)"
    echo "$DISPATCH_ID" > "$SCRATCH/dispatch.id"
  else
    fail "pd dispatch propose returned 0 but no .dispatch.id in JSON"
    head -10 "$PROPOSE_OUT" | sed 's/^/      | /'
    DISPATCH_ID=""
  fi
else
  if grep -q "Unknown command\|unknown subcommand" "$PROPOSE_OUT"; then
    SKIPPED_VERBS+=("pd dispatch propose")
    skip "pd dispatch is not yet on the installed daemon (PR #163 not merged)"
    DISPATCH_ID=""
  else
    fail "pd dispatch propose failed"
    head -10 "$PROPOSE_OUT" | sed 's/^/      | /'
    DISPATCH_ID=""
  fi
fi

# ----------------------------------------------------------------------
# 2. Verify dispatch row exists and is in 'proposed'
# ----------------------------------------------------------------------

step "2. Verify dispatch row state = 'proposed'"

if [ -z "$DISPATCH_ID" ]; then
  skip "no dispatch id from step 1"
else
  SHOW_OUT="$SCRATCH/show.json"
  if pd dispatch show "$DISPATCH_ID" -j > "$SHOW_OUT" 2>&1; then
    STATE=$(jq -r '.dispatch.state // empty' "$SHOW_OUT" 2>/dev/null || true)
    if [ "$STATE" = "proposed" ]; then
      ok "state = proposed"
    elif [ "$STATE" = "claimed" ]; then
      ok "state = claimed (--auto-claim path)"
    else
      fail "state = '$STATE'  (expected proposed or claimed)"
    fi
    SLUG=$(jq -r '.dispatch.slug' "$SHOW_OUT" 2>/dev/null || echo "?")
    note "slug: $SLUG"
  else
    fail "pd dispatch show failed (see $SHOW_OUT)"
  fi
fi

# ----------------------------------------------------------------------
# 3. Dry-run the runner
# ----------------------------------------------------------------------

step "3. pd dispatch run --dry-run (plan-only)"

if [ -z "$DISPATCH_ID" ]; then
  skip "no dispatch id from step 1"
else
  DRYRUN_OUT="$SCRATCH/dryrun.json"
  # Default is dry-run; we omit --really-run on purpose.
  if pd dispatch run "$DISPATCH_ID" -j > "$DRYRUN_OUT" 2>&1; then
    DRY=$(jq -r '.dryRun // empty' "$DRYRUN_OUT" 2>/dev/null || true)
    PLAN_BACKEND=$(jq -r '.plan.backend // empty' "$DRYRUN_OUT" 2>/dev/null || true)
    PLAN_WORKTREE=$(jq -r '.plan.worktreePath // empty' "$DRYRUN_OUT" 2>/dev/null || true)
    if [ "$DRY" = "true" ] && [ -n "$PLAN_BACKEND" ] && [ -n "$PLAN_WORKTREE" ]; then
      ok "plan returned: backend=$PLAN_BACKEND worktree=$PLAN_WORKTREE"
    else
      fail "dry-run JSON missing expected fields (dryRun/plan.backend/plan.worktreePath)"
      head -20 "$DRYRUN_OUT" | sed 's/^/      | /'
    fi
  else
    fail "pd dispatch run (dry) failed (see $DRYRUN_OUT)"
  fi
fi

# ----------------------------------------------------------------------
# 4. (optional) really run
# ----------------------------------------------------------------------

step "4. Spawn (only if --really-run was passed)"

if [ "$REALLY_RUN" -eq 0 ]; then
  skip "--really-run NOT passed; refusing to spawn"
  note "to actually exercise the loop end-to-end, re-run:"
  note "  $0 --really-run"
elif [ -z "$DISPATCH_ID" ]; then
  skip "no dispatch id from step 1"
else
  warn "spawning real dispatch.  Cost cap \$$DISPATCH_BUDGET_USD, timeout ${DISPATCH_TIMEOUT_SEC}s."
  # Record current origin/main so step 7 can prove it advanced.
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
  if [ -n "$REPO_ROOT" ]; then
    git -C "$REPO_ROOT" fetch origin --quiet 2>/dev/null || true
    git -C "$REPO_ROOT" rev-parse origin/main > "$SCRATCH/main-head-before" 2>/dev/null || true
  fi
  REAL_OUT="$SCRATCH/reallyrun.log"
  if pd dispatch run "$DISPATCH_ID" --really-run > "$REAL_OUT" 2>&1; then
    ok "spawn returned 0 (worker may still be running asynchronously)"
    tail -20 "$REAL_OUT" | sed 's/^/      | /'
  else
    fail "pd dispatch run --really-run returned non-zero (see $REAL_OUT)"
  fi

  # Poll for state transitions.  Caps at timeout * 1.5 to give the worker
  # room beyond the hard kill so we can observe failed/salvage too.
  POLL_DEADLINE=$(( $(date +%s) + DISPATCH_TIMEOUT_SEC + DISPATCH_TIMEOUT_SEC / 2 ))
  TERMINAL=""
  while [ "$(date +%s)" -lt "$POLL_DEADLINE" ]; do
    pd dispatch show "$DISPATCH_ID" -j > "$SCRATCH/poll.json" 2>/dev/null || break
    CUR=$(jq -r '.dispatch.state // empty' "$SCRATCH/poll.json" 2>/dev/null || echo "")
    echo "    state=$CUR  (t=$(date +%H:%M:%S))"
    case "$CUR" in
      review_pending|settled|failed|salvage|rejected)
        TERMINAL="$CUR"; break ;;
    esac
    sleep 20
  done
  if [ -z "$TERMINAL" ]; then
    fail "did not reach a review/terminal state before deadline"
  else
    ok "reached state: $TERMINAL"
  fi
fi

# ----------------------------------------------------------------------
# 5. Review (operator step) — verb existence only
# ----------------------------------------------------------------------

step "5. pd review verb shape"

if pd review --help > "$SCRATCH/review-help.out" 2>&1 \
   || grep -q "Usage: pd review" "$SCRATCH/review-help.out"; then
  if grep -q -- "--accept" "$SCRATCH/review-help.out" \
     && grep -q -- "--reject" "$SCRATCH/review-help.out"; then
    ok "pd review supports --accept and --reject"
  else
    fail "pd review help is missing --accept or --reject"
  fi
else
  if grep -q "Unknown command" "$SCRATCH/review-help.out"; then
    SKIPPED_VERBS+=("pd review")
    skip "pd review not yet on installed daemon (PR #163)"
  else
    fail "pd review --help failed unexpectedly"
  fi
fi

note "operator action when a real run reaches review_pending:"
note "  pd review <id> --accept             # harbormaster will merge"
note "  pd review <id> --reject \"<reason>\"  # transitions to rejected/salvage"

# ----------------------------------------------------------------------
# 6. Harbormaster status
# ----------------------------------------------------------------------

step "6. pd harbormaster status"

pd_try "harbormaster status reachable" harbormaster status || true

# ----------------------------------------------------------------------
# 7. Verify origin/main moved (only meaningful after --really-run)
# ----------------------------------------------------------------------

step "7. Confirm origin/main advanced (only after --really-run)"

if [ "$REALLY_RUN" -eq 0 ]; then
  skip "verification of merged PR requires --really-run"
else
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
  if [ -z "$REPO_ROOT" ]; then
    fail "not inside a git repo"
  else
    git -C "$REPO_ROOT" fetch origin --quiet
    HEAD_BEFORE=$(cat "$SCRATCH/main-head-before" 2>/dev/null || echo "")
    HEAD_AFTER=$(git -C "$REPO_ROOT" rev-parse origin/main)
    if [ -z "$HEAD_BEFORE" ]; then
      warn "no recorded HEAD before run; cannot diff"
    elif [ "$HEAD_BEFORE" = "$HEAD_AFTER" ]; then
      warn "origin/main unchanged ($HEAD_AFTER) -- merge has not happened yet"
    else
      ok "origin/main advanced  $HEAD_BEFORE -> $HEAD_AFTER"
    fi
  fi
fi

# ----------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------

step "Summary"
echo "  OK:      $OK_COUNT"
echo "  WARN:    $WARN_COUNT"
echo "  SKIP:    $SKIP_COUNT"
echo "  FAIL:    $FAIL_COUNT"
echo ""
if [ "${#SKIPPED_VERBS[@]}" -gt 0 ]; then
  echo "  Skipped verbs (PR not yet merged or daemon not yet rebuilt):"
  for v in "${SKIPPED_VERBS[@]}"; do echo "    - $v"; done
  echo ""
fi
echo "  Scratch logs: $SCRATCH"
echo "  Runbook:      docs/operator/fleet-loop-runbook.md"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
