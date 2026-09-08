---
name: status-attestation-split-plane
description: >-
  Audit or design a status/health surface so it does not share fate with the system it
  describes and cannot quietly attest to itself: split read plane (independently deployed
  reporter + dead-man switch), three-valued verdicts (healthy/degraded/unknown — never
  green-by-default), external anchoring of any "tamper-evident" status chain, and the
  availability-inversion check (no client may hard-gate on the monitor). Use when adding a
  status page, deep-health endpoint, reachability verdict, or signed incident ledger to a
  service — especially the service every client depends on — or when reviewing a design
  where the system signs, serves, and stores its own health claims. Keywords: shared fate,
  self-attestation, status page dies with the service, dead-man switch, three-valued
  health, external anchor, availability inversion, tamper-evident theater. NOT for finding
  missing telemetry emit sites (use observability-absences-audit), building dashboards or
  alert rules (use grafana-dashboard-builder / monitoring-stack-deployer), or log/metric
  implementation mechanics (use logging-observability, structured-logging-design).
license: Apache-2.0
allowed-tools: Read,Grep,Glob,Write,Edit
metadata:
  category: Observability & Reliability
  tags: [status-page, health-checks, shared-fate, attestation, dead-man-switch, slo]
  provenance:
    kind: first-party
    owners:
      - port-daddy
  pairs-with:
    - skill: observability-absences-audit
      reason: That skill finds the signals a service should emit and doesn't; this skill decides where the resulting status surface may live and who is allowed to believe it.
    - skill: pd-relay-zero-trust
      reason: Supplies the Merkle-chain and external-anchoring primitives (ADR-0049 I2) that upgrade a status ledger from self-attested to externally verifiable.
    - skill: circuit-breakers-and-retries
      reason: Once a verdict exists, breaker behavior on `degraded`/`unknown` must degrade rather than brick — that skill covers the client-side mechanics.
  io-contract:
    kind: deliverable
    consumes:
      - { kind: status-surface-design, format: markdown }
    produces:
      - { kind: split-plane-audit, format: markdown }
---

# Status Attestation Split Plane

A status surface exists to be believed when the system is broken. Most are built so
they can only be believed when the system is fine. This skill audits the four traps
that make a health surface a lie exactly when it matters, and prescribes the shapes
that survive.

## Use This For

- Adding a status page, `/health`-beyond-liveness endpoint, reachability verdict
  (e.g. "remote harbors: possible/impossible"), or signed incident ledger to any
  service — above all, to *the* shared service every client hits.
- Reviewing a design where the same process signs, serves, and stores its own health
  claims ("the Merkle chain proves we didn't edit the outage history" — chained by
  whom, anchored where, verified by whom?).
- Deciding what a client (mobile app, daemon, CLI) is allowed to do with a health
  verdict — gate, degrade, or ignore.
- Writing the SLO page for a product whose sales pitch includes its own reliability.

## Do Not Use This For

- Hunting missing emit sites, dead enums, or absent requestIds — `observability-absences-audit`.
- Dashboard/alert-rule construction — `grafana-dashboard-builder`, `monitoring-stack-deployer`.
- Log line and metric implementation mechanics — `logging-observability`, `structured-logging-design`.

---

## The Four Traps

### Trap 1 — Shared fate: the status page dies with the patient

If the reporter runs in the same process, deployment, database, or control plane as
the monitored system, its most informative output — silence — is indistinguishable
from "nobody looked." A hospital ship moored to the sinking vessel.

**The fate ladder.** Classify every component of the status path (probe, storage,
renderer, alert delivery) by what it shares with the monitored system:

| Level | Shares | Example | What its silence means |
|---|---|---|---|
| F0 | same process | `/health` handler in the app worker | nothing — silence is ambiguous |
| F1 | same deployment unit | cron in the same Worker/service | nothing during deploys/outages of that unit |
| F2 | same platform/control plane | second Worker on the same cloud, same D1 | platform-wide outage still mutes it |
| F3 | independent platform, dead-man wired | external health checker + PagerDuty dead-man | silence itself pages |

**Rule:** the *probe* may live at F0–F2 (it must touch the real dependencies, so
proximity is a feature), but the *report renderer* must be ≥F2 with its own deploy
lifecycle, and at least one *silence detector* must be F3. A dead-man switch —
"absence of heartbeat is the page" — is the only honest answer to "what if the
monitor is down"; anything else is an unmonitored monitor.

**Audit greps** (locators, not verdicts — read the surrounding code):
`grep -rn "handleHealth\|/health"` — does it touch any dependency, or return a
constant? `grep -rn "scheduled(\|cron"` — do probes share the monitored deployment?
Does any config reference an external checker with a dead-man/heartbeat contract?

### Trap 2 — Green-by-default: two-valued verdicts

A boolean health verdict has a forced-error problem: when the probe itself cannot
run, the implementation must pick `ok` or `down`, and both are lies. Every verdict in
the system must be **three-valued**: `healthy | degraded | unknown`, where `unknown`
means "the examination did not happen," is rendered distinctly (never as green, never
as red), and is produced *by construction* whenever a probe times out, throws, or is
skipped — not by a default branch that falls through to `ok`.

Per-dependency verdicts compose upward with `unknown` as absorbing for confidence,
not for severity: `healthy ∧ unknown = unknown-leaning-healthy` (show last-known-good
with age), never plain `healthy`.

**Audit:** find every place a health struct is initialized. If the zero value is
`ok`/`true`, the surface is green-by-default. Find every catch around a probe: does
it record `unknown`, or swallow into the previous value?

