---
license: Apache-2.0
name: agentic-infrastructure-2026
description: |
  Plan, evaluate, and adopt agent infrastructure for a named workload. Use for agent runtime/framework selection, agent evaluation or observability plans, memory and tool boundaries, infrastructure cost controls, and organizational adoption. Covers workload-first comparison, risk and recovery planning, held-out evaluation, cost accounting, and staged rollout. Not a vendor ranking or a production certification. NOT for implementing a specific agent behavior (agentic-patterns), building a specific agent (ai-engineer), prompt optimization (prompt-engineer), or conventional ETL workflow design (jury_rig-architect).
allowed-tools: Read,Write,Edit,Bash,Glob,Grep,WebSearch,WebFetch
metadata:
  category: AI & Agents
  tags:
    - agents
    - infrastructure
    - frameworks
    - adoption
    - observability
    - evaluation
    - change-management
    - enterprise
  provenance:
    kind: first-party
    owners:
      - port-daddy
  pairs-with:
    - skill: multi-agent-coordination
      reason: Coordination patterns inform workload and control requirements.
    - skill: agentic-patterns
      reason: Behavioral patterns inform task traces and evaluation cases.
    - skill: agentic-app-architecture
      reason: Application shape, disclosure, state, and context decisions constrain infrastructure choices.
    - skill: agent-work-receipt-designer
      reason: Receipts provide evidence for observed effects and recovery tests.
  io-contract:
    kind: deliverable
    consumes:
      - kind: agent-infra-requirements-brief
        format: markdown
      - kind: framework-stack-plan
        format: json
    produces:
      - kind: architecture-decision
        format: markdown
      - kind: infra-plan-audit
        format: json
---

# Agent infrastructure planning and evaluation

Use this skill to choose and adopt infrastructure for a specific workload. Build the decision from required behavior, risk, data, and operating constraints. A product's documentation can establish that a capability is documented; it does not establish that the capability fits your workload, is enforced in your deployment, or outperforms another option.

## Start from the workload

Write down concrete tasks and their outcomes before selecting a framework. Include inputs, data classes, expected effects, users, tools, latency and availability needs, recovery behavior, and who can authorize each effect. Include at least one difficult or failure-prone trace. Separate requirements from preferences and open questions.

Then compare the system's layers rather than treating every product label as interchangeable:

- **Harness or orchestrator:** plans model/tool turns, routes control, and applies workflow transitions.
- **Runtime:** provides execution, scheduling, state, cancellation, timeouts, retries, and recovery semantics.
- **Model and provider:** supplies inference and provider-managed tools; version, latency, retention, and price can change independently of the harness.
- **Tool protocol and adapters:** define how clients discover and invoke tools. MCP is a protocol; it is not by itself an orchestration framework, sandbox, permission policy, or evidence that the connected tools are safe.
- **Application policy:** decides which principal may cause which effect and records the result. A framework feature does not replace this authority boundary.

A product may cover several layers. Record which layer each claimed capability belongs to and which component actually enforces it. Use [the layer diagram](diagrams/layered-options.md) to expose missing owners.

## Compare options by evidence

For each requirement, record (1) required behavior, (2) candidate capability and source/version, (3) evidence type, (4) gap or assumption, and (5) a test that would demonstrate the behavior in your system. Distinguish vendor documentation, a local test, an evaluation result, and a deployed observation. Do not infer comparative quality from capability lists.

A workload may need no agent framework: a deterministic program, single model call, job queue, or human process can be the baseline. Compose a graph or multiple agents only when the task dependencies, branching, parallelism, or recovery needs warrant that complexity. Define the smallest architecture that can be compared fairly, then measure the cost of the additional layers.

