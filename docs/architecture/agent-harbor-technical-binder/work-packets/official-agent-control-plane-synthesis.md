# Official Agent Control Plane Synthesis

Status: synthesis of the July 3 subagent swarm for Agent Harbor, official Port Daddy agents, and the operator control panel.

This packet collapses the subagent work products into one buildable prescription. It does not replace the detailed
packets; it names the spine they agree on, the contradictions they exposed, and the next slices that should be handed to
implementation agents.

## Inputs

- `operator-control-panel-ux-flow.md`
- `product-surface-reality-review.md`
- `transcript-receipt-persistence-contract.md`
- `swarm-invocation-and-node-shaping.md`
- `durable-state-sandbox-supervision-review.md`
- `redteam-agent-harbor-control-plane.md`
- `docs/proposals/official-port-daddy-agent-compliance-plan.md` — authored on `codex/gpui-harness-mux`; will land with that branch (not yet shipped on main)
- `docs/proposals/articles-of-agreement-harness-roadmap.md`
- New skill lenses: `agentic-app-architecture`, `agentic-coding-ux-designer`, `agent-work-receipt-designer`,
  `developer-surface-strategist`, `swarm-invocation-designer`, `sqlite-durable-agent-state`,
  `sandboxed-adversarial-test-harness`, `macos-launchd-supervision`, and `product-reality-reviewer`.

## Product Thesis

Port Daddy is not another coding chat box. It becomes worth using instead of raw Claude Code, Codex, Cursor, or terminal
sessions when it is the daemon-backed system of record and control room for agent work.

The draw is:

- one place to start or attach work;
- one visible Agent Node joining body, backend, model tier, worktree, session, transcript, files, cost, controls,
  compliance, and receipt;
- local transcript and receipt truth that survives daemon restart;
- click-first operator control in `pd-console` and FleetBar;
- CLI, SDK, MCP, VS Code, web, mobile, and cloud as clients of the same daemon authority, not separate ledgers;
- honest downgraded modes when Port Daddy can observe but cannot govern.

The first public promise should be narrow:

> Start or attach one coding agent, watch what it does, control what Port Daddy can actually control, and receive a
> verifiable Work Receipt.

Everything else, including fleets, marketplaces, mobile command, Cloudflare workers, QLoRA training, and swarm
simulation, depends on that one promise becoming true.

## Single Operator Action

The operator primitive is `Start work`.

The daemon primitive is:

```text
Capture a WorkIntent, shape a WorkPlan, materialize AgentNodes only when the plan is governable, attach Bodies through
adapters, persist TranscriptEvents, authorize controls through the daemon, and seal a WorkReceipt.
```

Old words are compatibility source metadata, not product concepts:

| Old word | Target meaning |
| --- | --- |
| `spawn` | compatibility launch entrypoint for a WorkIntent with adapter preference |
| `agent` / `agents` | registry, heartbeat, stream, inbox, and control for existing Agent Nodes |
| `dispatch` | queued/background WorkIntent source |
| `sortie` | mission/workgroup recipe source |
| `conjure` | interactive WorkIntent drafting flow |
| `nightshift` | scheduled or background WorkIntent source |

The user should never have to decide which of these taxonomies applies. The planner decides one node, scout, chain,
DAG/workgroup, tournament, ambient watcher, or human gate from coupling, context pressure, skill boundary, review
independence, budget, and operator burden.

## Official-Agent Definition

An official Port Daddy agent is a durable Agent Node whose current Body is joined to a daemon-governed session, verified
transcript chain, worktree/sandbox, control authority, budget, and Work Receipt path.

Minimum predicates:

- Agent Node exists before the first model turn.
- Body/provider/model metadata is recorded and cannot self-upgrade compliance.
- Session, worktree/sandbox, transcript id, and retention policy are non-null before official work starts.
- Transcript events are append-only, sequenced, hash-linked, redacted, archived locally by default, and replayable.
- Tool and shell actions pass through daemon preflight or are marked ungoverned.
- Controls are capability-specific: steer, interrupt, pause, kill, checkpoint, and fork are separate promises.
- Cost cap, timeout, model tier, resolved model, and partial cost events are persisted.
- Final or stopped work emits a typed Work Receipt from persisted events and artifacts, not agent prose.
- `pd doctor` / control-panel readiness can explain every missing predicate and offer remediation.

Useful but non-official modes:

| Mode | Meaning | UI behavior |
| --- | --- | --- |
| `observed` | Port Daddy sees rows or imported history but cannot prove governance. | Show history; disable governance/control claims; offer attach/repair. |
| `run-log` | Structured steps exist but no reliable chat/tool transcript. | Label as run log, never transcript excerpts. |
| `transcripted-weak` | Visible chat exists but tool/file/cost details are incomplete. | Inspectable, not artifact-backed proof. |
| `sandbox-degraded` | Agent can run but sandbox/Coast Guard is partial. | Allow only lower-risk scopes or block official label. |
| `privacy-degraded` | Local transcript/archive disabled by explicit policy. | Allow observed/private mode, not official coding work. |

