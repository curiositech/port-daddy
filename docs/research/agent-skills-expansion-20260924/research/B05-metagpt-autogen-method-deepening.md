# B05 method deepening: MetaGPT and AutoGen

Status: frozen research guide for Terra. Scope is restoration of the original useful methods in `hong-et-al-2024-metagpt` and `wu-2023-autogen`, with paper and versioned implementation claims separated. This is not a replacement skill and is not a claim of novelty. The source ledger beside this report records the exact sources and access limits.

## Reviewer finding

Both bundles contain reusable operational ideas, but several references convert a paper’s design into guarantees or general engineering laws. Preserve the methods below; remove universal thresholds, unsupported complexity/performance claims, and invented guarantees. The main factual corrections are: MetaGPT’s shared message pool is not evidence of a durable, scalable broker or strict typed schema; AutoGen conversation-centric design does not mean there is no controller in every topology; LLM critics, executors, and human participation do not by themselves guarantee correctness or safety.

## MetaGPT (Hong et al., arXiv:2308.00352v7, 2024-11-01)

### Method worth retaining

The paper’s software-development SOP is a concrete artifact pipeline: Product Manager turns the user request into a PRD (user stories and requirements); Architect makes system design including file/data/interface decisions; Project Manager breaks work into assigned tasks; Engineers implement; QA provides tests/feedback. The valuable principle is to make each handoff explicit about its prerequisite and expected deliverable, so downstream work can be grounded in a design artifact instead of reconstructing intent from chat. It is a domain-specific workflow proposal, not a universal best decomposition and not a proof that an SOP is followed “perfectly every time.”

The coordination mechanism described in the paper is a shared message pool plus role-specific subscriptions and dependency prerequisites: a role can act after required upstream material is available. The paper’s distinction from free-form role chat is useful: publish work products to shared context, have the consumer retrieve the needed material, and avoid asking an upstream role to repeat it. Describe this as the paper’s logical coordination model. It does not establish persistence, replay, delivery guarantees, a public broker API, or asymptotic network/runtime savings.

Role prompts specify such things as profile, goal, constraints, context, and skills. Preserve specialization as an interface-design aid: state the role’s responsibility, input, output, and acceptance evidence. Do not claim a role is a bounded expert in a formal sense, that specialization monotonically reduces errors, or that each role should own exactly one artifact universally.

Executable feedback is the strongest practically transferable method: when code is produced, run the relevant tests, surface the observed output/errors to the code-producing step, and allow a bounded repair loop. The paper’s implementation describes up to three retries in its setup; report that as a paper-specific configuration, not a framework guarantee or a generally optimal retry limit. Passing a finite test suite is evidence about those tests, not proof of correctness, security, or production readiness.

### Example and checks to restore

Use a small, inspectable “CSV summary CLI” exercise. The PM emits requirements with concrete inputs/outputs and edge cases; Architect emits module/interface choices; PM/project planner emits task dependencies; Engineer produces code; tests execute against empty input, malformed rows, and a known fixture. Include one deliberately omitted requirement and check whether the handoff exposes it before implementation. Keep artifacts as ordinary documents first; introduce machine-checked schemas only when the consumer and validator actually enforce them.

Test the coordination assumptions independently of a model: (1) a role with unmet prerequisites does not act; (2) an unrelated message does not satisfy a prerequisite; (3) a malformed artifact is rejected only if a real validator is wired; (4) a test failure is delivered back to the responsible role; (5) retry exhaustion ends visibly with unresolved status; (6) success of a narrow test suite is not mislabeled as overall acceptance. In the pinned MetaGPT v0.8.1 source, `Environment.publish_message` routes by recipient addresses and the environment runs role steps concurrently. The `Role` source has a per-role message buffer and watched action causes. This concrete implementation is distinct from the paper abstraction; unmatched recipient routing logs but returns success, so do not assert reliable delivery without a caller-visible check.

### Claims to correct or delete

