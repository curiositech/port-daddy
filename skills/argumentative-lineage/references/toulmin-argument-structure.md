# Toulmin's Six-Element Argument Structure: Definitions and Agent Mappings

Toulmin (1958) proposed that natural arguments — not formal proofs — follow a recurring layout of six functional components. The model is normative for *practical reasoning*, not deductive logic: a warrant does not guarantee a claim, it *licenses* the move from data to claim with some implicit reliability. This distinction is critical when projecting the model onto agent outputs, where the "logic" is probabilistic and contextual.

## The Six Elements, Precisely Defined

**Claim** — The conclusion being advanced. The proposition whose acceptance the arguer wants. In agent terms: the final assertion field of a SwarmMessage (`discourse.thesis` on the seed message, or the target message in a synthesis). Not all agent outputs contain a claim; an agent that only surfaces evidence without asserting a conclusion produces Data, not a Claim.

**Data** (Toulmin's term; also "grounds") — The facts, observations, or premises the arguer presents as justification. In Toulmin's formulation, data are the *already-accepted* statements from which the claim is to follow. Agent mapping: any message with `act: "assert"` and `relationship: "supports"` directed at the claim message. Multiple data messages are additive grounds; they compose into cumulative justification.

**Warrant** — The inference license: the rule, principle, or generalization that authorizes the step from data to claim. Crucially, warrants are *typically implicit*. They surface only when challenged. In agent discourse, `act: "question"` or `act: "challenge"` messages are warrant-probing operations — they force the upstream agent to make an implicit bridge explicit. Warrants are domain-specific: "observation X is evidence of bug Y" is a warrant in code review; "symptom A suggests diagnosis B" is a warrant in medical triage.

**Backing** — The categorical support for the warrant itself. If a challenger demands: "why does that rule hold?", backing is the answer. In Toulmin (1958, p. 96–104), backing takes different forms by field: legal backing is statute, scientific backing is experimental evidence. In agent systems, backing appears as `act: "synthesise"` messages that ground a contested warrant by citing authority, prior runs, or meta-level evidence. `SwarmTraceStats.synthesisCount` is a proxy for how much backing activity occurred.

**Qualifier** (also "modal qualifier") — The degree of force the arguer is prepared to attach to the claim: "certainly", "probably", "presumably", "in most cases". Qualifiers reflect recognition that the warrant is not exceptionless. Agent mapping: confidence fields, hedge language, or explicit `relationship: "qualifies"` messages that attenuate the claim without contradicting it. A claim without an explicit qualifier carries an implicit "certainly" — often the wrong assumption in uncertain domains.

**Rebuttal** — The conditions under which the claim would fail or the warrant would not apply. Rebuttals are *anticipated exceptions*, not counter-arguments from a second party. Agent mapping: `relationship: "contradicts"` messages that identify specific conditions where the claim breaks down. Unresolved rebuttals (surfaced by `unresolvedContradictions()`) indicate epistemic debt: the swarm acknowledged a failure mode but did not synthesise a resolution or qualification.

## Mapping to SwarmTracer Fields

| Toulmin Element | `SwarmDiscourse` signal | Tracer query |
|---|---|---|
| Claim | seed message OR `act: "assert"`, `relationship: "none"` | `chain[0]` |
| Data | `act: "assert"`, `relationship: "supports"` | `chain.filter(n => n.relationship === "supports")` |
| Warrant | `act: "question"` or `act: "challenge"` | `chain.filter(n => n.act === "question")` |
| Backing | `act: "synthesise"` downstream of warrant | `synthesisCount` in stats |
| Qualifier | confidence metadata or `relationship: "qualifies"` | requires schema extension |
| Rebuttal | `relationship: "contradicts"` | `findContradictions()` |

The qualifier is the element most commonly missing from agent outputs. When building the annotation layer, default undecorated claims to `qualifier: "presumably"` rather than "certainly" — Toulmin's point is that absolute certainty is rare in practical reasoning.

## Key Points

- Warrants are implicit by default; they only become visible when an agent issues a challenge. Design swarms with at least one skeptical agent role to force warrant surfacing.
- A rebuttal is not a contradiction in the logical sense — it is an anticipated exception that *scopes* the claim. Treating all `contradicts` edges as fatal errors is a category mistake; many should instead trigger qualifier narrowing.
- Backing grounds the warrant, not the claim directly. A long chain of supporting data does not substitute for backing when the warrant itself is contested.
- `SwarmTraceStats.maxLineageDepth` tracks argument chain length; chains deeper than ~6 usually indicate warrant nesting (backing for backing) and should trigger a lineage zoom before acceptance.
- Toulmin (1958) was explicitly anti-formalist: the six elements are *functional roles*, not syntactic slots. A single sentence can carry claim and qualifier simultaneously; a single agent message can serve as both data and a rebuttal.

## See Also

- `windags/skills/toulmin-argument-analysis/SKILL.md` — single-argument analysis in isolation vs. multi-agent discourse
- Dung (1995) argumentation frameworks — formal treatment of attack and defeat relations, relevant when `contradicts` edges require resolution ordering
- `workgroup-ai/packages/core/src/topologies/swarm-tracer.ts` — `SwarmDiscourse` type definition for the full set of valid `act` and `relationship` values
