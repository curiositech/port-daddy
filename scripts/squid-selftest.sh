#!/bin/sh
# scripts/squid-selftest.sh — Giant Squid Harness hooks-fire proof (ADR-0091)
# =============================================================================
# Dependency-free proof that the pd-hook-* tentacles fire with the documented
# semantics. Requires NO node_modules — it invokes the real shell hook binaries
# with sample Claude Code event JSON on stdin and asserts:
#
#   G2  pd-hook-pre-tool EXIT 2 on a path locked by ANOTHER actor (enforced gate)
#       pd-hook-pre-tool EXIT 0 on the OWNER's own lock (no self-block)
#       pd-hook-pre-tool EXIT 0 on an UNLOCKED path
#       pd-hook-pre-tool EXIT 0 on a non-file tool (Bash)
#   --  pd-hook-post-tool appends a PD_PHEROMONE_* line to the matrix
#   --  pd-hook-prompt emits the seeded ALERT + relevant PHEROMONE
#   G5  K=8 concurrent post-tool appends → 8 intact lines, none torn
#
# Scratch lives under ~/coding/tmp (NEVER /tmp — macOS purges /tmp).
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$REPO/bin"
SCRATCH="$HOME/coding/tmp/squid-selftest/sh-$$"
MATRIX="$SCRATCH/matrix.env"
export PD_HOME="$SCRATCH"
export PD_MATRIX_FILE="$MATRIX"

rm -rf "$SCRATCH"
mkdir -p "$SCRATCH"

PASS=0
FAIL=0
ok()   { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; }

# ── seed the Ink Cloud directly (POSIX-readable KEY="value") ────────────────
# Lock /repo/src/auth.ts to agent_alpha; one steering alert; one pheromone.
mkdir -p "$(dirname "$MATRIX")"
cat > "$MATRIX" <<'EOF'
# Port Daddy Stigmergic Attention Matrix (Ink Cloud, ADR-0091)
PD_LOCK_REPO_SRC_AUTH_TS="agent_alpha"
PD_ALERT_STEER_1="STEERING DM: stop and ack before any edit"
PD_PHEROMONE_REPO_SRC_AUTH_TS_1700000000000="/repo/src/auth.ts | uses deprecated v1_hook | intensity:3 | actor:agent_alpha"
EOF

echo "== Ink Cloud seeded =="
cat "$MATRIX"
echo ""

run_pre() { # $1=file $2=actor → echoes exit code, stderr on fd2 captured by caller
  printf '{"tool_name":"Edit","tool_input":{"file_path":"%s"},"cwd":"/repo"}' "$1" \
    | PD_ACTOR="$2" "$BIN/pd-hook-pre-tool"
}

echo "== G2: enforced lock gate =="

# 1. Another actor edits the locked file → EXIT 2
ERR="$(printf '{"tool_name":"Edit","tool_input":{"file_path":"/repo/src/auth.ts"},"cwd":"/repo"}' \
  | PD_ACTOR="agent_beta" "$BIN/pd-hook-pre-tool" 2>&1 >/dev/null)"
CODE=$?
if [ "$CODE" -eq 2 ]; then ok "pre-tool EXIT 2 (locked by agent_alpha, edited by agent_beta)"; else bad "expected exit 2, got $CODE"; fi
case "$ERR" in *BLOCKED*agent_alpha*) ok "stderr names the lock holder (agent_alpha)";; *) bad "stderr missing BLOCKED/holder: $ERR";; esac

# 2. Owner edits its own locked file → EXIT 0
printf '{"tool_name":"Edit","tool_input":{"file_path":"/repo/src/auth.ts"},"cwd":"/repo"}' \
  | PD_ACTOR="agent_alpha" "$BIN/pd-hook-pre-tool" >/dev/null 2>&1
CODE=$?
if [ "$CODE" -eq 0 ]; then ok "pre-tool EXIT 0 (owner agent_alpha, no self-block)"; else bad "expected exit 0 for owner, got $CODE"; fi

