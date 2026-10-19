# The reader's-eye check

A check for Book prose a competent reader cannot follow, and the rubric for the
half of it no script can do.

Layer 1 is `scripts/readers_eye.py` (mechanical, stdlib, no model).
Layer 2 is the rubric in this file, applied by a model, one paragraph at a time.
The split is `skills/make_copy_and_media_human`'s: measurable signals in Python,
phrase-level judgement in a rubric, and a finding without a fix is a complaint.

---

## 1. The gap this closes

Every prose-adjacent check this repository ships measures **structure**:

| Check | The question it asks |
|---|---|
| `skills/textbook-craft/scripts/chapter_lint.py` | Does the section have a worked example? Is the claim tagged with its epistemic kind? Is the exercise at the chapter end? Is there a Review block, a History block, a boundary section? |
| `skills/tufte-evidence-design/scripts/margin_lint.py` | Is the gloss at the term's first use? Does the portrait have a cleared sidecar? Is a footnote in the body instead of the margin? Does `\pdprovedon` resolve? |
| `skills/harbor-exposition/scripts/check_style.py` | Do the seven house moves appear anywhere in the file? |
| `scripts/lint/check-banned-phrases.mjs` | Does a banned phrase appear? | <!-- repo-root path, not skill-relative --><!-- phantom-ok -->
| `scripts/harbor-research/check_tex_environments.py`, `scripts/harbor-research/check_citations.py`, `scripts/harbor-research/check_duplicate_theorems.py` | Does every `\begin` have its `\end`? Does every cite resolve? Is a theorem stated twice? | <!-- repo-root paths, not skill-relative --><!-- phantom-ok -->

**Not one of them asks whether a reader could follow the sentence.**

That is not an oversight, it is a boundary: structure is cheap to check and
followability is not. But the boundary has a cost, and the cost has a name.
`whitepaper/single-writer-kernel.tex:439`, §1.3 "The kernel as seven organs",
satisfies every floor above — and the author's verdict on it was:

> *"This paragraph is insane — kernel demon organs. I know what the kernel is,
> kinda, and what daemons do, maybe, organ as a metaphor makes no sense to me."*

A paragraph can pass every gate in this repository and still be the place the
reader closes the book. This check exists for that paragraph and the ones like
it.

---

## 2. The specimen, diagnosed

Six defects, and which layer catches each.

| # | Defect in §1.3 | Layer |
|---|---|---|
| 1 | Four unanchored metaphors in one paragraph: *organs* (anatomy), *symptom* (medicine), *connective tissue* (anatomy), "the substrate organ is **the floor**" (architecture), "tables **with discipline**" (moral character) | **L1** `metaphor-domain-collision` catches anatomy+medicine and anatomy+architecture. "with discipline" is L2 only — see §4. |
| 2 | The metaphor is never instantiated: "organ" five times before one organ does one thing; the definition ("each a contract the daemon must hold") buried in an appositive and then abandoned | **L1** `metaphor-never-instantiated` |
| 3 | It does the thing it condemns: argues against "a flat noun-list of features" while listing eight nouns | **L2 only.** Self-contradiction between a paragraph's argument and its own form is not countable. |
| 4 | Opaque slash-pairs: `resource/exclusion`, `obligation/enforcement`, unglossed | **L1** `undefined-slash-pair` |
| 5 | Wrong register for the artifact: "the paper's sharpest corrections" in a Book | **L1** `artifact-register-drift` |
| 6 | The one clear sentence is in the caption, not the prose: "All seven are disciplines over one SQLite/WAL file: one commit history, not seven stores" | **L1** `caption-carries-the-fact` — the sharpest rule here, and the one no existing check can express, because it is a relation *between* a caption and a paragraph rather than a property of either. |

Layer 1 fires on five of the six, seven findings across two paragraphs:

```
whitepaper/single-writer-kernel.tex:435  metaphor-never-instantiated  organ x5
whitepaper/single-writer-kernel.tex:439  caption-carries-the-fact     SQLite/WAL, WAL
whitepaper/single-writer-kernel.tex:439  metaphor-domain-collision    anatomy + medicine
whitepaper/single-writer-kernel.tex:471  metaphor-domain-collision    anatomy + architecture
whitepaper/single-writer-kernel.tex:471  artifact-register-drift      "the paper's"
whitepaper/single-writer-kernel.tex:471  undefined-slash-pair         resource/exclusion
whitepaper/single-writer-kernel.tex:471  undefined-slash-pair         obligation/enforcement
```

