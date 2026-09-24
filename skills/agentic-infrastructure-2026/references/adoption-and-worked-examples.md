# Organizational adoption and three worked examples

All example values, people, systems, task volumes, and schedules below are constructed for method demonstration. They are not observed results, product recommendations, or evidence that an organization achieved the stated outcome.

## Adoption procedure

1. **Name affected groups and decision owners.** Include engineering, product, security/privacy, operations, finance/procurement, and end users only where their responsibilities are in scope. Assign an owner for data access, external effects, incident response, and rollout decisions.
2. **Ask what must change in the work.** Capture current workflow and burden, exception paths, trust/data concerns, user choice, support load, and where the agent may fail. Keep reported stakeholder evidence separate from a predicted concern.
3. **Set a baseline and a narrow pilot.** Record the same task definitions and quality rubric for the existing process and the pilot. Name who can pause it, how users opt out or escalate, and how work continues during failure.
4. **Communicate by audience.** Explain purpose, capability evidence, limitations, data/retention, decision authority, user recourse, and what is still unknown. Use a demonstration to show behavior; do not use a demo as an evaluation result.
5. **Review measured costs and outcomes.** Include implementation, integration, provider/tool/runtime, storage and observability, human review, rework, maintenance, training, support, and eventual migration/retirement. State the period and denominator. See the formulas and cost ledger in [`evaluation-and-cost-method.md`](evaluation-and-cost-method.md).
6. **Expand, revise, or stop against explicit gates.** Gates should follow the risk and work: rubric performance, effect safety, recovery, user impact, cost, and support capacity. Record who accepts residual risk and what evidence supports that decision. No universal team count or rollout calendar applies.

## Worked example 1: review-preparation assistant

**Constructed scenario.** A platform group considers pre-review analysis on one repository. The task is to inspect a change and produce suggestions only; a human owns external comment publication and merge. The workflow is represented in [`../diagrams/code-review-workflow.md`](../diagrams/code-review-workflow.md).

**Candidate comparison.** Compare the existing reviewer workflow plus a deterministic scanner, a direct model call, and an orchestrated candidate only if conditional tests, multiple tool calls, or durable progress are needed. Test conditional branches (security scan only when auth/secrets are touched, language-specific style check, tests when relevant), missing permissions, failed tools, and duplicate suggestion delivery. The framework name is a variable under evaluation, not the hypothesis.

**Constructed arithmetic.** The unit-cost example in `evaluation-and-cost-method.md` starts from 45 baseline human minutes, 10 post-assistance review minutes, and synthetic cost inputs. It accounts for fixed and labor costs, uses 190 rubric-passing tasks as a constructed denominator, and calculates a hypothetical `$28.25` cost per accepted task. It does not repeat the original unqualified 67% time-reduction or 89% acceptance “outcome.” Replace every input with locally measured values before any return claim.

**Pilot gate.** A local team might require a versioned rubric, no unauthorized/duplicate publication in tests, a reviewer pause path, replay-safe delivery, and a support owner before widening access. These are proposed local gates; calibrate and document them against the system's effect risk. Passing this plan does not certify the running integration.

## Worked example 2: compare an existing research workflow with a candidate runtime

**Constructed scenario.** A team has an existing two-role research workflow and suspects that interrupted runs lose useful state. Do not assume the existing toolkit lacks persistence or that a graph runtime will fix the problem. Inventory exact versions, state owner, task traces, deadlines, interruption behavior, external calls, and recovery needs first.

**Comparison recipe.** Select development tasks and a held-out set with the same question difficulty and source constraints. Run the existing implementation and the candidate on the same versions of model, tools, prompts, and effect policy. Include normal tasks, tool timeouts, process interruption, partial outputs, and resume. Capture task-level correctness against the same rubric, source coverage, retries, duplicate effects, p50/p95 latency, provider/tool cost, human correction time, and recovery outcome. Randomize order if shared capacity or changing data could bias one candidate. Record all versions and failure traces.

