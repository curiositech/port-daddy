---
name: provable-action-adjudicator
version: 0.1.0
description: >
  A runtime reference monitor that intercepts every proposed agent action,
  evaluates it against a policy DAG compiled from natural-language axioms, and
  returns a verified permit or deny verdict before execution proceeds. Policy
  axioms are authored in natural language, auto-formalized offline into Datalog
  (for relational/provenance policies) or Lean 4 decidable-arithmetic proofs
  (for numeric constraints), then evaluated at sub-millisecond to microsecond
  latency via aspect-woven join points at tool-call boundaries. The adjudicator
  is the provable containment layer for multi-agent systems: complete mediation,
  isolation, and formal correctness are the three non-negotiable properties.
author: soma-jury_rig-graft
tags: [formal-verification, policy-enforcement, reference-monitor, lean4, datalog, active-inference, agent-safety, containment]
pairs-with: []
license: Apache-2.0
allowed-tools: Read,Write,Edit,Glob,Grep
metadata:
  provenance:
    kind: imported
    source: workgroup-ai / jury_rig skill library (rehomed 2026-07-04)
---

# Provable Action Adjudicator

## When to Use

- An agent (or agent swarm) will invoke tools, write files, call APIs, or modify
  shared state, and you need a machine-checkable guarantee — not a heuristic
  filter — that those actions satisfy a stated policy before they execute.
- You are building a containment story for a multi-agent system: the orchestrator
  assigns tasks, but no individual agent should be trusted to self-police; a
  tamper-resistant interceptor must own the verdict.
- Natural-language policy documents (data-handling requirements, access controls,
  deontic obligations like "must log every PII read") need to be compiled into
  checkable axioms that survive iteration of the policy text without manual
  re-coding of enforcement logic.

NOT for:
- Post-hoc auditing or logging where actions have already executed — this skill
  is strictly preventive (and optionally corrective for soft constraints).
- Policies that require full LTL model checking over an unbounded state space at
  runtime — that is PSPACE-complete; offline model checking is the right tool.
- Replacing prompt-level safety instructions or RLHF alignment — the adjudicator
  operates on structured action objects at the tool-call boundary, not on token
  streams.

## Core Concepts

**Reference monitor (RM):** The Anderson (1972) abstraction: a tamper-resistant
interceptor that is (1) always invoked before every security-relevant action,
(2) isolated from the agents it monitors, and (3) verifiable — its policy
evaluation logic must be auditable. In the agentic context, "always invoked"
means aspect-oriented join points woven at the tool-call boundary of the agent
framework (LangChain, AutoGen, or a custom harness). The RM suspends the action,
queries the policy engine, then resumes or aborts.

**Policy DAG:** A directed acyclic graph of policy axioms where edges encode
logical entailment or dependency. Each node is a rule in Datalog-with-stratified-
negation (Soufflé dialect). The DAG structure enables static analysis at
compilation time: contradiction detection (a rule that both permits and denies
the same action type), redundancy elimination, and subsumption checking (rule A
already covers rule B). The DAG is the compiled artifact; natural language is
the source.

**Autoformalization pipeline:** The offline process that translates natural-
language policy statements into Datalog rules or Lean 4 theorems. An LLM drafts
the formal representation; a static analyzer checks coverage (does the formal
rule entail every case the NL sentence intends?) and flags edge cases for human
review. This is research-grade for general NL but production-viable for
constrained policy domains (access control, arithmetic thresholds). The
compilation is expensive; the runtime evaluation of the compiled rules is cheap.

**Proof generation vs. proof checking:** For Lean 4 / decidable-arithmetic
policies (e.g. "amount < 10000 AND recipient in approved_set"), the Lean kernel
checks a pre-compiled proof in ~5µs (benchmarked on AWS Cedar). Proof
*generation* via tactic search takes seconds to minutes and must happen offline
during policy compilation. This separation is the architectural key to µs-latency
formal verification: never generate proofs at runtime.

**Deontic operators:** Beyond binary permit/deny, real policies encode
obligations (O: the agent *must* do X), permissions (P: the agent *may* do X),
and prohibitions (F: the agent *must not* do X). Deontic logic also admits
dispensations (waiving an obligation in a specific context) and conflict
resolution ordering (when O(A) and F(A) conflict, which wins). Conventional
engines (XACML, Rego, Cedar) model only P and F; obligation lifecycle requires
a deontic layer on top.

## Implementation Pattern