# 3. Unlocked path → EXIT 0
printf '{"tool_name":"Edit","tool_input":{"file_path":"/repo/src/other.ts"},"cwd":"/repo"}' \
  | PD_ACTOR="agent_beta" "$BIN/pd-hook-pre-tool" >/dev/null 2>&1
CODE=$?
if [ "$CODE" -eq 0 ]; then ok "pre-tool EXIT 0 (unlocked path)"; else bad "expected exit 0 unlocked, got $CODE"; fi

# 4. Non-file tool (Bash) → EXIT 0
printf '{"tool_name":"Bash","tool_input":{"command":"ls"},"cwd":"/repo"}' \
  | PD_ACTOR="agent_beta" "$BIN/pd-hook-pre-tool" >/dev/null 2>&1
CODE=$?
if [ "$CODE" -eq 0 ]; then ok "pre-tool EXIT 0 (Bash, nothing to gate)"; else bad "expected exit 0 for Bash, got $CODE"; fi

echo ""
echo "== pheromone append (PostToolUse) =="
BEFORE=$(grep -c '^PD_PHEROMONE_' "$MATRIX" 2>/dev/null || echo 0)
printf '{"tool_name":"Write","tool_input":{"file_path":"/repo/src/new-file.ts"},"tool_response":{"success":true},"cwd":"/repo"}' \
  | PD_ACTOR="agent_beta" "$BIN/pd-hook-post-tool" >/dev/null 2>&1
CODE=$?
AFTER=$(grep -c '^PD_PHEROMONE_' "$MATRIX" 2>/dev/null || echo 0)
if [ "$CODE" -eq 0 ] && [ "$AFTER" -eq $((BEFORE+1)) ]; then
  ok "post-tool appended 1 pheromone ($BEFORE -> $AFTER)"
else
  bad "post-tool append failed (code=$CODE, $BEFORE -> $AFTER)"
fi
if grep -q '^PD_PHEROMONE_REPO_SRC_NEW_FILE_TS.*mutated via Write.*actor:agent_beta' "$MATRIX"; then
  ok "appended pheromone records tool + actor"
else
  bad "appended pheromone malformed:"; grep '^PD_PHEROMONE_REPO_SRC_NEW_FILE' "$MATRIX" || true
fi

echo ""
echo "== prompt envelope (UserPromptSubmit) =="
OUT="$(printf '{"prompt":"refactor auth","cwd":"/repo"}' | "$BIN/pd-hook-prompt" 2>/dev/null)"
case "$OUT" in *"STEERING ALERTS"*"stop and ack"*) ok "prompt hook injects the seeded ALERT";; *) bad "prompt hook missing alert. Got: $OUT";; esac
case "$OUT" in *"deprecated v1_hook"*) ok "prompt hook injects the relevant PHEROMONE";; *) bad "prompt hook missing pheromone. Got: $OUT";; esac

echo ""
echo "== GEMINI vendor parity (BeforeTool event → exit 2 + stderr) =="
# Gemini normalizes to the Claude snake_case event shape (gemini.js EVENT_MAPPING
# + TOOL_NAME_MAPPING). Its BeforeTool block contract is the same exit-2 + stderr
# as Claude. We feed the snake_case event a Gemini hook receives and assert BLOCK.
GERR="$(printf '{"tool_name":"replace","tool_input":{"file_path":"/repo/src/auth.ts"},"cwd":"/repo"}' \
  | PD_ACTOR="gemini_agent" "$BIN/pd-hook-pre-tool" 2>&1 >/dev/null)"
