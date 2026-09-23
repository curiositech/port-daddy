# Research basis for the convention

This note records why the convention uses independent positions, reciprocal
steel-man review, fresh reality checks, bounded correction, and preserved
dissent. It is not evidence that those mechanisms make a decision true.

## What the literature supports

1. **Agent paths are not stable test oracles.** Anthropic reports that
   multi-agent research systems can take materially different valid paths for
   the same task and recommends grading both outcome and process rather than
   prescribing one hidden sequence. It also recommends starting with small,
   representative evaluations and retaining human evaluation for failures that
   automated graders miss. [How we built our multi-agent research
   system](https://www.anthropic.com/engineering/multi-agent-research-system)

2. **Debate is a supervision hypothesis, not a guarantee.** OpenAI's original
   debate proposal explicitly names unresolved failure modes: convergence is
   not guaranteed, debate consumes more compute, and the human judge may be
   biased or unable to adjudicate the final dispute. The convention therefore
   does not equate agreement with correctness and stops with named dissent when
   evidence cannot resolve a conflict. [AI safety via
   debate](https://openai.com/index/debate/)

3. **Critiques can improve human detection without becoming proof.** OpenAI's
   critique work found that model-written critiques can help people notice
   flaws, but frames the capability gap between producing, discriminating, and
   critiquing answers as an empirical research problem. A critique is therefore
   evidence for reinspection, not a promotion receipt by itself. [AI-written
   critiques help humans notice flaws](https://openai.com/index/critiques/)

4. **Multi-agent organization introduces its own hazards.** Anthropic's work on
   emerging multi-agent systems warns that diversity collapse and interaction
   effects can create failures not predicted from individual-agent behavior.
   Independent first-round papers and sealed roles are intended to reduce, not
   eliminate, premature convergence. [Patterns and problems in emerging
   multiagent systems](https://www.anthropic.com/research/multiagent-systems)

5. **Reasoning over a written specification helps but is incomplete.** OpenAI's
   deliberative-alignment work supports giving a reviewer the actual policy or
   rubric at inference time. It does not show that a model can independently
   verify implementation reality or that a specification is itself sound.
   [Deliberative
   alignment](https://openai.com/index/deliberative-alignment/)

## Domain-gap research added after reciprocal review

The review rounds found that orchestration research alone could not support
the proposed capacity, continuation, and deterministic-evaluation contracts.
Three focused ledgers now separate borrowed mechanisms from Drydock claims:

- **Admission and settlement.** AWS's idempotency guidance supports
  caller-provided intent tokens, atomic token/effect recording, parameter
  mismatch rejection, and bounded retries. Garcia-Molina and Salem's Sagas
  supports explicit compensation after partial execution. Neither source
  proves exact-once external effects, budget conservation, cancellation, or
  economic settlement; those remain Drydock invariants and test targets.
  See [the capacity source ledger](../../../skills/conserved-capacity-admission-and-settlement/references/authority-and-conservation.md).
- **Trust-typed continuation.** NIST SP 800-162 supports authorization over
  subject, object, operation, and environment attributes; NIST SP 800-207
  rejects implicit trust from network location or ownership; the MCP
  authorization specification requires audience binding and forbids token
  passthrough. None establishes semantic truth or backend equivalence. See
  [the context source ledger](../../../skills/trust-typed-context-compiler/references/authority-retrieval-and-continuity.md).
- **Deterministic evaluation.** QuickCheck supports generated property tests,
  delta debugging supports predicate-preserving reduction, lineage-driven
  fault injection supports outcome-guided fault search, and RFC 9162 precisely
  bounds Merkle inclusion and consistency claims. None proves model fidelity,
  oracle soundness, exhaustive coverage, or semantic truth. See [the Trial
  Basin source ledger](../../../skills/trial-basin-deterministic-systems-evaluation/references/evidence-model-and-replay.md).

## Design consequences

| Research limitation | Convention response | Remaining uncertainty |
|---|---|---|
| Same task may yield different valid paths | Judge explicit claims, evidence, falsifiers, and outputs rather than hidden reasoning shape | A rubric may still reward a polished mistake |
| Debate may optimize persuasion | Seal independent first rounds; steel-man before critique; cite the opponent's evidence | Shared model priors can still correlate errors |
| Automated critique has blind spots | Fresh EM, PM, and Design reviews plus operator-visible dissent | Fresh roles are not statistically independent if they share a model family |
| Multi-agent interaction can collapse diversity | Partition by doctrine and prohibit cross-talk before sealing | Role prompts may simulate rather than produce real epistemic diversity |
| Iteration can loop or consume unbounded capacity | One correction per position, one final manager decision, explicit terminal states | A bounded process can terminate with unresolved uncertainty |

## Evaluation rule

The convention is useful only if it leaves a more falsifiable artifact than a
single-author plan. Its quality gates are therefore observable:

- every position names the claim it owns and what would change its mind;
- every critique begins with an attributable three-part steel-man;
- every accepted correction traces to a review finding;
- every consensus item records which evidence supports it;
- every dissent survives synthesis with an owner and unblock condition;
- the final roadmap labels `SOURCE_PRESENT`, `PROPOSED`, `UNKNOWN`, and
  `BLOCKED_BY_HALT`; and
- no agreement count is used as a truth score.

The convention itself should later be tested against deliberately flawed and
correctly dissenting papers. Until those fixtures exist and independent humans
review their outcomes, the process remains `PROPOSED`.
