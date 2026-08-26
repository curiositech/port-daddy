# Mission Control GPUI Graft Map

The web lab is disposable. The contracts below are the intended cargo. ReactFlow, DOM layout, and browser transport helpers must not leak into the Rust product architecture.

## Portable contracts

| Contract | Lab proof | GPUI graft target |
|---|---|---|
| Objective-first hierarchy | Request, metrics, decision, graph, inspector, then event history | Mission detail composition and focus order |
| Digest with zoom | Node summary opens in one click; receipt or verbatim trace is one more click | Node selection state plus evidence drawer; canonical target is artifact/receipt, never agent narration |
| Provenance taxonomy | `live`, `recorded`, `fixture`, `unknown`; unknown is never green | Rust enum and exhaustive style mapping; carry provenance on every aggregate and event |
| DAG semantics | Stable node ID, wave, dependencies, critical flag, kind, evaluation, conundrum | Graph model independent of rendering engine; topological layout can remain a view concern |
| Runtime state machine | queued → running → success/error/cancelled; blocked is explicit; terminal is immutable until resume | Mission reducer with typed transitions and named authority events |
| Stream envelope | v1 discriminator, monotonic sequence, cursor, idempotency key, node ID, provenance, timestamp, payload | Serde-tagged event enum and cursor checkpoint persisted outside the view |
| Recovery semantics | Partial-frame accumulation, malformed-frame isolation, reconnect from last cursor, bounded replay, duplicate suppression | Daemon/client stream reader with a capped ring buffer and explicit replay-gap event |
| Backpressure | Pending cap of 24 and replay cap of 160; dropped count remains visible | Bounded channel and operator-visible lag/drop telemetry; no silent unbounded queue |
| Operator controls | Reprioritize, launch/resume, interrupt, cancel, and decision resolution are distinct actions | Typed commands with receipts; cancellation must end in a terminal event rather than optimistic disappearance |
| Render isolation | Topology is immutable between fixture changes; runtime update preserves untouched node references | Per-node entity state and targeted GPUI invalidation; topology layout only on structural change |
| Motion/accessibility | Motion conveys execution, but reduced motion removes translation/pulse without removing status | Respect macOS Reduce Motion; retain textual status, sequence, and critical-path treatment |
| Performance fixtures | Deterministic 50/100/200 graphs and measured layout/serialization budgets | Shared fixture schema for Rust benchmarks and screenshot harnesses |

## Web-only implementation details

- `@xyflow/react`, its handles, viewport culling, fit controls, control chrome, and SVG edge animation.
- Zustand selectors and React memoization. Preserve the state-isolation outcome, not these libraries.
- CSS custom properties, media queries, DOM focus selectors, and system-font fallbacks.
- The `setInterval` fixture player and browser `performance.now()` display.
- The JavaScript SSE parser implementation. Preserve its contract tests and edge cases when porting, not its code shape.
- Playwright screenshot/video mechanics and Vite packaging.

## Graft sequence

1. Port the data enums and event envelope into a renderer-neutral Rust module with fixture decoding tests.
2. Implement the reducer and bounded cursor replay independently of GPUI; prove duplicate and replay-gap behavior.
3. Add the objective strip and graph/inspector selection contract to GPUI using deterministic 18-node fixtures.
4. Add targeted node invalidation and benchmark 50/100/200 fixtures before execution motion.
5. Wire real daemon receipts and artifact locators. Until then, keep the entire surface labeled fixture.
6. Add visual proof in dark/light and macOS Reduce Motion, then compare behavior rather than pixels with this lab.

## Rejected grafts

- No WebSocket merely to mirror the lab. SSE is sufficient for ordered server-to-operator events; commands use request/receipt paths.
- No “all green” aggregate when checks did not run. `unknown` and `not evaluated` remain separate from success.
- No chain-of-thought as canonical evidence. Streamed thinking is a labeled self-report; tests, diffs, receipts, and artifacts remain the zoom targets.
- No web compatibility shim inside `core/pd-console`. The GPUI implementation should own native types and interaction behavior directly.
