# Giant Squid Claude-to-Codex Bridge Whitehat Round

- **Date:** 2026-06-27
- **Closed by:** local whitehat-defense pass
- **Scope:** `pd squid bridge`, Anthropic Messages compatibility surface, Codex CLI backend handoff
- **Target text:** README "Giant Squid Claude-to-Codex bridge"; `lib/squid/*`; `cli/commands/squid.ts`
- **Coordination note:** Port Daddy daemon was unavailable in this worktree, so this round is recorded as a repo artifact rather than PD notes/messages.

## Threat Boundary

The bridge is a local compatibility layer. It is not an official Claude Code auth mode, not a remote API product, and not a same-user-process security boundary. It should still defend against accidental network exposure, stale/resumed transcript leakage, browser-origin drive-by requests that lack the local token header, and confusing Codex internal tool provenance with Claude client tool requests.

## Smells And Counters

| Smell id | Class | Status | Counter |
|---|---|---|---|
| `smell:vuln:crypto:squid:auth-default:0001` | crypto | closed | Programmatic bridge servers now default to `PD_SQUID_BRIDGE_TOKEN` or `squid-local`; only explicit `authToken: null` disables auth. Token checks use `timingSafeEqual`. |
| `smell:vuln:crypto:squid:remote-default-token:0002` | crypto | closed | CLI config refuses non-loopback binds when auth is disabled or the default local token is still in use. |
| `smell:vuln:recovery:squid:thinking-replay:0003` | recovery | closed | Anthropic `thinking` and `redacted_thinking` blocks are represented as omitted transcript parts before Codex prompt formatting. |
| `smell:vuln:coord:squid:tool-provenance-confusion:0004` | coord | closed | Codex `function_call`, `tool_call`, and `mcp_tool_call` become Anthropic `tool_use`; completed Codex `command_execution` remains internal provenance. |
| `smell:vuln:coord:squid:stream-ordering:0005` | coord | closed | SSE frames now carry monotonic `id:` fields per response stream. |
| `smell:vuln:recovery:squid:session-retention:0006` | recovery | closed | Session state stores only `{ turns, lastRequestId, updatedAt }`; prompt/message text is not persisted. |
| `smell:vuln:coord:squid:max-body-spam:0007` | coord | closed | Authenticated request bodies are capped before JSON parsing; CLI exposes `--max-request-bytes` / `PD_SQUID_MAX_REQUEST_BYTES`. |
| `smell:vuln:recovery:squid:metadata-id-inflation:0008` | recovery | closed | Oversized request/session IDs are normalized to `sha256:<digest>` before prompt/provenance/session-store use. |
| `smell:vuln:recovery:squid:session-store-churn:0009` | recovery | closed | In-memory session metadata store has a bounded entry count with oldest-session eviction. |

## Verification

Focused tests:

```bash
npm test -- --runTestsByPath tests/unit/squid-codex-bridge.test.ts tests/unit/squid-codex-response.test.ts
```

Static and syntax checks:

```bash
npx tsc --noEmit --pretty false
node --check scripts/squid-bridge-tool-loop.mjs
git diff --check
```

The focused bridge tests cover default auth, explicit auth disablement, non-loopback config rejection, Anthropic token env replacement/removal, thinking redaction, session metadata-only retention, model aliasing, token counting, streaming text, streaming tool calls, and the two-turn Claude-style tool loop.

The follow-up redteam pass added tests for oversize request rejection, metadata ID hashing, bounded session-store eviction, and invalid `--max-request-bytes` rejection.

## Residual Risk

- A same-user malicious process can still call a localhost bridge if it knows or can read the local token from the launching process environment. This is outside the bridge's current threat boundary and should be handled by OS sandboxing / Port Daddy Coast Guard, not by pretending localhost bearer auth isolates same-UID processes.
- `squid-local` is a convenience token for loopback development only. Operators exposing the bridge off loopback must set a stronger token; the CLI now refuses the unsafe cases.
- Token counting is approximate because it estimates normalized prompt size rather than using the actual backend tokenizer.
- Tool-call parity is partial. The bridge preserves Claude-style tool-loop shape, but it does not make Codex internal command execution into Anthropic tool results.
- Body-size defense limits inbound JSON buffering. It does not bound total downstream Codex output size; that remains governed by Codex CLI timeout/model limits and future transcript storage policy.

## Additional Whitehat Rounds Requested 2026-06-27

### Round 2 — Auth, Alias, And Tool-Loop Confusion

| Smell id | Status | Counter | Validation |
|---|---|---|---|
| `smell:vuln:crypto:squid:weak-remote-bind:0010` | closed | Non-loopback bridge binds require explicit non-default auth. | `non-loopback Squid bridge binds require explicit strong auth` |
| `smell:vuln:coord:squid:client-model-mislabel:0011` | closed | Response preserves client model while `port_daddy.backend_model` and `alias_used` expose the real route. | `model aliases route client model names to the Codex backend while preserving response model` |
| `smell:vuln:coord:squid:tool-result-loop-shape:0012` | closed | Anthropic `tool_result` continuations normalize into the next Codex prompt; backend tool calls return as `tool_use`. | `simulates Claude Code tool loop: tool_use response then tool_result continuation` |

### Round 3 — Streaming And Accounting Boundaries

| Smell id | Status | Counter | Validation |
|---|---|---|---|
| `smell:vuln:recovery:squid:stream-after-exit-only:0013` | closed | Streaming code emits Anthropic SSE frames as Codex JSONL arrives, before process exit. | `streaming response forwards Codex JSONL lines before the Codex process exits` |
| `smell:vuln:coord:squid:malformed-jsonl-crash:0014` | closed | Parser ignores malformed lines, wraps invalid tool arguments, and filters command provenance. | `wraps invalid JSON arguments without throwing`; `ignores command executions and malformed lines in the Claude-facing stream mapper` |
| `smell:vuln:cost:squid:token-count-spawn:0015` | closed | `/v1/messages/count_tokens` estimates normalized input locally and does not spawn Codex. | `POST /v1/messages/count_tokens estimates normalized Anthropic input without spawning Codex` |

### Round 4 — Contract Harness Boot Discipline

| Smell id | Status | Counter | Validation |
|---|---|---|---|
| `smell:vuln:coord:fleet:boot-spawn-storm:0016` | closed in source, mitigated live | Scheduled ships arm on fleet start; `run_on_start: true` is required for immediate work. Live Homebrew daemon was stabilized with `PORT_DADDY_NO_FLEET=1` until a fixed release is promoted. | `scheduled agents arm on start without immediately spawning by default` |
| `smell:vuln:coord:fleet:schema-drift-run-on-start:0017` | closed | Fleet AST parses the documented `run_on_start` field only; README and ADR-0019 document the opt-in. | `parses scheduled agent run_on_start opt-in from fleet yaml` |
| `smell:vuln:coord:fleet:local-mitigation-masked-fix:0018` | monitored | The writeup distinguishes live mitigation from source/release truth; PR body must repeat that distinction. | `pd /health` live readback plus focused fleet tests |

## Combined Validation For Added Rounds

```bash
npm test -- --runTestsByPath tests/unit/squid-codex-bridge.test.ts tests/unit/squid-codex-response.test.ts tests/unit/fleet-engine.test.js tests/unit/fleet-daemon.test.js
npx tsc --noEmit --pretty false
node --check scripts/squid-bridge-tool-loop.mjs
git diff --check
```
