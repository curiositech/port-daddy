# Finding prior art across a vocabulary boundary

**Read when** writing a related-work section, checking whether a term is already
taken, or trying to establish that something is novel.

The hard case is not "I could not find it." It is "the paper exists, is
well-known in its own field, cites nothing I would find by keyword, and uses
none of my words for its own central idea." Every technique below is aimed at
that case.

## The six failures this reference exists to prevent

Real, from an audit of seven papers. Each survived multiple careful readings.

1. A paper claimed an enforceability characterization as its contribution. A
   2013 security paper had already split the alphabet into controllable and
   merely-observable actions and characterized enforceability relative to it —
   and identified the same classical result as its degenerate case. Found only
   because a *third* paper's related-work section mentioned it in passing.
2. A paper used "regimentation" as if coining it. It is a term of art in
   normative multi-agent systems meaning exactly what the paper meant.
3. A paper named a theorem "unraveling". In information economics that names a
   result with the **opposite** conclusion (full disclosure, not collapse).
4. A paper cited deontic logic's philosophical origins and nothing from the
   computational side of the same field — where the complexity results live.
5. A paper applying algebraic topology to distributed fault tolerance cited no
   Herlihy–Shavit: the founding, Gödel-Prize-winning work in that exact
   intersection.
6. Two citations were suspected fabricated. **Both were real.** The suspicion
   was the error, and it nearly caused a good source to be discarded.

Note the shape: five misses and one false alarm. Calibration has to run both
ways.

## What is worth doing for one paper

Full Kitchenham/PRISMA protocol machinery is proportionate to a survey paper,
not to one related-work section. What earns its cost every time:

- **Snowballing, two rounds, backward and forward**, from a small seed set.
  Wohlin's EASE 2014 guidelines; his own replication found snowballing from a
  good seed set reached near-equal coverage to a full database search at much
  lower cost. This is the mechanism that actually crosses vocabulary drift,
  because a citing or cited paper written by someone in the *other* field is
  exactly how you land in their terminology. `verified` that the paper is real
  and durable — EASE 2024 gave it a Most Influential Paper award.
- **Pearl growing** (Bates 1989, berrypicking): mine a strong seed paper's *own
  vocabulary* — its keywords, its subject headings, the exact phrases it uses —
  not just its citation graph. This is what catches failure #2. You do not find
  "regimentation" by walking citations; you find it by noticing the phrase
  itself is suspicious and searching it directly.
- **A one-paragraph search trail.** Which databases, which terms, which
  vocabularies, which fields you checked and found nothing in, and the date.
  PRISMA-lite. Costs nothing; it is the missing artifact in all six failures.

## The highest-yield single move: forward citation search

Once you have found *one* anchor paper in the other field, everyone who has
since cited it into fields adjacent to yours is visible in one query.

Demonstrated live during this research: querying Semantic Scholar's citations
for the 2013 paper from failure #1 returned, as its **first result**, the 2026
paper on certified runtime safety for tool-using agents — the exact class of
work the failure was about. `verified`, live API call.

```
https://api.semanticscholar.org/graph/v1/paper/DOI:<doi>/citations?fields=title,year,venue&limit=20
https://api.semanticscholar.org/graph/v1/paper/DOI:<doi>/references?fields=title,year,venue&limit=50
```

## Controlled vocabularies: the deliberate way to cross a field boundary

Free-text search fails at boundaries precisely because you lack the other
field's words. Controlled vocabularies are indexed by *what a thing is*, not by
what community wrote it.

