# Flag 3 — is the tractability frontier already published in this shape?

**Paper**: 6, *What Needs an Authority* (`docs/harbor-research/tex/paper6.tex`)

**Risk**: moderate. The specific results are almost certainly safe; the *shape*
of the result may be well-trodden, and the paper does not currently acknowledge
the literature where that shape lives.

## The claim under test

Theorem 1a/1b (`paper6.tex:107–124`): conflict detection inside a designed
commitment fragment $\mathcal{L}_c$ is polynomial and witness-producing, and
adding one expressive feature — disjunctive obligations under discharge-choice
semantics — makes conflict-freedom NP-complete, by a 3-SAT reduction.

The paper is careful about what it claims:

> No component algorithm or queueing formula above is ours. The contributions
> are: the fragment/frontier pair as an exact price list for commitment-language
> design […] An August-2026 survey found no prior statement of the authority
> question in this detection/resolution/ownership decomposition; a final
> lit-sweep before submission is owed — "not found" is not "proven nonexistent."

So the claimed contribution is the *location* of the frontier in a language a
scheduler would actually want, plus the composition with Paper 2 making
in-fragment checking regimentable. Not the reduction technique, which it
correctly attributes to standard 3-SAT gadgetry.

## What the literature may already own

Three lines, none currently cited in `paper6.tex`:

1. **Complexity of policy reasoning.** Halpern & Weissman ("Using First-Order
   Logic to Reason about Policies", CSFW 2003 / ACM TISSEC 2008) identify
   tractable policy fragments and the expressive steps that leave them. If they
   already exhibit a P-to-NP-complete boundary for a policy language with
   deontic flavor, Paper 6's frontier is an instance of a known pattern rather
   than a new location.

2. **Complexity of deontic logic proper.** Sun & Robaldo on input/output logic
   complexity, and the defeasible-deontic line (Governatori, Rotolo). Paper 6
   cites von Wright 1951 and Chisholm 1963 — the philosophical foundations — but
   nothing from the computational side of the same field. That is a conspicuous
   gap: it cites deontic logic's origins and deontic logic's puzzles, and then
   proves a complexity result without citing deontic logic's complexity
   literature.

3. **Normative conflict detection as an algorithmic problem.** Cholvy & Cuppens
   on security-policy consistency; the AAMAS norm-conflict line. This is
   Paper 6's Part I stated in another community's vocabulary.

## The dichotomy framing

Independent of what the sweep finds: Theorem 1a/1b is a **dichotomy** — tractable
inside the fragment, NP-complete one step out — and the paper never uses the
word. Schaefer's 1978 theorem is the template for exactly this kind of result
and is the reference a complexity theorist reads Theorem 1 against.

Naming it a dichotomy costs one sentence and makes the result instantly legible
to a community that currently has no handle on it. This is in the renaming
register in `../BIBLIOGRAPHY.md` and should happen regardless of the verdict.

## What a resolution looks like

`findings.md` opens with the verdict, then:

- For each of the three lines above: what is actually proved, whether it covers
  a commitment language with $\mathcal{L}_c$'s features (ground deontic rules
  over scopes and intervals, exclusive interval claims, difference constraints),
  and whether the P/NP-complete boundary is already drawn at disjunction.
- A specific answer to whether $\mathcal{L}_c$ itself — the particular
  combination of Horn rules, ground deontic operators, interval claims, and
  difference constraints — appears anywhere. The combination is likely novel
  even if each ingredient is standard.
- Whether the Part II results (Erlang-C specialization boundary, succession
  price $D^\star$) have any prior-art exposure. These come from a different
  literature entirely — queueing theory with server breakdowns — and the paper
  cites Mitrany–Avi-Itzhak for the lineage. A quick check that $g_A(\rho,c)$ and
  $D^\star$ are not already standard results is worth one search pass.
- Drafted citation text, and the one-sentence dichotomy framing.