---

## 3. Layer 1: the rules, and why each is defensible

Every rule is a count or a match. None encodes a taste judgement, and the word
lists live in `readers-eye-lexicon.json`, not in the script.

### `caption-carries-the-fact`
A float's caption states something concrete and checkable — a filename, a
number, an acronym, a named mechanism — and the paragraph that introduces that
float states nothing concrete at all.

*Defensible because* both halves are mechanical: concreteness is a regex over
tokens, and "the paragraph that introduces this float" is the paragraph holding
`\ref{<the float's label>}`. *Sharp because* it finds the case where the author
**knew** the fact and wrote it down — just not where the reader needed it.
Bare mathematics (`$g$`, `$\to$`) does not count on the caption side: notation
is not a checkable statement. It does count on the paragraph side, because a
paragraph that names its symbols is anchoring the reader.

### `metaphor-domain-collision`
One paragraph draws figurative vocabulary from two or more unrelated domains
and defines none of them.

*Defensible because* counting domains is mechanical. Deciding whether a
metaphor is **earned** is not, and is left to the judge. The exemption is
narrow on purpose: `\pdgloss`, a `definition` environment, or one of a short
list of definitional phrases. An appositive is deliberately not an exemption —
the specimen has one and is still unreadable.

### `metaphor-never-instantiated`
A figure used N or more times (default 4) in a section's prose before any
concrete token follows it.

*Defensible because* it is pure counting. Floats are excluded from the scan on
purpose: a concrete table row does not rescue the paragraph above it. Exercise
and Solution apparatus is excluded too — its bodies are masked, so what is left
is pointers and titles and counting across them measures nothing.

### `undefined-slash-pair`
`word/word` where both sides are ≥ 6 characters, the pair is not an established
technical compound, and nothing in the paragraph glosses it.

*Defensible because* the length floor does most of the work: a short pair
(`read/write`, `key/value`, `and/or`, `TCP/IP`) is almost never a house
coinage, and the floor buys more precision than an ever-growing allowlist
would. Code spans are stripped first — `\texttt{skills/harbor-research}` is a
path, not a coinage.

### `artifact-register-drift`
A Book chapter calls itself "this paper" / "the paper's".

*Defensible because* the eight sources are chapters that are **also** standalone
papers, and the Book already has the mechanism for saying so: `\ifpdbook`.
Occurrences inside an `\else` branch are skipped — that branch *is* the
standalone paper. Everything else is an unconditioned sentence that reads wrong
in one of the two artifacts it compiles into. Self-reference only: "the
legibility paper", "a systems paper", "Lamport's 1978 paper" all name some
other artifact and are none of the check's business.

### `abstraction-run`
N or more consecutive sentences (default 5) in one paragraph with no concrete
token.

*The loosest rule here, and the one to drop first.* Short sentences are
transparent: they neither join a run nor break one, so "It is not a database."
does not reward chopping and three connectives in a row do not trip the rule.
Only a sentence long enough to carry a claim (≥ 12 words) counts.

### What counts as concrete
A `\texttt`/`\path`/`\verb`/`\lstinline`; a `\pdexample`/`\pdsession` pointer;
a digit; a dotted, slashed or underscored identifier with an internal capital
(`SQLite/WAL`, `pd.daemon`, `wal_hook`); an all-caps acronym; an internally
capitalised name; inline or display mathematics.

Cross-references (`\ref`, `\cite`, `\pageref`, `\S`) are stripped **before**
every concreteness scan: a pointer to where the fact lives is not the fact.
Spelled numbers are not concrete either — "seven organs" is a count of
abstractions, not an instance of one.

---

## 4. What could not be made mechanical

Recorded here so the recall loss is on the record rather than discovered later.

- **A metaphor doing the thing it condemns.** §1.3 argues against "a flat
  noun-list of features" while listing eight nouns. Detecting that a paragraph
  contradicts its own form needs the argument, not the tokens. Judge only.
- **Whether a metaphor is earned.** Two domains in one paragraph is a signal,
  not a verdict. A carefully built extended analogy will trip the rule and
  should be waived; the script cannot tell the two apart.
- **"Tables *with discipline*."** The fifth metaphor in the specimen is moral
  character, and `discipline`, `integrity`, `honesty`, `obligation` and
  `commitment` are all literal house vocabulary in this Book (the honesty
  ledger, the `commitments` table, data integrity). A moral-character domain
  would fire on nearly every chapter. It is excluded, on the record, in the
  lexicon's `excluded_because_literal` block. Judge only.
