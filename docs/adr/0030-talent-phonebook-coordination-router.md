# 0030. Talent Phonebook — Coordination Router

## Status

Proposed — 2026-05-14

## Context

Port Daddy coordinates multi-agent work through sessions, file claims, actor mailboxes, and pub/sub channels. The missing primitive is routing: before an agent sends a DM, files a claim, or hands off work, it has no way to ask "who knows the most about this?" The result is cold DMs to the wrong actor, redundant work, and missed handoffs.

This ADR specifies the **talent phonebook** — a new `POST /whois` route backed by `lib/router.ts`, exposed as `pd whois <query>`, `pd.findExpert(query)`, and the `pd_route_question` MCP tool. The phonebook ranks active agents, sessions, and skills by relevance to a free-text query, applies recency and load signals, and returns a scored list with a one-line rationale and a pre-filled DM command per match. A pre-send affordance hooks into `pd begin` and `pd inbox send` to surface suggestions before the agent commits.

The ranking is powered by the `resolveLLMBackend({actor: 'whois'})` call — the cheap classifier path already described in `lib/llm-backend-resolver.ts`. No new LLM wiring is required.

## Decision Drivers

- Agents currently pick DM targets by guessing from `pd sessions` output. This is O(n) eyeball search.
- The `agents` table already has `identity`, `purpose`, and `skills` columns. `session_files` already has file claims with timestamps. `session_notes` carries free-text reasoning. Episodic memory (`episodic_memory` table via `lib/episodic-memory.ts`) holds promoted handoff summaries. The skill index (`lib/shipwright/skill-index.ts`) holds BM25+embedding over the skill catalog. No new heavy data collection is needed — only a ranking function that composes these sources.
- The pre-send affordance must be opt-out, non-blocking, and TTY-only. Piped invocations must not be interrupted.

## Architecture Decision

Build `lib/router.ts` using the standard `createFoo(db, deps)` factory. The module reads only from the existing schema. It does not write to any table except a new `whois_cache` table for LLM result memoization. The LLM call is optional — if no backend is configured, the module falls back to a pure-signal ranking that omits the rationale field.

---

## 1. Module Shape

**New files:**

- `lib/router.ts` — factory `createRouter(db, deps)` where `deps = { llmTransport?, skillIndex?, episodicMemory? }`. Self-initializes `whois_cache`. Returns `{ findExpert }`.
- `routes/router.ts` — Fastify plugin `routerPlugin`. Mounts `POST /whois`.
- `cli/commands/router.ts` — `handleWhois`, `handleAsk`, `maybeSuggestExpert` (consumed by `handleBegin` and `handleInbox`).
- `tests/unit/router.test.ts` — over `createTestDb()`. No LLM calls — inject a deterministic mock transport.
- `tests/integration/whois.test.ts` — via `tests/helpers/ephemeral-daemon.js`. Tests full HTTP round-trip + pre-send hook.

**Modified files:**

- `lib/db.ts` — add `whois_cache` DDL to `CORE_SCHEMA_SQL`.
- `routes/index.ts` — register `routerPlugin`.
- `cli/commands/index.ts` — re-export from `./router.js`.
- `cli/commands/sugar.ts` — call `maybeSuggestExpert` inside `handleBegin` after `/sugar/begin` succeeds, gated by `IS_TTY && !options.noSuggest && !process.env.PD_NO_SUGGEST`.
- `cli/commands/inbox.ts` — same gating, in the `send` branch.
- `features.manifest.json` — add `whois` feature entry.
- `mcp/server.ts` — add `pd_route_question` tool definition + handler; add `'routing'` category to `TOOL_CATEGORIES`.

---

## 2. Public API

### CLI: `pd whois <query>` and `pd ask <query>` (alias)

```
pd whois "who owns the shipwright skill index?"
pd whois "file claims on lib/router.ts" --json
pd whois "episodic memory bugs" --limit 5 --confidence 0.4
pd whois "auth flow" --no-llm
```

