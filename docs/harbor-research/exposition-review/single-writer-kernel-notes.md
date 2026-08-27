# Exposition + Figure Review: The Single-Writer Kernel

`whitepaper/single-writer-kernel.tex` is Chapter II of VII in the Port Daddy Coordination Papers — the public-facing whitepaper companion to the formal Harbor research corpus, ~1,879 lines, targeting "Version 1.1 (revised pre-print)," August 2026. It is the substrate-layer chapter: a single-writer transactional reference monitor over one local SQLite/WAL database, presented as the load-bearing floor the other six chapters (*The Legible Swarm*, *From Spawn to Person*, *The Harbor Economy*, and others) build on. Structurally it is one of the strongest pieces in the series — the research-maturity scale (§1.4), the Reader's Map, the worked Alice/Bob dramatizations, the `\keyidea`/`\pitfall`/`exercises` apparatus, and most of the twelve TikZ figures are genuinely well-executed instances of house style. The review below is dominated by one finding that cuts across nearly a third of the document: a set of later-added "solved" retrofits to the open-problems list (OP-1, OP-2, OP-3, OP-4, OP-5, OP-7, OP-9, OP-10) that were never reconciled with the honesty apparatus built around them — the very apparatus that is this paper's advertised differentiator (§1.4: "A systems paper that mixes 'we proved this' with 'we hope to build this' is unfalsifiable"). See Part A items 1–8 and Summary bullet 1.

**Tooling notes.** `skills/research-paper-submission/scripts/submission_lint.py` does not exist in this tree as source; only the compiled `__pycache__/submission_lint.cpython-311.pyc` survives (same situation as the sibling review of paper3.tex). I ran it directly: `python3 skills/research-paper-submission/scripts/__pycache__/submission_lint.cpython-311.pyc whitepaper/single-writer-kernel.tex --figures-dir whitepaper/figures`. Result: **4 errors, 2 warnings, 6 claims-to-confirm**. `skills/research-paper-submission/references/figures-and-examples.md` likewise does not exist; Cleveland–McGill / greyscale-survival / caption-states-the-finding judgments below are applied by hand from `harbor-exposition/references/style-template-v2.md` Rail B and `high-quality-latex-whitepaper/SKILL.md`. No LaTeX toolchain exists here — anything needing a compiled render is marked **[needs render]**.

The four linter errors (`\ref{alg:acquire}`/`\ref{alg:close}` "no matching `\label`"; the two enclosing `figure` environments "no `\caption`") are **false positives**: the linter's regex looks for literal `\label{...}`/`\caption{...}`, but both algorithms are captioned via `lstlisting`'s own `caption=`/`label=` keys (lines 657, 989), which `listings` turns into real `\caption`/`\label` calls at LaTeX time. They do, however, point at a real (if minor) craft issue — see A11. The six "claims to confirm" (three `impossible` hits, one `for all`, two `iff`) are addressed individually in Part A and Part D; two are fine as written, one (line 1393) is a genuine overclaim.

---

## Part A — Text/exposition changes

### A1. OP-1 (fair exclusion): "closed" in the body, still open everywhere else

**Location:** §5.3, lines 712–739 (body + its own exercises box) vs. `whitepaper/figures/fig-swk-claim-lifecycle.tex` caption (unchanged) vs. §"Adjacency contract," line 1482 vs. §"Open problems," lines 1590–1592.

**Issue:** *Boundary burial by omission* — a correction lands in one place and is never propagated. §5.3's heading is "Fairness via Stigmergic Ticket-Lock (OP-1)" and its own exercises box (line 739) reads `\textbf{(solution, $\bigstar$ OP-1)}`, i.e., internally consistent and self-declared solved. But three other places in the same document still say the opposite:

**Current text** (fig-swk-claim-lifecycle.tex caption, unchanged): "The conspicuous missing state is \textsc{queued}: there is no wait-list and no fairness primitive, so a fast agent churning a hot resource can starve a slow one indefinitely --- open problem OP-1..."

**Current text** (line 1482–1483, Adjacency contract, "explicit non-provisions"): "It does \emph{not} provide fair/queued exclusion (OP-1), cross-organ transactional atomicity by default..."

**Current text** (line 1590–1592, master Open Problems list): "\item[$\bigstar$ OP-1 --- Fair exclusion without a scheduler.] Add bounded-wait to claims and locks while keeping the single-writer, no-background-scheduler simplicity. Is a FIFO wait-list of time-to-live'd reservations enough?"

**Proposed rewrite:** Pick one truth and propagate it. If the Stigmergic Ticket-Lock genuinely ships: (a) delete or retitle the fig-swk-claim-lifecycle "conspicuous missing state" sentence to instead show the `claim_tickets` queue as a fifth FSM state; (b) remove OP-1 from the "explicit non-provisions" list at line 1482 (or narrow it to a remaining sub-gap, e.g. "queued fairness is per-resource FIFO but not yet priority-aware"); (c) move the OP-1 entry in the master Open Problems list from a posed question to a one-line "closed, see §5.3" note, matching how the appendix's "three load-bearing corrections" (§Status, lines 1704–1726) are written. If it does *not* ship in the reference implementation, walk back §5.3's confident claim ("mathematically guaranteed") to a `\Designed` grade instead.

**Priority:** high.

---

### A2. OP-3 (runtime parity): "formerly open" in the body, "asks for" in the figure, "open" in the exercises, unchanged in the table

**Location:** §"The dual-runtime hazard," line 1225 vs. `fig-swk-dual-runtime.tex` caption vs. exercises box line 1234 vs. Table `tab:invariants` row I11 (line 1167).

**Issue:** *Overclaim not propagated* — four artifacts about the same invariant disagree simultaneously.

**Current text** (line 1225): "To solve this (formerly open problem OP-3), the kernel's CI pipeline runs \textbf{Differential Fuzzing}: $1\times 10^6$ concurrent operations are blasted against both the test and deployment SQLite bindings, asserting strict hash equivalence of the resulting database state. This guarantees runtime parity across bindings."

