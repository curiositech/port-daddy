# Mission Control ReactFlow Interaction Lab

This is a standalone, bounded interaction laboratory for Port Daddy Mission Control. It is intentionally not the canonical product UI. The canonical surface remains Rust GPUI; the contracts proven here are candidates for a later graft.

## Run it

```sh
npm install
npm run dev
```

Validation and proof:

```sh
npm test
npm run build
npm run perf
npm run test:e2e
npm run artifacts
```

## What the lab proves

- Objective-first overview with an inspectable AST + Suggestibility DAG, critical path, and parallel execution waves.
- The 18-node fixture is the deliberate hero: it opens as a centered, full-canvas mission with large cards. Selecting a node opens the inspector and deterministically refits the graph; closing the inspector restores the hero viewport.
- The 50/100/200-node fixtures are explicitly labeled scale, stress, and limit probes. They are performance modes, not marketing screenshots.
- A node opens its inspector in one click; the independently inspectable evidence surface is one additional click away.
- Distinct `live`, `recorded`, `fixture`, and `unknown` provenance treatments. The whole application is a fixture lab, so “live” and “recorded” are examples of the proposed taxonomy rather than claims about current daemon state.
- Node contracts expose prompts, skills, dependencies, agent/session, events, tests, receipts, cost, artifacts, evaluation, and unresolved conundrums.
- Launch/resume, reprioritize, interrupt, cancel, reconnect, and decision-resolution controls.
- An event timeline with monotonic sequence IDs, cursors, playhead, execution motion, and terminal states.
- An SSE-shaped, versioned stream contract with idempotency keys, partial-frame reassembly, bounded replay, backpressure counters, reconnect/resume, cancellation, and malformed-frame recovery. WebSocket is intentionally omitted because the demonstrated data path is server-to-operator; operator actions remain ordinary commands.
- Deterministic 50/100/200-node fixtures, viewport culling, topology-only layout, stable node types, memoized graph surface, and referentially isolated node updates.
- No minimap is rendered. A blank or unreadable overview is worse than the native fit controls; every fixture instead receives a deterministic fit policy sized to the available graph canvas.
- Reduced-motion behavior that removes graph movement and pulsing while preserving state through text, color, and static edge styling.

## Degraded coordination provenance

This tangent originated inside the clean dispatch worktree `port-daddy-dispatch-b3151d17`. Port Daddy dispatch was attempted three times with a $12 cap. Those daemon-created sessions persisted `credential:null`, so note and claim writes failed closed. On the landing resume, the canonical daemon successfully minted actor-bound durable session `session-polish-and-land-the-bounded-mission-control-reac-11d9eede390b`, created roadmap item `mission-control-reactflow-interaction-lab`, accepted the scope note, and claimed the lab plus changelog surface without bypassing identity enforcement.

Two control-plane defects remained. Installed `pd` 3.30.2 returned `ERROR: Was there a typo in the url or port?` for both `pd sitrep` and `pd plan set`, so the equivalent checklist was preserved in the durable note and local task plan. Later, the canonical Bun 1.2.21 daemon crashed with a logged segmentation fault; `pd status` then returned `ECONNREFUSED` while launchd still reported a running generation. Source, tests, and artifacts remain local deterministic work, and no claim or identity enforcement was bypassed during the outage.

## Evidence honesty

The visual labels exercise a provenance language; they do not convert fixtures into production evidence. Generated screenshots and the browser recording are checksummed in `artifacts/provenance-manifest.json`. They prove the rendered browser artifact at the recorded viewport. They do not prove GPUI parity, daemon wiring, production authentication, or multi-machine stream behavior.
