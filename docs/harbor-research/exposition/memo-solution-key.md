# The Review Memo's Exercise Solution Key

Source: `docs/harbor-research/pdf/The-Harbor-After-the-Harbor.pdf` (51 pages), section "Exercise solution key," memo pages 13-34. Extracted with PyMuPDF (`pymupdf` 1.28.2); the PDF's text layer is plain ASCII (math already written out as `->`, `<=`, `beta`, `delta`, etc.) with no hyphenation-at-line-break artifacts detected. The memo numbers exercises with the book's FIRST-EDITION Roman chapter numerals; the concordance below maps those to the chapters as they exist in the repository today, per `whitepaper/textbook.json`.

## Concordance: first-edition numeral -> current chapter

| First-edition numeral | Current chapter # | Prefix | Title | Source file |
|---|---|---|---|---|
| I | 3 | `ls` | The Legible Swarm | `whitepaper/legible-swarm.tex` |
| II | 1 | `swk` | The Single-Writer Kernel | `whitepaper/single-writer-kernel.tex` |
| III | 4 | `stp` | From Spawn to Person | `website-v2/public/whitepaper/spawn-to-person.tex` |
| IV | 5 | `he` | The Harbor Economy | `website-v2/public/whitepaper/harbor-economy.tex` |
| V | 2 | `anchor` | The Anchor Protocol | `website-v2/public/whitepaper/anchor-protocol-whitepaper.tex` |
| VI | 6 | `bonded` | The Bonded Commons | `website-v2/public/whitepaper/agent-transactions-whitepaper.tex` |
| VII | 7 | `fh` | The Federated Harbor | `website-v2/public/whitepaper/federated-harbor-whitepaper.tex` |

