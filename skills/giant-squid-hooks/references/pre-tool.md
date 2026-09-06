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

Claude Code's matcher also admits `Bash` and `mcp__port-daddy__.*` (ADR-0132
phase 3): outside a halt the tentacle exits 0 immediately for a shell or MCP
call with no file target; during a halt it can refuse the shapes below. Gemini
and Codex shell tools (`exec_command`, `run_shell_command`, …) stay deliberately
NOT matched: the gate cannot derive a canonical target from a shell command,
and matching them only schedules visible no-op hook jobs. A six-tool
read-only Codex batch must schedule zero Port Daddy tool hooks; widening those
matchers needs an operator decision.

## ADR-0132 halt block list (sentinel hoisted only)

Checked before the matrix early-exit, with no daemon probe. Each shell
segment (split on `;`, `|`, `&`, newlines, backticks) is stripped of leading
`VAR=value` assignments and launcher wrappers (`sudo`, `env`, `npx`, `node`,
`bun`, `sh -c`, …); the first word's basename decides:

| Shape | Verdict |
|---|---|
| `pd` / `port-daddy` with only `--help`/`-h`/`--version`/`-v` | allow |
| any other `pd` / `port-daddy` invocation (incl. `./bin/pd`, `node dist/bin/pd.js`, `npx port-daddy`) | block |
| `launchctl load\|enable\|kickstart\|bootstrap\|start` naming a `portdaddy`/`port-daddy` label | block |
| `brew services start\|restart\|run` naming `port-daddy` | block |
| tool name `mcp__port-daddy__*` | block |
| everything else (`git`, `npm test`, `launchctl print/disable`, `brew services stop`) | allow, plus the notice |

Block reason (stderr, or the deny-JSON reason) opens `SECURITE HALT`, the
sentinel's own line, then `[PORT DADDY — HALT] BLOCKED <tool>: …`. A block
also drops a `blocked` marker so `pd-hook-stop` withholds COMPLIED for that
cycle. Allowed calls under Claude get the notice as PreToolUse
`additionalContext`; other providers stay byte-silent on stdout.

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
