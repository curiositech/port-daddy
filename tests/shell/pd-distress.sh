#!/bin/sh
# Shell test for bin/pd-distress (ADR-0132 phase 0).
#
# Plain POSIX sh — no bats, no node. Run directly:
#     sh tests/shell/pd-distress.sh
# or through jest via tests/unit/pd-distress-shell.test.ts, which additionally
# strips node from PATH to prove the EPIRB works when node is broken.
#
# Uses a scratch directory under $PD_DISTRESS_TEST_SCRATCH (default: a fresh
# directory under ${TMPDIR:-/var/tmp}) for PD_HOME and a fake repo.

set -u

HERE=$(cd "$(dirname "$0")" && pwd -P)
BIN="$HERE/../../bin/pd-distress"
SCRATCH="${PD_DISTRESS_TEST_SCRATCH:-${TMPDIR:-/var/tmp}/pd-distress-test.$$}"
mkdir -p "$SCRATCH" || { echo "cannot create scratch $SCRATCH" >&2; exit 2; }
export PD_HOME="$SCRATCH/home"
REPO="$SCRATCH/repo"
mkdir -p "$REPO/.git" "$REPO/sub/dir"

pass=0
fail=0
ok() { pass=$((pass + 1)); }
ko() { fail=$((fail + 1)); printf 'FAIL: %s\n' "$1" >&2; }
assert_eq() { [ "$1" = "$2" ] && ok || ko "$3 (expected '$2', got '$1')"; }
assert_rc() { [ "$1" -eq "$2" ] && ok || ko "$3 (expected exit $2, got $1)"; }
assert_match() { printf '%s' "$1" | grep -q -- "$2" && ok || ko "$3 (no match for '$2' in '$1')"; }

cleanup() { rm -rf "$SCRATCH"; }
trap cleanup EXIT

# ── usage / argument validation ─────────────────────────────────────────────
"$BIN" >/dev/null 2>&1; assert_rc $? 2 'no subcommand → usage exit 2'
"$BIN" bogus >/dev/null 2>&1; assert_rc $? 2 'unknown subcommand exits 2'
"$BIN" raise MAYDAY HALT >/dev/null 2>&1; assert_rc $? 2 'class/code mismatch refused'
"$BIN" raise ROUTINE BOGUS >/dev/null 2>&1; assert_rc $? 2 'unregistered code refused'
"$BIN" raise WHATEVER HALT >/dev/null 2>&1; assert_rc $? 2 'unknown class refused'
"$BIN" raise ROUTINE LISTENING "bad key=1" >/dev/null 2>&1; assert_rc $? 2 'field with whitespace refused'
"$BIN" raise ROUTINE LISTENING notafield >/dev/null 2>&1; assert_rc $? 2 'non k=v token refused'
"$BIN" raise ROUTINE LISTENING -- >/dev/null 2>&1; assert_rc $? 2 'dangling -- refused'
"$BIN" raise -e nocolon ROUTINE LISTENING >/dev/null 2>&1; assert_rc $? 2 'entity without colon refused'
[ -e "$PD_HOME/DISTRESS" ] && ko 'refused raises must not create the file' || ok

# ── halt sentinel, absent ───────────────────────────────────────────────────
"$BIN" halt-active; assert_rc $? 1 'halt-active exits 1 with no sentinel'
out=$("$BIN" show-halt 2>&1); rc=$?; assert_rc $rc 1 'show-halt exits 1 with no sentinel'
assert_match "$out" 'not an all-clear' 'show-halt says absence is not all-clear'

# ── raise outside a repo: machine-wide only ─────────────────────────────────
cd "$SCRATCH" || exit 2
line=$("$BIN" raise -e agent:claude-code:ranking-shadow SECURITE HALT reason=spend-runaway ref=docs/incidents/x.md -- hello world); rc=$?
assert_rc $rc 0 'raise succeeds'
assert_match "$line" '^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}T[0-9]\{2\}:[0-9]\{2\}:[0-9]\{2\}Z agent:claude-code:ranking-shadow SECURITE HALT reason=spend-runaway ref=docs/incidents/x.md -- hello world$' 'wire format is exact'
assert_eq "$(cat "$PD_HOME/DISTRESS")" "$line" 'machine-wide file holds exactly the line'
[ -e "$SCRATCH/.portdaddy/DISTRESS" ] && ko 'no repo-scoped file outside a repo' || ok

