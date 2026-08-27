# Instrumentation spec — measured-not-proven parameters

Every theorem in the Harbor research program is exact given its parameters. Several of
those parameters are not proven, only measured: detection rates, calibration maps,
validation rates, collusion correlations, audit-surfacing rates. This document is the
spec for logging and estimating each one — the event to log, the estimator, and the
theorem it feeds — so those numbers are "fit from measured validation rates, not
vibes" (the phrase used at `whitepaper/legible-swarm.tex` §escalation and in the
compendium's R14 entry) rather than asserted.

This is the deliverable named in HANDOFF.md W12 (never previously written). It is a
spec, not an implementation: no logging pipeline described below is wired up yet.
Each section states what would need to exist for the number to stop being a design
target and start being an estimate.

## 1. Detection rate `d` (audit outcomes)

**Feeds:** R7 (Inspection tower, Paper 3) — the amortization curves ρ\*=G/(dB),
Θ(log T) vs O(1) spend, and every downstream claim that depends on how often a
cheating agent is actually caught when audited.

**Event to log:** every completed audit, with `{audit_id, claim_id, agent_id,
audit_type, outcome ∈ {caught, clean, inconclusive}, ground_truth_known: bool}`.
`ground_truth_known` matters because `d` is only estimable on audits where a
downstream event (a revert, a witnessed defect, a confession) later confirmed
whether the agent had in fact cheated — an audit that returned "clean" against an
agent who never cheated tells you nothing about `d`.

**Estimator:** `d̂ = (audits where outcome=caught) / (audits of agents later confirmed
to have cheated)`. Needs a denominator of confirmed-cheating cases, which will be
small and slow to accumulate — this is the parameter least likely to have enough
data early. Report a confidence interval, not a point estimate, until n is large
enough that the interval is useful (Wilson score interval, not normal approximation,
given expected small n).

## 2. Anomaly calibration map `g` (operator accept/reject vs. downstream outcome)

**Feeds:** R3 (Derived regret head, Paper 1) — the likelihood-ratio criterion for
which digests get escalated to a human; the whole point of the derived criterion is
that it is calibrated against what the operator would actually have wanted, not
against a proxy.

**Event to log:** every operator accept/reject decision on an escalated item, paired
with `{decision, downstream_outcome}` where `downstream_outcome` is the
*witnessed* result — did the flagged item turn out to matter — not the operator's
stated confidence or a click/dwell-time proxy. This is explicit in the W12 spec text
(HANDOFF §2, wave 12): calibrate from accept/reject vs. downstream witnessed outcome,
**not from clicks** (Review-and-Extensions solution 7.5 makes the same point: click
signals are gameable and correlate poorly with actual judgment quality).

**Estimator:** `g` is a map, not a scalar — fit as an isotonic regression of
`P(downstream_outcome=load-bearing | model_confidence_bucket)` over confidence
buckets, refit periodically as more labeled pairs accumulate. Report calibration
error (e.g. Brier score or ECE) alongside the fitted map so drift is visible.

## 3. Escalation validation rate (B7 tuning band)

**Feeds:** R14 (Costly-escalation threshold equilibrium, Paper 1 orbit;
`b7_escalation_band.py`) — `V(u)`, the validator function the threshold `u*(δ)`
depends on, and the two walls of the feasible debit band `[δ_min, δ_max]`.

**Event to log:** every escalation raised, with `{escalation_id, agent_id, u_score,
operator_verdict ∈ {validated, dismissed}, dismissal_reason?}`. `u_score` is the
agent's self-reported urgency/confidence at raise-time — the signal the theorem
conditions on.

**Estimator:** `V̂(u_bucket) = validated / (validated + dismissed)` per `u_score`
bucket, monitored for monotonicity (R14's boundary is explicit: **monotone V is
load-bearing** — a non-monotone validator breaks the separating-threshold argument
entirely, not just its calibration). A monotonicity violation here is not a data
artifact to smooth over; it's the theorem's own precondition failing and should page
whoever owns the escalation design, the same way a mutation-test failure would.
Alarm load `L(δ)` and miss loss are then computable directly from the bucketed rates
plus the operator-set costs `c_att`, `C_fa`, `C_miss`.

## 4. Cross-clique collusion correlation (judge-pair agreement)

**Feeds:** R7 (Inspection tower, Paper 3) — the sealed-sampling-from-disjoint-cliques
argument assumes cliques are actually independent; correlated judges collapse the
independence the bribery-resistance bound relies on.

**Event to log:** every pair of judges that independently reviewed the same claim,
with `{claim_id, judge_a, judge_b, verdict_a, verdict_b, clique_a, clique_b}`.

**Estimator:** pairwise verdict agreement rate, computed separately for
same-clique and cross-clique pairs. The quantity that matters for the theorem is the
*gap* between them — same-clique agreement is expected to be somewhat correlated by
shared context; the assumption breaks when cross-clique agreement approaches
same-clique agreement (judges behaving as if the clique boundary weren't there).
Report both rates and their difference, not just an aggregate correlation
coefficient, since the aggregate can hide exactly the failure mode being checked for.

## 5. Amortization fork variable (do cheats surface without audits?)

**Feeds:** R7's amortization fork itself — Model A (loss only-if-audited, Θ(log T))
vs. Model B (independent revelation rate `r`, O(1)) are two different closed forms,
and which one describes reality depends entirely on whether cheating surfaces through
channels other than a scheduled audit.

**Event to log:** every confirmed instance of cheating discovered, tagged
`{discovery_channel ∈ {scheduled_audit, tombstone_provenance, incidental_review,
external_report}}`. "Tombstone provenance" is the specific channel named in the wave
spec: does a cheat leave a trace (a tombstoned claim, an orphaned commitment, a
provenance gap) that surfaces on its own, independent of an audit ever running
against that agent.

**Estimator:** `r̂ = (cheats discovered via non-audit channels) / (agent-time at
risk)`, the empirical revelation rate that Model B's closed form
`aG²/(2dBrv)` depends on. If `r̂` is indistinguishable from zero over a meaningful
observation window, Model A (flat/log spend, no revelation) is the operating regime
and should be reported as such rather than assumed; per the compendium's own honest
boundary note (R7), the session parameters used for the internal numbers had
`t*=333 > T=200`, meaning the O(1) curve hadn't saturated at the observed horizon —
say so rather than reporting the asymptote as current-state.

## Cross-cutting notes

- **No estimator here should be trusted below a stated minimum sample size.** Every
  section above should report `n` alongside its estimate; a headline number with no
  `n` is not distinguishable from a guess.
- **These are live parameters, not one-time calibrations.** Distribution shift is
  expected as the agent population, task mix, and adversarial pressure change over
  time; each estimator should be re-fit on a rolling window, not computed once and
  frozen.
- **This spec does not itself constitute measurement.** Until the logging events
  above are actually wired into the daemon/relay event stream, every number this
  document could produce remains `[internal, design target]`, exactly the tag the
  whitepaper already uses for `d`, `g`, and the validation rates it currently states
  as open. Building the pipeline is separate, unscheduled work.