## Transcript Fidelity Ladder

Use the transcript fidelity ladder from the receipt packet as the cross-surface language:

| Level | Name | Product meaning |
| --- | --- | --- |
| T0 | Inventory only | Agent/session exists, no transcript. |
| T1 | Run log | Structured steps/status, no visible conversation. |
| T2 | Visible chat | Operator and assistant messages, weak tool proof. |
| T3 | Tool-backed transcript | Chat, tool calls/results, shell, stdout/stderr refs, file touches, approvals, denials, costs. |
| T4 | Verified transcript | T3 plus Agent Node/body/session/worktree joins, sequence, hash chain, redaction, retention policy, SSE replay, JSONL archive. |
| T5 | Resumable transcript | T4 plus checkpoints, compaction packets, memory/source citations, claims, active commitments, successor metadata, rollback point. |

Rules:

- T4 is the minimum for official C1 transcripted status.
- T5 is required before the UI can offer strong successor/fork/resume claims.
- No transcript means no official agent.
- A receipt can exist below T4, but it must be weak and carry a high-severity evidence risk.

## Compliance Ladder Freeze

The red-team found a real contradiction: binder docs and the compliance proposal use different C-level names and numbers.
Do not ship numeric C badges until F0 freezes one ladder.

Recommended public/operator ladder:

| Level | Name | Required predicates |
| --- | --- | --- |
| C0 | Registered | Agent Node/body/session identity exists; no transcript or governance implied. |
| C1 | Transcripted | T4 verified transcript is active or replayable. |
| C2 | Governed | Tool preflight, denials, approvals, and destructive-action gates are daemon-witnessed. |
| C3 | Suggestible | Skills, memory, inbox, repo updates, and parley suggestions can be injected with visible provenance. |
| C4 | Controllable | Steer/interrupt/pause/kill/checkpoint capabilities are individually probed and truthfully rendered. |
| C5 | Cooperative | Claims, worktree/sandbox, tube/parley, file heat, and conflict signals are active. |
| C6 | Resumable | T5 continuation packet can launch a successor after daemon restart with explicit missing-state limits. |

Until this schema lands, UI should show capability predicates rather than numeric labels.

## Operator Control Panel

`pd-console` is the primary command room. It must show conjoined panes, not a sub-CLI.

Default layout:

- Left: active and recent sessions with title, backend/body, model tier, compliance predicates, last activity, cost, worktree,
  transcript fidelity, files, PR/receipt status, and readiness blockers.
- Center: selected run live transcript above the fold, with chat, streaming deltas, tool calls, shell output, file writes,
  safety stops, approvals, denials, PR events, skill grafts, compaction, memory retrieval, and errors.
- Right/tabs: files/diffs/artifacts, Work Receipt, setup/doctor cards, attention/parley, cost/budget, and controls.
- Bottom/action bar: click-first controls only when daemon authority supports them; otherwise disabled with exact remediation.

First-run flow:

1. Describe work.
2. Attach context.
3. Review Work Brief.
4. Form team or choose single-node plan.
5. Fix setup if readiness fails.
6. Launch build room.
7. Watch live transcript and files.
8. Steer, interrupt, approve/deny, or checkpoint.
9. Seal and verify Work Receipt.

No routine operator path should require copying commands or typing numeric ids. CLI remains for agents, scripts, CI, and
emergencies.

## Durable State And Safety Gates

Official admission is fail-closed on these gates:

| Gate | Must prove |
| --- | --- |
| DB canonicality | One stable DB path, WAL active, `-wal`/`-shm` treated as one DB family, no official rows in fragments. |
| Transcript retention | Local transcript capture on by default, non-null session joins, JSONL archive or equivalent durable sink. |
| Event integrity | Versioned TranscriptEvent schema, sequence, idempotency key, hash chain, redaction state, tolerant reader. |
| Supervisor integrity | Exactly one legitimate stable supervisor loaded; reachable-but-unsupervised daemon blocks official launch. |
| Sandbox containment | Filesystem/network/secrets/process containment harness passes or launch downgrades. |
| Secret custody | Keychain/equivalent store, scoped grants, no raw keys in child env/transcript/archive, audited reveal. |
| Doctor remediation | One Agent Harness readiness verdict plus safe click-first repair paths. |
| Receipt verification | Receipt verifies transcript head hash, diff/file hashes, cost, approvals/denials, PR/artifact refs after restart. |
| Control truth | Each control has queued/delivered/acknowledged/failed/unsupported states from daemon records. |
| Cost truth | Budget cap, partial cost, remote storage/artifact cost, and failure cost survive restart. |

## Must-Build Slices

