#!/usr/bin/env bash
#
# e2e-compiled-cli-surface.sh — the GIGANTIC breaking E2E that drives EVERY
# top-level Port Daddy CLI verb through the COMPILED binary against a scratch
# daemon, and FAILS the build if any command is dead.
#
# WHY THIS EXISTS: a compiled-CLI break (binary exits 1 with no output, or a
# command's module fails to load) shipped GREEN because CI only ever exercised
# ~3 commands (status, tube) and only through the SOURCE CLI — never the full
# verb surface through the compiled binary. smoke-compiled-cli-runs.sh proves
# the binary bootstraps at all; THIS proves every verb in the dispatch actually
# runs. The failure mode we guard: the compiled binary silently dying
# (exit 1 + empty output) or a read command returning nothing.
#
# HERMETIC + SAFE:
#   * ONE scratch daemon, booted from dist/port-daddy (the compiled binary).
#   * EVERY invocation uses the discovery CLI_ENV (PORT/PREFIX/SOCK), NEVER
#     PORT_DADDY_URL, NEVER the default :9876, NEVER the operator's real
#     ~/.port-daddy, NEVER a real DB.
#   * cwd for every call is a scratch workdir, so cwd-writers (briefing, scan,
#     setup, init) land in scratch — the real worktree is never touched.
#   * PORT_DADDY_SNAPSHOT_ROOT is redirected into scratch so snapshot commands
#     never read/write ~/.port-daddy/snapshots.
#   * DANGEROUS / lifecycle verbs (install, uninstall, start, stop, restart,
#     daemon mutate, spawn, sortie run, watch, up, down, mcp, dashboard) are NOT
#     executed against the system — they are tested in a non-mutating subform or
#     SKIPped with an explicit, printed reason. NO SILENT SKIPS.
#   * cleanup trap removes the scratch dir and kills the daemon on exit.
#
# The authoritative verb list is the `case '<verb>':` dispatch in
# bin/port-daddy-cli.ts. This script enumerates that surface and reconciles it
# at the end (see verb-coverage check) so a NEW verb added to the dispatch that
# is not covered here will FAIL the build — the gate cannot silently rot.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${PD_E2E_BIN:-$ROOT_DIR/dist/port-daddy}"
PORT="${E2E_CLI_SURFACE_PORT:-19876}"
SCRATCH_BASE="${SMOKE_SCRATCH_BASE:-$ROOT_DIR/.smoke-tmp}"
mkdir -p "$SCRATCH_BASE"
SCRATCH="$(mktemp -d "$SCRATCH_BASE/pd-cli-surface.XXXXXX")"
WORK="$SCRATCH/work"          # cwd for every CLI call — contains cwd-writers
SNAP_ROOT="$SCRATCH/snapshots" # redirect snapshot store away from ~/.port-daddy
LOG="$SCRATCH/daemon.log"
SOCK="$SCRATCH/pd.sock"
DAEMON_PID=""
mkdir -p "$WORK" "$SNAP_ROOT"

cleanup() {
  if [ -n "$DAEMON_PID" ]; then kill "$DAEMON_PID" 2>/dev/null || true; fi
  rm -rf "$SCRATCH" 2>/dev/null || true
}
trap cleanup EXIT

if [ ! -x "$BIN" ]; then
  echo "FAIL: compiled CLI binary not found at $BIN (run: npm run build:bin)" >&2
  exit 1
fi

# --------------------------------------------------------------------------
# Boot ONE scratch daemon from the compiled binary (mirrors
# smoke-compiled-cli-runs.sh exactly).
# --------------------------------------------------------------------------
echo "Booting self-hosted scratch daemon from the compiled binary ($BIN)..."
PORT_DADDY_PORT="$PORT" \
PORT_DADDY_DB="$SCRATCH/registry.db" \
PORT_DADDY_PREFIX="$SCRATCH" \
PORT_DADDY_SOCK="$SOCK" \
PORT_DADDY_SNAPSHOT_ROOT="$SNAP_ROOT" \
PORT_DADDY_NO_FLEET=1 PORT_DADDY_NO_FLEETBAR=1 PORT_DADDY_SILENT=1 PORT_DADDY_DISABLE_KEYCHAIN=1 \
"$BIN" __daemon > "$LOG" 2>&1 &
DAEMON_PID=$!

