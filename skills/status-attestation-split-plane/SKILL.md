---
name: status-attestation-split-plane
description: >-
  Audit or design a status/health surface so it does not share fate with the system it
  describes and cannot quietly attest to itself: split read plane (independently deployed
  reporter + dead-man switch), three-valued verdicts (healthy/degraded/unknown — never
  green-by-default), external anchoring of any "tamper-evident" status chain, and the
  availability-inversion check (justify monitoring dependencies per capability). Use when adding a
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
      reason: Related first-party relay design. Verify the current implementation, anchor custody and verifier before claiming externally checked history.
    - skill: circuit-breakers-and-retries
      reason: Covers client retry and breaker mechanics after this audit specifies behavior for each capability and evidence state.
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
that make health claims misleading, and develops an evidence contract under a
stated failure and adversary model.

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

**Fate taxonomy.** Classify every component of the status path (probe, storage,
renderer, alert delivery) by what it shares with the monitored system:

| Level | Shares | Example | What its silence means |
|---|---|---|---|
| F0 | same process | `/health` handler in the app worker | silence is ambiguous |
| F1 | same deployment unit | scheduled probe in the service | deployment/unit failure may mute it |
| F2 | same platform/control plane | separate worker/storage on the same cloud | shared control-plane failure remains |
| F3 | independently governed failure domain | external checker and separately delivered dead-man signal | scope depends on provider, identity, network, and alert path |

**Design question:** place probe, sample store, renderer, and silence detector according to the service threat model and tolerated common-mode failures. Higher separation can improve independence, but F0–F3 are this skill’s local labels, not a standard or universal required tier. A dead-man signal is one option; document what failures it can and cannot observe.

**Code locators** (literal implementation searches, not semantic verdicts; read the surrounding code):
`rg -n 'handleHealth|/health'` — does the handler touch any dependency, or return a
constant? `rg -n 'scheduled\(|cron'` — do probes share the monitored deployment?
Does any config reference an external checker with a dead-man/heartbeat contract?

### Trap 2 — Green-by-default: two-valued verdicts

A bare success/failure flag cannot represent missing evidence. A useful local
contract is `healthy | degraded | unknown`, with an explicit capability, observation
window and coverage. Here `degraded` includes an observed objective violation,
including complete failure for that capability; add a separately defined `down`
state if the product needs that distinction. `unknown` means evidence is insufficient,
not that an observed failure should be hidden.

A probe that cannot execute yields unknown service evidence. A functioning probe
that records a request exceeding the capability's defined deadline has observed a
failure of that request from that vantage point, even if its cause is unknown.
Do not infer a global service outage from that one observation. A thrown network
error needs the same distinction: observed transaction failure versus a broken
instrument. Preserve the raw observation and the interpretation rule.

A boolean inside a structured observation is fine when separate fields preserve
validity, coverage, age and reason. Unknown must remain visibly distinct from both
success and known failure. Never initialize missing observations to healthy.

Define dependency aggregation explicitly. Preserve unknown coverage and age; do not silently substitute a previous healthy observation. The aggregation rule should reflect the capability and consequence under review.

**Review:** find every place a health struct is initialized. If the zero value is
`ok`/`true`, the surface is green-by-default. Find every catch around a probe: does
it record `unknown`, or swallow into the previous value?

### Trap 3 — Self-attestation: tamper-evident theater

A signed record provides integrity and signer evidence under its key and algorithm
assumptions. It does not prove that the reported event happened. Hash continuity
within one served history does not by itself reveal a discarded suffix, a rewritten
history after signer compromise, or inconsistent views shown to different clients.
State which attack the design detects and which previously retained commitment or
independent observation makes that detection possible.

**The local attestation taxonomy** — label status evidence with its evidence source and limitations:

- **A0 self-reported:** service assertion with no independent attestation.
- **A1 self-signed:** integrity/authorship evidence under the signing-key trust model; not proof the assertion is true.
- **A2 chained:** hash-chain continuity evidence; without an external retained head, wholesale rewrite may remain undetectable.
- **A3 externally anchored:** a separate party or system retains a commitment; protection depends on identity, custody, retention, and availability independence.
- **A4 externally verified:** a named verifier compares retained commitments against served history under a stated procedure.

**Design question:** if a status ledger is called tamper-evident, identify which independent party retains its anchor and who actually checks it. A chain alone does not establish a globally consistent or complete history; A3/A4 labels are this skill’s taxonomy, not standards. See the reference for the distinct roles of signatures, inclusion proofs, consistency proofs and cross-view comparison.

Outside-in probes can add evidence when their trust model is explicit. Multiple reporters may share software, identity, deployment, or network failures; quorum does not make them independent and cannot alone establish truth. Specify authentication, freshness, correlation/Sybil assumptions, privacy, and aggregation before using client reports.

