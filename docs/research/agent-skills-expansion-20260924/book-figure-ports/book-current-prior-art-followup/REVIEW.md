# Current prior art: coordination substrates, state management and drift

Review date: 2026-09-24. This is a research follow-up to [the seven-candidate Astra review](../../ASTRA-BOOK-REVIEW.md), not a manuscript edit or new empirical result.

**Decision:** STORM warrants a direct comparison in the proposed collaboration experiment and a citation in the planning records for candidates 4–5. grite warrants a measurement/instrumentation comparison. DriCo remains a qualified lead because full-paper retrieval was blocked; its indexed primary passages support limited comparison, not theorem or result adoption. None resolves the existing S2 pilot defect or establishes that Port Daddy's implementation works. No eighth Book candidate is warranted from this pass.

## Access and identity ledger

| Lead | Verified identity/version | Actual access |
|---|---|---|
| grite | Dipankar Sarkar, *Before the Pull Request: Mining Multi-Agent Coordination*, arXiv:2606.19616v1, 17 June 2026 | Full primary HTML read, including methods, results and limitations; saved with SHA256. No code/data replication. |
| STORM | Mengyang Liu, Taozhi Chen, Zhenhua Xu, Xue Jiang, Yihong Dong, *Multi-agent Collaboration with State Management*, arXiv:2605.20563v1, 19 May 2026 | Full primary HTML available; §§2–3, Appendix A, D and E and relevant tables read. Saved with SHA256. No implementation audit or replication. |
| DriCo | *Improving Multi-Agent Coordination with a Drift-Aware RL Objective*, anonymous workshop submission | Primary PDF indexed excerpts only: title page, §4.1 theorem statement, §4.3, §5.1–5.3, Appendix L. Direct PDF, forum and public API returned challenge/403. Author identities, exact revision/date, full proof, tables, seeds and detailed training controls remain unverified. |

The OpenReview title page identifies a submission to the ICML 2026 Workshop on Decision-Making from Offline Datasets to Online Adaptation; that is submission labeling, not verified acceptance. The indexed content-addressed PDF URL is listed below, but its bytes could not be retrieved and are not certified identical to the live note revision.