ready=0
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/health" 2>/dev/null; then ready=1; break; fi
  kill -0 "$DAEMON_PID" 2>/dev/null || { echo "FAIL: daemon exited during boot" >&2; cat "$LOG" >&2 || true; exit 1; }
  sleep 0.3
done
[ "$ready" = 1 ] || { echo "FAIL: daemon not healthy in time" >&2; cat "$LOG" >&2 || true; exit 1; }
echo "Daemon healthy on :$PORT (scratch=$SCRATCH)."
echo

# --------------------------------------------------------------------------
# CLI helper: discovery env ONLY (PORT + PREFIX + SOCK), cwd = scratch workdir,
# snapshot store redirected into scratch. NEVER PORT_DADDY_URL, NEVER :9876,
# NEVER the real ~/.port-daddy. If the compiled CLI can't bootstrap or talk to
# THIS daemon, every call below fails.
# --------------------------------------------------------------------------
# PORT_DADDY_CONTEXT_SLOT is PINNED so every call below shares ONE session
# context, the way a real operator's single shell does. Without it
# resolveContextSlot() falls back to `ppid-<pid>` (cli/utils/current-context.ts),
# and because each cli() call runs in its own subshell every invocation would get
# a DIFFERENT slot — so `pd begin` would write a context that `pd plan` could
# never read. Pinning it makes the begin→…→done round-trip below exercise the
# real context path instead of an accidental per-process one.
cli() {
  ( cd "$WORK" && env \
      PORT_DADDY_PORT="$PORT" \
      PORT_DADDY_CONTEXT_SLOT="e2e-cli-surface" \
      PORT_DADDY_PREFIX="$SCRATCH" \
      PORT_DADDY_SOCK="$SOCK" \
      PORT_DADDY_SNAPSHOT_ROOT="$SNAP_ROOT" \
      PORT_DADDY_DB="$SCRATCH/registry.db" \
      "$BIN" "$@" )
}

# --------------------------------------------------------------------------
# Bookkeeping.
# --------------------------------------------------------------------------
FAIL=0
TESTED=0
SKIPPED=0
declare -a SKIP_LIST=()
declare -a TESTED_VERBS=()   # canonical verbs we exercised (for reconciliation)
declare -a FAIL_LIST=()

pass() { TESTED=$((TESTED + 1)); echo "PASS  $1"; }
fail() { FAIL=1; FAIL_LIST+=("$1"); echo "FAIL  $1 — $2" >&2; }
skip() { SKIPPED=$((SKIPPED + 1)); SKIP_LIST+=("$1"); echo "SKIP  $1 — $2"; }

# mark a canonical verb as covered (idempotent-ish; we don't dedupe but the
# reconciliation only checks membership)
covered() { TESTED_VERBS+=("$1"); }

# run_read <verb-label> <canonical-verb> -- <argv...>
# Asserts the command RAN: it must NOT be the guarded failure mode (exit 1 with
# empty output), and it must print SOMETHING. Many PD commands print a usage or
# "nothing found" banner and exit non-zero by design; that still proves the
# compiled module loaded and ran, so non-zero-WITH-output is a PASS here. The
# only failures are: exit non-zero with EMPTY output (the dead-binary mode), or
# exit 0 with EMPTY output (a read that returned nothing).
run_read() {
  local label="$1"; shift
  local verb="$1"; shift
  [ "$1" = "--" ] && shift
  local out code
  set +e
  out="$(cli "$@" 2>&1)"; code=$?
  set -e
  covered "$verb"
  if [ -z "$out" ]; then
    if [ "$code" -eq 0 ]; then
      fail "$label" "exit 0 but EMPTY output (read returned nothing)"
    else
      fail "$label" "exit $code with EMPTY output (compiled binary silently died)"
    fi
    return
  fi
  pass "$label (exit=$code, $(printf %s "$out" | wc -c | tr -d ' ') bytes)"
}

# run_ok <label> <verb> -- <argv...>
# Strict: must exit 0 AND print output. Used for round-trip steps that should
# unambiguously succeed.
run_ok() {
  local label="$1"; shift
  local verb="$1"; shift
  [ "$1" = "--" ] && shift
  local out code
  set +e
  out="$(cli "$@" 2>&1)"; code=$?
  set -e
  covered "$verb"
  if [ "$code" -ne 0 ]; then
    fail "$label" "expected exit 0, got $code (out=${out:-<empty>})"
    return
  fi
  if [ -z "$out" ]; then
    fail "$label" "exit 0 but EMPTY output"
    return
  fi
  pass "$label (exit=0, $(printf %s "$out" | wc -c | tr -d ' ') bytes)"
}

