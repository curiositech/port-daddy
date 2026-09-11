# pd-hook-prompt — turn-start tentacle (PD TURN)

Source: `bin/pd-hook-prompt`. Fires when a user prompt is submitted, before
the model sees it. Two jobs, two budgets:

1. **Bounded coordination context.** Greps the Ink Cloud matrix
   (`$PD_MATRIX_FILE`, default `~/.port-daddy/matrix.env`) for fresh
   `PD_ALERT_*` (global) and exact-project-root `PD_PHEROMONE_*` entries.
   Hard product budget: max 2 entries, 512 bytes, one heading
   (`PD_SQUID_PROMPT_MAX_ENTRIES` / `PD_SQUID_PROMPT_MAX_BYTES` may lower,
   never raise). A healthy quiet repo emits **zero bytes**.
2. **SITREP compulsion.** When the `sitrep.endOfTurn` dial resolves to
   `suggest` or `enforce`, a constant-size block instructing the end-of-turn
   SITREP table is prepended OUTSIDE the coordination byte cap (operator
   doctrine 2026-08-22). `bin/pd-hook-stop` verifies the same contract at
   turn end.
3. **Halt notice (ADR-0132).** When `$PD_HOME/HALT` exists, a constant-size
   block opening `SECURITE HALT` on its own line plus the sentinel's text
   leads the envelope (outside the byte cap); one `control SEEN` line is
   appended to the distress file per session; the context-pressure shim,
   the inbox probe, and the SITREP compulsion are all withheld because they
   are daemon traffic or `pd` invocations.

## Event contract per vendor

| Vendor | Event | Payload notes |
|---|---|---|
| Claude Code | `UserPromptSubmit` | snake_case; `cwd` present |
| Gemini CLI | `BeforeAgent` | Claude-normalized snake_case |
| Codex CLI | `[[hooks.UserPromptSubmit]]` (config.toml) | snake_case hook surface |
| Antigravity | `UserPromptSubmit` (hooks.json) | Claude-shaped engine |

## Output channel

Advisory only — **exit 0 always**. Preferred shape (jq present):

```json
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"..."}}
```

Claude Code frames `additionalContext` as trusted harness context; raw stdout
(the jq-less fallback) still works but reads as untrusted injected content.
Never emit raw stdout where the provider is Codex and the content is not
JSON — in practice the prompt tentacle's fallback predates that rule and is
tolerated because Codex renders UserPromptSubmit stdout as context, but new
output paths should stay structured.

## Cost discipline

The matrix is append-only and fleet-wide; per-line work is the enemy. The
tentacle uses one cheap `grep -F` prefilter for pheromones and a
`SCAN_CAP` (60) on candidate lines — an unpruned 3k-line matrix once made
this hook take 20-30 s. Freshness (`ts:` field, TTL 1800 s) is judged inside
the capped loop only.

## Dial resolution

`PD_SITREP` env override → parent walk over `agent.config.json` →
`.portdaddy/sitrep.json` → `.portdaddy/project.json`; `jq` first, `python3`
fallback; closed enum `off|suggest|enforce`; **default enforce** — a missing
or unreadable dial fails toward the full contract, never toward silence.

## Test seams

- `tests/unit/squid-harness.test.ts` — SITREP dial parent-walk proofs
  (garbage env, malformed config, permission-denied, dangling symlink,
  nested cwd, nearest-wins) and the #8059 byte-cap flood tests.
- `scripts/squid-selftest.sh` — dependency-free alert/pheromone emission.
- The zero-byte healthy no-op is a pinned regression (exact `0` byte stdout).