GCODE=$?
if [ "$GCODE" -eq 2 ]; then ok "[gemini] pre-tool EXIT 2 on foreign-locked file (replace tool)"; else bad "[gemini] expected exit 2, got $GCODE"; fi
case "$GERR" in *BLOCKED*agent_alpha*) ok "[gemini] stderr names the lock holder";; *) bad "[gemini] stderr missing holder: $GERR";; esac
# Gemini unlocked path → allow
printf '{"tool_name":"write_file","tool_input":{"file_path":"/repo/src/free.ts"},"cwd":"/repo"}' \
  | PD_ACTOR="gemini_agent" "$BIN/pd-hook-pre-tool" >/dev/null 2>&1
GCODE=$?
if [ "$GCODE" -eq 0 ]; then ok "[gemini] pre-tool EXIT 0 on unlocked path (write_file)"; else bad "[gemini] expected exit 0 unlocked, got $GCODE"; fi
# Gemini post-tool pheromone for a gemini tool name (replace)
GB=$(grep -c '^PD_PHEROMONE_' "$MATRIX" 2>/dev/null || echo 0)
printf '{"tool_name":"replace","tool_input":{"file_path":"/repo/src/gemini-touch.ts"},"cwd":"/repo"}' \
  | PD_ACTOR="gemini_agent" "$BIN/pd-hook-post-tool" >/dev/null 2>&1
GA=$(grep -c '^PD_PHEROMONE_' "$MATRIX" 2>/dev/null || echo 0)
if [ "$GA" -eq $((GB+1)) ] && grep -q 'mutated via replace.*actor:gemini_agent' "$MATRIX"; then
  ok "[gemini] post-tool pheromone for 'replace' tool"
else
  bad "[gemini] post-tool pheromone failed ($GB -> $GA)"
fi

echo ""
echo "== CODEX vendor parity =="
# VERIFIED against the codex rust binary (strings): the Codex HOOK input is
# snake_case { tool_name, tool_input, tool_use_id, cwd, hook_event_name } — the
# SAME shape as Claude — and Codex supports the exit-2 + stderr block ("PreToolUse
# hook exited with code 2 but did not write a blocking reason to stderr").
CERR="$(printf '{"tool_name":"apply_patch","tool_input":{"file_path":"/repo/src/auth.ts"},"tool_use_id":"t1","cwd":"/repo","hook_event_name":"PreToolUse"}' \
  | PD_ACTOR="codex_agent" "$BIN/pd-hook-pre-tool" 2>&1 >/dev/null)"
CCODE=$?
if [ "$CCODE" -eq 2 ]; then ok "[codex] pre-tool EXIT 2 on foreign-locked file (snake_case hook input)"; else bad "[codex] expected exit 2, got $CCODE"; fi
case "$CERR" in *BLOCKED*agent_alpha*) ok "[codex] stderr names the lock holder (non-empty reason)";; *) bad "[codex] stderr missing holder: $CERR";; esac

# Codex APP-SERVER camelCase surface → exit 0 + permissionDecision:deny JSON.
COUT="$(printf '{"toolName":"apply_patch","toolInput":{"file_path":"/repo/src/auth.ts"},"cwd":"/repo","sessionId":"s1"}' \
  | PD_ACTOR="codex_agent" "$BIN/pd-hook-pre-tool" 2>/dev/null)"
CCODE=$?
if [ "$CCODE" -eq 0 ]; then ok "[codex-appserver] EXIT 0 (deny via stdout JSON)"; else bad "[codex-appserver] expected exit 0, got $CCODE"; fi
case "$COUT" in *'"permissionDecision":"deny"'*) ok "[codex-appserver] stdout carries permissionDecision:deny";; *) bad "[codex-appserver] missing deny JSON: $COUT";; esac
case "$COUT" in *'"hookEventName":"PreToolUse"'*) ok "[codex-appserver] deny JSON has hookEventName PreToolUse";; *) bad "[codex-appserver] missing hookEventName: $COUT";; esac
case "$COUT" in *agent_alpha*) ok "[codex-appserver] deny reason names the holder";; *) bad "[codex-appserver] reason missing holder: $COUT";; esac
if command -v jq >/dev/null 2>&1; then
  if printf '%s' "$COUT" | jq -e '.hookSpecificOutput.permissionDecision == "deny" and (.hookSpecificOutput.permissionDecisionReason | length) > 0' >/dev/null 2>&1; then
    ok "[codex-appserver] deny JSON well-formed + non-empty reason (codex requires this)"
  else
    bad "[codex-appserver] deny JSON malformed/empty reason: $COUT"
  fi
