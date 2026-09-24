# Evaluation, verification, and evidence lane — research handoff

Accessed 2026-09-24. Repository read-only; exact worktree `/Users/erichowens/coding/tmp/agent-skills-expansion-20260924`, branch `codex/agent-skills-expansion-20260924`, gitdir `/Users/erichowens/coding/port-daddy/.git/worktrees/agent-skills-expansion-20260924`; status clean at `origin/main`. I read the complete `SKILL.md` for all 12 requested IDs. I followed each explicitly linked operational reference relevant to the claim below; this was targeted reference reading, not a byte-for-byte read of every bundled asset. Primary sources below were opened/read (papers, official docs, or the originating research). A URL being cited does not imply its findings transfer to this product/workload.

Evidence rule across this lane: distinguish (1) syntax/schema acceptance, (2) local deterministic test, (3) finite-model exploration, (4) runtime observation, (5) pre-effect mediation, and (6) independent effect truth. A monitor can observe without preventing; a test harness can test only modeled inputs; an LLM judge agreement score is neither objective correctness nor execution success.

## 1. empirical-systems-evaluation

**Existing passages:** Sections 1, 3c, 5–8, 11, and the synthetic numeric output in §14. It already has strong additions on experimental units, paired scenarios, independent oracles, equal-budget baseline, and limits on broad generalization (§2a, §9).