**Current text** (fig-swk-dual-runtime.tex caption, unchanged): "Invariant I11 (runtime parity) is therefore \textsf{partial}, and open problem OP-3 asks for the differential-test harness --- identical operation sequences against both runtimes, asserting identical observable state --- that would make it a theorem."

**Current text** (line 1234, exercises): "\textbf{(open, $\bigstar$ OP-3)} Specify the minimal differential-test suite that would make I11 a theorem: what operation sequences, what observable-state assertions, run against both runtimes?"

**Current text** (Table `tab:invariants`, line 1167, unchanged): "I11 & Runtime parity... & \BuiltWeak{} (OP-3)"

**Proposed rewrite:** If Differential Fuzzing is real and running in CI, upgrade I11 to `\Built` in the table, rewrite the figure caption's last sentence to state the fuzzing regime as the closing mechanism instead of a still-open ask, and turn the exercises entry into a `(check)` — "the CI pipeline's differential fuzzer asserts hash-equivalence over $10^6$ operations; what class of divergence would $10^6$ *not* catch?" — rather than asking the reader to design a suite that (per the body) already exists. If it is aspirational, say so with `\Designed` and drop "This guarantees."

**Priority:** high.

---

### A3. OP-4 (checkpoint with teeth): the paper's own "most important unbuilt thing" is declared solved 500 lines later

**Location:** §"The continuity organ," lines 1069–1074 and the pull-quote at lines 1056–1062, plus `fig-swk-continuity-organs.tex` caption, vs. §"Open problems," line 1597.

**Issue:** *Overclaim contradicting the paper's own headline finding.* §7 (continuity organ) is explicit and consequential: "Checkpoint is \BuiltWeak... A checkpoint with teeth... is open problem OP-4, the most important unbuilt thing at this layer because it is the literal foundation of any reputation economy." The pull-quote calls it "the weakest continuity link." The figure caption repeats "partial... is the literal foundation of a cross-machine reputation economy." Then, in the master Open Problems list, unhedged:

**Current text** (line 1597): "\item[$\bigstar$ OP-4 --- Checkpoint with teeth.] Realized via \textbf{Event-Sourced Neural Rehydration}. By restoring the Git SHA, truncating the JSON message array, and replaying via Prompt Prefix Caching, the daemon restores the full KV-Cache state, turning ``recovery passes notes'' into ``recovery restores work.''"

This is also, independent of the consistency problem, the single least-hedged, least-graded, and technically shakiest sentence in the paper: no maturity grade, no citation, and "restores the full KV-Cache state" glosses over the fact that a KV cache is bound to a specific model/inference session, not a portable artifact a restarted process can simply "replay" back into existence.

**Proposed rewrite:** Either (a) remove this entry and leave OP-4 genuinely open, consistent with §7 and the figure — the honest and currently-accurate choice given the rest of the document — or (b) if some version of this mechanism is real, restate it with a maturity grade and the same rigor as the rest of §7: "\Designed: a proposed checkpoint mechanism snapshots the working-tree diff, open claims, commitment set, and the last $N$ turns of transcript (name the concrete artifact — not KV-cache state, which is not durably restorable across a process boundary); replaying it primes a fresh agent's context but does not resume its exact internal state." Then update the pull-quote and figure caption to match whichever choice is made.

**Priority:** high.

---

### A4. OP-5 (oracle completeness): CSMA is declared solved but the algorithm it extends was never updated

**Location:** §"Cryptographic State-Machine Assertions (CSMA)," lines 1017–1019, vs. Algorithm `alg:close` (lines 990–1001) vs. exercises box line 1034.

**Issue:** *Internal inconsistency at the level of the pseudocode itself*, not just prose. §7.6 claims: "CSMA extends the oracle vocabulary by adding \emph{Delta Oracles}... and \emph{AST Assertions}... By restricting `done' conditions to these cryptographically verifiable state transitions, the kernel achieves oracle completeness." But Algorithm `alg:close`, three subsections earlier, enumerates the *entire* oracle kind set in code:

**Current text** (line 996): `if kind not in \{RELEASED_CLAIM, MERGED_COMMIT, PASSING_TEST, POLICY_SUBCHECK\}:`

No `DELTA_ORACLE` or `AST_ASSERTION` kind appears. And the exercises box for this very section still poses the problem as unsolved: "\textbf{(open, $\bigstar$ OP-5)} Extend the Law-2 oracle vocabulary to capture a `done' condition it currently misses, without re-admitting free text. State your new oracle and prove it is Goodhart-resistant."

**Proposed rewrite:** If CSMA is real, add the two kinds to the algorithm listing and to Table `tab:invariants` row I6, and change the exercise from `(open)` to `(check)`: "CSMA adds `DELTA_ORACLE` and `AST_ASSERTION` kinds; walk one closure attempt through each and show where `verify_holds_now` would call out to `tree-sitter`." If it is not yet real, grade it `\Designed` and keep OP-5 open as currently written elsewhere.

**Priority:** high.

---

### A5. OP-7 (schema evolution): the "solution" abandons the exact property the open problem asks to preserve

**Location:** §3.3 "Linear Migration Ledger (OP-7)," lines 499–501, vs. its own exercises box, lines 513–522, vs. master Open Problems entry, lines 1602–1603.

**Issue:** *Overclaim that also mismatches its own problem statement.* OP-7, as posed in the exercises box for this very section, asks: "Can idempotent self-init be extended to safe renames/backfills/down-migrations \emph{while preserving `any module, any order'}? Or is a version table unavoidable?" The body's answer is the second option — abandoning "any module, any order" entirely in favor of a strict sequencer — which is a legitimate engineering answer, but the section doesn't say so; it reads as though the original property survived.

**Current text** (line 501): "The kernel now enforces a strict, linear migration ledger managed exclusively by \texttt{agentsd} via SQLite's \texttt{pragma user\_version}. Modules no longer self-initialize; instead, the daemon executes a strictly ordered set of migrations upon boot, guaranteeing a deterministic schema state for all subsequent agent access."

