<!-- RETIRED-BY: ADR-0126 -->
> ## ⚓ Retired — superseded, kept as history
>
> **Superseded by [ADR-0125 — iOS Operator Surface](../adr/0125-ios-operator-surface.md)**
> (the phone surface as actually built: native SwiftUI, HITL-first) and by
> [`docs/proposals/relay-grand-plan.md`](../proposals/relay-grand-plan.md)
> (the relay tracks, sequenced).
>
> This plan promised to update `V4-DAG.md` and `v4.dag.yaml` and never did,
> which is part of why those two are retired alongside it.
>
> **Authority:** [ADR-0126 — Shared-Harbors Re-sequencing](../adr/0126-shared-harbors-resequencing.md), § Formal supersessions.
> This document is retained deliberately: the 2026-06-05 operator rule is
> demote by default, delete only a merged twin. Read it for the reasoning
> that was current when it was written, not for what to build now.

---

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

**A1. PKI choice (ADR-0025)** — ✅ **DECIDED 2026-04-27**
Outcome: **OIDC-first hybrid, phased.** v0 ships OIDC (GitHub Actions issuer) + `--auth-mode=wot` escape hatch; v1 adds ACME (DNS-01 on a self-hosted `step-ca`); v2 adds self-hosted OIDC issuers + BYO-domain ACME. Default-weight scoring produced an exact tie (OIDC=153, Hybrid=153); tie broken by reversibility + master-plan timeline. See [`docs/adr/0025-pki-decision.md`](../adr/0025-pki-decision.md). Honest disclosure on deliberation pattern in §Deliberation Summary of the ADR.
Owner: human-led deliberation using `skills/pd-relay-zero-trust`.
Process (executed):
1. `python3 scripts/pki_decision.py --selftest` baseline scoring
2. Dispatch `agents/proponent.md`, `agents/pragmatic.md`, `agents/antagonist.md`
3. Consult `agents/acme-specialist.md` if ACME is in contention
4. Synthesize into `templates/ADR-PKI-Decision.md` → `docs/adr/0025-pki-decision.md`
Effort: ~1 deliberation session.
Blocks: C1/C2 (Relay v0). Does NOT block B1, B2, D, E2.
Walkthrough: [`skills/pd-relay-zero-trust/examples/oidc-bootstrap-walkthrough.md`](../../skills/pd-relay-zero-trust/examples/oidc-bootstrap-walkthrough.md).

### Track B — Relay-independent primitives (parallel)

**B1. `pd tube` CLI primitive** — ✅ **SHIPPED 2026-04-27**
Owner: dev.
Output: `cli/commands/tube.ts`, `lib/tube.ts`, stdin-based `--reply`, history
guard, tests.
Effort: ~2-3 days. Actual: one focused agent session.
Surface (verified): `pd tube <channel> [--listen|--once|--since=<id>|--limit=N|--no-history|--send|--reply=<id>]`. JSON-line stdout, file-based history guard at `~/.port-daddy/tube-history-<safe-channel>.json`, atomic via tmp+rename. 26/26 unit tests pass. Wired into bash/zsh/fish completions and `features.manifest.json`.
Independent of relay; works against local PD daemon today; envelope ships unchanged onto the future relay.
Walkthrough: [`skills/pd-relay-zero-trust/examples/pd-tube-tutorial.md`](../../skills/pd-relay-zero-trust/examples/pd-tube-tutorial.md).

**B2. Merkle event chain library** — ✅ **SHIPPED 2026-04-27**
Owner: dev.
Output: `lib/merkle-chain.ts` (`next_hash`, `verify_chain`, `sign_head`,
`verify_head`), golden vectors, cross-language compat doc.
Effort: ~1 week. Actual: one focused agent session.
540-line pure-function TS library using `node:crypto` Ed25519 (no new deps); 29/29 unit tests pass; byte-for-byte cross-language compatible with the Python reference scripts (`scripts/chain_verify.py`, `scripts/chain_anchor.py`) — verified end-to-end. Golden vectors at `tests/fixtures/merkle-chain-golden.json`. Cross-language compat doc at [`docs/merkle-chain-compat.md`](../merkle-chain-compat.md).
Pure functions; lands before relay.
Walkthrough: [`skills/pd-relay-zero-trust/examples/merkle-chain-typescript-tutorial.md`](../../skills/pd-relay-zero-trust/examples/merkle-chain-typescript-tutorial.md).

**B3. Button-click HTML demo**
Output: `examples/button-click-demo/` (HTML + README); recorded GIF deferred to
GIF-CI work in the website rehab plan.
Effort: ~half-day.
Depends on B1 shipping.

### Track C — Relay v0 (after A1)

**C1. ADR-0026 Relay Architecture**
Use `templates/ADR-Relay-Architecture.md`. Lands as `docs/adr/0026-relay-architecture.md`.

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
Copy `templates/proverif-relay.pv` into `apps/relay/formal/proverif/relay-handshake.pv`. Fill in
queries from `references/proverif-relay-extension.md`. Run; iterate until I1 +
authentication pass.

**E3. ADR-0027 V4 Remote Harbor Redefinition**
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

## Subsequent session (2026-04-27): Tracks A1, B1, B2 shipped

In one parallel-agent session:

5. ✅ **Track A1 — ADR-0025 (Relay PKI Decision)**: OIDC-first hybrid landed at
   [`docs/adr/0025-pki-decision.md`](../adr/0025-pki-decision.md). Numbers
   renumbered from 0021 → 0025 (cross-refs bumped throughout the skill) because
   0021/0022/0023 were already taken by bosun-consolidation /
   durable-actor-souls / cartographer-roadmap, and 0024 was claimed by
   daemon-profiles mid-session.
6. ✅ **Track B1 — `pd tube` CLI primitive**: shipped at `cli/commands/tube.ts`
   + `lib/tube.ts` + 26 unit tests + completions wiring + manifest entry.
7. ✅ **Track B2 — Merkle event chain library**: shipped at `lib/merkle-chain.ts`
   + 29 unit tests + golden-vector fixture + cross-language compat doc at
   `docs/merkle-chain-compat.md`. Verified byte-for-byte against the Python
   reference scripts.
8. ✅ **Long-form tutorials** for each: `examples/pd-tube-tutorial.md`,
   `examples/merkle-chain-typescript-tutorial.md`,
   `examples/oidc-bootstrap-walkthrough.md` — all under
   `skills/pd-relay-zero-trust/examples/`.
9. ✅ **Repo bug fix** discovered along the way: `lib/resolver.ts:setup()` was
   refusing to modify ANY hosts file path under root, breaking three resolver
   unit tests in CI sandboxes (which run as root) even when the test pointed
   `hostsFilePath` at a tempfile. Scoped the root check to actual `/etc/hosts`.
   Confirmed pre-existing on `origin/main` HEAD before fixing.

Tracks B3 (button-click HTML demo), C1/C2 (Relay v0 ADR + impl), D1/D2
(Publishers SDK), and E1/E2/E3 (Hardening) remain future work.

## Update log

- 2026-04-26 — Plan opened; first session work landed; superseding earlier
  duplicate intake + decision board files (those were duplicates of the
  approved authoritative rehab plan).
- 2026-04-27 — Tracks A1, B1, B2 shipped in one parallel-agent session, plus
  long-form tutorials and the resolver root-check bug fix. PR #5 updated;
  Copilot review (13 threads) responded to in a single PR comment per the
  team's review-frugality convention.
