# Thesis-plate candidates: a proposal, not a placement

This is a **briefs-only proposal**. Nothing is implemented. No image was
generated. No `.tex` chapter source was touched. Everything below is a
written recommendation for a human (or a follow-up session with an
image-generation tool) to execute.

## Why briefs-only

This session has a working LaTeX toolchain (`xelatex`, `pdflatex`,
`latexmk` are all installed, and `scripts/build-whitepapers.sh
coordination-papers-mega-volume` builds the 551-page canonical PDF
cleanly) but **no image-generation capability**. The book's existing
plates were made with Google's Nano Banana models through the
`nano-banana-image-gen` skill, which calls the Gemini API using a key
that "lives only in the generating session's environment" (see
`website-v2/public/whitepaper/plates/README.md`). No such key
(`GEMINI_API_KEY`, `GOOGLE_API_KEY`, or similar) is present in this
session's environment, and no MCP tool in this session's tool list
generates images either. So step 4 of this task — "implement 1-2 of the
strongest candidates end-to-end" — is not something this session can do
honestly. What follows is the brief that a session *with* that
capability would need to execute each candidate, plus the exact `.tex`
wiring and page math worked out against the real, compiled book.

## The book's actual plate system (read before designing anything)

Three findings that shaped every brief below:

1. **Three editions, one canonical.** The Book has three fully-built
   typographic "characters" — maritime (`plates/*.jpg`, a faded
   watercolour wash: "one colossal, smooth, unearthly presence... and
   one small everyday thing beneath it, tiny and exact"), Swiss
   (`plates/swiss/*.jpg`, flat hard-edged colour blocking in the
   Müller-Brockmann/Armin Hofmann register, a hairline near-black
   construction grid, signal red rationed to three plates total), and
   technical (`plates/technical/*.jpg`, 1960s-engineering-report
   exploded/cutaway drawings). `\pdedition` defaults to **`swiss`**
   (`coordination-papers-mega-volume-preamble.tex:153`), and
   `scripts/build-whitepapers.sh` confirms `coordination-papers-mega-volume.pdf`
   — the one file the site actually serves — **is the Swiss edition**.
   The briefs below are written against the Swiss idiom because that is
   the book people actually read; a maritime-wash alternative is noted
   for each candidate in case the author would rather match that
   edition instead.
2. **The old "collected treatise" jacket art is gone.** The example the
   task prompt names, `art/collected-volume/collected-treatise-inside-jacket.jpg`,
   was retired and deleted (`changelog.d/10171-whitepaper-tree-cleanup.md`);
   `whitepaper/art/` and `whitepaper/plates/` (singular, non-`website-v2`
   paths) don't exist in this tree. The live convention is entirely under
   `website-v2/public/whitepaper/plates/`.
3. **No recto/verso mechanism exists at all.** The document class is
   `article` (`documentclass[11pt,a4paper]{article}` —
   `coordination-papers-mega-volume.tex:1`), which is one-sided by
   default, and there is no `\cleardoublepage`, `\ifodd\value{page}`, or
   any other parity-aware macro anywhere in the four preamble/seam/
   appendix files. Every plate insertion point (`\pdchapter`, `\pdpart`)
   uses plain `\clearpage`, which just starts a fresh page wherever the
   content happens to land. **This means a naive one-page plate
   insertion will not reliably face the sentence it is meant to face,
   and it silently reshuffles every following page's odd/even side.**
   The mechanism proposed below (§"The wiring") is designed specifically
   to solve this without adding that global mechanism, by making each
   insertion a self-contained, parity-correcting block.

## How the pages below were found

`scripts/build-whitepapers.sh coordination-papers-mega-volume` was run
in this worktree to produce a fresh, current
`coordination-papers-mega-volume.pdf` (xelatex, 551 pages, clean build,
no errors). `pdftotext -layout` extracted the text with page breaks
intact, and each candidate phrase was located by physical PDF page index
(page 1 = the cover, so **odd physical pages are recto/right, even
physical pages are verso/left** — this is the actual binding fact,
independent of whatever folio number `\thepage` prints in the corner).
The rebuilt PDF was **not** committed; the working tree's checked-in
`coordination-papers-mega-volume.pdf` is untouched by this session
(confirmed: `git diff` on that file after the build showed only a
byte-identical-content rebuild, which was reverted).

---

## The confirmed phrase

> **"What Morality Means When Death Is Cheap"**

`website-v2/public/whitepaper/agent-transactions-whitepaper.tex:740`
(section heading), chapter 7, *The Bonded Commons*. The sentence(s) worth
a plate are the ones right under it:

> "Agent death in this system is not an existential event—it is a
> temporary inconvenience. The agent's body (process) is destroyed, but
> its mind (evidence trail) survives in the commons. A successor reads
> the trail and continues. Like Hickman's Krakoa—the *House of X*
> storyline in which mutant minds are literally backed up to a database
> (Cerebro) and restored into freshly grown bodies on death—the
> information survives the vessel."
> — `agent-transactions-whitepaper.tex:742`

**Compiled location:** PDF page **358**, VERSO (left page).
**Confidence this is plate-worthy: very high.** It is the chapter's own
named section, it is quoted verbatim in the chapter's own reader map
(`agent-transactions-whitepaper.tex:257`), and it does real conceptual
work no other sentence in the book does — it states the book's whole
"a spawn owes nothing until something survives" argument as a single
resurrection image (a mind backed up, a body regrown, the vessel
disposable). It is not already sitting next to a figure: the table that
follows it (Table 7.4, the severity hierarchy) is a data table, not an
illustration, and it currently sits on page 359 — see the spread math
below for what happens to it.

---

## Seven more candidates, one per remaining chapter

Editorial judgment call: rather than force multiple plates onto one or
two chapters, each of the other seven chapters got a sweep for its own
single most thesis-carrying, most visually translatable sentence — the
kind that would work as a pull-quote or an epigraph, not merely a
sentence that mentions something visual. Several `\pdthesis{}`-boxed
sentences (the book already typographically marks certain sentences as
its own thesis statements) were strong prose but too abstract/technical
to translate into an image (e.g. "the kernel is a single-writer
transactional reference monitor over a local SQLite/WAL database" —
correct and important, not a picture); those were passed over in favor
of the chapter's more *image-bearing* line.

### 1 — The Single-Writer Kernel (Part I, Ground Truth · `pdcobalt` `#003FB8`)

> "...the one process that mediates contended resources, and the one
> place where 'true' is decided rather than asserted."
> `whitepaper/single-writer-kernel.tex:300-301` (the chapter's own
> "one-sentence thesis," §1.1.1)

**PDF page 20, VERSO.** Facing page 21 (recto) is plain continuing prose
— no figure conflict. **Confidence: medium.** It is genuinely the
chapter's thesis and the whole book's foundational claim ("Ground
Truth"), but it is more philosophical than pictorial; the brief below
leans on the "one authority-bearing plane" abstraction rather than
literalizing "truth."

**Art direction (Swiss idiom):** One flat cobalt rectangle fills nearly
the whole plate — a single plane, no internal subdivision except the
hairline near-black construction grid crossing it edge to edge. Cut one
small paper-white notch into the rectangle's edge, where exactly one
line enters and one line exits (the one write path in, the one committed
record out). No crowd of competing shapes and no second color: the
composition's whole argument is that there is exactly one
authority-bearing plane on the page, the way there is exactly one writer
in the chapter.

*(Maritime alternative: the small everyday object is a single lighthouse
keeper's logbook, closed, on an otherwise empty stone sill; the colossal
presence is a single vast, silent tide filling the harbor behind it.)*

### 2 — The Anchor Protocol (Part I · `pdcobalt` `#003FB8`)

> "Port Squatting (The 'Ghost in the Harbor'): If Agent A crashes, a
> malicious or malfunctioning Agent B can bind to Agent A's previously
> assigned port, intercepting traffic meant for A."
> `website-v2/public/whitepaper/anchor-protocol-whitepaper.tex:203`

**PDF page 87, RECTO.** **Confidence: high** — this is the single most
maritime-native, most literally illustratable phrase found in the whole
sweep; "Ghost in the Harbor" was coined by the chapter itself as a
parenthetical name for the failure mode, which is as close to an
author-endorsed plate caption as this book gets.

Note on placement: the facing page under the naive rule would be page
86, but page 86 **is the chapter's own Swiss opener page** — it already
carries the chapter's Swiss plate (`plates/swiss/chapter-anchor.jpg`)
inline via `\pdswissplate` inside `\pd@chapter@swiss`. A second plate
cannot go there without literally duplicating art on the same page. The
two-page spread mechanism below (§"The wiring," recto case) sidesteps
this automatically: it inserts a brand-new page pair *between* the
existing pages 86 and 87, so it never touches the chapter-opener page at
all.

**Art direction (Swiss idiom):** A cobalt harbor-slip silhouette — a
plain hard-edged berth rectangle — with one empty rectangle at its
center, drawn as outline only (paper-white interior, near-black
hairline stroke): the vacated slip. A second, smaller solid cobalt shape
overlaps the outline's boundary at a diagonal, mid-intrusion. This is
one of the few plates in the new set that could reasonably claim a
sliver of the book's rationed signal red (README.md notes red is kept to
three plates total across the whole Swiss set) — on the boundary line
the intruding shape crosses, since "an unauthorized crossing" is exactly
what red is for in this palette.

### 3 — The Sealed Harbor (Part I · `pdcobalt` `#003FB8`)

> "...how do I know the wall has no other holes?"
> `website-v2/public/whitepaper/sealed-harbor.tex:221-222`

**PDF page 130, VERSO.** Facing page 131 (recto) is plain continuing
prose — no conflict. **Confidence: high.** It is the security officer's
own question, quoted verbatim, framing the entire chapter's four
provable claims; it is concrete, has an obvious "wall" referent, and it
sits comfortably distant from every existing figure and table in the
chapter (checked: nothing on pages 129-131 besides one comparison
table).

**Art direction (Swiss idiom):** A single solid cobalt block fills
nearly the whole plate — the sealed wall — broken by exactly one small
paper-white rectangular slot near one edge: the one gate. The hairline
grid runs across the wall's face on both sides of the slot but never
crosses through it. No other openings, no texture, no shading inside the
block — the plate's flatness *is* the "no other holes" claim, rendered
literally as a picture with nothing else in it.

### 4 — The Legible Swarm (Part II, The Cost of Seeing · `pdteal` `#006B5F`)

> "The Leviathan is not a costume we put on the system; it is the
> attractor the system already falls toward."
> `whitepaper/legible-swarm.tex:441-442`

**PDF page 159, RECTO.** **Confidence: high.** This was chosen over the
chapter's own boxed `\pdthesis` ("Read-poverty, not write-contention...")
because that sentence's natural facing page (187) already carries Figure
4.5, a real technical chart — exactly the "already sitting next to an
existing figure" case this sweep was told to avoid. The Leviathan-costume
line is also, on its own merits, the more strikingly quotable of the
two: it reframes the chapter's whole Hobbesian metaphor as *not
decorative* in one clean antithesis (costume vs. attractor), which is
rarer and more pull-quote-worthy than a (correct, important, but dry)
information-theoretic claim.

Note: the same paragraph gestures at "Figure 4.1" on the very next page
(160) — that figure is a literal Gantt chart of a coordination scenario,
not an illustration of the Leviathan metaphor, so it does not duplicate
the plate; the two-page spread mechanism (recto case) also places the
plate a full spread earlier than Figure 4.1, so they don't collide.

**Art direction (Swiss idiom):** A teal plane with a loose scatter of
small hard-edged shapes in the upper portion (agents, off the grid,
disordered), each connected by a straight hairline vector converging on
one solid teal mass low in the frame that every line terminates at. No
crown, no cloak, no figure wearing anything — the point of the sentence
is that there is no costume, only a shape everything already falls
toward.

### 5 — From Spawn to Person (Part III, What Survives the Restart · `pdviolet` `#933FA5`)

> "A spawn does work and disappears. A person does work and *stays* —
> and only what stays can be priced. The harbor's whole economy is the
> machinery for manufacturing, and then formally grading, a self."
> `website-v2/public/whitepaper/spawn-to-person.tex:3099-3101`

**PDF page 285, RECTO.** **Confidence: very high** — this is, along with
the confirmed "Death Is Cheap" phrase, the strongest candidate in the
whole sweep. It is the chapter's closing thesis (the last `\pdthesis` in
the paper, immediately before the appendix), it names the chapter's
title outright ("spawn" / "stays" — i.e. person), and "manufacturing,
and then formally grading, a self" is an image no other sentence in the
book gives you: a self as a manufactured, quality-graded object.