**Proposed rewrite:** "The kernel resolves OP-7 by giving up `any module, any order' rather than saving it: a strict, linear migration ledger, managed exclusively by \texttt{agentsd} via SQLite's \texttt{pragma user\_version}, replaces per-module self-initialization. Modules declare migrations; the daemon applies them in one total order at boot. This is Table~\ref{tab:honestkey}'s second question ('is a version table unavoidable?') answered yes — the schema is now deterministic, at the cost of the flexibility the schema-by-union design offered." Then update the exercises box and the master Open Problems entry to match (retitle from a live question to a closed decision with its trade-off named).

**Priority:** medium.

---

### A6. OP-9's `SO_PEERCRED` claim directly contradicts the Threat Model table — a security-relevant factual conflict, not a tone issue

**Location:** §"Hash-chain tamper-evidence and OS-Level Ephemeral Namespaces (OP-9)," line 1393, vs. §"A second transport," lines 819–823, vs. Table `tab:threat-model`, line 1298.

**Issue:** This is the most serious individual finding in the review, because it is not an exposition problem — it is two mutually exclusive claims about the same security mechanism, one of which a reader relying on the threat-model table for a go/no-go decision would trust and be wrong to.

**Current text** (lines 819–823, §"A second transport"): "We note in \S\ref{sec:threatmodel} that the peer-credential check is a software handshake, not the kernel-enforced socket-level credential check (\texttt{SO\_PEERCRED}) it resembles --- a real trust-boundary caveat."

**Current text** (Table `tab:threat-model`, line 1298, row "Different-uid process"): "...but the socket peer-credential check is a software handshake, not the kernel-enforced socket credential (\texttt{SO\_PEERCRED}) --- a real authentication caveat."

**Current text** (line 1393, §OP-9, the contradicting claim): "IPC sockets strictly enforce \texttt{SO\_PEERCRED} validation, guaranteeing that the daemon can cryptographically bind incoming requests to a specific, sandboxed spawn instance, making same-user filesystem bypasses impossible."

**Proposed rewrite:** This must be resolved as a fact, not just reworded, but the exposition fix is: state explicitly whether OP-9's namespace work *changes* the §5.4/Table~\ref{tab:threat-model} finding. If `SO_PEERCRED` enforcement is now real for the ephemeral-namespace path, say so precisely and narrow the scope: "The default transport's peer-credential check remains a software handshake (§5.4); the OS-Level Ephemeral Namespaces path introduced for OP-9 additionally enforces kernel-level \texttt{SO\_PEERCRED} validation for spawned, sandboxed agent processes specifically — a stronger, narrower guarantee than the general-transport caveat above, not a blanket replacement of it." Then update the threat-model table's "Different-uid process" row to reflect the narrower carve-out, or explicitly note it does not yet apply generally. Do not leave both claims standing unqualified.

**Priority:** high.

---

### A7. OP-10 (selective checkpointing): claimed solved in prose, still posed as an open design exercise two paragraphs later, and not reflected in the formal Property statement

**Location:** §4.2, line 596, vs. Property `prop:durability` (§4.1, lines 552–564) vs. exercises box, lines 616–619.

**Issue:** *Overclaim that the paper's own formally-stated Property doesn't carry.* Property~\ref{prop:durability} states unconditionally: "\textbf{I1b (power-loss durability).}... \NotGuar{} under the normal synchronization level; it would require full synchronization or a checkpoint on the commit path." Two subsections later, the "would require" is claimed done for a subset of writes — but Property `prop:durability` is never amended, and the exercises box for the exact same section still asks the reader to invent the mechanism just described:

**Current text** (line 596): "To solve this (OP-10), the kernel implements \textbf{Selective Checkpointing}. High-stakes, money-bearing writes (like those in the settlement ledger) append \texttt{PRAGMA wal\_checkpoint(FULL);} to their execution paths, forcing a synchronous flush to disk. This achieves power-loss durability (I1b) dynamically without compromising the high-throughput standard paths."

**Current text** (line 616): "\textbf{(open, $\bigstar$ OP-10)} Design a per-write-path durability selector: how would the kernel let a settlement-ledger write opt into I1b while keeping claim writes fast? What is the cleanest interface that does not re-introduce the conflation?"

**Proposed rewrite:** Add a corollary to Property `prop:durability` naming the exception precisely: "\textbf{Corollary (selective I1b).} A write path may opt into power-loss durability by forcing \texttt{wal\_checkpoint(FULL)} on its commit path, at the cost of that path's throughput; this is applied today to \emph{[name the concrete write paths]}. All other paths remain I1b-\NotGuar{} by Property~\ref{prop:durability}." Then either delete the OP-10 exercise (superseded) or retarget it at the genuinely remaining question, e.g. "what interface prevents a future write path from silently defaulting to the fast, I1b-exposed path when it should have opted in?"

**Priority:** high.

---

### A8. OP-2's theorem is proved, then the exact same claim is restated as a still-open exercise

**Location:** Theorem `thm:decidability` + Remark `rem:controllability-scope`, lines 931–943, vs. §"Formalizing Synchronous State Decidability (OP-2)," lines 1013–1019 (near-duplicate restatement), vs. exercises box, line 1030.

**Issue:** *Redundancy plus an unresolved open/closed status.* Lines 1013–1019 restate, in prose, almost exactly what Theorem `thm:decidability` already proved with a proof sketch — a genuine "iff" theorem with citations to Ramadge–Wonham controllability in the remark that follows it. That's a real, closed result. Yet the exercises box for the same material still asks: "\textbf{(open, $\bigstar$ OP-2)} Formalize the regimentation-vs-enforcement boundary: which monitor rules are truly regimentable... versus only enforceable...? A clean theorem here is the deontic heart of the layer." The theorem the exercise asks for already exists two pages earlier.

