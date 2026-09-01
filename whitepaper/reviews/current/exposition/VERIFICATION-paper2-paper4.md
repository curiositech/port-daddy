# Falsification-first verification: paper2 A20, paper4 A21

**Method.** Refute-before-confirm. For each claim in the earlier editorial review I first
looked for a reading of the source that would make the review *wrong*, and only recorded a
CONFIRMED verdict where no such reading survived contact with the text.

**Provenance of the source read.** Verified against
`claude/white-paper-pr-review-uncpxg` @ `127ffc91f`:
`whitepaper/research/tex/paper2.tex` (441 lines),
`whitepaper/research/tex/paper4.tex` (562 lines),
`whitepaper/research/figures/fig-r9-relation.tex`.
All line numbers below are that revision. (A concurrent session switched the working tree to
`claude/harbor-paper-craft-skill`, where both papers are shorter, differently-numbered
revisions; those were **not** used. Every quote below was extracted with
`git show claude/white-paper-pr-review-uncpxg:<path>`.)

**Neither .tex file was edited.** This file is the only write.

---

## paper2 A20(i)

> Claim under test: "Widening $\Sigma_c$ (owning more channels) is the *only* way to grow the
> regimentable set" (L283–284) is false, because shrinking the plant $\bar{L}$ satisfies the
> paper's own criterion just as well — and §6's sealed-room mechanism already relies on
> exactly that lever.

**Verdict: PARTIALLY-CONFIRMED.** The overclaim is real, but the review's *supporting
evidence is refuted*: §6 does not use a plant-shrinking lever, it uses pure $\Sigma_c$
gating. The sentence's actual accuser is the paper's own theorem statement, not its §6.

### Evidence

The sentence, verbatim (L282–284):

> The general statement strictly dominates it --- the slogan cannot express why
> force-push is preventable by a runtime that also owns the git credential channel, nor why a
> confident lie stays unpreventable no matter how much state is committed. Widening $\Sigma_c$
> (owning more channels) is the \emph{only} way to grow the regimentable set; no
> policy-language cleverness does.

**The criterion does carry a second free parameter.** The theorem box (L158–163):

> Let $L\subseteq\Sigma^*$ be a prefix-closed plant over $\Sigma=\Sigma_c\uplus\Sigma_u$, and
> let $K\subseteq L$ be a nonempty prefix-closed safety policy. There exists a regimentation
> mechanism for $K$ [...] if and only if $K$ is \emph{controllable} with respect to $L$ and
> $\Sigma_u$: \[ \overline{K}\,\Sigma_u\;\cap\;\overline{L}\;\subseteq\;\overline{K}, \]

$\overline{L}$ appears on the left-hand side of the containment. Shrinking it weakens the
antecedent, so strictly more policies satisfy the condition. This is not a technicality the
paper is unaware of — it flags the choice twice, as a *choice*:

- L84–86: "The \emph{plant} $L$ is the set of histories that are \emph{physically} possible,
  before any policy is imposed. [...] We take $L=\Sigma^*$: any interleaving of events can
  occur, because nothing about the hardware forbids one."
- L122–123: "for a general agent we take the universal plant $L=\Sigma^*$ (any interleaving
  can occur)."

And the paper's two flagship *negative* verdicts are both stated as explicitly
plant-relative:

- L218–221: "the same one-state automaton disables \texttt{internal\_plan}$\;\in\Sigma_u$,
  **the universal plant enables it at the start state**, so the empty history [...] witness
  $\overline{K}\Sigma_u\cap\overline{L}\not\subseteq\overline{K}$"
- L308–311: "it contains $\varepsilon$, **the plant enables \texttt{internal\_plan} at
  $\varepsilon$**, so controllability forces [...] Hence $\sup\mathcal{C}(K)=\emptyset$"

So the paper knows its detect-only classifications are conditional on $L=\Sigma^*$, then two
pages later asserts the split is the *only* dial. That is a genuine internal inconsistency,
and it is with the theorem box and §7, not with the boundary box.

**The review's §6 evidence is refuted.** §6's sealed-room passage (L267–274) describes a
supervisor over $\Sigma_c$, with no plant restriction anywhere:

> \emph{Second, the clean room.} The Sealed Harbor design (Paper 4) puts an agent alone in a
> room with a customer's secret data and promises the secret does not leave. The theorem
> dictates the only sound architecture: it is impossible to prevent the model from
> \emph{reading} the secret (the read is uncontrollable --- and useless to forbid, since
> reading is the job), and it is impossible to prevent the model from \emph{incorporating} the
> secret into tokens and plans (uncontrollable again). What is possible --- exactly and only
> --- is to gate every controllable egress channel out of the room, with taint recorded from
> the moment of exposure. Gate the channel, never the token.

"Gate every controllable egress channel" is $f:\overline{L}\to2^{\Sigma_c}$ — the supervisor
of L128–130 — not a change to what is physically possible. A `grep` for
plant/physical/shrink language across paper2 (L84, 122, 129, 152, 159, 163, 172, 182, 199,
217, 219, 224, 257, 294, 309, 322, 342, 401) returns no passage anywhere in the paper that
proposes restricting $L$ as a governance move. The review asserted a mechanism paper2 does
not describe.

(Paper 4 *does* use the lever — "The job then runs with no ambient network or credentials"
(paper4 L82) makes egress physically impossible rather than refused — but paper2 never says
so, so it cannot be cited as paper2 contradicting itself.)

**Terminological note.** The review calls $\bar{L}$ "the label set." It is the prefix closure
of the plant language. Reusing that phrasing in a fix note would introduce a new error.

**Steelman that partly rescues the sentence.** For the events that actually matter — the
$\Sigma_u$ members that produce every detect-only verdict — the plant lever is largely
unavailable: you cannot run an LLM and make `internal_plan` physically impossible. Under the
paper's stated modelling choice ($L=\Sigma^*$ fixed), widening $\Sigma_c$ genuinely *is* the
only remaining dial, and the sentence's contrast target ("no policy-language cleverness
does") is correct. But there are real, non-degenerate counterexamples the sentence excludes:
never loading the secret into the room at all makes `in_context_read(secret)` physically
impossible and regiments the compound policy of §6 with no supervisor at all; likewise a job
with no filesystem mounted. Those are governance levers, they are neither policy-language
cleverness nor channel ownership, and they grow the regimentable set.

### What this means for the fix

Small and local — one qualifying clause, not a rewrite. Something of the shape:
*"Holding the plant fixed, widening $\Sigma_c$ (owning more channels) is the only way to grow
the regimentable set; no policy-language cleverness does. (The other dial is the plant itself
— an event that never becomes physically possible needs no supervisor — which is why data
minimization and capability removal are governance moves and not merely hygiene.)"*

Do **not** justify the fix by pointing at §6; §6 is clean. Point at the theorem box's
$\overline{L}$ and at L219/L309, where the paper's own negative verdicts are already stated
as plant-relative.

---

## paper2 A20(ii)

> Claim under test: boundary items (iii) and (vi) (L402–410) contradict each other — (iii)
> licenses moving `model_emit_token` into $\Sigma_c$, at which point "never emit a false
> token" becomes a controllable prohibition, falsifying (vi). The real obstruction in (vi) is
> not controllability but that "confident falsehood" is not a decidable predicate over the
> event alphabet.

**Verdict: PARTIALLY-CONFIRMED.** The contradiction is real and is in fact *sharper* than the
review states. But the review's second half — that the paper misses the
controllability-vs-decidability distinction — is **refuted**: boundary item (iv) and §9 draw
exactly that distinction, one item above (vi) in the same box. The defect is that (vi) does
not use the reason the paper already owns.

### Evidence

The two items, verbatim (L402–410):

> (iii) The classification is relative to the alphabet split: a runtime that gates model steps
> (e.g.\ token-level filtering with the model inside the boundary) changes $\Sigma_u$ and
> re-grades the table --- the theorem is a functor from architectures to boundaries, not one
> fixed verdict. (iv) The full-observation assumption is essential: policies whose triggers
> are unwitnessed internal state fall to the Lin--Wonham refinement (\S\ref{sec:partial}) even
> when their prohibitions are controllable. (v) The checker verifies the stated policy
> automata over the stated alphabet [internal, \texttt{b3\_controllability.py}]; it is a
> faithful implementation of the test, not a mechanized proof of the theorem --- an
> Isabelle/Coq formalization remains the submission gate. (vi) Prevention governs
> \emph{effects}, never \emph{semantics}: no widening of $\Sigma_c$ ever makes a confident lie
> preventable, because the lie is constituted, not merely caused, by uncontrollable events.