echo "=== READ commands (must run + print) ============================"
run_read "status"            status      -- status
run_read "version"           version     -- version
run_read "whoami"            whoami      -- whoami
run_read "account"           account     -- account status
run_read "ports"             ports       -- ports
run_read "locks"             locks       -- locks
run_read "sessions"          sessions    -- sessions
run_read "agents"            agents      -- agents
run_read "swarm"             swarm       -- swarm
run_read "actor"             actor       -- actor
run_read "actors"            actors      -- actors
run_read "notes"             notes       -- notes
run_read "channels"          channels    -- channels
run_read "history"           history     -- history
run_read "activity"          activity    -- activity
run_read "log"               log         -- log
run_read "projects"          projects    -- projects
run_read "find"              find        -- find 'no-such:service:ever'
run_read "whois"             whois       -- whois 'no-such-capability'
run_read "services/list"     services    -- services
run_read "dns list"          dns         -- dns list
run_read "roadmap"           roadmap     -- roadmap
run_read "roadmap items"     roadmap     -- roadmap items
run_read "secret list"       secret      -- secret list
run_read "briefing"          briefing    -- briefing
run_read "sitrep"            sitrep      -- sitrep
run_read "look"              look        -- look
run_read "periscope"         periscope   -- periscope
run_read "coast-guard status" coast-guard -- coast-guard status
# ADR-0088 host-safety: `pd safe scan --json` is 100% read-only — it scans the
# operator's own UID's files + shells unprivileged trust/net CLIs, never mutating
# host state. It prefers the daemon route and falls back to an in-process scan,
# so it returns a report regardless of whether THIS scratch binary has the route.
# Assert the JSON report parses (score + state + verbatim HONEST_LIMITS footer)
# and never carries a raw secret value field.
__safe_err="$SCRATCH/safe-scan.stderr"
__safe_out="$(cli safe scan --json 2>"$__safe_err" || true)"
if printf '%s' "$__safe_out" | python3 -c '
import json, sys
d = json.load(sys.stdin)
r = d.get("report", d)
assert isinstance(r.get("score"), (int, float)), "score"
assert r.get("state") in ("green", "amber", "red"), "state"
assert "honestLimits" in r and r["honestLimits"], "honestLimits"
# No raw secret leaks: a finding/blast-radius line must never carry a "value"/"secret"/"raw" key.
blob = json.dumps(r)
for forbidden in ("\"value\":", "\"secret\":", "\"rawValue\":"):
    assert forbidden not in blob, forbidden
sys.exit(0)
' 2>/dev/null; then
  pass "safe scan --json (parses; score+state+honestLimits; no raw-secret field)"
else
  # Include the CLI's stderr — an empty stdout here is almost always an
  # uncaught exception, and the stack trace is the diagnosis.
  fail "safe scan --json" "not a valid posture report: $(printf '%s' "$__safe_out" | head -c 200); stderr: $(head -c 800 "$__safe_err" 2>/dev/null || true)"
fi
# ADR-0088 Phase B: `pd safe corral --all` with NO --apply is a DRY RUN — it
# prints the plan and writes nothing (no vault write, no source rewrite). Assert
# it runs, declares itself a dry run, and echoes the corral honest-limit. The
# `safe guard --staged` read-only scan of the staged diff is exercised too; with
# no staged changes it must exit clean (0) without dying.
__corral_out="$(cli safe corral --all 2>/dev/null || true)"
if printf '%s' "$__corral_out" | grep -qi "DRY RUN" \
   && printf '%s' "$__corral_out" | grep -qi "reduces blast radius"; then
  pass "safe corral --all (dry-run default; honest-limit echoed; nothing written)"
else
  fail "safe corral --all" "no dry-run plan / honest-limit: $(printf '%s' "$__corral_out" | head -c 160)"