**Proposed rewrite:** Delete §"Formalizing Synchronous State Decidability (OP-2)" (lines 1013–1019) entirely — it adds nothing Theorem `thm:decidability` and Remark `rem:controllability-scope` don't already say, more precisely. Then change the OP-2 exercise from `(open)` to `(check)`: "Theorem~\ref{thm:decidability} settles which monitor rules are regimentable. Classify each of I7–I9's monitor rules (note-monotonicity, capability escalation, lock-owner validity) against it: which are pure functions of committed local state, and which cross the boundary?" Update the master Open Problems list entry (line 1593–1595) the same way.

**Priority:** medium.

---

### A9. The Compute-to-Data Airlock section imports cross-machine, cross-operator content into a chapter that explicitly promises not to

**Location:** §8.5 "Information Flow Control (IFC) and the Compute-to-Data Airlock," lines 1395–1409, vs. the abstract's own scope disclaimer, lines 243–244, and §1's four-layer stack description, lines 267–269.

**Issue:** *Scope violation against the paper's own stated contract* — not a wording problem but a structural one. The abstract is explicit: "...cross-machine capability transfer --- which belongs to the cross-machine layer and lives there, not here." Section 1 assigns "the cross-machine market in which operators trade work and reputation" to the Economy chapter, "Treated in an accompanying chapter." Section 8.5 then spends fifteen lines on "Alice license[s] a proprietary agent stack $S$... to execute over Bob's confidential data $D$" — a scenario that is definitionally cross-operator (two different principals, mutual distrust, licensing) — inside the substrate paper's obligation-and-enforcement section, introducing new machinery (a hypervisor, dynamic taint propagation, an LLM-proxy DLP scan, execution-bond slashing) that appears nowhere else in the paper's seven-organ inventory or Table `tab:appendix-map`.

**Current text** (line 1401): "To allow Alice to license a proprietary agent stack $S$ (compiled Wasm or opaque container) to execute over Bob's confidential data $D$ without mutual data exfiltration:"

**Proposed rewrite:** Either cut §8.5 from this chapter and move it to *The Harbor Economy* (where the abstract already says cross-operator material belongs), replacing it here with a one-paragraph forward pointer ("A companion chapter, *The Harbor Economy*, extends this organ's taint-tagging primitive to a cross-operator compute-to-data airlock — see [chapter reference]"); or, if a same-machine, same-operator version of taint tracking genuinely belongs at the substrate layer, rewrite the scenario to match: two agents under one operator's control, not "Alice licenses to Bob."

**Priority:** high.

---

### A10. The controllability Remark is written in the formal paper's register, with no scene and no analogy — and a ready-made one already exists in the companion paper

**Location:** Remark `rem:controllability-scope`, lines 941–943.

**Issue:** *Definitions First* / missing structural analogy (harbor-exposition Move 3). This is the single densest paragraph in the whitepaper and the one furthest from "a smart-but-non-specialist reader": "partition the event alphabet into controllable events $\Sigma_c$... and uncontrollable events $\Sigma_u$... A safety policy is regimentable iff it is \emph{controllable} with respect to $\Sigma_u$ --- no uncontrollable event enabled after a legal prefix can exit the specification." It reads exactly like `docs/harbor-research/tex/paper2.tex` (its formal counterpart — see Part D), which is appropriate for paper2 and not for a whitepaper chapter. Paper2 itself opens with a bouncer/nightclub analogy that maps cleanly onto this exact content: "A door policy (`no entry after 2am') is enforceable by prevention. A thought policy (`no ill intent inside') is enforceable only by observation and ejection" (paper2.tex, lines 51–52).

**Current text** (line 941, opening clause): "Theorem~\ref{thm:decidability} is the \emph{operational} form of a more general boundary. In supervisory-control terms (Ramadge--Wonham, 1987), partition the event alphabet into controllable events $\Sigma_c$..."

**Proposed rewrite:** Precede the formal remark with a two-sentence scene, reusing the companion paper's analogy so the two chapters reinforce rather than duplicate each other: "Think of the daemon as a bouncer at one door of a club. Turning someone away at the door is prevention --- \emph{regimentable}; noticing bad behavior once someone is already inside and walking them out is detection --- \emph{enforced}. Theorem~\ref{thm:decidability} is the special case where the only door the bouncer stands at is the database commit; a companion formal chapter generalizes the same boundary to every controllable event a runtime can gate, not only writes." Keep the existing formal sentences as the box that follows.

**Priority:** medium.

---

### A11. Algorithms are captioned as `Figure`, referenced as `Algorithm`

**Location:** Algorithm `alg:acquire` (lines 651–674) and `alg:close` (lines 983–1004) — both `\begin{figure}[H]` wrapping an `lstlisting` whose `caption=`/`label=` keys register against the active float, i.e., the `figure` counter, not a dedicated `algorithm` counter.

**Issue:** The linter flagged both as "no `\caption`"/"no `\label`" (false positive — see Tooling notes), but its false alarm points at something real: prose calls these "Algorithm~\ref{alg:acquire}" and "Algorithm \ref{alg:close}" (lines 648, 977), but the counter that actually numbers them is `figure`. **[needs render]** to confirm the printed text, but as authored this will very likely print as "Figure 3: Claim acquisition..." with the caption-hyperref target correctly resolving, while the prose sentence around it says "Algorithm 3" — a numbering label mismatch a careful reader (the paper's own target audience, per §"a systems engineer" in the Reader's Map) would notice.

**Proposed rewrite:** Either load `algorithm`/`algorithmic` (or the simpler `algorithm2e`) and give these their own float type and counter, or stop calling them "Algorithm" in prose and call them what the counter will print ("Figure~\ref{alg:acquire}"). The former is more in keeping with the paper's rigor elsewhere (Theorem, Lemma, Property, and Definition all have dedicated counters; Algorithm should too).

**Priority:** medium — cosmetic today, but a real inconsistency **[needs render to confirm]**.

---

### A12. Alice and Bob are reused across three unrelated scenarios without a beat marking the shift

**Location:** §5 "Worked dramatization: Alice and Bob race for one port" (lines 684–697); §8.2 "Worked dramatization: Bob attempts a forbidden action" (lines 903–918); §8.5's IFC scenario, "Alice license a proprietary agent stack... to execute over Bob's confidential data" (line 1401).

