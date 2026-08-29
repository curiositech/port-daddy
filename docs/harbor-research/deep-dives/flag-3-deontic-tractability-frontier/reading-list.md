# Reading list — flag 3

## Tier 1 — the named risk

1. **Halpern, J. and Weissman, V. "Using First-Order Logic to Reason about
   Policies."** ACM TISSEC 11(4):1–41, 2008. Earlier version: CSFW 2003.
   Read for: which policy fragment they identify as tractable, what the
   complexity is, which expressive feature pushes it out, and whether the
   language has deontic structure (obligation/prohibition) or is purely
   permission-based access control. The last point matters: an access-control
   tractability result is adjacent to Paper 6, not on top of it.

2. **Sun, X. and Robaldo, L. "On the complexity of input/output logic."**
   *Journal of Applied Logic* 25:69–88, 2017.
   The closest published home for complexity classification of deontic
   reasoning. Read for the classification itself and whether any fragment
   boundary is drawn at disjunctive obligation.

3. **Governatori, G. and Rotolo, A.** on defeasible deontic logic complexity —
   start with "Logic of Violations" (AJL 4:193–215, 2006) and follow the
   complexity results in that line. Read for whether tractable defeasible
   deontic fragments are already characterized.

## Tier 2 — the same problem in other vocabularies

4. **Cholvy, L. and Cuppens, F. "Analyzing consistency of security policies."**
   IEEE S&P 1997, 103–112.
   Normative conflict detection in the security-policy idiom. Paper 6's Part I
   in another community's words.

5. **The AAMAS/COIN norm-conflict line.** Search for normative conflict
   detection, norm consistency checking, and their complexity. Vocabulary that
   does not presuppose our terms: "detecting conflicting obligations",
   "normative system consistency", "compliance checking complexity",
   "obligation prohibition conflict detection".

6. **Governatori, G. and Sadiq, S.** on business-process compliance checking.
   Industrial-flavored, but this is where conflict detection over temporal
   obligations actually gets implemented, and where interval-based obligations
   most resemble $\mathcal{L}_c$.

## Tier 3 — the dichotomy frame and the fragment's ingredients

7. **Schaefer, T. "The Complexity of Satisfiability Problems."** STOC 1978,
   216–226.
   Not to be compared against — to be *cited as the frame*. Confirm the standard
   phrasing of a dichotomy result so Theorem 1a/1b can be named one correctly.

8. **Difference constraints and Bellman–Ford negative-cycle detection** — the
   simple temporal network (STN) literature, Dechter–Meiri–Pearl 1991
   "Temporal Constraint Networks". Paper 6 uses difference constraints without
   citing the STN literature that owns them. Check whether a citation is owed.

9. **Interval scheduling / interval graph** results for the exclusive-claim
   overlap check. The sweep-line is textbook; confirm nothing more specific is
   owed.

## Tier 4 — Part II, quick pass only

10. Confirm that the Erlang-C-based specialization boundary $g_A(\rho,c)$ and
    the succession threshold $D^\star = \eta K/(1-\eta K)$ are not already
    standard results in the queueing or operations-management literature.
    Mitrany–Avi-Itzhak 1968 is already cited for the breakdown lineage; the
    question is whether the *decision boundary* (specialist vs. pool with an
    accountability term) is a known result. Search: "specialist versus pooled
    server", "pooling versus dedicated servers", "server breakdown response
    time", "M/M/1 with breakdowns mean response time".

    This is a time-boxed pass. If nothing turns up in a reasonable search, say
    so and move on — Part II is not the flagged risk.

## Retrieval notes

- Halpern's papers are on his Cornell page; the CSFW and TISSEC versions differ
  and the dive should say which was read.
- The AAMAS/COIN literature is large and uneven. Prefer survey articles for
  orientation, then fetch primary sources for anything that looks close.
- Do not treat a survey's characterization of a result as the result.