Restated a second time in §11 (L353–354): "which is why widening $\Sigma_c$ can never make a
confident lie preventable (boundary~(vi)), a corollary a clock-tick model cannot state."

**Why the tension is real, and where it actually bites.** The table row (L208–210) models the
confident lie as one event: "forbid \texttt{internal\_plan} (``confident lie'') &
uncontrollable & no (detect only)". Item (iii) says gating model steps "changes $\Sigma_u$
and **re-grades the table**." `internal_plan` is a model step and is a row of that table. So
(iii)'s general clause says the confident-lie row is re-gradable; (vi) says it never is.
Direct collision, on the paper's own artifact.

**The strongest defense available, and how far it goes.** §11 stipulates the architecture out
of reach (L377–379):

> separating regimentation of an agent's \emph{mental states} (possible only when the agent is
> a white box) from regimentation of its \emph{actions} (the black-box case)~\cite{balke09}.
> An LLM agent is the black-box case, and $\Sigma_u$ is the formal content of its
> black-boxness.

If `internal_plan` is permanently in $\Sigma_u$ by stipulation, and "confident lie" ≡
`internal_plan`, then (vi) survives (iii), because (iii)'s worked example is *token-level*
filtering, which touches `model_emit_token`, not `internal_plan`. This is a real defense and
the review does not consider it. It is also self-undermining: it makes (vi) close to
analytic — "for splits that leave the constitutive events uncontrollable, the lie stays
unpreventable" — while (vi) is phrased with an unrestricted universal ("**no** widening of
$\Sigma_c$ **ever**").

**Where the defense fails, and it is the paper's own design rule that breaks it.** §6, L263–265:

> A compound trigger$\to$effect policy is regimentable iff its \emph{effect} events are
> controllable; the trigger may be as uncontrollable as it likes, provided the policy observes
> rather than forbids it. Uncontrollable events in the policy's \emph{condition} are free;
> uncontrollable events in its \emph{prohibition} are fatal.

The governance rule §1 actually states is not "never form a false belief" — it is (L35–36)
"\emph{no confident falsehoods in status reports}." A status report is an *utterance*: it
leaves through `model_emit_token` and then through `api_call`/`fs_write`/`net_egress`, all of
which are already in $\Sigma_c$ (L116–117). Under (iii)'s licensed architecture the effect
event is controllable and the trigger is merely observed, so by §6's own design rule the
policy is regimentable — the lie is conceived but never uttered. So (vi) contradicts §6's
design rule even without touching `internal_plan`, and even under the black-box stipulation.

**The review's diagnosis is right about the true obstruction — and wrong that the paper
missed it.** Item (iv), one line above (vi), is precisely "the prohibition is controllable but
the runtime cannot decide the gate condition." §9 works the example out in full (L320–326):

> Observability strictly shrinks the regimentable set: a policy like ``no egress after the
> model \emph{considered} exfiltration'' references unmediated internal \emph{state} with no
> observable taint transition, so even though its prohibition (egress) is controllable, no
> supervisor can implement the gate condition. The practical reading: a compound policy is
> deployable only if its trigger is \emph{witnessed at the mediation boundary} [...] taint must
> be an event the daemon sees, not a state it infers.

Substitute "considered exfiltration" → "is asserting something false" and §9 *is* the correct
account of the confident-lie boundary. Paper 4 states the same obstruction in the sibling
form and calls it by name (paper4 L413–414): "\emph{never negotiate over ``does this output
contain a secret'' --- negotiate over channel capacity.} The first question is undecidable in
practice for prose." So the program owns the right reason in two places; (vi) reaches for
"constituted, not merely caused" instead, and the word "semantic" in the §7 slogan (L228–229,
"a confident lie in a status report is semantic, uncontrollable") is the only gesture toward
it in paper2's body — where it is coordinated with, rather than distinguished from,
"uncontrollable."

### What this means for the fix

Rewrite (vi)'s *reason*, not its verdict — the verdict is right, its stated ground is not.
Roughly: *"(vi) Prevention governs effects, never semantics — but the obstruction is
observability, not controllability. Even a runtime that gates emission (iii) cannot regiment
'no confident falsehood', because 'is false' is not a predicate over the event alphabet: the
trigger is unwitnessed internal state, so this falls to (iv) and §9, not to the box's
inequality."*