These are the chains to hand to agents. Each slice should own a disjoint write surface and produce tests.

### F0: Freeze Contracts

Output:

- canonical compliance ladder,
- identity map for Agent Node / Body / Session / WorkIntent / WorkPlan / WorkReceipt,
- versioned `TranscriptEvent` schema,
- route ownership table for old and new launch paths,
- proof-manifest schema for visual artifacts.

Tests:

- schema consistency across docs/routes/UI/probe,
- old launch route fixture creates one WorkIntent/AgentNode/session/transcript chain,
- malformed/future TranscriptEvent tolerant-reader fixture.

### C1: Verified Transcript Chain

Output:

- official launch creates Agent Node, session, transcript id, retention policy, and first event before first model turn;
- non-null session joins for official rows;
- event sequence/hash chain/idempotency;
- local JSONL archive for canonical events;
- T0-T5 labels in APIs.

Tests:

- `official-node-before-turn`,
- `non-null-session-join`,
- `stream-replay-dedupe`,
- `jsonl-retention`,
- `missing-capture-downgrade`.

### C2: Work Receipt

Output:

- normalized nine-section receipt body;
- receipt rows with transcript/diff/files/body hashes;
- verifier endpoint/CLI;
- weak receipt downgrade path;
- PR/visual artifact refs.

Tests:

- artifact-backed validation rejects self-reported pass,
- restart then verify receipt hashes,
- redaction preserves proof labels without leaking secrets.

### C3: Doctor And Remediation

Output:

- `Agent Harness` section in `pd doctor --json`;
- official readiness verdict;
- remediation cards for transcript/session join, archive, hooks/MCP, provider credential, sandbox, supervisor, stale daemon,
  DB fragmentation;
- FleetBar/dashboard/pd-console click-first repair hooks.

Tests:

- CLI status green but MCP spawn timeout produces remediation,
- stale daemon/CLI/hook/MCP/PATH/provider alias drift downgrades readiness,
- every failing gate has a repair or explicit "manual/unsupported" state.

### C4: Control Plane And pd-console

Output:

- session list + selected run transcript/files/receipt panes;
- live/historical/stale/observed/non-compliant states;
- control commands with capability-specific states;
- no command authorized from stale projections;
- file path resolution to absolute worktree paths.

Tests:

- real active stream renders transcript/tool/file events;
- historical replay renders after restart;
- observed import disables official controls;
- interrupt/pause/kill/steer unsupported states render distinctly;
- visual artifacts show real daemon-backed run ids and transcript hash.

### C5: Tool Governance And Sandbox

Output:

- pre-tool destructive-git gate;
- direct MCP bypass detection or denial;
- sandbox containment harness;
- Coast Guard admission predicate;
- no raw provider keys in official child env.

Tests:

- dirty-worktree destructive commands leave bytes unchanged after denial;
- direct MCP bypass canary downgrades or blocks;
- SSRF/path/secret/resource/side-effect containment fixtures;
- leaked canary secret quarantines event and blocks official launch.

### C6: Successor/Resume

Output:

- checkpoint and compaction packet schema;
- successor creation from persisted state;
- predecessor remains append-only;
- missing-state disclosure.

Tests:

- kill body, restart daemon, launch successor from persisted packet;
- successor knows next action, active commitments, files, permissions, and missing non-reconstructable state;
- UI says successor from captured state, not perfect process resurrection.

### C7: Product Surface Alignment

Output:

- website and docs lead with one local managed Agent Node proof;
- Agents page stops overclaiming unsupported backends;
- GUI/CLI/SDK/MCP surface matrix;
- account/local-only/provider fallback language;
- pricing/trust copy before cloud claims.

Tests:

- site claims are gated by proof-manifest fixtures;
- every GUI happy path maps to daemon command/query/event;
- no ordinary user flow requires CLI command copy/paste.

## Stop Rules

Pause implementation or public copy if any are true:

- compliance ladder differs across docs, schema, UI, or probe;
- a UI control has no daemon command/query/event contract;
- "LIVE" can render from stale session rows alone;
- official transcript events can persist with null session/body/worktree joins;
- receipts can be generated from agent prose alone;
- hook-only or observed bodies appear as governed official agents;
- local-first runs upload transcripts/blobs without explicit opt-in;
- a visual artifact lacks daemon port, run id, agent node id, transcript head hash, commit, and real/mock/fixture label.

## Immediate Next Moves

1. Rebase again onto PR #646 so `agentic-app-architecture` is local in this worktree.
2. Merge the architecture audit packet when Hypatia returns.
3. Promote this synthesis into `00-prd-roadmap-and-test-plan.md` or a new binder front-door section.
4. Open implementation issues/PR slices for F0, C1, C2, and C3 before doing more UI polish.
5. Use the red-team fixture pack as the CI and visual-proof backlog for any `/harness`, `pd-console`, or marketing copy.
