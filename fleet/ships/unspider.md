# unspider (SUPERSEDED — the role is now `lookout`)

**Status:** the contradiction-finder ambition ADR-0032 filed under the
name *unSpider* now ships as the **`lookout`** ship. See
[`fleet/ships/lookout.md`](./lookout.md) and the `lookout` block in
`pd-fleet.yml`. This file is kept as a pointer so anyone who reads the ADR
or greps for `unspider` lands on the real ship.
**ADR:** [`docs/adr/0032-unspider-contradiction-finder.md`](../../docs/adr/0032-unspider-contradiction-finder.md)
**Sibling:** [`fleet/ships/tenderfoot.md`](./tenderfoot.md) — fresh-eyes
new-developer audit, already shipping.

## What changed

The 2026-07 fleet retool built the contradiction-finder as a cloud
PR-commenting ship named **lookout** (aligned with the existing Lookout
actor — both are "spot trouble ahead"). Lookout runs on every
`pull_request:opened`, is handed the other open PRs and feature branches as
context, and alerts the operator with actionable `parley`/`roadmap`
proposals when it spots a contradiction, an ownership gap, duplication, or
newly broken UX. The ADR-0032 detail below is retained as design history;
the live behavior contract is `fleet/ships/lookout.md`.

---

## Why this file exists

The 2026-05-20 retool's first draft named a fresh-eyes UX ship
`unspider`. That collided with ADR-0032, which had already defined
**unSpider** as the contradiction-finder — a different and more
ambitious role.

The UX ship was renamed to `tenderfoot`. The ADR-0032 ship retains
its name. This stub keeps the slot reserved so:

1. A future contributor reading the ships directory finds the
   ADR pointer immediately, not a vacancy.
2. The naming collision doesn't recur — anyone tempted to name a
   new ship `unspider` discovers the prior art first.

## What ADR-0032 says, in one paragraph

unSpider is the critical half of Spider/unSpider. Where Spider
expands the map by surfacing new patterns, unSpider tightens it by
hunting contradictions, overlaps, and stale references across the
roadmap and code reality. Its detection runs structurally (no LLM)
for high-confidence cases, escalates ambiguous cases to a cheap
classifier, and uses Haiku-tier prose only for big-lane operator
escalations. Two output lanes: small findings go to the
`feedback` queue with `source='unspider'`; big findings go to
`inbox:actor:user` with an actionable recommendation. Daily cap:
$0.20.

Read the full ADR for the eight detector kinds, the
`unspider_findings` schema, the trigger model, and the build
sequence.

## What this stub does NOT do

- It does not implement unSpider. The detectors and routing live in
  the ADR; the code does not yet exist.
- It does not block tenderfoot. Tenderfoot is a separate ship with a
  separate label namespace (`tenderfoot:open`).
- It does not describe the shipped ship. The contradiction-finder now
  ships as `lookout` (see [`fleet/ships/lookout.md`](./lookout.md)), built
  in the cloud executor (`apps/fleet-executor`), not as the originally
  planned `lib/unspider.ts` detector module. <!-- cite-exempt -->

## How it actually shipped (2026-07)

ADR-0032 sketched a local detector module (archetype + schema, eight
detectors, severity routing, fleet scheduling). The role shipped instead
as the **`lookout`** cloud PR-commenting ship: it runs on every
`pull_request:opened`, is handed the other open PRs and feature branches as
context, and alerts the operator with actionable `parley`/`roadmap`
proposals when it spots a contradiction, an ownership gap, duplication, or
newly broken UX. The ADR's detector taxonomy remains useful design history
for what `lookout` looks for; the live behavior contract is
`fleet/ships/lookout.md`.

The originally planned `lib/unspider.ts` module was never built and is not planned — the cloud ship supersedes it. <!-- cite-exempt -->

This file is kept only as a redirect for anyone who greps for `unspider`.
