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

# 1b. Relative path with cwd still matches the absolute lock key.
RERR="$(printf '{"tool_name":"Edit","tool_input":{"file_path":"src/auth.ts"},"cwd":"/repo"}' \
  | PD_ACTOR="agent_beta" "$BIN/pd-hook-pre-tool" 2>&1 >/dev/null)"
RCODE=$?
if [ "$RCODE" -eq 2 ]; then ok "pre-tool resolves relative file_path against cwd before lock lookup"; else bad "expected relative file_path exit 2, got $RCODE"; fi
case "$RERR" in */repo/src/auth.ts*agent_alpha*) ok "relative file_path block names resolved path + holder";; *) bad "relative file_path block wrong: $RERR";; esac

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
echo "== ADR-0092 suggestibility dial =="
WERR="$(printf '{"tool_name":"Edit","tool_input":{"file_path":"/repo/src/auth.ts"},"cwd":"/repo"}' \
  | PD_ACTOR="agent_beta" PD_SUGGESTIBILITY=" WaRn " "$BIN/pd-hook-pre-tool" 2>&1 >/dev/null)"
WCODE=$?
if [ "$WCODE" -eq 0 ]; then ok "suggestibility=warn exits 0"; else bad "suggestibility=warn expected exit 0, got $WCODE"; fi
case "$WERR" in *WARNING*agent_alpha*) ok "warn mode surfaces the foreign-lock holder";; *) bad "warn mode stderr wrong: $WERR";; esac

AERR="$(printf '{"tool_name":"Edit","tool_input":{"file_path":"/repo/src/auth.ts"},"cwd":"/repo"}' \
  | PD_ACTOR="agent_beta" PD_SUGGESTIBILITY="advisory" "$BIN/pd-hook-pre-tool" 2>&1 >/dev/null)"
ACODE=$?
if [ "$ACODE" -eq 0 ] && [ -z "$AERR" ]; then ok "suggestibility=advisory exits 0 silently"; else bad "advisory expected silent exit 0 (code=$ACODE err=$AERR)"; fi

DIAL_REPO="$SCRATCH/dial-repo"
mkdir -p "$DIAL_REPO/packages/api" "$DIAL_REPO/.portdaddy"
printf '{"suggestibility":{"level":"warn"}}\n' > "$DIAL_REPO/.portdaddy/project.json"
PERR="$(printf '{"tool_name":"Edit","tool_input":{"file_path":"/repo/src/auth.ts"},"cwd":"%s"}' "$DIAL_REPO/packages/api" \
  | PD_ACTOR="agent_beta" "$BIN/pd-hook-pre-tool" 2>&1 >/dev/null)"
PCODE=$?
if [ "$PCODE" -eq 0 ]; then ok "nested cwd inherits parent .portdaddy/project.json suggestibility"; else bad "parent project.json expected exit 0 warn, got $PCODE"; fi
case "$PERR" in *WARNING*agent_alpha*) ok "parent project.json warn names holder";; *) bad "parent project.json warning wrong: $PERR";; esac

BAD_REPO="$SCRATCH/bad-dial-repo"
mkdir -p "$BAD_REPO"
printf '{ "suggestibility": { "level": "warn" ' > "$BAD_REPO/agent.config.json"
BERR="$(printf '{"tool_name":"Edit","tool_input":{"file_path":"/repo/src/auth.ts"},"cwd":"%s"}' "$BAD_REPO" \
  | PD_ACTOR="agent_beta" "$BIN/pd-hook-pre-tool" 2>&1 >/dev/null)"
BCODE=$?
if [ "$BCODE" -eq 2 ]; then ok "malformed suggestibility config cannot lower default enforce"; else bad "malformed config expected exit 2, got $BCODE"; fi
case "$BERR" in *BLOCKED*agent_alpha*) ok "malformed config fallback block names holder";; *) bad "malformed config block wrong: $BERR";; esac

NO_JSON_BIN="$SCRATCH/no-json-parser-bin"
mkdir -p "$NO_JSON_BIN"
for CMD in cat tr sed head dirname grep cut; do
  CMD_PATH="$(command -v "$CMD" 2>/dev/null || true)"
  [ -n "$CMD_PATH" ] && [ ! -e "$NO_JSON_BIN/$CMD" ] && ln -s "$CMD_PATH" "$NO_JSON_BIN/$CMD"
done
BAD_STRING_REPO="$SCRATCH/bad-string-dial-repo"
mkdir -p "$BAD_STRING_REPO"
printf '{ "suggestibility": "warn" ' > "$BAD_STRING_REPO/agent.config.json"
NJERR="$(printf '{"tool_name":"Edit","tool_input":{"file_path":"/repo/src/auth.ts"},"cwd":"%s"}' "$BAD_STRING_REPO" \
  | PATH="$NO_JSON_BIN" PD_ACTOR="agent_beta" "$BIN/pd-hook-pre-tool" 2>&1 >/dev/null)"