fi
# guard --staged: read-only scan of the staged diff. In the scratch repo with no
# staged secrets it must NOT be the guarded failure mode (exit 1 + empty output).
run_read "safe guard --staged" safe -- safe guard --staged
covered safe
run_read "relay status"      relay       -- relay status
run_read "health"            health      -- health
run_read "doctor"            doctor      -- doctor
run_read "diagnose"          diagnose    -- diagnose
run_read "ideas"             ideas       -- ideas
run_read "attention"         attention   -- attention --agent surface:smoke:ci
run_read "nudge"             nudge       -- nudge --agent surface:smoke:ci
run_read "inbox"             inbox       -- inbox
run_read "send (usage)"      send        -- send
run_read "sent"              sent        -- sent
run_read "hints"             hints       -- hints
# ADR-0084 Daemon Berths: `pd use <tier>` emits a shell snippet (read-only, no
# daemon mutation); `pd dev list` probes berths read-only. Both exit 0 + print.
run_ok   "use stable"        use         -- use stable
run_ok   "dev list"          dev         -- dev list

# Exercise every help resolution path and require a successful exit. A crash or
# a fallthrough to the global "Get started:" page is not verb help.
for __verb in session claim attention roster sitrep squid; do
  if __help_out="$(cli "$__verb" --help 2>&1)"; then __help_rc=0; else __help_rc=$?; fi
  __help_first="$(printf '%s' "$__help_out" | head -1)"
  if [ "$__help_rc" -ne 0 ]; then
    fail "$__verb --help -> verb help" "exited $__help_rc: $__help_first"
  elif [ -z "$__help_out" ]; then
    fail "$__verb --help -> verb help" "printed nothing"
  elif printf '%s' "$__help_first" | grep -q 'Get started:'; then
    fail "$__verb --help -> verb help" "fell through to global help: $__help_first"
  else
    pass "$__verb --help -> verb help (not global help)"
  fi
done

# The messaging topic's reliability warning is important enough to pin exactly.
if __help_out="$(cli inbox --help 2>&1)"; then __help_rc=0; else __help_rc=$?; fi
if [ "$__help_rc" -ne 0 ]; then
  fail "inbox --help -> messaging topic" "exited $__help_rc: $(printf '%s' "$__help_out" | head -1)"
elif printf '%s' "$__help_out" | grep -q 'Direct durable messages'; then
  pass "inbox --help -> messaging topic (not global help)"
else
  fail "inbox --help -> messaging topic" "got: $(printf '%s' "$__help_out" | head -1)"
fi
run_read "compass"           compass     -- compass
run_read "advise"            advise      -- advise
run_read "preflight"         preflight   -- preflight
run_read "metrics"           metrics     -- metrics
run_read "config"            config      -- config
run_read "graph"             graph       -- graph
run_read "embed status"      embed       -- embed status
run_read "jury-rig help"     jury-rig -- jury-rig --help
run_read "jury-rig bootstrap status" jury-rig -- jury-rig bootstrap status \
  --home "$WORK/bootstrap-home" --pd-home "$WORK/bootstrap-pd-home" --json
