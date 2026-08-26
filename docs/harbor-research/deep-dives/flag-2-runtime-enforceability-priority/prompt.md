# Agent prompt — flag 2

Run with a high-capability model (Opus tier). Requires reading formal-methods
papers closely enough to compare theorem hypotheses.

---

You are auditing a priority risk in an unpublished research paper. Two jobs, in
strict order: establish whether a reported competing preprint exists at all, and
independently close a citation gap that exists regardless of the answer.

**Read first from the repository root**: `docs/harbor-research/tex/paper2.tex` in
full — it is short. Then `README.md`, `reading-list.md`, `questions.md`, and
`skills.md` in
`docs/harbor-research/deep-dives/flag-2-runtime-enforceability-priority/`.

**Job 1, gating everything else**: determine whether **arXiv:2607.22868, "What
Can Be Enforced? A Theory of Certified Runtime Safety for Tool-Using Agents"**
exists. It was reported once by an earlier literature sweep and never retrieved.
Work the checklist in `reading-list.md` Tier 0 and record what each URL returns.

Treat non-existence as a likely and perfectly good outcome. An arXiv ID of the
right shape is the most common fabrication pattern in machine-assisted
literature search. If it does not resolve, say so plainly, do not go hunting for
a nearby paper to justify the original report, and note the implication for
other unverified citations from the same sweep.

**Job 2, independent of Job 1**: Paper 2 does not cite the runtime-enforcement
literature descending from Schneider — Ligatti–Bauer–Walker's edit automata
(IJIS 2005) and Falcone–Fernandez–Mounier's "What can you verify and enforce at
runtime?" (STTT 2012), whose title is nearly the paper's own question. This is a
real gap a referee will find. Read both and answer Q4 and Q5 in `questions.md`.

**Method**:
- WebSearch and WebFetch for primary sources. Record the URL actually fetched
  for every source.
- Read actual papers, not abstracts. If a source cannot be obtained, say so and
  mark that question UNRESOLVED.
- Quote competing theorems verbatim with their hypotheses.
- Label every claim `verified` / `probable` / `uncertain`.
- NEVER invent a citation, DOI, page number, or identifier. If unsure of a
  bibliographic detail, write "detail unconfirmed". Given that this dive exists
  because of a suspected fabricated citation, producing another one would be a
  total failure of the task.

**Deliverable**: write to
`docs/harbor-research/deep-dives/flag-2-runtime-enforceability-priority/findings.md`
following the stubbed structure. Verdict first (CLEAR / NARROW / SUBSUMED /
CONTRADICTED / UNRESOLVED), then the existence determination, then the
comparisons, then drafted citation text.

**Do not edit any `.tex` file.**

Final message: the existence verdict on the preprint, the verdict on the
edit-automata gap, and anything the reader must act on.