NJCODE=$?
if [ "$NJCODE" -eq 2 ]; then ok "no-json-parser malformed string config cannot lower default enforce"; else bad "no-json-parser malformed string expected exit 2, got $NJCODE"; fi
case "$NJERR" in *BLOCKED*agent_alpha*) ok "no-json-parser malformed string block names holder";; *) bad "no-json-parser malformed string block wrong: $NJERR";; esac

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
echo "== CODEX apply_patch REAL shape (path inside the patch body, NOT file_path) =="
# THE LOAD-BEARING GAP (fixed 2026-06-26): codex's apply_patch tool_input is
# { "command": ["apply_patch", "*** Begin Patch\n*** Update File: <p>\n...*** End
# Patch"] } — there is NO file_path field. Verified from the codex v0.139.0 binary
# AND from a LIVE `codex exec --json` run (file_change item changes[].path). The
# tentacle MUST harvest the path from the patch markers or every apply_patch edit
# of a locked file slips through. These cases prove it does.
APBODY='*** Begin Patch\n*** Update File: /repo/src/auth.ts\n@@\n-old\n+new\n*** End Patch'
# (1) snake_case hook event, command array, locked path inside patch → EXIT 2
AERR="$(printf '{"tool_name":"apply_patch","tool_input":{"command":["apply_patch","%s"]},"cwd":"/repo","hook_event_name":"PreToolUse"}' "$APBODY" \
  | PD_ACTOR="codex_agent" "$BIN/pd-hook-pre-tool" 2>&1 >/dev/null)"
ACODE=$?
if [ "$ACODE" -eq 2 ]; then ok "[codex apply_patch] EXIT 2 (path inside command[1] patch body)"; else bad "[codex apply_patch] expected exit 2, got $ACODE"; fi
case "$AERR" in *BLOCKED*/repo/src/auth.ts*agent_alpha*) ok "[codex apply_patch] stderr names the patched path + holder";; *) bad "[codex apply_patch] stderr wrong: $AERR";; esac
# (2) relative path inside patch resolves against cwd → EXIT 2
REL_APBODY='*** Begin Patch\n*** Update File: src/auth.ts\n@@\n-old\n+new\n*** End Patch'
RAPERR="$(printf '{"tool_name":"apply_patch","tool_input":{"command":["apply_patch","%s"]},"cwd":"/repo","hook_event_name":"PreToolUse"}' "$REL_APBODY" \
  | PD_ACTOR="codex_agent" "$BIN/pd-hook-pre-tool" 2>&1 >/dev/null)"
RAPCODE=$?
if [ "$RAPCODE" -eq 2 ]; then ok "[codex apply_patch] relative patch path resolves against cwd"; else bad "[codex apply_patch] relative path expected exit 2, got $RAPCODE"; fi
case "$RAPERR" in *BLOCKED*/repo/src/auth.ts*agent_alpha*) ok "[codex apply_patch] relative path block names resolved path + holder";; *) bad "[codex apply_patch] relative path block wrong: $RAPERR";; esac
# (3) unlocked path inside patch → allow (escaped \n = real codex wire JSON)
printf '{"tool_name":"apply_patch","tool_input":{"command":["apply_patch","*** Begin Patch\\n*** Add File: /repo/src/fresh.ts\\n*** End Patch"]},"cwd":"/repo"}' \
  | PD_ACTOR="codex_agent" "$BIN/pd-hook-pre-tool" >/dev/null 2>&1
ACODE=$?
if [ "$ACODE" -eq 0 ]; then ok "[codex apply_patch] EXIT 0 (unlocked Add File path)"; else bad "[codex apply_patch] expected 0 unlocked, got $ACODE"; fi
# (4) MULTI-file patch, ONE foreign-locked → block the whole call
MERR="$(printf '{"tool_name":"apply_patch","tool_input":{"command":["apply_patch","*** Begin Patch\\n*** Add File: /repo/src/new.ts\\n*** Update File: /repo/src/auth.ts\\n*** End Patch"]},"cwd":"/repo"}' \
  | PD_ACTOR="codex_agent" "$BIN/pd-hook-pre-tool" 2>&1 >/dev/null)"
ACODE=$?
if [ "$ACODE" -eq 2 ]; then ok "[codex apply_patch] multi-file patch blocked when ONE path is locked"; else bad "[codex apply_patch] multi-file expected exit 2, got $ACODE"; fi
case "$MERR" in *auth.ts*) ok "[codex apply_patch] block names the locked file in a multi-file patch";; *) bad "[codex apply_patch] multi-file block wrong target: $MERR";; esac
# (5) camelCase app-server apply_patch with command, locked path → deny JSON
AOUT="$(printf '{"toolName":"apply_patch","toolInput":{"command":["apply_patch","%s"]},"cwd":"/repo","sessionId":"s1"}' "$APBODY" \
  | PD_ACTOR="codex_agent" "$BIN/pd-hook-pre-tool" 2>/dev/null)"