### Trap 3 — Self-attestation: tamper-evident theater

A hash-chained, signed incident ledger stored and served by the vendor it describes
is tamper-evident **only to someone holding an external copy of the chain head**.
Without an anchor, "we cannot quietly edit our status history" is a claim the vendor
verifies about itself — theater.

**The attestation ladder** — label every status artifact with its rung, publicly:

- **A0 self-reported:** JSON from the service. Trust: full trust in the service.
- **A1 self-signed:** signed by the service's key. Adds nothing against the service
  editing its own history; protects only against third-party tampering in transit.
- **A2 chained:** hash-chained ledger. Detects *internal* inconsistency; still
  rewritable wholesale.
- **A3 externally anchored:** chain head periodically published to a place the
  vendor cannot silently rewrite (public git repo commit, DNS TXT, transparency log,
  a customer-side subscriber that stores heads). Rewrites now require detectable
  divergence.
- **A4 externally verified:** some party *actually checks* anchors against served
  history (a CI job in the OSS repo, customer daemons comparing heads — e.g. gossip
  chain-head "beacons" where clients republish the signed heads they saw).

**Rule:** anchor (A3) ships in v1 of any chained status ledger, not "later" — an
unanchored chain accumulates history that can be rewritten right up until the day
anchoring starts, which is precisely the history an incident would motivate
rewriting. And name a verifier (A4) or admit the rung is A3.

Second self-attestation channel: **quorum for outside-in probes.** If clients report
their observed vitals (every daemon a probe), one lying reporter must not fake or
mask an outage — weight by quorum across independent reporters, and keep reporter
aggregation k-anonymous if reporters are tenants (see `derived-index-consent-boundary`
for the tenancy side of that pipe).

### Trap 4 — Availability inversion: the monitor becomes the SPOF

The moment a client *hard-gates* on the health verdict ("app shows nothing until the
status service answers"), the status plane's availability bounds the product's
availability — the hospital ship now runs the port. Inversion smells: a splash screen
blocking on the status fetch; `unknown` treated as `impossible`; retry storms against
the status endpoint during its own outage; a kill-switch read that fails closed for
*reads* (kill switches should fail closed for dangerous *writes*, open for reads).

**Rule:** verdicts **inform degradation, never gate existence.** On `unknown`:
cached last verdict + age + retry with jitter, full local functionality preserved.
Hard gates are permitted only on `impossible` *with machine-readable reasons the
client renders* — and even then only for the specific capability that is impossible,
not the app. Corollary (Goodhart): if a verdict gates anything commercially visible,
there is pressure to keep it green — which is why Trap 3's anchoring and quorum
measurement must already be in place before any verdict gains gating power.

---

## Design Prescription (greenfield shape)

1. **Deep probe endpoint** in the monitored service (F1): exercises each real
   dependency (DB `SELECT 1` + hot-table head, KV/config read, a synthetic
   end-to-end round-trip through the real delivery path with latency measured), and
   any SLO the architecture has already committed to in writing — search ADRs for
   promised SLOs (e.g. "revocation propagation ≤ 5s") and probe them; a committed,
   unmeasured SLO is the highest-signal gap.
2. **Sample store** with retention (7d ephemeral tier) + **incident ledger**
   (durable, chained, anchored A3 on day one).
3. **Split reporter** (≥F2): separate deploy unit rendering the report; signed;
   pushed to client surfaces over the channel clients already hold (don't add a
   poll).
4. **F3 dead-man**: external checker whose *silence* pages.
5. **Three-valued verdicts** end to end, `unknown` distinct in every renderer.
6. **Client contract** written down: per verdict value, what each client does —
   with "hard-gate" appearing only under `impossible`, per-capability.
7. **The monitor's own footprint** budgeted and self-monitored (probe cost, sample
   write amplification, dedup governor so a sustained breach logs once per window).

## Review Checklist (emit as the audit)

For each item: PASS / FAIL / N/A + evidence (file:line or design-doc quote).

- [ ] Fate ladder mapped for probe, store, renderer, alerting; renderer ≥F2; one F3 silence detector exists.
- [ ] No verdict is boolean; `unknown` is constructible, rendered distinctly, and produced on probe failure by construction.
- [ ] Every "tamper-evident" claim carries an attestation rung; chains are A3-anchored from v1; a named verifier exists or the rung is stated as A3.
- [ ] Outside-in reporter input is quorum-weighted; a single reporter cannot flip the aggregate.
- [ ] No client hard-gates on `unknown`; hard gates only on `impossible`, per-capability, with rendered reasons.
- [ ] Every SLO already promised in an ADR/contract has a probe; the SLO page lists owner + review cadence (unowned SLOs rot).
- [ ] Kill/pause flags: fail-closed for writes, fail-open (cached) for reads — and which is which is written down.
- [ ] The monitor's own cost and failure story are stated (what melts first at 10x reporters, and what sheds).

## Failure Modes Table

| Failure | Symptom | Countermeasure |
|---|---|---|
| Shared-fate silence | outage + green (stale) status page | F3 dead-man; renderer split |
| Green-by-default | probe exception → `ok` | three-valued by construction; zero-value audit |
| Theater chain | history "tamper-evident," anchor "planned" | A3 in v1; named A4 verifier |
| Availability inversion | monitor outage bricks healthy clients | inform-don't-gate contract |
| Goodhart green | verdict gates revenue, pressure to fudge | anchoring + quorum precede gating power |
| Monitor bloat | the examiner is the write-amplifier | aggregation contract + shedding, stated |
