# Agent prompt — flag 4

Runs well on a mid-tier model (Sonnet). This is verification and retrieval
against a checklist, not theorem comparison — but the verification standard is
absolute.

---

You are running a citation audit on an unpublished research paper. Two jobs.

**Read first from the repository root**: `whitepaper/research/tex/paper7.tex`,
especially its `\section{Related work: imported, adjacent, and new}` and its
bibliography. Then `README.md`, `reading-list.md`, `questions.md`, `skills.md`
in
`whitepaper/research/deep-dives/flag-4-topological-consensus-citation-audit/`.

**Job 1 — resolve a suspect citation.** An earlier sweep surfaced "A Homological
Approach to Consensus and Fault Tolerance," reportedly in a general-audience
Brazilian mathematics bulletin, with performance figures the finding scout
itself called suspiciously round. The scout flagged it as possibly fabricated.

Work the Tier 0 checklist in `reading-list.md`. Return FOUND (with a resolving
URL and venue) or **NOT FOUND — DO NOT CITE**, in those words. Do not substitute
a similar real paper as the answer; if a real paper on the topic turns up,
report it as a separate, separately-labeled finding.

**Job 2 — close a real gap, which matters more.** Paper 7 applies algebraic
topology to a fault-tolerance problem in distributed computing and does not cite
the founding work on algebraic topology applied to fault tolerance in
distributed computing. Verified by grep: no Herlihy, Rajsbaum, Kozlov, Saks, or
Zaharoglou anywhere in the file. Herlihy–Shavit (JACM 1999) and Saks–Zaharoglou
(SICOMP 2000) shared the 2004 Gödel Prize for this.

Verify those citations' exact details, read enough to characterize them
accurately, and answer Q2–Q5. Also check whether PeerReview (Haeberlen,
Kouznetsov, Druschel, SOSP 2007) belongs — it is the systems-side ancestor of
Paper 7's exact scenario and is also absent.

Then run the mechanical accuracy pass (Q6) over the eight citations Paper 7 does
carry.

**Method**:
- WebSearch and WebFetch. Record the URL actually fetched for every source.
- Label every claim `verified` (primary source obtained) / `probable` (two
  independent secondary sources agree) / `uncertain` (single unverified
  mention).
- **Never invent a citation, DOI, page number, volume, or identifier.** If you
  cannot confirm a bibliographic detail, write "detail unconfirmed." This entire
  dive exists because a citation may have been fabricated — producing another
  one would be a total failure of the task. When in doubt, report the doubt.
- Do not report a paper as verified on the strength of seeing it in another
  paper's reference list. Fetch it.

**Deliverable**: write to
`whitepaper/research/deep-dives/flag-4-topological-consensus-citation-audit/findings.md`
following the stubbed structure. Open with the Job 1 determination, then Job 2,
then the accuracy table, then drafted citation text for the paper's existing
"Adjacent, and honestly positioned" paragraph.

**Do not edit any `.tex` file.**

Final message: FOUND or NOT FOUND on the suspect citation, whether
Herlihy–Shavit and PeerReview should be added, and any inaccuracy found in the
existing bibliography.