ACODE=$?
if [ "$ACODE" -eq 0 ]; then ok "[codex apply_patch appserver] EXIT 0 (deny via JSON)"; else bad "[codex apply_patch appserver] expected 0, got $ACODE"; fi
case "$AOUT" in *'"permissionDecision":"deny"'*auth.ts*) ok "[codex apply_patch appserver] deny JSON names the patched path";; *) bad "[codex apply_patch appserver] deny JSON wrong: $AOUT";; esac
# (6) owner's own apply_patch on the patched path → allow
printf '{"tool_name":"apply_patch","tool_input":{"command":["apply_patch","%s"]},"cwd":"/repo"}' "$APBODY" \
  | PD_ACTOR="agent_alpha" "$BIN/pd-hook-pre-tool" >/dev/null 2>&1
ACODE=$?
if [ "$ACODE" -eq 0 ]; then ok "[codex apply_patch] owner not self-blocked on patched path"; else bad "[codex apply_patch] owner self-blocked? code=$ACODE"; fi
# (7) post-tool pheromone harvests the patch path (no file_path present).
# NB: codex sends the patch text as a JSON string with the newlines ESCAPED (\n),
# so we emit "\\n" through printf to produce a literal backslash-n in the JSON —
# the real wire shape. (Raw newlines would be invalid JSON and is NOT what codex
# emits.)
PB=$(grep -c '^PD_PHEROMONE_' "$MATRIX" 2>/dev/null || echo 0)
printf '{"tool_name":"apply_patch","tool_input":{"command":["apply_patch","*** Begin Patch\\n*** Update File: /repo/src/patched.ts\\n*** End Patch"]},"tool_response":{"success":true},"cwd":"/repo"}' \
  | PD_ACTOR="codex_agent" "$BIN/pd-hook-post-tool" >/dev/null 2>&1
PA=$(grep -c '^PD_PHEROMONE_' "$MATRIX" 2>/dev/null || echo 0)
if [ "$PA" -gt "$PB" ] && grep -q '^PD_PHEROMONE_REPO_SRC_PATCHED_TS.*mutated via apply_patch.*actor:codex_agent' "$MATRIX"; then
  ok "[codex apply_patch] post-tool pheromone records the patch-body path"
else
  bad "[codex apply_patch] post-tool pheromone for patch path failed ($PB -> $PA)"
fi

echo ""
echo "== ANTIGRAVITY (agy) vendor parity =="
# agy ships a Claude-shaped JSON hook engine; its BLOCK contract (verified from
# agy's own bundled gemini-kit scout-block.js PreToolUse hook) is camelCase stdin
# { toolName, toolInput } and a stdout JSON deny of the shape
# { hookSpecificOutput: { hookEventName:"PreToolUse", decision:"block", message } }.
# pd-hook-pre-tool's camelCase branch emits a SUPERSET carrying both decision:
# "block"+message (agy) AND permissionDecision:"deny"+reason (codex).
AGOUT="$(printf '{"toolName":"write_to_file","toolInput":{"file_path":"/repo/src/auth.ts"},"cwd":"/repo"}' \
  | PD_ACTOR="agy_agent" "$BIN/pd-hook-pre-tool" 2>/dev/null)"
AGCODE=$?
if [ "$AGCODE" -eq 0 ]; then ok "[agy] EXIT 0 (block via stdout JSON, agy contract)"; else bad "[agy] expected exit 0, got $AGCODE"; fi
case "$AGOUT" in *'"decision":"block"'*) ok "[agy] stdout carries decision:block";; *) bad "[agy] missing decision:block: $AGOUT";; esac
case "$AGOUT" in *'"message"'*agent_alpha*) ok "[agy] block message names the lock holder";; *) bad "[agy] message missing holder: $AGOUT";; esac
if command -v jq >/dev/null 2>&1; then
  if printf '%s' "$AGOUT" | jq -e '.hookSpecificOutput.decision == "block" and (.hookSpecificOutput.message | length) > 0 and .hookSpecificOutput.hookEventName == "PreToolUse"' >/dev/null 2>&1; then
    ok "[agy] block JSON well-formed (decision:block + non-empty message, agy's scout-block.js shape)"
  else
    bad "[agy] block JSON malformed: $AGOUT"
  fi
  # The SAME object must still satisfy codex (permissionDecision:deny + reason).
  if printf '%s' "$AGOUT" | jq -e '.hookSpecificOutput.permissionDecision == "deny" and (.hookSpecificOutput.permissionDecisionReason | length) > 0' >/dev/null 2>&1; then
    ok "[agy] same block JSON ALSO satisfies codex (permissionDecision:deny + reason) — one tentacle, both vendors"
  else
    bad "[agy] block JSON lost codex contract: $AGOUT"
  fi