- **Nautical metaphor in a Book about a harbor.** `harbor`, `port`, `anchor`,
  `berth`, `watch`, `manifest`, `charter` are literal here. The nautical domain
  is reduced to a handful of words the Book does not use literally. Judge only
  for the rest.
- **Definition quality.** The script can see that a definition is *present*.
  It cannot see that the definition is buried in an appositive and then
  abandoned for three sentences of figure, which is what actually happened in
  the specimen. Judge only.
- **Exercise prose.** Exercise and solution bodies are excluded wholesale: a
  prompt is compressed on purpose and leans on terms the chapter already
  defined, and including them tripled the slash-pair count with noise. Recall
  loss, recorded.
- **Whether a reader could restate the paragraph.** The whole point. Judge
  only. That is §5.

---

## 5. Layer 2: the judge pass

No keyword lists in this half. The model reads the paragraph and applies the
rubric.

### The reader you are

You are **a competent systems engineer**. You know roughly what a kernel is and
roughly what a daemon does. You have shipped software, read a database manual,
and debugged a lock. You know **none of this project's vocabulary**: not
"harbor", not "claim", not "organ", not "regimentation", not "the deontic
split", not what `pd` stands for. You are reading straight through, once, at
the pace of someone with an hour. You are not hostile and you are not stupid.
You want this to work.

### The question

Not "is this well written." Not "is this rigorous." The question is:

> **Could this reader restate what this paragraph claims, in their own words,
> after one read?**

If the honest answer is no, that is a finding, and the finding must say
**which sentence lost them** and **what to write instead**.

### The procedure