| Vocabulary | What it is | How to cross with it |
|---|---|---|
| **ACM CCS** | Poly-hierarchical taxonomy, SKOS, tagged on every ACM paper | Find your nearest node, then browse **sibling and parent** nodes. CCS groups by what things technically are, so a supervisory-control idea and a runtime-enforcement idea can share a parent while citing each other never. |
| **MSC 2020** | ~6,000 codes; 2-digit class (68 = CS, 91 = game theory/economics), letter, subtopic. Maintained by *Mathematical Reviews* and zbMATH | If your result is really a fixed-point or order-theoretic fact, look up which class *that structure* lives in — not your field's usual class — and browse there. zbMATH Open filters by MSC directly. |
| **JEL codes** | AEA's economics taxonomy; `D82` = Asymmetric and Private Information; Mechanism Design | Failure #3 is a JEL miss. Disclosure/unraveling results sit under `D8x`, a code space no CS security author would think to browse. Browse the code family on EconLit/SSRN rather than free-text searching, since the free-text vocabulary is exactly what you lack. |
| **arXiv categories** | ~150 categories; papers **cross-list** with one primary | Browse the cross-listing pattern. `cs.GT`, `cs.MA`, `cs.LO`, `econ.TH`. Cross-lists are hand-picked as "this belongs to both readerships" — a curated bridge sitting exactly where your problem is. |

## Searching by structure rather than by name

When two fields formalize the same thing, the vocabulary diverges but the object
does not. Write down the actual mathematical object your result characterizes,
strip your field's names off it, and search generic terms for that structure.

Failure #1's real content is "split an alphabet into controllable versus
observable actions and characterize what is enforceable relative to that split"
— a security-automata idea containing no supervisory-control vocabulary at all.
Searching the structure finds it; searching the name never does.

## The tools, and their specific blind spots

| Tool | Genuinely good at | Blind spot |
|---|---|---|
| Google Scholar | Broadest coverage incl. grey literature and theses; good citation-weighted ranking | Undisclosed, unstable, personalized ranking — results are not replicable, and it cannot be queried by structured metadata. Not recommended as a sole source. |
| Semantic Scholar Graph API | Free, no key; `/citations` and `/references` implement snowballing programmatically; `openAccessPdf` gives a direct link | **`references` can return null** for a real indexed paper when the publisher restricts it — `verified` live. Unauthenticated pool is 5,000 req/5 min shared *globally*; 429s happen on cold single calls. |
| Connected Papers | Single-paper context graph via co-citation similarity | One seed at a time, static snapshot; free tier ~5 graphs/month |
| Research Rabbit / Litmaps | Multi-seed exploration, collection building, Zotero integration | Built on the *same* citation graph as everything else — cannot surface a paper that neither cites nor is cited by your seed set, which is the exact failure mode of #1–#5 |
| OpenAlex | Most complete open citation graph; algorithmic Concepts/Topics are themselves a bridging vocabulary | Successor to Microsoft Academic Graph; use `mailto=` for the polite pool |
| Crossref API | Authoritative DOI metadata, free, good fuzzy bibliographic search | Metadata only — no abstract, no full text; reference lists inconsistently deposited |
| Unpaywall | Given a DOI, finds a legal OA copy | Precision when it says OA is high (~96.6%) but **recall is poor** — misses ~15–23% of actually-open work, worse for green OA and for recent papers |
| DBLP | Authoritative CS metadata; unusually strong author disambiguation | **Title/author/venue only.** Demonstrated live: a paraphrase query returned **0 hits** for a paper the exact-title query found instantly. DBLP cannot cross a vocabulary boundary — it only finds a paper you can already name. |
| arXiv full-text search | Searches full text, not just metadata | arXiv-only. Misses fields that never preprint there — much of deontic logic's proceedings are College Publications volumes, and most pre-2000 economics is absent |
| scite.ai | Classifies *how* a citation is used, not just that it exists | Low recall on the two useful classes: one evaluation found zero "contrasting" citations where humans found 17. Treat labels as a prompt to read, not a substitute |

## Where LLM-assisted search helps, and exactly where it fails

**Helps** as a paraphrase engine: describe your idea in your own words and ask
which field calls it what. It is often right about the *field* even when it
cannot name the paper.

