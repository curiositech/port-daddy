# Agent prompt — flag 3

Run with a high-capability model (Opus tier). Requires reading complexity and
deontic-logic results closely enough to compare fragment definitions.

---

You are auditing a novelty risk in an unpublished research paper. The paper
proves that conflict detection in a designed commitment language is polynomial,
and that adding one expressive feature makes it NP-complete. The risk is not
that the results are wrong — they are almost certainly fine — but that this
exact *shape* of result is already published in the deontic-logic and
policy-reasoning complexity literature, which the paper does not cite at all.

**Read first from the repository root**: `docs/harbor-research/tex/paper6.tex`,
especially Part I and its Theorem 1a/1b box, and the `\section{Related work}`.
Then `README.md`, `reading-list.md`, `questions.md`, `skills.md` in
`docs/harbor-research/deep-dives/flag-3-deontic-tractability-frontier/`.

**Note the conspicuous gap** that motivates this dive: the paper cites deontic
logic's philosophical origins (von Wright 1951) and its classical puzzles
(Chisholm 1963), then proves a complexity result — without citing anything from
the computational side of deontic logic. That is the gap to close.

**The task**: answer Q1–Q9 in `questions.md`. The two decisive ones are Q1 (does
Halpern & Weissman already draw this boundary, and is their language about
permissions or about obligations with temporal extent?) and Q2 (does the deontic
complexity literature already locate a frontier at disjunctive obligation?).

Q3 is where the paper's real contribution probably survives: the *combination*
of Horn rules, ground deontic operators over scopes and intervals, exclusive
interval claims, and difference constraints, chosen so all four conflict types
fall out of one polynomial pass. Each ingredient is standard; confirm whether
the combination is.

**Method**:
- WebSearch and WebFetch for primary sources; record every URL fetched.
- Read actual papers. Abstracts are not enough for a fragment comparison — the
  whole question is what is inside the fragment.
- Search other fields with *their* vocabulary, not ours: "normative system
  consistency", "detecting conflicting obligations", "compliance checking
  complexity", "policy conflict detection". The program's standing instruction
  is to look for analogous ideas in other disciplines before searching with our
  own terminology.
- Label every claim `verified` / `probable` / `uncertain`.
- NEVER invent a citation, DOI, or page number. Write "detail unconfirmed" if
  unsure. A sibling dive in this same program exists because an earlier sweep
  appears to have fabricated an arXiv identifier — do not repeat that.

**Deliverable**: write to
`docs/harbor-research/deep-dives/flag-3-deontic-tractability-frontier/findings.md`
following the stubbed structure. Verdict first (CLEAR / NARROW / SUBSUMED /
CONTRADICTED / UNRESOLVED), then per-question evidence, then drafted citation
text for the paper's existing Imported / Positioned-against / New structure.

**Do not edit any `.tex` file.**

Final message: the verdict, whether the fragment combination survives as novel,
and the single most important citation the paper is missing.
