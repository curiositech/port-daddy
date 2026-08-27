# Findings — paper 4, "The Sealed Harbor"

**Dive run 2026-08-26.** Source read in full plus its four verification scripts.
No `.tex` file edited. Written up by the calling session; the agent was blocked
from writing report files.

## Verdict — `NARROW` overall, with **one boxed corollary `CONTRADICTED`**

The paper pre-concedes its theorems ("No single component theorem above is
ours"), which absorbs most prior-art pressure. What does not survive is the
*positioning*, and one corollary is false on the model the paper builds.

| Element | Verdict | Why |
|---|---|---|
| Theorem 1 (NI mod declassification) | `NARROW` | Is **delimited release** (Sabelfeld–Myers 2003), whose running example is literally `declassify(parity(h))`. Clause 2 is **gradual release** (Askarov–Sabelfeld 2007). |
| Theorem 2 (enforceability) | `NARROW` + defect | Inherits flag 2's Basin et al. exposure verbatim; the "iff" is false at $K=\emptyset$. |
| Theorem 3 (ε-conservation) | `NARROW` | Not DP composition — the object is Rogers et al.'s **privacy filter**, realised in PINQ (2009), scheduled in PrivateKube (2021). |
| **Corollary to Thm 3** | **`CONTRADICTED`** | Rogers–Roth–Ullman–Vadhan 2016 prove applying the DRV advanced-composition bound to an adaptively-parameterised budget filter **is invalid**. That is what the corollary does. |
| Theorem 4a/4b (canary, SPRT) | `CLEAR` | Standard statistics, correctly applied. One quoted number is a range presented as a law. |
| §budget ($q\cdot b$) design claim | `NARROW`→near-`SUBSUMED` | **Ryoan (OSDI 2016)** does the same accounting including the $\log_2 s$ timing-slot bit count. |

## The contradicted corollary — act on this first

Rogers, Roth, Ullman & Vadhan, *Privacy Odometers and Filters*, NeurIPS 2016
(arXiv:1605.08294, read in full; control test passed — `1605.99999` → 404).
Verbatim from their §1:

> We first prove that the heuristic does work for the **basic** composition
> theorem … **We then show that the heuristic breaks for the advanced composition
> theorem [DRV10].** However, we give a valid privacy filter that gives the same
> asymptotic bound … albeit with worse constants.

Paper 4's corollary *is* that heuristic. Their **Definition 3.1** (privacy
filter) is Theorem 3's release rule verbatim, and **Theorem 3.4** — not textbook
sequential composition — is what actually licenses the basic-composition half,
because the ledger serves heterogeneous adaptively-requested $\varepsilon_i$.

Scope, stated fairly: the corollary's worked case fixes $\varepsilon$ uniformly,
making $k$ deterministic, so the three quoted numbers are fine on that instance.
The defect is that it is offered as *the meaning of the conserved sum* in a
ledger explicitly built for adaptive concurrent spend. **The certificate is
claimed on a model strictly larger than the one it holds for.**

Fix: Whitehouse, Ramdas, Rogers & Wu, *Fully-Adaptive Composition in
Differential Privacy*, ICML 2023 (arXiv:2203.05481v3) — `verified` **2026-08-27,
full text read** (was `probable`, abstract only). Confirms the fix framing
holds: the paper "construct[s] filters that match the rates of advanced
composition, including constants, despite allowing for adaptively chosen
privacy parameters" — i.e. a privacy filter valid under exactly the adaptive
regime Paper 4's ledger needs and the DRV-substitution corollary wrongly
assumed. Safe to cite and quote the abstract-level claim; the full
construction (martingale-concentration machinery) is not needed for Paper 4's
purposes.

## Internal defects (falsification pass, before any search)

**A1 (severe) — Theorem 1's model does not contain the paper's stated attacker.**
§design says the worker is hostile and holds
`request_declassification(candidate, channel)`. But in `c1_noninterference.py`
the worker is **secret-blind** (`read_secret` flips a boolean; nothing is ever a
function of $s$ except `e_log`), and **`submit_to_gate` carries no payload** — it
sets `pending = True`, and the gate then computes `g(s)` from the *raw secret*.
The model has exactly one secret-dependent transition, so noninterference is
immediate by inspection, and the depth-7 exhaustion proves a one-line fact.

Both mutations act on that same transition, so the suite tests "is there exactly
one secret-dependent write, and does it write $g$?" There is no laundering
mutation because the model has no channel for one. Two further checks
(`structure_check`, `check_local_respect`) are **vacuous by construction** — the
functions they inspect never read the fields that would make them fail. True
statements; not evidence.

The undisclosed hypothesis: *the release function is applied to committed input
state, not to worker-computed state.* The disclosed residual is a different one
(Derek picks a bad $g$); the real one is Erin's worker picking a bad argument to
a good $g$ — the classical **laundering attack**, which Sabelfeld–Myers name and
whose enforcement strategy they supply.

