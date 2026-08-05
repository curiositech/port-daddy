# First-Class Agent Sessions — Current State, Gap, and Target

Status: **current-state audit + gap analysis + target proposal.** This revision
replaces the prior draft (commit `89acaaf0a`), which described APIs, data
models, and ADR citations that do not exist in the codebase. Every claim below
is either (a) shipped on `origin/main` today, (b) real, tested code on a named
unmerged branch — labeled as such, never presented as shipped — or (c)
explicitly marked **PROPOSED**. See [Corrections](#corrections-vs-the-prior-draft)
for what changed and why.

**One sentence:** Port Daddy has two independent, real, code-level mechanisms
for continuing an agent's work under a new identity — one shipped
(handoff-episode continuation, via the durable-agent roster) and one proven
end-to-end in Workflow Beacon but not yet merged (direct session-linked
continuation) — and this document's job is to say precisely what each does
today before proposing how they converge into one operator-facing roster.

---

## Part I — Current Truth

### Vocabulary (cite-and-define)

- **Session** — a bounded unit of coordinated agent work, minted by
  `lib/sessions.ts` (`generateSessionId`, `lib/sessions.ts:662`) with an id of
  the shape `session-<slugified-purpose>-<12-hex-chars>`, e.g.
  `session-finish-exact-named-daemon-squid-and-continuation-715ad5a28f08`.
  Routes live in `routes/sessions.ts`.
- **AgentNode** — the daemon-minted durable principal referenced throughout
  `docs/adr/0119-durable-agent-roster.md`. It is an append-only fact stream, not
  a mutable row; a roster profile rides on it as an optional field.
- **Durable named-agent roster** — `lib/durable-agent-roster.ts` +
  `routes/durable-agent-roster.ts`, shipped per
  `docs/adr/0119-durable-agent-roster.md` ("Accepted"). Exposes
  `GET /durable-agents`, `GET /durable-agents/search`, `GET /durable-agents/:id`,
  and loopback-only create/promote/patch/handoff-attach/retire routes.
- **Handoff episode** — a sanitized, secret-scanned transcript capsule recorded
  via `episodicMemory.remember()` in `routes/memory.ts`, with `episodeType:
  'handoff'`. This is the real "immutable capsule" concept; nothing in the
  codebase calls it `episodic_memory.harvested_facts` or gives it a
  `lineage_chain` string field the way the prior draft did.
- **Agent run receipt** — the durable admission record for a spawn or a
  session-continuation, schema `pd.agent-run-receipt.v1`, defined in
  `lib/agent-run-receipts.ts:5` on the integration branch (not yet shipped on
  `origin/main`; see §1). Statuses: `accepted → starting → live →
  {completed, failed, cancelled, over_budget, no_runtime}`, or `unknown` if the
  daemon restarted mid-flight and lost direct evidence.

### 1. Two independent continuation mechanisms exist today — they are not the same code path

This is the single most important fact this document has to get right, because
the prior draft collapsed it into one imaginary flow. As of this writing there
are **two** real, separately-implemented ways to continue an agent's work, and
Beacon talks to both of them through two different UI surfaces (§7).

| | **A. Handoff-episode continuation** | **B. Session-linked continuation** |
|---|---|---|
| Route | `POST /memory/handoffs/:episodeId/continue` (`routes/memory.ts:315`) | `POST /sessions/:id/continue` (`routes/sessions.ts:649`) |
| Where it lives | **Shipped on `origin/main`.** | **Real, tested, not yet shipped to `origin/main`** — lives on the unmerged branch `codex/first-class-agent-sessions-integration-20260804` (`routes/sessions.ts:8`; test file `tests/unit/session-continuation-routes.test.js` exists only on that branch). |
| Predecessor unit | A handoff episode (an `episodic_memory` row), which may or may not have a coordination session attached. | A live `sessions` row directly (`predecessorId` = a session id). |
| Target selection | Any `lib/backend-catalog.ts` entry the caller names as `targetBackend`; mode `native` (same adapter family, reuses the provider's own session id) or `handoff` (sanitized successor brief), or `auto`. | One `backend` from `KNOWN_BACKEND_IDS` (`lib/backend-catalog.ts:731`); always spawns a fresh successor, never a native resume. |
| Receipt store | `createContinuationStore` (`routes/memory.ts`, separate table from agent-run-receipts). | `createAgentRunReceiptStore`, `lib/agent-run-receipts.ts:152` — not yet shipped, integration branch only. |
| Lineage | Capsule-based: successor references `sourceEpisodeId`/`sourceCapsuleId`; native-session witness re-verified via `verifyNativeSessionWitness`. | Session-metadata based: a `linkSuccessor()` function on `lib/sessions.ts` (integration branch only — not present in `lib/sessions.ts` on `origin/main`) merges `continuedAt`/`continuedBySessionId`/`continuedByAgentId`/`continuationReason` onto the predecessor and `predecessorSessionId`/`predecessorStatus`/`predecessorAgentId`/`predecessorWorktreeId` onto the successor, plus one immutable note of type `continuation` on each session. |
| Governing ADR | `docs/adr/0118-harness-adapter-contract.md` + `docs/adr/0119-durable-agent-roster.md` | No ADR yet — see [Part IV](#part-iv--open-questions). |
| Who calls it in Beacon today | Roster's "N:N runtime switchboard" panel (`app/src/Roster.tsx`, Workflow Beacon repo, not this repo). | Sessions view's "Continue" action (`app/src/session-flow.ts`, Workflow Beacon repo). |

Neither mechanism is a superset of the other. (A) is the only one that can do a
true native resume (same provider session id, no new process identity) and the
only one wired to the durable-agent roster. (B) is the only one that admits a
successor with a single idempotent HTTP call and produces one pollable receipt
url — the shape Beacon's simpler "continue this session" button needs. They
were built by different work-streams against different predecessors
(`episodeId` vs. session `id`) and currently do not share a receipt schema, a
route prefix, or a lineage representation.

### 2. What the prior draft got wrong about storage: full transcripts, not hashes

The prior draft claimed "the daemon does not store the full transcript; it
stores a Blake3 hash and a sanitized excerpt." This is false for the systems
that exist. `lib/transcripts.ts` documents itself as recording "the full
conversation in `fleet_transcript_messages` (chronological)" (`lib/transcripts.ts:4`).
The `fleet_transcripts` row carries, per entry (`lib/transcripts.ts:63`):

```
session_id, spawned_agent_id, trigger, backend, model,
requested_backend, effective_backend, requested_model, effective_model,
backend_override_source, status, started_at, ended_at,
cost_usd, tokens_in, tokens_out, messages[], outputs[], error
```

Secrets are redacted best-effort (`redactSecrets`, `lib/transcripts.ts:406`) and
tool-arg strings over 10KB are truncated with a SHA-256 hash kept for
auditability — but the message content itself is retained, not discarded in
favor of a hash. There is no Blake3 anywhere in this contract.

This is also where **requested vs. effective backend** — one of the fields the
operator asked this document to name precisely — actually lives:
`requested_backend`/`effective_backend`/`requested_model`/`effective_model`/`backend_override_source`
on the transcript row, and the matching `requestedBackend`/`effectiveBackend`
pair on `SpawnSpec` (`routes/memory.ts`, `resolveSpawnRuntime`). A caller can ask
for one backend and the daemon can resolve a different effective one (e.g. a
policy override); both are recorded, not silently collapsed.

### 3. Backend catalog

`lib/backend-catalog.ts` is the single source of truth for what a continuation
can target (both routes validate against it). The full id set on
`origin/main` today: `cli:claude-code`, `cli:codex`, `cli:agy`, `cli:gemini`,
`cli:groq`, `cli:grok`, `claude-cli`, `claude`, `gemini`, `cloudflare`,
`openai`, `groq`, `codex`, `deepseek`, `xai`, `ollama`, `lmstudio`, `aider`,
`custom` (`lib/backend-catalog.ts:731`). Each entry declares an `adapter` with
spawn transport, argv template, native-resume support, transcript format, and
auth mode — this is the real substance behind `docs/adr/0118-harness-adapter-contract.md`.
That ADR does **not** define a runtime `HarnessAdapterContract` TypeScript
interface with `onSessionStart`/`reportProgress`/`offerHandoff` callbacks (the
prior draft's Part II, §Two); it defines a static catalog of declarative rows.
There is no callback interface any harness implements today.

### 4. Permission policy — two real, disconnected notions; neither reaches continuation

There is no unified "profile.capabilities" envelope (mcp/sandboxes/tools/
chromium/hotkeys/cache_policy) anywhere in the code. What's real:

- **`permissionPolicy` on a durable-agent profile** —
  `schemas/agent-harbor/v0/durable-agent-profile.schema.json:41`. Fields:
  `filesystem` (`inherit | repo | workspace | read-only`), `network`
  (`inherit | none | restricted | full`), `allowedTools`, `deniedTools`, and a
  literal constant `enforcement: "declaration-only"`. `docs/adr/0119-durable-agent-roster.md`
  is explicit: "Neither surface may claim enforcement or activation until a
  runtime adapter emits daemon-witnessed evidence." This is a declared policy on
  the *roster profile*, not something either continuation route reads or
  enforces today.
- **`permissionMode` on a direct spawn** — `lib/spawner.ts:194`, three literal
  values (`default | acceptEdits | bypassPermissions`), forwarded verbatim as
  `--permission-mode` to the `cli:claude-code` CLI only, ignored by every other
  backend. It is wired into `POST /spawn` (`routes/spawn.ts:250`) but **not**
  into either continuation route — the `SpawnSpec` built inside
  `POST /sessions/:id/continue` never sets `permissionMode`, and neither does
  `POST /memory/handoffs/:episodeId/continue`. When unset, the CLI falls back
  to its own interactive default; there is no daemon-side default of
  `bypassPermissions` in this code path.

There is no "Door" gate visible in either continuation route. The Door is a
real architectural concept — Plane 3 of the six-plane kernel described in
`docs/architecture/PORT-DADDY-COARSENED-ARCHITECTURE.md` — but that document
itself lists it as "Door/Bosun (in flight)"; neither `routes/sessions.ts` nor
`routes/memory.ts` calls into a Door module before admitting a continuation.
Today's gating is direct: backend-catalog membership, idempotency-key
collision, budget bounds, and workspace-identity validation, each checked
inline.

### 5. Worktree / workspace identity

Both continuation routes require an absolute, existing, current-user-owned
directory and resolve it through `captureWorkspaceIdentity`
(`lib/workspace-identity.ts:10`), which returns
`{ canonicalPath, device, inode }` — not just a path string. `POST
/sessions/:id/continue` accepts it as top-level `workdir` or `worktree.root` in
the request body and rejects the request with `400 VALIDATION_ERROR` if it
doesn't resolve. Sessions also carry a `worktree_id` column
(`lib/sessions.ts:279`, auto-detected via `getWorktreeId`), separate from the
continuation request's workspace identity check.

### 6. Status, liveness, and freshness — the honest part

This is real and already principled. `GET /sessions/continuations/:receiptId`
(`routes/sessions.ts:926`) will not report `live` on transcript existence
alone. It requires a direct PID **and** a supervisor heartbeat fresher than
`AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS = 65_000` ms, defined at
`lib/agent-run-receipts.ts:6` (not yet shipped; integration branch only). The
route comment states the rule plainly: "Transcript presence alone never
proves liveness; only a direct PID plus a fresh supervisor heartbeat does."
If a receipt was previously `live` and that evidence goes stale, it demotes
to `unknown` with an explicit error string rather than staying green. If the
daemon restarts mid-flight, every non-terminal receipt is swept to `unknown`
on boot (`lib/agent-run-receipts.ts:196`, same not-yet-shipped branch) with
the error "Daemon restarted before a terminal event; task outcome is
unknown."

Workflow Beacon's client-side classifier (`app/src/session-flow.ts`, Workflow
Beacon repo) mirrors this discipline into six plain states — `accepted`,
`starting`, `live`, `terminal`, `no_runtime`, `unknown` — each with a `tone`
(`pending | running | done | error | muted`) and explicit `retryable`,
`openAgent`, `openTranscript`, `attach` flags derived from the same evidence
fields (`classifySessionOutcome`, `app/src/session-flow.ts:206`). This mapping
already exists as real, tested code; it is the closest thing to the "honest
working/stalled/unknown/complete states" target this document proposes below
(§Target UX) — the target is mostly "keep doing this, in one place, for both
continuation mechanisms," not "invent it."

### 7. Beacon's real, proven UI — two disconnected surfaces

Workflow Beacon (this repo's sibling operator surface; separate repository,
paths below are relative to it, not `port-daddy`) has two continuation UIs
wired to the two different daemon mechanisms from §1:

- **Sessions view → "Continue"** (`app/src/session-flow.ts`,
  `buildContinueLaunchRequest`) posts to Beacon's own proxy route
  `POST /port-daddy/session` (`server.js:2035`), which resolves the
  predecessor and calls the daemon's **session-linked** continuation (B).
  `backendForWorkflow` (`app/src/session-flow.ts:257`) only supports two
  backends today — `cli:codex` and `cli:claude-code` — derived from the
  indexed native transcript's harness. There is no PD-native fleet option
  here.
- **Roster view → "N:N runtime switchboard"** (`app/src/Roster.tsx`) targets
  `GET/POST /durable-agents/:agentNodeId/...` proxy routes (`server.js:2404`
  onward), which call the daemon's **handoff-episode** continuation (A). This
  panel exposes the full backend/adapter matrix (`matrix?.adapters`, grouped by
  family) and per-adapter evidence (`spawn`, `live-interaction`,
  `native-resume`, `handoff` predicates), plus a "Continuity ledger" of past
  receipts.

These are not the same button, do not share a receipt list, and an operator
who continues a session from the Sessions view will not see that receipt in
the Roster's continuity ledger, or vice versa.

**Proven, end-to-end, real** (captured 2026-08-04 against a named development
daemon `squid-3-28-e2e`, Port Daddy commit `87961d028`, published port
discovered dynamically — never hardcoded): a Sessions-view "Continue" produced
receipt `run-38979beba5080ab9`, predecessor
`session-finish-exact-named-daemon-squid-and-continuation-715ad5a28f08`,
successor `session-reply-exactly-beacon-ui-joinability-current-ok-d-39f5cd44f0cf`
/ agent `spawned-e16ec2bf12e2`, transcript `tx_msfgox2s_bbgxygg6`, backend
`cli:codex`, terminal status `completed`, accounting `$0.01`, 32,609 input +
6,912 cached input + 12 output tokens with evidence `backend-reported-and-durable`.
The terminal receipt's `controlCenterUrl` opened
`http://127.0.0.1:3167/fleet-ui/?surface=agents&agent=spawned-e16ec2bf12e2` and
selected that exact successor in Port Daddy's global Agents surface —
`buildPortDaddyAgentUrl` in Beacon (`app/src/session-flow.ts:264`) builds the
same shape the daemon's own envelope returns as `controlCenterUrl`
(`routes/sessions.ts`, `continuationEnvelope`), so the two sides agree on the
join target independently.

A prior version of this same flow produced a false positive worth recording:
a "Continue this thread" click created a durable session shell with no
`agentId` and no runtime — a receipt that looked successful but had nothing to
join. The current contract closes that: admission must return one successor
agent, session, transcript, *and* receipt together, or the caller sees
`starting`/`unknown`, never a false `live`.

### 8. Exact continuation response envelope (mechanism B)

`continuationEnvelope()` (`routes/sessions.ts`) is what both
`POST /sessions/:id/continue` and `GET /sessions/continuations/:receiptId`
return:

```
{
  success, accepted, replayed, terminal, outcomeUnknown, status,
  predecessor: { sessionId, purpose, status },
  successor: { agentId, sessionId, transcriptId } | null,
  session: { id, agentId } | null,
  receipt: AgentRunReceipt,
  monitorUrl:        "/sessions/continuations/:receiptId",
  cancelUrl:         "/sessions/continuations/:receiptId" | null,
  transcriptUrl:     "/transcripts?agentId=:successorAgentId" | null,
  controlCenterUrl:  "/fleet-ui/?surface=agents&agent=:successorAgentId" | null,
  accounting: { budgetUsd, telemetry, evidence },
  liveness: { live, evidence, pid, supervisorHeartbeatAt, lastActivityAt, deadlineAt } | null,
}
```

`controlCenterUrl` is the exact Join/Follow/Open target: the daemon's own
fleet UI, filtered to the successor agent. `transcriptUrl` is the daemon's raw
transcript endpoint, not Beacon's own transcript index — Beacon's "Open
transcript in Beacon" button is a *separate* affordance that stays disabled
until Beacon's own polled index catches up (§7's proof doc records this
explicitly). Beacon does not own real-time transcript truth; it owns a lagging
projection of it.

---

## Part II — The Gap

What Beacon does **not** yet own, stated plainly:

1. **No unified roster.** Claude/Codex-native sessions (mechanism B, Sessions
   view) and durable-agent profiles (mechanism A, Roster view) are two
   different lists in two different panels. There is no single view listing
   "every agent, whatever harness or mechanism spawned it."
2. **No PD-native fleet agents in the session-continuation path.**
   `backendForWorkflow` hardcodes two backends. The other 17 backend-catalog
   entries — including PD-native fleet spawns — are reachable only through the
   Roster's handoff-episode path, not the simpler Sessions "Continue" button.
3. **Permission policy is invisible in both UIs.** Neither Beacon surface
   displays or edits `permissionPolicy` (roster profiles) or `permissionMode`
   (direct spawns); neither continuation route accepts a permission-mode
   parameter at all today.
4. **No MCP/connector/sandbox/cache/Chromium policy surface anywhere.** None
   of these appear in the durable-agent-profile schema, the continuation
   routes, or either Beacon panel. This is pure target/proposal, not a small
   gap in an existing field.
5. **No cross-mechanism lineage.** A chain that starts as a handoff-episode
   continuation and later continues again via the session-linked route (or
   vice versa) has no shared lineage record; each mechanism only knows its own
   half.
6. **No cumulative cost/spend across a lineage chain.** Accounting is per
   receipt (`accounting.budgetUsd`/`telemetry` on one continuation). Nothing
   sums spend across a chain of successors back to a common ancestor.
7. **No autonomous or scheduled resumption.** Every continuation observed is
   operator-click-initiated. Nothing schedules or triggers a continuation on a
   cadence or event.
8. **`POST /sessions/:id/continue` is not on `origin/main`.** It is real,
   tested code on `codex/first-class-agent-sessions-integration-20260804`, not
   a shipped surface. Any doc, roadmap item, or operator promise that assumes
   it exists in production is wrong until that branch merges.

---

## Part III — Target UX (PROPOSED — none of this is built)

The target collapses the two real mechanisms behind one operator-facing
contract, without inventing new daemon primitives where existing ones already
do the job (agent-run receipts, the durable-agent roster, `lib/transcripts.ts`
accounting).

- **One roster.** Every agent reachable from Beacon — native Claude/Codex
  sessions, durable-agent-roster profiles, and PD-native fleet spawns — listed
  in one place, sourced by merging `GET /durable-agents` with the live/session
  registries Beacon already polls. This is a Beacon-side aggregation
  **PROPOSED**; no new daemon endpoint is required to enumerate what already
  exists across `routes/durable-agent-roster.ts` and `routes/sessions.ts`.
- **Exact Continue destination.** Every Continue action, regardless of which
  backend mechanism it resolves to, must land the operator on the same shape
  of answer: successor agent id, successor session id, transcript id, receipt
  id, and one `controlCenterUrl` — the pattern mechanism B already returns
  today (§8). Extending mechanism A's response to carry the same fields is the
  smallest true unification step, not a rewrite.
- **Immutable predecessor, linked successor, visible both ways.** Already true
  for mechanism B via `linkSuccessor()` (§1); mechanism A's capsule-based
  lineage should surface the same predecessor→successor pointer in the
  roster's continuity ledger, not just in the episode metadata.
- **Join / Follow / Inspect, not just Continue.** Join = open
  `controlCenterUrl` while live. Follow = subscribe to receipt polling
  (`GET /sessions/continuations/:receiptId` or its mechanism-A equivalent)
  without navigating away. Inspect = open the full transcript
  (`transcriptUrl`), honestly labeled with whichever store actually has it —
  Beacon's own index if caught up, the daemon's raw endpoint if not.
- **Full accounting, transcription, resumption in one card.** Per-continuation
  numbers already exist (`accounting`, `fleet_transcripts.cost_usd/tokens_in/
  tokens_out`); the proposal is a *lineage rollup* — sum spend and token counts
  across a chain via the existing `predecessorSessionId`/successor pointers,
  not a new accounting primitive.
- **Permissions/MCP/connectors/sandbox/cache/Chromium policy, shown honestly.**
  Render `permissionPolicy` and `permissionMode` where they exist today
  (roster profile, direct spawn) labeled `declaration-only` / not yet enforced,
  exactly as the schema already says. MCP scope, connector state, sandbox
  region, cache policy, and Chromium policy have **no backing field anywhere**
  today; until a schema and an enforcement adapter exist, the UI should show
  "not declared" rather than a fabricated default.
- **Honest working/stalled/unknown/complete states.** Adopt
  `classifySessionOutcome`'s six-state model (§6) as the shared vocabulary for
  *both* mechanisms, instead of Beacon inventing a second classifier for
  mechanism A's Roster panel.
- **Restrained live-progress affordances.** Beacon's actual current copy is
  plain — "Continue the same person," "Admitting successor…," "Collecting
  successor receipt…" — not nautical. Port Daddy's CLI voice elsewhere uses
  real maritime terms (`pd sitrep`, "roadmap rent," "sidequest," the Harbor
  welcome banner), so a light maritime accent in Beacon is a reasonable
  target, but it must stay this restrained: state + evidence first, flavor
  second, and never a status word that implies more certainty than the
  liveness evidence supports (no "under way" for a receipt that's merely
  `accepted`).

### Lineage / Continue / Join flow (target, annotated with what's real today)

```mermaid
sequenceDiagram
    participant Op as Operator (Beacon)
    participant D as Daemon
    participant Sp as Spawner
    participant Su as Successor agent + session

    Op->>D: POST /sessions/:id/continue<br/>idempotencyKey, backend, workdir
    Note right of D: Real on the integration branch;<br/>not yet on origin/main
    D->>D: AgentRunReceiptStore.accept()
    D->>Sp: spawn(spec)
    Sp-->>Su: new agent, session, transcript
    D->>D: sessions.linkSuccessor()<br/>metadata + immutable notes, both sessions
    D-->>Op: 202 receipt, status starting<br/>monitorUrl, controlCenterUrl
    loop until terminal
        Op->>D: GET /sessions/continuations/:receiptId
        D-->>Op: status live only with PID + fresh heartbeat
    end
    Op->>Su: Join / Follow via controlCenterUrl
```

---

## Part IV — Open Questions

1. **Merge mechanism B, or converge it into mechanism A?** They currently
   solve overlapping problems with different receipt schemas. An ADR should
   decide whether `POST /sessions/:id/continue` becomes the general-purpose
   path (with native-resume support borrowed from mechanism A) or whether
   Beacon's Sessions view should be re-pointed at
   `POST /memory/handoffs/:episodeId/continue` instead.
2. **Where does `permissionMode` belong on a continuation request?** Neither
   route accepts it today; deciding the field name and validation now avoids
   two more divergent implementations.
3. **What retires the false-positive shell-session failure mode for good?**
   §7 records one fixed instance (a receipt with no runtime). The invariant
   ("admission returns one successor agent+session+transcript+receipt or it
   isn't `live`") should become a contract test shared by both mechanisms.
4. **Is a real Door check coming to either route?** `docs/architecture/PORT-DADDY-COARSENED-ARCHITECTURE.md`
   marks Plane 3 "in flight." If it lands, both continuation routes need a
   defined integration point, not a bolt-on per-route check.

---

## Corrections vs. the prior draft

The prior draft (`89acaaf0a`) invented an API surface that never matched the
codebase. For a reader who saw it, or work that cited it, here is exactly what
was wrong:

| Prior draft claimed | Reality |
|---|---|
| `POST /memory/handoffs/:episodeId/continue` returns a `resumptionCapsule` with `harness_hints` (`restore_mcp_scope`, `enforce_sandbox`, `max_cost_per_step`, `background_workers_allowed`) | The route exists, but returns a continuation receipt against `lib/backend-catalog.ts`, not this shape. No `harness_hints` field exists anywhere. |
| `AgentNode.profile.capabilities` = `{ mcp, sandboxes, tools, background_workers, chromium, hotkeys, cache_policy }` | The real profile schema (`schemas/agent-harbor/v0/durable-agent-profile.schema.json`) has `permissionPolicy: { filesystem, network, allowedTools, deniedTools, enforcement }`. None of `mcp`/`sandboxes`/`chromium`/`hotkeys`/`cache_policy` exist. |
| Daemon stores a Blake3 hash, not the full transcript | `lib/transcripts.ts` stores full message content in `fleet_transcript_messages`; only oversized tool-arg strings are hashed. |
| ADR-0120 = "identity/capability enforcement ('the Door')" | `docs/adr/0120-rust-kernel-boundary.md` is about the Rust kernel boundary and has nothing to do with sessions, identity, or the Door. |
| ADR-0119 = permission-policy enforcement ADR | `docs/adr/0119-durable-agent-roster.md` is the durable-agent-roster ADR. It does mention a `declaration-only` permission field, but as one part of the roster profile schema, not as its subject. |
| ADR-0118 defines a runtime `HarnessAdapterContract` interface (`onSessionStart`/`reportProgress`/`offerHandoff`/`getSessionState`) | `docs/adr/0118-harness-adapter-contract.md` defines a static declarative catalog (`lib/backend-catalog.ts`), not a callback interface any harness implements. |
| Six-plane model cited to ADR-0048 | The six-plane kernel is described in `docs/architecture/PORT-DADDY-COARSENED-ARCHITECTURE.md`, not ADR-0048. |
| Nautical microcopy table ("becalmed," "weighing anchor," "reconvening") presented as Beacon's voice | Beacon's actual continuation copy is plain prose ("Continue the same person," "Admitting successor…"). No nautical terms appear in `app/src/Roster.tsx` or `app/src/session-flow.ts`. |
| `episode.lineage_chain: "ep_abc123 -> ep_def456 -> ep_xyz789"` string field | No such field exists on any handoff-episode or receipt record. |
| Single unified continuation flow across "Claude/Codex/PD native" | Two separate, unreconciled mechanisms exist (Part I §1); this was the draft's largest structural overclaim. |