(Mapping read verbatim from each chapter object's `formerNumeral`, `number`, `prefix`, `title`, and `source` fields in `whitepaper/textbook.json`.)

## The key's two rules

Memo page 13, immediately under the "Exercise solution key" heading, verbatim:

> "The answers below are deliberately concise. Where an exercise depends on a false premise in the manuscript, the solution repairs the premise instead of manufacturing the requested conclusion. This is a compact answer key, not an endorsement of every premise in the questions. Where the manuscript's stated theorem, trace, or mechanism is false or too strong, the answer first gives the correction and then answers the intended question. Open problems receive a defensible design or proof obligation rather than a fictional closed-form solution."

The two rules governing how the key was written, isolated verbatim from that paragraph (both on memo page 13):

- Rule 1 (false premises): "Where an exercise depends on a false premise in the manuscript, the solution repairs the premise instead of manufacturing the requested conclusion."
- Rule 2 (open problems): "Open problems receive a defensible design or proof obligation rather than a fictional closed-form solution."

## Exercise solution key

The memo answers every item under a heading in one continuous block (it does not restate the underlying exercise text before answering), so every entry below reads "Exercise as the memo restates it: not restated." Where the memo explicitly marks a correction to a stated theorem, algorithm, protocol, or figure, that text is quoted verbatim in "Premise correction flagged"; every other entry is "none." Entries are in the memo's own order.

**Chapter I -- The Legible Swarm (now Chapter 3, prefix `ls`)**

### I.1 → Chapter 3 (ls) -- State of nature

**Memo page:** 13

**Exercise as the memo restates it:** not restated

**Memo solution:** 1.1 Check.
1. Resource conflict: two agents touch the same resource and clobber one another; answer it with conflict-aware claims plus actual exclusion at the relevant effect boundary.
2. Illegibility: work cannot be understood in bounded time; answer it with a digest whose every material claim zooms to independent evidence.
3. Confident wrongness: an agent asserts completion without checking; answer it with typed attestation and oracle-bound completion.
4. Footguns: a stale premise drives an irreversible act; answer it with reversibility/stakes gates, scoped authority, and pre-effect mediation.
5. Illegible authority: the coordinator rules without an inspectable reason; answer it with an append-only, named, zoomable decision record, including denials and omissions.

1.2 Check. Alice and Bob are both asked to improve auth.ts. Each reads the same base revision, makes a locally correct edit, and commits. Without a claim or merge serialization, Bob's whole-file rewrite erases Alice's change. No malice is required. A deadlock variant is two cooperative agents taking claims on files X and Y in opposite order and each waiting indefinitely for the other claim.

1.3 Trace. Deliberate construction chooses the authority rather than accepting whatever coalition happens to win, and it makes that authority legible to the operator. An emergent stable order may be an oligarchy: stable, but controlled by a few agents, unrevocable, and opaque. The local daemon also gives one fault domain, one policy root, and an unconditional operator exit.

1.4 Open. Randomize comparable real repository tasks to (a) an ungoverned fleet and (b) a fleet with only a transport, but no prescribed governance. Record all messages, effects, blocking decisions, and operator interventions. Pre-register two classes of observables:
- Sovereign characteristics: a publicly known rule, general applicability, explicit consent or adoption, stable appeal/override, reasons attached to authority acts, and equal audit access.
- Oligarchy characteristics: authority concentrated in a small coalition, private channels or rules, selective enforcement, no effective exit, and outcomes that cannot be reconstructed by outsiders.

Measure concentration of blocking/merging power, fraction of authority acts with reconstructable reasons, rule consistency across agents, override success, artifact-linked claim accuracy, and operator reconstruction accuracy. Stability alone does not separate the hypotheses; publicly inspectable and revocable rule-governed authority does.

**Premise correction flagged:** none

### I.2 → Chapter 3 (ls) -- Consent and legible authority

**Memo page:** 14

**Exercise as the memo restates it:** not restated

**Memo solution:** 2.1 Check. Tacit consent is inferred from remaining in or using a system. Express consent is a discrete act over named terms. Definition I.2.1 is express because the operator affirmatively issues a grant with scope, stakes ceiling, reversibility floor, TTL, and revocation semantics.

2.2 Check. If an autonomy level can suppress the override, it can make its own authority irrevocable: keep executing, hide the stop channel, or race destructive effects after consent is withdrawn. The override must be out-of-band, higher priority than agent work, and coupled to effect revocation, not merely a UI flag.

2.3 Trace. The operator signs grant g; the daemon validates and records it; an eligible low-stakes action cites g; the daemon mediates the effect; the receipt records action, reason, artifact, and grant version; expiry or revocation removes g from the active set and fences later effects. The legible-sovereign rule binds at every authority transition, especially issue/revoke and admit/deny. The explicit witness record is where reconstructability is discharged.

2.4 Open; also 9.4. Use one complete append-only decision ledger, not a second ranked dashboard. For every candidate item, store candidate ID, source/evidence pointers, policy and model version, input features, score components, threshold/lane, surfaced-or-suppressed verdict, reason codes, expiry, and a counterfactual such as "would surface if anomaly were 0.08 higher." The operator can query suppressed since cursor, sort by any raw field, and sample items uniformly rather than through the production ranker. Decisions are immutable; their current relevance expires by signal-specific TTL and is recomputed from raw state. Run independent random omission audits and expose raw event-log access.

The regress terminates at completeness plus direct sampling: the base ledger records every candidate and every ranking decision, and the counter-surface is a deterministic query over it. Another learned ranker would recreate the regress. The remaining trust assumption is the complete event-capture boundary; that assumption should be tested and externally anchored, not hidden behind another summary.

**Premise correction flagged:** none

### I.3 → Chapter 3 (ls) -- Digest-with-zoom

**Memo page:** 15

**Exercise as the memo restates it:** not restated

**Memo solution:** 3.1 Check.
- Port number: flatten as structured administrative state.
- Failed-test stderr: preserve verbatim or by a content-addressed pointer.
- "The auth refactor felt risky so I split it": preserve verbatim and label it self-narration, not fact.
- Commitment status enum: flatten.
- 600-line diff: do not paraphrase away; retain the immutable diff or a verified pointer and summarize only administrative metadata.

3.2 Check. Two models may share training biases, prompts, sources, and failure modes. Agreement over the same narration is correlated testimony, not independent evidence. A second check must derive from an independent channel such as repository state, a protected test runner, or a separately controlled reviewer.

3.3 Trace. A typical CI dashboard often fails as follows: deploy is irreversible but the green tile does not force a log/diff view; administrative state and diagnostic detail are flattened together; the summary is generated from job narration rather than independently from receipts; and a skipped/cancelled check has no named authority reason. It therefore violates Definition I.3.1 wherever a material green claim has no total zoom path to the exact tree, suite, runner, and output that produced it.

3.4 Open. L2 can compare structured narration claims against independently derived artifacts: claimed changed files versus the tree diff, "tests passed" versus a protected runner receipt, "no deletion" versus Git objects, and claimed command results versus brokered tool logs. Emit a contradiction event on mismatch. This catches deterministic report/artifact divergence, deleted tests, fabricated execution, and omitted changed paths. It cannot establish semantic correctness, detect a poisoned acceptance suite, observe effects that bypass logging, or distinguish two artifacts that are syntactically consistent but jointly wrong. Those require effect confinement, independent evaluation, or later outcome evidence.

**Premise correction flagged:** none

### I.4 → Chapter 3 (ls) -- Authority and completion

**Memo page:** 15

**Exercise as the memo restates it:** not restated

**Memo solution:** 4.1 Check. Verifiable zoom says narration is not ground truth. A reviewer with no independent evidence would merely add another narration. Adversarial review follows because a consequential claim needs an evidence channel controlled independently of the actor whose work is judged.

4.2 Check. Property I.4.1 should be read as: prevent a prohibited state when every decisive effect can be intercepted before it occurs; otherwise detect, contain, and compensate without pretending prevention. A uniqueness constraint can regiment "one holder per exact key." A post-commit monitor can detect an out-of-scope edit and trigger rollback/salvage, but the bad prefix already happened.

4.3 Trace. For "the migration applies cleanly," the verifier is an isolated migration run against a declared base schema/database, with exact migration hash, runner image, exit status, and resulting-schema check. done and any merge/settlement are gated on that receipt. "The API feels ergonomic" has no mechanical truth predicate. It must go to a declared human/expert or plural judge with preserved evidence and uncertainty; absent that authority, completion remains provisional or fails loudly.

4.4 Open. Honest fallback ladder: (1) use a deterministic verifier where the property is decidable; (2) require an independent bounded evaluator or human for a declared subjective criterion; (3) record a provisional result, confidence, appeal window, and residual risk; (4) return unresolved/fail-loud when no authorized evaluator can support the claim. "I cannot verify this" is correct when the available evidence cannot distinguish success from failure under the contract. It is a cop-out only when an affordable, authorized verifier was specified and simply not run.

**Premise correction flagged:** none

### I.5 → Chapter 3 (ls) -- Operator attention

**Memo page:** 15

**Exercise as the memo restates it:** not restated

**Memo solution:** Correction to Figure I.6 and Eq. I.1. With evidence of danger increasing to the right and "zoom if evidence exceeds beta," moving beta left is more stringent: it causes more zooms, fewer misses, and more false alarms. The figure's prose calling that criterion "lax" reverses the direction. Also, if Cfa already means wasted zoom attention, adding a E[zooms] double-counts that cost; define Cfa to exclude attention or remove the extra term.

5.1 Check. As Cmiss/Cfa -> infinity, the optimal criterion moves toward forced review wherever a miss remains possible; the forced-zoom probability approaches one on the ambiguous region. If reputation r -> 1, nothing follows from Eq. I.1 alone because r is absent. Zoom should decline only under a calibrated model in which high r shifts the class-conditional danger probability downward for this agent, action class, and current version. High reputation must not defeat hard stakes or irreversibility gates.

5.2 Check. An operator may be correctly confident in one agent's formatting/test-only changes and correctly skeptical of its schema migrations. A global trust knob averages those histories, forcing needless review of safe formatting while under-reviewing migrations. Calibration belongs to (principal, agent/build, action class, environment), with uncertainty and freshness.

5.3 Trace. Campbell pressure appears when canaries are selected (recognizable templates), exposed (agents/operators learn signatures), scored (catch rate substitutes for real defect discovery), and acted on (friction creates incentive to optimize the metric). Time-on-task and breaks also confound the score. Reduce distortion with a blinded, continuously refreshed holdout drawn from real failure transformations; separate the party generating canaries from the operator; correct for exposure time and base rate; and use catch rate as one diagnostic, never the sole gate.

5.4 Open. Model each digest policy d by (token cost T(d), human time H(d), expected decision loss L(d)) and compare nondominated policies. A Pareto frontier exists for a finite policy set, but there is no universal inverse relation: removing redundant context can lower both token cost and operator time; beyond that free compression frontier, preserving evidence often trades tokens for review effort or lower error. Optimize under a loss or safety constraint, for example min alpha*T + beta*H + L subject to zero omission of hard obligations. Report the frontier empirically; do not claim one universal digest optimum.

5.5 Open. Randomize operators or time blocks among manual-tax, automation-only, projection/freeze-probe, and adaptive-tax conditions. Use matched repositories and fixed surprise events. Probe without warning: next-three-effect prediction, takeover completion time, false-belief rate, Brier score, post-interruption recovery, defect catch, NASA-TLX, and retention weeks later. Measure disablement/avoidance as an outcome. A useful tax improves later projection/takeover after controlling for interruption cost; mere annoyance raises workload and disablement without those gains.

**Premise correction flagged:** "Correction to Figure I.6 and Eq. I.1. With evidence of danger increasing to the right and "zoom if evidence exceeds beta," moving beta left is more stringent: it causes more zooms, fewer misses, and more false alarms. The figure's prose calling that criterion "lax" reverses the direction. Also, if Cfa already means wasted zoom attention, adding a E[zooms] double-counts that cost; define Cfa to exclude attention or remove the extra term."

### I.6 → Chapter 3 (ls) -- Read-poverty

**Memo page:** 16

**Exercise as the memo restates it:** not restated

**Memo solution:** 6.1 Check. Writes can be serialized through one daemon, rejected by uniqueness constraints, and reconciled through version control. Read demand grows with agents, artifacts, histories, and possible collaborators; without indices every query becomes an O(n) scan and the operator is the fixed-rate server. Thus discovery and relevance, not raw write throughput, become the scale bottleneck first.

6.2 Check. A directory pays at write time to normalize metadata and update indices, typically O(log n) per indexed insert (or expected O(1) for a hash index) plus storage. It buys selective reads in O(log n + k) for k results rather than O(n) roster scanning, along with a queryable provenance trail.

6.3 Trace. At n=1, briefing, honest self-attestation, footgun gating, completion receipts, and resurrection handoff already reduce uncertainty. None asks "which collaborator fits?"; they project or verify one actor's state, so they are not discovery ranking.

6.4 Trace. The bound is log2 C(N,k) - log2 C(m,k). At k=0 there is only one critical subset and the floor is zero. For small positive k, the cost is roughly k log2(N/m) when k << m,N. At k=N/2, exact identification (m=k) costs about N bits, while opening almost everything drives the floor down and m=N makes it zero. The danger fraction alone is not enough; the allowed review budget m matters. Mostly safe work is cheap only when the system can reliably identify that sparsity.

6.5 Open. The theorem is conditional on an encoder that knows the true critical set. If an adversary controls apparent criticality and can make a critical artifact observationally indistinguishable from inert artifacts, any policy that opens fewer than all N can be forced to miss one. Zero miss then requires inspecting all N, a trusted independent signal that restricts the adversary, or a randomized guarantee stated probabilistically. The combinatorial bound still applies after a true set is fixed; it does not solve adversarial set identification.

**Premise correction flagged:** none

### I.7 → Chapter 3 (ls) -- Directory and split ranker

**Memo page:** 17

**Exercise as the memo restates it:** not restated

**Memo solution:** 7.1 Check. No monotone scalar transform can identify collaborator fit with operator regret on a domain containing high-fit/low-risk and low-fit/high-risk items. Discovery minimizes routing loss or maximizes capability fit; the attention head minimizes expected loss from not inspecting, ideally value of inspection / attention second, not merely raw stakes times anomaly.

7.2 Check. The attention queue allocates a scarce human interrupt channel, so agents benefit directly from inflating its score and buried items can cause irreversible loss. Discovery gaming usually yields a bad routing recommendation and can be corrected before effect. Both Goodhart, but the queue has stronger incentives and consequences.

7.3 Trace. Without expiry, the dead holder's row remains authoritative and the live agent is denied forever. With a lease, heartbeat-based expiry, and a new fencing epoch, the stale lease becomes ineligible; a lazy sweep on the next acquire removes it; the live agent receives a higher epoch and proceeds. Merely decaying a display score is insufficient: ownership must actually expire, and every effect boundary must reject the stale epoch.

7.4 Trace. The escalation cites evidence and posts a small stake or reputation exposure. The operator's dismissal is itself reasoned and appealable; only a confirmed low-value/false escalation debits the signaler. Repeated unsupported alarms raise future cost or lower priority, while verified hazards return the stake and improve calibration. Never debit solely because an operator clicked dismiss: that would silence minority warnings and make authority error self-validating.

7.5 Open. Accept/reject is useful implicit relevance feedback but is confounded by position, exposure, workload, and incumbent policy. Learn with logged propensities, small randomized exploration, counterfactual evaluation, and a held-out labeled sample; preserve refusals and downstream task outcomes. If acceptance directly trains what is shown, the loop can entrench its own choices, so it cannot be the sole ground truth.

7.6 Open. Use hard expiry for leases/presence; state transition or supersession for commitments; summary plus source provenance for decisions/rationale; immutable storage for evidence; and eviction plus a content-addressed pointer for reconstructable diffs/logs. Hints may decay continuously. Never decay a still-open obligation or recursively summarize prior summaries.

**Premise correction flagged:** none

### I.8 → Chapter 3 (ls) -- Tokens and compaction

**Memo page:** 17

**Exercise as the memo restates it:** not restated

**Memo solution:** 8.1 Check. The operator digest and the context compaction must be the same provenance-preserving projection from durable sources. If a separate model summarizes the already-compacted agent story, cost control and truth control diverge and recursive-summary error compounds.

8.2 Check. Context past the model's effective window costs tokens while degrading retrieval and reasoning. Removing redundant/inert material and edge-placing hard facts can therefore reduce spend and improve accuracy simultaneously, provided obligations and source pointers survive.

8.3 Trace.
- Briefing: reader is an arriving agent; drops old conversational detail; keeps current roles, work, constraints, decisions, and source links.
- Attention queue: reader is agent/operator now; drops low-value candidates from the immediate view; keeps highest value-of-inspection items plus the suppression ledger.
- Episodic memory: reader is a future incarnation; drops transient chatter; keeps typed incidents, decisions, outcomes, and retrieval features.
- Pheromone: reader is the swarm; continuously drops stale coordination weight; keeps fresh shared traces.
- Resurrection handoff: reader is a successor; drops nonessential transcript detail; keeps the task capsule, artifacts, obligations, pending operations, and provenance.

8.4 Trace. Context rot -> compact earlier to an effective-window budget. Lost-in-the-middle -> shorten and edge-place mandatory facts. Recursive-summary collapse -> re-derive every compaction from raw durable artifacts. Over-flattening -> require a total zoom path from every material claim. The third cure prevents model noise from becoming the next round's source of truth.

8.5 Open. "Replay from digest alone" is neither sound nor gaming-resistant: a digest can overfit the smoke task or omit facts the sampled successor never needed. Give a successor the digest plus authorized content-addressed source links, then measure next-step success, false beliefs, obligation recall, time, and tokens on hidden continuation tasks. Add a cheap structural invariant: every open claim, decision, commitment, risk, and pending external effect has exactly one valid digest entry or pointer. Run expensive replay only on a random sample.

8.6 Open. Budget allocation over a precedence DAG is a knapsack/resource-allocation problem and is NP-hard in general. First reserve a minimum viable budget for each mandatory node and any predecessor needed to make its output exist. Allocate the remainder by estimated marginal outcome value per token while respecting precedence; recompute after each result. For a monotone submodular value function under a cardinality budget, greedy earns the standard (1 - 1/e) approximation; for arbitrary complementarities there is no such bound. Dynamic programming is pseudo-polynomial for small integer budgets or trees. A reviewer's tokens have near-zero value until the worker artifact it reviews exists.

**Premise correction flagged:** none

### I.9 → Chapter 3 (ls) -- Canon mapping

**Memo page:** 18

**Exercise as the memo restates it:** not restated

**Memo solution:** 9.1 Check. Agents are the multitude bound by the common coordination protocol; the daemon is the sovereign-as-actor that applies the rules; the operator is the author/principal who originates and can withdraw authority. Calling the operator the sovereign collapses author and executing authority and makes the supposed covenant among agents incoherent.

9.2 Check. Voice is honest only if refusal has consequence for the authority. The unconditional override supplies exit: the operator can revoke the grant when explanations or appeals fail, rather than being forced to keep negotiating inside a system they cannot stop.

9.3 Trace. The grant is discrete, explicitly issued, scoped, time-bounded, and revocable/audited. "Started using the tool" has none of those four properties.

9.4 Open. Same answer as 2.4: complete decision capture, deterministic raw queries, independent sampling, and an externally anchored event boundary terminate the regress. Do not rank the ranker's omissions with the same ranker.

**Premise correction flagged:** none

**Chapter II -- The Single-Writer Kernel (now Chapter 1, prefix `swk`)**

### II.3 → Chapter 1 (swk) -- Seven organs

**Memo page:** 18

**Exercise as the memo restates it:** not restated

**Memo solution:** Check. In-memory operation preserves transient versions of resource exclusion, identity/presence, communication, obligation checks, policy checks, and self-attestation while the process lives. The substrate still serializes. Durable continuity, crash recovery, historical audit, and outcome evidence become vacuous after process death; durable identity also collapses to an ephemeral handle. The organs remain conceptually meaningful, but their cross-crash guarantees disappear.

Trace. Example: the communication organ's home table is messages. It owes the layer above an ordered, cursor-addressable, durable envelope with explicit at-least-once semantics. Equivalent valid choices include claims for the resource organ (one compatible holder per conflict domain) and commitments for obligation (no done without a current structured oracle receipt).

Open. A useful nine-way cut is: storage/durability, transaction serialization, identity/presence, resources/leases, message transport, stigmergy/projections, policy/capability, commitments/outcomes, and attestation/recovery. It separates proof obligations that currently leak across organs, especially transport semantics from message semantics and policy prevention from post-commit detection. It hides the simplifying fact that all local state shares one transaction boundary, so retain a cross-cutting "one ledger/effect mediator" invariant.

**Premise correction flagged:** none

### II.4 → Chapter 1 (swk) -- One writer and schema evolution

**Memo page:** 19

**Exercise as the memo restates it:** not restated

**Memo solution:** Check. Module A renames users.name to display_name; module B, loaded later under old code, sees no name and lazily adds it back. Writes now split between two columns according to module version/load order, and neither backfill is authoritative. Any destructive migration has this problem.

Trace. CLI -> authenticated Unix-socket request -> daemon request queue -> sole read/write connection -> transaction -> WAL commit. Routing enforces the discipline at the client/API boundary and at the daemon's sole-connection boundary; SQLite's file lock is one backstop at write time. The primary story is routing, not a database rule that forbids other connections.

Open (OP-7). Expand/backfill/dual-read-or-write/contract can keep mixed versions safe temporarily, but the contract step and dependency order are global facts. Store a migration ledger with schema epoch, module compatibility range, dependencies, and backfill watermark. Idempotent self-init can remain for additive tables/columns; safe rename/backfill/down-migration cannot preserve unrestricted "any module, any order." A version or equivalent ordered capability ledger is unavoidable.

**Premise correction flagged:** none

### II.5 → Chapter 1 (swk) -- Durability by fault class

**Memo page:** 19

**Exercise as the memo restates it:** not restated

**Memo solution:** Check. (a) forced daemon kill: I1a-survivable; (b) a genuinely clean OS reboot: normally flushed during orderly shutdown, so it is not the I1b fault case; an abrupt reset during reboot is I1b-exposed; (c) power cord: I1b-exposed; (d) unhandled handler exception/process crash: I1a-survivable after commit. None says an uncommitted transaction survives.

Trace - correction. A commit is power-loss exposed from t0 until the WAL containing it is synced. A page-count auto-checkpoint threshold bounds accumulated WAL frames, not elapsed time delta. At a low or zero write rate the threshold may not fire for arbitrarily long, so there is no wall-clock bound. With an independently guaranteed lower write rate w_min pages/second and threshold P, one could derive approximately delta <= P/w_min; the manuscript states no such assumption.

Open (OP-10). Expose durability = PROCESS_CRASH | POWER_LOSS on a transaction, not an adjective in prose. Route POWER_LOSS operations through a connection/database configured synchronous=FULL before the transaction and verify commit before returning; a separate FULL-sync financial ledger is the cleanest isolation if SQLite settings are connection-scoped. Keep ordinary claims on NORMAL. Hard-reset fault tests must validate the stronger path. A forced checkpoint can bound recovery/log size, but FULL commit sync is the relevant per-write durability primitive.

**Premise correction flagged:** "Trace - correction. A commit is power-loss exposed from t0 until the WAL containing it is synced. A page-count auto-checkpoint threshold bounds accumulated WAL frames, not elapsed time delta. At a low or zero write rate the threshold may not fire for arbitrarily long, so there is no wall-clock bound. With an independently guaranteed lower write rate w_min pages/second and threshold P, one could derive approximately delta <= P/w_min; the manuscript states no such assumption."

### II.6 → Chapter 1 (swk) -- Claims, ranges, and fairness

**Memo page:** 19

**Exercise as the memo restates it:** not restated

**Memo solution:** Correction to Theorem II.6.1. A uniqueness constraint proves at most one row per exact key. It does not exclude overlapping line intervals, a whole-file claim versus a symbol claim, path ancestry (dir/ versus dir/file), or semantically overlapping resources. Those require canonical conflict domains or a transactional overlap predicate/index. The theorem must be scoped accordingly.

Check. Releasing with no matching (key, holder) is a successful no-op so retries are idempotent (I3). It must not delete another holder's row. Raising on an already-completed release would make timeout/retry clients unable to distinguish success from failure and would break at-least-once handling.

Trace. The daemon serializes the requests. The first INSERT(key, holder) commits. The second hits the unique-key violation, selects the extant row, and returns DENIED(holder=first). For range/hierarchy claims this trace is safe only after both requests map to the same canonical conflict key or the overlap test is done in one immediate transaction.

Open (OP-1). Add a durable FIFO ticket queue per conflict domain, maximum lease L, monotonically increasing fencing epoch, and grant-to-head on release, acquire, or lazy expiry. No background scheduler is required for safety, but liveness requires a live caller/tick to trigger transitions. Under daemon availability, eventual requests, and non-renewable bounded leases, a requester with q predecessors waits at most roughly (q+1)L plus processing delay. Without those assumptions no bounded wait exists. Every external effect must validate the fencing epoch or an expired holder can still act.

**Premise correction flagged:** "Correction to Theorem II.6.1. A uniqueness constraint proves at most one row per exact key. It does not exclude overlapping line intervals, a whole-file claim versus a symbol claim, path ancestry (dir/ versus dir/file), or semantically overlapping resources. Those require canonical conflict domains or a transactional overlap predicate/index. The theorem must be scoped accordingly."

### II.7 → Chapter 1 (swk) -- Bus and markers

**Memo page:** 20

**Exercise as the memo restates it:** not restated

**Memo solution:** Check. If the evaporation tick stalls for an hour, tick-only storage still reports yesterday's marker weight. Read-time evaluation computes w * r^delta_t from the persisted timestamp and therefore never presents the stale stored number as current.

Trace. Transport delivers one request twice. The consumer applies one semantic state transition; the duplicate is silently recognized as transport nondeterminism, while diagnostics may count the redelivery. An envelope idempotency key plus a unique (consumer, key) receipt lets the consumer atomically store "effect applied" with the effect, making retry safety explicit. "Exactly once" is still not guaranteed for an unbrokered external effect.

Open (OP-8). For each marker kind, log creation, reads, actions influenced, supersession, and the time at which operators label it stale. Fit a survival/hazard curve and choose the half-life minimizing C_stale * false-live + C_lost * false-expired, validated on held-out projects. Claims/presence should decay far faster than decisions or learned skills. Publish confidence and re-estimate under drift.

**Premise correction flagged:** none

### II.8 → Chapter 1 (swk) -- Regimentation versus detection

**Memo page:** 20

**Exercise as the memo restates it:** not restated

**Memo solution:** Check. Note-count monotonicity can be regimented by append-only storage or a trigger rejecting delete/regressive update. Capability attenuation and lock-owner release can be prechecked only if authenticated identity, the capability order, and every relevant effect path pass through the mediator. Duplicate keys and boot admission are already pre-effect. Heartbeat freshness cannot be rejected at the heartbeat insert: staleness is an absence observed only after time passes, and under asynchrony a slow actor is indistinguishable from a failed one. Out-of-band filesystem/network effects remain only detectable until mediated.

Trace. close(done, oracle_ref="") reaches line 4 of Algorithm II.2, returns REFUSED, leaves the commitment open, and records the denied authority act. It never reaches classification, current-state verification, or the DONE transition.

Open (OP-2). A safety property is regimentable iff every event that can complete one of its finite bad prefixes crosses a trusted mediator before its real-world effect and membership in the allowed next-event set is decidable there. Then suppressing the event enforces the property. If the decisive event is observed only after commit, occurs outside the mediator, depends on future absence, or needs an undecidable semantic judgment, the mechanism can enforce only detection/containment/recovery properties.

Open (OP-5). Add a PROTECTED_RUN_RECEIPT oracle containing tree hash, suite hash controlled by the principal, runner/image hash, command, timestamp/nonce, exit code, and signed result. Closure verifies all bindings and freshness. This resists free-text and stale-result manipulation; it is not universally Goodhart-proof because the suite may be incomplete or poisoned. The honest theorem is syntactic provenance and non-replay, not semantic correctness.

**Premise correction flagged:** none

### II.9 → Chapter 1 (swk) -- Continuity and checkpoints

**Memo page:** 21

**Exercise as the memo restates it:** not restated

**Memo solution:** Check. Notes preserve explicit goals, rationale, observations, and artifact pointers. They do not preserve unflushed edits, process memory, open handles, provider KV cache/hidden state, or a latent next action the model never externalized. A successor may understand the story yet be unable to resume the exact computation.

Trace. The append commits. A later delete/regressive count also commits and enters the operation log. Only then does the subscriber observe the count drop and raise/compensate. The violation is already durable at the second commit; the monitor proves detection, not prevention.

Open (OP-4). Use a content-addressed task capsule at a safe tool/message boundary: base tree and worktree blobs, environment/tool manifests, open claims with epochs, commitments/acceptance criteria, exact tool I/O, pending external operations and idempotency keys, decisions/hypotheses, transcript or provenance-preserving compaction, and external references. Flush the ledger and quiesce mediated effects before sealing it. This restores observable task state and evidence. It cannot recover hidden activations, unexposed reasoning, provider-internal caches, or unrecorded intent; arbitrary-provider recovery is semantic continuation, not bit-identical resurrection.

**Premise correction flagged:** none

### II.11 → Chapter 1 (swk) -- Consistency and runtime parity

**Memo page:** 21

**Exercise as the memo restates it:** not restated

**Memo solution:** Check. The four assumptions are: one daemon/connection handles all claim/lock reads and writes; no read_uncommitted; respond only after commit; and no out-of-band writer. A write-capable external SQLite connection directly violates the first and fourth (the out-of-band-writer assumption is the most literal first failure). A read-only connection need not break write linearizability but may observe under different timing/API semantics.

Trace. A invokes claim(k) and commits at c1. B and C overlap; B's denied read commits/returns at c2, A releases at c3, and C's acquire commits at c4. One valid order is A-acquire < B-denied < A-release < C-acquire. If B and C overlap around the release, either may linearize first as long as each result matches the chosen state and non-overlapping real-time order is preserved.

Open (OP-3) - correction. A finite differential suite cannot "make I11 a theorem." It supplies bounded evidence. Generate identical state-machine traces against both bindings: schema init/migrations, acquire/reclaim/release/expiry, overlapping calls, transactions and rollback, busy/lock behavior, encodings, PRAGMAs, crash/reopen, and fault injection. Compare returned values, errors, serialized rows, schema, and recovery state after every step, including the deployed binary in CI. A theorem requires a formal refinement/equivalence proof or the same verified binding; tests should be labeled conformance evidence.

**Premise correction flagged:** "Open (OP-3) - correction. A finite differential suite cannot "make I11 a theorem." It supplies bounded evidence."

### II.12 → Chapter 1 (swk) -- Cross-organ atomicity

**Memo page:** 21

**Exercise as the memo restates it:** not restated

**Memo solution:** Check. The port remains claimed and a live/ghost session row exists, but there is no commitment saying what work owns them. Other agents see a busy port and session presence they cannot reconcile; the failed starter may retry into its own leftovers.

Open (OP-11). Expose one begin_work(...) endpoint that starts BEGIN IMMEDIATE, validates all inputs, inserts claim/session/commitment/outbox rows, and commits once; on any error it rolls back all. A Saga would release the claim and mark/delete the session if the commitment insert failed, but those compensations can themselves fail or crash between steps. Since all three rows are in one SQLite file, the local transaction is both simpler and stronger.

**Premise correction flagged:** none

### II.13 → Chapter 1 (swk) -- Threat boundary

**Memo page:** 21

**Exercise as the memo restates it:** not restated

**Memo solution:** Check. A local hash chain can expose edits by a later same-user database tamperer or by a remote synchronizer that cannot rewrite an externally anchored root. The same-user process is excluded locally; the adversary becomes meaningful in the cross-machine/economy layer. Without an independent anchor or verifier, the writer can rewrite the log and recompute the chain.

Trace. The release path compares the supplied actor ID to the lock owner. If a legacy endpoint accepts a self-asserted ID, the attacker submits the victim's string; the equality check passes and the owner-scoped delete executes. The lock rule is correct relative to its input, but I12 failed to authenticate that input. Complete credential/peer binding must precede every security-relevant write.

Open (OP-9). The minimum useful wall is a daemon under a separate UID (or VM), daemon-owned DB/key, Unix-socket ACL plus kernel peer credentials, and brokered Git/filesystem/network effects. An OS keychain protects a key at rest but not arbitrary signing requests from an equally authorized same-user process. "Sealed memory" does not stop same-UID ptrace/injection without an OS isolation policy. External root anchoring detects later log rewrite but does not prevent it. No TPM is required for strong local separation; separate privilege and complete mediation are.

**Premise correction flagged:** none

**Chapter III -- From Spawn to Person (now Chapter 4, prefix `stp`)**

### III.1 → Chapter 4 (stp) -- Dependency chain

**Memo page:** 22

**Exercise as the memo restates it:** not restated

**Memo solution:** Check (1). A spawn is a temporary process filling a role; a person is a role-holder whose accountable continuity survives replacement of that process.

Trace (2). Read right-to-left:
- No reputation -> a buyer cannot price differentiated trust, so the alleged tradeable asset is adverse-selection noise.
- No durable accountable person/outcome identity -> reputation attaches to a disposable incarnation and can be reset or duplicated.
- No continuity -> successive role-holders cannot be shown to belong to one lineage; history does not follow replacement.
- No memory/checkpoint/evidence -> a successor lacks both resumable state and a witnessed chain from old work to new work.

The chain is not literally linear: non-forgeable identity and witnessed outcomes are parallel prerequisites for accountable continuity; checkpointing is valuable for resumption but is not logically necessary for every reputation system.

Open (3). The human operator is a moral/legal person but should be represented economically as the principal above agent identities. If one principal can mint unlimited apparently independent agent-persons, it can whitewash sanctions, forge quorums, reuse aggregate collateral, and farm reputation through self-trade. Bind every agent lineage to a principal credential, cap principal-wide exposure and newcomer credit, and disclose shared control. The actor may change; the economic liability root must not.

**Premise correction flagged:** none

### III.3 → Chapter 4 (stp) -- Role, capability, permission

**Memo page:** 22

**Exercise as the memo restates it:** not restated

**Memo solution:** Check (1). Capable-and-permitted: an agent has a test-runner tool and authority to run the suite. Capable-but-forbidden: the process can invoke raw git push --force, but policy forbids it. Permitted-but-incapable: the role is authorized to deploy, but the incumbent has no deploy credential/network route.

Trace (2). Reputation attaches to the person's continuity witness and witnessed outcomes, not to the abstract role's O, C, or A. A role is fillable and history-free. Otherwise a fresh spawn could inherit the prior holder's credit merely by taking the same job title.

Open (3). Keep a role template (O_required, A_role) separate from an incumbent capability set C_subject. At assignment require each current obligation to satisfy O_active subseteq A_role intersect C_subject. Keep C_subject - A_role as capable-but-forbidden and A_role - C_subject as authorized-but-unavailable, which triggers provisioning or reassignment. Never equate C with A.

**Premise correction flagged:** none

### III.4 → Chapter 4 (stp) -- Connectedness, continuity, and forks

**Memo page:** 23

**Exercise as the memo restates it:** not restated

**Memo solution:** Check (1). Connectedness is a direct memory/intention link between two incarnations; continuity is the transitive, provenance-bearing chain across arbitrarily many links. A successor may read its predecessor's handoff and be psychologically connected while using a new outcome-ledger key, so the accountable chain is broken: connected, not economically continuous.

Trace (2). In the manuscript's analogy, the body-lease is the replaceable live substance/process; the actor-soul is the durable identity/mailbox/history that carries consciousness-like continuity. Respawn replaces the body-lease and should retain the actor-soul only under a valid succession event.

Open (3). Represent a fork as a lineage DAG, never as two copies of one linear identity. Both children may display the ancestor's evidence with an explicit inherited/discounted prior, but neither duplicates the ancestor's outstanding authority, collateral, or spendable reputation. Allocate a fresh branch ID, split or revoke exclusive capabilities, and aggregate risk at the common principal/ancestor. Copying full reputation to both invites credit duplication, quorum multiplication, and double-spending of grants; giving it to only the first child creates a fork-race attack.

**Premise correction flagged:** none

### III.5 → Chapter 4 (stp) -- Three continuity organs

**Memo page:** 23

**Exercise as the memo restates it:** not restated

**Memo solution:** Check (1). The checkpoint organ is the specifically weak one: it forwards notes rather than execution state. The outcome organ is also only partial in the implementation: commitments and oracle closure exist, but neutral graded outcomes and reputation binding do not.

Trace (2). Memory retains the session, notes, and explicit decisions. The current checkpoint may retain a handoff and perhaps a committed diff, but not working process state, tool handles, pending effects, or hidden provider state. The outcome ledger retains the commit only if it is bound to a work unit and independently witnessed; a naked Git commit is an artifact, not proof of accepted delivery. A strong checkpoint would also preserve the worktree, environment, open claims/epochs, acceptance state, tool receipts, and idempotency journal.

Open (4). Useful death taxonomy:
1. Record survival: logs/notes only; reconstruction is manual.
2. Artifact survival: content-addressed worktree and outputs survive; computation is rerun.
3. Semantic task capsule: artifacts plus obligations, decisions, transcript/projection, tools, and pending-effect journal; a new provider can continue observably.
4. Execution snapshot: process memory/runtime state survives under a controlled runtime; rarely portable.
5. Latent state: unexposed activations, KV cache, or "intent" dies; it is fundamentally unrecoverable from an arbitrary provider.

Checkpoint guarantees should state which tier they provide.

**Premise correction flagged:** none

### III.6 → Chapter 4 (stp) -- Identity and whitewashing

**Memo page:** 23

**Exercise as the memo restates it:** not restated

**Memo solution:** Correction to Theorem III.6.1. Free fresh identities do not by themselves imply that every sanction disappears. Counterexample: a mature identity has score 10, is sanctioned to 8, and a fresh identity starts at 0; with free minting the actor's best accessible score remains 8, a real reduction from 10. The proof's equality max(r(i)-Delta, r0)=r0 holds only when r(i)-Delta < r0, and the conclusion also needs fresh identities to receive equivalent economic access. The valid theorem is conditional: if an actor can costlessly obtain a fresh identity whose accessible utility is at least its sanctioned utility (or can replicate identities to defeat a quorum), identity-local sanctions/weights are evadable.

Check (1). Correctly scoped, Property III.6.1 says reputation has economic force only to the extent that the accountable principal cannot cheaply discard or multiply the liability-bearing identity. Whitewashing escapes a negative record when newcomer access is better; a Sybil attack multiplies votes/credit when the mechanism counts identities. Non-forgeability is necessary for those mechanisms under those access rules, but it is not sufficient and the printed universal theorem is false.

Trace (2). Full work with a reduced economic ceiling lets an honest newcomer demonstrate competence without being denied livelihood, while limiting the maximum one-shot gain from abandoning a mature sanctioned identity. "Reduced work" slows evidence accumulation and taxes all honest entrants; "reduced exposure" targets the externality. The ceiling schedule must be chosen so the maturation opportunity cost exceeds plausible evasion gain.

Open (3). Principal binding is the load-bearing defense: aggregate reputation, exposure, counterparties, and sanctions across the 1,000 agents, so self-trades add little or no independent evidence. A listing fee raises attack cost but only deters while total fees exceed the minted value. Sampled adversarial re-audit detects fabricated work, with false-positive burden approximately the sampling rate times the honest high-volume population and adjudication error. Add sharply diminishing credit per principal pair, independent payer stake, and principal-wide reserve limits.

**Premise correction flagged:** "Correction to Theorem III.6.1. Free fresh identities do not by themselves imply that every sanction disappears. Counterexample: a mature identity has score 10, is sanctioned to 8, and a fresh identity starts at 0; with free minting the actor's best accessible score remains 8, a real reduction from 10. The proof's equality max(r(i)-Delta, r0)=r0 holds only when r(i)-Delta < r0, and the conclusion also needs fresh identities to receive equivalent economic access. The valid theorem is conditional: if an actor can costlessly obtain a fresh identity whose accessible utility is at least its sanctioned utility (or can replicate identities to defeat a quorum), identity-local sanctions/weights are evadable."

### III.7 → Chapter 4 (stp) -- Local identity versus cross-operator attestation

**Memo page:** 24

**Exercise as the memo restates it:** not restated

**Memo solution:** Check (1). Local non-forgeable identity proves that, inside one trusted daemon, an actor cannot freely impersonate or re-pick its daemon-issued handle. Cross-operator attestation must additionally bind a key to a durable principal across a hostile operator boundary, establish proof of possession/freshness, aggregate related agents, and support revocation and audit.

Trace (2). "Alice and Bob settle across a boundary neither controls" secretly assumes the cross-operator stone. With only local identity, Bob learns at most "Alice's daemon asserts this actor/key." A hostile Alice can mint arbitrary local actors, rewrite local history, or misstate principal separation.

Open (3). A witness log proves publication order and exposes equivocation; it does not prove who controls a key or that two keys are distinct principals. Close the gap with a scarce external root: hardware/remote attestation, organizational/KYC issuer, bonded sponsor chain, or a combination. A transparency log makes bindings and rotations auditable but not true; a sponsor creates economic accountability but can cartelize; a shared identity issuer centralizes and leaks privacy; hardware roots attest devices/code, not unique humans. State the chosen trust and Sybil assumptions.

**Premise correction flagged:** none

### III.8 → Chapter 4 (stp) -- Reputation substrate

**Memo page:** 24

**Exercise as the memo restates it:** not restated

**Memo solution:** Check (1). With a complete, mostly stable paired-comparison history, batch Bradley-Terry uses all observations and is more appropriate than order-sensitive streaming Elo. If abilities drift, use a time-varying/dynamic model rather than pretending full-history stationarity.

Trace (2). A binary protected acceptance test can update a beta-Bernoulli reliability estimate (or a calibrated per-task success model). Human aesthetic preference is naturally pairwise and may use Bradley-Terry/TrueSkill with judge effects. EigenTrust expects a who-trusts-whom graph and therefore fits neither raw task-outcome signal directly.

Open (3). If identities are self-chosen, an exact Bayesian estimator simply produces precise scores for disposable names. If the agent authors the "oracle," a sophisticated estimator precisely learns manipulated labels. Better statistics cannot repair missing provenance, adversarial labels, or liability binding; secure the event-generation substrate first.

**Premise correction flagged:** none

### III.9 → Chapter 4 (stp) -- Why public reputation is not a bandit

**Memo page:** 24

**Exercise as the memo restates it:** not restated

**Memo solution:** Check (1). The four broken assumptions are: stationary arm rewards versus model/skill/version drift; one scalar reward versus buyer-weighted quality vectors; a non-strategic environment versus Goodhart, collusion, and whitewashing; and an observed/trusted reward versus a capturable grader.

Trace (2). A contextual bandit is appropriate for one principal privately routing its own tasks among candidate agents, with a fixed local objective, controlled feedback, exploration budget, and no public asset being minted. The result is a routing policy, not public reputation.

Open (3). Capping the marginal reputation return can reduce direct improvement races, but agents may redirect spending into unmeasured signaling, judge capture, identity proliferation, or lobbying for task mix. Efficiency requires the full game: improvement cost, social value of quality, transferability, and alternative signals. Candidate controls are concave credit, buyer-local vectors, nontransferable evidence, and taxes/bonds on negative externalities. No cap is generically efficient without those payoff assumptions.

**Premise correction flagged:** none

### III.10 → Chapter 4 (stp) -- Multi-dimensional grades and skill effects

**Memo page:** 25

**Exercise as the memo restates it:** not restated

**Memo solution:** Check (1). Accuracy: competent protected test/spec oracle; incompetent self-reporting worker. Aesthetics: competent conflict-free expert reviewer for that domain; incompetent token-cost meter or same-family unblinded model. Efficiency: competent protected resource meter normalized for task; incompetent style reviewer guessing from prose.

Trace (2). The requesting principal/daemon defines the judging work and eligible pool; the selected judge posts its own bond; the grade lands as a signed witnessed event in the subject's outcome ledger with judge/provenance; a conflict-free re-audit or appeal that overturns it slashes the judge under the predeclared rule and tombstones/revises the grade.

Trace (3). Record skill ID/version/content hash, agent/build/principal, task and stratum descriptors, randomized assignment or selection propensity, exact context-graft receipt, model/environment/tool versions, outcome/evidence references, quality vector, costs, and evaluator identities. These fields verify exposure and outcome association. "This skill helped" is causal and cannot be verified from a graft-success pair. Estimate it with randomized skill-on/off assignment on held-out comparable tasks (or label an observational matched estimate honestly), reporting effect size and uncertainty.

Open (5). Publish the vector, per-axis uncertainty, sample sizes, cohort/task distribution, freshness, judge/evidence provenance, and known correlations. Let each buyer apply a local, preferably non-public weighting and hard minimums; do not mint a canonical platform scalar. Agents can still optimize market-demanded axes, so rotate held-out tests and audit cross-axis regressions. Plural preference does not eliminate Goodhart, but it prevents one universal target from becoming the asset itself.

**Premise correction flagged:** none

### III.11 → Chapter 4 (stp) -- Rating the raters

**Memo page:** 25

**Exercise as the memo restates it:** not restated

**Memo solution:** Check (1). Settlement incentives are conditional on the signal distribution. "The daemon derives the grade" only identifies the messenger; if a strategic judge chooses the input, the distribution depends on omitted actions/payoffs and the equilibrium proof assumes its conclusion.

Trace (2). Judge J posts B; its grade and bond lock are recorded; an independently selected re-auditor overturns the dishonest grade against preserved evidence; the system appends a correction/tombstone, recomputes any explicitly appealable settlement, slashes B to the harmed/commons bucket, and lowers J's judging reputation. It must not silently rewrite the original event.

Open (4). With one-shot corrupt gain at most G, re-audit probability rho, conditional detection probability d, and slashable bond B, local deterrence requires rho*d*B > G. Thus the critical rate is rho* = G/(dB); if dB <= G, no feasible rho <= 1 suffices. This does not prove a recursive tower contracts. Termination additionally needs a finite appeal depth/contractual finality or an independently grounded oracle, plus a model showing corruption opportunity shrinks by lambda < 1 at each reachable level.

Open (10). Admit arbiters by domain competence and conflict graph; assign cases randomly/blindly; require bonds and service-level commitments; preserve evidence; pay for timely completed work rather than agreement; sample re-audits and publish calibration/overturn rates; use plural panels on high stakes. Price queue capacity and cap workload so rubber-stamping is not the profitable response to overload. Honest convergence still needs a protected mechanical outcome, delayed real-world outcome, or a final human/contractual authority. A market alone does not manufacture truth.

**Premise correction flagged:** none

### III.12 → Chapter 4 (stp) -- Tombstones and bounded memory

**Memo page:** 26

**Exercise as the memo restates it:** not restated

**Memo solution:** Check (1). An append-only tombstone preserves the original claim, the later correction, their authors, timing, and reliance window. Delete destroys evidence, permits history rewriting, and makes replicas unable to distinguish retraction from omission.

Trace (2). Append a signed tombstone containing the target outcome ID/hash, reason/evidence, authority, revision, and effective time. Propagate it and recompute reputation as a projection that excludes/nullifies that outcome. It was spendable from original publication until each relying harbor received and enforced the tombstone or failed closed; under an unbounded partition that window is unbounded.

Open (8). Use a signed revision DAG, per-harbor import receipts/watermarks, periodic accumulator/Merkle roots for active outcomes and tombstones, and a freshness rule that refuses high-risk use from stale replicas. Under connected eventual delivery, convergence is shown when every member acknowledges a root containing the tombstone; sampling can audit inclusion. Bounded local memory may retain compact accumulators and content-addressed archive pointers, not erase correction commitments. No finite convergence/spend bound exists during an unbounded partition.

**Premise correction flagged:** none

**Chapter IV -- The Harbor Economy (now Chapter 5, prefix `he`)**

### IV.2 → Chapter 5 (he) -- Market prerequisites

**Memo page:** 26

**Exercise as the memo restates it:** not restated

**Memo solution:** E1. Clone: if a bad record can be escaped or good credit multiplied by cloning, neither price nor sanction attaches to an economically durable counterparty.

E2. In operator-for-hire, the operator/principal is the contractual counterparty and bears fleet outcomes through aggregate bond/liability; individual worker processes may be replaceable. Asset rental and agent reputation need an enduring asset owner/lineage only if the product is the continuing agent rather than a one-off warranted service.

E3 - correction. The requested impossibility is too broad. Skill licensing can operate on a content hash, license contract, and durable licensor principal without agent personhood; a rented stateless model artifact can likewise be content-addressed and warranted. What cannot work is identity-weighted reputation, quotas, or unsecured credit over freely cloneable pseudonyms. Any design that avoids that either collapses to a Sybil attack or has quietly introduced another scarce binding - principal identity, artifact hash plus owner liability, hardware root, stake, or sponsor.

**Premise correction flagged:** "E3 - correction. The requested impossibility is too broad. Skill licensing can operate on a content hash, license contract, and durable licensor principal without agent personhood; a rented stateless model artifact can likewise be content-addressed and warranted. What cannot work is identity-weighted reputation, quotas, or unsecured credit over freely cloneable pseudonyms. Any design that avoids that either collapses to a Sybil attack or has quietly introduced another scarce binding - principal identity, artifact hash plus owner liability, hardware root, stake, or sponsor."

### IV.3 → Chapter 5 (he) -- Three sides

**Memo page:** 26

**Exercise as the memo restates it:** not restated

**Memo solution:** E1. A side is a distinct privately informed participant class whose participation must be separately made individually rational and whose price allocation affects cross-side volume. A basic ride-share platform has two sides, riders and drivers; the platform is the mechanism, not a third side. Advertisers, fleet owners, or insurers become additional sides only if separately recruited with their own network externality.

E2. Version 2 has a new content hash, so v1 evidence does not establish v2 behavior. Without an explicit lineage rule, v2 either inherits unsafe credit or cold-starts completely. Bind version, parent hash, dependencies/build, and evaluations; grant only a disclosed discounted prior, then update on v2 outcomes.

E3. Disclose the three components with uncertainty/provenance and let buyers apply local weights and hard constraints. Keep weights heterogeneous or private and show scenario-specific scores only at decision time. Every fixed public scalar creates one order and therefore one optimization target, hiding Pareto tradeoffs and recreating a scalar arm reward.

**Premise correction flagged:** none

### IV.4 → Chapter 5 (he) -- Float plan and settlement

**Memo page:** 26

**Exercise as the memo restates it:** not restated

**Memo solution:** Correction to Protocol IV.4.1. The requester cannot fund a "worker bond" and then have it paid/slashed as if it were the worker's collateral. Separate (a) requester-funded bounty escrow and (b) provider/principal-funded performance bond. Both counterparties must sign the exact plan. Returned collateral is not earnings.

E1. Mechanical trace under the printed, economically confused rule, assuming the same 400 cr bounty: escrow is 650 = 400 bounty + 250 "bond"; at 70%, 175 goes to the worker, 75 to salvage, and 400 returns to requester; 175+75+400=650, so conservation holds even though the bond semantics do not.

Corrected trace: requester escrows bounty 400; provider posts bond 250. If the amended contract pays bounty pro rata and slashes bond by incomplete fraction, worker receives 280 bounty, requester receives 120 bounty refund, provider receives 175 bond refund, and salvage receives 75 slash. 280+120=400 and 175+75=250. Other schedules are possible, but sources and terminal recipients must be explicit.

E2. A protected oracle binds closure to an independently checkable state. A free-text Result: lets the worker self-award completion, fabricate a test/merge result, or choose a favorable interpretation after seeing the work.

E3. Pause at a mediated safe point; propose amendment v+1 referencing plan v, changed criteria, budget, bounty/bond deltas, and treatment of already produced evidence; collect both principals' signatures; atomically top up/refund each party's own escrow buckets and activate v+1; retain v and the causal link. Timeout either continues/settles under v or cancels under its original terms. Never let one party unilaterally rewrite acceptance after performance.

**Premise correction flagged:** "Correction to Protocol IV.4.1. The requester cannot fund a "worker bond" and then have it paid/slashed as if it were the worker's collateral. Separate (a) requester-funded bounty escrow and (b) provider/principal-funded performance bond. Both counterparties must sign the exact plan. Returned collateral is not earnings."

### IV.5 → Chapter 5 (he) -- Rental and licensing on one escrow

**Memo page:** 27

**Exercise as the memo restates it:** not restated

**Memo solution:** E1. The renter/operating harbor holds residual runtime control - sandbox, throttle, revoke - and is the Arbiter jail operator. The owner bears asset/reputation consequences and must honor warranties. Contract terms should specify which failures transfer liability rather than relying on the metaphor.

E2. Conservation survives line items only when each is a balanced transfer from a pre-funded source bucket to an explicit recipient/refund bucket in the same transaction. Amount size cannot break the algebra, but it can break solvency, participation, or collateral adequacy. Conservation is not proof of a viable contract.

E3. Put leaves such as (skill_id, version, content_hash, parent_hash, build/dependency hashes, license, evaluation root) in the portfolio tree. A v2 proof includes parent membership plus its own evaluations. Initialize a Bayesian prior with effective sample size gamma*n_v1, where gamma is a predeclared compatibility/evaluation discount in [0,1]; never copy settled v1 outcomes as v2 outcomes. Lineage proves ancestry, not behavioral similarity.

**Premise correction flagged:** none

### IV.6 → Chapter 5 (he) -- Cross-operator identity

**Memo page:** 27

**Exercise as the memo restates it:** not restated

**Memo solution:** E1. Under Douceur's Sybil result, without a logically centralized/scarce identity authority an actor can create enough pseudonyms to reset sanctions or dominate identity-weighted trust; the "reputation mechanism" is then actor-controlled input.

E2. "Mutually-distrusting" is directly incompatible with assuming either hostile operator is out of scope; so is the phrase "boundary neither controls."

E3. A workable certificate binds (principal_id, agent_key, issuer, epoch, policy, expiry) and requires agent proof of possession. Bonds, quotas, newcomer state, and sanctions key primarily on principal_id; agent certificates are children. Publish issuance/revocation in a transparency log and use cross-signing/attestation for the issuer. Cryptography cannot prove one real-world principal or stop a hostile operator from inventing principals by itself. The root must be scarce: organizational/KYC credential, hardware-backed membership, bonded sponsor, or another explicitly priced admission mechanism.

**Premise correction flagged:** none

### IV.7 → Chapter 5 (he) -- Conservation and valuation

**Memo page:** 28

**Exercise as the memo restates it:** not restated

**Memo solution:** E1. Myerson-Satterthwaite says that bilateral trade with independent private values/costs whose supports overlap cannot simultaneously achieve Bayesian incentive compatibility, individual rationality, ex post efficiency, and budget balance under the standard risk-neutral model. Check bilateral versus multi-party structure, private information, independence/common priors, overlapping supports, transfer utility/risk neutrality, and which efficiency/IR/budget-balance notions the harbor actually claims.

E2. The ledger conserves 10 A-coins and 20 B-coins. At 1 A=$1, 1 B=$2, marked value is $50. If B rises to $3 with no transfer, native balances remain 10 and 20, but marked value becomes $70. Valuation changed; supply did not.

E3. Let a quote be at most L seconds old and assume a deterministic log-price speed bound |log(v_t/v_s)| <= sigma|t-s|. For exposed notional X in the second unit, stale-quote error is at most phi = X*(exp(sigma L)-1) (plus fees/rounding). A stochastic GBM or historical-volatility model yields only a confidence/VaR bound and must say its tail probability; without a price-move bound no finite worst-case phi exists.

**Premise correction flagged:** none

### IV.8 → Chapter 5 (he) -- Four-message transfer

**Memo page:** 28

**Exercise as the memo restates it:** not restated

**Memo solution:** E1. Messages 1-2 authenticate the source request and A's offer. Message 3 is B's counter-signature/local admission: B verifies A, applies B policy, mints the derivative under sk_B, and commits its replay state/current root. Message 4 delivers that locally verifiable card. Without message 3, B has neither consented nor produced an object its own effect boundary can verify offline.

E2. If A rotates before B accepts, B must validate the offer against an append-only key-history/rotation certificate and its issuance epoch; otherwise reject as stale. Once C'_B is minted, its signature verifies under B, so A rotation alone does not erase it. The derivative must carry a parent/key-epoch dependency, bounded TTL, and revocation rule so A's rotation/revocation can invalidate it when fresh state reaches B. The manuscript does not currently specify that dependency completely.

E3. Give every transfer a random transfer_id/nonce, source card JTI, audience B, source and target epochs, issue time, expiry, and plan/card hash, all signed. B atomically records (A, transfer_id) as consumed before minting. A replay either returns the same previously minted child idempotently or is rejected; it must never mint a second child silently. Freshness invariant: every accepted child has one recorded unexpired source transfer under the current permitted issuer epoch, and each one-shot transfer causes at most one derivative issuance.

**Premise correction flagged:** none

### IV.9 → Chapter 5 (he) -- Gossip and equivocation

**Memo page:** 28

**Exercise as the memo restates it:** not restated

**Memo solution:** E1. Expected Theta(Delta log m) needs a connected (often complete) overlay, independently uniform random peer choice/fan-out, reliable bounded-duration rounds, and a push/pull epidemic rule with enough independence. It is an expectation under that model, not a deadline. A partition or indefinite loss is observationally indistinguishable from delay and makes the worst-case time infinite.

E2. A revocation originates at A at t0. Every harbor that has not yet received, verified, and enforced A's newer epoch can still accept/spend the derivative, subject to its local TTL/fail-closed policy. B may remain exposed through its first delivery round; C through later hops. The priced window is per harbor from t0 to enforcement, not merely to first gossip receipt.

E3. Let an equivocating witness send root X to B and root Y to C for the same epoch. Detection is impossible until evidence from the two views reaches one honest process; before that, each view is consistent with delay. In a three-node complete mesh with exchanges only every Delta, earliest detection is the next B-C/Audit exchange (at least one communication interval, and almost 2 Delta if values arrive just after a scheduled exchange under discrete rounds). On a path it is at least graph distance times Delta; under partition it is unbounded. Signatures make the final comparison O(1), not the information propagation.

**Premise correction flagged:** none

### IV.10 → Chapter 5 (he) -- Strategic graders

**Memo page:** 29

**Exercise as the memo restates it:** not restated

**Memo solution:** E1. An imperfect-public-monitoring result needs a common conditional distribution of public signals given all modeled actions/types. If a strategic grader is omitted, its reporting policy, information, bribes, and deviations are absent, so that distribution is undefined/endogenous and the equilibrium claim is unsupported.

E2. Protected unit-test receipt: Fix A, subject to suite integrity. Protected merged SHA: Fix A. "Tasteful refactor": Fix B, with plural/declared human or expert judgment and contractual finality.

E3 - correction. There is no natural theorem that subjective judges eventually reduce to machine truth. One can make the procedure well founded: assign rank K to the original grade, permit an appeal only to K-1, and stop at rank 0 with either a protected oracle for objective predicates or a named final authority/quorum for preference. The natural-number rank forbids an infinite chain. For aesthetics the base is contractual finality, not truth; bonds and re-audits bound incentives but do not transmute taste into a machine-checkable fact.

**Premise correction flagged:** "E3 - correction. There is no natural theorem that subjective judges eventually reduce to machine truth."

### IV.12 → Chapter 5 (he) -- Cold start, cartels, resale

**Memo page:** 29

**Exercise as the memo restates it:** not restated

**Memo solution:** E1. Phase 1 subsidizes supply - operators/agent owners willing to produce real settled work - because inventory plus witnessed outcomes creates the reputation data that attracts demand and later skill licensors. Above-market platform tasks are a direct subsidy. Flip only after liquidity, not after a calendar date.

E2. Under Figure IV.13's timing, the cartel is sustainable when
(pi_C - p_d L) / (1 - delta(1-p_d)) >= pi_D.
Equivalently, where denominators/payoffs are positive,
delta >= [pi_D - pi_C + p_d L] / [pi_D(1-p_d)].
Higher detection probability, penalty L, audit quality, or lower cartel margin raises the required patience threshold above members' actual delta and breaks the cartel. The result is model-specific.

E3. If a high type can sell its identity/reputation signal to a low type, the signal's cost no longer separates types and arbitrage tends toward pooling. Separation can survive only if the evidence is nontransferably bound to the continuing principal/artifact, transfer resets or visibly discounts the signal, or the seller retains warranty/bond liability so sale remains more costly for a low-quality asset. Otherwise reputation resale destroys the signal rather than merely changing a price-of-anarchy ratio.

**Premise correction flagged:** none

### IV.13 → Chapter 5 (he) -- Gluing analogy

**Memo page:** 29

**Exercise as the memo restates it:** not restated

**Memo solution:** E1. One candidate site has objects as administrative domains and their signed overlap views, morphisms as restriction to shared accounts/events/epochs, and covers as families whose union includes the bounded federation. A section assigns an event/balance view; restriction projects it to the overlap. For set-valued gluing no coefficient object is required; for cohomology choose an abelian group such as account-balance deltas Z^Accounts (with signatures carried as validation data) and define cocycles explicitly.

E2. Two different signed roots for one (harbor, epoch) are direct evidence that a key signed inconsistent commitments. A cohomology class requires a defined cover, coefficient sheaf, overlap differences forming a cocycle, and quotient by coboundaries. Hash inequality alone supplies none of that algebra.

E3. For a fixed three-harbor cover A-B-C, define each local section as a finite map from globally unique event IDs to signed events; restriction is map projection to shared IDs. If all pairwise restrictions agree, their union is a unique global map. This proves deterministic gluing of already delivered, identically keyed events at that finite topology. It proves nothing about truth, event completeness, delivery time, forks with conflicting IDs, or settlement finality.

**Premise correction flagged:** none

**Chapter V -- The Anchor Protocol (now Chapter 2, prefix `anchor`)**

Memo page 30, verbatim, precedes the chapter's entries: "Chapter V prints no exercise block. The following audit key covers the chapter's load-bearing check, trace, and open obligations, including the contradiction between Algorithm V.4 and Appendix V.D.1."

### V.5.3/V.D.1 → Chapter 2 (anchor) -- Multi-hop attenuation

**Memo page:** 30

**Exercise as the memo restates it:** not restated

**Memo solution:** Check - correction. Algorithm V.4 checks every cap_i against cap_root. That does not prove monotonic attenuation by hop. A chain write -> read -> write passes because the final write is within the root even though it expands B's read authority. The appendix correctly identifies the attack, but the main algorithm and security-property prose remain false until changed.

Trace. Let root A hold {read, write}, delegate B {read}, and B delegate C {write}. Root comparison accepts B (read subset root) and C (write subset root). Immediate-parent comparison rejects C because write is not a subset of B's read.

Correct verifier. For each hop i, verify:
1. the root under the trusted root key and each child signature under the immediate parent's bound public key;
2. the child message hashes/references the exact parent token;
3. cap_i subseteq cap_(i-1), including action, resource, audience, conditions, quotas, and expiry_i <= expiry_(i-1);
4. child proof of possession, unique JTI/transfer ID, issuer/audience/harbor binding, current ancestor/key epoch, and no ancestor revocation;
5. maximum depth/cycle policy at verification time, not only at spawn time.

By induction, per-hop subset checks imply cap_k subseteq ... subseteq cap_0. Root-only comparison cannot supply that induction. A resource translation between different harbors is not a subset operation; it needs a new local grant, as discussed under Chapter VII.

**Premise correction flagged:** "Check - correction. Algorithm V.4 checks every cap_i against cap_root. That does not prove monotonic attenuation by hop. A chain write -> read -> write passes because the final write is within the root even though it expands B's read authority. The appendix correctly identifies the attack, but the main algorithm and security-property prose remain false until changed."

### V.6.3 → Chapter 2 (anchor) -- Kani claims

**Memo page:** 30

**Exercise as the memo restates it:** not restated

**Memo solution:** Check - correction. The shown proof_verify_logic_only merely calls verify; without postconditions it can at most establish bounded absence of panic/undefined behavior under its stubs. proof_constant_time_behavior calls a comparator once; it is not a two-run relational proof of timing independence. The attenuation harness checks two concrete vectors and contains assertions whose negation style is easy to misread; it is not a universal theorem for arbitrary capability structures.

Open. State each harness's exact preconditions, bounds, and postcondition. Use arbitrary structured capabilities with an asserted partial-order property; use negative controls; prove parser refinement separately from assumed crypto; and use a relational constant-time checker or audited constant-time primitive for timing. Stubbing signature verification/base64 is legitimate only when their contracts are explicit assumptions. "Same binary is called" narrows deployment drift but does not prove the whole daemon, FFI boundary, compiler output, key custody, or complete effect mediation.

**Premise correction flagged:** "Check - correction. The shown proof_verify_logic_only merely calls verify; without postconditions it can at most establish bounded absence of panic/undefined behavior under its stubs. proof_constant_time_behavior calls a comparator once; it is not a two-run relational proof of timing independence. The attenuation harness checks two concrete vectors and contains assertions whose negation style is easy to misread; it is not a universal theorem for arbitrary capability structures."

### V.7 → Chapter 2 (anchor) -- Security envelope

**Memo page:** 30

**Exercise as the memo restates it:** not restated

**Memo solution:** Trace. A valid signature proves only that the key holder signed bytes. Authorization additionally needs canonical decoding, key-to-principal binding, audience/resource semantics, freshness, ancestor revocation, and proof that every consequential effect consults the verifier. Bearer tokens also need replay/idempotency policy. Without these, cryptographic authenticity can coexist with unauthorized or repeated effects.

Open. Change the chapter status table to distinguish: symbolic protocol correspondence at a fixed modeled hop depth; bounded implementation memory/control-flow checks; runtime verifier integration; and system-level complete mediation. Only the first two are presently evidenced by the displayed artifacts.

**Premise correction flagged:** none

**Chapter VI -- The Bonded Commons (now Chapter 6, prefix `bonded`)**

### VI.7.4 (correction, before the printed exercises) → Chapter 6 (bonded)

**Memo page:** 31

**Exercise as the memo restates it:** not restated

**Memo solution:** The stage-game table is not a prisoner's dilemma. With columns B:T/B:F and rows A:T/A:F, A prefers F against T (4>3) but prefers T against F (1>0); F is not dominant. The pure Nash equilibria are (F,T) and (T,F), plus a mixed equilibrium in which each plays F with probability 1/2. (F,F) is not a Nash equilibrium. The proposed punishment of mutual F is not sequentially rational because either player prefers T against F. Therefore the delta ~= 0.253 claim-signaling proposition and its TLA/Z3 instance do not establish the stated equilibrium for this game. Use a corrected prisoner's-dilemma matrix (for example (T,T)=(3,3), (T,F)=(0,4), (F,T)=(4,0), (F,F)=(1,1)) and re-derive, or model truthful reporting as a hidden-type mechanism with probabilistic effect/evidence signals.

**Premise correction flagged:** "The stage-game table is not a prisoner's dilemma. With columns B:T/B:F and rows A:T/A:F, A prefers F against T (4>3) but prefers T against F (1>0); F is not dominant. The pure Nash equilibria are (F,T) and (T,F), plus a mixed equilibrium in which each plays F with probability 1/2. (F,F) is not a Nash equilibrium. The proposed punishment of mutual F is not sequentially rational because either player prefers T against F. Therefore the delta ~= 0.253 claim-signaling proposition and its TLA/Z3 instance do not establish the stated equilibrium for this game."

### VI.C E1 → Chapter 6 (bonded) -- Advisory claims

**Memo page:** 31

**Exercise as the memo restates it:** not restated

**Memo solution:** An advisory claim is a durable declaration that an actor intends to use a resource, informing coordination but not making conflicting effects impossible. Every trace allowed by enforced locks is allowed by advisory claims, while advisory claims additionally admit intentional conflict/override traces, so the regime is strictly more permissive. That can preserve local discretion, appeal, and recovery from stale claims. Sen supplies an analogy about the cost of jointly decisive rights; it is not a theorem that software locks are impossible or that permissiveness is always desirable. High-risk effects still need enforcement.

**Premise correction flagged:** none

### VI.C E2 → Chapter 6 (bonded) -- Reputation instead of bonds

**Memo page:** 31

**Exercise as the memo restates it:** not restated

**Memo solution:** First, reputation compensates nobody for the first or final harm; a one-shot actor can take the gain and leave before future exclusion matters. Second, cheap identities let the actor whitewash the loss or multiply fresh entrants. A pre-funded performance bond creates recoverable value before authority is granted and keys exposure to the durable principal. It prices/contains harm; it does not prove the work will be correct.

**Premise correction flagged:** none

### VI.C E3 → Chapter 6 (bonded) -- Magic-link ProVerif model

**Memo page:** 31

**Exercise as the memo restates it:** not restated

**Memo solution:** Model fresh token t, issuance event Issued(u,t), storage of an unguessable token or protected hash with expiry/unused flag, delivery through a mailbox channel, redemption over an attacker-controlled network, atomic consume, and recovery-key/session rotation. Prove token/recovery-secret secrecy against the stated attacker and injective authentication such as Consumed(u,t) ==> inj Issued(u,t), plus at-most-once consumption. Add concurrent replay and mailbox/token compromise, capabilities not needed by the Phase-1 Harbor Card network model. Time/expiry requires an explicit abstraction; ProVerif does not supply wall-clock semantics automatically.

**Premise correction flagged:** none

### VI.C E4 → Chapter 6 (bonded) -- Coverage-bound A5

**Memo page:** 31

**Exercise as the memo restates it:** not restated

**Memo solution:** An attacker creates many low-history insurer identities, underbids, obtains exposures up to or beyond a reused deposit, collects premiums on no-loss rounds, and abandons an identity on a covered loss. If concurrent aggregate exposure is not reserved, one deposit can underwrite several liabilities; if slash is capped at BT, raising Bdep above BT adds no per-transaction loss.

Correct caveat: full reimbursement of a single loss does not by itself show the attacker profits; profitability also needs the premium/loss distribution, exposure reuse, or external sabotage benefit. Defend with unrecoverable principal onboarding cost, principal binding, low initial coverage/reputation gating, per-risk-class reserve, and atomic reservation so aggregate outstanding exposure never exceeds capital. Independent audits and pairwise concavity address collusion. "Raise deposit" alone does not.

**Premise correction flagged:** "Correct caveat: full reimbursement of a single loss does not by itself show the attacker profits; profitability also needs the premium/loss distribution, exposure reuse, or external sabotage benefit."

### VI.C E5 → Chapter 6 (bonded) -- Cartel detection

**Memo page:** 31

**Exercise as the memo restates it:** not restated

**Memo solution:** The chapter gives
p_d* = [pi_C - (1-delta)pi_D] / [L + delta*pi_D],
with pi_C = x/3, pi_D = x-epsilon, L=5x, and x=q_floor-mu. Thus at delta=0.99,
p_d* = [1/3 - 0.01(1-epsilon/x)] / [5 + 0.99(1-epsilon/x)].
The prompt omits epsilon/x, so no unique decimal exists. In the chapter's negligible-undercut limit epsilon/x -> 0, p_d* ~= 0.05398, about 5.4% per round. Cheap fresh identities shorten the effective horizon and shed punishment; principal-bound bonds deter re-entry only when expected forfeiture plus onboarding/maturation cost exceeds the re-entry gain. A reusable or under-sized bond merely prices it and may not deter it.

**Premise correction flagged:** none

### VI.C E6 → Chapter 6 (bonded) -- Capability attenuation

**Memo page:** 32

**Exercise as the memo restates it:** not restated

**Memo solution:** The child TTL of 20 minutes violates temporal attenuation: child expiry must not exceed parent expiry. An acceptable card is {fs:write:auth.ts, TTL <= 15 minutes}; dropping db:read is a valid narrowing. A narrower example is {fs:read:auth.ts, TTL=10 minutes} if the capability lattice defines read below write.

**Premise correction flagged:** none

### VI.C E7 → Chapter 6 (bonded) -- Cuckoo-filter pollution

**Memo page:** 32

**Exercise as the memo restates it:** not restated

**Memo solution:** An attacker submits many authenticated-looking random revocation IDs, fills buckets, drives insertion/kick failures, and pushes the filter outside the load regime for which its false-positive/insertion bounds hold. Legitimate revocations may then be unrepresentable, creating a dangerous denial of revocation service.

The 0.95 ceiling preserves the stated probabilistic regime by refusing growth/rebuilding; it does not defeat a pollution DoS. Require authorized revocation provenance, per-principal quotas/rate limits, an exact overflow log, rebuild/rotation, and fail-closed handling when insertion fails. A probabilistic filter must never silently drop an authoritative revocation.

**Premise correction flagged:** none

### VI.C E8 → Chapter 6 (bonded) -- Alternative insurance pricing

**Memo page:** 32

**Exercise as the memo restates it:** not restated

**Memo solution:** A posted-price catalog can quote by manifest risk class, principal history, exposure duration, and tail-capital band, with periodic recalibration and a hard reserve constraint. It conditionally improves on static escrow when the quote is below the principal's idle-capital cost while the insurer remains individually rational and reserves cover the same tail. The key assumption is calibrated loss/tail dependence plus enforceable aggregate capital adequacy; CC/NC/RP/NS need explicit definitions before any formal Pareto claim. Posted prices reduce auction manipulation/latency but sacrifice instance-specific price discovery.

**Premise correction flagged:** none

### VI.C E9 → Chapter 6 (bonded) -- Gossip proof

**Memo page:** 32

**Exercise as the memo restates it:** not restated

**Memo solution:** Demers et al. [9] is the epidemic-replication paper, but the chapter does not identify a numbered theorem whose statement exactly yields this protocol's Theta(log m) all-informed bound. The mechanization obligation is first to state the push/pull rumor-spreading theorem with complete-graph, independent-peer, reliable-round assumptions and then formalize it; citing the paper is not a proof object.

On a general connected graph, dissemination depends on conductance/bottleneck cuts or mixing time, not only m; a bound has a term roughly inverse in conductance and a tail probability. A disconnected graph or unbounded partition never converges across components. Mechanize safety (no false removal/acceptance) separately from probabilistic liveness.

**Premise correction flagged:** none

**Chapter VII -- The Federated Harbor (now Chapter 7, prefix `fh`)**

Memo page 32, verbatim, precedes the chapter's entries: "Chapter VII prints no exercise block. Section VII.12 deliberately poses five open questions; the following are solution directions and honest limits, plus one required correction to the worked capability model."

### VII.4 → Chapter 7 (fh) -- Cross-harbor attenuation correction

**Memo page:** 33

**Exercise as the memo restates it:** not restated

**Memo solution:** att_B(att_A(C_A)) is a subset only when both harbors share one capability/resource universe and both functions only remove rights. In the example where A's test database authority becomes B's staging database authority, B is granting authority over a different object. That is token exchange/new authorization, not attenuation. Define a signed semantic/resource mapping, require B's local policy to mint a new child grant, record its dependency on A's parent/epoch, and prove both (a) A-side input eligibility and (b) B-side local authorization. Never infer B authority from set inclusion over incomparable names.

Also, B observing a failed test or an inclusion proof does not establish that A caused the failure. Settlement evidence must bind the exact work-unit, base and result trees, mediated effects, acceptance policy, and protected verifier; semantic causation remains an adjudication claim.

**Premise correction flagged:** "att_B(att_A(C_A)) is a subset only when both harbors share one capability/resource universe and both functions only remove rights. In the example where A's test database authority becomes B's staging database authority, B is granting authority over a different object. That is token exchange/new authorization, not attenuation."

### VII.12.1 → Chapter 7 (fh) -- Multi-principal correlation

**Memo page:** 33

**Exercise as the memo restates it:** not restated

**Memo solution:** A witness log is a correlation device only if it produces a commonly observed signal/recommendation distribution and the game models when each principal receives it and why obedience is optimal. During inconsistent views/partitions there is no single public signal. The clean model is a stochastic/Bayesian game with local daemon correlation devices plus a delayed public signal; prove a (coarse) correlated equilibrium under common-view/freshness events and a separate safe degraded policy otherwise. Calling the log "the" device without information and incentive constraints is not a result.

**Premise correction flagged:** none

### VII.12.2 → Chapter 7 (fh) -- Non-fungible trustless settlement

**Memo page:** 33

**Exercise as the memo restates it:** not restated

**Memo solution:** HTLCs atomically exchange assets conditional on a preimage; they do not decide an off-chain, subjective delivery predicate. Impossibility shape: if two worlds have identical on-ledger messages but different true quality, a deterministic trustless contract must settle identically in both and therefore cannot be correct in both. Progress requires adding an oracle/TEE, optimistic dispute game, bonded adjudicator, or a narrowly machine-verifiable acceptance predicate. Each is a trust assumption, not trustlessness. MPC/FHE can hide inputs for fixed computations but does not make an underspecified quality judgment objective.

**Premise correction flagged:** none

### VII.12.3 → Chapter 7 (fh) -- Cross-federation cartels

**Memo page:** 33

**Exercise as the memo restates it:** not restated

**Memo solution:** The witness log cannot distinguish unanimous honest agreement from unanimous collusion. Bind actors to principals, make repeated pair/coalition outcomes sharply concave in reputation credit, separate builder/tester/judge information, sample cross-harbor adversarial audits, diversify witnesses, and expose principal-wide collateral. For one-shot collusive gain G, audit probability p, detection d, and loss L, deterrence needs p*d*L > G; repeated-game claims need an explicit monitoring signal and correlated-failure model. No structural mechanism eliminates a cartel that controls every oracle and witness in scope.

**Premise correction flagged:** none

### VII.12.4 → Chapter 7 (fh) -- Cold-start admission

**Memo page:** 33

**Exercise as the memo restates it:** not restated

**Memo solution:** Use multiple independent sponsors or threshold sponsorship, small and automatically expanding probation scopes, public nondiscretionary criteria, an open challenge/appeal path, sponsorship auctions, sponsor concentration caps, and permanent admission receipts. These reduce gatekeeping while pricing Sybils. They do not prove openness: if incumbent sponsorship is the only scarce credential, incumbents can form an invitation cartel. Measure acceptance, concentration, time-to-entry, and false rejection.

**Premise correction flagged:** none

### VII.12.5 → Chapter 7 (fh) -- Equivocation propagation

**Memo page:** 34

**Exercise as the memo restates it:** not restated

**Memo solution:** Separate constant local verification from network dissemination. On a complete reliable random-contact graph, standard push/pull gives logarithmic expected rounds and exponential-style tail bounds under stated independence. On a general graph, state a deployment bound using conductance/mixing, fan-out, loss, and epoch schedule; bottleneck cuts dominate. Instrument real peer graphs and fit tail quantiles before pricing bonds. Any unbounded partition makes the worst-case detection time and stale-authority window infinite, so high-risk actions need TTL and fail-closed freshness.

**Premise correction flagged:** none

### VII synthesis check → Chapter 7 (fh)

**Memo page:** 34

**Exercise as the memo restates it:** not restated

**Memo solution:** Federation should be a project institution, not merely "two machines sharing a repository": an authoritative event/work-unit graph, per-principal policy, local effect mediators, causal messages, evidence, roles, artifacts, and explicit governance over conflicts. A roadmap is versioned intent/forecast, not truth; contradiction detectors produce evidence-bearing claims, while a named principal/role decides. Consensus may be appropriate for the small authoritative metadata core even when work artifacts remain federated; "no consensus" is not a virtue by itself.

**Premise correction flagged:** none

## Exercises that exist in the chapter sources today

Searched each of the seven chapter `.tex` files named in `whitepaper/textbook.json` (`source` field, repo-root-relative) for exercise-shaped content: the `exercises` environment/command each paper defines, `\section{Exercises}`, `\paragraph{Exercise`, and plain-text mentions of "exercise" / "problem". Solutions are never present in these files (all seven either say so explicitly or simply supply no answer text); every file is pedagogy-only.

**`whitepaper/single-writer-kernel.tex`** (Chapter 1, `swk`, former II) -- ten `\exercises{...}` boxes, one per major section, most closing with a `(check)` / `(trace)` / `(open, ⋆ OP-N)` triad, with two exceptions noted below (one box has four items, one has two):
- "The kernel as seven organs" (`\label{sec:organs}`) -- 3 items (check, trace, open -- starred but not tied to a numbered OP) -- no solutions.
- "The substrate organ: one writer, one file" (`\label{sec:substrate}`) -- 3 items, open tagged OP-7 -- no solutions.
- "Durability, split by fault class" (`\label{sec:durability}`) -- 3 items, open tagged OP-10 -- no solutions.
- "The resource organ: claims, locks, and fair exclusion" (`\label{sec:resource}`) -- 3 items, open tagged OP-1 -- no solutions.
- "The communication organ: the bus, stigmergy, and two delegation chains" (`\label{sec:comm}`) -- 3 items, open tagged OP-8 -- no solutions.
- "The obligation & enforcement organ: the sovereign's two arms" (`\label{sec:enforcement}`) -- 4 items: check, trace, a second trace tagged "⋆ OP-2 --- closed", and open tagged OP-5 -- no solutions.
- "The continuity organ: memory, checkpoint, and the foundation of the economy" (`\label{sec:continuity}`) -- 3 items, open tagged OP-4 -- no solutions.
- "The invariants, stated as theorems" (`\label{sec:invariants}`) -- 3 items, open tagged OP-3 -- no solutions.
- "Cross-organ atomicity: a buildable defect, not a frontier" (`\label{sec:atomicity}`) -- 2 items (check, open tagged OP-11; no trace item) -- no solutions.
- "Threat model and the limits of mediation" (`\label{sec:threatmodel}`) -- 3 items, open tagged OP-9 -- no solutions.

Total: 10 sections, 30 items. Items carry no `\label{}` cross-reference targets of their own (referenced elsewhere only as "OP-N" or by section). The paper's own "Open problems" table (`\label{tab:op-status}`, `\S\ref{sec:openproblems}`) lists eleven numbered problems OP-1 through OP-11; OP-6 ("Tamper-evidence on the read path") has no corresponding `\exercises` item citing it anywhere in the file.

**`whitepaper/legible-swarm.tex`** (Chapter 3, `ls`, former I) -- nine `\begin{exercises}...\end{exercises}` environments, one per section, each with an internal `\exhead{Check your understanding.}` / `\exhead{Trace the mechanism.}` / `\exhead{Open problem(s).}` grouping and parenthetical numbers `(N.n)`:
- Section 1 -- items (1.1)-(1.4), 4 items.
- Section 2 -- items (2.1)-(2.4), 4 items.
- Section 3 -- items (3.1)-(3.4), 4 items.
- Section 4 -- items (4.1)-(4.5), 5 items.
- Section 5 -- items (5.1)-(5.5), 5 items.
- Section 6 -- items (6.1)-(6.5), 5 items.
- Section 7 -- items (7.1)-(7.6), 6 items.
- Section 8 -- items (8.1)-(8.6), 6 items.
- Section 9 -- items (9.1)-(9.4), 4 items.

Total: 9 sections, 43 items. No `\label{}` on individual items; open (starred) items are additionally collected into a summary table (`\label{tab:open}`, "The paper's open problems, consolidated from the starred exercises") that cross-references each by its plain "Ex.~N.n" number. No solutions anywhere in the file.

**`website-v2/public/whitepaper/spawn-to-person.tex`** (Chapter 4, `stp`, former III) -- eleven `\begin{exercises}...\end{exercises}` environments, each internally tagged `\textit{Check.}` / `\textit{Trace.}` / (occasionally) `\textit{Derive.}` / `$\star$ \textit{Open}` with local parenthetical numbers restarting near (1) in every box:
- Section near `\label{sec:intro}` -- (1)-(3), 3 items.
- `\label{sec:role-person}` area -- (1)-(3), 3 items.
- `\label{sec:continuity}` -- (1)-(3), 3 items.
- `\label{sec:organs}` -- (1)-(3), 3 items.
- `\label{sec:identity}` -- (1)-(3), 3 items.
- `\label{sec:keystone}` -- (1)-(3), 3 items.
- `\label{sec:substrate}` -- (1)-(3), 3 items.
- `\label{sec:not-bandit}` -- (1)-(3), 3 items.
- `\label{sec:adr0049}` -- (1)-(4), 4 items (check, trace, trace, open).
- `\label{sec:oracle}` -- (1)-(4), 4 items (check, trace, derive, open).
- `\label{sec:revoke}` -- (1)-(3), 3 items.

Total: 11 sections, 35 items. Open items each cross-reference a numbered entry (`\label{op:branching}`, `op:death`, `op:attest`, `op:root`, `op:disclosure`, `op:armsrace`, `op:revoke`, `op:bondfarm`, `op:arbitration`, `op:skillver`) in a separate, chapter-owned "Open problems (the starred exercises, collected)" list (`\label{sec:open}`) numbered 1-10 by that list's own `\begin{enumerate}` order -- a third numbering distinct from both the per-box `(1)-(4)` and the OP-N numbers borrowed from the kernel chapter. No solutions anywhere in the file.

**`website-v2/public/whitepaper/harbor-economy.tex`** (Chapter 5, `he`, former IV) -- eleven `\begin{exercises}...\end{exercises}` environments (an `enumerate` with `label=\textbf{E\arabic*.}`, so items are auto-numbered E1./E2./E3. by LaTeX, not hand-typed), each with exactly 3 `\item`s (the third usually marked `\openstar`):
- One block each after: "the through-line: why a market needs persons, not spawns"; "What a side is, and why there are three"; "The float plan: the built floor"; "Three sides on one escrow"; "The keystone the market rests on"; "Conservation under composition"; "The Anchor Protocol proper: cross-harbor capability transfer"; "Federation ... Revocation gossip and the equivocation race"; "Reputation: monotone, but revocable"; "Cold start, and the auction question"; "A gluing analogy for the open federation problem."

Total: 11 sections, 33 items (3 each). No `\label{}` on individual items. No solutions anywhere in the file.

**`website-v2/public/whitepaper/anchor-protocol-whitepaper.tex`** (Chapter 2, `anchor`, former V) -- none found. No `exercises` environment or command is defined or used in this file; the only hits for "exercise" are the ordinary English verb ("what is exercised is the parser's rejection of malformed input"). This matches the memo's own statement that "Chapter V prints no exercise block."

**`website-v2/public/whitepaper/agent-transactions-whitepaper.tex`** (Chapter 6, `bonded`, former VI) -- one dedicated `\section{Exercises}\label{app:exercises}`, containing nine `\paragraph{E1 (...)}` through `\paragraph{E9 (...)}` items (Definitions; Mechanism design; Formal verification; Coverage-bound A5; Cartel folk-theorem; Capability attenuation; Cuckoo-filter pollution; Mechanism extension; Open problem). Total: 1 section, 9 items. The section itself states "Solutions are not provided," and none are present. No `\label{}` on the individual E-items (only the section itself is labeled).

**`website-v2/public/whitepaper/federated-harbor-whitepaper.tex`** (Chapter 7, `fh`, former VII) -- no `exercises` environment/command, no `\section{Exercises}`, and no occurrence of the word "exercise" anywhere in the file. The nearest analog is `\section{Limitations and Open Questions}\label{sec:fh-limitations}` (the paper's twelfth section), which poses six open questions as subsections (`\label{sec:fh-lim-correlated}` through `\label{sec:fh-lim-overhead}`), plus a closing non-question subsection ("What this means for the reader"). The source's own text states: "A federation paper with six named open questions is doing its job." No solutions are present (the section is explicitly framed as the paper's open frontier).

## Coverage

| Chapter (current #, prefix) | Former numeral | Memo solution entries | Exercises in source today | Numbering-mismatch notes |
|---|---|---|---|---|
| 1, `swk` (The Single-Writer Kernel) | II | 10 (II.3-II.9, II.11-II.13) | 10 sections / 30 items (`\exercises{}`) | The memo never cites OP-6 ("Tamper-evidence on the read path"); the source's own OP-status table also has no `\exercises` item citing OP-6. The memo's II.8 entry says "Open (OP-2)"; the source tags that same item "(trace, ⋆ OP-2 --- closed)" and the paper's OP-status table marks OP-2 `\Closed` (settled by a theorem), not open. Sections II.1, II.2, and II.10 have neither a memo entry nor a source `\exercises` box. |
| 2, `anchor` (The Anchor Protocol) | V | 3 (V.5.3/V.D.1, V.6.3, V.7) | 0 (`\exercises` never used in this file; memo itself notes "Chapter V prints no exercise block") | The memo's V.5.3/V.D.1 correction describes "Algorithm V.4" as checking every `cap_i` against `cap_root`. The current source's Algorithm 3 (`Harbor.VerifyChain`, `\label{alg:delegation}`) instead updates and compares against `cap_prev` (the immediate predecessor) each iteration -- the immediate-parent check the memo's "Correct verifier" section recommends. |
| 3, `ls` (The Legible Swarm) | I | 9 (I.1-I.9) | 9 sections / 43 items (`\begin{exercises}`) | Numbering matches exactly: every memo item number (e.g. "5.4", "8.6") equals the source's parenthetical `(N.n)` number in the same section. No mismatches observed. |
| 4, `stp` (From Spawn to Person) | III | 11 (III.1, III.3-III.12) | 11 sections / 35 items (`\begin{exercises}`) | Sections III.1, III.3, III.4, III.6, III.7, III.8, III.9 match the source's local `(1)/(2)/(3)` numbering exactly. Four do not: III.5 cites "Open (4)" where the source box's open item is `(3)`; III.10 cites "Open (5)" where the source shows `(4)`; III.11 cites "Open (4)" for what the source labels `\textit{Derive.} (3)` and cites "Open (10)" for what the source labels `$\star$ Open ... (4)`; III.12 cites "Open (8)" where the source shows `(3)`. The source's own chapter-level "Open problems (the starred exercises, collected)" list numbers these same items 1-10 in yet a third sequence (e.g. the item behind III.5's open question is that list's #2, not the memo's "(4)"). Section III.2 has neither a memo entry nor a source `\exercises` box. |
| 5, `he` (The Harbor Economy) | IV | 11 (IV.2-IV.10, IV.12, IV.13) | 11 sections / 33 items (`\begin{exercises}`, auto-numbered E1./E2./E3.) | Source items carry no independent hand-typed number (LaTeX's `enumerate` supplies "E1./E2./E3." at render time), so the memo's "E1./E2./E3." tags cannot be checked against a distinct source number the way chapters I/III can; by position they line up 1:1. Sections IV.1 and IV.11 have neither a memo entry nor a source `\exercises` box. |
| 6, `bonded` (The Bonded Commons) | VI | 10 (1 pre-exercise correction note titled "Correction to VI.7.4," plus VI.C E1-E9) | 9 items in one `\section{Exercises}` (E1-E9) | E1-E9 match the source one-to-one in order and subject (Definitions -> Advisory claims; Mechanism design -> Reputation instead of bonds; Formal verification -> Magic-link ProVerif model; Coverage-bound A5 -> same; Cartel folk-theorem -> Cartel detection; Capability attenuation -> same; Cuckoo-filter pollution -> same; Mechanism extension -> Alternative insurance pricing; Open problem -> Gossip proof). The "Correction to VI.7.4" premise correction describes a claim-signaling stage-game table that is "not a prisoner's dilemma" with a discount-factor threshold of "delta ~= 0.253." The current source's own stage-game table and worked threshold (`\label{sec:claim-signaling-ic}`) already show a dominant-strategy prisoner's dilemma with (F,F) the unique one-shot Nash equilibrium and a derived bound of "delta > delta*_{k=3} ~= 0.342" (graduated trigger) / "delta >= 1/3" (grim trigger) -- different numbers than the ones the memo's correction addresses. |
| 7, `fh` (The Federated Harbor) | VII | 7 (VII.4, VII.12.1-VII.12.5, "VII synthesis check") | 0 `\exercises` blocks; nearest analog is `\section{Limitations and Open Questions}` (the chapter's 12th section) with 6 open-question subsections (12.1-12.6) | The memo states "Section VII.12 deliberately poses five open questions" and supplies entries for 12.1-12.5 only. The source's own text says "A federation paper with six named open questions is doing its job," and its sixth subsection, "Cost of per-write durability" (`\label{sec:fh-lim-overhead}`), has no corresponding memo entry. |

Grand total: 61 memo entries extracted (60 numbered/labeled exercises plus the one "Correction to VI.7.4" note the memo places before its printed VI.C exercises); the memo's own two rules (false-premise repair; open-problem design/proof obligation) both appear on memo page 13.