- The skill’s thresholds (`<3`, `3–7`, `>7`, pub-sub at `>5`, “mandatory” schemas) have no support in the paper. Replace with a decision based on whether tasks have distinct prerequisites/artifacts, measured coordination overhead, and an actual need for shared context.
- “Structured communication prevents hallucination cascades,” “eliminates ambiguity,” and automatic objective handoff validation overstate intent. Structured artifacts can make omissions inspectable; they do not prevent false content or guarantee schema conformance.
- The message-pool reference invents timestamps, typed-message metadata, history queries, persistent delivery, deterministic replay, scalable-100+ claims and central-broker engineering guarantees. Retain only shared pool, role subscriptions, prerequisites, and the paper’s rationale. The O(n²)-versus-O(n) statement compares hypothetical all-to-all links with a centralized channel count, not measured messages, traffic, compute, or latency; remove it as a performance result.
- “SOPs are followed perfectly every time,” “zero search,” universal fixed role boundaries, and the recommendation to maintain 50+ SOPs are extrapolations. Present any proposed SOP catalog as a design option needing local evaluation.
- The role-specialization reference’s compounding-error arithmetic assumes independent identical errors; the paper does not validate that model. Do not infer that adding roles always improves quality. The paper’s ablations are small, task- and metric-specific.
- Do not promote the paper’s introductory “100% task completion” phrasing into a universal success rate. The SoftwareDev study uses a small set of representative tasks and reports rubric scores including executability; name its sample, metric, model/setup, and table. Human revision burden, execution, and correctness are different outcomes. The executable-feedback ablation reports gains on HumanEval/MBPP under that experiment; it does not establish production readiness.
- Existing Mermaid diagrams are not literal ASCII art, but their semantics need correction: the sequence diagram adds a formal validation/veto/automatic coordination contract beyond the paper; the decision flow codifies unsupported numeric cutoffs; the mindmap contains unsupported performance/reliability assertions. Redraw around artifacts → prerequisites/subscription → role action → observed executable feedback → bounded retry and explicit unresolved exit.

### Bounded validation plan

For an implementation, collect per-stage artifact completeness, prerequisite violations, test failures, repair count, unresolved exits, and human corrections across the same task set. Compare the artifact/SOP workflow with a direct single-agent baseline and a free-form multi-agent baseline under the same model, tools, token/time budget, and acceptance tests. Have a blinded reviewer score correctness separately from executability and completeness. Include tasks with missing/contradictory requirements, test gaps, and a failing dependency. Do not treat lower token count or more roles as quality without evidence.

## AutoGen (Wu et al., “AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation,” arXiv:2308.08155; COLM 2024)

### Method worth retaining

AutoGen models participants as conversable agents that exchange messages; an agent may use an LLM, a human, tools/code execution, or combinations. A conversation is both computation (what an agent proposes or executes) and control flow (who speaks next, when a reply function runs, and what ends the exchange). The design insight is to make message exchange and reply behavior composable, so some coordination can be expressed as agent behavior and termination/reply conditions rather than one monolithic application loop.

Do not turn that into “there is no central controller.” The paper and official AutoGen 0.2 documentation include both direct two-agent patterns and group chat managed by `GroupChatManager`, which selects/schedules speakers and broadcasts messages. Topology is a design choice: fixed order is inspectable and predictable; dynamic/LLM-selected speakers support flexible routing but add selection error and audit burden. The framework exposes configuration; it does not guarantee that an LLM-selected topology is appropriate.

Human involvement is configurable in the 0.2 `UserProxyAgent`: `NEVER`, `ALWAYS`, or `TERMINATE`. Keep the exact behavior tied to versioned docs. `ALWAYS` prompts on each received message; `TERMINATE` requests input on termination/auto-reply limits; `NEVER` does not request input. The paper’s idea of a human as a conversational participant is useful, but human presence is not a safety approval protocol, and skipped input is not a general automatic fallback guarantee.

Execution feedback is useful when the executing agent returns concrete output or error messages into the conversation, allowing a writer to revise. Bound both consecutive auto-replies and overall/group turns; they are distinct controls. Define an explicit termination predicate and test both successful and exhausted paths. Use isolated execution (the 0.2 docs describe Docker-capable configuration) with timeout and controlled workspace for untrusted code; a successful executor result proves only what was run.

### Example and checks to restore

Use two contrasting traces. First: Assistant proposes a short calculation, UserProxy executes it, and the executor’s actual result/error is returned as a message. Second: a three-role group chat uses an explicit speaker policy and bounded rounds; show the manager’s role in selection and message distribution. Add a human-input variant and document exactly when it blocks for input. Do not combine code review, execution, an LLM safety critic, and human approval into a single “all agents confirm” story.