# Skill registry (cli/commands/seamanship.ts). `seamanship list` (the bare
# default subcommand) is a pure READ: it walks defaultSkillCatalogRoots() and
# prints the union, writing nothing. The mutating subforms are NOT run here —
# `sync` copies configured sources into ~/.port-daddy/skills/ and `index`
# rebuilds the catalog on disk; both would touch the operator's real skill store.
# `skills` is the alias of the same handler; it gets its own probe (rather than
# an ALIASES fold) so a broken alias arm in the COMPILED dispatch is caught —
# same pattern as harbormaster/hm and transcripts/transcript above.
run_read "seamanship list"   seamanship  -- seamanship list
run_read "skills list"       skills      -- skills list
run_read "snapshots list"    snapshots   -- snapshots list
run_read "snapshot list"     snapshot    -- snapshot list
run_read "tuple scan"        tuple       -- tuple scan
run_read "tuple count"       tuple       -- tuple count
run_read "harbors"           harbors     -- harbors
run_read "harbor (usage)"    harbor      -- harbor
run_read "webhook list"      webhook     -- webhook list
run_read "webhooks events"   webhooks    -- webhook events
run_read "integration list"  integration -- integration list
run_read "fleet status"      fleet       -- fleet status
# Tender fleet suggestions (PR #322). The bare form is a pure GET
# /fleet/suggestions read; against the scratch daemon it prints the "No pending
# suggestions" banner. The mutating subforms (`suggest approve|dismiss <id>`)
# POST and can trigger a real ship run, so they are NOT exercised here.
run_read "suggest"           suggest     -- suggest
# Durable agent roster (ADR/PR #3129). `roster list` is a pure GET
# /durable-agents read. create/promote/update/attach/continue/retire all mutate
# the append-only agent-node facts (and `continue` launches a backend), so only
# the read arm runs in the surface gate.
run_read "roster list"       roster      -- roster list
run_read "scan"              scan         -- scan
run_read "tunnel list"       tunnel       -- tunnel list
run_read "wallet (usage)"    wallet       -- wallet
run_read "bond list"         bond         -- bond list
run_read "cockpit"           cockpit      -- cockpit
run_read "memory (usage)"    memory       -- memory
run_read "changelog"         changelog    -- changelog
run_read "shipwright (usage)" shipwright  -- shipwright
run_read "pheromone list"    pheromone    -- pheromone list
run_read "quorum list"       quorum       -- quorum list
run_read "parley list"       parley       -- parley list
run_read "obligations"       obligations  -- obligations
run_read "who-owns"          who-owns     -- who-owns README.md
run_read "guard status"      guard        -- guard status
run_read "hooks list"        hooks        -- hooks list
run_read "spawned"           spawned      -- spawned
run_read "work matrix"       work         -- work matrix
run_read "sortie list"       sortie       -- sortie list
run_read "agent (usage)"     agent        -- agent
run_read "commit (usage)"    commit       -- commit
run_read "bench"             bench        -- bench
run_read "benchmark (list)"  benchmark    -- benchmark list-conditions
run_read "demo (usage)"      demo         -- demo
run_read "with-lock (usage)" with-lock    -- with-lock
run_read "salvage"           salvage      -- salvage
run_read "feedback"          feedback     -- feedback "e2e cli-surface probe feedback"
run_read "say (no session)"  say          -- say "e2e cli-surface say probe"
# Honest self-report + read-only digests/listings. attest may exit non-zero
# when an invariant is RED (same shape as doctor/diagnose above) — run_read
# treats non-zero-with-output as a PASS because it proves the module loaded.
run_read "attest"            attest       -- attest
run_read "backend list"      backend      -- backend list
run_read "squid (usage)"     squid        -- squid
# S4a artifact harvest (booty): `pd booty list` is a pure GET /booty read.
# The scratch daemon has no harvested artifacts, so the CLI prints a friendly
# "No harvested artifacts yet" banner rather than empty output — that's real
# non-empty output proving the compiled booty module loaded and ran. The
# mutating subform (`booty add`) content-addresses real files into the blob
# store and isn't exercised here; unit-tested in tests/unit/booty.test.js and
# tests/unit/booty-routes.test.js.
run_read "booty list"        booty        -- booty list
run_read "backup list"       backup       -- backup list
run_read "restore (usage)"   restore      -- restore
run_read "popper status"     popper       -- popper status
run_read "morning"           morning      -- morning
run_read "transcripts list"  transcripts  -- transcripts list
run_read "transcript list"   transcript   -- transcript list
run_read "harbormaster status" harbormaster -- harbormaster status
run_read "hm status"         hm           -- hm status
run_read "review (usage)"    review       -- review
run_read "dispatch (usage)"  dispatch     -- dispatch
# batten: offline release-artifact gate. `batten help` prints usage (exit 0);
# `verify`/`imprint` need a --staged-dir and are exercised in tests/unit/batten.test.js
# + release.yml. The usage read proves the compiled batten module loaded and ran.
run_read "batten (usage)"    batten       -- batten help
# Relay status (ADR-0049). `relay status` is a pure GET /relay/status read; the
# mutating subforms (relay url <value>, relay exchange) are NOT run. Against the
# scratch daemon relay is unconfigured, so it prints the "disabled" banner. If
# the relay route is not mounted it exits non-zero WITH an error line — same
# shape as attest/doctor above, which run_read treats as a PASS because it still
# proves the compiled relay module loaded and ran (the dead-binary failure mode
# is exit-non-zero with EMPTY output).
run_read "relay status"      relay        -- relay status

echo
echo "=== MUTATING round-trips (safe against the scratch daemon) ======"

# claim -> find -> url -> env -> release
SVC="e2e-cli-surface:test:ci"
run_ok  "claim $SVC"         claim    -- claim "$SVC"
run_ok  "url $SVC"           url      -- url "$SVC"
run_ok  "env $SVC"           env      -- env "$SVC"
run_ok  "release $SVC"       release  -- release "$SVC"

# lock -> locks -> unlock
LOCK="e2e-cli-surface-lock"
run_ok  "lock $LOCK"         lock     -- lock "$LOCK"
run_ok  "unlock $LOCK"       unlock   -- unlock "$LOCK"

