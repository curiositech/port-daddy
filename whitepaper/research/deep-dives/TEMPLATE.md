# Template: starting a new deep dive

Read `README.md` first — "The two dive patterns" explains when to use each
skeleton below. Pick one, copy it into a new `flag-N-<slug>/` or
`paperN-<slug>/` folder, and delete this note from the copy.

Both patterns share three rules, stated in full in `README.md`'s "The rules
every dive runs under": read the primary source (never infer from an
abstract), quote the competing theorem verbatim with its own hypotheses, and
label every claim's confidence (`verified` / `probable` / `uncertain` /
`UNRESOLVED`) — only `verified` may enter a `.tex` file. And every dive ends in
one of the four verdicts (CLEAR / NARROW / SUBSUMED / CONTRADICTED), written at
the top of `findings.md` before the evidence.

## Skeleton A — planned dive

Use this when the risk is narrow enough to hand to someone (or something) with
no other context: one named competing result, one suspect citation, one
open question. Add the new folder's row to `README.md`'s flag table and index.

```
flag-N-<slug>/README.md
```

```markdown
# Flag N — <short description of the risk>

**Paper**: <number>, *<title>* (`whitepaper/research/tex/paperN.tex`)

**Risk**: <how bad is it if this is real — CONTRADICTED live or not>

## The claim under test

<Quote the paper's theorem/claim verbatim, with its \label and line range.>

## The competing result

<What the sweep or a prior read surfaced, and how confident you actually are
in that characterization — most "the literature already proves this" claims
came from someone who never read the source; say so if that's true here.>

## Where the resolution probably lives

<Structural differences visible without reading anything yet — hypotheses,
scope, what would make the conflict dissolve or hold.>

## What a resolution looks like

`findings.md` opens with CLEAR / NARROW / SUBSUMED / CONTRADICTED, then the
competing result quoted verbatim, a hypothesis-by-hypothesis comparison, and
(if CLEAR/NARROW) the exact citation + "how we differ" sentence ready to paste
into the paper's Related Work.
```

```
flag-N-<slug>/reading-list.md    — sources in priority tiers: what to read
                                    first, and why it's decisive rather than
                                    corroborating. Note retrieval routes tried.
flag-N-<slug>/questions.md       — Q1..Qn the read must answer, most decisive
                                    first. Q1 should be the one question that,
                                    answered either way, resolves the most.
flag-N-<slug>/prompt.md          — the verbatim prompt for whoever runs this
                                    dive: model tier, "be adversarial toward
                                    the paper, a finding it's wrong is success
                                    not failure," what to read first, the
                                    method (WebSearch/WebFetch primary-source
                                    routes, control tests for suspect IDs),
                                    and the output contract (verdict format,
                                    confidence labels, no invented citations).
flag-N-<slug>/skills.md          — which of this repo's skills apply and why
                                    (e.g. falsification-first for the
                                    adversarial pass, finding-prior-art for
                                    the search discipline).
flag-N-<slug>/findings.md        — filled in by the dive. Verdict first.
```

Before handing a planned dive to another reader, verify the scaffold rather
than trusting the copy step. From `whitepaper/research/deep-dives/`, run:

```sh
for f in README.md reading-list.md questions.md prompt.md skills.md findings.md; do
  test -f "flag-N-<slug>/$f" || { echo "missing: $f"; exit 1; }
done
```

Do not dispatch a planned dive until that check is silent. The direct-dive
pattern below deliberately has a different, two-file contract.

## Skeleton B — direct dive

Use this when you (the calling session) are running the read-plus-falsification
pass yourself, in one sitting, against a whole paper rather than one named
risk — no separate brief to hand off. Add the new folder's row to `README.md`'s
"The direct dives" table.

```
paperN-<slug>/README.md
```

```markdown
# `paperN-<slug>` — index

**Paper**: <number>, *<title>* (`whitepaper/research/tex/paperN.tex`)

**Dive run**: <date>. <One clause on scope: whole paper / specific theorems.>

**Verdict**: <CLEAR / NARROW / SUBSUMED / CONTRADICTED, one per theorem if the
paper has several — match `findings.md`'s own top line exactly, this file must
never drift from it.>

<One paragraph summarizing the headline finding — the sentence someone
skimming the directory listing needs to decide whether to open findings.md.>

See `findings.md` for the full verdict table, quoted competing theorems, and
open items.
```

```
paperN-<slug>/findings.md   — same contract as the planned-dive findings.md:
                               verdict first (per claim if there are several),
                               then evidence, an "internal defects" section for
                               anything the falsification pass caught that no
                               literature search would (these are consistently
                               the highest-value findings in the corpus so
                               far — do not skip the adversarial re-read of the
                               paper's own arithmetic just because the prior-art
                               search came back clean), and an "open items" list
                               for anything left `UNRESOLVED`.
```

## After the dive: propagate, don't just record

A verdict that only lives in `findings.md` is not done — it has to reach every
site in the actual `.tex` file (and its figure fragments) that echoes the
corrected claim: the express lane, the one-breath sentence, theorem boxes,
table cells, TikZ node text, captions. See
`whitepaper/reviews/current/exposition/CROSS-DOCUMENT-SYNTHESIS.md`'s pattern
B1 for how often this step gets missed, and run
`scripts/harbor-research/check_propagated_corrections.py` after editing to
check no stale site survived. If the dive added or upgraded a citation's
confidence to `verified`, also update `BIBLIOGRAPHY.md` and re-run
`scripts/harbor-research/check_citations.py`.
