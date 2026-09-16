<!--
  TEMPLATE — a review of a Part or a standalone paper follows this shape.
  Copy this file to `part-V-whatever.md` (or `paper-N-whatever.md`) and fill it in.
  Do not leave any HTML comment in the finished file; each one marks a spot that
  needs real content or needs deleting if the section does not apply.

  The rules, stated once so nobody has to guess them from the examples:

  1. Every citation carries [verified] or [unverified] (or, where a chapter's own
     citation is plausible but you did not personally re-search it this session,
     [as cited] — the four existing files use this for citations the Book already
     had right and you took on faith rather than re-confirming). Never leave a
     citation unmarked.
  2. "No prior work found" is not a failure to write around — it is itself a
     finding, and it goes in the file in exactly those words, with a note on how
     hard you looked and for how long.
  3. Nothing is invented. If you are not sure a paper exists, do not cite it. If a
     verdict is a guess, say it is a guess.
  4. The file ends with a table of the Book's private coinages against the public
     names the field already uses for the same idea — that is often the single
     most useful artifact in the whole review.
-->

# Literature review: <!-- Part N, "Title" (Chapters X–Y) --> <!-- or: a standalone paper, e.g. "paper8.tex" -->

<!--
  Optional scope line, one sentence, in the voice of Part III's opening: which
  files this review actually opened (the whitepaper .tex, any standalone research
  paper twins, the library-index entries the formal results map to).
-->

Method note: a citation marked **[verified]** was confirmed this session via a
real web/paper search (author, venue, year, DOI/URL seen) or by reading a source
document directly. A citation marked **[as cited]** is one the Book already cites
with plausible, internally consistent metadata that I did not independently
re-search this session — so I do not claim to have verified it, only that it is
not newly invented by me. A citation marked **[unverified]** is one a search did
not resolve within this review's working rules. Nothing below is fabricated;
where a search found no prior work, the entry says so, because that absence is
itself a finding.

## Verdict<!-- , in two paragraphs — use this longer form for a Part; a single-paragraph Verdict is fine for one paper -->

<!--
  One paragraph (or two) that a reader could stop after and already know the
  shape of the whole review: how many ideas, how many hold up as stated, which
  one is the strongest original result, which citations the Book already gets
  right on its own, and — this matters as much as the theorems — what the review
  found the Book never engaged. Name the field's canonical papers the Book is
  missing right here, not just in each idea's own section; that is what makes
  the verdict readable on its own. End with the one-line-verdict sentence that
  the README's summary table will quote.
-->

---

## 1. <!-- Idea title, in plain language, not the Book's private name -->

**What the Book claims.** <!--
  Cite the actual theorem/definition/design-invariant by its name and section or
  file (e.g. `thm:exclusion`, §"Single-writer discipline", `paper6.tex`). State
  what kind of claim it is — theorem, design invariant, conjecture, dramatized
  example — because the Book itself usually labels this, and the label matters
  to the verdict.
-->

**Other names.** <!--
  What the field(s) that already own this idea call it. Name the field for each
  term (economics: ...; distributed systems: ...). If the Book already uses the
  public name, say so — that is worth recording as a point in its favor.
-->

**Prior work.** <!--
  Author, title, venue, year, and a [verified]/[as cited]/[unverified] tag on
  every entry. Say plainly what each paper actually shows and how it bears on
  the Book's claim — a reader should be able to go find the paper from this line
  alone. If nothing turned up, write "No prior work was found, in the time
  available, that ..." and say what you searched.
-->

**How it differs.**<!-- (or "How the Book's version differs.") -->
<!--
  Is this a restatement under a new name, a known result applied to a new
  domain, a genuine new combination of known pieces, or an actually new result?
  Say which, and say what specifically is new if anything is.
-->

<!--
  Optional. Include this sub-block when there is a real, specific objection a
  domain expert would raise on reading the section — not a generic "more
  citations would help," but the actual thing a referee in that field would ask
  first. Omit the sub-block entirely rather than force one.
-->
**What an expert would push back on.**

**Does the formulation hold?**<!-- (Part I-IV write this as "Verdict:" — either heading is fine, pick one and use it for every idea in the file.) -->
<!--
  One of: firm (correct as stated, restated or not); known result restated
  (under a private name, no defect); novel and unverified (a real new claim, no
  matching prior work found, honestly a guess or a conjecture); contested
  (prior work with a similar shape exists and the novelty claim needs
  re-scoping); or honestly stated open problem/boundary (the Book itself says
  this is not solved). Say which, in one sentence, then the reason in the rest
  of the sentence — the existing files never leave the verdict as a bare label.
-->

**Reading list.** <!-- The works from "Prior work" a reader should actually go read, in citation-list form, shortest path first. -->

---

## 2. <!-- Idea title -->

<!-- Repeat the same six sub-blocks for every idea the review covers. Delete this
     comment and the placeholder heading once idea 2 exists; add as many numbered
     sections as the Part or paper has ideas — the four existing files run from
     eleven to fourteen. -->

---

<!-- Repeat "## N. <idea>" sections until every idea in the Part or paper has one. -->

## Table: ideas and verdicts

| # | Idea | Verdict |
|---|------|---------|
<!-- | 1 | <short idea name> | <one-line verdict, same wording as the idea's own "Does the formulation hold?" sentence> | -->

## Terms the Book coins privately that already have public names

<!--
  One entry per private coinage found across the whole file — even a review that
  finds every claim firm and correctly cited still owes this table if the Book
  used its own vocabulary anywhere the field has a name already. If a review
  genuinely finds no private coinages, say so explicitly here rather than
  omitting the section: "No private coinages found in this Part; every idea
  already carries the field's own name."
-->

- **"<Book's term>"** — this is **<public name>**, <field>'s term for the same
  <mechanism/theorem/pattern>. <!-- one sentence on how exact the match is -->
