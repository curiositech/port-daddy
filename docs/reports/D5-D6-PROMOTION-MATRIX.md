# D5/D6 Promotion Matrix

Date: 2026-04-12
Owner: D5/D6 curation
Scope: tracked examples, tutorial source files, and reference-architecture-style docs

## Source of truth used

- Repo source only
- Routed public shell entrypoint: `website-v2/src/main.tsx`
- Canonical tutorial metadata: `website-v2/src/data/tutorials.ts`
- Tutorial source inventory: `website-v2/src/pages/tutorials/`
- Example inventory: `examples/`
- Architecture/design inventory: `docs/*ARCHITECTURE*`, `docs/*PROTOCOL*`, `docs/*STRATEGY*`, `docs/*PLAN*`

## Classification rules

- `promote now`: concrete, current enough to ship with light packaging only
- `rewrite before promotion`: valuable, but drifted on naming, routing, install path, APIs, or product truth
- `archive as aspirational`: explicitly future-state, pre-implementation, or concept material worth keeping as backlog/research
- `delete`: stale and misleading enough that rewrite cost is not justified by unique value

## Key repo-truth constraints

- The current `website-v2` router still exposes many top-level public surfaces, including tutorials. This matrix is a curation plan for a narrower future docs system, not a claim that the live router is already reduced.
- Tutorial ordering truth lives in `website-v2/src/data/tutorials.ts`. Several tutorial source files drift from that canonical numbering/titling.
- Reaching a route does not automatically make that page canonical public truth. Promotion still depends on source accuracy, wording, and fit with the target docs IA.
- Reference-architecture docs that self-identify as draft, plan, or pre-implementation are not promotable as present-tense product truth.

## Matrix

