# Literature review: Part II, "The Cost of Seeing" (Chapter 4, The Legible Swarm)

Method note: a citation marked **[verified]** was confirmed this session via a real
web/paper search (author, venue, year, DOI/URL seen). A citation marked **[as cited]**
is one the chapter itself already cites with plausible, internally consistent
metadata; I did not re-search it, so I do not claim verification, only that it is not
newly invented by me. Nothing below is fabricated; where a search found nothing, I say
so.

## Verdict

Part II stands on firmer ground than most "AI coordination" whitepapers, for a
specific reason: the author has already done much of the literature review. The
chapter's own "Related work" section cites Bainbridge, Endsley, Lee & See, Green &
Swets, Wickens, Miller, Mackworth, Warm/Parasuraman, Pirolli & Card, FIPA, EigenTrust,
Erlang, and Scott/Hayek/Hobbes/Locke/Hume/Hirschman — most of the right literature for
a human-factors-plus-mechanism-design treatment of supervised autonomy. Every one of
these I independently checked (Bainbridge 1983, Endsley 1995, Green & Swets 1966,
Miller 1956, Wickens 2002, Kamvar et al. 2003, FIPA00023, Dorfman 1943,
Sleator–Tarjan 1985, Young's Landlord, Spence's signaling model) resolved to real,
correctly dated work. The four new mathematical claims — the information floor, the
comonotone split-digest/split-ranker theorem, the derived regret head, and the
zoom-advantage bound — import classical machinery (covering bounds, Dorfman/Hwang
group testing, a textbook Bayes-risk test) that the chapter is honest about not having
invented, while the specific combinatorial packaging appears new.

Where the chapter is weakest is in what it does not cite. It never engages Sheridan's
levels-of-automation taxonomy or Parasuraman–Sheridan–Wickens (2000) — the single most
relevant supervisory-control framework for the consent-grant/auto-land mechanism it
builds from Hobbes instead. It does not engage naturalistic decision-making (Klein) as
a counter-tradition to its Bayesian operator model. Its "one scalar cannot serve two
readers" theorems, while apparently novel in this application, are an instance of
40-year-old comonotonicity theory (Schmeidler 1989, Yaari 1987) under a new name. Its
costly-escalation threshold is, by its own admission, "the Spence mold" — yet never
cites Spence (1973). And its context-paging result is structurally close to the
"algorithms with predictions" literature (Lykouris & Vassilvitskii 2018), which it
does not engage. None of these omissions falsifies a claim; each is a place an expert
would say "you rediscovered X" rather than "you are wrong." The chapter's own
honest-boundary apparatus already flags most of the technical caveats a referee would
raise (oblivious vs. adaptive adversaries, calibration obligations, i.i.d. modeling
assumptions), which is unusual candor and the main reason this review lands mostly on
"known result restated" or "novel, narrowly tested" rather than "wrong."

---

## 1. The information floor: log₂C(N,k) − log₂C(m,k)

**What the book claims.** Theorem 6.1 (§6): any digest guaranteeing zero misses of a
critical k-subset among N artifacts, opening at most m, needs ≥ log₂C(N,k) − log₂C(m,k)
bits. Marked **Verified**, credited as Theorem 1 of the companion paper *The Price of
a Summary*, backed by a pre-registered falsification sweep (0/16 violations).

**Other names.** Information theory's **covering-code / sphere-covering bound**;
group testing's standard **counting lower bound**; the same counting argument
Berlekamp used for the **Rényi–Ulam liar game**.

**Prior work.** R. Dorfman, *Annals of Mathematical Statistics* 14(4):436–440, 1943
**[verified]** — pooled testing and its counting analysis. F. Hwang, *JASA*
67(339):605–608, 1972, and Du & Hwang, *Combinatorial Group Testing and Its
Applications* (2000) **[as cited]** — generalized binary splitting matching the
counting bound to a constant. The Rényi–Berlekamp–Ulam searching-with-lies game
**[verified via search]** uses the identical `2^q ≥ Σ C(m,j)` counting move. Cover &
Thomas, *Elements of Information Theory* (2006) **[as cited]** — the classical
ancestor formalism.

