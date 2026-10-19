# A–M research and semantic reconciliation review — 2026-09-23

## Scope and method

This is a review supplement to the immutable phase-1 receipt
[a-m-inventory.json](a-m-inventory.json). I compared each non-identical
entrypoint with its resolved .agy source, read the substantive decision sections
rather than using file length, and recorded where source know-how is retained,
routed, or deliberately superseded. “Superseded” means an instruction conflicted
with a canonical boundary; it does not mean the source was discarded silently.
All non-entrypoint source files that passed the phase-1 safety filter remain in
the canonical bundle and are counted in the inventory.

The phase-3 edits below improve eight canonical skills. Claims from new research
are linked to primary material opened on 2026-09-23; the compact, task-facing
guidance lives in the corresponding reference files instead of in a generic
reading list.

## Concrete entrypoint dispositions

| Skill | Source know-how examined | Canonical disposition |
| --- | --- | --- |
| agent-context-partitioner | Offline EAC, persistent-homology, RANSAC, BIRCH, and DAG/METIS candidate partitions; causal closure; minimal handoff | Kept the algorithms/templates as offline proposal aids. Replaced online K-selection/spawn implications with authority-filtered preparation and explicit retrieval-space identity; preparation cannot admit a recipient. |
| agent-conversation-protocols | Request/response, fan-out, supervisor, debate, critique, consensus, blackboard, FIPA-style interaction taxonomy and termination advice | Extracted the pattern-selection taxonomy into [pattern-selection-boundary.md](../../../skills/agent-conversation-protocols/references/pattern-selection-boundary.md). The canonical closed epoch/sender-sequence/gather/fence procedure remains authoritative. Framework defaults and fixed round/confidence constants were not adopted as universal protocol rules. |
| agent-creator | Primitive-selection tree, lifecycle workflow, failure modes, worked examples, and quality gates | Retained the source workflow and examples. Added an effect-boundary contract: inventory effects, prefilter authorization, use idempotency keys, independently verify outcomes, and reconcile timeout uncertainty before retry. |
| agentic-calendar-coordination | Availability, constraints, conflict/negotiation decisions, examples, quality gates, and reference routing | Retained the source decision procedure and bundle material; the differing entrypoint wording was normalized without removing the scheduling know-how. No source rule grants authority to commit a calendar change. |
| agentspeak-bdi | Events, beliefs, plans, intentions, failure/retry, and AgentSpeak operational references | Retained the executable BDI/plan-selection procedure and copied the source reference material. The canonical bundle's references make operational semantics available without treating declarative plans as external-effect proof. |
| alphago-deep-rl | Policy/value networks, MCTS, self-play, evaluation, failure modes, and source diagrams/references | Retained the source learning/evaluation procedure and its useful package assets; canonical routing separates game-policy research from a claim that a learned policy is safe to deploy. |
| bad-faith-rhetoric-detector | L3 cues, callsite decomposition, detector failure modes, examples, and reference index | Retained the detector’s cue taxonomy and counterexamples. The canonical callsite decomposition keeps a rhetorical signal from becoming a truth or intent verdict. |
| bdi-agent-design-mora | Paraconsistent belief handling, explicit versus failure negation, desire/intention separation, revision triggers, and conflict strategies | The destination entrypoint is byte-identical to the resolved source. Its references retain abduction, revision constraints, event calculus, preference over revisions, and attention triggers; no source theory was narrowed away. |
| beautiful-cli-design | Decision points, visual system rules, failure modes, worked examples, and quality gates | Retained the source CLI design process and package references. Canonical navigation/index material was added around it, not substituted for its visual and interaction guidance. |
| build-coop-ide-gpui | Dependency map, collaborative-surface decisions, current implementation truth, failure modes, and phased gates | Retained the source implementation procedure and reference bundle. Canonical routing preserves the boundary between a collaborative surface and the authority/runtime that powers it. |
| context-economics-for-agent-swarms | Context as budget, state, and communication resource; compaction, digests, metering, degradation cascade | Retained the economic/measurement decisions and worked swarm example. Added halt and authority gates so budget accounting cannot be read as permission to launch or disclose. |
| cryptoeconomic-protocol-security | Five named attack classes, defense tree, settlement examples, evaluation assets | Kept the distinct source artifacts and security analysis material. Replaced the closed five-class framing with open threat-family analysis and explicit evidence/settlement limits, preventing taxonomy coverage from being mistaken for security proof. |
| dag-cycle-analysis | Graph mental models, cycle-detection decisions, failure modes, examples, quality gates, and support assets | Retained the source procedure and useful assets. Canonical routing adds structured navigation only; algorithmic cycle analysis remains intact. |
| empirical-systems-evaluation | Experimental design, automated/human metrics, tests, intervals, sample sizing, baselines, threats, and reporting | Retained the source empirical workflow and assets. Added a validity protocol for estimands, independent oracles, paired draws/common random variates, equal-budget single- versus multi-agent baselines, retry/cost accounting, and protocol amendments. |
| hierarchical-skill-repr | Hierarchical skill abstraction, options/subgoals, representation choices, failures, and worked examples | Retained the source representation and evaluation guidance with its reference material. Canonical routing does not equate a skill representation with authorization to execute an option. |
| hsts-planning-scheduling | State variables, behavioral envelopes, commitment levels, bottleneck/conflict partitioning, and constrained search | The destination entrypoint is byte-identical to the resolved source. Its copied references preserve planning/scheduling unification, envelopes, bottleneck detection, and stochastic estimation. |
| logical-fallacy-detector | Fallacy categories, detection pipeline, output contract, ambiguity/failure handling, and examples | Retained the source detection procedure and supporting references. The output remains a diagnostic with evidence, not a conclusion about a speaker’s intent or correctness. |
| make_copy_and_media_human | Audience-aware writing process, dialects, shibboleths, examples, and review failures | Kept the source process and non-conflicting reference material. Canonical additions route it through reader harm, visual comprehension, teaching order, and artifact review rather than deleting the source craft knowledge. |
| manager-driven-team-orchestrator | Manager/worker orchestration, role selection, fork guidance, failures, example, and gates | Retained the management workflow while making its packet, review, correction, and terminal contracts explicit. Generic orchestration language no longer implies that a manager may silently authorize worker effects. |
| mechanism-design-for-agent-labor | Fixed, complexity, reputation, and market-responsive bond mechanisms; escrow lifecycle; oracle design; incentive compatibility, adverse selection, collusion, and cold start | The destination entrypoint is byte-identical to the resolved source, and its reference/example/diagram material remains in the canonical bundle. The quantitative grids are source examples for a mechanism hypothesis, not reusable production defaults: choose and validate parameters against the market, threat model, and settlement oracle. |

