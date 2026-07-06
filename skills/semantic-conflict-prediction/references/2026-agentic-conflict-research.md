# 2026 Research Digest: LLM-Verification Layers, Diff-Correction, and MASE Failure Modes

Deep material for the "2026 Research Extensions" and "MASE Failure Modes" sections
of `SKILL.md`. Load this file when you need the underlying paper details, the full
tradeoff tables, or the MASE framework catalog. `SKILL.md` carries only the
decision-relevant summary and pointers here.

**Provenance note:** these digests were fetched directly (WebFetch + a raw `curl`
cross-check against the live arXiv page) as part of the M8 research pass, not
pulled from training-data memory. Two of the three source items turned out to be
a **topic mismatch** against their intended framing — flagged honestly below
rather than silently reinterpreted to fit. Treat the mismatches as read: they are
still useful, just not for the reason originally hypothesized.

---

## 1. HalluJudge — arXiv 2601.19072 (topic mismatch, still useful)

**Actual title:** "HalluJudge: A Reference-Free Hallucination Detection for Context
Misalignment in Code Review Automation" (Tantithamthavorn, Lin, Thongtanunam,
Charoenwet, Jeong, Wu — cs.SE/cs.AI, submitted 2026-01-27, v3 2026-06-11,
**accepted FSE'26 Industry Track**).

**Mismatch:** this is not a semantic-merge-conflict paper. It is about LLM-generated
*code review comments* hallucinating — reading as plausible but not grounded in the
actual diff/code context they claim to describe.

**What it actually does:** HalluJudge is a reference-free judge (no ground-truth
comment needed) that scores whether a generated review comment is grounded in its
code context. It ships four escalating assessment strategies, from a single direct
LLM judgment up to structured multi-branch reasoning (**Tree-of-Thoughts**), trading
cost against accuracy. Evaluated on Atlassian's real production review pipeline, not
a public benchmark — framed as a deployable safeguard, not a research-only detector.

**Numbers:**
- F1 = 0.85 for hallucination detection
- Average cost = $0.009/assessment
- 67% agreement with actual developer preference on real production comments

**Why it's relevant anyway:** this skill's `scoreConfidence()` function (see
`SKILL.md` § Confidence Scoring) already produces graded, not binary, verdicts for
predicted conflicts. It has no LLM-judgment layer — it is pure static-analysis
arithmetic (dependency distance, edge weight, export/cross-file discounts).
HalluJudge's pattern — a **reference-free LLM judge as an optional second-pass
verifier over an existing heuristic's ambiguous output** — is directly portable:
route only the mid-confidence band (say, `0.2 < confidence < 0.8`) to a cheap judge
asking "is this flagged conflict grounded in real behavioral overlap, or is it a
false positive from the static graph?" Escalate to Tree-of-Thoughts only when the
cheap pass can't resolve it. Their $0.009/assessment and 0.85 F1 are usable target
numbers for deciding whether an LLM verification tier is worth the cost at your
claim volume, and their production-alignment methodology (validated against actual
developer preference, not synthetic labels) is a model for how to validate the
escalation tier once built — don't trust synthetic conflict-injection tests alone.

---

## 2. Interactive Diff Optimization — arXiv 2409.13590 (topic mismatch, still useful)

**Actual title:** "Toward Interactive Optimization of Source Code Differences: An
Empirical Study of Its Performance" (Yagi, Hayashi — SCAM 2024, IEEE, DOI
10.1109/SCAM63643.2024.00030). Abstract-page level of detail only; full text is
paywalled.

**Mismatch:** the intended framing was "change-intent classification." This paper
proposes no intent taxonomy and no classifier. It is a diff/matching-quality paper.