**Art direction (Swiss idiom):** A violet plane divided by the hairline
grid into a repeating row of identical flat rectangles — a production
line of interchangeable blank units, each one the same size, same tone.
All but the last are left as plain outline/paper-white units; the last
one in the row is filled solid violet — the one that stayed, the one
"formally graded" into something that can be priced. No faces, no
figures: the self is represented structurally, as the sole unit in the
row that persisted past the vanishing point the others fall off of.

### 6 — The Harbor Economy (Part IV, Trade Between Strangers · `pdgold` `#666A00`)

> "You don't sell crypto — crypto is the substrate; you sell hosted
> trust: a verified ledger, a relay, and a reputation system that lets
> mutually-distrustful fleets transact across a boundary they do not
> share."
> `website-v2/public/whitepaper/harbor-economy.tex:364-366`

**PDF page 292, VERSO.** Facing page 293 (recto) continues the C1-C3
claims list, no figure — Figure 6.1 (the chapter's own reader-map
artifact) is two pages further on (294), clear of the new plate's
spread. **Confidence: medium-high.** It is the chapter's opening thesis
and its most frequently recalled line (restated almost verbatim at
`harbor-economy.tex:1603` as a callback in §6.11); it is somewhat more
abstract than the others ("substrate" vs. "product" is a category
distinction, not an object), so the art direction below leans on a
container/contained composition to make that concrete.