fi
# Codex unlocked path → exit 2-contract: exit 0, no stderr (silent allow)
printf '{"tool_name":"apply_patch","tool_input":{"file_path":"/repo/src/codex-free.ts"},"cwd":"/repo"}' \
  | PD_ACTOR="codex_agent" "$BIN/pd-hook-pre-tool" >/dev/null 2>&1
CCODE=$?
if [ "$CCODE" -eq 0 ]; then ok "[codex] pre-tool EXIT 0 on unlocked path"; else bad "[codex] expected exit 0 unlocked, got $CCODE"; fi
# Codex post-tool pheromone for snake_case event
CB=$(grep -c '^PD_PHEROMONE_' "$MATRIX" 2>/dev/null || echo 0)
printf '{"tool_name":"apply_patch","tool_input":{"file_path":"/repo/src/codex-touch.ts"},"tool_response":{"success":true},"cwd":"/repo"}' \
  | PD_ACTOR="codex_agent" "$BIN/pd-hook-post-tool" >/dev/null 2>&1
CA=$(grep -c '^PD_PHEROMONE_' "$MATRIX" 2>/dev/null || echo 0)
if [ "$CA" -eq $((CB+1)) ] && grep -q 'mutated via apply_patch.*actor:codex_agent' "$MATRIX"; then
  ok "[codex] post-tool pheromone for snake_case apply_patch event"
else
  bad "[codex] post-tool pheromone failed ($CB -> $CA)"
fi
# Codex owner's own lock → allow (no self-block)
printf '{"tool_name":"apply_patch","tool_input":{"file_path":"/repo/src/auth.ts"},"cwd":"/repo"}' \
  | PD_ACTOR="agent_alpha" "$BIN/pd-hook-pre-tool" >/dev/null 2>&1
CCODE=$?
if [ "$CCODE" -eq 0 ]; then ok "[codex] owner not self-blocked (exit 0)"; else bad "[codex] owner self-blocked? code=$CCODE"; fi

echo ""
echo "== G5: K=8 concurrent appends (Jamie Madrox) =="
B8=$(grep -c '^PD_PHEROMONE_' "$MATRIX" 2>/dev/null || echo 0)
i=0
while [ "$i" -lt 8 ]; do
  printf '{"tool_name":"Edit","tool_input":{"file_path":"/repo/src/file_%s.ts"},"cwd":"/repo"}' "$i" \
    | PD_ACTOR="agent_$i" "$BIN/pd-hook-post-tool" >/dev/null 2>&1 &
  i=$((i+1))
done
wait
A8=$(grep -c '^PD_PHEROMONE_' "$MATRIX" 2>/dev/null || echo 0)
if [ "$A8" -eq $((B8+8)) ]; then ok "8 concurrent appends survived ($B8 -> $A8)"; else bad "expected +8, got $B8 -> $A8 (torn writes?)"; fi
# torn-line check: every non-comment line is KEY="value"
TORN=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  case "$line" in \#*) continue;; esac
  echo "$line" | grep -qE '^[A-Za-z_][A-Za-z0-9_]*=".*"$' || TORN=$((TORN+1))
done < "$MATRIX"
if [ "$TORN" -eq 0 ]; then ok "no torn lines after K=8 concurrency"; else bad "$TORN torn lines detected"; fi

echo ""
echo "== final matrix =="
cat "$MATRIX"

echo ""
printf '== RESULT: %d passed, %d failed ==\n' "$PASS" "$FAIL"
rm -rf "$SCRATCH"
[ "$FAIL" -eq 0 ]