**Flags:** `<query>` positional required; `--json` machine-readable; `--limit N` (default 3); `--confidence FLOAT` refuse-to-route threshold (default 0.35); `--no-llm` skip classifier; `--no-suggest` suppress pre-send affordance (also `PD_NO_SUGGEST=1` env).

**Human output format:**

```
Routing "who owns the shipwright skill index?"

  1. scout (agent-scout-a1b2) — score 0.87
     Active session: "Shipwright skill catalog refactor" (2h ago)
     Files: lib/shipwright/skill-index.ts, lib/semantic-resolver.ts
     Why: owns skill-index.ts claim and ran the last indexer session
     DM: pd inbox send agent-scout-a1b2 "Re: shipwright skill index — ..."

  2. documentarian (actor:documentarian) — score 0.61
     Skills: skill-catalog, indexing, documentation
     Why: actor mission covers skill catalog maintenance
     DM: pd say actor:documentarian "Re: shipwright skill index — ..."

  (1 result below confidence threshold 0.35, omitted)
```

**Exit codes:** `0` at least one match above threshold; `1` no matches above threshold (`ENOEXPERT` on stderr); `2` invocation error.

### SDK: `pd.findExpert(query, opts?)`

```typescript
interface FindExpertOptions {
  limit?: number;           // default 3
  confidence?: number;      // default 0.35
  noLlm?: boolean;          // default false
  signal?: AbortSignal;
}

interface ExpertMatch {
  rank: number;
  type: 'agent' | 'session' | 'actor' | 'skill';
  id: string;
  displayName: string;
  score: number;             // 0–1 normalized
  rationale: string | null;  // null when noLlm=true or backend unset
  dmCommand: string;
  signals: {
    fileClaimScore: number;
    noteScore: number;
    identityScore: number;
    skillScore: number;
    episodicScore: number;
    loadPenalty: number;
    recencyDecay: number;
  };
}

interface FindExpertResponse {
  success: boolean;
  query: string;
  matches: ExpertMatch[];
  omitted: number;
  backendUsed: string | null;
}
```

### Fastify Route: `POST /whois`

Body: `{ query, limit?, confidence?, noLlm? }`. Response: `FindExpertResponse`. `422` on empty query with code `VALIDATION_ERROR`.

### MCP Tool: `pd_route_question`

Category `'routing'` (new, Standard tier — not Essential).

```typescript
{
  name: 'pd_route_question',
  description:
    '[Standard] Ask "who should I talk to about X?" before sending a DM or filing a claim. ' +
    'Returns ranked agents/sessions/actors with scores and pre-filled DM commands. ' +
    'Call this before inbox_send or message_actor when you are unsure who owns a domain.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'number' },
      confidence: { type: 'number' },
      no_llm: { type: 'boolean' },
    },
    required: ['query'],
  },
}
```

---

## 3. Ranking Signals and Data Sources

```
score(c, q) = clamp(
    w_file   * fileClaimScore(c, q)   +
    w_note   * noteScore(c, q)        +
    w_ident  * identityScore(c, q)    +
    w_skill  * skillScore(c, q)       +
    w_epis   * episodicScore(c, q)    -
    w_load   * loadPenalty(c)
  , 0, 1)
```

**Default weights** (env-overridable):

| Signal | Env key | Default |
|---|---|---|
| fileClaimScore | `PD_WHOIS_W_FILE` | 0.35 |
| noteScore | `PD_WHOIS_W_NOTE` | 0.20 |
| identityScore | `PD_WHOIS_W_IDENT` | 0.20 |
| skillScore | `PD_WHOIS_W_SKILL` | 0.15 |
| episodicScore | `PD_WHOIS_W_EPIS` | 0.10 |
| loadPenalty | `PD_WHOIS_W_LOAD` | 0.15 |