## Phase-3 research additions

| Canonical skill | Changed practice | Primary material opened |
| --- | --- | --- |
| empirical-systems-evaluation | Separate outcome oracle from system telemetry; pair scenario/fault draws, state randomization, include equal-budget baselines and retry/review/coordination costs; record amendments. | [AI Agents That Matter](https://arxiv.org/abs/2407.01502) |
| agentic-patterns | Treat an external timeout as unknown; preserve intent, authority, idempotency key, receipt, and query path; re-ground before retry. Add workers only for independent branches after a single-worker plan. | [AWS durable execution idempotency](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/), [AgentRewind](https://arxiv.org/html/2608.14380v1) |
| multi-agent-coordination | Separate isolation, merge validation, claims, effect enforcement, and knowledge coordination. Evaluate a team against an equal-budget single-agent baseline and account for coordination. | [GitHub merge queue documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) |
| coordination-topology-architect | Model planning dependencies, communication routes, authority, and execution substrate independently; compare against a bounded single-agent baseline. | [Scaling Agent Systems](https://arxiv.org/html/2512.08296v3) |
| ai-engineer | Replace vendor presets, hard-coded vector thresholds, and fictional results with corpus policy, role/profile evaluation, immutable compatible spaceId, authority prefiltering, hybrid retrieval, and held-out calibration. | [AI Agents That Matter](https://arxiv.org/abs/2407.01502) |
| agent-creator | Require an effect inventory, authorization and policy check, idempotency, independent verification, safe termination, and reconciliation of unknown commits. | [AWS durable execution idempotency](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/) |
| competitive-cartographer | Build opportunity maps from customer job, substitute, official capability evidence, unknowns, and a kill test; do not infer novelty from an empty matrix cell. | [Amazon Bedrock AgentCore policy concepts](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-core-concepts.html) |
| llm-evaluation-harness | Keep structural quality scores separate from task efficacy; release only after paired held-out outcome evaluation with a fixed budget and independent oracle. | [SkillsBench](https://arxiv.org/html/2602.12670v4) |

The accompanying reference files contain the operational decision rules and
limitations. The empirical bundle also links its evidence-class and
matched-budget diagrams through its diagram index. No runtime was started, and
no source-receipt hash in phase-1 evidence was modified.