Then delete or requalify the §11 restatement at L353–354, which repeats the wrong ground and
attaches it to the Basin-et-al. positioning claim. Note the positioning point that L353–354
is making — that a clock-tick uncontrollable model cannot state this corollary — survives
under the corrected reason, but only if the corollary is restated in observability terms
first.

Cross-paper consistency win available at no cost: paper4's L413–414 already carries the right
sentence for the secret-detection case, so the fix aligns the two papers rather than adding a
new claim.

---

## paper4 A21(i)

> Claim under test: the voting-booth analogy (L152–155) asserts a poll-watcher "learns exactly
> the declared aggregate and nothing about any ballot," while the same analogy's figure caption
> already states a leaky residual for the degenerate one-voter case — so a reader can derive a
> false fact ("nothing about any ballot," unconditionally) directly from the analogy as stated.

**Verdict: PARTIALLY-CONFIRMED, and the strong form is REFUTED.** The body/caption asymmetry
is real and worth one clause of repair. The claim that a reader "can derive a FALSE fact
unconditionally from the analogy as stated" does not survive reading the rest of the same
paragraph, which preempts exactly this misread.

### Evidence

Body, L152–158 (the review's citation is L152–155; the sentence that refutes the strong form
is L157–158, in the same paragraph):

> The analogy with teeth is the voting booth: the turnstile clicks once per voter and the
> tally board shows only party totals; a poll-watcher outside learns exactly the declared
> aggregate and nothing about any ballot, \emph{no matter how long she watches or in what
> order voters arrive}. That is noninterference \emph{modulo declassification} in the
> Goguen--Meseguer lineage [...] Figure~\ref{fig:r9rel} draws the mapping by relations, not
> surface features. **The misread to preempt: the theorem does not say the slot is safe --- it
> says the slot is the \emph{only} opening; whether the declared function $g$ releases too much
> is a contract question the next two pillars price.**

Caption of `fig-r9-relation.tex` (`\label{fig:r9rel}`), verbatim, final sentence:

> Relation-map for Pillar I. The voting booth maps to the sealed workroom by \emph{relations},
> not surface features: booth walls $\to$ attested isolation (no observation of the work); the
> tally board $\to$ the declassification gate (the sole declared release); ``watching all day
> reveals no ballot'' $\to$ two-run observational equivalence under every interleaving. The
> analogy predicts, correctly, that the residual risk is a too-revealing tally --- a
> per-precinct board with one voter is a leaky $g$.

**Three independent reasons the strong form fails.**

1. *The body's own italic quantifier scopes the claim.* "no matter how long she watches or in
   what order voters arrive" tells the reader exactly which dimensions the invariance is
   asserted over — duration and interleaving. It is not asserted over tally granularity or
   precinct size. That is the correct possibilistic reading, and it maps exactly onto Theorem
   1's quantifier ("For secrets $s,s'$ and \emph{every} action sequence", L165–166).
2. *The paragraph preempts the exact misread three sentences later.* "whether the declared
   function $g$ releases too much is a contract question the next two pillars price" is the
   one-voter case, in the formal vocabulary. The caption is not the only fence; it is the
   second fence.
3. *The caption is not in tension with the body's claim, it is in tension with its
   emphasis.* The caption says the analogy "predicts, correctly" the residual — i.e. the
   caption treats the leaky-$g$ observation as a *success* of the analogy, not a correction
   of it. That is a defensible authorial position, and the review reads the caption as
   conceding an error the caption does not concede.

**What genuinely remains.** Under a quantitative (min-entropy) reading — the reading §7 uses
for the $q\cdot b$ account — "nothing about any ballot" is false even for a normal precinct
(a 100–0 tally reveals every ballot). The paper is possibilistic by declaration (L198–199:
"The guarantee is possibilistic --- timing, token counts, and termination channels are out of
model"), so the sentence is correct in its own frame, but the frame switch between §3 and §7
is exactly where a reader gets hurt. And the fence lives in the caption and in an abstract
"the declared function $g$" — never in the analogy's own vocabulary in body text, which is a
craft gap given the analogy is the section's on-ramp.

### What this means for the fix

Minimal: one clause inside the analogy sentence, in the analogy's vocabulary. E.g.
"…a poll-watcher outside learns exactly the declared aggregate and nothing more about any
individual ballot **than the aggregate itself implies**, *no matter how long she watches or in
what order voters arrive*." That closes the one-voter case in body text and keeps the caption
as reinforcement rather than as the sole fence.

Do **not** write the fix note as "the body contradicts the caption" — it does not; the caption
is a deliberate extension. Write it as "the body's fence is stated abstractly ($g$ releases
too much) and never in the analogy's own terms, so the analogy leaves the ground before the
fence arrives."