**What it actually does:** AST-diff generators (the GumTree family, which is the
same lineage informing this skill's tree-sitter approach) build an "edit graph" of
match/no-match decisions between old and new code versions. These algorithms
sometimes produce nonoptimal diffs — matches that hinder a reviewer's understanding
of what changed. The paper proposes an interactive correction loop: a user (or, by
extension, an agent) flags one specific problem point — a pair matched that
shouldn't be, or a pair unmatched that should be — and the edit graph updates from
that single piece of feedback. The empirical contribution: across 23 real GitHub
projects, **92% of nonoptimal diffs could be fixed with fewer than four feedback
actions** (oracle-simulated, not a live user study).

**Why it's relevant anyway:** this reinforces — rather than extends — a design
choice `SKILL.md` already makes in § Building the Graph Incrementally and the
"Performance anti-pattern" call-outs in § Performance Characteristics: local,
targeted correction beats full re-diff/re-analysis. The paper's finding that
*most* diff-quality problems are fixable with a handful of point corrections (not a
wholesale re-match) is independent empirical support for keeping this skill's
incremental dependency-graph-update philosophy rather than re-running full-project
AST analysis on every claim. It does not license adding an intent classifier — that
capability isn't in this paper, and the skill should not claim it is.

---

## 3. MASE / Agentic Collaboration Failure Modes (operator-supplied research digest)

Unlike the two arXiv items above, this is a synthesis across multiple frameworks
covering the *coordination protocol layer around* conflict prediction — territory
`SKILL.md` (a single-algorithm skill) does not cover today.

### Two named failure modes at agent speed

- **Context Thrashing** — Agent A invalidates Agent B's RAG snapshot mid-task (B is
  reasoning over context that A has already made stale).
- **Cascading Hallucinations** — Agent B builds on Agent A's flawed *committed*
  logic as if it were verified ground truth, propagating the error forward instead
  of catching it at the source.

Both are protocol-layer failures: they happen even when every individual symbol
claim is technically honest and the dependency graph is perfectly accurate. Static
AST conflict prediction cannot see either — they are about *epistemic* staleness
between agents, not code-structural overlap.

### Three emerging solution patterns

1. **Hierarchical Orchestration / Manager Pattern** (MetaGPT, ChatDev) — a Lead
   Architect decomposes the backlog into orthogonal tasks *before* any code is
   written. This is intent de-duplication **pre-assignment**, structurally
   upstream of this skill's post-hoc symbol-claim diffing. ChatDev in particular
   uses role-based natural-language protocol alignment before commit.
2. **Agentic Communication Protocols / message buses** — an agent broadcasts a
   semantic lock before starting work, e.g.:
   ```json
   {"intent": "upgrade_auth_middleware", "target_graph": ["auth.py", "session.py"]}
   ```
   Other agents must wait or negotiate before touching that graph. This is a
   *declared-intent* broadcast, richer than a file/symbol claim because it carries
   the *purpose* of the change, not just its coordinates.
3. **Continuous Semantic Integration / Micro-CI** — agents pull *other* agents'
   pending intents into their own context and simulate a merge against their own
   in-progress diff continuously, not just at PR time. This is the same idea the
   operator independently proposed (see § 4 below) — noted as convergent, not
   coincidental; it's the natural fixed point once you take context-thrashing
   seriously.

### Notable frameworks cited

- **ChatDev** — role-based natural-language protocol alignment before commit.
- **AgentCoder** — separates intent-to-write from intent-to-test; aggressive
  paired testing agent catches drift between the two.
- **SWE-bench / SWE-agent swarm extensions** — multi-agent interconnected-issue
  resolution benchmarks; relevant as an evaluation methodology reference if Port
  Daddy ever wants to benchmark its own multi-agent conflict rate empirically.

### The overall shift

From *detecting* overlapping intent after the fact (diffing, this skill's current
entire scope) to *orchestrating* agents so they structurally cannot overlap in the
first place (decomposition, semantic locks, continuous simulation). This skill
should not try to become the orchestration layer — that's `multi-agent-coordination`
and `agentic-patterns` territory — but it should be honest that AST-diff conflict
prediction is a necessary-but-not-sufficient layer, and name what sits above it.

---

## 4. Operator's two proposals — architecture evaluation detail

See `SKILL.md` § Port Daddy Integration for the summary table. Detail below.

### (a) Longshoreman semantic-cloud-proximity broadcast

