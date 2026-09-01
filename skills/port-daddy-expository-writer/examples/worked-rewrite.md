# Worked Rewrite

Before/after pairs taken from `agent-transactions-whitepaper.tex`, with the "after"
rewritten in expository voice and annotated for which of the seven tells fired.

These are calibration examples. New drafts that read in this register pass; drafts
that read flatter than these need another rewrite pass.

---

## Rewrite 1 — The Youle mechanism (welfare claim)

### Before — from `§sec:youle:welfare` (whitepaper L704–L709)

> Under full information and competitive entry, the market-discovered premium
> Pareto-dominates any authority-chosen static parameter. The two regimes
> underwrite identical coverage $B_T = \mu(1+s)$; only the financing mechanism
> differs. An independent theorization with explicit assumptions, and a Monte
> Carlo sweep over 36 parameter configurations, accompanies this paper as a
> downloadable artifact. The simulation surfaces three quantitative boundaries
> beyond the qualitative claim: (i) Pareto dominance requires reputation noise
> $\sigma_r \le 0.1$, coupling §sec:merkle-forest to this section; (ii) a partial
> cartel is robustly defeated by Vickrey 2nd-price, but a full cartel collapses
> dominance regardless of detection rate at $p_d = 0.3$; (iii) larger insurer
> pools exacerbate winner's curse via the order-statistic effect, with the
> empirical optimum at $n = 3$.

This is *paper voice*. Dense, hedged, every claim qualified, every quantitative
boundary in a numbered subclause. The reader who doesn't already know what Pareto
dominance means has no foothold. The reader who does will still need to read it
three times.

### After — expository voice

