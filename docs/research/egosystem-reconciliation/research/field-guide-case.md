# Field Guide Case: Meeseeks and the Persistent Reviewer Roster

Source: operator-supplied `reflctfieldguidebuild8b.html`, SHA-256 `86c616806c79837cdf619f3d8c7335f8b317c7de61e75aaf452bb8c26b59b647`, `#page-review`, especially source lines 11254–12009  
Status of source: proposal and mock; its PR audit is bounded evidence, while the reviewer performance scene is explicitly invented  
Use here: one implementation-facing case, not Port Daddy authority

## Concise verdict

Keep the bounded outcome owner, evidence-first specialist review, non-substitutable findings, explicit dispositions, and the rule that one approval cannot clear another reviewer's objection. Replace persistent “personalities” with durable principals embodying evidence-method roles; add independent retrieval before cross-review; type each contribution epistemically; make the Synthesis Steward accountable for integration but unable to mint authority; and escalate irreducible human-value conflicts to an authorized human.

## What the Field Guide gets right

1. **A Meeseeks owns one bounded outcome.** It can continue across sessions but may not silently widen into a second outcome. This maps well to a durable AgentNode with successive session embodiments.
2. **Review roles have different oracles.** QA reproduces the stated plan and probes one neighbor. The Strenuous Reviewer requires a failing input, line or read-only probe. Bizarro converts the strongest reading into tests. The Historian compares against the written record. The Privacy Warden checks disclosure changes. Diversity comes from method and evidence, not the names.
3. **Unverified worries should not flood the human surface.** Candidate findings can be retained for calibration without becoming actionable review findings.
4. **Taste has no veto.** The code-quality provocateur has no severity and no vote. This correctly separates aesthetic commentary from correctness or policy gates.
5. **Approvals are non-substitutive.** The mock explicitly says one approval does not clear another reviewer's finding.
6. **Outputs have shape.** Findings, proof, missing coverage and dispositions can be measured and audited.
7. **The source labels uncertainty.** It states that the roster has not reviewed a real diff, its mock is not behavioral evidence, estimates are guesses, and the audit cannot establish cause.

## Where Project Epistemology changes the design

### 1. Independent inquiry must precede visible cross-review

The six reviewers may receive the same immutable change set and scope envelope, but not one another's conclusions until their first submissions close. Otherwise a high-status or early reviewer anchors the rest. The pipeline becomes:

```text
same change/evidence scope
  -> isolated retrieval and probes
  -> sealed initial contributions
  -> reveal support/attack graph
  -> reciprocal steel-man
  -> Synthesis Steward disposition proposal
  -> authorized landing decision or human escalation
```

Randomize reveal order in experiments. Record which evidence each reviewer could access. Do not show aggregate votes or confidence before sealed submission.

### 2. Role is not identity

- **Principal:** durable AgentNode or attributable human.
- **Embodiment:** the runtime body and bounded session that performed this review.
- **Role charter:** QA, correctness/security, design steel-man, conceptual simplicity, historical consistency, or privacy.
- **Method profile:** tools, evidence classes, required probes, mute conditions, and known failure modes.

A reviewer name may help human comprehension. It confers no credential, access, expertise or vote. The same principal should not secretly fill multiple “independent” seats in one round unless the experiment explicitly measures that ablation.

### 3. A finding needs epistemic type, not just severity

Minimum `Contribution` fields:

| Field | Meaning |
| --- | --- |
| `kind` | observation, claim, hypothesis, counterexample, argument, policy assertion, value concern, test result, recommendation, or question |
| `status` | candidate, evidenced, contested, accepted-as-project-state, rejected, superseded, or withdrawn |
| `propositionRef` | exact proposition the contribution supports or attacks |
| `relation` | supports, rebuts, undercuts, undermines, extends, narrows, synthesizes |
| `evidenceRefs` | authorized immutable references; zero is allowed only for explicitly labeled questions/opinions |
| `scope` | account/team/project/repository/harbor/world plus commit/ref/change id |
| `author` | principal, embodiment and role charter |
| `observedAt` / `assertedAt` | distinguish event time from statement time |
| `confidence` | calibrated estimate where meaningful, never an authority score |
| `disclosure` | who may see content, metadata, derived claim, and existence |
| `supersedes` | prior contribution replaced by this one |

Severity belongs to impact. Epistemic status belongs to support. They must not be collapsed.

### 4. Support/attack must target the right layer

The Field Guide's roles naturally exercise different argument moves:

| Role | Typical move |
| --- | --- |
| QA | supports or rebuts an empirical claim with a reproducible result |
| Strenuous Reviewer | undermines a premise, undercuts a warrant, or rebuts a conclusion with a failing case/probe |
| Bizarro Helper | steel-mans the conclusion, derives consequences, and tests them against parent/current commits |
| conceptual simplicity reviewer | raises a value concern or undercuts an architecture warrant; no correctness vote without evidence |
| Historian | supplies prior decisions and supersession lineage; must classify each document's authority and freshness |
| Privacy Warden | traces a change to altered disclosure/retention consequences and a policy/value conflict |

“Contradicts” alone is too coarse. A failed premise, invalid inference, contrary result, and clashing value demand different resolution.