# begin -> whoami(active) -> note -> notes -> done
# (--allow-main-worktree: CI runs on the main worktree; --sidequest: ADR
# rent-at-claim (S3) requires --roadmap/--roadmap-new/--sidequest on every
# `pd begin` — this is a surface probe, not roadmap-linked work, so it opts
# out with an explicit reason, same pattern as the website-GIF CI job fix.)
run_ok  "begin"              begin    -- begin e2e:surface:ci --lifecycle durable --allow-main-worktree --sidequest "compiled CLI surface E2E probe"
run_ok  "note"               note     -- note "e2e cli-surface round-trip note"
# `pd plan` (PR #3131) resolves the ACTIVE session from the context slot, so it
# is probed here — between begin and done — where a real session exists rather
# than as a bare read that would only ever hit the "no active session" arm.
# `plan set` writes a todo_list note to that scratch session; `plan show` (the
# bare default) reads it back, so the pair round-trips the real GET/POST
# /sessions/:id/notes?type=todo_list path against the scratch daemon.
# NB two things about this probe body:
#   1. It must not START with '-' — the CLI arg parser would read it as a flag
#      and `plan set` would see an empty body. Markdown accepts '*' as a list
#      bullet, so the probe uses that.
#   2. The item is written already CHECKED ('[x]'). `pd done` refuses to close a
#      session whose plan still has unchecked todos — a real guard we must not
#      disable — and this probe's "work" is the probe itself, which is complete
#      by the time `done` runs.
run_ok  "plan set"           plan     -- plan set "* [x] e2e cli-surface plan probe"
run_ok  "plan show"          plan     -- plan
run_read "session (usage)"   session  -- session
run_read "takeover (usage)"  takeover -- takeover
# `session find` with nothing to search by (no --key, no --identity, no pending
# begin attempt in the scratch workdir) must explain itself rather than exit
# silently — it is the recovery door for a lost `pd begin` response.
run_read "session find (usage)" session -- session find
# `pd done` now runs two ADR-0045 preconditions (lib/git-origin-check.ts):
#   1. an honest result-note sentinel (PR URL / no-pr-yet: / not-applicable:)
#   2. a git origin-push check on the cwd's repo.
# This surface probe makes no PR, so the note declares not-applicable. The
# origin check is bypassed with its documented escape hatch + reason: in CI the
# checkout is in DETACHED HEAD (actions/checkout) and the scratch workdir sits
# inside that repo, so the check would refuse with "Detached HEAD: cannot verify
# origin push." That refusal is correct for real work but irrelevant to a
# read-surface probe that never pushes anything.
run_ok  "done"               done     -- done "Result: e2e cli-surface round-trip complete. not-applicable: CI surface probe, no code change." --status abandoned

# pub -> channels reflects it (sub/subscribe/listen/wait are blocking → skipped)
run_ok  "pub"                pub      -- pub e2e:surface:chan "hello from cli-surface e2e"

# tube --send (non-blocking post; --tail is the blocking form, exercised by the
# fan-out in smoke-compiled-cli-runs.sh)
TUBEOUT="$(printf %s 'cli-surface tube body' | cli tube e2e:surface:tube --send 2>&1)" || true
covered tube
if printf %s "$TUBEOUT" | grep -q "posted id="; then
  pass "tube --send (posted)"
else
  fail "tube --send" "did not post (out=${TUBEOUT:-<empty>})"
fi

# tuple put -> read back (Linda-style)
run_ok  "tuple out"          tuple    -- tuple out '["e2e","surface","probe"]'
run_ok  "tuple rd"           tuple    -- tuple rd '["e2e",null,null]'

# dns add (needs --port) -> list -> rm
run_ok  "dns add"            dns      -- dns add e2e-surface.local 127.0.0.1 --port 3999
run_ok  "dns rm"             dns      -- dns rm e2e-surface.local