Sources: [grite v1](https://arxiv.org/html/2606.19616v1), [STORM v1](https://arxiv.org/html/2605.20563v1), [DriCo note PDF](https://openreview.net/pdf?id=j7SaOMt2j4), [indexed DriCo PDF](https://openreview.net/pdf/ca7a7f5db191900a54d1269eb13f3d6cb412de89.pdf).

## Compact source findings

### grite: synthetic coordination instrumentation

Its quantitative experiments use seeded scripted agents on independent abstract work units, not LLM code editing. The treatments are no coordination, leases, and leases plus shared completion state. At N=32, the reported duplicate-completion fraction changes from .78 to zero and distinct-task goodput from 2.33 to 8 per round. Conflicts are cross-actor last-writer-wins issue-field events, not executable code incompatibility. Replica checks use generated event sets and delivery orders; they are test evidence, not an exhaustive proof. Leases remain advisory and partial compliance is unmeasured. Sections 4–6 state these limits. [Primary paper](https://arxiv.org/html/2606.19616v1)

**Assessment:** useful evidence for this instrument and workload; no direct treatment comparison with worktrees/merge queues, semantic-integration result, or real-agent effect is established. The zero-duplicate result is closely tied to the shared-state-aware selection rule. Its detector output should not be imported as our semantic-conflict oracle.

### STORM: actual LLM runs, bounded mediation

It validates read-file versions before mediated writes, with reservations and intent annotations. Actual LLM runs use Commit0-Lite tests and PaperBench Code-Dev judging without reproduction execution. Table 1 reports Sonnet macro scores 82.5 versus 63.8 for GitWorktree, and PaperBench 74.1 versus 72.7. Appendix E admits bash-write bypass, absent command coordination and file-granularity false rejection. Its consistency condition does not prove semantic correctness. [Primary paper](https://arxiv.org/html/2605.20563v1)

**Accounting issues to resolve before reproduction:** §3 describes Combined as per-task best-of; Appendix A describes per-test union. Appendix A's Sonnet-only PaperBench statement conflicts with multi-model tables; efficiency denominators also differ between main and appendix wording. Avoid Combined headlines until raw accounting is reconciled. These textual discrepancies do not by themselves invalidate every reported base-arm result.

### DriCo: trained coordination in a simulated environment, partial access

Indexed primary passages describe Qwen-2.5 7B/Llama-3.1 8B coordinator/planner/actor training and LLM-Overcooked evaluation on held-out recipe compositions. This is a reported learned-agent simulation, unlike scripted work generators. Numerical outcomes were not verified. Theorem 4.1 defines perplexity through conditional entropy; §4.3 compares dense communication with sparse coordinator invocation under message-size and invocation-frequency assumptions. Appendix L limits generalization and notes centralization. [Indexed primary PDF](https://openreview.net/pdf?id=j7SaOMt2j4)

**Assessment:** entropy reduction from extra conditioning is not a guarantee that an approximate LLM predicts better or completes more work. The standard averaged inequality H(G|O,C)≤H(G|O) does not assert improvement for every individual context value. The full proof and its precise conditioning convention remain unread. Communication advantage also needs actual update frequency and message lengths; sparse topology alone is insufficient. Keep outcome and theorem adoption pending full-source access.

## Manuscript comparison and placement

All eight current primary chapter hashes were rechecked against `../manuscript-snapshot.json`; all match. No reliance on the campaign worktree's older chapter bytes. Readback included the following actual passages, plus the prior Astra review:

| Manuscript passage | Existing commitment | Effect on planning |
|---|---|---|
| Chapter 1, `whitepaper/single-writer-kernel.tex:2115–2140` | Separates compulsory confinement from the unresolved rail-versus-worktree collaboration comparison | Add a current prior-art comparison beside the empirical-question paragraph, not a declaration that the rail won. This source distinction leaves the chapter's conditional posture intact. |
| Chapter 1, `:1767–1838` | Work-unit epoch/idempotency/receipt model and explicit model-to-daemon boundary | Candidates 2 and 4 still need their own effect and authority contracts. File freshness is not evidence of settlement or authorization. |
| Chapter 4, `whitepaper/legible-swarm.tex:934–945` | Versioned roadmap as intent; amendments and drift remain visible | A future drift exercise belongs here, but an intervention policy must show which changed premise warrants revision. No scalar drift score should automatically grant authority. |
| Chapter 4, `:836–903` | Artifact-backed read surfaces, forced zoom and reasons for authority | Candidate 1's four relations can show where information flows versus where a write is refused. Logged explanation and effective mediation remain distinct. |
| Chapter 4, `:2391–2473` | Context paging and compaction failures | Candidate 6 can compare coverage and freshness independently. Receiving a current context does not show all required obligations were included. |
| S2 protocol §§2.1–2.6 and pilot Data completeness | Historical-diff replay by scripted workers; four D/N8 cells missing because of a landing defect | Preserve the pilot's non-conclusion. External success cannot fill missing cells, repair treatment asymmetry or substitute for an acceptance oracle. |

**Overlap without inflated novelty.** Candidate 4 should acknowledge state-version validation as a comparison class. The proposed remaining question is whether typed data, acceptance, authority and unresolved-effect dependencies improve reuse decisions beyond ordinary version freshness. Candidate 5 should test actual semantic integration rather than rename a version mismatch. Candidate 6 should test missing required information even when all supplied files are current. The papers provide no direct basis here to change candidate 3's judge calibration or candidate 7's skill-promotion design. No global priority/novelty claim follows from this three-paper search.

## Proposed discriminating tests

These are our proposed tests, not experiments reported by the papers. Preregister them as an addendum or separate executed-agent study; preserve the original S2 protocol and record amendments. Do not silently add arms after observing outcomes and call the old protocol unchanged.

### A. Separate information access, concurrency policy and effect enforcement

Use common tasks, dependency DAGs, independent acceptance fixtures, model/harness versions and total-resource budgets. Give every arm equally useful task/completion metadata. Compare:

1. isolated worktrees with a dependency-aware merge queue and current integration tests;
2. shared workspace with optimistic read-set validation;
3. claims plus serialized admission, separately at file and region granularity.

Cross these with shared intent annotations and with actual mediation coverage. Match refusal/retry budgets and account for waiting, rereading, review and merge work. The unit of outcome is useful accepted work, not an edit event or successful write. First validate the deterministic instrument, then run real LLMs to measure adaptation to refusal. Keep benign collaboration and adversarial/bypass testing as separate claims. No local runtime is authorized by this proposal.

**Decisive outcomes:** record unsafe accepted composition, duplicate effects, abandoned useful work, unnecessary refusal and cost/time. A treatment can improve completion while still failing confinement. A secure treatment can impose excessive collaboration cost. Report both rather than choosing one score that hides the tradeoff.

### B. Two hand fixtures separating freshness from semantics

**All reads fresh, contract wrong.** The producer and consumer independently implement a field using different units without a shared typed unit contract. Every tracked version is current at admission; the known-duration end-to-end test fails. This prevents a freshness gate from being mislabeled a semantic oracle.

**Read stale, meaning unchanged.** A dependency receives a comment-only change while an agent prepares an otherwise valid edit. Compare coarse reread/retry against a verified semantic-preservation rule. The latter can reuse only if its own contract and evidence justify that decision. Charge the analysis cost, and include a deceptively small behavior change as a negative control.

For candidate 4, extend the same fixture with a changed acceptance policy, revoked publication epoch and unknown prior effect. An input-version-only cache must not claim it handled all three. For candidate 6, omit a required current source entirely: version validity over the observed set must not certify coverage of the required set.

### C. Test whether pre-PR signals forecast costly failures

Freeze detectors before the test set. Independently label actual duplicate intent, semantically harmful composition and starvation; do not label them from the detector's own output fields. Include slow legitimate work, repeat work mandated by a changed requirement, and noisy issue updates as negative controls. Measure incremental prediction over ordinary repository/PR telemetry, false alarms, operator review time and downstream useful completion. A log can be perfectly replayable while the detector's interpretation is wrong.

### D. Separate the value of shared context from the intervention policy

After full DriCo access, compare no updates, fixed periodic updates, event-triggered updates and learned intervention at matched total compute and context budgets. Hold task family, planner and actor constant where possible; ablate controller training separately from low-level action guidance. Include stale, irrelevant and adversarially misleading shared context plus genuinely required missing facts. Measure both environment outcomes and coordination proxies, with held-out task compositions and then distinct domains. This tests usefulness rather than assuming information-theoretic conditioning automatically improves a bounded predictor.

A coding version should use dependency/acceptance/effect events as ground truth for constructed fixtures. Preserve uncertainty for open-ended cases. No benchmark-specific conflict/redundancy/loop score should become a universal safety or readiness threshold.

## Figure planning implications

Use the current seven-candidate diagram set; do not add decorative architecture panels merely because a new paper arrived.

- Candidate 1: annotate read/write gate versus shell bypass and communication edges. Label bypass visibility separately from prevention.
- Candidate 4: add three rows beneath the before/after example: current read set, complete required set, valid authorization/effect state. A check in one row must not visually imply checks in all rows.
- Candidate 5: retain the textual-overlap × harmful-integration matrix and attach the frozen oracle to its outcome axis.
- Candidate 6: show both a stale included source and an absent required source; they demand different repairs.

These are semantic briefs only. No figure was rendered, no Book page modified and no empirical outcome generated in this follow-up.

## Remaining evidence needed

DriCo full PDF/revision and authorship metadata remain access-limited; retain its indexed material as a lead. STORM reproduction should resolve the three accounting inconsistencies before quoting Combined or normalized-efficiency results, and pin artifact commits, prompts, raw traces, task denominators and repeat counts. grite comparisons should inspect the released detector/schema/harness implementation before reusing it. None of those tasks was executed here.

Read-worktree boundary: `/Users/erichowens/coding/tmp/agent-skills-expansion-20260924`, branch `codex/agent-skills-expansion-20260924`, linked gitdir `/Users/erichowens/coding/port-daddy/.git/worktrees/agent-skills-expansion-20260924`; status clean at start and after source reads. Primary checkout read only. Local Port Daddy remained halted. All writes are confined to this assigned external follow-up directory.