**Fails** at citation fabrication. Reported rates vary widely by model and
prompt — one study found ~20% fully fabricated with a further ~45% carrying
bibliographic errors; a multi-model benchmark spanned 14–95%. `probable`; the
ranges genuinely differ across studies.

**Fails in a subtler way** that matters more here: it will confidently confabulate
that a term is a novel coinage rather than recognising it as taken, because
pattern-completing a fluent related-work sentence is a different operation from
verifying prior use.

**Rule:** good for redirecting *which* community or vocabulary to search;
never a source of citations. Resolve every suggestion independently.

## Verification discipline

**Control-test the identifier.** A same-shaped fake reliably 404s where a real
one resolves. `verified` live:

```
api.crossref.org/works/10.1145/9999999.9999999  → 404
api.crossref.org/works/<real doi>               → 200
arxiv.org/abs/9999.99999                        → 404
arxiv.org/abs/<real id>                         → 200
```

One extra request. Do it every time you assert an identifier is real — and note
that failure #6 was the *opposite* error, so this check protects against
groundless suspicion as much as against fabrication.

**OA flags are unreliable in both directions.** A `CLOSED` status can be wrong,
or can mean only that the publisher gave the indexer nothing while a legal
preprint sits on an author page. An `open` flag can point at a supplementary
file, a preprint that differs from the published version, or a stale URL. During
this program a record advertised as green OA by two independent services turned
out to hold **no file at all** (`files: []`, not embargoed). Open the PDF.

**A reference-list appearance is not verification.** It confirms only that
someone believed the reference existed. It does not confirm the paper says what
you are about to claim, and an LLM-assisted draft can insert a plausible
fabrication into a normal-looking bibliography.

**Read hypotheses, not abstracts, when comparing results.** Abstracts sell
generality and compress scope. The difference between two results almost always
lives in a hypothesis, and hypotheses are rarely in abstracts. Failure #3 is
exactly this: an abstract-level skim never reveals that the named result
concludes the opposite of what the English word suggests.

## The naming check

Run **before** a term goes into a paper as if newly coined.

1. **Quote-search the exact phrase** — in quotes, unstemmed — across Scholar,
   Semantic Scholar, and general web. This alone catches most true prior use.
2. **Check it against the controlled vocabulary of every adjacent field.** A
   term can be common *within* a community's venues while invisible to keyword
   search that never enters them.
3. **If a hit comes back, read the actual definition.** A same-spelled term can
   be adjacent-but-different (harmless) or in outright tension with your sense.
4. **Decide: adopt, gloss, or rename.**
   - **Adopt** when it is genuinely the same thing. Usually right, and it
     converts a missed-prior-art risk into a free citation of the founding work.
   - **Gloss** when related but not identical — keep your term, state theirs
     accurately, say how yours differs.
   - **Rename** when the existing sense would mislead, and *immediately* when it
     is contradictory rather than merely adjacent. Silent adoption of a term
     whose established meaning is the opposite of your intent will actively
     mislead every reader who knows the field.
5. **Record the check.** One line: searched X, Y, Z for the phrase, no prior use
   found as of <date>.

## The protocol, end to end

1. State the structural core of your result in field-neutral terms. Write it
   down **before** searching anything.
2. Run keyword searches with both your field's vocabulary and that neutral
   description.
3. Identify the single strongest adjacent paper found, even if imperfect. Seed.
4. Pearl-grow: extract the seed's own terms, re-run step 2 with those.
5. Snowball two rounds — backward via references (fall back to Crossref or the
   publisher page when the API elides them), forward via citations. Stop when a
   round adds nothing.
6. Identify the one or two adjacent fields your idea structurally belongs to.
   For each: find the review article or handbook chapter, and browse its
   controlled vocabulary one level around your topic, reading for your concept
   under a different name.
7. Run the naming check on anything you were about to present as a coinage.
8. For every reference that will appear: resolve the identifier with a control
   test, open the actual PDF, read the hypotheses.
9. Write the one-paragraph search trail.
