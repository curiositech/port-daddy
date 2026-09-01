# Agent prompt — flag 1

Run with a high-capability model (Opus tier). This dive requires reading
economic theory closely enough to compare hypotheses, not just retrieving
abstracts.

---

You are auditing a novelty risk in an unpublished research paper. Your job is to
determine whether a published result in economics contradicts, subsumes, or is
simply different from a theorem the paper claims. Be adversarial toward the
paper. A finding that the paper is wrong is a successful outcome, not a failure.

**Read first from the repository root**: `whitepaper/research/tex/paper3.tex`,
especially `\section{The tower: bribing sealed juries from $C$ cliques}` and its
Theorem 2 box. Then read
`whitepaper/research/deep-dives/flag-1-bonded-tower-vs-hierarchical-collusion/README.md`,
`reading-list.md`, and `questions.md` in that folder.

**The task**: answer Q1–Q8 in `questions.md`, in order, using primary sources.
The central question is Q1: does Kofman & Lawarrée 1993 ("Collusion in
Hierarchical Agency", Econometrica 61(3):629–656) actually contain a result
saying that stacking monitors requires unbounded collateral? That
characterisation came from an earlier sweep that never read the paper, and it
may simply be wrong.

**Method**:
- Use WebSearch and WebFetch to obtain primary sources. Try paywall-free routes:
  author pages, working-paper series, institutional repositories.
- Read the actual paper. If you cannot obtain it, say so plainly and mark the
  verdict `UNRESOLVED — source not obtained`. Do not infer a theorem's
  hypotheses from its abstract and do not reconstruct them from memory.
- Quote competing results verbatim, with their hypotheses, so the comparison can
  be checked by someone who has not read the source.
- Label every claim `verified` (you read the primary source), `probable`
  (consistent across two independent secondary sources), or `uncertain` (single
  unverified mention). Never invent a citation, a DOI, a page number, or a
  proposition number. If you are unsure of a bibliographic detail, say "detail
  unconfirmed" rather than producing a plausible-looking one.

**Deliverable**: write your findings to
`whitepaper/research/deep-dives/flag-1-bonded-tower-vs-hierarchical-collusion/findings.md`,
following the structure already stubbed in that file. Open with the verdict —
CLEAR, NARROW, SUBSUMED, CONTRADICTED, or UNRESOLVED — then the evidence, then
the hypothesis comparison table, then the drafted citation sentence if one is
warranted.

**Do not edit any `.tex` file.** Draft proposed text inside `findings.md` only.
The paper is a real research artifact and edits to it require separate sign-off.

Your final message should be a short summary: the verdict, the one or two
sentences of evidence that decided it, and anything the reader must act on.
