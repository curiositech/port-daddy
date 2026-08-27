# CASE-13: a discriminating experiment, not a ceremonial replay

**Status:** Design and implementation boundary for the first doctrine cycle

**Companion:** [`offline-counterfactual-cdm-for-agent-transcripts.html`](offline-counterfactual-cdm-for-agent-transcripts.html)

The counterfactual-CDM memo is strong where most transcript-mining proposals
are weak: it distinguishes narrated reasons from intervention, records replay
fidelity, and says plainly that a resumed continuation is a new sample rather
than historical ground truth. It should not, however, be used to promote a
single fork divergence into fleet doctrine.

The important CASE-13 question is not “did an agent fail to merge?” It is
which discriminating rule generated that decision. An unresolved review thread
can be a safety signal, a protocol requirement, a low-cost precaution, a
Goodharted proxy, a role effect, or prompt residue. Those mechanisms predict
different future behavior. A useful experiment must make them disagree.

## The competing explanations

| Hypothesis | Predicted discriminator |
| --- | --- |
| H1: learned safety invariant | Independent technical evidence, not its UI state, changes the decision. |
| H2: process integrity | The unresolved-thread state blocks even after its content is shown immaterial. |
| H3: asymmetric loss | Blocking increases with irreversible blast radius, even when the thread state does not change. |
| H4: Goodharted ritual | The thread state dominates despite absent technical evidence and low downside. |
| H5: role-conditioned policy | The same facts produce different choices for Steward and a neutral integrator. |
| H6: prompt residue | Removing or varying an inherited instruction changes the behavior while facts and role remain fixed. |

None is a personality label. Each is a falsifiable conditional claim in the
`integration.merge` decision domain.

## First maneuver: the 2 × 2 CASE-13 exercise

The first primary experiment should cross the two cues that the transcript
cannot disentangle by itself:

| Independent technical concern | Review thread state | Discriminates |
| --- | --- | --- |
| absent | resolved | baseline |
| absent | unresolved | ritual / protocol weight |
| present | resolved | evidence sensitivity |
| present | unresolved | evidence-plus-policy interaction |

Keep the rest of the checkpoint, tools, branch state, review provenance, and
operator goal fixed. Add a preregistered sham that changes neutral wording but
neither cue. Randomize arm order and record the exact source checkpoint, model
and version, harness, tool surface, temperature/sampling configuration, and
fidelity result for every arm.

The primary outcome is a structured **decision vector**, not merely
`merge`/`do not merge`:

```text
{ action: proceed | hold | investigate | escalate,
  stated_basis: technical_evidence | process_policy | expected_loss | other,
  observed_check: tool/action receipt,
  reversibility_and_blast_radius: explicit metadata }
```

The observed check matters. An agent can say it accepted a false premise and
then verify it away with tools; a prose rationale is never the outcome by
itself.

Treat Steward-versus-neutral-role, inherited-instruction ablation, and
reversibility/blast-radius as predeclared follow-on factors. Do not mix them
into the first 2 × 2 estimate. A null single-factor result does not establish
that the factor is irrelevant; it may only appear through an interaction.

## Units, replication, and honest labels

Repeated samples from one fork measure sampling variation inside one source
episode. They are **not** independent proof that an effect generalizes.

- Analyze arms within each source episode first.
- Treat independent decision episodes, projects, and harnesses as the
  generalization units.
- Keep same-model and cross-model conditions separate; cross-model transfer is
  a new question, not additional same-model evidence.
- Do not choose a universal replay count from the CASE-13 result. Use a
  preregistered stopping rule and report the complete observed distribution.
- Mark a result as `observed`, `mechanism-supported`, or `provisional` only
  according to its predeclared recurrence and fidelity criteria. Never call a
  first replay “established doctrine.”

This is why the console records a factual control and treatment as an
**admission floor**, not a causal effect estimate. The ledger preserves enough
evidence to improve the design later; it does not pretend that two matched
arms settle the population question.

## Second maneuver: advisory encouragement in normal development

Offline replays answer a mechanism question. Normal development must answer a
policy question: does seeing this advisory packet help? The safe field test is
a randomized encouragement or stepped-wedge rollout:

1. Keep every real merge, deployment, spend, and policy gate unchanged.
2. At eligible `integration.merge` decisions, randomly show or withhold an
   otherwise identical **advisory** doctrine packet.
3. Always write a retrieval receipt when the packet is shown, then record the
   agent's follow/adapt/reject response.
4. Link independently verified CI, review rework, reversal, incident, and
   operator-burden outcomes to that receipt.
5. Analyze the offer-to-retrieve effect separately from the effect among those
   who followed it; receiving advice changes behavior and is itself a treatment.

This preserves safety while revealing whether doctrine actually enters the
decision surface. It avoids the failure mode of a beautiful archive that is
written but never read.

## The implemented evidence trail

The first Port Daddy slice makes the finite loop inspectable and revisable:

```text
Logbook episode
  -> Admiralty harvest of >=2 cited episodes
  -> falsifiable candidate + preregistered war game
  -> factual control/treatment receipts
  -> provisional advisory packet
  -> retrieval receipt at a comparable decision
  -> agent follow/adapt/reject application
  -> verifier-backed outcome or contest
  -> immutable successor, retirement, or retained support
```

The native `pd-console` Doctrine pane is the deep operator surface for that
trail. It writes directly to the daemon's append-only Agent Harbor ledger and
renders the same receipts it later reads. CLI, MCP, and SDK expose the same
contract for automation; none can make doctrine a merge authorization.

`harvest` is intentionally not doctrine. It is a cited observation from at
least two compatible episodes. A candidate may point to that harvest, but it
must survive a preregistered factual experiment before admission. If later
evidence changes the rule, the old doctrine is not edited in place: a linked,
immutable successor supersedes it, or it is retired/contested while historical
receipts remain available.

## What this slice does not claim

- It does not automatically fork historical sessions or calculate a causal
  interval.
- It does not identify the historical agent's unobserved counterfactual.
- It does not treat prompt-only or mismatched replays as factual support.
- It does not pool model/harness drift with same-condition replications.
- It does not turn an advisory retrieval into enforcement.
- It does not solve privacy, retention, or all side effects merely by using an
  append-only ledger.

The naval analogy is operational rather than decorative: a logbook observation
goes to Admiralty, becomes a challenged maneuver plan, is issued as advisory
orders, is inspected in an after-action receipt, and is superseded when the
fleet learns something better. That is empirical doctrine. Anything less is a
story about what the fleet thinks it learned.