### 5. One accountable synthesis owner is not a sovereign decider

The Synthesis Steward must:

- represent every material contribution and dissent;
- propose dispositions with exact support/attack and evidence references;
- expose missing premises, consequences, uncertainty and affected values;
- explain why a contribution was accepted, rejected, deferred or escalated;
- never clear its own evidence, rewrite another principal's belief, or convert synthesis into canonical state.

The authoritative roadmap/landing actor applies the transition. If the proposal changes disclosure, irreversible state, user rights, money, or incompatible human values, an authorized human decides.

The outcome owner, durable review role, Synthesis Steward, App actuator,
deterministic merge queue, and operator are separate principals or functions.
Combining them erases the distinction between proposing a finding, integrating
an argument, authorizing a transition, executing it, and accepting its human
consequences.

### 6. Preserve the quiet candidates without spamming the PR

“Silently drop” is good operator UX and bad calibration data. Store a protected, content-minimized candidate receipt:

- reviewer/method version;
- finding class and scoped digest;
- why it failed the evidence threshold;
- cost and time;
- no raw secret or unneeded content.

This lets the system measure hallucination and threshold quality without presenting plausible worries as findings.

### 7. Metrics must resist Goodhart pressure

“Findings accepted” alone rewards easy nits and social compliance. Use a balanced scorecard:

- independently reproduced material findings;
- confirmed false-positive rate;
- regressions/reverts of the chartered class that escaped review;
- time and human attention to disposition;
- unique evidence contribution after deduplication;
- correction after counterevidence;
- severity calibration;
- privacy/authority violations;
- cost per prevented material defect.

Retirement thresholds require enough observations and confidence intervals. A fixed 0.3 acceptance cutoff over roughly twenty monthly PRs is an experiment proposal, not policy.

## Human-value escalation

Automatic synthesis stops when any of these remain material:

- two legitimate stakeholders rank outcomes differently;
- a privacy, dignity, safety, accessibility, labor, ownership or consent value cannot be reduced to a technical fact;
- the change redistributes authority or disclosure;
- the decision is irreversible or establishes policy precedent;
- the evidence is adequate but the acceptable risk is a human choice.

The preview must show: affected humans, current outcome, proposed outcome, lost or narrowed outcome, alternatives, reversible boundary, dissent, and who is authorized to decide.

## Adopted architecture consequences

- Meeseeks becomes an outcome-bounded work identity: AgentNode principal + session embodiment + roadmap/PR scope, not an ephemeral personality.
- Reviewer roles become versioned method charters with independent evidence scopes.
- Every round is bound to a frozen exact head; initial contributions are sealed until the independence gate closes.
- Contributions form a typed support/attack graph; findings are projections for PR review.
- The Synthesis Steward authors the reconciliation proposal and dissent appendix.
- Existing merge/roadmap authority performs the canonical transition.
- Operator surfaces receive impact preview and bounded asks, not a stream of speculative findings.
- Reviewer effectiveness is measured against evidence, missed outcomes, attention and cost.

## Independent delegated review: adopted deltas

A later review commissioned outside this document's drafting path reached the
same overall conclusion and tightened the implementation contract. Its deltas
are adopted as requirements:

1. Bind the review envelope to an immutable repository and PR head before any
   specialist begins. A later head starts a new round or an explicitly scoped
   delta round; it does not silently change the object under review.
2. Use a compact operational status vocabulary alongside the richer
   contribution model: `hypothesis`, `verified_observation`, `policy_norm`,
   `value_preference`, and `blocking_gate`. These labels describe what kind of
   warrant is being presented, not who is important or how severe an impact is.
3. Let one Steward deduplicate and assign proposed dispositions, but expose
   every merge, rejection, deferral, supersession and escalation. There is no
   majority vote, agreement reward, or acceptance-count authority.
4. Keep actor belief, project policy and world evidence in distinct projections.
   A verified observation can challenge a belief; it cannot retroactively claim
   that an actor held a different belief. A policy can govern an action; it
   cannot make an empirical proposition true.
5. Treat mutable GitHub comments, checks and summaries as projections of an
   append-only finding, argument and commitment history. GitHub remains a useful
   collaboration and actuation surface, never the sole institutional record.
6. Preserve both attributable identities: the durable AgentNode or human
   principal and the historical session/worker embodiment that performed the
   review. Do not replace one with the other.
7. Before an accepted plan changes, provide a forward consequence preview:
   affected goals and commitments, resource collisions, disclosure changes,
   human outcomes, superseded state, alternatives, and the authority required
   to proceed.

The review also confirmed that Port Daddy should reuse its current durable
roles and role charters. It does not justify adding six permanent reviewer
personas as a second organizational roster.

## Explicitly not adopted

- all reviewers seeing one another's comments during initial inquiry;
- personality prompting as proof of cognitive diversity;
- majority approval as resolution;
- an approval clearing unrelated objections;
- the Steward, PR owner, App actuator or merge queue inheriting the operator's decision authority;
- the PR body as the only institutional memory;
- stale documentation as automatic authority;
- hidden candidate deletion with no calibration receipt;
- the proposed roster or estimates being described as tested.
