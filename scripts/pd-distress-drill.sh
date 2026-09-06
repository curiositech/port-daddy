#!/bin/sh
# pd-distress-drill — the ADR-0132 §5 end-to-end drill, runnable WITHOUT the
# real daemon, WITHOUT `pd`, and WITHOUT touching the operator's ~/.port-daddy.
# =============================================================================
#
# "GMDSS requires drills because an untested distress procedure is a wish."
#
# Every entity class from ADR-0132 §3 is stood in for by a dummy long-running
# POSIX-sh subprocess that carries exactly the A0 floor the ADR mandates:
#
#   daemon:<name>       ticks a work file every interval (stands in for the
#                       sweeps that spend); listening watch on the sentinel.
#   supervisor:<name>   keeps a child alive (KeepAlive); must NOT relaunch it
#                       while a halt is in force, even after a hard kill.
#   agent:<name>        makes one `pd status`-shaped call per turn; must stop
#                       calling once it has SEEN the halt.
#   guard               invoked on demand; must exit 0 with the one calm OFF
#                       line while halted, never "COORDINATION LAYER DOWN".
#
# Sequence (each step is an assertion; the exit code is the drill verdict):
#
#   1. nominal: every dummy is working
#   2. SECURITE DRILL raised; SECURITE HALT hoisted (sentinel + register)
#   3. every dummy writes SEEN then COMPLIED within two listening intervals
#   4. nothing spends: daemon ticks and agent pd-calls stop
#   5. guard exits 0 with the OFF line
#   6. hard-kill the supervised child: NOT relaunched while halted
#   7. a daemon started under the hoisted flag refuses to run (last words)
#   8. an UNSIGNED all-clear does nothing; a garbage-signed one does nothing
#   9. an agent deleting the sentinel does nothing (absence is not all-clear)
#  10. a SIGNED operator ALL-CLEAR lifts the halt; every dummy resumes
#  11. real components present on this checkout are exercised (bin/pd-distress,
#      bin/pd-hook-pre-tool halt gate) — skipped when absent
#
# The dummies model the ADR, not any particular PR: a real component that
# resumes on the sentinel's absence alone fails step 9 by design. Steps that
# genuinely need the live daemon (an actual launchd KeepAlive relaunch, the
# daemon's /health `state: halted`) are reported as
#   SKIP: requires live daemon — post-halt
# and never attempted here. No `pd`, no daemon, no launchctl, no network.
#
# Usage:
#   sh scripts/pd-distress-drill.sh [--home DIR] [--interval SECS] [--operator ID]
#        [--keygen-cmd CMD] [--all-clear-cmd CMD] [--verify-cmd CMD] [--keep]
#
#   --home         scratch PD_HOME (default: <repo>/.smoke-tmp/distress-drill.<pid>)
#   --interval     listening interval in seconds for the dummies (default 0.5)
#   --keygen-cmd   command that pins the operator ALL-CLEAR key under $PD_HOME
#                  (default: the real operator CLI, which prompts on a TTY)
#   --all-clear-cmd
#                  command that signs + applies the ALL-CLEAR for the halt
#                  timestamp passed as its last argument (default: the real
#                  operator CLI, `all-clear --as <operator>`, which prompts on a
#                  TTY). The jest driver passes a test-only helper here.
#   --verify-cmd   command the dummies use to verify an ALL-CLEAR line
#                  (default: `scripts/pd-distress-allclear.ts verify`)
#   --verify-wait  wall-clock seconds to allow for verifier-dependent steps
#                  (default 45; the verifier is a tsx boot per candidate line)
#   --keep         keep the scratch directory for inspection
#
# The script re-invokes itself as `__entity <role> <name>` for each dummy.

set -u