**Issue:** In the first two dramatizations, Alice and Bob are cooperating (or one misbehaving) agents on the *same* machine under the *same* operator — exactly the substrate paper's threat model. By §8.5 they have become two different *operators* who do not trust each other and are licensing proprietary stacks across a trust boundary — a completely different relationship. Reusing the same two names for structurally incompatible roles risks a reader importing the earlier "same-machine, cooperating" mental model into a scenario that is its opposite. (This compounds A9 — if §8.5 moves to the Economy chapter per that recommendation, this issue moves with it and can be fixed by introducing new names appropriate to a cross-operator scenario, e.g. "Acme Corp" and "Bexley Labs.")

**Proposed rewrite:** If §8.5 stays, rename its principals (e.g., "a license-holder" and "a data-holder," or new proper names) so "Alice" and "Bob" remain reliably bound to "the two agents on my machine" throughout the chapter.

**Priority:** low.

---

### A13. The abstract crams three separable claims into one dense paragraph

**Location:** Abstract, lines 197–229.

**Issue:** The abstract's opening (lines 198–205) is a genuinely good Move-1 scene ("A swarm of autonomous coding agents sharing one machine collides over the same scarce things..."). But from "This paper presents that kernel" onward it runs, unbroken, through the reference-monitor framing, the invariants-as-theorems claim, the durability split, *and* the enforcement correction — five distinct ideas in one 30-line paragraph, harder to skim than the rest of the paper, which is organized with real discipline elsewhere (the Reader's Map exists precisely to help a busy reader avoid reading exactly this kind of block linearly).

**Proposed rewrite:** Split after "...realized locally rather than as an abstract security kernel." into two paragraphs: one stating what the kernel *is and proves* (definitions, invariants-as-theorems), a second stating *where the promises stop* (the durability split, the detector/regimenter correction). This mirrors the paper's own two-halves thesis in §1.1 ("Durability... Mediation...") and would let the abstract itself demonstrate the structure it argues for.

**Priority:** low.

---

### A14. "OS-Level Ephemeral Namespaces" and "CSMA" are the only technical mechanisms in the paper introduced with zero maturity grade

**Location:** Line 1393 (OP-9 section) and lines 1017–1019 (OP-5/CSMA section).

**Issue:** Every other load-bearing mechanism in the paper carries `\Built`/`\BuiltWeak`/`\Designed`/`\Vision` inline, per the explicit promise at §1.4 ("every load-bearing claim in this paper carries an explicit maturity grade"). These two sections are flat assertions with no grade markup at all — which, given A3–A8 above, is not a coincidence: the ungraded sections are exactly the ones whose claims don't survive cross-checking against the rest of the document.

**Proposed rewrite:** As part of resolving A4 and A6, add explicit grades to both sections' claims, matching the rest of the paper's apparatus (e.g., `\Designed` for CSMA until the algorithm and table are updated per A4; a scoped grade for the `SO_PEERCRED` claim per A6).

**Priority:** medium (subsumed by A4/A6 if those are fixed, but worth calling out as the systemic tell).

---

### A15. Strengths worth preserving as-is

Several passages are exemplary and should not be touched in a revision pass: the one-sentence thesis and pull-quote (§1.1, lines 284–300) is a clean, self-contained Move 2 + Move 4 pairing that passes the harbor-exposition expert test on its own; the Alice/Bob port-race and forbidden-action dramatizations (§5, §8.2) are excellent Move-5 "numbers/story by hand" work; the Reader's Map (§2) is exactly the Rail-A feature the house style asks for; and the appendix's "three load-bearing corrections" (§Status, lines 1704–1726) is the right register and the right level of self-audit for the durability split and the detector/regimenter correction specifically — those two corrections, unlike A1–A8's retrofits, are threaded consistently through the entire document (property, theorem, figure, table, and conclusion all agree).

---

## Part B — Existing figures/tables: clarity audit