**How it differs.** A direct restatement of the Dorfman/Hwang counting bound in new
vocabulary (digest = encoder, review budget = decoder output). The companion paper
says so itself: "None of the group-testing machinery here is new mathematics." The
chapter's own contribution is the application framing, the paired zoom-cost result
(idea 5), and the falsification sweep — diligence group-testing theory never needed
because the bound is a two-line proof.

**Pushback.** A group-testing theorist would want Dorfman/Hwang in the main chapter's
own bibliography, not just the companion paper's; would note the model assumes a
worst-case, data-independent decoder (a valid but conservative bound, as the paper's
own boundary section admits); and would ask whether the floor survives an adversarial
(rather than random/noisy/oracle) encoder — the liar-game literature's actual subject,
which the chapter raises only as an open problem (6.5).

**Verdict: firm, but a restatement.**

**Reading list.** Dorfman (1943); Hwang (1972); Du & Hwang (2000); Cover & Thomas
(2006); Rényi–Berlekamp–Ulam liar-game surveys.

---

## 2. The split-digest theorem / comonotone characterization

**What the book claims.** Theorem 8.1 (§8.2): no single compaction can minimize both a
successor agent's continuation loss and an operator's oversight loss. Marked
**Proved** as an instance of the companion paper's Theorem 2: a scalar head serves two
readers iff their preference orders are **comonotone**; the joint zero-miss floor is
super-additive (≈2.13×, not 2×).

**Other names.** Decision theory: **comonotonicity** / comonotonic-independence, from
rank-dependent utility and Choquet-expected-utility theory. Multi-objective RL/RLHF:
the well-documented **limits of linear scalarization** for non-convex Pareto fronts.
Loosely, the *shape* of **Arrow's impossibility theorem** (a different theorem, same
family of "no single aggregate respects two disagreeing orders").

**Prior work.** D. Schmeidler, *Econometrica* 57(3):571–587, 1989, and M. Yaari,
*Econometrica* 55(1):95–115, 1987 **[verified]** — comonotonicity's defining property
(acts that "move together," admitting no hedge) is exactly what the chapter's crossing
pair violates. Multi-objective-RL scalarization-limit papers (2024–26 vintage)
**[verified via search, fragmented literature, no single founding citation found]**.

**How it differs.** The proof structure *is* the comonotonicity argument, derived from
scratch rather than from Schmeidler/Yaari's axioms — mathematically fine, but the
chapter is unaware it is re-deriving a named 1980s decision-theory concept. The
super-additivity pricing (2.13×, unbounded in k) is the apparently original part.

**Pushback.** Name the axiom: "comonotone" carries 35 years of risk-measure and
ambiguity-aversion literature the chapter doesn't cite. The 2.13× figure is
regime-specific (a particular N,k,m and loss pairing), not a universal constant — the
chapter is careful about this itself.

**Verdict: known result restated, with an apparently original pricing.**

**Reading list.** Schmeidler (1989); Yaari (1987); multi-objective RL/RLHF
scalarization-limits literature.

---

## 3. The split ranker: discovery-fit vs. operator-regret

**What the book claims.** Theorem 7.1 (§7.3): no monotone transform identifies
discovery fit with operator regret-if-ignored. Marked **Proved**, an instance of idea
2's theorem applied to a second reader pair.

**Other names.** IR/recsys: **relevance ranking vs. risk/anomaly ranking as distinct
objectives** — routine practice in fraud/trust-and-safety pipelines, which run a
separate risk model rather than reuse the relevance ranker. Learning-to-rank:
**multi-objective / multi-stakeholder ranking**.

**Prior work.** The industrial pattern is widely practiced but largely
unpublished/proprietary; I could not, after a real search, find one canonical academic
paper stating this exact claim as a theorem — it is closer to received practitioner
wisdom, independently re-derived by many teams, than to a citable origin. The formal
ancestor is again Schmeidler/Yaari comonotonicity (idea 2).