# ── PAN PAN as two words and as one, plus the control shorthand class ───────
"$BIN" raise PAN PAN UNREACHABLE peer=daemon:prod >/dev/null; assert_rc $? 0 'PAN PAN as two args'
"$BIN" raise "PAN PAN" HALF-ALIVE >/dev/null; assert_rc $? 0 'PAN PAN as one arg'
"$BIN" raise control SEEN ref=2026-09-05T14:02:11Z >/dev/null; assert_rc $? 0 'control SEEN'
"$BIN" raise ROUTINE LISTENING >/dev/null; assert_rc $? 0 'bare ROUTINE LISTENING'
assert_eq "$(wc -l < "$PD_HOME/DISTRESS" | tr -d ' ')" 5 'five lines appended'
assert_match "$(sed -n 2p "$PD_HOME/DISTRESS")" ' PAN PAN UNREACHABLE peer=daemon:prod$' 'PAN PAN serialized with a space'
assert_match "$(sed -n 4p "$PD_HOME/DISTRESS")" ' control SEEN ref=2026-09-05T14:02:11Z$' 'control class is explicit on the wire'

# ── default entity when none given ──────────────────────────────────────────
assert_match "$(sed -n 5p "$PD_HOME/DISTRESS")" ' shell:[^ ]*@[^ ]* ROUTINE LISTENING$' 'default entity is shell:user@host'
PD_DISTRESS_ENTITY=daemon:prod "$BIN" raise MAYDAY SPLIT-BRAIN pids=812,9944 port=9886 >/dev/null
assert_match "$(tail -n 1 "$PD_HOME/DISTRESS")" ' daemon:prod MAYDAY SPLIT-BRAIN pids=812,9944 port=9886$' 'PD_DISTRESS_ENTITY sets the entity'

# ── read ────────────────────────────────────────────────────────────────────
assert_eq "$("$BIN" read)" "$(cat "$PD_HOME/DISTRESS")" 'read prints the machine-wide file'
assert_eq "$("$BIN" read machine)" "$(cat "$PD_HOME/DISTRESS")" 'read machine prints the machine-wide file'
"$BIN" read repo >/dev/null 2>&1; assert_rc $? 1 'read repo outside a repo exits 1'

# ── inside a repo (nested cwd; .git as a directory): both files ──────────────
cd "$REPO/sub/dir" || exit 2
"$BIN" raise ROUTINE LISTENING >/dev/null; assert_rc $? 0 'raise inside repo'
assert_eq "$(tail -n 1 "$REPO/.portdaddy/DISTRESS")" "$(tail -n 1 "$PD_HOME/DISTRESS")" 'repo-scoped file gets the same line'
assert_eq "$(wc -l < "$REPO/.portdaddy/DISTRESS" | tr -d ' ')" 1 'repo-scoped file has only the in-repo line'
assert_eq "$("$BIN" read repo)" "$(cat "$REPO/.portdaddy/DISTRESS")" 'read repo prints the repo-scoped file'

# ── linked worktree: .git as a FILE also counts as a repo root ───────────────
WT="$SCRATCH/worktree"; mkdir -p "$WT/deep"; printf 'gitdir: /elsewhere\n' > "$WT/.git"
( cd "$WT/deep" && "$BIN" raise ROUTINE LISTENING >/dev/null ); assert_rc $? 0 'raise inside a linked worktree'
[ -f "$WT/.portdaddy/DISTRESS" ] && ok || ko 'worktree .git file is recognised as a repo root'

# ── halt sentinel, present: machine-wide is authoritative over repo-scoped ──
mkdir -p "$REPO/.portdaddy"
printf '%s\n' '2026-09-05T13:00:00Z operator:erich SECURITE HALT reason=repo-only' > "$REPO/.portdaddy/HALT"
"$BIN" halt-active; assert_rc $? 0 'repo-scoped sentinel alone counts as halted'
assert_eq "$("$BIN" show-halt)" '2026-09-05T13:00:00Z operator:erich SECURITE HALT reason=repo-only' 'show-halt prints the repo-scoped sentinel'
printf '%s\n' '2026-09-05T14:02:11Z operator:erich SECURITE HALT reason=spend-runaway' > "$PD_HOME/HALT"
"$BIN" halt-active; assert_rc $? 0 'machine-wide sentinel counts as halted'
assert_eq "$("$BIN" show-halt)" '2026-09-05T14:02:11Z operator:erich SECURITE HALT reason=spend-runaway' 'machine-wide sentinel wins when both exist'
( cd "$SCRATCH" && "$BIN" halt-active ); assert_rc $? 0 'machine-wide sentinel is visible outside any repo'
rm -f "$PD_HOME/HALT" "$REPO/.portdaddy/HALT"