Each sub-score is normalized 0–1 before weighting; the `clamp(…, 0, 1)` normalizes the final value.

### fileClaimScore

Source: `session_files` joined to `sessions` and `agents`. For each active (non-released) claim on a file path that is a substring match against `query` (exact path fragment, not NLP):

```
recencyDecay = exp(-λ * hoursAgo)   where λ = ln(2) / HALF_LIFE_HOURS
```

`HALF_LIFE_HOURS = 6` (overridable via `PD_WHOIS_FILE_HALFLIFE`). Sum decayed claim scores per agent, cap at 1. This is the only sub-score that uses substring matching — it runs on structured file paths, not free-text NLP.

### noteScore

Source: `session_notes` for sessions belonging to active agents. BM25 over `session_notes.content` restricted to notes created in the last 48h. Score is the normalized BM25 rank. Corpus capped at 500 most-recent notes for performance. Uses the same in-process TF-IDF logic the briefing module already uses — no new dependency.

### identityScore

Source: `agents.identity`, `agents.purpose`, `sessions.purpose`. TF-IDF character bigrams (same `lib/semantic-resolver.ts` path) between query and concatenated identity/purpose strings. Fast, no network call. Covers "I want the agent working on auth" → matches an agent whose purpose says "implementing OAuth flow."

### skillScore

Source: `lib/shipwright/skill-index.ts`. **Cache key:** `sha256(query).slice(0,16)` stored in `whois_cache` with 10-minute TTL. On hit, skip the embedding call. On miss: `skillIndex.search(query, { k: 10 })`, store, join against `agents.skills` (JSON array column). Top-ranked match = 1.0, linear decay. When `skillIndex` dep absent, score = 0 for all candidates.

### episodicScore

