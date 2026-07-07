# ADR-0098: Cloud Fleet as an Agentic App — Operator HITL Surface

**Status:** Proposed (2026-07-07)

## Context

The Port Daddy cloud fleet (model-agnostic ships on Cloudflare Workers AI) reviews
PRs, proposes ideas, and spots trouble. Its output has been surfacing ad hoc — PR
comments, GitHub issues — with no coherent operator surface and no human
checkpoint before consequential action. The operator asked for: (1) reusable,
model-agnostic cloud agents; (2) PRs authored by a **fleetbot** bot identity, not
by the operator; (3) fleetbot output either vetted-and-actioned by an agent or
funneled into a HITL "top of stack" queue the operator sees in FleetBar /
pd-console.

We ran the fleet through the five-axis `agentic-app-architecture` skill audit at
both shipped-today and design-target state.

## Audit result

| Axis | Shipped today | Target |
|------|--------------|--------|
| transparency | 85 | 100 |
| state/memory | 100 | 100 |
| context/caching | 85 | 100 |
| capabilities | 100 | 100 |
| execution | **40 — FAIL** | 100 |
| **verdict** | **pass=false** | **pass=true** |

**One critical finding:** `no-human-gate-on-side-effects`. The fleet posts, files
issues, and (via auto-deploy) affects merges with no operator checkpoint. That
gap *is* the deferred HITL architecture. Two mediums: `no-prompt-caching` and
`no-plan-before-act`.

State/memory scores 100 because the D1 `fleet_ideas` store (ADR-linked to the
idea-intake dedup, cosine ≥ 0.92) is real episodic memory — salient ideas promoted
out of the transcript, recallable by relevance.

## Decision

Treat the cloud fleet as an agentic app and build to the target across five axes,
with the operator surface designed by distance-from-work.

1. **Transparency** — thinking + tool use are the D1 transcript
   (`fleet_runs`/`fleet_run_steps`), rendered in pd-console's Cloud Fleet pane;
   interruptible via the kill-switch (`fleet:paused`). Fleetbot PRs open as
   **drafts** carrying intent (the plan) before going ready.
2. **State/memory** — durable, idempotent-by-`deliveryId` transcript; episodic
   memory in `fleet_ideas`.
3. **Context/caching** — MAP-REDUCE chunking + `max_tokens` bound the window;
   **Workers AI prefix caching** via a stable per-ship `x-session-affinity` key.
4. **Capabilities** — tools + skills; secrets are Worker secret bindings
   (`secret-store` custody), never argv/transcript; lean MCP core.
5. **Execution** — coding agent; worktree isolation on the write path; receipts
   = transcript + PR + issues + checks. **Add the human gate: the HITL queue +
   gated fleetbot-authored PRs.**

**Operator-surface authority (placement):**
- **`ambient` → FleetBar:** the top-of-stack queue — a glance-decision inbox of
  fleetbot outputs (HIGH finding, captured idea, degraded run, PR-ready).
  Approve / dispatch / dismiss render **only where the daemon/relay can enforce**.
- **`deep` → pd-console:** full evidence (PR diff, failure trace, idea
  similarity). FleetBar **deep-links in**; it never grows a diff viewer in a
  popover.
- **Exactly one owner per action; the relay/daemon is the single source of truth;
  no surface caches authority.**

**Fleetbot PR authorship:** a GitHub App **bot identity**, not the operator. One
PR = one change; evidence-backed Test Plan; correct gate triage (**Cloudflare
Pages preview is advisory, never blocks**); draft until required gates green; land
through the merge queue; never force-push or `--admin` past a real gate. Operator
authority = the final approve + HIGH/critical findings → named fixups.

**Shared contract:** the queue's actions (`approve`/`deny`/`dispatch`/`dismiss`/
`merge`) are defined **once** and exposed identically across GUI (FleetBar/
pd-console), CLI (emergency lane), and API. MCP is one adapter, not the truth.

**Model-agnostic:** each ship's `backend:` + `fallbacks:` preference list is the
model-router seam; the executor resolves per-ship. Model-agnostic by config, on
Cloudflare.

## Consequences

- The critical gate closes only when the HITL queue + gated fleetbot PRs ship.
  Until then the fleet stays advisory-only (comments/issues), never
  self-merging — the fail-safe posture.
- Build order (severity-first): **cost** (qwen3-30b canary + `x-session-affinity`
  caching + surface gates + docs-only routing — clears `no-prompt-caching`) →
  **telemetry/failure** (feeds the queue's degraded-run items) → **HITL queue +
  fleetbot authorship** (clears the critical) → polish (drafts-with-plan, rename).
- Adversarial note (antagonist voice): a queue whose approve/deny renders where
  the daemon can't enforce it is theater — the daemon-enforceability gate is a
  hard requirement, not a nicety.

Roadmap-Spawns: fleet-hitl-operator-queue, fleetbot-pr-authorship, fleet-cost-canary
