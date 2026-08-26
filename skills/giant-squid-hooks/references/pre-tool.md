# pd-hook-pre-tool — edit-moment gate (PD EDIT)

Source: `bin/pd-hook-pre-tool`. The load-bearing L2 tentacle (ADR-0092): fires
BEFORE a file-mutating tool runs and blocks when the target is locked in the
Ink Cloud (`PD_LOCK_*`) by a different actor, per the `suggestibility` dial
(`advisory|warn|enforce`, env `PD_SUGGESTIBILITY` override, same parent-walk
shape as the sitrep dial, default enforce).

## Event contract per vendor

| Vendor | Event | Matcher | Payload |
|---|---|---|---|
| Claude Code | `PreToolUse` | `Edit\|Write\|MultiEdit\|NotebookEdit` | snake_case `tool_name` / `tool_input.file_path` |
| Gemini CLI | `BeforeTool` | `replace\|write_file\|edit` | Claude-normalized snake_case |
| Codex CLI | `[[hooks.PreToolUse]]` | `apply_patch\|Edit\|Write\|edit\|write\|str_replace_editor` | snake_case hook surface; camelCase `toolName` on the app-server surface |
| Antigravity | `PreToolUse` | wide (`AGY_TOOL_MATCHER` in `lib/squid/hook-shape.ts`) | camelCase `toolName`/`toolInput` |

Shell tools (`Bash`, `exec_command`, `run_shell_command`, …) are deliberately
NOT matched: the gate cannot derive a canonical target from a shell command,
and matching them only schedules visible no-op hook jobs. A six-tool
read-only batch must schedule zero Port Daddy tool hooks.

## Codex apply_patch path harvesting

Codex's primary edit tool carries NO `file_path` — the touched paths live
inside the patch body after `*** Update File:` / `*** Add File:` /
`*** Delete File:` / `*** Move to:` markers. The tentacle harvests every
File: path from the patch and gates ALL of them; a multi-file patch blocks
when any one path is foreign-locked.

## Block contracts (per surface, all first-class)

- **snake_case events (Claude / Gemini / Codex hook surface):** exit 2 +
  reason on stderr. Codex refuses exit 2 with an EMPTY stderr — the reason is
  mandatory.
- **camelCase events (Codex app-server + agy):** exit 0 + ONE stdout JSON
  object satisfying both dialects at once:
  `hookSpecificOutput.permissionDecision:"deny"` + `permissionDecisionReason`
  (Codex) AND `decision:"block"` + `message` (agy's scout-block.js shape).
- **warn:** exit 0, WARNING on stderr (snake_case) or `ask` JSON (camelCase).
- **advisory:** exit 0, byte-silent.

## Test seams

- `tests/unit/squid-harness.test.ts` — G2 exit-2 proof, dial matrix, jq-less
  parsing, apply_patch single/multi-file/relative-path harvesting, camelCase
  deny/ask JSON.
- `scripts/squid-selftest.sh` — the same contracts dependency-free, including
  the agy/codex dual-dialect JSON check.
