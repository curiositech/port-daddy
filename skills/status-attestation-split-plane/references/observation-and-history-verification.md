# Observation and history verification

Read alongside the skill's F/A labels, which are local audit shorthand. Sources
below were inspected on 2026-09-24. This reference develops a local status-design
exercise; it neither implements Certificate Transparency nor certifies a service.

## Primary sources and what transfers

**Google SRE, Monitoring Distributed Systems**, sections “Symptoms Versus Causes”,
“Black-Box Versus White-Box” and “The Four Golden Signals”, official chapter body:
<https://sre.google/sre-book/monitoring-distributed-systems/>. It distinguishes
user-visible symptoms from explanations and combines external observations with
internal instrumentation. Its error discussion includes policy-defined latency
violations and incorrect content returned with a successful HTTP code. Thus a
successful transport result is not enough to classify a capability as working.
The transfer here is a method: define the user operation, evaluate its response
and deadline, then use internal telemetry to investigate causes. This chapter
provides operational guidance, not an experiment proving a particular monitoring
topology or universal timeout.

**RFC 9162, Certificate Transparency Version 2.0**, Experimental RFC, December
2021, §§1, 2.1.3–2.1.4, 8.3 and 11.3, official text:
<https://www.rfc-editor.org/rfc/rfc9162.html>. Inclusion proves that a leaf belongs
to a particular committed tree; consistency checks the append-only relation
between two tree states. Auditing requires an actor to perform those checks.
The RFC explicitly discusses inconsistent views and the need for clients to
compare log responses; it does not define the gossip protocol. These distinctions
inform this skill's local status-ledger design, but the RFC's protocol concerns
TLS certificates, not service-health truth. A signed checkpoint, valid inclusion
proof and consistency proof do not establish that an incident report was accurate
or that every incident was submitted. Separate observation and coverage evidence
are still needed.

## Keep three questions separate

1. **What was observed?** Bind each record to a capability, target revision,
   request or sample ID, observer identity and vantage point, observation time,
   receipt time, policy version and measured response. Keep observer execution
   validity separate from the operation's result. Authenticate records according
   to the deployment trust model; a self-declared identity field is not enough.
2. **What can the observation establish now?** Apply the capability's objective,
   freshness and coverage policy. A stale passing sample establishes past behavior,
   not current success. A missing region does not invalidate a real failure in a
   covered region, but it prevents a claim that all regions were observed. Return
   observed failures and unknown coverage together when needed, rather than
   collapsing a mixed result into a reassuring scalar.
3. **Has retained history changed?** Bind the verifier to the expected log identity,
   algorithms, signed checkpoint size/root, timestamp and prior retained checkpoint.
   Verify signatures and relevant inclusion/consistency evidence through a vetted
   implementation. Report a missing proof separately from a checked inconsistency.
   A local chain check alone cannot rule out an unseen alternate view. Checkpoint
   timestamp freshness also cannot prove that an omitted event did not occur.

These are distinct claims even if one UI displays them together. None substitutes
for current authorization to act. A status report may inform an action without
being its authorization credential.

## Constructed decision fixture

The following table is a local design exercise, not measured service data. Assume
capability C promises a semantically valid answer from region R within deadline D.
The review supplies D, freshness bound F and required coverage; no default values
are implied. Check each row against the actual implementation and its UI.

| Injected condition | Observation / history result | Permitted interpretation |
|---|---|---|
| Valid observer obtains correct response within D, sample younger than F | C at R meets the sampled objective | Healthy for the stated sample and coverage; no whole-service claim |
| Observer runs correctly, request exceeds D | Measured objective failure | Degraded for C at R; cause can remain unknown |
| Probe fails before issuing request | No usable service observation | Unknown; show observer failure separately |
| HTTP success with wrong application content | Semantic objective failure | Degraded even though transport succeeded |
| Last passing sample older than F | Past success, current evidence stale | Unknown current state, retain timestamp |
| R fails while another required region has no sample | Known failure plus missing coverage | Preserve both; do not erase the known failure |
| Valid inclusion proof against an old checkpoint | Record existed in that tree | No conclusion about current health or later omissions |
| Ledger cannot supply required proof | Verification incomplete | Unknown verification; retain request and failure details |
| Authenticated, correctly bound checkpoints/proof demonstrably conflict | Checked history inconsistency | Report the inconsistency and affected range; it is not by itself proof of an outage |
| Independent archive unavailable | Previously retained bytes may exist but cannot be checked now | Unknown check result; do not silently relabel the service down |
| Monitor unavailable during an ordinary cached read | Missing status evidence | Follow the read capability's explicit policy; do not invent a system-wide gate |
| Monitor unavailable where current evidence is a required effect condition | Required condition unproven | Withhold that effect or use a specifically authorized fallback; preserve other capabilities |

For a real evaluation, independently record injected ground truth, observer and
renderer results, elapsed time and affected capability. Inject failures separately
into the service, probe, collector, renderer, archive and notifier. Add a common
credential or DNS failure spanning multiple components. Measure false healthy
verdicts, false failure verdicts, unknown duration and alert delivery separately.
A rendered diagram or successful fixture-table review is not such a fault test.

## Book candidate disposition

Potential worked example: a correct history proof can coexist with a false or
stale health claim. This is a teaching/application candidate for the existing
Book evidence-boundary discussion, not a novelty claim or permission to edit it.
Compare with the manuscript's current freshness, coverage and semantic-oracle
material before proposing any new section.
