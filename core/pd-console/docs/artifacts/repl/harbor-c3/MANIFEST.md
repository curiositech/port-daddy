# Harbor Pane (ch18 C3) — Visual-Evidence Manifest

Per the `agent-visual-evidence-manifest` skill: every artifact below carries the
six provenance fields and an **honest source label**. No artifact here is
claimed as "LIVE": a live official Agent Node cannot exist yet, because the
daemon ledger routes (`GET /agent-nodes`, `GET /sessions/:id/events`,
`POST /agent-nodes/:id/control`) ship with work order **C1** and are absent on
the running 3.24.1 daemon — the one `real`-labeled artifact proves exactly
that failure mode rendering honestly.

These are **REPL text captures** (the same panes, terminal face — one pane, two
renderers). The GPUI screenshot/GIF/recording set is specified in the visual
artifact plan below and must be captured against a real C1 daemon before any
"live" claim ships (I0 gate).

- Binary: `pd-console-repl` built from commit `3eddaac786392638390350f868643331bab4e3f0` (branch `wave2/C3`)
- Fixture source: `core/pd-console/scripts/harbor-fixture-daemon.py` (frozen F0 v0 shapes, ADR-0095)

## Artifacts

| file | daemonPort | runId | transcriptHeadHash (sha256/16 of capture) | agentNodeId | commit | sourceLabel | state demonstrated |
|---|---|---|---|---|---|---|---|
| capture-real-roster-404.txt | 9876 (real daemon 3.24.1) | none — pre-C1, no runs exist | 9dcb19e3725df3a5 | none — roster 404 | 3eddaac78639 | **real** | roster route missing → exact cause + remediation, never blank |
| capture-fixture-roster-detail.txt | 3103 | run-cart-1 | eb32ce2cba157414 | an-cartographer-01 | 3eddaac78639 | **fixture** | active (live ●) vs historical (○) roster; conjoined detail; transcript replay incl. tool_denied; files w/ absolute paths; cost fold; successor gated w/ C6 reason |
| capture-fixture-selfreport-gate.txt | 3103 | none — no run bound | bc74781eeb48599c | an-docs-03 | 3eddaac78639 | **fixture** | witnessing invariant: claimed C4 with null probe gates as C0, every button names ADR-0095 §8 |
| capture-fixture-observed-gate.txt | 3103 | none — observed import | bac94ce0c69a1c9d | an-spark-02 | 3eddaac78639 | **fixture** | observed body: no controls, exact reason; unjoinable-transcript cause |
| capture-fixture-controls.txt | 3103 | run-cart-1 | c1079b7be57eb372 | an-cartographer-01 | 3eddaac78639 | **fixture** | interrupt/pause queued (POST ControlCommand, idempotency key); successor refused C6-vs-C4 |
| capture-fixture-stale-gate.txt | 3103 | run-qa-none | 5407c1061ba120aa | an-qa-05 | 3eddaac78639 | **fixture** | stale node: controls refused — "a stale projection never authorizes" (ADR-0095 §3) |
| capture-fixture-blocked.txt | 3103 | none | e9b28c181106c480 | an-approver-04 | 3eddaac78639 | **fixture** | blocked (waiting-for-operator) roster state, Delta flag |

State coverage vs the control-panel required set: `active` ✓, `historical` ✓,
`blocked` ✓, `stale` ✓, `gate` ✓, `interrupt` ✓, `receipt` ✗ — **receipt is
not covered**: WorkReceipt rendering is not in this C3 slice (receipt sealing
lands with the ledger/receipt chain); declared honestly rather than staged.

## Visual artifact plan (the C3 "screenshot, GIF, recording" output)

To be captured once a C1 daemon serves real Agent Nodes (labels then earn `real`):

1. **Screenshots** (via `scripts/capture-gpui.sh`, devbuild app per
   `package-console.sh --devbuild harbor-c3`): Harbor pane — populated roster w/
   selected live node; self-report gate; observed gate; stale gate; roster-404
   remediation; steer entry line open.
2. **GIF**: click roster row → detail retargets → click Steer → type → send →
   steer chip appears in control history (the closed loop).
3. **Recording (~30s)**: live node streaming (live tail under the ● header),
   operator clicks Interrupt, acknowledgement lands in control history,
   transcript shows the control echo.

Each future artifact gets a row in this table with all six fields before the
claim ships (fail-closed: an unlabeled artifact is treated as a defect).