Represent the existing role-message exchange and a candidate explicit state machine separately; [the control-pattern diagram](../diagrams/research-control-patterns.md) gives a constructed comparison without claiming one toolkit is categorically better. A decision log may end in *keep current*, *make a narrower change*, *migrate*, or *defer for missing evidence*. If migration is selected, use staged parallel comparison and a separately authorized traffic/rollback plan. The old example's claims of “73% fewer failed runs,” “45% cost reduction,” and “deterministic execution paths” are removed: they had no supporting run data. The diagram [`../diagrams/migration-comparison.md`](../diagrams/migration-comparison.md) shows the experiment, not a promised result.

## Worked example 3: shared infrastructure for several teams

**Constructed scenario.** Five hypothetical teams are considering a shared enablement group because they report duplicated tool adapters and inconsistent evaluation records. Confirm that these are stakeholder reports and inventory the actual projects before treating duplication as measured.

A shared service might offer versioned tool adapters, evaluation templates, cost attribution, deployment guidance, access reviews, incident routing, and short training. Teams retain ownership of their workflows, data classification, effect policy, and acceptance decision. MCP may be one interoperability option, not the framework or security policy for the platform.

**Staged method.** Select one representative team and workflow based on readiness and consequence, not motivation alone. Record baseline effort and task quality; test access and failure controls; document integration and support burden; gather user feedback; update the shared offering; then let each next team opt in when its own requirements and evidence are satisfied. If teams do not share a workload or control need, do not centralize merely to meet a target team count.

**Success ledger.** Track onboarding hours, duplicate adapter maintenance actually avoided, successful tasks and failures, model/tool/runtime expense, support load, security exceptions, user opt-out/complaint signals, recovery incidents, and total cost over a stated period. Compute reuse as a defined numerator (shared components actually consumed and maintained once) divided by a stated denominator (eligible components or integrations); do not call code volume a benefit by itself. The original fixed six-month schedule, 70–80% reuse, cost-per-team reduction, and production-deployment outcome are unsupported measurements and are not carried forward.

## Observability and operational adoption

Instrument what lets an owner answer a concrete question. The original four levels remain useful categories, not a mandate that every product use the same vendor or set:

- **Request:** workload, version/configuration, principal or service identity, policy context, and outcome reference.
- **Trace:** model/tool spans, control transitions, retries, timestamps, errors, and causal links among calls.
- **Quality:** rubric result, task class, source/evidence checks, review and rework.
- **Drift:** change across workload mix, output quality, cost, tool schema, provider version, or failure rate.

For each level, set capture minimization, access, retention, deletion, correlation ID, sampling, and owner. Test that the captured record can be retrieved for a failure without treating an observability field as proof that a control fired.

Memory must follow an identified need. Distinguish working context, session/transient state, durable task checkpoint, user memory, and audit/event records. For each persisted layer, name owner, data source, write/read rules, retention/deletion, restore/fork lineage, and evaluation. A provider cache is a separate optimization with provider/model-specific pricing, TTL, prefix, and invalidation behavior; measure it at the selected version. Do not force memory or caching onto a workload that does not need it.

## Failure-mode review

| Risk | Evidence to inspect | Response to plan |
|---|---|---|
| Framework-first choice | Requirements written only after a vendor trial | Return to workload and candidate matrix; keep current baseline in comparison. |
| Context or tool-schema burden | Measured prompt/context traces by task and version | Reduce or route tools if the data shows cost, truncation, or latency impact; do not apply a universal percentage threshold. |
| Observability gaps | Missing trace-to-task/effect links or unaccounted cost | Add only the instrumentation needed to answer the unresolved questions; minimize sensitive content. |
| Adoption stall | Usage, support, training, workflow fit, and opt-out evidence | Interview affected users, address a named blocker, or stop/retire. Do not infer adoption from elapsed time or demo interest. |
| Cost overrun | Budget ledger includes retries, human review, tooling, and fixed cost | Enforce local spend/stop controls and reconcile receipts; never rely on an alert as a hard cap without testing. |
| Recovery failure | Interrupt/restart test and read-back of state/effects | Define idempotency, uncertainty handling, owner, and recovery route; retest after relevant changes. |

The shared-service stages are shown in [`../diagrams/shared-platform-adoption.md`](../diagrams/shared-platform-adoption.md).