Inform agents whenever PRs go up — specifically ones relatively close to their
current work, files, or "semantic cloud of intent" (not just literal file
overlap — semantic/topical proximity too, e.g. two agents both touching
authentication-adjacent code in different files with no shared symbols).

- **Cost:** one embedding computation per PR/branch open + a nearest-neighbor
  search against active sessions' declared intents. Cheap relative to full AST
  parsing — no tree-sitter required for the proximity signal itself (though the
  existing symbol/dependency graph can be reused as one of the inputs).
- **Latency:** can run asynchronously, on PR-open/branch-push events, not
  synchronously on every claim. No agent needs to block waiting for it.
- **False-positive risk:** the highest risk in this proposal. "Semantic cloud"
  proximity over free-text task descriptions is unstructured-text classification —
  this is exactly the class of problem the operator's global instructions forbid
  solving with keyword/substring matching. It must be built on embeddings +
  cosine similarity against prototype vectors, or a cheap LLM classification call,
  never a keyword list. Even so, topical proximity is a *softer* signal than
  symbol overlap — expect more false positives than the existing AST-based
  conflict matrix, and treat this as advisory-only (surfacing a "you might want
  to look at PR #N" nudge), never a blocking gate.
- **Verdict:** high-value, low-cost, but it is a genuinely new capability (a new
  agent role, not an extension of the existing conflict-prediction algorithm).
  See the companion work-packet proposal for the concrete agent design.

### (b) Continuous pre-emptive merge simulation / Micro-CI

A cheaper agent stage pre-emptively merges/simulates a merge continuously to spot
problems before agents finish, rather than waiting for PR-time CI.

- **Cost:** highest of the two proposals. Simulating a real merge (not just a
  symbol-claim check) means running the actual build/test suite, or at minimum a
  type-check, against a synthetic merge of N agents' in-flight worktrees. This
  scales roughly with (number of active worktrees)² if done pairwise, or linearly
  if done as "merge everyone into a scratch integration branch and build once,"
  which is the more tractable design.
  - The MASE research explicitly names this pattern as **Continuous Semantic
    Integration** — independent convergence with the operator's own proposal,
    worth taking seriously precisely because two unrelated sources arrived at it.
- **Latency:** this is the tradeoff that matters most. A build+test cycle is
  seconds-to-minutes, not milliseconds. Running it "continuously" means picking a
  cadence (e.g. every N minutes, or on every `pd session files add`) rather than
  synchronously per-claim — otherwise it becomes the bottleneck the symbol-claim
  system was built to avoid.
- **False-positive risk:** lower than (a) in one sense — an actual build/type-check
  failure is a real signal, not a proximity guess. But it inherits every existing
  flaky-test and environment-drift problem a normal CI pipeline has, multiplied by
  N in-flight branches. A failing "scratch integration build" could mean a real
  conflict, or could mean one agent's worktree is mid-edit and legitimately
  broken right now.
- **Verdict:** valuable but expensive; best deployed as a scheduled batch job over
  a scratch integration branch (build the merge of all currently-claimed
  worktrees, run tests, report deltas vs the last run) rather than a per-claim
  synchronous check. This is architecturally closer to "give Lookout (PR #721) a
  build step" than to a new agent role — see `SKILL.md` § Port Daddy Integration
  for why it should be scoped as an extension of the existing cross-PR-watch
  ideation-ship pattern rather than a new agent definition.

---

## References

- HalluJudge: arXiv 2601.19072 (FSE'26 Industry Track)
- Interactive diff optimization: arXiv 2409.13590 (SCAM 2024, DOI 10.1109/SCAM63643.2024.00030)
- MASE/agentic-collaboration synthesis: operator-supplied research digest, 2026-07 (frameworks cited: MetaGPT, ChatDev, AgentCoder, SWE-bench/SWE-agent swarm extensions)
- Port Daddy PR #721: `feat(fleet): ideation ships — Spider/Spark reliable, add Lookout + Snipe, validated actionable Proposal schema` (OPEN as of this digest)