```
OFFLINE (policy compilation):
  for each NL policy statement s:
    draft ← LLM.formalize(s, target_language="datalog")
    coverage_gaps ← static_analyzer.check_entailment(draft, s)
    if coverage_gaps:
      human_review(draft, coverage_gaps)
    policy_dag.add_rule(draft)
  policy_dag.check_contradictions()          # abort if unsatisfiable
  policy_dag.check_redundancy()              # warn on subsumptions
  compiled_policy ← souffle.compile(policy_dag)   # produces native binary
  # For arithmetic constraints: also compile Lean 4 decide-proofs
  for each arithmetic_constraint c in policy_dag:
    lean_proof[c] ← lean4.compile_decide(c)  # ~µs at runtime

RUNTIME (per agent action):
  action ← agent.propose_action()           # suspended, not yet executed
  verdict ← reference_monitor.evaluate(action, compiled_policy, provenance_dag)
  if verdict == DENY:
    agent.receive_denial(reason=verdict.explanation)
    return                                   # action never executes
  if verdict == PERMIT_WITH_OBLIGATION:
    action.add_postcondition(verdict.obligation)   # e.g. "log this read"
  execute(action)
  provenance_dag.record(action, verdict, timestamp)

reference_monitor.evaluate(action, policy, dag):
  # Build Datalog substrate from current state + provenance dag
  substrate ← {
    "agent_id": action.agent,
    "action_type": action.type,
    "target": action.target,
    "caller_chain": dag.ancestors(action.agent),
    "prior_actions": dag.recent(window=policy.lookback),
  }
  # Evaluate compiled Soufflé binary against substrate
  result ← compiled_policy.query("permit(Action)", substrate)
  if result.is_arithmetic_constrained:
    result.formal_check ← lean_kernel.check(lean_proof[result.constraint], substrate)
  return result.verdict

LATENCY TARGETS:
  Datalog/Soufflé evaluation:    < 1ms   (FORGE benchmark)
  Lean 4 arithmetic check:       ~ 5µs   (Cedar benchmark)
  AgentSpec rule evaluation:     1–10ms  (AgentSpec benchmark)
  Behavioral contract check:     < 10ms  (AgentBC benchmark)
  Acceptable total overhead:     12–38% end-to-end task time (FORGE on τ²-Bench)
```

**Enforcement modes (minimum two):**
- *Preventive:* Block before execution. Default for hard constraints and all
  prohibitions.
- *Corrective:* Allow execution but immediately trigger a compensating action
  (e.g. revoke a credential after a policy-violating write). Default for soft
  constraints and obligation violations where rollback is possible.

**State substrate and provenance DAG:** The policy engine is stateful. "Agent X
accessed Y because agent Z delegated to it" is a relational fact the Datalog
engine needs. Maintain a provenance DAG of (action, agent, timestamp, causal
predecessor) tuples. This is the substrate Datalog rules query for transitive
dependency checks. Every action record must be immutable once written.

## Key References

1. **FORGE** — "Formal Policy Enforcement for Real-World Agentic Systems,"
   arxiv:2602.16708 (May 2026). Datalog/Soufflé reference monitor with aspect-
   woven interception for LangChain/AutoGen/VS Code Copilot. Sub-millisecond
   median authorization latency, tens of thousands of decisions per second,
   12–38% end-to-end overhead on τ²-Bench across GPT-5.2/Claude Opus/Gemini 3
   Pro. Includes formal correctness theorem and proof sketch. Two real-world
   deployments. **Current production baseline.**

2. **AgentSpec** — Wang et al., arxiv:2503.18666, ICSE 2026. Three-tuple rule
   DSL (triggering event, predicate set, enforcement function sequence). Multi-
   domain: code-execution agents, embodied agents, autonomous vehicles. >90%
   prevention of unsafe code agent actions, 100% AV compliance, millisecond-
   level per-action overhead. Peer-reviewed at ICSE.

3. **Agent Behavioral Contracts (AgentBC)** — arxiv:2602.22302. ContractSpec
   YAML DSL with hard/soft constraint separation, drift monitoring via Ornstein-
   Uhlenbeck dynamics (formal bounding theorem), and recovery mechanisms. 1,980
   sessions across 7 models from 6 vendors. <10ms per-action overhead, 88–100%
   hard constraint compliance.

4. **Lean-Agent Protocol** — arxiv:2604.01483, github:arkanemystic/lean-agent-
   protocol. Lean 4 `decide` tactic for arithmetic constraints; AWS Cedar
   benchmark shows ~5µs kernel evaluation on warm cache. Establishes the proof-
   generation-offline / proof-checking-at-runtime architecture. Working
   open-source prototype; WebAssembly sandboxing and cryptographic audit
   signatures listed as future work.
