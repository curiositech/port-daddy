# Vendor Stop-event capability matrix

Verified against primary vendor documentation on 2026-08-23 (Claude Code
hooks reference; Gemini CLI hooks reference; Codex CLI config/hooks docs; agy
IDE hooks docs + field reliability reports). This is the factual basis for
`bin/pd-hook-stop`'s design; where a fact could not be verified it is marked.

## End-of-turn event surface

| | Claude Code | Gemini CLI | Antigravity (agy) | Codex CLI |
|---|---|---|---|---|
| Event | `Stop` (also `SubagentStop`) | `AfterAgent` | `Stop` | `Stop` (also `SubagentStop`) |
| Final text on stdin | `last_assistant_message` | `prompt_response` | NONE (only `transcriptPath`) | `last_assistant_message` (string or null) |
| Loop guard | `stop_hook_active` + hard cap of 8 consecutive blocks | `stop_hook_active`, NO documented cap | NONE (only `executionNum`) | `stop_hook_active`, NO documented cap |
| Block mechanism | exit 2 + stderr, or exit 0 + `{"decision":"block","reason":…}` (reason required) | `{"decision":"deny"}` (alias `"block"`) + reason, or exit 2 | exit 0 + `{"decision":"continue","reason":…}` — decision REQUIRED; any other value allows the stop. NOT USED (observe-only) | exit 0 + `{"decision":"block","reason":…}`, or exit 2 + stderr. Plain non-JSON stdout on exit 0 is INVALID |
| Payload style | snake_case: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `stop_hook_active`, `last_assistant_message` | snake_case: `session_id`, `transcript_path`, `cwd`, `prompt`, `prompt_response`, `stop_hook_active` | camelCase: `conversationId`, `workspacePaths[]`, `transcriptPath`, `terminationReason`, `fullyIdle`, `executionNum` | snake_case: `session_id`, `transcript_path` (nullable), `cwd`, `turn_id`, `stop_hook_active`, `last_assistant_message` |
| Config surface | settings.json `hooks.Stop` | settings.json `hooks.AfterAgent` (timeout in **ms**) | hooks.json in `.agents/` or `~/.gemini/` | `~/.codex/config.toml` `[[hooks.Stop]]`/`[[hooks.Stop.hooks]]` or `.codex/hooks.json` |
| Idle hints | `background_tasks[]` / `session_crons[]` | none | `fullyIdle` | none |

## Gotchas (all verified)

1. **Universal block** = exit 2 + reason on stderr. Claude, Gemini, and Codex
   all accept it. Codex REJECTS exit 2 with an empty stderr — always write
   the reason.
2. **Codex stdout**: never emit raw non-JSON stdout on exit 0 in any path
   that can run under Codex.
3. **Transcript lag**: Claude documents that the transcript at Stop time may
   lag; the stdin final-message field is the only reliable source. Never
   full-parse a transcript inside a tentacle (250 ms breaker,
   `SQUID_HOOK_BREAKER_SLOW_MS`, `lib/squid/debug.ts:33`). For agy, at most a
   guarded `tail` of `transcriptPath` would be admissible — the shipped
   tentacle skips it entirely.
4. **First line of logic**: `stop_hook_active:true` → exit 0. Additionally a
   one-shot marker under `$PD_HOME` keyed by session id (TTL,
   matrix.env-style mkdir locking) caps blocking for the vendors with no
   documented consecutive-block limit.
5. **The block reason IS the next prompt** — write it as the SITREP directive
   itself, mirroring `bin/pd-hook-prompt`'s enforce text. No transcript
   excerpts.
6. **Claude Stop does not fire on user interrupts** — that miss is accepted.
7. **`SubagentStop`** exists on Claude and Codex but is OUT OF SCOPE for the
   current stop tentacle; ADR-0092 L4's adversarial pipeline is the follow-up.
8. **agy reliability**: field reports (IDE 1.107.0) say agy Stop hooks may
   not fire at all; combined with the missing loop guard and different block
   dialect, agy is observe-only.

## Non-Stop event names (for completeness)

The full per-purpose event map (prompt / preTool / stop across all four
vendors, with timeout units) is code, not prose: `lib/squid/hook-shape.ts`
(`CLAUDE_EVENTS`, `GEMINI_EVENTS`, `AGY_EVENTS`, `codexHooksTomlBlock`). When
a vendor changes its surface, change it there once — every injector follows.
