# Porthole — privacy-safe evidence, continuity, and debugging for autonomous work

**Status:** product and architecture contract; delivery is phased below

**Updated:** 2026-08-29

**Current proof:** PR #9902 proves an honest terminal replay/gallery layer, not the complete product

Porthole began as a better terminal recorder. That remains a useful wedge, but it is not the
defensible center. PTY driving, terminal emulation, screenshots, and casts are engine capabilities.
Porthole's product boundary is the evidence graph that explains an autonomous decision without
turning the worker's terminal into an unbounded surveillance feed.

> **Click a decision. Reconstruct what the worker could see and do. Follow every cited omission and
> receipt. Prove the privacy boundary. Branch from a verified checkpoint and compare the repair.**

## 1. The product in one sentence

Porthole is the **privacy-safe evidence, continuity, and debugging layer for autonomous work**:
it turns terminal, process, tool, context, and Port Daddy events into a correlated, searchable,
selectively disclosed trace with receipts and controlled replay.

The terminal player is the lens. Port Daddy's canonical event chain is the authority. Porthole's
capture boundary, decision projection, privacy receipts, and branch comparison are the product.

## 2. The killer demo

The demo starts at a failed agent decision, not at a blank terminal.

1. **Open the decision.** A review card says what the agent decided, when, and under which Port
   Daddy identity, session, run, worktree, model, and authorization scope.
2. **See the exact privacy-preserving screen.** The player reconstructs the terminal geometry,
   cursor, styles, alt-screen state, and causal frame immediately before the decision. Cells covered
   by privacy policy are visibly redacted; claiming persisted secret bytes and no secret storage at
   the same time would be contradictory.
3. **Follow the cause.** The selected frame joins to the command boundary, exit status, process
   lineage, tool invocation, file/diff head, and external event that produced it.
4. **Inspect continuity.** The decision cites the exact `ContextEnvelope`. If compaction occurred,
   the viewer opens its `CompactionPacket`, sees which obligations and risks survived, and follows
   any authorized `BufferedOutputRef` without pretending omitted bytes were loaded into context.
5. **Verify the outcome.** A `WorkReceipt` binds intent, scope, risks, commands, tests, rollback,
   spend, provenance, and relevant Porthole artifacts. A cast alone is never a receipt.
6. **Prove privacy before persistence.** A one-use canary secret appears transiently in the test
   terminal. The capture gateway records a pre-write redaction/drop decision, and an exhaustive
   scan of the declared durable perimeter returns zero canary bytes. This claim is invalid if an
   adapter wrote a raw cast or private log first.
7. **Test the repair.** The reviewer starts a controlled successor from the last verified T5
   pre-failure checkpoint. An isolated child receives one declared repair delta and a distinct
   identity/run/receipt. Porthole compares original and child evidence without mutating history.

The wow is not video playback. It is one click from a disputed decision to the smallest truthful
evidence set that explains it, plus a safe way to test a counterfactual repair.

## 3. Capability truth

| State | Contract |
|---|---|
| **Proved by #9902** | faithful casts; selectable reconstructed text; semantic terminal styling; real tmux perspectives; literal timestamps and marked jump cuts; service identity/discovery proof; natural decision-receipt presentation; scene restart and observer teardown |
| **Existing Port Daddy authority, consumed after exact join verification** | canonical `TranscriptEvent`, T0–T5 fidelity, `ContextEnvelope`, `CompactionPacket`, and `WorkReceipt` |
| **Join-only from owning work** | Sugar Parley settlement and `BufferedOutputRef`; Porthole must cite exact merged commits, tests, receipts, and fresh recordings before depicting them |
| **Proposed Porthole engineering** | structured terminal/process observations, pre-persistence screen-aware DLP, decision projection, evidence search, selective disclosure, deterministic TUI assertions, controlled execution branching, microVM/Wasm snapshot acceleration |

No gallery scene may stage an unread turn, overflow, interactive compaction, privacy claim, or branch
takeover before the corresponding contract is executable and independently verified.

## 4. Architecture: engines below, Porthole above

Porthole extends the existing Agent Harbor evidence chain. It does not create a second transcript,
identity, context, receipt, or approval system.

```text
shell / TUI / agent runtime
        │
        ▼
TerminalEvidenceAdapter       deterministic control + transient observation
        │  normalized in-memory observations
        ▼
CaptureGateway                classify → minimize → redact/drop → authorize
        │  sanitized observations only
        ▼
canonical TranscriptEvent     append-only sequence + hash chain + retention
        │
        ├──────────────┬────────────────┬──────────────────┐
        ▼              ▼                ▼                  ▼
screen artifacts   Port Daddy joins   search projection   T5 checkpoints
        │              │                │                  │
        └──────────────┴──────► AgentRun / WorkReceipt ◄───┘
                               │
                               ▼
                         Porthole decision view
```