# ── ADR-0132 §4: absence is not all-clear ───────────────────────────────────
# The register still carries the SECURITE HALT raised above (agent:claude-code:…),
# and nothing has lifted it, so deleting both sentinels changes nothing.
"$BIN" halt-active; assert_rc $? 0 'removing both sentinels does not lift a halt the register still carries'
out=$("$BIN" show-halt 2>/dev/null); rc=$?; assert_rc $rc 0 'show-halt exits 0 from the register alone'
assert_eq "$out" "$line" 'show-halt falls back to the standing register HALT'
err=$("$BIN" show-halt 2>&1 >/dev/null); assert_match "$err" 'absence is not all-clear' 'show-halt explains the sentinel is gone but the halt stands'
halt_ts=${line%% *}
"$BIN" raise -e agent:rogue SECURITE ALL-CLEAR "ref=$halt_ts" sig=abc >/dev/null
"$BIN" halt-active; assert_rc $? 0 'an agent ALL-CLEAR does not lift the halt'
"$BIN" raise -e operator:erich SECURITE ALL-CLEAR "ref=$halt_ts" >/dev/null
"$BIN" halt-active; assert_rc $? 0 'an unsigned operator ALL-CLEAR does not lift the halt'
"$BIN" raise -e operator:erich SECURITE ALL-CLEAR ref=2020-01-01T00:00:00Z sig=abc >/dev/null
"$BIN" halt-active; assert_rc $? 0 'an ALL-CLEAR naming a different halt does not lift it'
"$BIN" raise -e operator:erich SECURITE ALL-CLEAR "ref=$halt_ts" sig=abc >/dev/null
"$BIN" halt-active; assert_rc $? 1 'an operator ALL-CLEAR naming this halt with a signature lifts it (the Node twin verifies the signature)'
"$BIN" show-halt >/dev/null 2>&1; assert_rc $? 1 'show-halt exits 1 once the halt is lifted'
"$BIN" raise -e operator:erich SECURITE HALT reason=again >/dev/null
"$BIN" halt-active; assert_rc $? 0 'a HALT raised after the lift stands again'
"$BIN" raise -e operator:erich SECURITE ALL-CLEAR "ref=$(tail -n 1 "$PD_HOME/DISTRESS" | cut -d' ' -f1)" sig=def >/dev/null
"$BIN" halt-active; assert_rc $? 1 'and is lifted by its own ALL-CLEAR'

# ── line bound ──────────────────────────────────────────────────────────────
big=$(awk 'BEGIN { s=""; for (i = 0; i < 4200; i++) s = s "x"; print s }')
"$BIN" raise ROUTINE LISTENING "note=$big" >/dev/null 2>&1; assert_rc $? 2 'over-long line refused'

# ── concurrency: 50 subprocesses × 20 raises each, no torn or lost lines ────
CONC="$SCRATCH/conc"; mkdir -p "$CONC"
( cd "$CONC" && PD_HOME="$CONC/home" sh -c '
  i=0
  while [ $i -lt 50 ]; do
    (
      j=0
      while [ $j -lt 20 ]; do
        PD_DISTRESS_ENTITY="agent:w$i" "$0" raise ROUTINE LISTENING seq=$j pad=abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789 >/dev/null || exit 1
        j=$((j + 1))
      done
    ) &
    i=$((i + 1))
  done
  wait
' "$BIN" )
assert_rc $? 0 'all concurrent writers succeeded'
total=$(wc -l < "$CONC/home/DISTRESS" | tr -d ' ')
assert_eq "$total" 1000 'exactly 50×20 lines landed'
torn=$(grep -c -v '^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}T[0-9]\{2\}:[0-9]\{2\}:[0-9]\{2\}Z agent:w[0-9]\{1,2\} ROUTINE LISTENING seq=[0-9]\{1,2\} pad=abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789$' "$CONC/home/DISTRESS")
assert_eq "$torn" 0 'no line is torn or interleaved'
distinct=$(sed 's/^[^ ]* //' "$CONC/home/DISTRESS" | sort -u | wc -l | tr -d ' ')
assert_eq "$distinct" 1000 'every writer×seq pair is present exactly once'

printf 'pd-distress shell test: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