**How it differs.** A second instance of the same impossibility (the chapter says so
explicitly). The more useful move in this section is the **decision-theoretic
derivation of the regret head** (idea 4), which is the real contribution here.

**Pushback.** An IR engineer would find the theorem unsurprising — production systems
have separated these rankers for a decade — and would ask why it needed a formal
proof rather than a design note.

**Verdict: known result restated; the practically useful content is adjacent (idea 4).**

**Reading list.** Same as idea 2; no canonical recsys citation located (itself a
finding — practitioner knowledge here runs ahead of the academic literature).

---

## 4. The derived regret head: stakes × irreversibility × anomaly as a likelihood-ratio test

**What the book claims.** The product form is the Bayes-optimal surfacing rule iff
anomaly is a calibrated posterior; the decision rule is a classical likelihood-ratio
threshold (companion paper Theorem 3; also Def. 5.1's SDT-spined objective).

**Other names.** Statistical decision theory's **Bayes-risk / Neyman–Pearson
likelihood-ratio test**. Sequential analysis: **Wald's Sequential Probability Ratio
Test (SPRT)**, the natural extension to a repeated-observation setting (directly
relevant to the chapter's Inception Canary and escalation designs, which are
structurally repeated hypothesis tests). Signal detection theory (already cited): the
d′/β framework this Bayes-risk rule underlies.

**Prior work.** A. Wald, *Sequential Analysis*, Wiley (1947) **[verified via search]**
— SPRT, optimal expected sample size under fixed error-rate constraints. Green &
Swets (1966) **[verified]**, already correctly cited. Standard graduate
statistical-decision-theory material (Neyman–Pearson lemma).

**How it differs.** The chapter is fully candid: "textbook decision theory... the
contribution is the exact identification of the folklore product form with it and the
resulting calibration obligation." Accurate self-assessment; naming the calibration
obligation precisely is a real, if narrow, contribution.

**Pushback.** A statistician would ask why this is framed as single-shot
(Neyman–Pearson) rather than explicitly Wald-sequential, given that operator
oversight is a stream, not a snapshot — Wald's framework gives sharper, time-varying
thresholds and optimal-stopping guarantees the single-shot framing lacks. (The
research program elsewhere references "canary/SPRT detection power," suggesting the
connection is known internally but not surfaced in this chapter.)

**Verdict: firm — correct, honestly labeled textbook decision theory; missing an
explicit link to sequential analysis.**

**Reading list.** Wald (1947); Green & Swets (1966); any graduate decision-theory text.

---

## 5. The digest-zoom Pareto frontier and the zoom-advantage theorem

**What the book claims.** A two-constraint rate–distortion program R(δ,f) (misses
priced separately from flag rate) has a closed form for Bernoulli sources; adaptive
halving finds k criticals among F flagged items in ≤ 2k⌈log₂(F/k)⌉+4k group opens
(≥12.5× advantage at F,k=2500,10). Marked **Verified**.

**Other names.** Group testing's **adaptive group testing with a two-sided error
budget** — precisely Hwang's territory, as the companion paper itself says. Rate-
distortion theory's **two-constraint (false-negative, flag-rate) lossy coding** —
flagged by the companion paper as a custom formulation, positioned against expansion
coding for continuous sources (Si, Koyluoglu & Vishwanath, arXiv:1308.2338, 2013) and
a 2026 rate-distortion-classification paper (arXiv:2601.11919) that postdates this
review's ability to verify it **[unverified]**.

**Prior work.** Hwang (1972); Du & Hwang (2000) — generalized binary splitting already
achieves a tighter constant than the chapter's plain-halving procedure; the companion
paper admits "plain halving pays a factor 2+o(1) over Hwang."

**How it differs.** The zoom bound is explicitly *not* a new group-testing algorithm —
it is the worst-case constant for the specific (simpler, suboptimal-by-a-known-factor)
procedure the architecture runs, proved tight. The R(δ,f) formulation is the more
genuinely novel piece, with an appropriately humble "not found ≠ proven absent"
caveat.

**Pushback.** A group-testing specialist would ask why not just use Hwang's better
constant. An information theorist would note the chapter's own worked example (p=0.05)
falls *outside* the window where its own two stages compose profitably (f≥12(p−δ)) —
a genuinely interesting tension the chapter surfaces rather than hides.

**Verdict: firm on the zoom bound (correct, intentionally suboptimal constant); the
R(δ,f) formulation is novel and unverified against the wider literature.**

**Reading list.** Hwang (1972); Du & Hwang (2000); Si, Koyluoglu & Vishwanath (2013).

---

## 6. The costly-escalation threshold and the debit band

**What the book claims.** A threshold equilibrium exists and is unique (§4.4, marked
**Verified**): agents escalate iff u ≥ u*(δ), "the Spence mold." The feasible debit
set [δ_min, δ_max] can be empty.

**Other names.** Economics: **costly signaling / separating equilibrium**, exactly
Spence's (1973) job-market-signaling structure — named informally by the chapter, but
Spence is absent from its 50-item bibliography. Process safety: **alarm
rationalization** (ANSI/ISA-18.2, correctly cited). Clinical engineering: **alarm
fatigue** (Cvach 2012, correctly cited). Security's **canary tokens / honeytokens** —
a structural cousin (rarity-dependent, low-false-positive tripwires), documented in
industry/gray literature rather than peer review.

**Prior work.** M. Spence, "Job Market Signaling," *QJE* 87(3):355–374, 1973, DOI
10.2307/1882010 **[verified]** — the founding costly-signaling result the chapter's
threshold equilibrium matches exactly, uncredited. ISA-18.2 and Cvach (2012) **[as
cited]**. Canary-token/honeytoken security literature **[verified to exist; no single
canonical peer-reviewed citation found]**.

**How it differs.** The clearest unattributed restatement in the chapter: standard
signaling-game machinery, acknowledged in prose ("the Spence mold") but not in the
bibliography, even though far less directly relevant political theorists (Locke, Hume)
are cited in full.

**Pushback.** A microeconomist would want the citation, and would ask whether
equilibrium selection (why separating rather than pooling) is addressed — it isn't;
the chapter treats it as a parameter-fitting problem, defensible for engineering but
leaving a real game-theoretic question open.

**Verdict: known result restated, uncited.**

**Reading list.** Spence (1973); ISA-18.2; Cvach (2012).

---

## 7. The specialization boundary: Erlang-C queueing threshold

**What the book claims.** Theorem 4.1 (§4.3): sole ownership weakly dominates a
pooled team iff the skill-premium ratio clears g_A(ρ,c), an Erlang-C-based threshold.
Marked **Verified — corrected**: an earlier draft's threshold was falsified by a
two-thousand-point simulation sweep and replaced, with the wrong form left visible on
the page.

**Other names.** Queueing theory's **M/M/1 vs. M/M/c staffing comparison** and the
**Erlang-C formula**; operations research's **generalist-pool vs. specialist-silo
trade-off** and pooling-gain / square-root staffing literature.

**Prior work.** Erlang's 1917 telephone-traffic work and D. Kendall, *Annals of
Mathematical Statistics* 24(3):338–354, 1953 (A/S/c notation) **[as cited;
well-established, not independently re-searched]**. The pooling-gain result itself is
decades-old, mature operations research.

**How it differs.** The chapter's most candidly self-correcting result: an earlier,
plausible-looking threshold is stated, shown wrong "in both directions" by simulation,
and replaced — unusual honesty. The corrected formula adds an accountability-value
term A to the classical trade-off, a reasonable incremental extension, not a
challenge to Erlang-C.

**Pushback.** A queueing theorist would ask about the Poisson-arrival,
exponential-service, FCFS, mean-cost assumptions — plausibly wrong for bursty
coding-agent request patterns — and would want a sensitivity check against a more
realistic arrival process before trusting the boundary operationally.

**Verdict: firm — a correct, incremental, unusually candidly-corrected extension of
standard staffing theory; untested against real agent-fleet arrival statistics.**

**Reading list.** Erlang (1917); Kendall (1953); any queueing/call-center staffing
text on pooling gain.

---

## 8. Context paging under a corrupted pin oracle

**What the book claims.** Theorem 8.2 (§8.3): context compaction as virtual memory;
online paging cost satisfies the Sleator–Tarjan resource-augmented bound (extended via
Young's Landlord for weighted pages), plus an additive linear penalty when the pin
oracle is corrupted on a ψ-fraction of consultations (oblivious adversary,
repair-on-touch). Marked **Verified — upgraded from proposed**.

**Other names.** Online algorithms' **k-server/paging competitive ratio** and
**weighted caching (Landlord)**. Most directly: **algorithms with predictions /
learning-augmented online algorithms** — an online algorithm consulting an untrusted
external oracle and degrading gracefully as its error grows is the defining question
of this subfield.

**Prior work.** D. Sleator & R. Tarjan, *CACM* 28(2):202–208, 1985 **[verified]**. N.
Young, "On-Line File Caching," *Algorithmica* / arXiv:cs/0205033 **[verified]** —
Landlord's k/(k−h+1) competitiveness. T. Lykouris & S. Vassilvitskii, "Competitive
Caching with Machine Learned Advice," *ICML* 2018 / arXiv:1802.05399 / *JACM* 2021
**[verified]** — the direct, uncited ancestor: a classical competitive caching
algorithm augmented with untrusted machine-learned predictions, with a competitive
ratio degrading smoothly (O(1+min(√(η/OPT), log k))) in the prediction error.

**How it differs.** The unweighted and weighted bounds are imported unchanged
(Sleator–Tarjan; Young). The new content — an additive ψN·c_refetch corruption term
under an oblivious, repair-on-touch model, checked by mechanized sweep — is
structurally very close to Lykouris–Vassilvitskii's problem shape but was apparently
derived independently, without that literature's vocabulary (consistency/robustness
trade-offs) or proof techniques.

**Pushback.** An online-algorithms researcher would ask why an *additive linear* term
rather than the *multiplicative, error-dependent* curves standard since 2018, and
would press on the oblivious-adversary restriction — the chapter's own honest-boundary
note admits "a stronger-than-greedy adaptive adversary remains untested," which is
exactly the hard case that literature exists to solve.

**Verdict: novel in this application; unaware of its closest and most relevant prior
art (Lykouris & Vassilvitskii 2018).**

**Reading list.** Sleator & Tarjan (1985); Young (Landlord); Lykouris & Vassilvitskii
(2018); the "algorithms with predictions" survey literature.

---

## 9. Legibility after James C. Scott, and métis

**What the book claims.** §3's "one law: digest-with-zoom" answers Scott's warning
that high-modernist over-legibility destroys métis — but the chapter's own pitfall box
concedes: "a read-path to the diff is more legibility, not métis."

**Other names.** Political science's **Scott's high-modernism thesis** (already cited)
and Austrian economics' **Hayek's dispersed/tacit knowledge** (already cited).
Organizational theory's **tacit vs. explicit knowledge** (Polanyi) and the **SECI
model** of knowledge conversion (Nonaka & Takeuchi) — a mature literature on exactly
the externalization problem the chapter's pitfall box flags as unsolved.

**Prior work.** Scott, *Seeing Like a State* (1998); Hayek, *AER* 35(4):519–530
(1945) **[as cited]**. M. Polanyi, *The Tacit Dimension* (1966) — "we know more than
we can tell." I. Nonaka & H. Takeuchi, *The Knowledge-Creating Company* (1995) — the
SECI framework for how tacit knowledge is (imperfectly) externalized.

**How it differs.** Scott and Hayek are correctly and centrally used, and the
chapter's self-critique (zoom is "more legibility, not métis") is exactly right by
Scott's own terms — a genuine strength. Missing is the 30-year organizational-
knowledge-management literature that has actually worked the externalization question
the chapter leaves open.

**Pushback.** A Scott reader would note Scott's thesis concerns *unwilling* subjects
with no exit, while the chapter's relation is consensual and revocable (idea 11) — a
structural difference the chapter does address in §`sec:consent-canon`.

**Verdict: firm restatement with honest self-limitation; missing the tacit-knowledge
literature (Polanyi, Nonaka & Takeuchi) most relevant to the open question.**

**Reading list.** Scott (1998); Hayek (1945); Polanyi (1966); Nonaka & Takeuchi (1995).

---

## 10. The operator's instrument: SDT, vigilance, trust calibration, situation awareness

**What the book claims.** §5 models the operator as an SDT decision-maker (Def. 5.1);
trust calibration must be function-specific (Lee & See 2004); vigilance decays within
20–35 minutes (Warm/Parasuraman/Matthews 2008; Mackworth 1948); situation awareness
needs projection, not just perception (Endsley 1995, 1995b); the "Bainbridge–Scott
convergence" names the abdication gradient (Bainbridge 1983).

**Other names.** Supervisory control's **Sheridan's levels of automation** — the
single most relevant prior art for the consent-grant mechanism, and absent. NDM's
**Klein's Recognition-Primed Decision model** — a counter-tradition to the chapter's
Bayesian framing, arguing skilled operators pattern-match rather than compute
likelihood ratios. Cognitive psychology's **cognitive load theory** (Sweller) —
adjacent to Miller's 7±2 (cited) but not connected to *format*, only bit-count.

**Prior work.** T. Sheridan & W. Verplank, MIT technical report (1978) **[verified]**
— origin of the ten-point levels-of-automation scale. R. Parasuraman, T. Sheridan, C.
Wickens, *IEEE T-SMC-A* 30(3):286–297, 2000 **[verified]** — four-stage automation
model (acquisition/analysis/decision/action), the natural formal home for the
consent-grant's scope/stakes-ceiling/reversibility-floor/TTL tuple; absent from the
chapter's 50-item bibliography. G. Klein, *Sources of Power* (1998); Klein et al.
(eds.), *Decision Making in Action* (1993) **[verified]**. Bainbridge (1983) and
Endsley (1995) **[verified, correctly cited]**.

**How it differs.** Individually correct citations; the gap is structural. The
consent-grant mechanism *is* a levels-of-automation selector in Parasuraman-Sheridan-
Wickens' exact sense, built from Hobbes and SDT instead of from the 25-year-old
framework built to answer this question.

**Pushback.** A supervisory-control researcher would ask "where is Sheridan?" A
naturalistic-decision-making researcher would argue the chapter's rational Bayesian
operator model is empirically contested as a description of skilled behavior under
time pressure, and that the chapter does not distinguish its normative claim (SDT is
a reasonable target) from a descriptive one (RPD is the better empirical model of
what "Mara" actually does).

**Verdict: firm on individual citations; exposed by the omission of
Sheridan/Parasuraman-Sheridan-Wickens and of naturalistic decision making.**

**Reading list.** Sheridan & Verplank (1978); Parasuraman, Sheridan & Wickens (2000);
Klein (1993, 1998); Bainbridge (1983); Endsley (1995).

---

## 11. Consent grant, inalienable override, and the legible-sovereign rule

**What the book claims.** §2 models operator-daemon authority as a Hobbesian covenant
amended with an inalienable override and a legible-sovereign rule; consent is a
concrete, scoped, revocable object ⟨scope, s_max, v_min, ttl, revocable⟩.

**Other names.** Computer security's **capability-based security** and **attenuated,
revocable delegation**. Distributed authorization's **macaroons** — bearer credentials
with contextual caveats that can only narrow, never widen, as they delegate — an
almost exact structural match, and coincidentally close to the mega-volume's own
front-matter proposition that "delegation only narrows" (a different chapter's claim).
Political philosophy's **social contract theory** (the chapter's own explicit frame).

**Prior work.** Hobbes (1651), Locke (1689), Hume (1748), Pateman, Hirschman (1970)
**[as cited]** — thoroughly and self-critically engaged. A. Birgisson et al.,
"Macaroons: Cookies with Contextual Caveats for Decentralized Authorization in the
Cloud," *NDSS* 2014 **[verified]** — the closest security analog, uncited.
Object-capability security literature (Miller's E language and successors) **[not
independently re-verified this pass, well-established]**.

**How it differs.** The political-theory engagement is thorough and unusually
self-aware — the chapter stages its own "legible-sovereign amendment" to Hobbes'
opacity and a regress critique of its own ranker as an opaque exercise of authority.
Missing is the computer-security framing of the identical object: 15+ years of
capability-security and macaroons literature already specify attenuation,
unforgeability, auditability, and revocation for exactly this mechanism, arriving at
compatible (mutually reassuring) conclusions by a different route.

**Pushback.** A capability-security researcher would ask why Hobbes rather than the
macaroon/object-capability literature, and would probe whether revocation here is
truly immediate and total or subject to the confused-deputy and
time-of-check/time-of-use pitfalls that literature documents — not discussed.

**Verdict: firm as political theory; independently corroborated (not contradicted) by
an unengaged capability-security literature that would sharpen the implementation.**

**Reading list.** Hobbes, Locke, Hume, Hirschman (as cited); Birgisson et al. (2014);
object-capability security literature.

---

## Table: ideas and verdicts

| # | Idea | Verdict |
|---|------|---------|
| 1 | Information floor, log₂C(N,k) − log₂C(m,k) | Firm, but a restatement of the classical group-testing/covering counting bound |
| 2 | Split-digest / comonotone characterization | Known result restated (Schmeidler/Yaari comonotonicity); super-additive pricing appears novel |
| 3 | Split ranker (discovery-fit vs. operator-regret) | Known result restated; same theorem as #2 on a second reader pair |
| 4 | Derived regret head (Bayes-optimal LR test) | Firm — correct, honestly-labeled decision theory; missing an explicit SPRT/sequential-analysis link |
| 5 | Digest-zoom Pareto frontier + zoom-advantage theorem | Firm on the zoom bound (a stated-suboptimal but correct constant); R(δ,f) formulation novel, unverified against wider literature |
| 6 | Costly-escalation threshold / debit band | Known result restated, uncited (Spence 1973 signaling) |
| 7 | Specialization boundary (Erlang-C) | Firm — correct, incremental, candidly self-corrected extension of staffing theory |
| 8 | Context paging under a corrupted pin oracle | Novel in application; unaware of its closest prior art (Lykouris & Vassilvitskii 2018) |
| 9 | Legibility after Scott, and métis | Firm restatement with honest self-limitation; missing tacit-knowledge literature (Polanyi, Nonaka & Takeuchi) |
| 10 | The operator's instrument (SDT, vigilance, SA, abdication) | Firm on citations; exposed by omission of Sheridan/PSW automation levels and naturalistic decision making |
| 11 | Consent grant, override, legible-sovereign rule | Firm as political theory; corroborated by an unengaged capability-security/macaroons literature |

## Terms the book coins privately that already have public names

- **"Legibility-with-zoom" / "digest-with-zoom"** — a covering-code message paired
  with a group-testing second stage, under new vocabulary.
- **The comonotone split-head theorems** — this is **comonotonicity**, a named
  decision-theory concept since the late 1980s (Schmeidler, Yaari).
- **"The Spence mold"** — the chapter names its own debt in prose but never cites
  Spence (1973) formally.
- **The consent-grant tuple** — a **capability with caveats**, in the sense of
  macaroons and the object-capability security model.
- **The "auto-land grant" / per-action-class autonomy scoping** — a **level of
  automation**, in the exact sense of Sheridan & Verplank (1978) and
  Parasuraman–Sheridan–Wickens (2000).
- **"Context paging with a corrupted pin oracle"** — an instance of **online
  algorithms with (untrusted) predictions**, the standard name since Lykouris &
  Vassilvitskii (2018).