The canonical authority is the
[`TranscriptEvent` persistence contract](../../docs/architecture/agent-harbor-technical-binder/work-packets/transcript-receipt-persistence-contract.md).
Porthole proposes additive, schema-validated terminal observation payloads and an `AgentRun`
projection over those events. It does not replace the event ledger.

Minimum engine boundary:

```ts
interface TerminalEvidenceAdapter {
  start(spec: SanitizedLaunchSpec): Promise<EngineSession>;
  control(session: EngineSession, action: TerminalAction): Promise<ObservedEvent>;
  observe(session: EngineSession): Promise<TransientTerminalSnapshot>;
  exportTransient(session: EngineSession): Promise<TransientArtifactHandle[]>;
  destroy(session: EngineSession): Promise<void>;
}

interface CaptureGateway {
  redactAndCommit(
    observations: AsyncIterable<TransientEvidenceObservation>,
    correlation: PortDaddyCorrelation,
  ): Promise<PortholeCommitReceipt>;
}
```

`exportTransient` is not permission to persist raw evidence. The gateway owns the first durable
write. Any adapter that automatically writes raw PTY traffic must use a verified ephemeral store
that is destroyed before Porthole can make a no-secret-on-disk claim.

## 5. Engine benchmark

The benchmark uses the current official upstream contracts.