**Primary-source evidence.** [ACM SIGSOFT Empirical Standards](https://www2.sigsoft.org/EmpiricalStandards/) (standards site opened; method-specific standards separate required/desirable attributes, validity, objectivity, reproducibility); [Ralph et al., “Empirical Standards for Software Engineering Research”](https://arxiv.org/abs/2010.03525) (primary standards paper; use method-specific standards, not a one-size checklist); [Kitchenham, Madeyski, and Brereton, “Meta-analysis for families of experiments in software engineering…”](https://link.springer.com/article/10.1007/s10664-019-09747-0) (primary replication/recalculation study; reports incorrect independent-group analyses in crossover/repeated-measures studies). These sources support choosing analysis from design/unit and publishing artifacts; they do not endorse the skill’s universal numeric thresholds.

**Correction / extension:** Decision tree §5 wrongly says “normality test, then choose parametric/non-parametric,” and §7 says stop post-hoc whenever omnibus p>.05. Tests of normality are not a design oracle; distribution, estimand, randomization unit, repeated measures, robust methods, and planned contrasts matter. Omit an omnibus gate when contrasts were pre-specified; distinguish familywise confirmatory tests from exploratory analysis. §3c’s fixed kappa bands and §8’s “30 runs floor / d=.5 minimum interesting” are house heuristics, not universal standards; label as optional planning examples and tie sample size to target estimand, variance, clusters, and practical threshold. §14 is explicitly fabricated-looking expected results; make every numerical result prominently synthetic/unrun, or convert to table-shaped blanks before readers copy it as evidence.

**Hand-checkable example:** Same 12 tasks run once under A and B gives 12 paired differences, not 24 independent tasks. If retries repeat a task, resample/task-cluster at task level; do not let five retries masquerade as five independent scenarios. If assigning agents by repo, repo is the cluster. Keep raw per-unit outcomes and show the 12 pairs when n is small.

**Diagrams to add/convert:** (1) causal design graph: task/repo/seed → randomized condition, with budget, reviewer, model snapshot and oracle shown as held-fixed or measured covariates; (2) analysis routing map from estimand+unit+dependence → interval/model → confirmatory/exploratory conclusion. Both are more informative than another generic test-selection flowchart.

**ASCII inventory:** §1 experiment-design decision tree; §4 proportion threshold; §5 test-choice decision tree; §7 multiplicity tree; §14 output block is illustrative ASCII/plain-text, not result evidence. Convert §§1,5 to Mermaid; render §14 as clearly marked synthetic example/table. Do not convert raw output into a claim.

**Book candidate:** A practical “same tasks, unequal exposure” worked example showing how agent-budget accounting, task clustering, retry policy, and an independent completion oracle change the estimand; assess manuscript overlap before calling novel. Not an empirical result.

## 2. runtime-verification-for-agents

**Existing passages:** §43 Arbiter, §68–135 checking/response decisions, §152–264 NoteMonotonicity compiled monitor, §358 finite-corpus gates; especially final explicit boundary at §411 and `references/monitoring-and-enforcement.md`.

**Primary-source evidence.** [Schneider, “Enforceable Security Policies”](https://doi.org/10.1145/353323.353382) (ACM DOI/abstract accessible; exact publisher full text was not available in this pass; characterizes which policies execution-monitoring mechanisms can enforce); [NIST SP 800-137, “Information Security Continuous Monitoring”](https://csrc.nist.gov/pubs/sp/800/137/final) (official summary and PDF read; monitoring supplies visibility/risk information and response decisions); [Chandra & Toueg, “Unreliable Failure Detectors for Reliable Distributed Systems”](https://hdl.handle.net/1813/7192) (Cornell-hosted original report read; detectors are explicitly unreliable, described by completeness/accuracy, and can make mistakes). Do not claim timeout is proof of crash or instrumentation can block effects absent custody of effect channel.

**Concrete extension:** Make the monitor contract an explicit tuple: event source and coverage, monitor state, clock/ordering assumptions, missing-event behavior, decision latency, independent consumer at the effect edge, and bypass inventory. “Alert,” “request halt,” and “prevent” are separate outcomes. A five-second timeout that emits `SUSPECTED_STALE` only observes; prevention requires controller to check that signal atomically before the write. Put monitor failure and telemetry loss in unknown/indeterminate, not healthy.

**Example:** A process monitor sees a `DELETE` event after it reaches the filesystem: it can alert and preserve evidence but cannot prevent the deletion. A broker mediating every delete can deny before syscall; test alternate descriptors, subprocess, UI, and network route to establish stated scope.

**Diagrams:** (1) three lanes: subject event → monitor verdict → independent actuator gate → effect/witness, marking the observation-only cut; (2) temporal trace with event time, ingest time, clock skew and late/lost telemetry leading to `unknown`, not a false ordering violation.

**ASCII inventory:** §§1–3 decision trees, §119 clock-skew logic, §133 algorithm notation are ASCII trees/code; §152 onward has TLA+/TypeScript. Convert only decision trees to Mermaid and retain actual code/spec. The bundle’s single required Mermaid figure is in the effect-boundary reference, not necessarily the root.

**Book candidate:** A paired trace where same monitor is used in detect-only vs broker-before-effect modes, showing detection precision separately from prevented effects. No execution claim absent actual measurement.

## 3. sandboxed-adversarial-test-harness

**Existing passages:** §74 halt gate, §92 scope, §129 Drydock process steps 1–10, §263 deterministic laboratory and §275 witness classes; linked refs on isolation, spend, lifecycle, adaptive tests and evidence were inspected.

**Primary-source evidence.** [NIST CSRC glossary, “Sandbox”](https://csrc.nist.gov/glossary/term/sandbox) (official definition: restricted controlled environment limiting resources to authorized set); [SQLite? no, use NISTIR 8397, “Guidelines on Minimum Standards for Developer Verification of Software”](https://doi.org/10.6028/NIST.IR.8397) (official publication; distinct test categories and verification activities, not proof of production behavior); [Schneider, “Enforceable Security Policies”](https://doi.org/10.1145/353323.353382) (publisher bibliographic page read; monitor enforcement class bounded by policy/mechanism). NISTIR 8397 body access not independently inspected here; source contribution is not relied upon for detailed checklist claims. The official sandbox definition and reference-monitor source were opened/read.

**Correction / extension:** Treat sandbox label as a claim about OS/kernel/hypervisor configuration, not a guarantee. The halt is correct; add an “effect witness truth source” before treating a timeout/no callback as blocked effect. `effect-uncertainty-and-adaptive-evaluation.md` already distinguishes ambiguous effect receipt and adaptive attackers. Require test matrix rows by bypass route × witness × outcome, plus reset/replay proof; a seeded deterministic simulator does not prove OS isolation or real billing behavior. In §290 promotion, list promotion claim and exact corresponding witness class; do not aggregate simulated, integration, or canary results into a single pass.

**Example:** An injected child tries (a) denied path, (b) inherited FD, (c) direct socket, (d) process-kill, (e) provider request. Assert deny from the boundary’s audit source; then independently query the target/provider after lost acknowledgement. Missing receipt = `UNKNOWN/HOLD`, not “no side effect.”

**Diagrams:** (1) TCB/effect-channel boundary map with adversarial inputs, broker and independent witness; (2) fault-injection lifecycle: seed+snapshot → action schedule → witness query → replay/triage, with simulated and external-custody evidence lanes separated.

**ASCII inventory:** §263 laboratory flow code and §302 capability table; convert laboratory lifecycle into state diagram, capability table stays table. There is already Mermaid in §129, but the source text section numbering has duplicate “4”/“4.5” that should be normalized during Terra integration.

**Book candidate:** Evidence-class matrix where “sandboxed simulated refusal” and “externally witnessed no-effect receipt” produce different allowed wording. Useful, but verify no manuscript duplicate.

## 4. provable-action-adjudicator

**Existing passages:** §53 effect gate, §63 cumulative claim ladder, §80 authority separation, §99 pre-effect diagram/protocol, §142 bypass suite, §206 evidence/unknown-effect rule; refs read include evidence classes, claim ladder/threat model, runtime vs offline, source ledger and benchmark protocol.

**Primary-source evidence.** [Anderson, “Computer Security Technology Planning Study,” Vol. II (1972)](https://seclab.cs.ucdavis.edu/projects/history/papers/ande72.pdf) (original author report hosted by UC Davis, 142 pages; opened PDF, web text extraction absent); [Schneider, “Enforceable Security Policies”](https://doi.org/10.1145/353323.353382) (ACM DOI/abstract read, publisher body access unavailable); [NIST SP 800-137](https://csrc.nist.gov/pubs/sp/800/137/final) (official source read for monitoring/response boundary). Anderson title/source identity verified by title page; precise page-level claims in report should be checked against PDF visually before quoting.

**Concrete extension:** Existing design is already unusually sound. Clarify that “pre-effect bound” is transaction-specific evidence of permit redemption before precisely scoped channel opening; it is not complete mediation. Complete mediation requires route inventory, control over each route, and adversarial witness coverage for stated scope. Add `effect_truth`: `confirmed-applied | confirmed-not-applied | unknown` separately from policy `ALLOW/DENY/INDETERMINATE`, so policy outcome cannot be misread as observed effect. Separate signatures/integrity from truthful source/custody.

**Example:** User approves “create issue X”; controller consumes nonce and emits intent. Network breaks after request; policy is ALLOW, effect is UNKNOWN until target query by independent witness. Never retry blindly: reconcile idempotency key first.

**Diagrams:** (1) revised §99 sequence with explicit lost-ack branch and independent reconciliation; (2) evidence ladder cross-tabbed against action lifecycle, showing each rung’s necessary observable artifact and what it cannot claim.

**ASCII inventory:** `SKILL.md` §99 Mermaid sequence already present; audit command examples are shell. Convert reference’s textual ladder/table into capability-vs-evidence table/diagram; preserve existing accurate sequence and add the ambiguous-ack branch.

**Book candidate:** Lost acknowledgment after exactly-once-looking one-use permit, demonstrating at-most-once permit redemption does not by itself prove exactly-once external effect. Check manuscript for extant Broker/receipt treatment.

## 5. llm-evaluation-harness

**Existing passages:** §53–164 method pipeline, judge and RAG patterns, §178–184 new release-efficacy protocol plus `references/skill-efficacy.md`.

**Primary-source evidence.** [Zheng et al., “Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena”](https://arxiv.org/abs/2306.05685) (full paper opened/read; reports judge-human agreement in their evaluated chat-preference settings and identifies position, verbosity, self-enhancement and reasoning limitations); [Shi et al., “Judging the Judges: A Systematic Study of Position Bias in LLM-as-a-Judge”](https://arxiv.org/abs/2406.07791) (primary paper search record, not full body inspected in this pass; supports evaluator/position tests, cite as secondary corroboration only); [Liu et al., “AgentBench: Evaluating LLMs as Agents”](https://arxiv.org/abs/2308.03688) (full paper opened/read; interactive agent tasks, 8 environment suite; demonstrates task execution evaluation is distinct from static answer pairwise review).

**Correction / extension:** LLM judge output is an evaluator observation, not ground truth. Keep calibration set human/verified labels held out from prompt tuning; randomize and swap candidate order, test identical-answer ties, verbosity/style attacks and judge-family/self preference; report agreement and task-level oracle metrics separately. Do not pool invalid/unparseable outputs into favorable scores. Composite Q&A pairwise skill-graft outcomes and the blog ([“Skills Actually Help: The Numbers”](https://windags.ai/blog/skills-actually-help-the-numbers)) show a positive skill-graft result on its stated rubric; this is not task execution, deployment, causal generalization, or a result for every skill. `data/skill-graft-bench.json` was absent at the assigned worktree root (`cat` returned no such file), so did not audit raw underlying data; parent-supplied summary only.

**Example:** On 40 fixed answer pairs, score with LLM judge and independent human preference labels; report exact agreement and candidate-order flip rate; separately run 10 deterministic acceptance tests that check an action’s effect. The former cannot substitute for the latter.

**Diagrams:** (1) test-item → system → deterministic checker/human/LLM judge → separate outcome columns; (2) judge calibration flow with held-out labels, order reversal, bias controls and escalation-to-human for disagreement.

**ASCII inventory:** §53/73/114/151/165 are textual architecture/pipeline blocks and code. Convert §53 into pipeline and §149 into regression loop; retain code. `references/skill-efficacy.md` needs explicit experimental unit + scope panel near results.

**Book candidate:** compact taxonomy of “answer preference”, “test-oracle correctness”, “tool/effect success” and “field usefulness”, using one intentionally diverging worked result; validate no existing chapter figure already does this.

## 6. semantic-conflict-prediction

**Existing passages:** §110 tree-sitter rationale, §§234–278 claim granularity/types, §§355–538 dependency graph, §§542–755 scoring pipeline, §§1018 onward limitations; 1,220-line skill warrants diagrams and progressive disclosure.

**Primary-source evidence.** [Tree-sitter official docs, “Basic Syntax”](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html) (official parser/query docs read; S-expression queries match grammar nodes); [Tree-sitter official grammar-writing guide](https://tree-sitter.github.io/tree-sitter/creating-parsers/3-writing-the-grammar.html) (official primary project documentation; grammar ambiguity and concrete syntax are explicit); [SORE/semantic merge conflict research—original study source needs exact bibliographic verification before Terra cites] — no specific academic source body validated in this bounded pass; avoid the skill’s unsupported quantitative confidence/probability claims absent a locally calibrated corpus.

**Correction / extension:** Tree-sitter yields syntax trees, not semantic name resolution/type behavior for every grammar/configuration. Imported scopes, macros, reflection, generated code, build tags, dynamic dispatch and dataflow remain blind spots, as §1018 correctly notes. Treat syntax/dependency intersections as advisory candidate ranking only; never call them “semantic conflict probability” unless calibrated against labeled repo/task instances. Include parse error and grammar version as explicit `UNKNOWN` inputs, rather than silently trusting stale symbol graph.

**Example:** Two files each modify a function `parse`; same identifier does not establish conflict. Conversely agent A edits `parseConfig`, agent B edits a shared caller’s assumed output shape: dependency edge may predict risk without textual overlap. A reviewer labels actual consequential conflict after integration to calibrate precision/recall.

**Diagrams:** (1) source snapshot → parser+grammar/version → syntax symbols/import graph → scoped candidate intersections → human/integration validation; (2) uncertainty decomposition map: syntax/parse, direct symbol overlap, dependency edge, runtime semantic compatibility, labeled ground truth.

**ASCII inventory:** §83 canonical example uses code fence; §114 onward code samples; §§542/577/1095/1116/1132 use ASCII decision/matrix layouts. Convert conflict pipeline and confidence factors; retain syntax snippets. Existing extensive prose/scoring requires reference split before adding long diagrams.

**Book candidate:** false positive/negative matrix for “no changed line overlap” vs “shared invariant changed” with source-level graph and final integration oracle. Not validated as novel.

## 7. runtime-task-overlap-detector

**Existing passages:** §21 activation; §41 claim that task-shape similarity is coined; §44 onward contains exact thresholds (`0.88–0.92`, `90–95% precision`, 18% of tokens, 20–50ms, 4 seconds) and streaming ANN/NLI code; §140 sources and refs.

**Primary-source evidence.** [Liu et al., “AgentBench: Evaluating LLMs as Agents”](https://arxiv.org/abs/2308.03688) (primary benchmark paper opened/read; multi-turn interactive task environments, not semantic overlap benchmark); [Zheng et al., “Judging LLM-as-a-Judge…”](https://arxiv.org/abs/2306.05685) (full paper opened, illustrates evaluator bias when using model judgments); actual listed CREDENCE paper [arXiv:2606.19819](https://arxiv.org/abs/2606.19819), semantic-cache thresholds [arXiv:2603.03301](https://arxiv.org/abs/2603.03301), and early-stop paper [arXiv:2506.09996](https://arxiv.org/abs/2506.09996) were not body-opened/validated this pass; exact titles, venue/year, and transfer from claim-dedup/harmful-content classification to agent-task equivalence remain unverified. Marked **incomplete source validation**.

**Correction / extension:** The cited “first 18% of tokens” result (harmful-output/task-content classifier) cannot support that general task overlap is recognizable early. Semantic cache / claim dedup thresholds cannot establish task-equivalence precision; similarity is not mutual entailment, and mutual entailment of partial outputs still does not show duplicate work goals. Remove fixed thresholds/latencies/precision until the exact cited source and an in-domain labeled benchmark are reproduced. The skill’s own note (“do NOT automatically kill”) is the correct action boundary; emit a candidate signal only, with shadow-mode measurement first.

**Example:** Agent A: “update retry logic in the cache client.” Agent B: “fix exponential backoff when remote calls fail.” Similar text but potentially distinct code surfaces and acceptance tests. Include distinct-task hard negatives; an operator should retain both tasks unless proposal scopes/outputs prove duplicate.

**Diagrams:** (1) streaming candidate pipeline with rolling prefix, candidate retrieval, independent scoped-goal comparison, signal-only output, coordinator decision; label token count and model version; (2) precision/recall tradeoff over overlap labels including hard negatives, with latency cost per checkpoint and stop/continue policy.

**ASCII inventory:** §§82–124 are fenced Python/code, §140 bibliography. No ASCII graph in active SKILL.md. Two diagrams proposed are new; diagrams bundle has decision-point flowchart to assess for reuse.

**Book candidate:** a worked false-positive case showing semantic similarity and duplicate-work judgments diverge; candidate lacks validating source/measurement, so not an empirical result.

## 8. resolution-trace-damping

**Existing passages:** §41 concept definition, §80 exact damped formula; §105 provides unreferenced fixed “calibration guidelines” and SOMA-benchmark attribution; §122 sources includes Hansen & Ghrist analogy.

**Primary-source evidence.** [Hansen & Ghrist, “Opinion Dynamics on Discourse Sheaves”](https://arxiv.org/abs/2107.12193) (primary paper; sheaf Laplacian opinion-consensus dynamics, not evidence for this resolution field); [Dorigo, Maniezzo & Colorni, “Ant System: Optimization by a colony of cooperating agents”](https://doi.org/10.1109/3477.484436) (primary ACO paper; pheromone-based stochastic search and reinforcement/evaporation; mechanism-specific, not this code’s damping). The active skill cites code lines in an external SOMA `medium.py`, which is not in assigned repo. Source/code behavior and “SOMA benchmark” were therefore **not independently validated** here.

**Correction / extension:** Clearly label formula as implementation-specific and verify code/version before operational use. Stigmergy/ant-colony literature supports feedback/evaporation analogies, not claims that a linear node-local suppression prevents pile-on or “single-pass coverage.” Because `res` only accumulates and does not decay, one false resolution can permanently suppress future work; add explicit reopen/revocation/TTL/decay semantics, monotonic-vs-reset decision, and competing traces. Replace numeric “balanced default” with parameter sweep and workload objective.

**Example:** raw pheromone=0.8, resolution=1, damping=.5 → effective=.4. After false completion remains .4 forever if no decay; regression urgency override must be shown to have concrete channel and precedence, not merely description.

**Diagrams:** (1) signal equation graph raw attraction × suppression factor → effective route utility, with clamping and node locality; (2) time series/state trace: correct completion, false completion, regression reopen/expiry, demonstrating accumulated resolution behavior.

**ASCII inventory:** §75–115 is executable-looking Python/pseudocode. No ASCII flow chart in active skill; diagram reference files include flowchart and code/documentation diagrams. Render formula and state over time as two distinct figures, not another flowchart.

**Book candidate:** simple irreversible-state counterexample and repair policy (reopen with evidence or decaying signal), grounded in the actual implementation once source is linked. Do not claim this is novel until code and manuscript audited.

## 9. status-attestation-split-plane

**Existing passages:** §70 fate independence, §97 three-valued verdict, §114 anchoring ladder, §147 SPOF, §166 prescription. Several absolute prescriptions (“A3 from day one”, “F3 only honest answer”, quorum) need threat-model qualification.

**Primary-source evidence.** [NIST SP 800-137, “Information Security Continuous Monitoring”](https://csrc.nist.gov/pubs/sp/800/137/final) (official page/PDF opened; visibility/control-effectiveness and timely risk response); [NIST SP 800-137A, “Assessing ISCM Programs”](https://csrc.nist.gov/pubs/sp/800/137/a/final) (official abstract opened; program assessment completeness/effectiveness criteria); [Anderson, “Computer Security Technology Planning Study,” Vol. II](https://seclab.cs.ucdavis.edu/projects/history/papers/ande72.pdf) (original report title page read; anchoring/self-attestation claims need a transparency-log primary standard/paper, not validated in this pass).

**Correction / extension:** The skill describes a useful design pattern but some prescriptive terms are local architecture choices, not standards. F3/dead-man check is one failure-detection design; availability independence must be argued across provider, network, identity, deploy, and notification path. “Unknown absorbing for confidence” is useful for evidence but must not be described as a universal three-valued logic law. A quorum does not neutralize correlated reporters or malicious majority; model independence, Sybil control, authenticated provenance, freshness and aggregation semantics. Hash chains detect edits only against an independently retained/anchored head; anchor without independent verifier is not detection.

**Example:** Status API times out while external checker has no heartbeat. Render stale last-good plus age and independent dead-man alert; mark current state unknown, leave normal read-only service available. Avoid green-by-default, but don't imply outage certainty.

**Diagrams:** (1) failure-domain topology spanning service probe, ledger, renderer and external dead-man notifier; annotate shared dependencies; (2) evidence timeline showing report, hash-chain head, external anchor and client verification—highlight that A3/A4 differ.

**ASCII inventory:** §70 architecture table, §97 logical expressions, §166 numbered list, §199 failure-mode table. Tables should stay tables; convert topology and evidence-provenance temporal story to Mermaid.

**Book candidate:** dependency-correlated “independent monitor” example where separate deploy still shares DNS/IdP/region; then show actual independence graph. Validate against existing observability/attestation chapter.

## 10. pre-federation-halt-gate

**Existing passages:** §18 activation, §32 model, §63 implementation, §97 `overall < 0.6 => HALT` and §153 references; targeted reference `halt-gate-implementation.md`, Polya/principal-parts and well-defined problems inspected.

**Primary-source evidence.** [Polya, “How to Solve It” (1945)](https://press.princeton.edu/books/paperback/9780691164076/how-to-solve-it) (publisher bibliographic page; primary text itself not available in this pass, so no specific quotation/algorithm claim); [NIST SP 800-30 Rev.1, “Guide for Conducting Risk Assessments”](https://csrc.nist.gov/pubs/sp/800/30/r1/final) (official guidance; risk judgments depend on contextual likelihood/impact and assumptions, not universal confidence number); [Ralph et al. SIGSOFT Empirical Standards](https://arxiv.org/abs/2010.03525) (primary standards work opened through standards site; evidence to justify decisions must be method/claim specific).

**Correction / extension:** A literal confidence cutoff of .6 is a policy choice, not one justified by Polya or a general scientific validity principle. Establish the gate’s operational target (which unsafe/infeasible federation event it prevents), inputs, calibration labels, error costs, and override authority. Use named states (`READY`, `REVISE`, `HALT/NEED_HUMAN`) and explicit blockers (undefined agent authority, message trust, resource bounds, rollback, dependency unavailable) rather than averaging a serious blocker into a scalar. “Ill-defined” does not equal “cannot proceed”; a bounded clarification/reconnaissance task may be permissible.

**Example:** Problem statement “federate the system” lacks identity, message acceptance, and resource policy: mark those exact unknowns; ask one bounded question or draft a model; do not turn arbitrary .58 rubric score into general truth. Conversely known critical permission mismatch must halt even if all other rubric fields score 1.

**Diagrams:** (1) gate logic with hard blockers and explicit clarification/revision branch, separately from optional scalar readiness score; (2) uncertainty map linking missing definitions to affected safety/liveness/federation claims.

**ASCII inventory:** §69 and §141 contain fenced decision/implementation pseudocode; §153 references. Convert `overall < .6` into labeled, configurable policy and show blocker precedence. No existing Mermaid in active skill.

**Book candidate:** weighted average yielding “pass” despite one catastrophic missing trust-boundary invariant; demonstrate why hard gates precede score. It is a design example, not measured policy efficacy.

## 11. sqlite-durable-agent-state

**Existing passages:** §62 canonical path/WAL/migration/output loop; §97 “WAL Makes Concurrency Free”; reference `durable-path-and-wal-discipline.md` and implementation/schema/script bundle. Full SKILL.md and these operational references/script were read.

**Primary-source evidence.** [SQLite “Write-Ahead Logging” official documentation](https://www.sqlite.org/wal.html) (full body opened/read): WAL readers/writers usually coexist but WAL does not allow multi-writer commits concurrently in ordinary upstream semantics; `SQLITE_BUSY` still occurs; WAL requires processes on same host (not a network filesystem); attached-database transactions are not atomic as a group; checkpoints matter; copies must include WAL state; doc reports WAL-reset bug and fixes in SQLite 3.51.3 / selected backports in 2026. [SQLite “Transactions”](https://www.sqlite.org/lang_transaction.html) (primary docs; transaction upgrade/conflict/failure semantics should inform retry sample); [SQLite `sqlite3_busy_timeout`](https://www.sqlite.org/c3ref/busy_timeout.html) (official API docs, per connection, installs/replaces busy handler; does not guarantee success). Transactions page search located but body not opened in this pass; validate if adding details.

**Correction / extension:** The skill’s heuristic “2–5 seconds floor” for busy_timeout is not a SQLite guarantee; choose from caller deadline/latency budget and test contention. `busy_timeout` bounds retries for eligible busy conditions, does not serialize multi-step operations or remove writer contention; retry only safe/idempotent units. `journal_mode=WAL` gives concurrency, not generic process safety; add deployed SQLite version/platform/filesystem to support notes, verify the SQLite advisory on a current-version risk. Don’t use two-DB WAL intent log as if fully atomic; the official docs say attached multi-DB transactions not atomic as a group in WAL. Migration must have target-schema/effect readback (current skill correctly emphasizes this).

**Example:** Two processes perform read-then-insert stale check; with WAL both read, process A writes, B may fail upgrade with `SQLITE_BUSY_SNAPSHOT`; retry the full transaction from fresh snapshot, not only last insert, or serialize writes.

**Diagrams:** (1) WAL timeline for reader snapshot, writer commit, upgrade conflict/retry; (2) migration state machine: backup/version precondition → transaction apply → inspect target schema/data → reconcile/rollback, with history row separated from target truth.

**ASCII inventory:** §64 Mermaid flowchart already exists; examples/table and reference discussion are prose. Improve diagram 1 into a reader/writer timeline; diagram 2 distinct migration verification sequence. Script’s report already offers useful machine-readable `pass/summary/findings/recommendations` contract.

**Book candidate:** WAL multi-DB apparent atomicity trap with explicit two-file crash point; operationally valuable, but likely established SQLite material—novelty only if a Port Daddy-specific migration reconciliation mechanism is shown.

## 12. tlaplus-practitioner

**Existing passages:** §28 decision tree, §§42–80 patterns, §82 BondedCommons full model, §220 quality gate, §226 fairness guidance, §234 bounds, §246 counterexamples, §329 final checklist.

**Primary-source evidence.** [Yu, Manolios & Lamport, “Model Checking TLA+ Specifications”](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/Model-Checking-TLA-Specifications.pdf) (original paper full body opened/read): TLC exhaustively checks a selected finite-state model; it is for finding design errors and does not model-check arbitrary unbounded full system. [TLA+ project TLC documentation](https://docs.tlapl.us/using:tlc:start) (official/community project docs read; supported subset, model config, model checking and liveness options); [Lamport, “Specifying and Verifying Systems with TLA+”](https://lamport.org/pubs/spec-and-verifying.pdf) (primary author paper search/read excerpt; TLA specs can be paired with finite TLC models, assumptions/fairness matter).

**Correction / extension:** “TLC explored >1M states” is an arbitrary throughput threshold, not correctness/coverage criterion. A 10-state counterexample may be decisive; a million states over a wrong abstraction remain weak evidence. Report exact constants, bounds and why selected, reachable/unique states, invariants/properties, symmetry/fairness, tool/version and checked assumptions. The sample `BondedCommons` has several semantic gaps to correct before presenting as runnable: `Reap` does not constrain alive-heartbeat freshness against clock in `NoDoubleClaim`; `Tick` saturates at `MaxTTL`, so time stops and must be justified/avoided; `StaleEventuallyReaped` may need explicit fairness for Reap and Tick, and `WF_vars(Tick)` does not force Reap; model’s notion of alive/stale/dead and real heartbeat timing/clock are abstractions. Do not casually add fairness to make a failed liveness property disappear: fairness is an environmental/action assumption. Verify model using TLC and intentionally mutate invariant only as mutation adequacy check, not completeness proof.

**Example:** Two agents, one lock, clock 0..2. Assert mutual exclusion and a lock-reclaim property under explicit Reap/Tick fairness. Then add a lost heartbeat/delayed delivery state; inspect counterexample. A pass says only all modeled behaviors in those bounds/assumptions satisfy properties.

**Diagrams:** (1) abstraction map from implementation state/events to TLA variables/actions, with intentionally omitted details; (2) counterexample/liveness trace separating transition relation, fairness premise and temporal claim.

**ASCII inventory:** §28 and §226 ASCII decision trees, §234 bound table, §246 diagnostic decision map, §314 state mapping table; large `.tla` and `.cfg` code remains code. Convert the two decision trees to Mermaid; use table for bounds and a separate trace figure.

**Book candidate:** “fairness changes the claim” side-by-side lasso where Reap stays enabled but never chosen, then a fair spec; make clear that stronger scheduling assumption narrows behaviors. Check if existing Book already treats fairness.

## Cross-skill evidence and source gaps

- [WinDAGs, “Skills Actually Help: The Numbers”](https://windags.ai/blog/skills-actually-help-the-numbers) opened. The presented positive skill-graft comparisons concern rubric-scored response pairs and the post’s own task set; they support a limited answer-quality claim, not end-to-end task execution. The assigned worktree does **not** contain `data/skill-graft-bench.json`; I did not retrieve or inspect raw JSON. Parent’s stated summary: positive composite Q&A pairwise result; preserve that limit.
- Source gaps requiring Terra caution: exact paper body/citation and claim transfer for runtime-overlap’s 18%/precision/thresholds; code/version for resolution damping/SOMA; standards-backed evidence for transparency anchoring/quorum; source justification/calibration for pre-federation `.6`; publisher full text for Schneider is paywalled/inaccessible though DOI/abstract read; SQLite transactions API docs not body-opened; TLA+ research paper is a finite chosen model, not production proof.
- No skill should be edited on the basis of an abstract alone where the report labels primary text unavailable. This research lane supplies candidate corrections/diagrams and worked examples; it does not verify the actual external implementation of any skill’s code snippets.

## Provenance

No repository files edited. One report written outside repository at the parent-authorized handoff path. No tests, runtime, commit, or publication performed.
