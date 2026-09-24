# Workload-first infrastructure selection

## Intake and decision procedure

1. **Describe the task.** Record inputs, desired outputs, data classes, users, tool calls, authority for each effect, and representative hard cases. Include the existing human or deterministic process as a candidate baseline.
2. **Set operating constraints.** Name latency range, availability expectation, process restart/eviction behavior, recovery needs, retention, geographic/provider restrictions, budget owner, and who responds to incidents. Distinguish requirements from preferences.
3. **Decompose the candidate.** For each product, identify harness/orchestrator, runtime/state owner, model/provider, tool protocol/adapters, and application policy. Record which component actually owns retries, timeouts, cancellation, secret scope, idempotency, persistent state, and receipts. A persisted object is not proof that a process is continuously running.
4. **Build an evidence matrix.** For each requirement, record a versioned documentation link or local test, what it establishes, remaining assumption, and a falsifiable test. Product documentation is evidence of a documented capability, not workload fit or comparative quality.
5. **Select, defer, or simplify.** Choose only if the evidence and trade-offs meet this workload's constraints. Deferral is a valid decision when a requirement is unknown. Prefer the least complex candidate that meets the evidence-backed needs; add agents, graph state, or a protocol only for a demonstrated requirement.

| Need to resolve | Compare | Useful evidence | Common category error |
|---|---|---|---|
| Conditional control flow | Direct program, orchestrator/harness, or runtime workflow | Same-task traces; branch and retry outcomes | Equating product name with fit |
| Durable progress | Application store, job/runtime state, or provider conversation state | Kill/restart test and state read-back | Treating persistence as liveness or recovery proof |
| Tool interoperability | SDK/API or protocol such as MCP | Versioned schema, auth scope, consent, failure/timeout test | Calling a protocol a framework or safety boundary |
| Multi-worker coordination | Single process, queue/workflow, or team orchestration | Dependency, handoff, duplicate-effect and recovery tests | Assuming more agents make parallel work faster |
| Observability | Local event/trace pipeline or provider tooling | Trace-to-effect correlation, coverage, cost and retention test | Treating a dashboard as correctness proof |
| Context and memory | No persistence, session state, task store, user memory, retrieval, or cache | Need, retention, deletion, retrieval-quality and privacy evidence | Adding “long-term memory” by default |

An architecture's layers may be provided by one product or several systems. Record the owners and seams explicitly; see [`../diagrams/layered-options.md`](../diagrams/layered-options.md).

## Workload example: code-review preflight

This is a constructed scenario, not a report of an implemented service. The required outcome is a review suggestion that references an actual diff and does not merge or publish changes. Inputs include the pull request diff, repository rules, and selected tests; an auth/security scan is relevant only when a diff touches those areas. A human still owns approval of any externally visible review or merge action.

Compare a simple script plus model call against an orchestrated workflow only if conditional steps, restart, audit, or multiple tools are required. Document which component fetches the diff, chooses optional checks, writes the suggestion, and prevents duplicate publication. A hypothetical pipeline is shown in [`../diagrams/code-review-workflow.md`](../diagrams/code-review-workflow.md). It is a test design; it is not a claim that any named framework supplies the complete policy.

## Layer and protocol notes

- A harness directs turns and tool selection. A runtime executes work and may provide state, queueing, retries, or scheduling. Verify each candidate's documented division of responsibility.
- A model/provider generates outputs and may supply tools or state APIs. Pin model and provider revision in an evaluation; an API's advertised feature list does not establish performance on the workload.
- MCP specifies a protocol for connecting hosts, clients, and servers. It does not select a workflow engine, make an arbitrary server trusted, prove consent or authorization, or bound tool effects. Define those at the application/control boundary.
- “Agentic mesh,” multi-agent framework names, observability vendors, or “AI Studio” are architecture labels, not workload evidence. Define interfaces and compare their operating cost and failure modes before adopting them.

## Product documentation ledger

Record URL, access date, version or revision when available, the capability actually documented, and the local test still required. [`vendor-capability-ledger.md`](vendor-capability-ledger.md) records the current source checks used in this bundle. Reopen vendor sources before a consequential decision; old examples and source-control hashes do not make external documentation current.