| Type | Source path | Decision | Rationale |
| --- | --- | --- | --- |
| example | `examples/coordination/file-edit-guard.ts` | promote now | Uses the real client surface, demonstrates file locking plus note/pubsub coordination, and maps directly to current operator workflows. |
| example | `examples/coordination/agent-protocol.ts` | promote now | Strong typed wrapper example over the tracked client API; useful as the cleanest coordination reference in the repo. |
| example | `examples/locks/migration-guard.ts` | promote now | Small, concrete, and operationally credible; demonstrates a real lock discipline pattern without filler. |
| example | `examples/phases/session-lifecycle.sh` | promote now | Shows session lifecycle behavior with concrete commands and clean scope; good operator-facing shell example. |
| example | `examples/ci/github-actions.yml` | rewrite before promotion | High-value CI example, but install/runtime assumptions need to be updated and aligned with current CLI/runtime truth before it can ship. |
| example | `examples/inbox/inbox-monitor.ts` | rewrite before promotion | Good pattern and real feature area, but explanation/code alignment needs cleanup before promotion. |
| example | `examples/dns/service-discovery.ts` | rewrite before promotion | Useful capability area, but it is hardwired to raw localhost HTTP and needs packaging through current shared discovery/client patterns. |
| example | `examples/integration/ready-needs.sh` | rewrite before promotion | Has some operator value, but it reads like a rough workflow fragment rather than a polished promotable example. |
| example | `examples/services/api-server.ts` | rewrite before promotion | Part of a coherent multi-service demo, but the surrounding example is explicitly toy/demo material and should be tightened before promotion. |
| example | `examples/services/frontend.ts` | rewrite before promotion | Same as above; useful only if promoted as part of a cleaned integrated example set. |
| example | `examples/services/worker.ts` | rewrite before promotion | Same as above; useful only if promoted as part of a cleaned integrated example set. |
| example | `examples/war-room/run.sh` | archive as aspirational | Good narrative energy, but it is a staged simulation rather than hard repo truth. Keep as inspiration, not as current example truth. |
| example | `examples/agent-coordination.js` | delete | Raw localhost demo with older endpoint style and high drift risk; lower-value than the newer typed coordination examples already in-tree. |
| tutorial source | `website-v2/src/pages/tutorials/GettingStarted.tsx` | rewrite before promotion | High-value topic, but it drifts on install/runtime framing and is not yet curated as canonical docs truth. |
| tutorial source | `website-v2/src/pages/tutorials/MultiAgentOrchestration.tsx` | rewrite before promotion | Strong conceptual candidate, but numbering/title alignment should follow `website-v2/src/data/tutorials.ts`, and the current page still needs curation before promotion. |
| tutorial source | `website-v2/src/pages/tutorials/Monorepo.tsx` | rewrite before promotion | Valuable area, but content/title drift needs correction before promotion. |
| tutorial source | `website-v2/src/pages/tutorials/Debugging.tsx` | rewrite before promotion | Useful topic with current operator value, but content drift and lack of canonical-docs curation block promotion. |
| tutorial source | `website-v2/src/pages/tutorials/Tunnel.tsx` | rewrite before promotion | The topic is real, but the current page still needs wording and docs-family reconciliation before promotion. |
| tutorial source | `website-v2/src/pages/tutorials/DNSResolver.tsx` | rewrite before promotion | Relevant capability, but needs current product/API review and routing decision first. |
| tutorial source | `website-v2/src/pages/tutorials/Inbox.tsx` | rewrite before promotion | Inbox is a real product area; this should survive, but only after canon/routing cleanup. |
| tutorial source | `website-v2/src/pages/tutorials/Spawn.tsx` | rewrite before promotion | Useful operator topic, but the current page is not yet curated canonical docs truth. |
| tutorial source | `website-v2/src/pages/tutorials/AlwaysOn.tsx` | rewrite before promotion | Potentially valuable, but it must be reconciled against current runtime/product wording before any promotion. |
| tutorial source | `website-v2/src/pages/tutorials/SessionPhases.tsx` | rewrite before promotion | Good topic, but same tutorial-shell drift problem. |
| tutorial source | `website-v2/src/pages/tutorials/Sugar.tsx` | rewrite before promotion | Useful command area; requires canon/routing cleanup first. |
| tutorial source | `website-v2/src/pages/tutorials/Dashboard.tsx` | rewrite before promotion | The public shell and control-plane surface moved; any dashboard tutorial must be rewritten against current docs shell truth. |
| tutorial source | `website-v2/src/pages/tutorials/TimeTravel.tsx` | rewrite before promotion | Likely salvageable as documentation, but not yet canonical docs truth. |
| tutorial source | `website-v2/src/pages/tutorials/Pipelines.tsx` | rewrite before promotion | Valuable topic if product-supported, but not promotable in the current tutorial surface. |
| tutorial source | `website-v2/src/pages/tutorials/Watch.tsx` | rewrite before promotion | Same issue: worthwhile area, not current public-shell truth. |
| tutorial source | `website-v2/src/pages/tutorials/Fleet.tsx` | rewrite before promotion | Strong topic and likely one of the first to rescue, but it hardcodes localhost hook examples and is not yet curated into the canonical docs system. |
| tutorial source | `website-v2/src/pages/tutorials/Pheromone.tsx` | rewrite before promotion | Good concept and likely marketable, but it overstates maturity as a finished tutorial and still needs canonical-docs curation. |
| tutorial source | `website-v2/src/pages/tutorials/Harbors.tsx` | archive as aspirational | Harbor tutorial content materially drifted from current token/runtime truth and should not be promoted without deeper protocol reconciliation. |
| tutorial source | `website-v2/src/pages/tutorials/RemoteHarbors.tsx` | archive as aspirational | Explicitly future-state/planned material; keep as backlog input, not public truth. |
| tutorial source | `website-v2/src/pages/tutorials/SemanticIdentities.tsx` | delete | Not present in canonical tutorial metadata; whatever value remains should be folded into a real docs section instead of kept as an orphan tutorial. |
| reference architecture | `docs/MULTI-ENTRY-STRATEGY.md` | rewrite before promotion | Still useful as a product/docs strategy source, but it needs current agentsd shell truth and route discipline before promotion. |
| reference architecture | `docs/DAEMON-MESH-ARCHITECTURE.md` | archive as aspirational | Self-labeled pre-implementation design document; keep as future architecture research only. |
| reference architecture | `docs/FLEET-CSP-PROTOCOL.md` | archive as aspirational | Draft protocol thinking with historical agent ecosystem assumptions; not current implementation truth. |
| reference architecture | `docs/IPC-PROTOCOL-DESIGN.md` | archive as aspirational | Explicit design proposal with no code backing; useful as backlog input, not promotable reference truth. |
| reference architecture | `docs/MERGE-INFRASTRUCTURE-PLAN.md` | archive as aspirational | Future infrastructure plan, not reference architecture for current promotion. |
| reference architecture | `docs/SITE-ARCHITECTURE-PLAN.md` | delete | Large stale IA plan that no longer matches the current routed shell; keeping it as if live truth increases entropy. |

## First five examples to promote

1. `examples/coordination/file-edit-guard.ts`
2. `examples/coordination/agent-protocol.ts`
3. `examples/locks/migration-guard.ts`
4. `examples/phases/session-lifecycle.sh`
5. `examples/ci/github-actions.yml`

## First three tutorials/reference-architectures to promote

These are the first three worth rescuing into promotable material, not the first three that are already ship-ready.

1. `website-v2/src/pages/tutorials/MultiAgentOrchestration.tsx`
2. `website-v2/src/pages/tutorials/Fleet.tsx`
3. `docs/MULTI-ENTRY-STRATEGY.md`

## Promotion order notes

- Rescue examples first. They are closer to current repo truth than the tutorial surface.
- Do not promote any tutorial as public truth until either:
  - the content is explicitly curated as canonical docs truth within the tutorial surface, or
  - the content is converted into the current `/docs/*` information architecture.
- Do not promote any architecture/protocol document that describes future-state behavior in present tense.
- If a stale document has no unique value beyond what newer docs/examples already cover, delete it instead of rewriting it.