Source: `episodic_memory` table (PR-A's `lib/episodic-memory.ts`). `episodicMemory.list({ query, limit: 5 })`. For each returned episode, if `episode.agentId` matches a live agent, add decayed score with `HALF_LIFE_HOURS = 24`. Episodes older than 72h contribute 0.

### loadPenalty

| Status | Penalty |
|---|---|
| `busy` | 1.0 |
| `draining` | 0.8 |
| `starting` | 0.3 |
| `ready` | 0.0 |

### LLM classifier (rationale + re-rank)

After structural scoring, send the top `min(limit * 2, 6)` candidates with:

```
You are a coordination router for a multi-agent development system.

Query: "<query>"

Candidates (ranked by structural signals):
<for each candidate: id, displayName, purpose, recentFiles, skillTags>

For each candidate: output a JSON object with fields:
  - id: string
  - rationale: string (one sentence, ≤15 words, why they match)
  - adjustment: number (-0.1 to +0.1, re-ranking delta)

Output ONLY a JSON array. No prose.
```

Adjustment added to structural score, list re-sorted. **Validate every `id` in LLM response against candidate list** — any unknown id ignored (hallucination guard). Malformed JSON → keep structural ranking, `rationale: null`. Result cached in `whois_cache` with 5-min TTL. Timeout 8s. On timeout: structural fallback, `backendUsed: null`.

**Refuse-to-route:** all candidates below `confidence` → `matches: []`, `omitted: N`, success: true (not an error). CLI exit 1. MCP returns empty-matches response so agents handle gracefully.

---

## 4. Cheap-Classifier Backend

`resolveLLMBackend({ actor: 'whois' })` — reads `PD_WHOIS_BACKEND` → `PD_FLEET_DEFAULT_BACKEND` → `PORT_DADDY_FLEET_DEFAULT_BACKEND`. Produces transport for cloudflare or ollama. Claude/codex are spawn-shape only and explicitly unsupported — if only a claude backend is configured, log one-time warning and fall back to structural-only ranking.

Max tokens: 300. Timeout: 8s (vs 30s daemon default). On timeout: warning logged, structural ranking returned.

---

## 5. Pre-Send Affordance Integration

Read-only, **stderr** (not stdout), non-blocking. Fires only when:

1. stdout is a TTY (`IS_TTY` check in `cli/utils/output.ts`)
2. `PD_NO_SUGGEST` not set to `1`
3. `--no-suggest` flag absent
4. `POST /whois` returns matches above threshold within 3-second timeout

### In `pd begin`

After `/sugar/begin` success, before printing the banner:

```typescript
await maybeSuggestExpert({
  query: `${purpose} ${files.join(' ')}`,
  context: 'begin',
  filePaths: files,
});
```

Prints to stderr (only when matches exist):

```
  Suggestion: scout (agent-scout-a1b2) edited these files 1h ago
  → pd inbox send agent-scout-a1b2 "Re: <purpose> — ..."
```

### In `pd inbox send`

Top of `send` branch in `handleInbox`, before posting:

```typescript
await maybeSuggestExpert({
  query: message,
  context: 'inbox-send',
  targetAlreadyChosen: targetAgent,
});
```

When `targetAlreadyChosen` exists and a higher-scoring match is found:

```
  Note: documentarian (score 0.81) may be a better contact for this topic
  → pd inbox send actor:documentarian "<same message>"
  Sending to <targetAgent> anyway...
```

Original send proceeds regardless. No prompt/confirm — informational only.

### Opt-out

`PD_NO_SUGGEST=1` global silence. `--no-suggest` per-invocation. Both checked at the top of `maybeSuggestExpert`; function returns immediately without network call.

---

## 6. Schema Migration

Add to `CORE_SCHEMA_SQL` in `lib/db.ts`:

```sql
CREATE TABLE IF NOT EXISTS whois_cache (
  cache_key   TEXT PRIMARY KEY,
  query       TEXT NOT NULL,
  result_json TEXT NOT NULL,
  backend     TEXT,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_whois_cache_expires ON whois_cache(expires_at);
```

No new columns on existing tables. `agents.skills`, `agents.purpose`, `agents.identity_*`, `session_files.claimed_at`, `session_files.released_at` all already exist.

Self-expiring: `findExpert` runs `DELETE FROM whois_cache WHERE expires_at < ?` at the start of each call (synchronous better-sqlite3 per ADR-0006). No periodic sweep needed.

---

## 7. Test Surface

### `tests/unit/router.test.ts`

Uses `createTestDb()`. Deterministic mock transport.

1. Empty DB → empty matches, no error.
2. fileClaimScore ranks active claim > released claim.
3. Recency decay: 1h ago > 12h ago (assert ratio matches exp(-λ * t) within 0.02).
4. loadPenalty reduces score for busy agent.
5. Confidence threshold filters sub-threshold (3 candidates scored 0.8/0.5/0.2; confidence 0.4 → 2 matches, omitted: 1).
6. Refuse-to-route: all below threshold → `matches.length === 0`, `omitted > 0`.
7. LLM malformed response → structural fallback, `rationale: null`.
8. LLM timeout → structural fallback.
9. whois_cache stores result, reused on second call (`transport.complete` called once for 2 identical queries within TTL).
10. Expired cache row purged, LLM called again on second call.
11. `noLlm: true` skips transport (transport.complete count = 0).
12. Actor candidates (from `lib/actor-roster.ts`) appear in results when skills match.

### `tests/integration/whois.test.ts`

Uses `tests/helpers/ephemeral-daemon.js`.

1. `POST /whois` returns 200 with ranked matches when query matches agent identity.
2. `POST /whois` returns 422 on empty query.
3. `POST /whois` returns empty matches + omitted count when all below threshold (`confidence: 0.9`).
4. `pd begin` fires pre-send suggestion when `PD_NO_SUGGEST` absent — assert by inspecting daemon activity log for `whois_lookup` event after `pd begin`.

---

## 8. Manifest and Parity

Add to `features.manifest.json`:

```json
"whois": {
  "description": "Route a query to the most relevant agent, session, or skill",
  "cli": ["whois", "ask"],
  "sdk": ["findExpert"],
  "routes": ["POST /whois"],
  "mcp": ["pd_route_question"],
  "completions": ["whois", "ask"],
  "docs": { "readme": true, "sdk": true }
}
```

| Surface | Entry |
|---|---|
| CLI | `pd whois <query>`, `pd ask <query>` |
| SDK | `pd.findExpert(query, opts?)` |
| Route | `POST /whois` |
| MCP | `pd_route_question` |

MCP tool lands in `'routing'` category (new), added to `TOOL_CATEGORIES`. Standard tier — agents call `pd_discover` then invoke by name.

---

## 9. Build Sequence

**Phase 1 — Schema**

- [ ] 1a. Add `whois_cache` DDL to `CORE_SCHEMA_SQL` in `lib/db.ts`.
- [ ] 1b. Add same DDL to `createTestDb()` in `tests/setup-unit.js`.
- Acceptance: `npx tsc --noEmit` passes; existing suite passes.

**Phase 2 — Core module**

- [ ] 2a. `lib/router.ts` with `createRouter(db, deps)`. Implement all sub-scorers + `whois_cache` read/write/purge. No LLM call yet (`rationale: null`).
- [ ] 2b. Tests 1–6 (structural-only).
- Acceptance: 6 unit tests pass.

**Phase 3 — LLM integration**

- [ ] 3a. Add LLM call to `lib/router.ts`. Implement mock-transport path + malformed-response fallback + hallucination-guard (validate ids against candidate list).
- [ ] 3b. Tests 7–11.
- Acceptance: 11 unit tests pass.

**Phase 4 — Route**

- [ ] 4a. `routes/router.ts` with `routerPlugin`. Mount `POST /whois`.
- [ ] 4b. Wire into `routes/index.ts`.
- [ ] 4c. Wire `deps.router = createRouter(db, { skillIndex, episodicMemory, llmTransport })` in `server-fastify.ts`.
- Acceptance: `curl -X POST http://localhost:9876/whois -d '{"query":"test"}'` returns 200.

**Phase 5 — MCP**

- [ ] 5a. Add `pd_route_question` to `TOOLS` array in `mcp/server.ts`.
- [ ] 5b. Add `'routing'` to `TOOL_CATEGORIES`.
- [ ] 5c. Handler case in tool dispatch.
- Acceptance: MCP client can invoke and get valid response.

**Phase 6 — CLI**

- [ ] 6a. `cli/commands/router.ts` with `handleWhois`, `handleAsk`, `maybeSuggestExpert`.
- [ ] 6b. Export from `cli/commands/index.ts`.
- [ ] 6c. Wire `pd whois` and `pd ask` into `bin/port-daddy-cli.ts`.
- [ ] 6d. Unit test 12.
- Acceptance: `pd whois "test"` produces ranked output; `--json` produces valid JSON.

**Phase 7 — Pre-send affordance**

- [ ] 7a. Import `maybeSuggestExpert` in `cli/commands/sugar.ts`. Call after successful `/sugar/begin`, gated.
- [ ] 7b. Same in `cli/commands/inbox.ts` send branch.
- [ ] 7c. Integration test 4.
- Acceptance: `pd begin "auth flow" --files lib/auth.ts` prints suggestion to stderr when a recent claim exists; `PD_NO_SUGGEST=1` silences it.

**Phase 8 — SDK**

- [ ] 8a. Add `findExpert` to `lib/client.ts` as thin `POST /whois` wrapper.
- Acceptance: `await pd.findExpert("auth")` resolves with `FindExpertResponse`.

**Phase 9 — Manifest and docs**

- [ ] 9a. Add `whois` entry to `features.manifest.json`.
- [ ] 9b. Run manifest parity test; fix drift.
- [ ] 9c. Add `pd whois` / `pd ask` to CLI reference table in README.
- Acceptance: parity tests pass; `pd help whois` shows the command.

---

## 10. Risks and Mitigations

**Risk: LLM hallucinates a non-existent agent ID in `adjustment` array.**
Mitigation: router validates every `id` in LLM response against the candidate list it sent. Unknown ids ignored. Structural ranking preserved for that candidate. Enforced before applying adjustments — no DB lookup needed.

**Risk: Ranking is consistently wrong because weights are poorly tuned.**
Mitigation: every weight is a `PD_WHOIS_W_*` env var. Per-candidate signal scores logged at `debug`. `--verbose` flag prints full signal breakdown. Plan a calibration session against the integration test corpus after 2 weeks of real usage.

**Risk: Lookup is too slow (>500ms) and degrades `pd begin` UX.**
Mitigation: structural scoring runs entirely in synchronous SQLite (ADR-0006). Corpus bounded (500 notes max, top-10 skill results from cached index, live agent list). LLM call on separate 8s timeout, result cached. Pre-send affordance uses 3s timeout and silently drops on timeout — `begin` success path never delayed.

**Risk: Agents ignore the suggestion because it's stderr.**
Mitigation: styled with existing `ui.*` helpers (same visual weight as `salvageHint` already in `pd begin`). Future work: surface in MCP `begin_session` response under a `routingSuggestion` field so agent code can act programmatically.

**Risk: Skill index absent on fresh install.**
Mitigation: `createRouter` accepts `skillIndex` as optional dep. Absent → `skillScore = 0` for all. Route and CLI still return results; skill signal silently omitted. One-time daemon-startup warning when dep is absent.

**Risk: `whois_cache` grows unbounded.**
Mitigation: purge runs at top of every `findExpert` call (synchronous `DELETE WHERE expires_at < now()`). At worst the table accumulates one row per unique query per 5–10 minutes — negligible for a dev tool.

---

## Consequences

### Positive

- Agents gain a structured answer to "who do I ask?" before cold DMs. Reduces duplicate work and missed handoffs.
- Pre-send affordance in `pd begin` surfaces file-ownership conflicts before they become coordination bugs.
- `pd_route_question` MCP tool gives LLM agents a coordination-aware routing primitive that degrades gracefully without a backend.
- All signal sources are already in the database — no new data collection agents needed.

### Negative

- `lib/router.ts` is a new critical dependency for `POST /whois`. A bug in ranking → bad suggestions. Mitigated by `PD_NO_SUGGEST` opt-out and non-blocking affordance design.
- LLM call adds latency tail (up to 8s) to `POST /whois` without a cached result. Cache and structural fallback bound the impact.
- One extra dep in `server-fastify.ts` wiring.

---

## PR Title

`feat(whois): talent phonebook — route questions to the right agent before you send`

## PR Description

- Adds `POST /whois`, `pd whois <query>` / `pd ask <query>`, `pd.findExpert()`, and the `pd_route_question` MCP tool — a coordination router that ranks live agents, sessions, actors, and skills by relevance to a free-text query.
- Ranking composes five structural signals from existing tables (file claims with recency decay, session notes via BM25, identity/purpose text overlap, skill index cosine matches, episodic memory) plus an optional cheap-LLM rationale/re-ranking pass via `resolveLLMBackend({actor: 'whois'})`.
- Pre-send affordance hooks into `pd begin` and `pd inbox send`: when a better contact is identifiable, a one-line suggestion prints to stderr before the action completes. Opt-out via `PD_NO_SUGGEST=1` or `--no-suggest`.
- New `whois_cache` SQLite table memoizes LLM results (5-min TTL) and skill-index queries (10-min TTL); self-purging on every call.
- Full four-surface parity: CLI, SDK, route, MCP. Manifest updated. 12 unit tests + 4 integration tests.