**Art direction (Swiss idiom):** Two adjoining gold-and-paper planes: a
small hard rectangle (the settlement rail — what "crypto" is, here) sits
inside a much larger enclosing rectangle (hosted trust — the ledger, the
relay, the reputation system) built from the same hairline grid, so the
two visibly belong to one structure. The small rectangle is clearly the
lesser, contained part; the large one is what fills the page.

### 7 — The Bonded Commons — see "The confirmed phrase" above.

### 8 — The Federated Harbor (Part IV · `pdgold` `#666A00`)

> "The trick is not to extend a single sovereign across machines. The
> trick is to admit there are two and to specify what they owe each
> other."
> `website-v2/public/whitepaper/federated-harbor-whitepaper.tex:245`

**PDF page 407, RECTO.** **Confidence: high.** It closes the book's own
central argument for its final chapter, restates the chapter's Robert
Frost epigraph ("Good fences make good neighbours") as a working design
rule, and — unusually for this set — its correct image is a *symmetric*
one, which sets it apart visually from the seven chapters that came
before, matching the fact that federation is genuinely the odd chapter
out in the book's argument (every other chapter builds one authority;
this one admits there have to be two).

**Art direction (Swiss idiom):** Two equal solid gold blocks, side by
side, separated by a single hard vertical hairline (the trust boundary —
the "fence"). A small paper-white token shape crosses through a narrow
gap cut in that line, connecting the two blocks — evidence crossing, not
sovereignty. Unlike every other plate in this set, deliberately do
**not** let one shape dominate the frame; the whole point of the
sentence is that neither side is a costume for a missing single
sovereign.