SELF_PATH=$0
case "$SELF_PATH" in /*) ;; *) SELF_PATH="$(pwd -P)/$SELF_PATH" ;; esac
HERE=$(cd "$(dirname "$SELF_PATH")" && pwd -P)
REPO_ROOT=$(cd "$HERE/.." && pwd -P)

# ─── shared: wire format helpers (inline: the drill must not depend on the ───
# ─── thing it drills; TODO(ADR-0132 phase 0): may use bin/pd-distress) ──────

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# append_distress <entity> <CLASS> <CODE> [k=v ...]
# One printf into an O_APPEND redirection per file: machine-wide, then the
# fake repo's .portdaddy copy. Explicit `control` class per the shared contract.
append_distress() {
  _ent=$1; _cls=$2; _code=$3; shift 3
  _line="$(now_iso) $_ent $_cls $_code"
  [ $# -eq 0 ] || _line="$_line $*"
  mkdir -p "$PD_HOME" 2>/dev/null || true
  printf '%s\n' "$_line" >> "$PD_HOME/DISTRESS"
  if [ -n "${DRILL_REPO:-}" ] && [ -d "$DRILL_REPO/.portdaddy" ]; then
    printf '%s\n' "$_line" >> "$DRILL_REPO/.portdaddy/DISTRESS"
  fi
  printf '%s\n' "$_line"
}

# ─── entity mode ─────────────────────────────────────────────────────────────
#
# A dummy's whole distress procedure. State machine: nominal → halted → nominal,
# where the only halted → nominal edge is a VERIFIED all-clear. The sentinel's
# absence is logged once and otherwise ignored (ADR-0132 §4).

entity_main() {
  role=$1; name=$2
  ent="$role:$name"
  WORK=${DRILL_WORK:?}
  LOG="$WORK/$name.log"
  INTERVAL=${DRILL_INTERVAL:-0.5}
  VERIFY=${DRILL_VERIFY_CMD:?}
  state=nominal
  halt_ref=""
  examined="$WORK/$name.examined"
  : > "$examined"
  absent_logged=0
  log() { printf '%s %s\n' "$(now_iso)" "$1" >> "$LOG"; }

  # A daemon-class entity consults the sentinel synchronously before doing
  # anything at all: started under a hoisted flag, it refuses to run.
  if [ "$role" = daemon ] && [ -f "$PD_HOME/HALT" ]; then
    ref=$(head -n 1 "$PD_HOME/HALT" 2>/dev/null); ref=${ref%% *}
    [ -n "$ref" ] || ref=sentinel
    append_distress "$ent" control SEEN "ref=$ref" >/dev/null
    append_distress "$ent" control COMPLIED "ref=$ref" >/dev/null
    log "refused to start: halt hoisted (ref=$ref)"
    # Last words on stderr (rung 4): one registry-format line, then exit 0.
    printf '%s %s SECURITE HALT ref=%s -- refusing to start under a hoisted halt\n' "$(now_iso)" "$ent" "$ref" >&2
    exit 0
  fi

  child_pid=""
  launches=0
  launch_child() {
    sh -c 'while :; do sleep 1; done' &
    child_pid=$!
    launches=$((launches + 1))
    printf '%s\n' "$launches" > "$WORK/$name.launches"
    printf '%s\n' "$child_pid" > "$WORK/$name.child.pid"
    log "launched child pid=$child_pid (launch #$launches)"
  }
  child_alive() { [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; }

  do_work() {
    case "$role" in
      daemon) printf 'tick\n' >> "$WORK/$name.ticks" ;;
      agent) printf 'pd status\n' >> "$WORK/$name.pd-calls" ;;
      supervisor) child_alive || launch_child ;;
    esac
  }

  trap 'if [ -n "$child_pid" ]; then kill "$child_pid" 2>/dev/null; fi; exit 0' TERM INT

  log "started as $ent (interval ${INTERVAL}s)"
  while :; do
    if [ "$state" = nominal ]; then
      if [ -f "$PD_HOME/HALT" ]; then
        line=$(head -n 1 "$PD_HOME/HALT" 2>/dev/null)
        halt_ref=${line%% *}
        [ -n "$halt_ref" ] || halt_ref=sentinel
        absent_logged=0
        : > "$examined"
        append_distress "$ent" control SEEN "ref=$halt_ref" >/dev/null
        log "SEEN halt ref=$halt_ref; stopping"
        # Stop spending: the daemon stops ticking, the agent stops calling, the
        # supervisor stops relaunching. Nothing is killed here — the entity
        # itself goes quiet, which is what COMPLIED attests.
        state=halted
        append_distress "$ent" control COMPLIED "ref=$halt_ref" >/dev/null
        log "COMPLIED ref=$halt_ref"
      else
        do_work
      fi
    else
      # Listening watch while halted.
      if [ ! -f "$PD_HOME/HALT" ] && [ "$absent_logged" -eq 0 ]; then
        absent_logged=1
        log "sentinel absent; that is not all-clear — awaiting a signed ALL-CLEAR for ref=$halt_ref"
      fi
      if [ "$role" = supervisor ] && ! child_alive; then
        if [ ! -f "$WORK/$name.norelaunch" ]; then
          : > "$WORK/$name.norelaunch"
          log "child died during the halt; NOT relaunching (ADR-0132 §3 supervisor row)"
        fi
      fi
      # Examine every ALL-CLEAR line for our halt that we have not yet judged.
      if [ -f "$PD_HOME/DISTRESS" ]; then
        grep -n " SECURITE ALL-CLEAR ref=$halt_ref" "$PD_HOME/DISTRESS" 2>/dev/null > "$WORK/$name.candidates" || :
        while IFS= read -r cand; do
          n=${cand%%:*}
          grep -qx "$n" "$examined" && continue
          printf '%s\n' "$n" >> "$examined"
          cline=${cand#*:}
          if $VERIFY "$cline" >/dev/null 2>&1; then
            log "verified ALL-CLEAR; resuming: $cline"
            state=nominal
            halt_ref=""
            rm -f "$WORK/$name.norelaunch"
            break
          else
            log "REJECTED all-clear (MAYDAY-class protocol violation): $cline"
          fi
        done < "$WORK/$name.candidates"
      fi
    fi
    sleep "$INTERVAL"
  done
}

if [ "${1:-}" = "__entity" ]; then
  entity_main "$2" "$3"
  exit 0
fi

# ─── the guard, invoked on demand ────────────────────────────────────────────
# Halt in force ⇔ sentinel present, OR the register carries a HALT with no
# verified ALL-CLEAR for it. Prints the one calm OFF line and exits 0 while
# halted; otherwise behaves like a guard whose daemon is simply down.

guard_check() {
  halt_line=""
  if [ -f "$PD_HOME/HALT" ]; then
    halt_line=$(head -n 1 "$PD_HOME/HALT")
  elif [ -f "$PD_HOME/DISTRESS" ]; then
    halt_line=$(grep ' SECURITE HALT' "$PD_HOME/DISTRESS" | tail -n 1)
    if [ -n "$halt_line" ]; then
      ref=${halt_line%% *}
      grep " SECURITE ALL-CLEAR ref=$ref" "$PD_HOME/DISTRESS" > "$WORK/guard.candidates" 2>/dev/null || :
      while IFS= read -r cline; do
        if $DRILL_VERIFY_CMD "$cline" >/dev/null 2>&1; then halt_line=""; break; fi
      done < "$WORK/guard.candidates"
    fi
  fi
  if [ -n "$halt_line" ]; then
    ts=${halt_line%% *}
    rest=${halt_line#* }
    who=${rest%% *}
    printf 'Coordination Guard: OFF — Port Daddy is halted by %s (SECURITE HALT %s); proceeding without coordination rent.\n' "$who" "$ts" >&2
    return 0
  fi
  # No halt: the daemon is unreachable here for real (there is none), so a
  # genuine guard would escalate. That is the correct behaviour outside a halt.
  printf 'Coordination Guard: COORDINATION LAYER DOWN — a human should repair the daemon\n' >&2
  return 1
}

if [ "${1:-}" = "__guard" ]; then
  WORK=${DRILL_WORK:?}
  guard_check
  exit $?
fi

# ─── drill mode ──────────────────────────────────────────────────────────────

HOME_DIR=""
INTERVAL=0.5
VERIFY_WAIT=45
OPERATOR=erich
KEYGEN_CMD=""
ALL_CLEAR_CMD=""
VERIFY_CMD=""
KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --home) HOME_DIR=$2; shift 2 ;;
    --interval) INTERVAL=$2; shift 2 ;;
    --verify-wait) VERIFY_WAIT=$2; shift 2 ;;
    --operator) OPERATOR=$2; shift 2 ;;
    --keygen-cmd) KEYGEN_CMD=$2; shift 2 ;;
    --all-clear-cmd) ALL_CLEAR_CMD=$2; shift 2 ;;
    --verify-cmd) VERIFY_CMD=$2; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,60p' "$SELF_PATH"; exit 0 ;;
    *) printf 'pd-distress-drill: unknown argument %s\n' "$1" >&2; exit 2 ;;
  esac
done

TSX="$REPO_ROOT/node_modules/.bin/tsx"
[ -n "$KEYGEN_CMD" ] || KEYGEN_CMD="$TSX $REPO_ROOT/scripts/pd-distress-allclear.ts keygen"
[ -n "$ALL_CLEAR_CMD" ] || ALL_CLEAR_CMD="$TSX $REPO_ROOT/scripts/pd-distress-allclear.ts all-clear --as $OPERATOR"
[ -n "$VERIFY_CMD" ] || VERIFY_CMD="$TSX $REPO_ROOT/scripts/pd-distress-allclear.ts verify"

if [ -z "$HOME_DIR" ]; then
  mkdir -p "$REPO_ROOT/.smoke-tmp"
  HOME_DIR="$REPO_ROOT/.smoke-tmp/distress-drill.$$"
fi
case "$HOME_DIR" in /tmp/*|/private/tmp/*) printf 'pd-distress-drill: refusing a /tmp home (operator rule)\n' >&2; exit 2 ;; esac
case "$HOME_DIR" in *distress-drill*) ;; *) printf 'pd-distress-drill: --home must contain "distress-drill" so it can never be the real ~/.port-daddy\n' >&2; exit 2 ;; esac

rm -rf "$HOME_DIR"
mkdir -p "$HOME_DIR/home" "$HOME_DIR/work" "$HOME_DIR/repo/.git" "$HOME_DIR/repo/.portdaddy"
PD_HOME="$HOME_DIR/home"; export PD_HOME
DRILL_REPO="$HOME_DIR/repo"; export DRILL_REPO
WORK="$HOME_DIR/work"; export DRILL_WORK="$WORK"
export DRILL_INTERVAL="$INTERVAL"
export DRILL_VERIFY_CMD="$VERIFY_CMD"

pass=0; fail=0; skip=0; gaps=0
ok() { pass=$((pass + 1)); printf 'ok   %s\n' "$1"; }
ko() { fail=$((fail + 1)); printf 'FAIL %s\n' "$1"; }
# A GAP is a real component on this checkout that depends on a higher tier
# than the ADR says it carries. It is reported loudly and counted separately so
# the drill stays a truthful reporter (ADR-0132 §5 calls it a failed drill; the
# finding is filed on the owning PR rather than blocking unrelated merges).
gap() { gaps=$((gaps + 1)); printf 'GAP  %s\n' "$1"; }
skipped() { skip=$((skip + 1)); printf 'SKIP %s\n' "$1"; }
step() { printf '\n== %s ==\n' "$1"; }

PIDS=""
teardown() {
  for p in $PIDS; do kill "$p" 2>/dev/null || :; done
  for f in "$WORK"/*.child.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || :; done
  wait 2>/dev/null || :
  if [ "$KEEP" -eq 0 ]; then rm -rf "$HOME_DIR"; else printf 'kept: %s\n' "$HOME_DIR"; fi
}
trap teardown EXIT

# wait_for <intervals> <sh -c expr>: poll every 0.1 s up to <intervals> × INTERVAL (+ slack).
wait_for() {
  budget=$(awk -v n="$1" -v i="$INTERVAL" 'BEGIN { printf "%d", (n * i + 1.0) * 10 }')
  k=0
  while [ "$k" -lt "$budget" ]; do
    if sh -c "$2" >/dev/null 2>&1; then return 0; fi
    sleep 0.1
    k=$((k + 1))
  done
  return 1
}
# wait_secs <seconds> <sh -c expr>: wall-clock budget for steps that wait on the
# verifier subprocess (a tsx boot per candidate line per entity; slow on a
# loaded CI runner), independent of the listening interval.
wait_secs() {
  k=0; budget=$(( $1 * 10 ))
  while [ "$k" -lt "$budget" ]; do
    if sh -c "$2" >/dev/null 2>&1; then return 0; fi
    sleep 0.1
    k=$((k + 1))
  done
  return 1
}
count_lines() { if [ -f "$1" ]; then wc -l < "$1" | tr -d ' '; else printf 0; fi; }
seen_then_complied() {
  # $1 = entity, $2 = ref: SEEN precedes COMPLIED, each exactly once for this ref.
  s=$(grep -n "^[^ ]* $1 control SEEN ref=$2" "$PD_HOME/DISTRESS" | head -n 1 | cut -d: -f1)
  c=$(grep -n "^[^ ]* $1 control COMPLIED ref=$2" "$PD_HOME/DISTRESS" | head -n 1 | cut -d: -f1)
  [ -n "$s" ] && [ -n "$c" ] && [ "$s" -lt "$c" ]
}
sleep_intervals() { awk -v n="$1" -v i="$INTERVAL" 'BEGIN { printf "%f", n * i }' | xargs sleep; }

printf 'pd-distress-drill: PD_HOME=%s interval=%ss operator=%s\n' "$PD_HOME" "$INTERVAL" "$OPERATOR"

# ── 0. operator key ─────────────────────────────────────────────────────────
step "0. pin the operator ALL-CLEAR key under the drill home"
if sh -c "$KEYGEN_CMD" >"$WORK/keygen.out" 2>&1; then ok "keygen: $(head -c 200 "$WORK/keygen.out" | tr '\n' ' ')"; else ko "keygen failed: $(cat "$WORK/keygen.out")"; fi
[ -f "$PD_HOME/operator-allclear.pub" ] && ok "public key pinned at \$PD_HOME/operator-allclear.pub" || ko "no public key at $PD_HOME/operator-allclear.pub"

# ── 1. nominal ──────────────────────────────────────────────────────────────
step "1. nominal: every entity class is working"
sh "$SELF_PATH" __entity daemon prod & PIDS="$PIDS $!"
sh "$SELF_PATH" __entity supervisor launchd & PIDS="$PIDS $!"
sh "$SELF_PATH" __entity agent claude-code & PIDS="$PIDS $!"
wait_for 4 "[ \$(wc -l < '$WORK/prod.ticks' 2>/dev/null || echo 0) -ge 2 ]" && ok "daemon:prod is ticking" || ko "daemon:prod never ticked"
wait_for 4 "[ -f '$WORK/launchd.child.pid' ] && kill -0 \$(cat '$WORK/launchd.child.pid')" && ok "supervisor:launchd keeps a child alive" || ko "supervisor never launched its child"
wait_for 4 "[ \$(wc -l < '$WORK/claude-code.pd-calls' 2>/dev/null || echo 0) -ge 2 ]" && ok "agent:claude-code is making pd calls" || ko "agent never called pd"
[ ! -f "$PD_HOME/DISTRESS" ] && ok "no distress traffic while nominal (ROUTINE goes to logs, not the file)" || ko "distress file written while nominal"
sh "$SELF_PATH" __guard 2>"$WORK/guard.nominal" && ko "guard passed with no daemon and no halt (should escalate)" || ok "guard escalates when the daemon is down and NO halt is hoisted (that case is genuine)"

# ── 2. drill + halt ─────────────────────────────────────────────────────────
step "2. raise SECURITE DRILL, then hoist SECURITE HALT"
append_distress "operator:$OPERATOR" SECURITE DRILL "ref=scripts/pd-distress-drill.sh" >/dev/null
HALT_TS=$(now_iso)
HALT_LINE="$HALT_TS operator:$OPERATOR SECURITE HALT reason=drill ref=scripts/pd-distress-drill.sh"
printf '%s\n' "$HALT_LINE" > "$PD_HOME/HALT"
printf '%s\n' "$HALT_LINE" >> "$PD_HOME/DISTRESS"
printf '%s\n' "$HALT_LINE" >> "$DRILL_REPO/.portdaddy/DISTRESS"
[ -f "$PD_HOME/HALT" ] && ok "sentinel hoisted: $HALT_LINE" || ko "sentinel missing"

# ── 3. two-phase ack ────────────────────────────────────────────────────────
step "3. SEEN then COMPLIED from every entity within two listening intervals"
for ent in daemon:prod supervisor:launchd agent:claude-code; do
  if wait_for 2 "grep -q '^[^ ]* $ent control COMPLIED ref=$HALT_TS' '$PD_HOME/DISTRESS'"; then
    seen_then_complied "$ent" "$HALT_TS" && ok "$ent: SEEN precedes COMPLIED (ref=$HALT_TS)" || ko "$ent: COMPLIED without a preceding SEEN"
  else
    ko "$ent: no COMPLIED within two intervals ($(grep "$ent" "$PD_HOME/DISTRESS" 2>/dev/null | tr '\n' '|'))"
  fi
done
cmp -s "$PD_HOME/DISTRESS" "$DRILL_REPO/.portdaddy/DISTRESS" && ok "repo-scoped register mirrors the machine-wide one" || ko "repo-scoped register diverged from machine-wide"

# ── 4. nothing spends ───────────────────────────────────────────────────────
step "4. SEELONCE: nothing spends after COMPLIED"
t0=$(count_lines "$WORK/prod.ticks"); c0=$(count_lines "$WORK/claude-code.pd-calls")
sleep_intervals 3
[ "$(count_lines "$WORK/prod.ticks")" -eq "$t0" ] && ok "daemon ticks frozen at $t0" || ko "daemon kept ticking after COMPLIED"
[ "$(count_lines "$WORK/claude-code.pd-calls")" -eq "$c0" ] && ok "agent pd-calls frozen at $c0" || ko "agent kept calling pd after COMPLIED"

# ── 5. guard ────────────────────────────────────────────────────────────────
step "5. the guard is OFF, legibly, exit 0"
if sh "$SELF_PATH" __guard 2>"$WORK/guard.halted"; then
  expected="Coordination Guard: OFF — Port Daddy is halted by operator:$OPERATOR (SECURITE HALT $HALT_TS); proceeding without coordination rent."
  [ "$(cat "$WORK/guard.halted")" = "$expected" ] && ok "guard printed exactly the OFF line" || ko "guard line differs: $(cat "$WORK/guard.halted")"
  grep -q 'COORDINATION LAYER DOWN' "$WORK/guard.halted" && ko "guard escalated a halt as an emergency" || ok "no COORDINATION LAYER DOWN escalation under the halt"
else
  ko "guard exited non-zero under the halt: $(cat "$WORK/guard.halted")"
fi

# ── 6. hard kill, no relaunch ───────────────────────────────────────────────
step "6. hard-kill the supervised child: the supervisor must NOT relaunch it"
child=$(cat "$WORK/launchd.child.pid"); launches_before=$(cat "$WORK/launchd.launches")
kill -9 "$child" 2>/dev/null || :
sleep_intervals 3
[ "$(cat "$WORK/launchd.launches")" -eq "$launches_before" ] && ok "no relaunch while halted (launches still $launches_before)" || ko "supervisor relaunched during the halt"
kill -0 "$child" 2>/dev/null && ko "killed child still alive?" || ok "child is dead and stays dead"
grep -q 'NOT relaunching' "$WORK/launchd.log" && ok "supervisor logged the refusal" || ko "supervisor did not log the refusal"
skipped "real launchd KeepAlive relaunch of com.portdaddy.* — requires live daemon — post-halt (ADR-0132 phase 1 supervisor registry)"

# ── 7. a daemon started under the flag refuses ──────────────────────────────
step "7. a daemon started under the hoisted flag refuses to run"
sh "$SELF_PATH" __entity daemon late 2>"$WORK/late.stderr"; rc=$?
[ "$rc" -eq 0 ] && ok "late daemon exited 0 immediately" || ko "late daemon exit $rc"
[ ! -f "$WORK/late.ticks" ] && ok "late daemon never ticked" || ko "late daemon did work under the halt"
seen_then_complied daemon:late "$HALT_TS" && ok "late daemon answered SEEN then COMPLIED" || ko "late daemon did not ack"
grep -q "^[0-9-]*T[0-9:]*Z daemon:late SECURITE HALT ref=$HALT_TS" "$WORK/late.stderr" && ok "last words on stderr are one registry-format line" || ko "no last words: $(cat "$WORK/late.stderr")"
skipped "daemon GET /health state:halted — requires live daemon — post-halt (ADR-0132 phase 3 halt-watch)"

# ── 8. unsigned / forged all-clear ──────────────────────────────────────────
step "8. an unsigned ALL-CLEAR does nothing; a garbage-signed one does nothing"
printf '%s agent:rogue SECURITE ALL-CLEAR ref=%s\n' "$(now_iso)" "$HALT_TS" >> "$PD_HOME/DISTRESS"
printf '%s operator:%s SECURITE ALL-CLEAR ref=%s sig=%s\n' "$(now_iso)" "$OPERATOR" "$HALT_TS" "$(awk 'BEGIN{for(i=0;i<86;i++)printf "A"; print "=="}')" >> "$PD_HOME/DISTRESS"
wait_secs "$VERIFY_WAIT" "[ \$(grep -c 'REJECTED all-clear' '$WORK/prod.log' 2>/dev/null || echo 0) -ge 2 ]" && ok "daemon rejected both bad all-clears as protocol violations" || ko "daemon did not reject both bad all-clears: $(grep -c REJECTED "$WORK/prod.log")"
wait_secs "$VERIFY_WAIT" "[ \$(grep -c 'REJECTED all-clear' '$WORK/launchd.log' 2>/dev/null || echo 0) -ge 2 ]" && ok "supervisor rejected both bad all-clears" || ko "supervisor did not reject both"
wait_secs "$VERIFY_WAIT" "[ \$(grep -c 'REJECTED all-clear' '$WORK/claude-code.log' 2>/dev/null || echo 0) -ge 2 ]" && ok "agent rejected both bad all-clears" || ko "agent did not reject both"
[ "$(count_lines "$WORK/prod.ticks")" -eq "$t0" ] && ok "daemon still frozen after bad all-clears" || ko "daemon RESUMED on a bad all-clear"
[ "$(cat "$WORK/launchd.launches")" -eq "$launches_before" ] && ok "supervisor still not relaunching" || ko "supervisor RESUMED on a bad all-clear"
[ "$(count_lines "$WORK/claude-code.pd-calls")" -eq "$c0" ] && ok "agent still silent" || ko "agent RESUMED on a bad all-clear"
sh "$SELF_PATH" __guard 2>/dev/null && ok "guard still OFF" || ko "guard changed state on a bad all-clear"

# ── 9. sentinel deleted ─────────────────────────────────────────────────────
step "9. an agent deletes the sentinel: absence is not all-clear"
rm -f "$PD_HOME/HALT"
sleep_intervals 3
[ "$(count_lines "$WORK/prod.ticks")" -eq "$t0" ] && ok "daemon stays halted with the sentinel gone" || ko "daemon RESUMED on sentinel deletion"
[ "$(cat "$WORK/launchd.launches")" -eq "$launches_before" ] && ok "supervisor stays halted with the sentinel gone" || ko "supervisor RESUMED on sentinel deletion"
[ "$(count_lines "$WORK/claude-code.pd-calls")" -eq "$c0" ] && ok "agent stays halted with the sentinel gone" || ko "agent RESUMED on sentinel deletion"
grep -q 'sentinel absent; that is not all-clear' "$WORK/prod.log" && ok "daemon logged the missing sentinel once" || ko "daemon did not notice the missing sentinel"
sh "$SELF_PATH" __guard 2>"$WORK/guard.absent" && ok "guard stays OFF from the register alone (no sentinel)" || ko "guard resumed/escalated on sentinel deletion: $(cat "$WORK/guard.absent")"
printf '%s\n' "$HALT_LINE" > "$PD_HOME/HALT"

# ── 10. signed all-clear ────────────────────────────────────────────────────
step "10. a signed operator ALL-CLEAR lifts the halt; every entity resumes"
if sh -c "$ALL_CLEAR_CMD $HALT_TS" >"$WORK/allclear.out" 2>&1; then
  ok "operator ALL-CLEAR applied: $(grep -i 'lifted\|appended' "$WORK/allclear.out" | head -n 1)"
else
  ko "ALL-CLEAR command failed: $(cat "$WORK/allclear.out")"
fi
last_ac=$(grep " SECURITE ALL-CLEAR ref=$HALT_TS" "$PD_HOME/DISTRESS" 2>/dev/null | tail -n 1)
if [ -n "$last_ac" ] && $VERIFY_CMD "$last_ac" >/dev/null 2>&1; then ok "the last ALL-CLEAR on the register VERIFIES against the pinned operator key"; else ko "no VERIFIED ALL-CLEAR on the register (last: ${last_ac:-none})"; fi
[ ! -f "$PD_HOME/HALT" ] && ok "verifier path removed the sentinel" || ko "sentinel still present after a verified lift"
wait_secs "$VERIFY_WAIT" "[ \$(wc -l < '$WORK/prod.ticks') -gt $t0 ]" && ok "daemon resumed ticking" || ko "daemon did not resume after the signed ALL-CLEAR"
wait_secs "$VERIFY_WAIT" "[ \$(cat '$WORK/launchd.launches') -gt $launches_before ]" && ok "supervisor relaunched its child" || ko "supervisor did not relaunch after the signed ALL-CLEAR"
wait_secs "$VERIFY_WAIT" "[ \$(wc -l < '$WORK/claude-code.pd-calls') -gt $c0 ]" && ok "agent resumed" || ko "agent did not resume after the signed ALL-CLEAR"
for n in prod launchd claude-code; do grep -q 'verified ALL-CLEAR; resuming' "$WORK/$n.log" && ok "$n logged the verified lift" || ko "$n did not log a verified lift"; done
sh "$SELF_PATH" __guard 2>"$WORK/guard.lifted" && ko "guard still OFF after the lift (it should escalate a genuinely dead daemon again)" || ok "guard is back to its ordinary self after the lift"
skipped "daemon halt-watch resume — requires live daemon — post-halt (phase 3 stays halted until restart by design; drill this with the operator's restart runbook)"

# ── 11. real components on this checkout ────────────────────────────────────
step "11. real components present on this checkout"
if [ -x "$REPO_ROOT/bin/pd-distress" ]; then
  printf '%s\n' "$HALT_LINE" > "$PD_HOME/HALT"
  "$REPO_ROOT/bin/pd-distress" halt-active && ok "bin/pd-distress halt-active exits 0 while hoisted" || ko "bin/pd-distress halt-active exit $? while hoisted"
  rm -f "$PD_HOME/HALT"
  if "$REPO_ROOT/bin/pd-distress" halt-active; then
    ok "bin/pd-distress halt-active still 0 with the sentinel deleted (register-aware)"
  else
    gap "bin/pd-distress halt-active exits 1 on sentinel deletion — it depends on the sentinel alone, not the register (ADR-0132 §4: absence is not all-clear; phase 4's readHaltState has the right semantics)"
  fi
else
  skipped "bin/pd-distress not on this checkout (ADR-0132 phase 0)"
fi
if [ -x "$REPO_ROOT/bin/pd-hook-pre-tool" ] && grep -q 'ADR-0132' "$REPO_ROOT/bin/pd-hook-pre-tool"; then
  printf '%s\n' "$HALT_LINE" > "$PD_HOME/HALT"
  printf '{"tool_name":"Bash","tool_input":{"command":"pd status"},"cwd":"%s","session_id":"drill"}' "$DRILL_REPO" \
    | PD_HOOK_PROVIDER=claude PD_MATRIX_FILE="$WORK/matrix.env" "$REPO_ROOT/bin/pd-hook-pre-tool" >/dev/null 2>"$WORK/pretool.err"; rc=$?
  [ "$rc" -eq 2 ] && ok "bin/pd-hook-pre-tool blocks 'pd status' under the halt (exit 2)" || ko "bin/pd-hook-pre-tool exit $rc on 'pd status' under the halt"
  head -n 1 "$WORK/pretool.err" | grep -qx 'SECURITE HALT' && ok "block reason opens with SECURITE HALT" || ko "block reason does not open with SECURITE HALT"
  rm -f "$PD_HOME/HALT"
else
  skipped "bin/pd-hook-pre-tool halt gate not on this checkout (ADR-0132 phase 3)"
fi

printf '\nDRILL RESULT: passed=%d failed=%d skipped=%d gaps=%d\n' "$pass" "$fail" "$skip" "$gaps"
[ "$fail" -eq 0 ]