### Trap 4 — Availability inversion: the monitor becomes the SPOF

If a client blocks all behavior on a status verdict, the status plane can become a product availability dependency. Look for splash screens blocked on fetch, `unknown` collapsed into impossibility, and retry storms. Separate status presentation from authorization of consequential writes; whether reads proceed is a per-capability security/product decision.

**Client contract:** for each capability, state whether unknown, degraded, or known impossibility triggers cached behavior, retry, restriction, or escalation. Avoid making monitor availability a dependency for unrelated operations. If a verdict gates a consequential action, review incentives and independently verify the evidence path; anchoring or quorum labels alone do not establish correctness.

---

## Design workflow (greenfield or review)

1. Map service and status-path components to deployment, provider/account, credentials, control plane, region, network, storage, and alert delivery failure domains.
2. Define probes from capabilities and objectives actually promised. Record coverage, freshness, timeout, evidence, and limits; do not invent universal latency or retention values.
3. Set sample/incident retention from privacy, response, and regulatory needs; identify external anchor custody and the party/procedure that verifies it.
4. Choose reporter placement and keys from the threat model. Separate deployment does not imply independence when identity or control plane is shared.
5. Specify three-valued observation and aggregation, including stale/missing probes, partial coverage, and correlated reporters.
6. Define per-capability behavior for healthy, degraded, unknown, and impossible. Keep monitor availability from blocking unrelated operations; authorize consequential effects separately.
7. Budget probe cost/write amplification and measure expected and failure load before setting limits.

## Review Checklist (emit as the audit)

For each item: PASS / FAIL / N/A + evidence (file:line or design-doc quote).

- [ ] Probe, store, renderer, and alert-path failure domains are mapped; common-mode assumptions are stated.
- [ ] Evidence validity, coverage, age and reason accompany the verdict; missing observations cannot become healthy. Observer failure and an observed deadline violation have distinct outcomes.
- [ ] Every tamper-evident claim identifies retained external commitment and actual verification, or is narrowed to internal hash continuity.
- [ ] Reporter identity, freshness, correlation, authentication, and aggregation are explicit; quorum alone does not prove independence.
- [ ] Client behavior is defined per capability for unknown, degraded, and impossible, with reasons and safe fallback.
- [ ] Every SLO already promised in an ADR/contract has a probe; the SLO page lists owner + review cadence (unowned SLOs rot).
- [ ] For each capability, client behavior under unknown/degraded/impossible is explicit and justified by its security and availability consequences; no blanket read/write default is assumed.
- [ ] The monitor's own cost and failure story are stated (what melts first at 10x reporters, and what sheds).

## Failure Modes Table

| Failure | Symptom | Countermeasure |
|---|---|---|
| Shared-fate silence | outage + stale status page | Map common-mode failures and choose a monitor/report path appropriate to the threat model |
| Green-by-default | probe exception → `ok` | three-valued by construction; zero-value audit |
| Theater chain | history "tamper-evident," no independently retained head | Narrow the claim or name the actual custody and verification process |
| Availability inversion | monitor outage blocks unrelated operations | justify each capability dependency; keep authorization and status presentation distinct |
| Goodhart green | verdict gates a consequential choice | independently review incentives, evidence custody, and client behavior |
| Monitor bloat | the examiner is the write-amplifier | aggregation contract + shedding, stated |


## Independence and verification worksheet

F0–F3 and A0–A4 are local labels for this skill, not assurance standards. Map monitored service, probe, storage, renderer, identity, deployment, DNS, network, notification, and verifier to their failure domains. For each claimed independent component, check shared provider/account, deployment pipeline, credentials, control plane, region, and communication path. A quorum does not ensure independent reporters; document authentication, freshness, Sybil/correlation assumptions, and aggregation. An independently retained commitment can support detection of a later conflicting history when a verifier actually compares it; it does not establish event truth, coverage or current service health.

Test service outage, monitor outage, stale report, renderer failure, notification loss, and anchor/verifier divergence. Record state, report age, failure domain, and client behavior. Use `healthy`, `degraded`, or `unknown` only with a stated observation/aggregation contract.

- [Independent failure domains](diagrams/research-s12-monitor-failure-domain-map.md)
- [Attestation report lifecycle](diagrams/research-s13-attestation-report-and-verification-lifecycle.md)
- [Observation and history verification methods](references/observation-and-history-verification.md)
- [Source and claim correction ledger](references/source-correction-ledger.md)

[NIST SP 800-137](https://csrc.nist.gov/pubs/sp/800/137/final) describes continuous monitoring in an organization/system risk context. It does not define the F/A taxonomies, require a specific cloud separation, or prove that an external anchor is independently retained or verified.