fi
# agy gemini-style tool name (replace) snake_case event still blocks via exit 2.
AGERR="$(printf '{"tool_name":"replace","tool_input":{"file_path":"/repo/src/auth.ts"},"cwd":"/repo"}' \
  | PD_ACTOR="agy_agent" "$BIN/pd-hook-pre-tool" 2>&1 >/dev/null)"
AGCODE=$?
if [ "$AGCODE" -eq 2 ]; then ok "[agy] snake_case event still exit-2 blocks (replace tool)"; else bad "[agy] expected exit 2, got $AGCODE"; fi
# agy unlocked path → allow
printf '{"toolName":"write_to_file","toolInput":{"file_path":"/repo/src/agy-free.ts"},"cwd":"/repo"}' \
  | PD_ACTOR="agy_agent" "$BIN/pd-hook-pre-tool" >/dev/null 2>&1
AGCODE=$?
if [ "$AGCODE" -eq 0 ]; then ok "[agy] EXIT 0 on unlocked path"; else bad "[agy] expected exit 0 unlocked, got $AGCODE"; fi

echo ""
echo "== pd-hook-stop closeout gate (ADR-0092 L4) =="
# End-of-turn SITREP verification. Default dial is enforce; the block contract
# is exit 2 + the SITREP directive on stderr (never empty — codex rejects
# that), loop-guarded by stop_hook_active plus a one-shot per-session marker.
STOP_REPO="$SCRATCH/stop-repo"
mkdir -p "$STOP_REPO"
STOPERR="$(printf '{"session_id":"st-1","cwd":"%s","last_assistant_message":"done, no table"}' "$STOP_REPO" \
  | "$BIN/pd-hook-stop" 2>&1 >/dev/null)"
STOPCODE=$?
if [ "$STOPCODE" -eq 2 ]; then ok "[stop] enforce blocks a SITREP-less turn (exit 2)"; else bad "[stop] expected exit 2, got $STOPCODE"; fi
case "$STOPERR" in *'SITREP'*'| Idea / Suggestion / Remediation |'*) ok "[stop] stderr carries the SITREP directive";; *) bad "[stop] directive missing: $STOPERR";; esac
printf '{"session_id":"st-1","cwd":"%s","last_assistant_message":"still no table"}' "$STOP_REPO" \
  | "$BIN/pd-hook-stop" >/dev/null 2>&1
STOPCODE=$?
if [ "$STOPCODE" -eq 0 ]; then ok "[stop] one-shot marker suppresses a second block for the same session"; else bad "[stop] expected exit 0 on second stop, got $STOPCODE"; fi
printf '{"session_id":"st-2","cwd":"%s","stop_hook_active":true,"last_assistant_message":"no table"}' "$STOP_REPO" \
  | "$BIN/pd-hook-stop" >/dev/null 2>&1
STOPCODE=$?
if [ "$STOPCODE" -eq 0 ]; then ok "[stop] stop_hook_active:true short-circuits (vendor loop guard)"; else bad "[stop] expected exit 0 on stop_hook_active, got $STOPCODE"; fi
printf '{"session_id":"st-3","cwd":"%s","last_assistant_message":"## SITREP\\n| Idea / Suggestion / Remediation | Source | Status |\\n| row | Agent | done |"}' "$STOP_REPO" \
  | "$BIN/pd-hook-stop" >/dev/null 2>&1
STOPCODE=$?
if [ "$STOPCODE" -eq 0 ]; then ok "[stop] SITREP-bearing final message passes"; else bad "[stop] expected exit 0 on compliant turn, got $STOPCODE"; fi
printf '{"conversationId":"agy-st","workspacePaths":["%s"],"terminationReason":"completed","fullyIdle":true,"executionNum":2}' "$STOP_REPO" \
  | "$BIN/pd-hook-stop" >/dev/null 2>&1
STOPCODE=$?
if [ "$STOPCODE" -eq 0 ]; then ok "[stop] agy camelCase Stop payload is observe-only (never blocks)"; else bad "[stop] expected exit 0 on agy payload, got $STOPCODE"; fi
printf '{"session_id":"st-4","cwd":"%s","last_assistant_message":null,"transcript_path":null}' "$STOP_REPO" \
  | "$BIN/pd-hook-stop" >/dev/null 2>&1
STOPCODE=$?
if [ "$STOPCODE" -eq 0 ]; then ok "[stop] null final message is unverifiable → never blocks (codex contract)"; else bad "[stop] expected exit 0 on null message, got $STOPCODE"; fi

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