---

## paper4 A21(ii)

> Claim under test: "The scene, resumed. Derek's data never leaves the room" (L275) is stated
> as unconditional fact, while §8 says "'zero' is available only at $b=0$" and §7 prices
> $q\cdot b$ bits of egress explicitly — so "never leaves the room" is an overclaim by
> imprecision.

**Verdict: REFUTED.** The qualification the review says is missing is in the same sentence,
after the semicolon. The review appears to have quoted the sentence at the semicolon.

### Evidence

L275–276, complete sentence:

> \textbf{The scene, resumed.} Derek's data never leaves the room; what leaves is a stream of
> gated releases, each carrying a differential-privacy cost $\varepsilon_i$.

The independent clause after the semicolon states precisely the §7/§8 position: what leaves is
metered releases, each with a priced cost. The sentence draws exactly the distinction the
review says it collapses — *the dataset* does not cross the boundary; *bounded, gated,
costed releases* do. It is a contrast construction, not an absolute.

The cited counter-passages do not counter it:

- §7, L403–406: "If an Erin-visible channel permits $b$ freely chosen bits per job, a
  malicious worker can exfiltrate up to $b$ bits through it --- the noninterference theorem
  guarantees only that those bits pass through the declared gate, not that they are innocent.
  Across $q$ jobs the raw capacity is $q\cdot b$ bits" — this prices the *releases*, i.e. what
  L275's second clause names. Consistent.
- §8, L428–429: "\textbf{Zero data leakage with arbitrary natural-language telemetry to
  Erin.} That channel is the $q\cdot b$ budget of \S\ref{sec:budget}; ``zero'' is available
  only at $b=0$." — this denies *zero leakage through the telemetry channel*, which is a claim
  about the release stream, not about the dataset crossing the boundary. Consistent.

A `grep` for `leave|leaves` across the whole of paper4 returns exactly two hits (L132, L275);
the phrase never recurs unqualified anywhere else, in the abstract, or in §11's closing
formulation, which is the audited one (L495–496): "the replacement of ``taint analysis
prevents exfiltration'' and ``mathematically cannot phone home'' with the claim that is weaker
in form and true: \emph{bring the encrypted agent to the encrypted data, and every release is
explicit, gated, and bounded.}"