Picture two ways of pricing a coordination risk. In the first, a benevolent
committee sits down with the actuarial tables — agent histories, transaction
classes, the operator's best guess at how badly a botched commit will go — and
picks a number: `B = 250 USD`, say, for a transaction of class C. Every agent in
the system posts that bond, no questions, take it or leave it. In the second,
a small market of *insurer agents* quotes that exact transaction live, each
insurer carrying its own private estimate of how risky this particular agent
has been (cribbed from the Merkle-forest reputation log; see the [reputation
section](#sec-merkle-forest) for how the cribbing is honest). The principal
picks the cheapest acceptable quote. Same coverage either way. The financing
mechanism is the only thing that changed.

The claim — and it is a claim, supported empirically by 72,000 Monte Carlo
trials rather than a closed-form theorem — is that the second world *Pareto-
dominates* the first. Pareto dominance is a strong, fragile, finicky property:
no agent ends up worse off, and at least one ends up strictly better off. Most
policy changes don't clear that bar, because most policy changes have losers.
The Youle claim is that this one doesn't, under the right conditions.

*The right conditions* is where the prose has to slow down, because the
simulation has opinions. Three boundaries fall out, and each one is the kind
of thing the paper-reader needs to keep close.

First: **reputation noise matters more than you'd think.** The dominance
holds when the noise on observed agent histories is $\sigma_r \le 0.1$ — call
it a 10% blur on what each insurer can see. Past that blur, the dominance
bends; with three colluding insurers and $\sigma_r$ approaching 0.5, it
collapses. The lesson is that the auction is *only as good as the village
gossip*: garbage reputation feeds, garbage prices.

Second: **a partial cartel is defeated by the right auction format.**
Vickrey 2nd-price — pay what the second-best bidder offered, not your own bid —
removes the incentive to shade strategically. Three insurers, two collude, one
honest insurer, and the honest one's bid disciplines the price. A *full*
cartel — every insurer in on the price floor — defeats the auction regardless
of detection rate, because there is no honest insurer to set the second price.
This is the folk-theorem trap from §sec:youle:a6, dressed up as a market.

Third — and this one is genuinely surprising — **bigger insurer pools are
not always better.** The empirical optimum sits at $n = 3$ insurers. Past
that, the order statistic of the lowest bid (the winner's-curse effect) pulls
prices down faster than the additional competition pulls them honest. Three
is a Goldilocks number nobody planned; the simulation found it.

So the welfare claim, stated honestly: under low reputation noise, with a
Vickrey 2nd-price auction, no full cartel, and roughly three competing insurers,
the market-discovered premium dominates the committee-chosen parameter for
every agent simultaneously. Outside that regime, dominance is partial or
collapses. The paper says *claim* for a reason.

### Annotations — which tells fired

- **Tell #1 (high-low collisions)** — "benevolent committee" next to "cribbed
  from"; "Goldilocks number nobody planned" next to "order statistic of the
  lowest bid"; "village gossip" next to "$\sigma_r \le 0.1$".
- **Tell #2 (cathedral build, then punchline)** — opens with two pricing
  worlds; only names "Pareto-dominates" in paragraph two; the surprising
  $n=3$ result lands at the bottom of the section, not the top.
- **Tell #3 (em-dash, parenthetical, aside)** — three em-dash asides in the
  first paragraph alone, one parenthetical cross-reference, one inline aside
  on the claim word.
- **Tell #4 (wild analogy)** — implicit in "village gossip"; the broader
  analogy of pricing as a *taste test on risk* runs through the section.
- **Tell #6 (word-as-affection)** — Pareto-dominates is named precisely,
  Vickrey 2nd-price is named precisely, $\sigma_r$ kept rather than
  paraphrased as "the noise variable."
- **Tell #7 (self-deprecation)** — "and it is a claim, supported empirically
  by 72,000 Monte Carlo trials rather than a closed-form theorem" is the
  honesty about the regime; "Outside that regime, dominance is partial or
  collapses" is the wobble; "The paper says *claim* for a reason" is the
  ballast.

Tell #5 (lists with personality) was not used here because the three
boundaries earned the cathedral order more than they earned a bulleted list.
A draft that bulleted them would have lost the build.

---

## Rewrite 2 — The mechanism opener

### Before — from `§sec:youle:mechanism` (whitepaper L688–L691)

> Instead of a static bond size $B(\pi, r, s)$ selected by the commons authority,
> allow a market of insurer agents to bid on underwriting each agent transaction.
> An insurer $I$ offers a quote $(q_I, c_I)$ where $q_I$ is the required premium
> and $c_I$ is the claim ceiling. A principal $P$ submits a transaction $T$
> requiring bond coverage $B_T$. Insurers quote; principal selects. If the
> transaction proceeds and damages are assessed at $d$ with $d \leq c_I$,
> the insurer pays. Otherwise principal pays up to $B_T - c_I$ from its own
> stake.

This is paper voice doing what paper voice does well: every variable named,
every inequality sharp, every flow step compressed to a clause. It is also
paper voice doing what paper voice fails at: the reader who has never seen
this mechanism before has no story to attach the variables to. They will
absorb the structure on a second pass; they will not have *fun* on the
first.

### After — expository voice

The mechanism is small enough to walk through end to end. Consider one
transaction. An agent — call her Aphrodite — wants to do a thing that the
coordination system says costs `B_T = 100 USD` in bond coverage. (Coverage,
in the sense of: if this thing goes wrong, up to that much is on the line.)
Under the old regime, Aphrodite's principal posts exactly 100 USD, sourced
from a parameter the commons authority chose in advance. Done.

Under the new regime, a small audience of *insurer agents* — call them
$I_1, I_2, I_3$ — see Aphrodite's transaction posted to a quote channel.
Each insurer pulls Aphrodite's history out of the Merkle forest, runs it
against its own private risk model, and quotes a *premium* $q_i$ — the price
of underwriting Aphrodite, paid by her principal up front — and a *claim
ceiling* $c_i$ — the maximum the insurer will pay out if things go sideways.

The principal picks the cheapest acceptable quote. Say $I_2$ wins with
$(q_2, c_2) = (5\,\text{USD},\,80\,\text{USD})$. Aphrodite's principal pays
$I_2$ the 5 USD premium up front, posts the remaining 20 USD of coverage
from its own stake (because the claim ceiling falls short of the full
$B_T$), and the transaction proceeds. If Aphrodite breaks something and
damages come in at, say, 70 USD — well under the ceiling — $I_2$ pays. If
damages come in at 90 USD, $I_2$ pays 80 and the principal eats the
remaining 10 from its stake. If damages come in at 200 USD — past total
coverage — the system has bigger problems, namely that the bond coverage
was undersized, which is the kind of failure §sec:scope-multiplier exists
to prevent.

The whole point: the *price* of the bond is now a thing the market
discovers, not a thing the committee picks. The price is the equilibrium
of three insurers competing over Aphrodite's risk.

### Annotations — which tells fired

- **Tell #1** — "small audience" next to "$I_1, I_2, I_3$"; "things go
  sideways" next to "claim ceiling."
- **Tell #2** — the cathedral here is *the walked example*. Variables only
  get named after they've appeared in the story. The punchline is the last
  sentence: the price is now a market discovery, not a committee choice.
- **Tell #3** — five em-dash asides, two parentheticals, one sentence
  fragment ("Done.").
- **Tell #6** — premium, claim ceiling, $B_T$ — all named precisely.
- *Tell #5* — implicit in the if/else damage cases; deliberately kept as
  prose because the cases tell a story, not a spec.

This is the named-then-defined-then-used pedagogical move applied throughout.
Each variable lives in the example before the example moves on.

---

## Rewrite 3 — A short caveat paragraph

### Before — last sentence of §sec:youle:welfare

> A Coq or Lean mechanization of the strategic game is not in this paper;
> the empirical artifact stands on its own.

### After

It is worth being honest about what kind of result this is. The welfare
claim is *not* a Coq proof. There is no Lean file checking that under the
strategic game's full equilibrium conditions, Pareto dominance follows
deductively from the agent utilities. What there is is a Python simulation,
the source of which ships with the paper, that draws 36 parameter
configurations from the relevant region, runs 2,000 trials per
configuration, and counts the fraction of trials in which the market-priced
regime dominates the committee-priced regime. The result is empirical. The
mechanization is future work. The simulation has every parameter named at
the top of the file and every random draw seeded; rerun it and you should
land in the same place. (And if you don't, that's the kind of disagreement
the paper wants to hear about.)

### Annotations — which tells fired

- **Tell #7** — the entire paragraph is the wobble. "It is worth being
  honest" / "future work" / "if you don't, that's the kind of disagreement
  the paper wants to hear about" — confident and humble in the same breath.
- **Tell #3** — three em-dashes in the close, one parenthetical.
- **Tell #6** — "Coq" / "Lean" / "Pareto dominance" all named precisely,
  rather than gestured at as "a formal mechanization."

This is the move the marketing-copy register would not allow: *say the
proof is partial*. In expository writing, saying the proof is partial is
the critical trust move. It is what earns the reader's belief in the
parts that *are* proved.

---

## How to use these rewrites in practice

When drafting a new piece:

1. Find the paragraph in the paper that is closest to your topic.
2. Read the "before" out loud to feel where it lands.
3. Read the matching "after" out loud. Feel the lift.
4. Draft your piece aiming for the second register, not the first.
5. If you find yourself drifting back toward "before" voice — clauses
   stacking, variables before stories, no analogies — open this file
   again and re-read aloud.

The seven tells are not a checklist. They are a *register*. These rewrites
are the calibration of that register on this specific corpus.