**Cross-cutting finding before the per-figure audit:** the accent pair cobalt/teal is reused across at least five figures with inconsistent, sometimes inverted, meaning. In `fig-swk-reference-monitor.tex` and `fig-swk-deontic-split.tex`, cobalt marks the *stronger* guarantee (regimented, pre-commit) and teal the *weaker* one (enforced/monitor, post-commit). In `fig-swk-durability-faultclass.tex`, the mapping flips: teal marks the guarantee that *holds* (I1a survives) and cobalt the one that *fails* (I1b not guaranteed) — the opposite valence from the first two figures. In `fig-swk-commitment-oracle.tex`, teal is success and cobalt is refusal (matching durability-faultclass's valence, not reference-monitor/deontic-split's). In `fig-swk-dual-runtime.tex`, the same pair means "test" vs. "production," a third, unrelated dimension. A reader who builds a mental color-legend from the first figure they see will misread the others. This is a house-style violation (`high-quality-latex-whitepaper/SKILL.md`, cheap tell #3 and #6) even though each individual figure, read in isolation, is well-crafted.

### B1. `fig-swk-stack-map.tex` — the four-layer stack

**What it shows:** Five stacked rungs (economy, legibility, coordination, substrate, machine) with "this paper" flags on the two lowest, and assumes/provides arrows crossing the machine/substrate boundary.

**What the reader should take away:** This chapter owns exactly the bottom two layers; everything above is a different chapter's job.

**Will they get it?** Yes. Position-on-a-common-scale (Cleveland–McGill's strongest channel) does the work; the cobalt "this paper" flags are a single, correctly-restrained accent use pointing at the one thing that matters on this page. Caption states the finding, not just the parts.

**Verdict:** Good, keep.

### B2. `fig-swk-reference-monitor.tex` — the kernel as reference monitor

**What it shows:** A request-flow diagram: agent → uniqueness/boot gate → WAL (committed) → operation log, with an explicit "commit line" and a policy-monitor subscriber positioned *downstream* of it, connected by a dashed "compensate" edge back to the WAL.

**What the reader should take away:** The policy monitor cannot be a preventer because of *where it sits relative to the commit line* — a structural, not rhetorical, argument.

**Will they get it?** Yes — this is the best figure in the paper. It is a genuine mechanism diagram (not a decorative box-and-arrow chart): the physical position of the monitor node relative to the dashed commit-line is the entire argument of Theorem `thm:schneider`, made visible. Caption states the finding precisely and ties it to the citation.

**Verdict:** Excellent, keep (fold into the cross-figure color fix above).

### B3. `fig-swk-deontic-split.tex` — three-column deontic modalities

**What it shows:** Prohibition / Obligation / Permission as three parallel columns, each stating its mechanism and its two invariants where applicable.

**What the reader should take away:** These are three distinct kinds of rule, enforced three distinct ways, and conflating them is the error.

**Will they get it?** Yes, though the three columns being visually equal-weight slightly understates that "prohibition" carries the paper's sharpest correction while "permission" is comparatively simple — a minor emphasis mismatch, not a comprehension failure.

**Verdict:** Good, keep.

### B4. `fig-swk-claim-lifecycle.tex` — the claim/lock finite-state machine

**What it shows:** FREE → HELD → EXPIRED with re-claim/release self-loops and a lazy-sweep edge; caption explicitly calls out the missing QUEUED state as the takeaway.

**What the reader should take away:** There is no fairness primitive; a hot resource can starve a slow agent — this is the FSM's "conspicuous missing state."

**Will they get it?** Yes, as a standalone figure this is a strong Mensh–Kording caption (states the finding, not just the parts) attached to a clean FSM. **But it now contradicts §5.3's body text (see A1)** — the figure and the prose disagree about whether OP-1 is solved.

**Verdict:** Needs fix — not on craft grounds, but to stay consistent with whichever resolution A1 lands on.

### B5. `fig-swk-dual-runtime.tex` — the dual-runtime hazard

**What it shows:** One database interface, two runtimes underneath (test vs. deployment bindings), a shim normalizing the pragma/option gap between them.

**What the reader should take away:** "Green under test" and "computed in deployment" are different runtimes, and a shim is not a proof they agree.

**Will they get it?** Yes, on its own. **Contradicts §7.4's body text (see A2)** — the figure still frames OP-3 as an open ask; the body calls it "formerly open."

**Verdict:** Needs fix — same consistency issue as B4, otherwise well-drawn.

### B6. `fig-swk-seven-organs.tex` — the seven-organ overview

**What it shows:** A 3×2 grid of six organs sitting atop a wide "substrate organ" rung, each with a maturity label, connected by teal arrows down to the substrate.

**What the reader should take away:** Six organs are, mechanically, tables-with-discipline over one shared file; the substrate is the actual floor.

**Will they get it?** Yes — this is a legitimate relation-map (base structure = the seven organs, arrows = "is grounded in," labeled by the connecting edges rather than left as bare lines). Minor: `\newcommand{\modlbl}` is defined (line 26) but never invoked anywhere in the figure — dead code.

**Verdict:** Good; remove the unused `\modlbl` macro as housekeeping.

### B7. `fig-swk-durability-faultclass.tex` — durability by fault class

**What it shows:** A four-stage pipeline (commit success → OS page cache → WAL file → main DB) with two outcome boxes forking off it: I1a "SURVIVES" (teal) after the page-cache stage, I1b "NOT GUARANTEED" (cobalt) after the WAL-file stage.

**What the reader should take away:** The two fault classes differ by exactly *which pipeline stage* the failure hits — a physically grounded explanation, not just an assertion.

**Will they get it?** Yes — this is the second-best figure in the paper for the same reason B2 is: it's a real mechanism diagram, and the position of the fork on the pipeline *is* the argument. See the cross-cutting note above re: color valence (teal=survives here, but teal=weaker-guarantee in B2/B3).

**Verdict:** Good, but (a) fix the color-valence inconsistency noted above, and (b) once A7 (Selective Checkpointing) is resolved, consider adding a second, dashed branch off the WAL-file stage for the forced-checkpoint write path, so the figure reflects whichever scoped claim the prose ends up making.

### B8. `fig-swk-comm-organ.tex` — the communication organ

**What it shows:** A nested-box diagram: the bus envelope (solid border = built) containing the typed speech act (dashed border = specified); a parallel stigmergic-markers panel; and the authorization-chain/coordination-lineage pair with an arrow showing "carried inside."

**What the reader should take away:** The kernel ships the carrier; the coordination layer ships the semantics; and "delegation chain" is really two distinct objects, one nested in the other.

**Will they get it?** Yes, and this figure does something the others don't: it encodes maturity status by **border style** (solid vs. dashed) rather than by hue — exactly the "status by weight/small-caps, not hue" discipline the house style calls for, extended sensibly to line style. This is the technique B10's fix should borrow.

**Verdict:** Excellent — use as the model when fixing B10.

### B9. `fig-swk-commitment-oracle.tex` — the commitment-closure gate

**What it shows:** An open → oracle-gate diamond → done/refused FSM, with abandoned/superseded exits, plus a boxed enumeration of the finite oracle vocabulary connected by a dashed amber arrow.

**What the reader should take away:** Closing "done" without a verifiable, currently-holding oracle reference is structurally refused, not merely discouraged.

**Will they get it?** Yes. Minor craft note: this figure introduces a *third* hue (amber) for the oracle-vocabulary connector, on top of the cobalt/teal pair used for refuse/succeed — a small instance of the same color-proliferation pattern flagged cross-cuttingly above.

**Verdict:** Good; consider making the oracle-vocabulary connector ink/gray (structural, not accent) rather than amber, freeing amber for a role that actually needs a third status color (or dropping the third hue paper-wide).

### B10. `fig-swk-single-writer.tex` — the single-writer serialization

**What it shows:** Five client types funneling into one daemon node, connected by a single cobalt double-arrow to one SQLite file.

**What the reader should take away:** Many clients, one writer, one file — the entire architectural move in one picture.

**Will they get it?** Yes, immediately — this is the simplest and clearest figure in the paper, a textbook restrained use of a single accent on the single most important edge (daemon↔file).

**Verdict:** Excellent, keep as-is.

### B11. `fig-swk-consistency-model.tex` — the linearizability trace

**What it shows:** A real-time axis with three agents' claim/release operations as boxes, cobalt dots marking each commit's linearization point, and a boxed total order underneath.

**What the reader should take away:** Linearizability isn't abstract — here is one concrete, unambiguous total order derived purely from commit times.

**Will they get it?** Yes — this is a strong worked-example figure (Cleveland–McGill: position along a common time scale, the strongest perceptual channel), and it's the visual counterpart to Theorem `thm:consistency`'s proof sketch.

**Verdict:** Excellent, keep.

### B12. `fig-swk-continuity-organs.tex` — the three continuity organs

**What it shows:** Three boxes (Memory / Checkpoint / Witnessed-outcome ledger) in a row, each with a status label in a *different* color (teal for "implemented," cobalt for "partial" on Checkpoint, amber for "partial" on Ledger), and a star annotation over Checkpoint calling it "the weakest continuity link."

**What the reader should take away:** The whole cross-machine economy rests on these three organs, and the middle one is the weak link.

**Will they get it?** The finding lands (the star + caption are effective), but the color choices actively work against the house style: this is the paper's clearest instance of cheap tell #3 ("multi-colored / multi-weight bold... status labels: muted ink/gray, differentiated by weight or small-caps, not by hue") — three different hues for what is really a two-value status set, with the *same* word "partial" rendered in two *different* colors (cobalt for Checkpoint, amber for Ledger) in the same figure. That specifically contradicts the main file's own documented rule (preamble comment, `single-writer-kernel.tex` lines 48–49: "the four grades differ by WEIGHT and SMALL-CAPS / italic, never by hue"). It also, per A3, currently disagrees with the master Open Problems list about whether OP-4/Checkpoint is solved.

**Verdict:** Needs fix, on both craft and consistency grounds. **Concrete fix:** replace the three `\color{hhteal}`/`\color{hhcobalt}`/`\color{hhamber}` status labels with the document's own `\Built`/`\BuiltWeak` macros (which the main file already defines as ink/gray, small-caps/weight-differentiated, no hue) — the same technique B8 already uses correctly via border style. Then reconcile the Checkpoint status with A3's resolution.

---

## Part C — New figures/examples proposed

### C1. A controllability regime diagram for the regimented/enforced boundary

**Where:** Immediately after Remark `rem:controllability-scope` (§7, near line 943), replacing or supplementing the dense prose there.

**What it would show:** A 2×2 grid, axes = "is the *trigger* event controllable?" × "is the *effect* event controllable?", with the kernel's own concrete examples plotted in each cell — reusing the exact examples the companion formal paper already worked out (`docs/harbor-research/tex/paper2.tex`'s table, lines 204–211): `net_egress`, `git_push`, `fs_write`, `exec_tool`, `spawn_child` in the controllable-effect cells (regimentable); `model_emit_token`, `internal_plan` in the uncontrollable-effect cell (detect-only, forever); and the compound "no egress after reading a secret" case marked on the diagonal cell where the trigger is uncontrollable but the effect is controllable — the case the paper spends a whole keyidea explaining in prose ("Gate the channel, never the token") without ever drawing it.

**Why it helps:** This is precisely the Rail-B regime-diagram the house style mandates for a validity-boundary result (`style-template-v2.md`: "axes = the two parameters that most control validity; shade where the result holds"), and right now the paper's hardest boundary claim has zero visual support. It would also hand the reader a reusable tool: once drawn, a sharp reader can independently classify each of the paper's own "solved" OP claims (A1–A8) against it, which would have caught several of this review's Part A findings before publication.

**Kind:** regime-diagram.

### C2. An open-problems reconciliation table

**Where:** As a new appendix table (near §Appendix, "Status, and the three load-bearing corrections," after line 1726), or replacing the current unstructured Open Problems section.

**What it would show:** One row per OP-1..OP-11, four columns: status per the master Open Problems entry; status per its originating in-body section; status per its exercises box; status per any figure caption that references it. Every row where two columns disagree is visible at a glance.

**Why it helps:** This directly operationalizes the fix for this review's single largest finding (Part A items 1–8, Summary bullet 1) and gives future editors a mechanical way to keep a "solved" claim in sync everywhere it's echoed, rather than relying on a full re-read to catch drift (which is how the current inconsistencies accumulated).

**Kind:** table.

### C3. A hand-checkable worked example for stigmergic marker decay

**Where:** §6.2 "Stigmergic markers: decay as a provided guarantee" (around line 782), immediately after the $w \cdot r^{\Delta t}$ formula is introduced.

**What it would show:** A small table picking concrete numbers — e.g. $w_0 = 1.0$, per-tick decay $r = 0.9$ — computing $w$ at ticks 5, 10, 20, and the tick at which $w$ first drops below a stated prune threshold (solvable by hand: $0.9^n < \theta \iff n > \ln\theta/\ln 0.9$), tagged `[verified]` per the numeric-claim provenance policy. End with a "now you try" at a different decay rate, per Move 5's fade discipline.

**Why it helps:** Every other quantitative claim in the paper (the durability window, the linearization trace, the port-race dramatization) is grounded in a number the reader can check on one line; decay is currently described only symbolically, and OP-8 (decay calibration) is posed as pure abstraction with nothing for a reader to anchor an intuition on before attempting the starred exercise.

**Kind:** worked-numeric-example.

### C4. An end-to-end cross-organ trace

**Where:** A new figure immediately after `fig-swk-seven-organs.tex` (§3, near line 431), or inline in §10 "Cross-organ atomicity."

**What it would show:** One concrete agent action — "claim `auth.ts`, open a session, post a bus message announcing the claim, register a commitment with a daemon-derived deadline" — as a single numbered sequence crossing four of the seven organs (resource, continuity, communication, obligation), each step tagged with which SQLite write it is, and a visual bracket showing which of the four writes are (today) *not* wrapped in one transaction — making §10's "buildable defect" concrete rather than asserted.

**Why it helps:** Every other figure in the paper is organ-local; a reader never sees one action ripple across the whole kernel, which is exactly the kind of structural, relation-mapping picture Move 3 calls for and which would make the cross-organ-atomicity gap (§10) something the reader has *seen fail to be atomic*, not just been told about.

**Kind:** relation-map (sequence variant).

### C5. A per-write-path durability regime diagram

**Where:** §4, next to or replacing part of `fig-swk-durability-faultclass.tex`, once A7 (Selective Checkpointing) is resolved.

**What it would show:** A 2×2 grid — write-path type (standard vs. checkpoint-forced) × fault class (process-crash vs. power-loss) — shaded to show exactly which of the four cells the kernel covers today, naming the concrete write paths (e.g. "settlement ledger") that opt into the forced-checkpoint column.

**Why it helps:** Turns OP-10's currently-vague prose claim into a picture with an honest boundary — precisely which paths are covered, which aren't, today — rather than a single unqualified sentence ("This achieves power-loss durability... without compromising the high-throughput standard paths") that Part A flags as needing scoping.

**Kind:** regime-diagram.

---

## Part D — Cross-reference notes

`docs/harbor-research/tex/paper2.tex`, titled "Regimented or Enforced: The Controllability Boundary for Agent Governance," **is** the formal counterpart the task brief guessed at — confirmed, not skipped. It proves the general Ramadge–Wonham controllability theorem that `single-writer-kernel.tex`'s Theorem `thm:decidability` and Remark `rem:controllability-scope` explicitly cite as their generalization ("Theorem~\ref{thm:decidability} is the special case $\Sigma_c = \{\text{synchronous DB commits}\}$" — an accurate, correctly-scoped cross-reference).

**Terminology check — no drift found.** Both documents use "regimented" (rejected pre-commit, truly unreachable) and "enforced" (detected post-commit, compensated) identically; both partition the event alphabet into controllable events $\Sigma_c$ and uncontrollable events $\Sigma_u$ with the same meaning; the whitepaper's memorable line "Gate the channel, never the token" (Remark `rem:controllability-scope`, line 942) is a direct, correctly-used borrowing of paper2's own section title (paper2.tex, §"The compound case: gate the channel, never the token," line 236) and its content matches paper2's worked example precisely (record the taint, gate the controllable consequence).

**One real gap: the borrowing is uncited.** The whitepaper says "(Ramadge--Wonham, 1987)" as plain parenthetical text (line 941) — not a `\cite{}` — and the whitepaper's own `\thebibliography` (lines 1741–1877, 25 entries) contains no Ramadge–Wonham entry at all, even though paper2.tex cites them formally (`\bibitem{rw87}`: P.J. Ramadge and W.M. Wonham, *Supervisory control of a class of discrete event processes*, SIAM J. Control Optim., 25(1):206–230, 1987; `\bibitem{rw89}` for the 1989 IEEE Proceedings survey). Given the whitepaper borrows not just the concept but the exact vocabulary ($\Sigma_c$/$\Sigma_u$) and a direct phrase from paper2's own section title, this is a citation-hygiene gap worth closing: add matching `\bibitem{rw87}`/`\bibitem{rw89}` entries to the whitepaper's bibliography and convert the inline "(Ramadge--Wonham, 1987)" to `\cite{rw87}`. It would also strengthen the series' internal coherence to add an explicit pointer from Remark `rem:controllability-scope` to the companion formal chapter, the way §1's introduction already cross-references the other whitepaper chapters by name.

---

## Summary

1. **[High]** A systemic contradiction runs through roughly a third of the document: seven of eleven open problems (OP-1, 2, 3, 4, 5, 7, 9, 10) are declared solved in the master Open Problems list and/or their originating section, while their own exercises boxes, the invariants table, the adjacency contract, and three figure captions still describe them as open or partial. This directly undercuts the paper's advertised differentiator — the research-maturity scale and its promise that "every load-bearing claim... carries an explicit maturity grade." Fix via Part A items 1–8 and Part C item 2 (a reconciliation table to prevent recurrence).
2. **[High]** OP-9's claim that "IPC sockets strictly enforce `SO_PEERCRED` validation" directly contradicts the Threat Model table's explicit statement that this check "is a software handshake, not the kernel-enforced socket-level credential check" — a security-relevant factual conflict a reader could act on incorrectly, not merely a consistency nit. See A6.
3. **[High]** §8.5's Compute-to-Data Airlock section introduces cross-operator, cross-machine content (a licensing scenario between mutually distrusting principals) inside a chapter whose own abstract promises that exact material "lives" in a different chapter. See A9.
4. **[Medium]** The cobalt/teal accent pair carries inconsistent, sometimes inverted, meaning across five-plus figures (strong-guarantee-vs-weak in two figures, survives-vs-fails in another with the same colors reversed, test-vs-production in a fourth). `fig-swk-continuity-organs.tex` is the sharpest instance: three different hues for a two-value status set, with the same word "partial" shown in two different colors. See the Part B cross-cutting note and B12; `fig-swk-comm-organ.tex` (B8) already demonstrates the correct fix (encode status by border style, not hue).
5. **[Medium]** The paper's densest, least-accessible paragraph (Remark `rem:controllability-scope`, the Ramadge–Wonham controllability boundary) is written in pure formal-paper register with no scene or analogy — unusual for a chapter whose job is to popularize a formal result — even though the sibling formal paper (`paper2.tex`) already has a ready-made bouncer/nightclub analogy for exactly this content. See A10.
6. **[Medium]** The whitepaper borrows Ramadge–Wonham's vocabulary and paper2's own section-title phrase ("gate the channel, never the token") without a `\cite` or a bibliography entry for the source. See Part D.
7. **[Low–Medium]** Both algorithms (`alg:acquire`, `alg:close`) are captioned via `lstlisting`'s keys inside a `figure` float, so `\ref` resolves to a Figure number while prose calls them "Algorithm" — a numbering mismatch **[needs render to confirm the printed text]**. See A11.