| Engine | Useful adapter/reference surface | Not its authority |
|---|---|---|
| Microsoft [`tui-test`](https://github.com/microsoft/tui-test) | deterministic keyboard/mouse/resize/signal control; semantic waits and assertions; command boundaries, exit codes, cwd, cells, colors, cursor, and recordings; in-process Rust/Python/JavaScript APIs | Porthole privacy policy, evidence persistence, Port Daddy correlation, cited search, receipts, or branch authority |
| Coder [`agent-tty`](https://github.com/coder/agent-tty) | append-only event-log and artifact/replay architecture; transient screenshot/video/cast production; CLI/JSON interoperability | structured command truth beyond its contract, pre-write DLP, Port Daddy continuity, signed receipts, semantic search, or controlled branching |

`tui-test` currently labels its documentation beta during a major rewrite. `agent-tty` documents an
event log as canonical truth and a bounded v1 scope. Pin experiments to exact versions/commits and
keep an engine-neutral adapter conformance suite. See the upstream
[`tui-test` recording contract](https://github.com/microsoft/tui-test#recording),
[`agent-tty` architecture](https://github.com/coder/agent-tty/blob/main/design/ARCHITECTURE.md), and
[`agent-tty` usage contract](https://github.com/coder/agent-tty/blob/main/docs/USAGE.md).

Neither engine documents the complete pre-persistence privacy, Port Daddy join, receipt, search,
or controlled-branch contract. Porthole must retain an in-house capture path whenever an adapter's
own writes make strict privacy unprovable.

## 6. Porthole's additive trace projection

`TranscriptEvent` remains the append-only fact. Porthole adds sanitized screen/process payloads and
one disposable decision-centered projection. The smallest proposed manifest is:

```ts
interface PortholeEvidenceManifestV0 {
  schema: 'pd.porthole.evidence-manifest.v0';
  traceId: string;
  agentNodeId: string;
  sessionId: string;
  runId?: string;
  transcriptId: string;
  eventHead: { eventId: string; contentHash: string; sequence: number };
  fidelity: 'T3' | 'T4' | 'T5';
  decisions: Array<{
    decisionId: string;
    decisionEventId: string;
    screenEventId?: string;
    commandEventIds: string[];
    processEventIds: string[];
    contextEnvelopeRef?: string;
    compactionPacketRef?: string;
    bufferedOutputRefs: string[];
    workReceiptRef?: string;
  }>;
  privacyReceiptRef: string;
  parent?: {
    traceId: string;
    checkpointEventId: string;
    parentHeadHash: string;
    branchAuthorityReceiptRef: string;
  };
}
```

The manifest stores references, not copied authority. Proposed observation payloads are carried by
canonical events and must include:

- terminal byte range or sanitized artifact ref, terminal dimensions, emulator/renderer/version,
  frame hash, cursor, alt-screen state, changed cell regions, and prior frame event;
- command/tool start and finish IDs, argv after the same privacy gateway, exit/signal/outcome, cwd
  identity, and artifact refs;
- process start/finish, parent relation, executable identity, and allow-listed environment change
  classes—never raw inherited environment values;
- causal `parentEventIds`. Timestamps alone never establish causality;
- omission count, reason, policy, authorization, expiry, and resolvable scoped reference when one is
  permitted. “Not captured,” “redacted,” “omitted from context,” and “withheld from this viewer” are
  distinct states;
- media type, byte length, content hash, redaction state, retention policy, and disclosure policy
  for every persisted artifact. Hashes of low-entropy secrets are not persisted.

The projection can be deleted and rebuilt from canonical events. It never authorizes a command.

## 7. Port Daddy correlation and continuity

Porthole consumes, rather than redefines, these authorities:

- Agent Node, body, session, run, harbor, worktree, claim, lock, and transcript-event IDs anchor
  each observation;
- [`ContextEnvelope`](../../docs/adr/0097-m6-context-memory-and-search-contracts.md) records what
  was actually attached and the observed pressure boundary;
- `CompactionPacket` carries cited obligations, facts, risks, decisions, commands, transcript head,
  and next action into a successor;
- `BufferedOutputRef` remains the W8/W12 capability-scoped output contract. Porthole stores only the
  authorized reference/coverage relation, never a copied blob ID, preview, or output body;
- `WorkReceipt` remains the reviewer-facing trust object. Porthole contributes event/artifact IDs,
  privacy dispositions, and branch receipts but does not self-certify work;
- Sugar/Parley appears naturally in the primary view, with raw protocol transcript and receipts as
  drill-down evidence.

ADR-0118's [harness adapter contract](../../docs/adr/0118-harness-adapter-contract.md) distinguishes
native resume from sanitized successor handoff. Porthole must preserve that distinction: playback
seeking is never execution time travel, and a hook-created packet does not itself launch a process.

## 8. Privacy is a storage architecture

“Scrub before share” is too late. By then the secret may already exist in casts, debug logs, search
indexes, thumbnails, backups, or engine-private event stores.

> **Classify and minimize before the first durable write.**

The capture gateway emits only an allowed derivative. Its receipt records policy/version,
adapter/version, input class, decision counts, changed/redacted cell counts, sanitized artifact
hashes, dropped-field counts, destination classes, and the storage perimeter audited. It never
records the rejected secret, a preview, or a guessable fingerprint of it.

The privacy acceptance test must prove:

1. a generated canary was rendered transiently by the test workload;
2. the gateway emitted a pre-persist redaction/drop disposition;
3. no adapter-private persistent recorder or debug artifact was enabled;
4. exhaustive scans of the event ledger, blob/archive roots, search index, frames, casts, receipts,
   caches, crash artifacts, and exported bundle contain zero canary bytes;
5. the stored screen contains explicit redaction cells/regions, not silently rewritten history;
6. expiry/deletion removes authorized payloads and search projections while preserving only a
   minimal non-sensitive tombstone needed by cited receipts.

Privacy and civil-liberties defaults:

- local-first capture, encrypted opt-in sync, explicit sharing, scoped capabilities, and
  organization-controlled keys;
- separate participant, observer, reviewer, exporter, and branch-authority permissions;
- no hidden keylogging, employee monitoring mode, model-private chain-of-thought collection, or
  secondary training use;
- visible recording state, notice/consent policy, bounded retention, selective disclosure, export,
  deletion, and a participant-readable access log;
- evidence queries and branch attempts are themselves auditable;
- private agent/team perspectives stay private until a policy-authorized join. Shared run membership
  does not silently grant omniscient access.

## 9. Efficient storage, indexing, and retrieval

The canonical event ledger stores small immutable facts. Large sanitized artifacts live in a
content-addressed encrypted blob tier. Search and decision views are disposable projections.

- **Screens:** periodic sanitized keyframes plus changed-cell runs; deduplicate identical grids and
  style tables inside one authorized privacy domain; retain byte-to-cell lineage separately from
  DOM choices.
- **Output:** chunk after privacy policy by command/process boundary, compress, and store byte counts
  plus explicit omission state. Raw transient adapter artifacts never become a cold tier.
- **Process/tool/context:** relational fields support exact filters; parent event IDs support “what
  caused this?” traversal.
- **Search:** use the existing budgeted, cited `TranscriptSearchQuery/Result` contract. Default
  retrieval is hybrid lexical+dense with RRF; every hit cites an event/artifact and carries index
  freshness. Search displays and never decides or authorizes.
- **Screen-region retrieval:** index sanitized visible text with frame/time/cell coordinates so a hit
  opens the exact region rather than a nearby raw byte offset.
- **Receipts:** index stable IDs, outcomes, tests, files, risks, privacy class, and citations. Receipt
  bodies remain canonical.

Example questions:

- “Show the screen and context behind the first decision that cited this failed test.”
- “Which agents saw the lock refusal before they edited `src/checkout.ts`?”
- “Find runs where a command exited non-zero but a validation projection said pass.”
- “Which context packets omitted the warning later named in the incident receipt?”
- “Compare the original and repaired successor at command, screen, context, and receipt layers.”

## 10. Controlled branching and virtualization

Branching is not “resume a recording.” The UI must remain disabled until canonical evidence reaches
T5 and a verified snapshot/checkpoint provider plus sandbox authority exists.

A branch manifest binds:

- git tree/commit, dirty-file hashes, and current worktree authority;
- allow-listed environment names/change classes, never credential values;
- filesystem/process/runtime snapshot identity;
- terminal dimensions, emulator, locale, clock/randomness policy, and engine version;
- Port Daddy predecessor/successor lineage without copied credentials;
- `ContextEnvelope`, cited `CompactionPacket`, model/adapter/tool policy, network fixtures, and budget;
- parent transcript head, privacy policy, declared repair delta, and branch authority receipt.

The first pilot may reconstruct a container or microVM from content-addressed inputs rather than
snapshot a live kernel. Later Wasm Linux or microVM snapshots can reduce startup time. Either way,
the child receives a new identity, isolation boundary, budget, transcript, and receipt. It cannot
mutate the historical run or borrow its credentials.

Comparison includes commands, processes, visible cells, context inputs, files, tests, cost, and
receipts. A changed outcome is not automatically causal; every changed input and uncontrolled
dependency remains visible.

## 11. Deterministic TUI testing is one consumer

Porthole still supports the Playwright-for-terminals use case: inject input, wait for a region or
command boundary, require a stable screen interval, assert cells/text/exit state, and export an
interactive evidence bundle on failure.

The assertion runner consumes the same sanitized canonical events and receipts as debugging,
handoff, and review. It is not the center of the data model, and static strings are not the only
truth available.

## 12. Divergent perspectives and cooperative pd-console work

A team run is one correlated event graph with perspective-specific projections. NORA's screen,
MILO's screen, the daemon ledger, and the operator console may disagree without one being discarded.
Shared causal edges show what each party had actually seen at each decision. Porthole captures the
“Run, Lola, Run” of a team instead of flattening it into one fake omniscient timeline.

WebSockets or Durable Objects may transport live cursor, annotation, presence, and perspective
updates for cooperative pd-console sessions. They do not become the durable evidence authority.
Porthole persists only privacy-authorized facts into the canonical ledger; the transport remains
replaceable and floating cursors remain annotations unless cited by a decision or receipt.

## 13. Why people install it

- **Agent developer:** deterministic failure traces, searchable visible state, and isolated repair
  experiments instead of unqueryable video or ANSI sludge.
- **Fleet operator:** decision-to-receipt accountability and continuity across compaction,
  successors, agents, machines, and shifts.
- **Security/privacy team:** pre-persistence DLP, selective disclosure, retention, and auditable
  evidence access rather than regex scrubbing after capture.
- **CLI/TUI maintainer:** engine-neutral interaction tests and exact CI failure replays.
- **Incident responder:** causal command/process/context reconstruction and safe handoff.
- **Cooperative team:** multiple private perspectives, shared annotations, receipts, and controlled
  successor experiments without pretending everyone saw the same state.

The installation promise is: **when autonomous work fails or is disputed, you can explain it,
continue it, and test a repair without surrendering every terminal byte to a surveillance archive.**

## 14. Delivery order

1. **Truthful replay foundation (#9902):** land the conflict-free gallery/player proof only after
   its Sugar/context-pressure joins and adversarial review settle. Preserve real casts and receipts.
2. **Canonical terminal observations + capture gateway:** additive event schemas, adapter
   conformance, in-memory reconstruction, pre-persistence DLP, canary/no-write test, and local
   projection.
3. **Port Daddy correlation join:** consume exact merged `BufferedOutputRef`, `ContextEnvelope`,
   `CompactionPacket`, Sugar settlement, and `WorkReceipt`; ship the first decision-centered viewer.
4. **Cited search and selective disclosure:** screen-region retrieval, capability-scoped evidence
   bundles, deletion/tombstones, and access audit.
5. **Deterministic assertion runner:** action/wait/stability/region contracts with failure bundles;
   compare candidate engines behind the same conformance suite.
6. **Controlled successor pilot:** reconstruction-based T5 checkpoints first, then microVM/Wasm
   acceleration after identity, credential, network, privacy, and receipt boundaries are proven.
7. **Cooperative console projection:** live cursor/annotation transport over the same privacy and
   evidence rules.

## 15. Non-goals

- a universal employee-screen recorder;
- hidden input capture or model-private reasoning capture;
- a second Port Daddy identity, transcript, context, receipt, search, or approval system;
- claiming historical causality from a reconstructed successor;
- storing raw terminal artifacts first and promising to scrub them later;
- coupling the evidence contract to one terminal emulator, browser, cloud, or language;
- depicting output overflow, interactive compaction, or branch takeover before exact owning
  contracts and evidence exist.

Porthole wins when an engine can be swapped without changing what a decision, privacy boundary,
receipt, search result, or controlled successor means.
