# Phone-Integration Master Plan

**Status**: Living document.
**Branch**: `claude/phone-integration-patterns-fU7Hi` (rebased onto main `39bf040`).
**Skills applied**: `skill-architect`, `pd-relay-zero-trust`, `ideal-web-app-builder`.
**Date opened**: 2026-04-26.

This is the **phone-integration synthesis layer**. It deliberately does NOT
re-do website rehab work that already has an approved plan in flight. It
sequences the phone-integration / relay tracks and shows where each milestone
needs surface in `website-v2`, deferring all website-rehab decisions to the
authoritative document.

## Authoritative web-app references (do not duplicate)

- `docs/plans/port-daddy-website-ideal-web-app-rehab.md` — the approved web-app
  rehab plan. Visual decision board approved 2026-04-26. Build / tests / lint /
  storybook gates passing. Direction chosen ("signal-grade infrastructure
  editorial"). All website rehab activity is governed there.
- `docs/plans/port-daddy-website-visual-decision-board.md` — the approved
  visual decision board.
- `skills/ideal-web-app-builder/` — the contract producing the above.

If a phone-integration deliverable needs website surface, file the website
piece as a slice in the rehab plan, not here. This plan owns the relay /
crypto / CLI / SDK side of the work.

## Honest time estimate

This is **multi-month** work. Per `ideal-web-app-builder` Operating Rules:
*"Say plainly when the work needs multiple complete sessions, agents, or
days."*

Realistic shape:
- Weeks 1-2: foundations (PKI deliberation, `pd tube`, button-click demo,
  cookbook nav surface)
- Weeks 3-6: relay v0 (Cloudflare Worker + DO), Merkle lib, Phase 3
  attenuation
- Weeks 7-10: VS Code extension, test reporters, GIF CI pipeline,
  cookbook/examples completeness
- Weeks 11-14: ProVerif extension, V4 redefinition, beta program for relay
- Weeks 15+: public launch, blog series, open-source publishers SDK

## Substrate already on disk (this branch)

- `skills/pd-relay-zero-trust/` — full skill: 13 references, 6 schemas, 8
  scripts, 6 templates, 4 examples, 4 subagents (acme-specialist + proponent
  / pragmatic / antagonist), OpenAPI surface. `validate_skill.py` exits 0.

## Tracks

### Track A — Decisions (blockers)

**A1. PKI choice (ADR-0021)**
Owner: human-led deliberation using `skills/pd-relay-zero-trust`.
Process:
1. `python3 scripts/pki_decision.py --selftest` baseline scoring
2. Dispatch `agents/proponent.md`, `agents/pragmatic.md`, `agents/antagonist.md`
3. Consult `agents/acme-specialist.md` if ACME is in contention
4. Synthesize into `templates/ADR-PKI-Decision.md` → `docs/adr/0021-pki-decision.md`
Effort: ~1 deliberation session.
Blocks: A4 (Relay v0). Does NOT block A2, A3, A5, A6.

### Track B — Relay-independent primitives (parallel)

**B1. `pd tube` CLI primitive**
Owner: dev.
Output: `cli/commands/tube.ts`, `lib/tube.ts`, stdin-based `--reply`, history
guard, tests.
Effort: ~2-3 days.
Independent of relay; works against local PD daemon today.

**B2. Merkle event chain library**
Owner: dev.
Output: `lib/merkle-chain.ts` (`next_hash`, `verify_chain`, `sign_head`,
`verify_head`), golden vectors, cross-language compat doc.
Effort: ~1 week.
Pure functions; lands before relay.

**B3. Button-click HTML demo**
Output: `examples/button-click-demo/` (HTML + README); recorded GIF deferred to
GIF-CI work in the website rehab plan.
Effort: ~half-day.
Depends on B1 shipping.

### Track C — Relay v0 (after A1)

**C1. ADR-0022 Relay Architecture**
Use `templates/ADR-Relay-Architecture.md`. Lands as `docs/adr/0022-relay-architecture.md`.

**C2. Relay implementation**
- `lib/relay-envelope.ts` (pure-fn wire format)
- Cloudflare Worker + DO scaffolding
- Identity registry per A1's PKI choice
- `lib/relay-client.ts` outbound-only daemon SSE client
Effort: ~3-4 weeks initial.

### Track D — Publishers SDK (after B1)

**D1. VS Code extension (`port-daddy-vscode`)**
Selection-based publish, right-click "Ask Claude about this", diagnostic-reactive
publish, subscribe to `editor:reply:<id>` for inline rendering.
Effort: ~1 week. Separate repo.

**D2. Test runner publishers**
- `@port-daddy/jest-reporter`
- `port-daddy-pytest`
Both publish on first failure to `test:failed`.
Effort: ~3-4 days each; parallelizable.

### Track E — Hardening (after Tracks B + C)

**E1. Phase 3 attenuation in production code**
Promote `scripts/attenuate_card.py` algorithm to `lib/`; OIDC exchange endpoint
on relay if A1 chose OIDC/Hybrid; GH Actions integration walkthrough lifts
`examples/attenuation-walkthrough.md`.

**E2. ProVerif extension**
Copy `templates/proverif-relay.pv` into `analyses/relay-handshake.pv`. Fill in
queries from `references/proverif-relay-extension.md`. Run; iterate until I1 +
authentication pass.

**E3. ADR-0023 V4 Remote Harbor Redefinition**
Use `templates/ADR-V4-Remote-Harbor-Redefinition.md`. Update `V4-DAG.md`,
`v4.dag.yaml`, `V4-MASTER-PLAN.md`, `README.md`. Implement `pd harbor share` /
`pd harbor join`.

### Track F — Authority surfaces (handed off to website rehab plan)

For each milestone above, the documentation/tutorial/blog/GIF deliverables are
filed as slices in the **authoritative web-app rehab plan**, not here. Examples:

| Phone-integration milestone | Website surface (filed in rehab plan) |
|----------------------------|----------------------------------------|
| `pd tube` ships | tutorial page, GIF, examples link |
| Button-click demo | live demo / static recording in `/examples` |
| Relay v0 | docs section, OpenAPI page, threat-model page |
| Merkle event chain | docs primitive page, math/diagram authoring |
| Phase 3 attenuation | tutorial, GH Actions integration page |
| VS Code extension | landing page, install instructions, demo |
| Test reporters | dedicated page per stack |
| ProVerif extension | whitepaper / docs / "what we proved" page |
| V4 redefinition | V4 roadmap page update; old Part XVII content removed |

The pattern: this plan ships the *primitive* (CLI / lib / extension); the
website rehab plan ships the *surface* (token-disciplined, accessible,
storybooked tutorial/page/blog).

## What this session executed

This session lands:

1. ✅ The skill `pd-relay-zero-trust` (committed earlier; comprehensive L2/L3
   depth, schemas, scripts, templates, examples, OpenAPI, four subagents).
2. ✅ This master plan on disk.
3. ✅ A small reversible nav fix: `/examples` and `/cookbook` are now linked
   from the **Get Started** dropdown (both were orphaned routes; users had no
   path from nav).
4. ✅ README pointer fix: clarifies that two recipe surfaces exist today
   (`/examples` short patterns by primitive; `/cookbook` long-form recipes),
   notes that consolidation is a future decision in the rehab plan, marks the
   "Agentic Escrow" and "The Brig" patterns as planned not shipping.

Everything in Tracks A-F is future work, sequenced and dependency-tracked.

## Update log

- 2026-04-26 — Plan opened; first session work landed; superseding earlier
  duplicate intake + decision board files (those were duplicates of the
  approved authoritative rehab plan).