# --------------------------------------------------------------------------
# Agent Harbor event ledger (binder ch18 C1; ADR-0095): direct-DB CLI through
# the lib/db.ts chokepoint. cli() pins PORT_DADDY_DB to the SCRATCH registry,
# so status reads and project/rebuild rewrite ONLY the disposable projection
# tables in the scratch DB — the append-only harbor_events log is never
# mutated (BEFORE UPDATE/DELETE triggers enforce that in the schema itself).
# --------------------------------------------------------------------------
run_read "harbor-ledger status"  harbor-ledger -- harbor-ledger status
run_ok   "harbor-ledger project" harbor-ledger -- harbor-ledger project
run_ok   "harbor-ledger rebuild" harbor-ledger -- harbor-ledger rebuild
# status --json must parse and report all six projections with fresh/stale
# labeling (stale views may display but never authorize commands).
__hl_out="$(cli harbor-ledger status --json 2>&1 || true)"
if printf '%s' "$__hl_out" | python3 -c '
import json, sys
d = json.load(sys.stdin)
projs = d.get("projections")
assert isinstance(projs, list) and len(projs) == 6, "six projections"
names = {p.get("projection") for p in projs}
assert names == {"roster", "transcript-timeline", "files-touched", "costs", "compliance", "work-receipts"}, names
for p in projs:
    assert isinstance(p.get("stale"), bool), "stale label"
    assert isinstance(p.get("lastLedgerSeq"), (int, float)), "checkpoint"
    assert isinstance(p.get("headSeq"), (int, float)), "head"
sys.exit(0)
' 2>/dev/null; then
  pass "harbor-ledger status --json (parses; 6 projections; stale labels)"
else
  fail "harbor-ledger status --json" "not a valid projection status report: $(printf '%s' "$__hl_out" | head -c 200)"
fi
covered harbor-ledger

echo
echo "=== DANGEROUS / lifecycle (NOT executed — subform or explicit SKIP) ==="

# daemon: `daemon status` is a non-mutating read; the mutating subforms
# (daemon start/stop/restart) are NOT run.
run_read "daemon status"     daemon   -- daemon status

# These would mutate the SYSTEM (launchd, the operator's real daemon, child
# processes, the network, or block on stdin) — never run them in the surface
# E2E. Each is printed so there are NO silent skips.
covered start;     skip "start"     "would start the daemon process; lifecycle, not surface-tested here"
covered stop;      skip "stop"      "would stop a daemon; lifecycle, not surface-tested here"
covered restart;   skip "restart"   "would restart a daemon; lifecycle, not surface-tested here"
covered install;   skip "install"   "would register a launchd service on the host"
covered install-bosun; skip "install-bosun" "would register the Bosun watchdog launchd/systemd job on the host"
covered uninstall; skip "uninstall" "would deregister a launchd service on the host"
covered up;        skip "up"        "would START services declared in .portdaddyrc (real child processes)"
covered down;      skip "down"      "would stop an 'up' session (system processes)"
covered spawn;     skip "spawn"     "would launch a real AI agent backend; bare form prints usage but exec risk — not run"
covered watch;     skip "watch"     "blocking SSE subscriber that execs a script on every message"
covered sub;       skip "sub"       "blocking pub/sub subscriber (subscribe/listen alias) — never terminates"
covered subscribe; skip "subscribe" "alias of sub — blocking subscriber"
covered listen;    skip "listen"    "alias of sub — blocking subscriber"
covered wait;      skip "wait"      "blocks until a matching message arrives"
covered mcp;       skip "mcp"       "boots a stdio MCP server that blocks reading stdin"
covered dashboard; skip "dashboard" "web form opens a browser via 'open'; TUI form is interactive (tsx) — both unsafe in CI"
covered dev;       skip "dev"       "ADR-0084 berths: 'dev list' is read-tested above; 'dev up/down' build+launch/stop a real berth (mutating)"
covered setup;     skip "setup"     "interactive onboarding; writes .portdaddyrc — covered indirectly by scan/init paths"
covered cut;       skip "cut"       "ADR-0084 release cut: runs the daemon/Rust/FleetBar build scripts + writes dist/release (heavy, mutating) — orchestration is unit-tested in tests/unit/release.test.js"
covered init;      skip "init"      "writes project config to cwd; covered by the scan read instead"
covered learn;     skip "learn"     "requires an interactive TTY; refuses in CI by design"
covered tutorial;  skip "tutorial"  "alias of learn — requires a TTY"
covered tunnel;    skip "tunnel"    "tunnel <create> opens a network tunnel; only 'tunnel list' is read-tested above"
covered ci-gate;   skip "ci-gate"   "runs the full feature-parity gate (heavy); exercised by its own CI job"
covered self-update; skip "self-update" "ADR-0062: runs brew upgrade + restarts the daemon/GUI — mutating + macOS/Homebrew-only; the pure isUpgradeAvailable() is unit-tested"
covered upgrade;   skip "upgrade"   "ADR-0057 phase 7: fetches the real GitHub latest.json feed over the network (non-hermetic) and --apply shells brew upgrade; the pure decision (decideUpgrade/verifyChecksum/compareSemver) is unit-tested in tests/unit/latest-manifest.test.js + tests/unit/upgrade.test.js"
covered guard;     skip "guard"     "guard install/check mutate hooks; only 'guard status' is read-tested above"
covered harbor;    skip "harbor"    "harbor create/enter/leave/destroy mutate permission namespaces; usage read-tested above"
covered add;       skip "add"       "git staging wrapper; mutates the index — not run in the surface gate"
covered nightshift; skip "nightshift" "deprecated alias of 'dispatch' (ADR-0035); emits a deprecation banner then runs the dispatch queue — 'dispatch' usage is read-tested above"