---

## The wiring: how a plate actually gets its own facing sentence

This is the part of the task most likely to be gotten wrong by just
dropping an `\includegraphics` before a paragraph, so it is worked out
in full even though nothing here is being committed.

**The physical fact that matters:** page 1 of the PDF is recto (right).
Every odd physical page is recto; every even one is verso. A book opened
to any spread always shows an even (left) page and the next odd (right)
page together — pairs `(2,3), (4,5), (6,7), ...`. Because the document
class is one-sided `article` with no `\cleardoublepage` anywhere, **any
content inserted before a given page shifts that page's number, and
therefore can flip its recto/verso side**, unless the inserted block's
page count is chosen to prevent that. This is exactly the problem the
task asked to be worked out, and the fix is different for the two cases:

**Case A — target sentence is on a VERSO (even) page.**
The book already opens onto this page with a recto page immediately
*after* it. Inserting exactly **one** new page immediately *after* the
paragraph containing the sentence lands the new page at the very next
(now-recto) slot automatically — the target page itself never moves, so
its side never changes. No parity arithmetic needed; one `\clearpage`
does it.

```latex
% Insert immediately after the paragraph containing the target sentence.
% #1 = plate image path. Pass an empty {} for #2 to omit the credit line.
\newcommand{\pdthesisplate}[2]{%
  \clearpage\thispagestyle{empty}\pagecolor{hhpaper}\color{hhink}%
  \vspace*{\fill}
  \begin{center}\includegraphics[height=0.86\textheight,width=\textwidth,keepaspectratio]{#1}\end{center}
  \vspace*{\fill}
  \def\pdtmp{#2}\ifx\pdtmp\empty\else{\footnotesize\itshape\color{hhgray}#2\par}\fi
  \clearpage\nopagecolor\color{hhink}%
}
```

