# 0047. Harbor Envelope Enforcement — from advisory scope to a fail-closed boundary

## Status

Accepted

## Context

ADR-0013 made the **Harbor** the universal unit of scope, security, and economy.
But the shipped implementation never enforced anything. `lib/harbors.ts` says so
in its own header:

> "Enforcement is advisory in v1 — like file claims, harbors record intent and
> enable discovery. Protocol-level enforcement (JWT capability tokens) is
> deferred to v4."

So a harbor today is a manifest, not a wall. An agent "in" a harbor can read any
path, call any tool, use any backend, publish to any channel, and spend without
limit. The operator's mental model is the opposite — they described the harbor as
*"the vacuum-sealed OS-agnostic LLM environment (filesystem, tools, skills, ports,
services)."* That is a **vision-vs-implementation gap**: the docs promise a sealed
environment; the code ships an open one.

This ADR closes the gap with the smallest honest primitive: a **harbor envelope**
— the declared resource boundary an agent operates inside while docked — and a
**fail-closed enforcement function** over it. It is the local, single-harbor face
of the same capability set that the Federated Harbor cross-realm transfer ceremony
attenuates and re-mints (`federated-harbor-whitepaper.tex` §xfer); enforcement here
is what gives "attenuate on transfer" (#189) something concrete to attenuate.

## Decision Drivers

- **Follow the bond-and-capability model.** Authority is *granted*, never assumed.
  An envelope is a capability set; an action is admitted only if the set names it.
  This mirrors `lib/bonds.ts` (a bond is an authenticated capability, not a hint).
- **Fail closed.** The failure mode of a security boundary must be *deny*. A
  missing, unset, or corrupt envelope must enforce as deny-all — never silently
  widen to allow-all. The only way to open a dimension is an explicit `'*'`.
- **Permission boundaries are shown to users.** Every verdict carries a
  `boundary` label (`filesystem` / `tools` / `skills` / `mcps` / `backends` /
  `channels` / `budget` / `membership`) so the edge can be surfaced at the moment
  it is crossed. This is the substrate #190 renders.
- **No new dependency on the unbuilt.** The envelope is plain JSON on the existing
  `harbors` row + a pure function. It does not wait on JWT capability tokens,
  cross-machine federation, or the v4 economy.

## Considered Options

- **A. Keep it advisory (status quo).** Rejected: the vision promises a sealed
  environment and the operator is building on that promise (#187 Peek runs inside
  an enforced envelope). Advisory-forever makes the harbor a comment.
- **B. Enforce via the Ed25519 Harbor Card claims only.** Rejected as the *first*
  step: tokens are the wire format for cross-realm trust, but local enforcement
  needs a value the daemon can evaluate per-action without minting/verifying a
  card on every filesystem touch. The envelope is that value; the card carries an
  attenuation *of* it (#189).
- **C. (chosen) A structured envelope on the harbor + a pure, fail-closed
  `assessEnvelope(envelope, action) → verdict` + a membership-aware
  `harbors.assertWithinEnvelope(name, agentId, action)`.** Pure core is exhaustively
  testable; the harbor method adds the membership and expiry gates; routes and the
  spawner call the method before letting an agent act.

## Decision

1. **Envelope schema** (`lib/harbor-envelope.ts`): `filesystem[]`, `tools[]`,
   `skills[]`, `mcps[]`, `backends[]`, `channels[]`, `budgetUsd: number | null`.
   Allowlists are exact-match over structured ids (not substring/keyword matching);
   `'*'` is the only wildcard. `budgetUsd: null` is unlimited; a number is a hard
   ceiling (inclusive). `parseEnvelope()` normalizes any input — missing/garbage
   collapses to deny-all (`emptyEnvelope()`), never allow-all. `OPEN_ENVELOPE` is
   the explicit opt-out.
2. **Filesystem containment** resolves both root and target to absolute form and
   rejects traversal escapes and path-prefix siblings (`/x/port-daddy-evil` is not
   inside `/x/port-daddy`).
3. **Persistence**: an idempotent `envelope TEXT` column on `harbors` (same
   migration pattern as `scope`); `getEnvelope` / `setEnvelope` on the harbors
   module; corrupt stored JSON reads back as deny-all, never "unset".
4. **Enforcement primitive**: `harbors.assertWithinEnvelope(name, agentId, action)`
   gates in order — harbor exists & not expired → agent is a docked member →
   `assessEnvelope`. Each gate returns a `boundary`-labeled verdict.
5. **HTTP surface**: `GET/PUT /harbors/:name/envelope` and a dry-run
   `POST /harbors/:name/check` that returns the verdict + boundary without acting.

## Consequences

### Positive
- The harbor becomes a real boundary; the vision and the code agree.
- #189 (cross-harbor handoff) has a concrete object to attenuate; #190 has a
  boundary label to render; #187 (Peek) can run inside an enforced envelope.
- Fail-closed-by-default means a half-configured harbor is safe, not wide open.

### Negative
- Existing harbors have no envelope → they enforce as deny-all the moment a caller
  starts *asking* `assertWithinEnvelope`. Mitigation: enforcement is opt-in per
  call site; the migration adds the column but changes no existing behavior until a
  call site adopts the check. Adoption is staged (matrix below), and an
  unconfigured harbor that wants the old behavior sets `OPEN_ENVELOPE` explicitly.

### Neutral
- The envelope is daemon-evaluated JSON now; the cryptographic binding of an
  envelope into a Harbor Card (so a remote daemon can trust it) is #189's job.

## Implementation Matrix (ADR-0043)

Phases link to `roadmap_items` at horizon `now`. Cartographer owns reconciliation.

| Phase | Scope | Roadmap item | Status |
|------|-------|--------------|--------|
| P1 | Pure envelope model + fail-closed `assessEnvelope` (+ symlink-bypass hardening) | #188 | ✅ shipped (this PR) |
| P2 | Persistence (`envelope` column, get/set) + membership-aware `assertWithinEnvelope` + tests | #188 | ✅ shipped (this PR) |
| P3 | HTTP surface: `GET/PUT /harbors/:name/envelope`, dry-run `POST /harbors/:name/check` | #188 | ✅ shipped (this PR) |
| P4 | First call-site adoption: spawner backend gate (fail-closed) + `PD_HARBOR_ENVELOPE` env propagation to the child | #188 | ✅ shipped (this PR) |
| P4b | Remaining call sites (RT-01): assert `filesystem`/`tools`/`skills`/`mcps`/`channels`/`budget` at the real surfaces (fs-claim, tool/MCP routing, channel publish, spend); fs gate uses `O_NOFOLLOW` (TOCTOU-safe). P4 enforces only `backend` today. | #188 → #190 | ⏳ next |
| P4c | Daemon-mediated enforcement (RT-02): `PD_HARBOR_ENVELOPE` is an advisory *hint* the child may ignore — the boundary must live at the daemon's resource-granting surfaces, not the child env. | #190 | ⏳ next |
| P5 | Surface the `boundary` to the operator at the crossing (permission-boundary UX) | #190 | ⏳ pending |
| P6 | Bind the envelope into the Harbor Card; attenuate on cross-harbor send | #189 | ⏳ pending |

## References

- ADR-0013 (unified harbor model), `lib/harbors.ts` (advisory-v1 header)
- `lib/harbor-envelope.ts`, `lib/bonds.ts` (capability model)
- `whitepaper/source/federated-harbor-whitepaper.tex` (§xfer attenuation)
- [[feedback_guardrails_never_advertise_bypass]] — deny messages name the boundary, not an override