echo
echo "=== Verb-surface reconciliation against bin/port-daddy-cli.ts ====="
# Derive the authoritative top-level verb list from the dispatch `case` labels.
# We strip aliases down to canonical verbs and assert every dispatched verb is
# either TESTED or explicitly SKIPped. A new verb added to the dispatch that is
# not handled here FAILS the build — the gate cannot silently rot.
CLI_SRC="$ROOT_DIR/bin/port-daddy-cli.ts"

# Aliases we intentionally fold onto a canonical verb (tested once).
# Map: alias -> canonical
declare -A ALIASES=(
  [c]=claim [r]=release [f]=find [l]=find [ps]=find [list]=find
  [u]=up [d]=down [s]=scan [p]=projects [n]=note [b]=begin [w]=whoami
  [ph]=pheromone [publish]=pub [broadcast]=pub [resurrection]=salvage
  [secrets]=secret [webhooks]=webhook [snapshot]=snapshots [tutorial]=learn
  [diagnose]=doctor [preflight]=advise [compass]=advise [help]=__meta
  [sight]=periscope [scope]=periscope
  [cg]=coast-guard
)

# Build the set of canonical verbs we covered.
declare -A COVERED=()
for v in "${TESTED_VERBS[@]}"; do COVERED["$v"]=1; done

# Extract dispatched verbs: lines like `      case 'verb':` within the main
# switch. Filter to single-token quoted verbs (skip harbor's inner switch which
# uses create/enter/etc — those are subcommands, not top-level verbs).
missing=0
while IFS= read -r verb; do
  # Resolve alias to canonical.
  canon="${ALIASES[$verb]:-$verb}"
  [ "$canon" = "__meta" ] && continue   # 'help' is meta, no daemon path
  if [ -n "${COVERED[$canon]:-}" ]; then
    continue
  fi
  # Not covered as canonical and not a known alias target → gap.
  echo "GAP   top-level verb '$verb' (canonical '$canon') is dispatched in bin/port-daddy-cli.ts but neither TESTED nor SKIPped" >&2
  missing=$((missing + 1))
done < <(
  # Top-level dispatch cases are indented EXACTLY 6 spaces inside the two
  # `switch (command)` blocks. Inner subcommand switches (session at 8 spaces,
  # harbor at 10 spaces) are deeper and must NOT count as top-level verbs.
  grep -nE "^      case '[a-z][a-z0-9-]*':" "$CLI_SRC" \
    | sed -E "s/.*case '([a-z0-9-]+)':.*/\1/" \
    | sort -u
)

if [ "$missing" -gt 0 ]; then
  echo "FAIL: $missing dispatched verb(s) are not covered by this E2E. Add a run_read/run_ok or an explicit skip()." >&2
  FAIL=1
else
  echo "OK: every top-level verb in the dispatch is TESTED or explicitly SKIPped."
fi

echo
echo "=================================================================="
echo "COVERAGE: $TESTED tested · $SKIPPED skipped"
if [ "$SKIPPED" -gt 0 ]; then
  echo "Skipped (with reasons):"
  for s in "${SKIP_LIST[@]}"; do echo "  - $s"; done
fi
if [ "$FAIL" -ne 0 ]; then
  echo
  echo "FAILED commands:" >&2
  for f in "${FAIL_LIST[@]}"; do echo "  - $f" >&2; done
  echo "Compiled-CLI surface E2E FAILED" >&2
  exit 1
fi
echo "Compiled-CLI surface E2E PASSED"