Tests: (1) direct two-agent reply terminates on a concrete predicate; (2) a tool/code error is fed back and an edited attempt is distinguishable from mere repeated assertion; (3) the consecutive-reply cap and group `max_round`/overall turn cap are independently exercised; (4) group speaker selection obeys allowed transitions and termination; (5) malformed or unsafe code cannot execute outside the configured sandbox; (6) critic says “safe” while a deterministic policy test rejects the artifact; (7) each human-input mode follows its documented prompt behavior; (8) provider/tool exceptions and exhausted retries end in a visible failure state. Preserve transcripts as an audit aid, but do not call conversation history the complete system state: tool side effects, external resources, hidden model state, and omitted/truncated context are not captured by text alone.

### Claims to correct or delete

- The reference that conversation “eliminates need for any central control” is too broad. Distinguish decentralized-looking pairwise patterns from managed group chat and other application-specific controllers.
- “Any agent can message any other,” unrestricted topology, effortless scaling, no orchestration changes when adding capabilities, and conversation as complete state are not universal guarantees. The actual allowed participants, routing, history, tools, and speaker selection are configured.
- The code-generation example’s critic “veto power,” “no security violations detected,” and “all agents confirm completion” are invented assurances. LLM review is advisory unless an independently enforced gate controls execution or release.
- The human-backend reference says a person may fail to answer and the agent automatically continues. The documented 0.2 modes specify when input is requested; they do not make this universal non-response behavior. “Seamless mid-game switching” and configuration-only switching should be presented only as a specific paper application or an implementation feature actually built.
- “3–5 turns” and other unsourced iteration counts should be removed. Iteration helps only when feedback adds relevant evidence; repeated attempts can repeat the same failure.
- Mindmap “no central controller” conflicts with GroupChatManager. Sequence diagrams merge separate example applications into a single canonical pipeline. State diagram should show computation and control as distinct responsibilities, then make the direct two-agent and managed group-chat variants explicit; label human/tool reply paths and bounded termination.
- Results from MATH, ALFWorld, OptiGuide, or human-in-loop examples are paper-specific configurations and samples. Preserve exact task, metric, baseline, model, and sample context when using numbers. Qualitative demonstrations do not establish universal uplift.

### Bounded validation plan

Run matched conversation tasks across fixed-order, manager-selected, and direct two-agent patterns, with identical model, tools, history budget, and acceptance tests. Report task success under external tests, number of tool calls, correction quality, turn count, invalid speaker choices, human wait time, and unresolved termination separately. Include adversarial cases: an executor error that looks superficially successful, a critic accepting a malicious artifact, a manager selecting an irrelevant speaker, and a human prompt left unanswered. Compare deterministic routing and LLM routing; do not present flexibility as a win unless performance and auditability both meet declared targets.

## Book candidate (not a novelty claim)

Candidate lesson: **“Conversation is control state only when its transitions and side effects are observable.”** The paired frameworks expose a useful distinction between artifact/prerequisite pipelines and conversation/reply-control pipelines. Potentially teachable contribution would be an evidence-backed comparison plus failure-injection exercise showing where shared text does and does not establish state. Novelty is unassessed. Before proposing a Book chapter, search the current Book outline and prior-art ledger; then evaluate with the two workflows above, a small reproducible task suite, blinded correctness review, transition/side-effect trace coverage, and a counterexample set. A candidate passes only if it yields a useful, reproducible design rule beyond restating MetaGPT or AutoGen.

## Diagram restoration instructions

Keep at least two Mermaid diagrams per skill, but make each correspond to a sourced mechanism and mark the scope/version. For MetaGPT: (1) role artifacts with dependency prerequisites and shared pool/subscription; (2) engineer test-feedback loop with configurable retry ceiling and unresolved exit. For AutoGen: (1) direct conversational reply loop versus GroupChatManager-controlled group topology; (2) computation/control separation with `UserProxyAgent` input modes, tool result/error, reply cap and termination. Remove diagrams implying guaranteed correctness, automatic safety veto, universal no-controller topology, or paper-wide numeric thresholds. The six original diagram sources were inspected; none is ASCII. They are Mermaid and need semantic revision, not format conversion.

## Source access boundary

Primary paper bodies and the cited MetaGPT v0.8.1 implementation files were opened. AutoGen official docs are explicitly the 0.2 documentation set; the official 0.2.35 repository tag was inspected as a source/version boundary, but the complete repository tree was not audited. The specific raw MetaGPT schema file fetch was inaccessible in the web reader; this guide makes no schema implementation claim from that unavailable file. Full direct links and access notes are in the source ledger. Modern successors are deliberately not used to rewrite 2023 claims.