Applied to the confirmed candidate (verso, page 358), this would go
immediately after `agent-transactions-whitepaper.tex:742` ("...the
information survives the vessel."), before "This raises a question..."
resumes on line 744:

```latex
\pdthesisplate{plates/swiss/thesis-morality.jpg}{}
```

Verified page math: original layout is `...357(recto,unrelated)
358(verso,TARGET) 359(recto,Table 7.4)...`. Inserting one page after 358
gives `...357(unchanged) 358(unchanged,TARGET) 359=NEW PLATE(recto)
360=old-359(Table 7.4, now verso)...` — the plate lands exactly at 359,
facing the target at 358, and Table 7.4 (a data table, not a duplicate
illustration) simply moves one page later with no other effect.

Same mechanism, same math, for candidates 1 (kernel, p.20), 3 (sealed
harbor, p.130), and 6 (harbor economy, p.292) — all verso targets.

**Case B — target sentence is on a RECTO (odd) page.**
Here a single inserted page *cannot* work: inserting one page
immediately before the target shifts the target itself forward by one,
flipping it from recto to verso — which breaks the pairing rather than
fixing it (the plate would end up facing whatever used to precede the
*old* position, not the target at all). The fix used in fine printing
for exactly this situation — and the one this book's own Swiss part
opener already uses, deliberately, to avoid rippling parity through the
rest of the book (`\pd@part@swiss` always spends **two** pages per part,
plate + facing chapter list, never one) — is to insert an **even**
number of pages. Two is the minimum, and the second page doesn't have to
be wasted: it can carry the quoted sentence itself, set large, as a
proper pull-quote leaf facing nothing in particular, with the full plate
on the page after it, facing the target.

```latex
% Insert immediately BEFORE the paragraph containing the target sentence.
\newcommand{\pdthesisspread}[3]{% #1 = the quoted sentence, #2 = its source label, #3 = plate image path
  \clearpage\thispagestyle{empty}\pagecolor{hhpaper}\color{hhink}%
  \vspace*{\fill}
  \begin{center}\begin{minipage}{0.72\textwidth}\centering
    {\pdpartface\itshape\fontsize{20}{26}\selectfont #1\par}
    \vspace{0.5cm}
    {\footnotesize\scshape\color{hhgray}#2\par}
  \end{minipage}\end{center}
  \vspace*{\fill}
  \clearpage\thispagestyle{empty}\pagecolor{hhpaper}\color{hhink}%
  \vspace*{\fill}
  \begin{center}\includegraphics[height=0.86\textheight,width=\textwidth,keepaspectratio]{#3}\end{center}
  \vspace*{\fill}
  \clearpage\nopagecolor\color{hhink}%
}
```

Applied to candidate 2 (Anchor Protocol, recto, page 87), inserted
immediately before `anchor-protocol-whitepaper.tex:203` ("Port
Squatting..."), i.e. right before the enumerate block starts at line
202:

```latex
\pdthesisspread{Port Squatting (The ``Ghost in the Harbor''): if Agent~A
crashes, a malicious or malfunctioning Agent~B can bind to its
previously assigned port.}{The Anchor Protocol, \S2.1}{plates/swiss/thesis-ghost-in-harbor.jpg}
```

Verified page math: original layout is `...85 86(verso,chapter-opener,
ALREADY HAS A PLATE) 87(recto,TARGET) 88...`. Inserting two pages
immediately before 87 gives `...85 86(unchanged, opener plate intact)
87=NEW pull-quote leaf(recto) 88=NEW PLATE(verso) 89=old-87(TARGET, now
recto — correct side, unchanged parity) 90=old-88...`. The new plate at
88 faces the target at 89; the chapter-opener plate at 86 is never
touched, so nothing is duplicated. Same mechanism for candidates 4
(legible swarm, p.159), 5 (spawn-to-person, p.285), and 8 (federated
harbor, p.407) — all recto targets.

**One more real consequence worth flagging to whoever executes this:**
every page after an insertion point shifts by the block's size (1 or 2
pages), for the rest of the book. That is harmless here because nothing
in this book's `.tex` sources hard-codes an absolute page number
anywhere — every cross-reference is a `\ref`/`\pageref`/`\hyperref`
that recompiles correctly — but it does mean **every candidate below
the first one implemented must be re-measured against a fresh rebuild**
before its own plate is wired in, since earlier insertions shift later
chapters' physical page numbers (though never their recto/verso parity,
since each insertion block was chosen specifically to preserve the
parity of everything after it — 1 page after a verso target, 2 pages
before a recto target, both of which leave the *total* pages added
before any later chapter at an even count as long as the four spread
insertions in Part I plus one in Part II land in the expected order;
this should be double-checked by rebuild, not assumed, if more than one
plate is ever wired in the same pass).

