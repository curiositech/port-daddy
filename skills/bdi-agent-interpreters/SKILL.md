---
name: bdi-agent-interpreters
description: Implement an executable BDI agent cycle with events, context-guarded plans, intention stacks, selection functions, and belief revision. Use when designing or debugging AgentSpeak-style runtimes or concrete BDI program semantics. NOT for high-level BDI adoption, organizational modeling, norms, or hypertree team planning.
license: Apache-2.0
metadata:
  provenance:
    kind: semantic-merge
    sources: [bdi-agent-design-mora, bdi-models-and-systems-reducing-the-gap, bdi-models-and-systems-reducing-the-gap-paper, agentspeak-bdi, agentspeak-l-bdi-agents-speak-out-in-a-logical-computable, agentspeak-l-bdi-architecture]
---
# BDI Agent Interpreters

Use this skill when a BDI design needs executable semantics. Specify the cycle so that two implementations would make the same transition given the same events and policy inputs.

## Interpreter contract

1. Define an event vocabulary: external observations, goal adoption/drop, action results, and failure.
2. Define the belief store and any observation-update adapter, including contradiction handling and whether absence means false or unknown. Name when an imported paper leaves belief update outside its model.
3. Give plans a trigger, context guard, and body. A plan is applicable only if its guard is satisfied under the current belief semantics.
4. Make selection functions explicit: event selection, applicable-plan choice, and intention scheduling. Record whether policy must be deterministic, fair, or priority based.
5. Define intention lifecycle: adopt, suspend, resume, succeed, fail, and abandon. Test a failed subgoal and a changed context mid-plan.
6. Keep a trace of each selected event, plan, and transition so that an unexpected action can be reconstructed.

```mermaid
flowchart LR
  E[Event queue] --> S[Select event]
  S --> M[Match plans]
  M --> G[Evaluate context guards]
  G --> C[Select plan]
  C --> I[Update intention stack]
  I --> X[Execute one step]
  X --> E
```

## Design boundaries

- `bdi-agent-architecture` owns the choice to use beliefs, desires, intentions, and the reconsideration policy at the model level.
- AgentSpeak-style plans are context-sensitive recipes; they do not themselves prove achievement. Name the interpreter, selection functions, and environment adapter. A local transition does not establish message delivery, distributed agreement, authority, or an external effect.
- For Móra et al. conformance, keep paper-defined explicit negation, Event Calculus, abductive feasibility, and preference-guided intention revision separate from a locally designed observation-update adapter and effect enforcement.
- Belief revision with inconsistent information is a separate policy choice. Do not assume an imported paraconsistent or abductive method is required for every implementation.
- For organizational accommodation use `bdi-organizational-modeling`; for obligations and prohibitions use `bdi-normative-reasoning`.

## Source-bound checks

- Read `sources/agentspeak-l-bdi-agents-speak-out-in-a-logical-computable/references/evidence-scope.md` and its transition/environment diagrams when tracing a running interpreter.
- Read `sources/agentspeak-l-bdi-architecture/references/evidence-scope.md` and its interpreter/protocol diagrams when a local agent interacts with other services.
- Read `sources/bdi-models-and-systems-reducing-the-gap-paper/references/paper-scope-and-conformance.md` before claiming conformance to the cited BDI paper.
- Read `sources/bdi-agent-design-mora/references/evidence-scope.md` before applying paraconsistent revision to policy or authorization decisions.

## Source bundles

All original files remain under `sources/<original-name>/`. Read `sources/agentspeak-bdi/` and `sources/agentspeak-l-bdi-architecture/` for AgentSpeak design; `sources/agentspeak-l-bdi-agents-speak-out-in-a-logical-computable/` for the second literature import; `sources/bdi-models-and-systems-reducing-the-gap/`, `sources/bdi-models-and-systems-reducing-the-gap-paper/`, and `sources/bdi-agent-design-mora/` for operational revision variants. Compare duplicate claims before reuse; verify source-dependent results against the primary papers.