For each paragraph (start with the ones Layer 1 flagged, then sweep the rest of
the section; Layer 1's silence is not a pass):

1. **Read it once.** Once. Not twice. The second read is the author's
   privilege, not the reader's.
2. **Try to restate it in one sentence** without reusing the paragraph's own
   nouns. If you cannot, note where the attempt broke down.
3. **Locate the exact sentence** where restating became impossible. One
   sentence, quoted, not "the second half of the paragraph".
4. **Name why**, using the vocabulary below.
5. **Write the replacement.** Concrete, in the author's register, same length
   or shorter. A finding without a rewrite is a complaint.

### What to name

Use these as the `reason` field. They are prompts for judgement, not a
checklist to grep:

- `metaphor-not-cashed` — a figure the paragraph never converts into a thing
  doing something. The test: after this paragraph, can the reader name one
  concrete instance of the figure and one thing it does? If the figure is
  "organ", can they name one organ and one contract it holds?
- `metaphor-collision` — two or more borrowings that pull in different
  directions, so the reader has to hold two incompatible pictures at once.
- `self-contradicting-form` — the paragraph does the thing it argues against.
- `term-introduced-and-dropped` — a term is defined in passing (an appositive,
  a parenthesis) and the paragraph then proceeds as if the definition had done
  work. The specimen's "each a contract the daemon must hold" is the canonical
  case.
- `coinage-without-a-handle` — a compressed term (a slash-pair, a hyphenated
  noun stack, a capitalised phrase) the reader cannot decode from context and
  is not told where to look it up.
- `claim-without-an-instance` — an assertion with no example, number, file,
  command or name attached, where one would fit.
- `fact-in-the-wrong-place` — the paragraph's clearest, most checkable
  sentence is somewhere else: a caption, a table row, a footnote, the next
  section. Layer 1 finds the caption case; you find the rest.
- `register-mismatch` — the prose addresses a reader of a different artifact
  (a paper, a spec, a blog post) than the one in the reader's hands.
- `pronoun-with-no-antecedent` — "it", "this", "they" whose referent the reader
  has to reconstruct.
- `order-of-acquaintance` — the paragraph uses a term before the reader can
  possibly have it, including one defined later in the same chapter.

### Finding shape

Emit JSON; the shape matches `humanize_review.py`'s judge findings so a report
can merge both.

```json
[
  {
    "file": "whitepaper/single-writer-kernel.tex",
    "line": 439,
    "section": "The kernel as seven organs",
    "paragraph": "the full paragraph as the reader meets it",
    "losing_sentence": "the one sentence, quoted exactly, where restating became impossible",
    "reason": "metaphor-not-cashed",
    "severity": "high",
    "restatement_attempt": "the best one-sentence restatement you could manage, or why you could not",
    "explanation": "what the reader has to supply that the text did not give them",
    "rewrite": "the replacement sentence or paragraph, concrete, in the author's register"
  }
]
```

### Severity

- `high` — the reader cannot restate the paragraph at all, or would restate it
  wrongly. They will either stop or carry a misunderstanding forward.
- `medium` — the reader can restate it but only by re-reading, or by borrowing
  a fact from a caption, a later section or a figure.
- `low` — the reader gets it, but pays for it: an extra clause to parse, a
  metaphor to hold, a pronoun to chase.

### Rules for the rewrite

- Concrete beats abstract. If the caption knows the file name, the prose should
  say the file name.
- Instantiate before you generalise. One organ doing one thing, then the other
  six.
- One metaphor per paragraph, cashed, or none.
- Do not argue against a form while using it.
- Keep the author's voice. This is an editorial suggestion, not a rewrite of
  the Book into house-neutral prose. The check is the deliverable; the
  editorial act belongs to the author.

---

## 6. Corpus baseline and the honest false-positive count

Run over all eight chapters from `whitepaper/textbook.json` at the time of
writing:

| Rule | Findings | Honest read |
|---|---:|---|
| `caption-carries-the-fact` | 2 | Both true. The specimen, and `tab:invariants` in the same chapter. |
| `metaphor-domain-collision` | 3 | Both specimen paragraphs, plus one 335-word front-matter paragraph mixing *organs* and *keystone*. All defensible. |
| `metaphor-never-instantiated` | 4 | 3 × "organ" in chapter 1, "ceiling" in chapter 5. The last is borderline: "economic ceiling" is a house term doing figurative work and never given a number in its own section, which is the complaint, but an author may judge it earned. |
| `undefined-slash-pair` | 19 | ~16 are genuine house coinages (`regimentation/detection`, `memory/intention`, `execution/belief`, `capability/attenuation`). ~3 are borderline established pairings (`atomicity/consistency`, `auction/static`, `connection/channel`). Call it 85% precision. |
| `artifact-register-drift` | 92 | All true, and all **one systemic issue**: the eight chapters call themselves papers 92 times in unconditioned prose. Not 92 defects — one defect with 92 sites, and the only rule here that `grep` could have found. |
| `abstraction-run` | 29 | The weakest rule. By eye, roughly two thirds are paragraphs a reader would genuinely struggle with; the rest are abstract but clear. ~65% precision. |
| **Total** | **149** | **57** excluding the one systemic register issue. |

### What precision cost

Recall, deliberately, in six places:

1. The **moral-character** domain was dropped entirely (§4). It would have
   caught the specimen's fifth metaphor and fired on every chapter.
2. The **nautical** domain was cut to words this Book does not use literally.
3. **Exercise and solution bodies** are excluded wholesale — that is where two
   thirds of the first run's slash-pair findings came from, and none of them
   were defects.
4. `abstraction-run`'s floor was raised from 3 to 5 (252 findings → 29) and
   short sentences were made transparent rather than run-breaking.
5. **Inline mathematics counts as concrete**, which removed every
   formal-methods false positive from `abstraction-run` (45 → 29) at the cost
   of never flagging a dense symbolic passage.
6. The **slash-pair length floor** (6 characters a side) throws away every
   short coinage.

Each of those is a place Layer 2 is expected to earn its keep.

### Tuning discipline

The thresholds in `readers_eye.py` were each set by running over all eight
chapters and raising until the output was small enough that a person would read
it. Changing one without re-running the corpus makes this table a lie. Re-run
with `--summary` and update the table in the same commit.

---

## 7. Running it

```bash
# every chapter in whitepaper/textbook.json (never a hard-coded list)
python3 skills/textbook-craft/scripts/readers_eye.py --summary

# one chapter, everything, no display cap
python3 skills/textbook-craft/scripts/readers_eye.py \
    whitepaper/single-writer-kernel.tex --limit 0

# one rule, as JSON, to feed a report or the judge pass
python3 skills/textbook-craft/scripts/readers_eye.py \
    --rule caption-carries-the-fact --json

# prove the check still separates clean prose from bad prose
python3 skills/textbook-craft/scripts/readers_eye.py --selftest
```

It is **advisory** in CI (`continue-on-error: true`), for the same reason
`chapter_lint`'s floors are: a check nobody has cleaned up after must not
freeze the merge queue on the day it lands. Promote a rule to blocking one rule
at a time, once the corpus is clean for that rule.