**A2 — Theorem 2's "iff" is false at $K=\emptyset$.** Missing nonemptiness
($\varepsilon\in K$ — exactly Basin's condition (3)), and prefix-closure is
attached to the plant rather than to $K$.

**A5 (severe) — Pillar III silently assumes an honest worker.** $\sigma\le
\varepsilon_{\max}\Rightarrow(\varepsilon_{\max},0)$-DP requires each release to
*actually be* an $\varepsilon_i$-DP mechanism. §budget posits a malicious worker
choosing $b$ bits adversarially — such a worker runs no DP mechanism, and its
recorded $\varepsilon_i$ is a number it declared about itself. The paper carries
**two incompatible accounts of the same channel** and never says the ε account is
void exactly when the $q\cdot b$ account binds. PrivateKube states this
assumption out loud; Paper 4 should too.

**A6 — Pillar IV polices the wrong adversary.** Theorem 4a's hypergeometric
model is of an adversary who **copies spans**. §problem argues at length that the
real threat encodes semantically ("wording, punctuation, error messages, output
length, timing"). A worker that paraphrases carries $K=0$ canary spans
regardless of $m$, so $\Pr(\text{detect})=0$. Canary *evasion by re-encoding* is
free and unpriced.

**A4a/A4b — two verification claims that cannot fail.** Theorem 3's concurrency
clause assumes linearizability and then argues from it ("if the guarded update is
atomic, it is atomic"); both its mutations violate the hypothesis rather than
counterexampling the theorem. And the "2000 randomized instances, 0 violations"
loop never consults `MUT` — its assertion restates the two lines above it. A
tautology with a seed. Do not quote alongside the exhaustive BFS, which does real
work.

**A7 — one number doesn't reproduce.** "10× leak intensity cuts time-to-detection
≈30×" is one point of a 26×–106× range; KL is not a power law. Also: canary
stripping quoted as simulated 0.698 where the closed form gives 0.6998.

**Numbers that do reproduce** (recorded so the paper gets credit): all six DRV
advanced-composition values, SPRT $\mathbb{E}_1[N]=297$ and $\mathbb{E}_0[N]=432$,
$1-\beta^k$, exact hypergeometric 0.5535/0.99869, the 15-state count (order-
sensitive — as a multiset it would be 11), $q\cdot b=12{,}800$. Unremarked and
favourable: the binomial approximation is **conservative** at every plotted
point, and that's a free sentence currently unclaimed.

## Prior art

**Ryoan (Hunt, Zhu, Xu, Peter & Witchel, OSDI 2016, best paper)** — the single
most damaging omission. Mutually distrustful data owner and code owner, attested
enclave, whole-module confinement, per-principal DIFC declassification, padded
fixed-size output, **the same $\log_2 s$ timing-slot bit count**, and the same
repeated-request leakage-accumulation argument §budget presents as $q\cdot b$.

What survives Ryoan, and it is real: Ryoan has no noninterference theorem, no
ε-ledger, no detection theory; its confinement is justified by engineering
tractability, whereas Paper 4's whole-worker taint is justified by a **stated
unsoundness result** about token-level taint through a generative model. And
Ryoan's "one shot at input" is stronger than a tool-using agent can tolerate —
Paper 4 admits loops and pays with an explicit budget. **That trade is the
contribution.**

**Sabelfeld & Myers 2003** (delimited release) — Definition 2 with $n=1$,
$e_1=g(s)$ *is* Theorem 1 clause 1. Their gloss states Paper 4's silent
hypothesis exactly: "If no variables used in declassification are updated before
the actual declassification, delimited release reduces to noninterference." And
their Wallet-Attack is Paper 4's $q\cdot b$ scenario — which they **reject**, so
the literature has a stronger definition that rules out the laundering Paper 4
concedes as an unavoidable budget. Paper 4's answer (an LLM's release candidate
is not a syntactically identifiable escape-hatch expression) is good and is its
real delta.

**Sabelfeld & Sands 2009** — the what/who/where/when taxonomy. Their credit-card
laundering passage diagnoses §budget's attack as a *known failure mode of
"what"-only policies*, in 2005.

**Birgisson, McSherry & Abadi 2011** — "Differential privacy with information
flow control" is Paper 4's central architectural idea as a six-page position
paper. Cheap, favourable, establishes pedigree.

**Alvim et al. 2011** — the published $\varepsilon$-to-min-entropy link, which is
what A5's two incompatible currencies need. Note: **four** authors; Degano is on
a different report — do not merge author lists.

## Open items

1. **Fix the Theorem 3 corollary.** `CONTRADICTED` by a primary source read in
   full with a control test. Act now; independent of everything else.
2. **Add the laundering mutation to `c1_noninterference.py`.** The current suite
   cannot express A1's break. Highest-value engineering item.
3. **Rewrite the contribution paragraph against Ryoan.** Not optional.
4. `UNRESOLVED` — R. van der Meyden, **"What, indeed, is intransitive
   noninterference?"** (extended abstract), Proc. ESORICS 2007, Dresden,
   LNCS 4734, pp. 235–250 — title/venue/pages now confirmed (`[C37]` on the
   author's own publications page, `cgi.cse.unsw.edu.au/~meyden`; the extended
   journal version is `[J18]`, *J. Computer Security* 23(2):197–228, 2015,
   paywalled at IOS Press). Full text of neither version obtained 2026-08-27 —
   `core.ac.uk` (which closed two other UNRESOLVED items this session) errored
   transiently on this query; worth one retry before falling back to an
   institutional request. Bears on §lift's target property: Rushby's unwinding
   is sound and complete for **TA-security**, not ipurge-security.
5. **2026-08-27 update.** Whitehouse et al. 2023 full text: `verified`, see
   above. PINQ full text: `verified` — F. McSherry, "Privacy Integrated
   Queries: An Extensible Platform for Privacy-Preserving Data Analysis,"
   originally SIGMOD 2009 (DOI 10.1145/1559845.1559850), republished
   *Commun. ACM* 53(9), 2010 (DOI 10.1145/1810891.1810916); full text of the
   CACM republication obtained via a SciSpace mirror after ACM DL 403s
   persisted. Confirms the citation: PINQ is exactly what §budget's design
   claim says it is — a platform providing "unconditional privacy guarantees"
   via a tracked, declarative-language-enforced privacy budget. Cite the
   record and the mechanism both now, not just the record.
6. Stop quoting the 2000-instance sweep and the two vacuous checks as evidence.
