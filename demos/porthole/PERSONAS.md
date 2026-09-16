# Porthole personas and evidence stories

**Updated:** 2026-08-29

**Positioning:** privacy-safe evidence, continuity, and debugging for autonomous work

Every story starts with a disputed decision or broken run and ends with cited evidence, an honest
privacy boundary, or a receipt-bound successor. Commands and product surfaces remain proposals until
their delivery wave in `PRODUCT.md` is executable.

## P1 — The agent developer

An autonomous coding agent made the wrong edit after a long interactive session. Raw JSONL says a
tool ran; the terminal video is unsearchable; neither explains the model's visible state.

- **Need:** click the failed decision, see its privacy-preserving screen, command/process chain,
  context boundary, cited omitted output, file state, and receipt.
- **Porthole outcome:** one correlated trace shows what the agent had actually seen, not what a later
  summary says it saw. The developer searches by visible screen text and opens the exact cells/time.
- **Repair:** when a verified T5 checkpoint exists, start an isolated successor with one declared
  delta and compare its evidence/receipt to the original.

## P2 — The fleet operator

Several agents and the daemon witnessed different parts of one failure. A flat combined transcript
makes every participant look omniscient and erases unread turns.

- **Need:** one causal graph with separate NORA, MILO, daemon, and operator projections.
- **Porthole outcome:** shared event edges show when each party learned a fact; private perspectives
  remain private until policy authorizes a join. Compaction and handoff resolve through cited
  `ContextEnvelope`/`CompactionPacket` evidence instead of folklore.
- **Trust:** the final `WorkReceipt` links exactly the commands, tests, screen artifacts, privacy
  decisions, and transcript head that justify it.

## P3 — The security and privacy reviewer

A terminal displayed a bearer token. Scrubbing the exported replay is insufficient because the raw
value may already live in the recorder, index, cache, screenshot, or backup.

- **Need:** prove minimization before the first durable write.
- **Porthole outcome:** a generated canary is rendered transiently, replaced by explicit redaction
  cells in the persisted screen, and absent from every declared DB/blob/archive/index/export surface.
- **Controls:** participant-visible recording state, scoped access, selective disclosure, bounded
  retention, deletion/tombstone behavior, and an audit trail for evidence reads and branch attempts.

## P4 — The CLI/TUI maintainer

A full-screen application fails only under one sequence of keys, resizes, and asynchronous redraws.
Static snapshots are brittle and ANSI logs cannot tell what was visible after cursor rewrites.

- **Need:** deterministic input, semantic waits, stable-region assertions, reconstructed cells, and
  an interactive CI failure trace.
- **Porthole outcome:** an engine-neutral assertion runner consumes privacy-safe canonical events.
  The maintainer can inspect the exact failing region and real exit/process outcome.
- **Engine freedom:** `tui-test`, `agent-tty`, or an in-house driver may sit below the same adapter;
  none changes Porthole's receipt/privacy/search contract.

## P5 — The incident responder

Shift change arrives during a long investigation. Chat contains selected snippets, tmux contains
ephemeral state, and nobody remembers which warning preceded the rollback.

- **Need:** causal command/process/context reconstruction plus a safe successor handoff.
- **Porthole outcome:** the incoming responder follows cited decisions, omitted-output references,
  tests, and receipts without receiving hidden credentials or unrelated private terminal content.
- **Continuity:** the successor begins from a validated packet/checkpoint and receives a distinct
  identity, scope, budget, and receipt.

## P6 — The cooperative pd-console team

Humans and agents are vibe-coding one Rust, Swift, or web app from different windows. They share
presence and intent but do not share every private prompt, terminal, or credential.

- **Need:** floating cursors, annotations, live perspective changes, and durable decision evidence
  without collapsing everyone into one screen recording.
- **Porthole outcome:** WebSocket/Durable Object transport can carry ephemeral presence; Porthole
  correlates only policy-authorized facts into the canonical evidence graph. A cursor or annotation
  becomes durable evidence only when cited by a decision/receipt.
- **Debugging:** the team can replay the same moment through different perspectives, then run an
  isolated successor experiment from a verified checkpoint.

## P7 — The reviewer, auditor, or regulator

A PR, automated decision, or safety incident makes a strong claim. The reviewer needs enough proof
to challenge it without gaining access to an entire worker's terminal history.

- **Need:** selective disclosure, immutable citations, explicit omissions, and receipt verification.
- **Porthole outcome:** a capability-scoped evidence bundle reveals only the relevant frames,
  commands, context references, and receipt sections. Redaction, expiry, and missing evidence remain
  visible states rather than silent edits.

## Why each installs it

| Persona | Immediate value |
|---|---|
| Agent developer | Explain and reproduce a failed decision |
| Fleet operator | Correlate agents, context, receipts, and successors |
| Security/privacy | Enforce and audit pre-persistence DLP |
| CLI/TUI maintainer | Deterministic interaction tests with inspectable failure traces |
| Incident responder | Continue an investigation without lossy handoff |
| Cooperative team | Preserve divergent perspectives and shared decisions |
| Reviewer/auditor | Verify a narrow evidence bundle instead of trusting prose |

Porthole succeeds when the user can explain, continue, and test autonomous work without surrendering
every raw terminal byte to a surveillance archive.