---

## Status of this deliverable

| Item | Status |
|---|---|
| Confirmed the human's phrase and its exact location | **Real** — verified against chapter source and a fresh, clean rebuild of the actual 551-page PDF |
| 7 more candidate phrases, one per remaining chapter | **Real** — each is a verbatim quote with file:line, verified against the rebuilt PDF's physical page and recto/verso side |
| Art-direction briefs (8) | **Proposed** — written, matched to the book's actual established Swiss idiom (colour, hairline grid, rationed red), not generated |
| Actual plate images | **Not created** — no image-generation tool or API key is available in this session |
| `.tex` wiring | **Proposed, not applied** — `\pdthesisplate` / `\pdthesisspread` are sketched above and worked out against real page numbers, but neither macro exists in any chapter source; no `.tex` file under `whitepaper/` or `website-v2/public/whitepaper/` was modified |
| A rendered two-page-spread proof | **Not possible without the plate images** — nothing to verify |

This document is the complete, ready-to-execute brief. A follow-up
session with Nano Banana (or another image tool) access can generate
the eight plate images from the art-direction paragraphs above, drop
them at the paths named in the wiring section, add the two macros to
`coordination-papers-mega-volume-preamble.tex`, apply the eight
one-line invocations at the cited source locations (recto cases first,
since each affects the page count everything after it inherits), rebuild
with `scripts/build-whitepapers.sh coordination-papers-mega-volume`, and
render the resulting spreads to confirm each phrase and its plate really
do face each other.
