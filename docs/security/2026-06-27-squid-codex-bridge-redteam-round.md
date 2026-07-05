# Giant Squid Claude-to-Codex Bridge Redteam Round

- **Date:** 2026-06-27
- **Scope:** `pd squid bridge`, local Anthropic Messages compatibility surface, Codex CLI backend adapter
- **Paired artifact:** `docs/security/2026-06-27-squid-codex-bridge-whitehat-round.md`
- **Coordination note:** Port Daddy daemon was unavailable, so smells are recorded here instead of `pd note` / tuple channels.

## Findings

### `smell:vuln:coord:squid:max-body-spam:0007`

```text
target:     lib/squid/claude-codex-bridge.ts readJson()
hypothesis: valid-token callers can send maximum-size JSON bodies and force unbounded Buffer accumulation before validation.
load:       one authenticated caller; request body grows until process memory or reverse-proxy limits intervene.
fault:      signal-class spam / maximum-size payload.
result:     invariant broken in pre-redteam code; no byte ceiling existed.
impact:     local bridge can be memory-pressured by a same-user or token-bearing caller before Codex is spawned.
```

Counter landed: `readJson()` now enforces `maxRequestBytes` before parsing and returns HTTP 413 with Anthropic-shaped error JSON. CLI exposes `--max-request-bytes` and `PD_SQUID_MAX_REQUEST_BYTES`; invalid values fail config validation.

### `smell:vuln:recovery:squid:metadata-id-inflation:0008`

```text
target:     createBridgeRequestContext() request_id/session_id extraction
adversary:  valid-token caller or same-user process
sequence:   send very large x-request-id / metadata.session_id values; observe prompt header, response provenance, and session-store key growth.
result:     partial in pre-redteam code; request/session IDs were trimmed but not length-bounded.
impact:     bounded message text retention claim was true, but metadata could still inflate prompts/provenance and store large keys.
```

Counter landed: request/session IDs are whitespace-normalized and, above 128 characters, replaced with `sha256:<digest>` before prompt, response, or session-store use.

### `smell:vuln:recovery:squid:session-store-churn:0009`

```text
target:     default in-memory sessionStore
adversary:  valid-token caller or same-user process
sequence:   send many requests with distinct session_id values.
result:     latent in pre-redteam code; each new session_id created a Map entry without an entry ceiling.
impact:     metadata-only retention avoided transcript leakage but not unbounded metadata cardinality.
```

Counter landed: session store entry count is bounded (`maxSessionEntries`, default 1024) with oldest-session eviction.

## No-Break Probes

- Default auth bypass: no break after whitehat counter. Programmatic servers now default to `squid-local` / `PD_SQUID_BRIDGE_TOKEN`, and `authToken: null` is the explicit disable path.
- Off-loopback accidental exposure: no break after whitehat counter. CLI refuses default token or disabled auth on non-loopback hosts.
- Completed Codex command replay as Claude tool request: no break after parser split. `command_execution` stays internal provenance.

## Residual

- Same-UID adversary remains out of scope. A same-user process can usually discover process environment or invoke local clients directly; this bridge should not claim to isolate against that class.
- Request body limit does not prove total resource boundedness for a full bridge turn. Codex execution, output JSONL volume, and downstream transcript persistence need separate limits if this bridge becomes long-running operator infrastructure.

## Additional Rounds Requested 2026-06-27

### Round 2 — Auth, Alias, And Tool-Loop Confusion

#### `smell:vuln:crypto:squid:weak-remote-bind:0010`

```text
target:     cli squid bridge config resolution
adversary:  operator accidentally binds 0.0.0.0 with default local auth
sequence:   pd squid bridge --host 0.0.0.0
result:     closed; config validation refuses default-token and auth-disabled non-loopback binds.
impact:     prevents turning a local compatibility shim into an unauthenticated LAN API.
```

#### `smell:vuln:coord:squid:client-model-mislabel:0011`

```text
target:     model aliasing and provenance
adversary:  client sends Claude model name while backend silently runs a different Codex model
result:     closed; response model preserves the client-facing name while port_daddy.backend_model and port_daddy.alias_used record the real backend route.
impact:     avoids lying to the client while keeping an audit trail for debugging and cost policy.
```

#### `smell:vuln:coord:squid:tool-result-loop-shape:0012`

```text
target:     Claude-style tool loop through Codex
sequence:   backend emits function_call -> client returns tool_result -> bridge builds the next Codex prompt.
result:     closed for the basic loop; tests prove tool_use response and continuation flow.
impact:     tool orchestration remains plausible without pretending Codex command executions are Claude client tool requests.
```

### Round 3 — Streaming And Accounting Boundaries

#### `smell:vuln:recovery:squid:stream-after-exit-only:0013`

```text
target:     streaming mapper over codex exec JSONL
hypothesis: bridge buffers all Codex output until process exit, making Claude clients see a fake stream.
result:     closed; streaming forwards JSONL-derived events before the Codex process exits.
impact:     clients can drive incremental UI/tool-loop state instead of waiting for a full subprocess drain.
```

#### `smell:vuln:coord:squid:malformed-jsonl-crash:0014`

```text
target:     Codex JSONL parser
adversary:  backend emits malformed or mixed provenance lines
result:     closed; malformed lines are ignored, invalid tool arguments are wrapped rather than thrown, and command_execution stays internal.
impact:     one bad backend event cannot crash the bridge or masquerade as a client-facing tool request.
```

#### `smell:vuln:cost:squid:token-count-spawn:0015`

```text
target:     /v1/messages/count_tokens
hypothesis: token-count calls spawn Codex and can spend real model budget.
result:     closed; count_tokens estimates normalized Anthropic input without invoking Codex.
impact:     cheap client probes stay cheap and cannot fan out into backend calls.
```

### Round 4 — Contract Harness Boot Discipline

#### `smell:vuln:coord:fleet:boot-spawn-storm:0016`

```text
target:     daemon-supervised fleet startup
adversary:  crash loop, daemon restart, or launchd KeepAlive cycle
sequence:   Homebrew daemon discovers a repo fleet; every scheduled ship fires immediately; heavy backends and SSE churn wedge /health before operators can recover.
result:     broken in the live 3.22.0 daemon; not covered by open PR #556, #607, or #569.
impact:     a harness that should coordinate agents can instead multiply load on every restart.
```

Counter landed in source: scheduled agents now arm timers on start and only run immediately when `run_on_start: true` is present in `pd-fleet.yml`.

#### `smell:vuln:coord:fleet:schema-drift-run-on-start:0017`

```text
target:     fleet AST/schema/docs
hypothesis: runtime accepts run_on_start but docs/schema omit it, so future agents recreate the boot-storm assumption.
result:     closed in this branch; AST parsing, README, and ADR-0019 now carry run_on_start.
impact:     the coordination contract is visible to both humans and agents.
```

#### `smell:vuln:coord:fleet:local-mitigation-masked-fix:0018`

```text
target:     live daemon triage process
hypothesis: setting PORT_DADDY_NO_FLEET stabilizes the box, then everyone mistakes the source bug as fixed.
result:     mitigated but not closed by live config; closed only when source fix ships and daemon is redeployed.
impact:     keeps operator truth separate from release truth.
```
