# Questions — flag 1

Ordered by how much the answer moves the verdict. Q1–Q3 decide it; the rest
shape the sentence that gets written.

## Q1. Does Kofman & Lawarrée 1993 actually contain an unbounded-collateral
result about stacking monitors?

The scout's summary says it does. The summary is unverified. Answer with the
proposition number and its verbatim statement, or with "no such result appears
in this paper," which is an equally good answer and more likely than it sounds.

## Q2. Is monitor selection randomised and hidden in their model?

Paper 3's entire $C$ factor comes from the briber paying before learning the
draw. If Kofman & Lawarrée's supervisor is a single named party whom the agent
can identify and approach directly, their model is Paper 3's $C=1$ case — where
Paper 3 itself concedes bribery persists (`paper3.tex:80`, the $C=1$ trace
$400 \to 390 \to 380$). Compatible, not contradictory.

Answer specifically: can the colluding party in their model identify its
counterparty before committing to a side payment?

## Q3. What quantity is unbounded, if any?

Distinguish carefully between: unbounded *collateral per monitor*, unbounded
*total collateral across the hierarchy*, unbounded *depth*, and unbounded
*transfers in the collusion side-contract*. These are four different claims and
only one of them contradicts Theorem 2. Paper 3 bounds total collateral at
$B \times \lceil \log G_0 / \log\frac{1}{1-\rho d}\rceil$ — finite, and
logarithmic in the initial corrupt value.

## Q4. Do the two models agree on what a monitor is paid and what it forfeits?

Paper 3's auditor posts a bond $B$ slashed on detection, and accepts a bribe
only above its expected forfeiture $\beta = \rho d B$. Kofman & Lawarrée's
supervisor is typically compensated by a wage contract with a collusion-proofness
constraint. A bond and a wage-plus-constraint are not the same instrument, and
the difference may be exactly where the finite/unbounded split comes from. Say
which instrument each uses and whether they are interconvertible.

## Q5. Does the collusion-proofness principle (Laffont–Martimort 1997) apply
to Paper 3's mechanism?

If yes, and if it says restricting attention to collusion-proof mechanisms is
without loss, then Paper 3's sealed sampling is a legitimate member of the
class and the result is strengthened, not threatened. If the principle's
hypotheses fail here — it has known limits with multiple colluding parties and
with hard information — say which hypothesis fails.

## Q6. Is Paper 3's clique argument the same argument as Diamond 1984's
diversification argument?

Diamond gets finite-capital delegated monitoring from diversification across
independent projects. Paper 3 gets finite-capital hierarchical auditing from
independence across $C$ pools. If these are structurally the same argument, that
is a citation Paper 3 must have and currently lacks — and it is a friendly
finding, since Diamond is a Nobel-cited result and being its analogue is good
company. Answer yes/no with the structural correspondence spelled out.

## Q7. Is $C > 1$ empirically defensible for LLM judge pools?

Paper 3 identifies model heterogeneity as what supplies the disjoint cliques,
and its own boundary section concedes that "two nominally rival benches
fine-tuned from the same base model may fail disjointness in exactly the
correlated-error cases that matter" (`paper3.tex:150`). Not a literature
question, but note anything in the read that bears on whether independence
across monitors is the right idealisation — the economics literature has
opinions about correlated supervisor signals.

## Q8. If the verdict is CLEAR or NARROW, what is the sentence?

Draft the actual text to add to `paper3.tex`'s `\section{Related work, and what
is actually new}`, in that section's existing imported/new voice, with the
`\bibitem` entries. One to three sentences. It should name the prior work, state
what it proves, and state the hypothesis under which Paper 3 differs — in that
order.