**The one residual worth recording, which is not the review's point.** L275 opens a
"\textbf{The scene, resumed.}" narrative beat and is therefore the most quotable sentence in
the section — and its first six words are structurally in the same family as the sentence §1
bans outright (L41–42: "declare that the data ``mathematically cannot phone home.'' This
paper's first job is to explain why that sentence must never be shipped"). The *paper* is
correct; the *pull-quote* is a liability, and this paper's stated discipline is that its own
banned-phrase list is essential.

### What this means for the fix

No correctness fix is owed. If anything is done at all, it is a pull-quote-hardening edit —
promote the qualifier into the same clause, e.g. "Derek's data never leaves the room in bulk;
what leaves is a stream of gated releases…" — and it is optional. A fix plan that lists this
as a substantive overclaim should drop the item, and should not cite §7/§8 against L275,
because they agree with it.

---

## paper4 A21(iii)

> Claim under test: token-level taint unsoundness is asserted as fact in §1 and separately
> called "a stated unsoundness result" in §10, with nothing resolving the discrepancy in
> between — in a paper that promises at L111–112 to label every important statement as
> theorem / design-invariant / model-checked-property / empirical-hypothesis and never let one
> impersonate another.

**Verdict: CONFIRMED on substance, with a corrected diagnosis.** The labeling-promise
violation is real, essential, and worse than the review states — it recurs three times, not
twice, and carries neither a label nor a citation nor a provenance tag anywhere. But the
specific §1-vs-§10 "discrepancy" the review names is thin, and a fix note built on it would be
easy to rebut.

### Evidence

The promise, L110–112:

> These are design invariants backed by implementation and tests, not theorems; the program's
> discipline is to label every important statement as theorem, design invariant, model-checked
> property, or empirical hypothesis, and never let one impersonate another.

And the companion provenance discipline, L58–60:

> Every number carries a provenance tag: [verified] means externally recomputable (a textbook
> value or a closed form restated in the box); [internal, \emph{script}] means it regenerates
> from the named self-contained script at seed 20260816, shipped with the paper.

**All three occurrences of the claim, verbatim.**

§1, L43–45 — flat assertion, no label, no citation:

> Token-level taint through an LLM is not soundly definable: the model taints everything it
> writes with everything it read, so a taint tracker faces a binary choice between marking
> every output token (useless) and missing semantic flows (unsound).

§4 / Pillar II, L248–250 — reasserted as a premise, still unlabeled, and now doing essential
work for the design:

> Whole-worker taint is exactly what the theorem licenses: since token-level taint through an
> LLM is not soundly definable, the sound over-approximation is to taint \emph{everything}
> after the first secret read and spend all enforcement budget on the one boundary where
> enforcement is possible.

§10, L490–492 — named as the justification for one of the paper's two novelty claims:

> and we justify whole-worker taint not by engineering tractability but by a stated
> unsoundness result: token-level taint through a generative model forces a choice between
> marking every output token and missing semantic flows, so the sound over-approximation is
> the worker.

It is also in the abstract (L20–21: "the security boundary is the declassification gate, not
token-level taint") and in the whole-worker-taint design paragraph (L95–97).

**Why the labeling violation is genuine and not pedantry.** By the paper's own accounting this
is an *important* statement: §10 makes it one of exactly two things that are new
("What is ours is the adaptation of that design to \emph{tool-using LLM agents}, and the
assurance schedule the adaptation forces," L487–488), and the four-pillar table (L114–129)
assigns a verification method and an artifact to every other central claim in the paper.
This one has none. It is not a theorem (no statement, no proof), not a design invariant (not
in the L106–110 list), not a model-checked property (no script; the reproducibility section at
L500–506 enumerates the three scripts and this is not among them), and not tagged as an
empirical hypothesis. It falls into none of the four buckets, which is exactly the failure
mode L111–112 promises to prevent.

The contrast with the paper's own behaviour elsewhere is stark and is the strongest evidence:
this paper is unusually scrupulous about attribution — it retro-cites `sm03` for delimited
release, `rruv16` for the privacy filter, `wrrw23` for adaptive composition, `ryoan16` for the
design itself ("Any reader who knows that paper should be told so in this one," L484). The
taint claim is the single essential assertion in the paper with no citation, no label, and
no artifact.

**Where the review overreaches.** "Called a 'stated unsoundness result' in §10, with nothing
resolving the discrepancy in between" treats §10's "stated" as a downgrade of §1. Read
adversarially, "a stated unsoundness result" is at least as naturally a *back-reference*
("the unsoundness result stated earlier") as a hedge ("merely asserted"). Under the
back-reference reading there is no §1↔§10 discrepancy at all. The review's framing therefore
has an easy rebuttal, and a fix note that leans on it invites one.

The intermediate occurrence at L248–250 that the review missed is the better evidence: it
shows the claim being *used as a premise* between the two cited passages, unlabeled, which is
what makes the omission structural rather than a single loose sentence. It also refutes the
"nothing in between" phrasing in the review's favour — there *is* something in between, and it
compounds the problem rather than resolving it.

### What this means for the fix

Two options, both cheap; the first is better.

1. **Label and cite it once, in §1, and let the other two occurrences inherit.** The claim's
   honest category is a design rationale resting on an *empirical hypothesis* about generative
   models plus a well-known static-analysis result (label creep / implicit-flow
   incompleteness). One sentence: "[empirical hypothesis; no formal statement is offered
   here] Token-level taint through an LLM is not soundly definable: …". If the literature
   supports a citation for the underlying implicit-flow point, adding it brings this claim up
   to the standard the rest of the paper already meets.
2. If the owner believes it *is* provable, it needs a box, a statement, and a section — which
   is a much larger change and would need its own boundary block.

Either way, make §10's "a stated unsoundness result" unambiguous — "the unsoundness claim
stated in §1 (empirical hypothesis, not a theorem)" — so the phrase stops carrying two
readings. And check the abstract (L20–21), which asserts the corollary with no hedge at all.