The former recommendation to use OpenAI's Assistants API for a simple retrieval assistant is obsolete: OpenAI's [migration guide](https://developers.openai.com/api/docs/assistants/migration), checked 2026-09-24, says the API was sunset on August 26, 2026 and points to Responses and Conversations APIs. This is a dated product-doc statement, not a recommendation that those APIs fit every workload.

## Plan an evaluation before a pilot

Create a task set that represents intended use and foreseeable failure modes. Keep tuning examples separate from held-out evaluation tasks. Use the same model, tools, data, prompts, effect permissions, and stopping rules across a baseline and each candidate unless the comparison explicitly tests one of those variables. If versions differ, record them.

For each run, preserve task ID, candidate/version/configuration, rubric and judgment source, task result, unsafe or unauthorized effect, duplicate effect, retry/timeout, latency, provider and infrastructure cost, human review time, and recovery outcome after interruption. Report denominators and task-level failures, not just an average or acceptance rate. Show uncertainty appropriate to the sample and keep any promotion threshold labeled as a local policy choice. A plan or checklist is not an executed evaluation.

[The evaluation cycle](diagrams/evaluation-cycle.md) shows a controlled comparison and its stop/revise route. The exact local protocol, including a small hand-checkable task-set design, is in [`references/evaluation-and-cost-method.md`](references/evaluation-and-cost-method.md).

## Control operating costs and failure behavior

Estimate cost from workload volume and measured usage, not a generic per-agent or per-task figure. At minimum, account for model/provider calls, tool and runtime compute, storage and observability, retries, human review, integration and maintenance. Make unit and time window explicit. A useful local metric is:

`cost per accepted task = total attributable cost / tasks meeting the predeclared rubric without an unauthorized or duplicate effect`

Include the cost of every attempted task in the total-cost numerator. The accepted-task denominator contains only tasks meeting the predeclared rubric without unauthorized or duplicate effects; separately report the full attempted-task count and all failed, incomplete, unsafe, and duplicate cases so none disappear from the report. Set caps and alert actions from the organization's actual tolerance and billing controls. Declare retry limits, end-to-end deadlines, cancellation behavior, idempotency strategy, circuit-breaker or stop conditions, and a human or operator escalation path. These controls mitigate risks; a plan declaration does not prove that deployed code enforces them.

See [`references/evaluation-and-cost-method.md`](references/evaluation-and-cost-method.md) for a worked unit-economics calculation and retry ledger.

## State, tools, observability, and memory

Name the owner and lifecycle for transient context, task state/checkpoints, user memory, event/audit records, and provider caches. For each, record source/version, retention, access, deletion, restore/fork behavior, and whether it is needed at all. Do not add a vector store, persistent memory, cache, MCP server, or multi-agent layer by default.

Observability can include request, execution trace, task quality, and drift signals. Pick the levels that answer the workload's questions; minimize sensitive capture, set retention, and test that traces correlate across model calls, tool effects, and recovery. A dashboard alone does not demonstrate data correctness or enforcement. MCP schema size and context consumption depend on the actual tool set and provider representation; measure your configuration instead of applying a universal percentage threshold.

## Adopt by staged evidence, not a fixed calendar

Name owners for engineering, product, security/privacy, operations, and affected users as applicable. Explain what the system does, what it cannot establish, who can intervene, where evidence is retained, and how to escalate. Gather a baseline before the pilot. When estimating return, count implementation and integration, infrastructure, model/tool spend, human review and rework, monitoring, training, maintenance, and retirement costs. State the time window, workload volume, successful-task denominator, comparison group, and excluded costs. Do not present a hypothetical calculation as achieved savings.

Define expansion gates from the consequences of error and the measured pilot: task quality, unsafe and duplicate effects, recovery, latency, total cost, support burden, and user impact. A gate may require further evaluation, narrower scope, remediation, or stopping. Do not force all workloads into the same approval, team-count, or rollout schedule.

See [`references/adoption-and-worked-examples.md`](references/adoption-and-worked-examples.md) for the preserved three worked examples and organizational method. The multi-team platform example is also shown in [the adoption diagram](diagrams/shared-platform-adoption.md).

## Audit the plan

`scripts/infra_readiness.mjs` exports `auditInfraReadiness(plan)` and can run as a CLI. It interprets the schema keywords used by this bundle, validates JSON-only input values and their types, rejects whitespace-only required strings, checks enum domains and numeric bounds, and enforces one effect-policy record per declared workload effect class. Its `pass` means **the plan is structurally complete against the declared planning contract**. It does not mean infrastructure is ready, secure, affordable, deployed, or empirically effective. Findings and `evidenceRefs` are declarations that reviewers must resolve independently.

- [`schemas/infra-plan.schema.json`](schemas/infra-plan.schema.json) defines the machine-readable contract. The API also asserts `reviewedAt` as a real ISO calendar date; external JSON Schema validators should enable `format` assertions if they need identical date checking.
- [`examples/sample-input.json`](examples/sample-input.json) is a constructed, not measured, plan.
- [`scripts/infra_readiness.test.mjs`](scripts/infra_readiness.test.mjs) runs static positive and negative cases. It has no provider, runtime, or external effects.

Run:

```sh
node scripts/infra_readiness.mjs --input examples/sample-input.json
node --test scripts/infra_readiness.test.mjs
```

An invalid or incomplete plan prints findings and returns a non-zero CLI exit code. Additional JSON properties are allowed so teams can preserve local planning fields; non-JSON JavaScript values (including undefined, functions, symbols, non-finite numbers, sparse arrays, accessors, custom objects, and cycles) are rejected rather than silently dropped. Extra properties do not satisfy missing required gates.

## Quality gates

A plan is reviewable when it names the workload and candidate layers; explains the selection or deferral; includes a controlled evaluation and baseline; assesses security and incident response; defines effect authority; and records cost, observability, and adoption treatment with evidence references or explicit scope rationale. Applicability can differ by workload, but absent fields and silent omissions are not evidence of irrelevance.

The auditor checks declarations only. Before a consequential rollout, separately inspect implementation and authority boundaries, then test denied and failure paths without producing external effects. See the references for a complete recipe.

## Boundaries

This skill supports infrastructure planning and evaluation, not operational safety certification, legal/compliance advice, guaranteed ROI, universal framework rankings, or live agent control. For a concrete workload, cite current primary product documentation and verify local behavior with controlled tests. Keep synthetic examples labeled as synthetic.

## Diagrams

- [Layered system options](diagrams/layered-options.md)
- [Evaluation cycle](diagrams/evaluation-cycle.md)
- [Conditional code-review task](diagrams/code-review-workflow.md)
- [Controlled migration comparison](diagrams/migration-comparison.md)
- [Research message and state-control patterns](diagrams/research-control-patterns.md)
- [Shared-platform adoption](diagrams/shared-platform-adoption.md)

## Sources and detailed methods

- [`references/workload-and-framework-fit.md`](references/workload-and-framework-fit.md)
- [`references/evaluation-and-cost-method.md`](references/evaluation-and-cost-method.md)
- [`references/adoption-and-worked-examples.md`](references/adoption-and-worked-examples.md)
- [`references/vendor-capability-ledger.md`](references/vendor-capability-ledger.md)
- [`references/evidence-scope.md`](references/evidence-scope.md)

## Bundle navigation

[provenance index](provenance/INDEX.md), [tests index](tests/INDEX.md).
