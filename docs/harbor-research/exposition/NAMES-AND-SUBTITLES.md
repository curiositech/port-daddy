# Names and subtitles the book has carried

Every title, subtitle, spine sentence, part name, chapter subtitle, one-line
claim, question, epigraph and edition label the coordination papers and their
book have worn, mined from git history on 2026-09-06 so favourites can be
chosen later rather than remembered. Verbatim wording; first and last seen as
date and short sha; "current" means live on the Textbook Edition branch.

## A. The book: titles

| variant | first seen | last seen | where |
|---|---|---|---|
| The Harbor Volume — Paper N of 4 / A Four-Paper Series | 2026-06-05 `6dabd7451` | 2026-06-20 `875ede535` | chapter `\title`s |
| The Harbor Volume --- four Floors (explain) × four Beams (prove) | 2026-06-12 `348a5ac18` | 2026-06-15 `1fa1d1555` | single-writer-kernel.tex |
| Port Daddy Coordination Papers | 2026-08-04 `d195fb1c3` | current (running head) | mega-volume.tex |
| The Collected Coordination Papers | 2026-08-04 `d195fb1c3` | 2026-08-23 `2ba707c83` | mega-volume.tex |
| The Port Daddy Coordination Papers | 2026-08-23 `96a4030f8` | 2026-08-30 `6efd3dd9f` | whitePapers.ts |
| The Harbor, the Person, and the Economy | 2026-08-19 `84f635d5f` | current | mega-volume.tex, textbook.json |

## B. Subtitles and spine sentences

| variant | first seen | last seen | where |
|---|---|---|---|
| Seven cross-referenced chapters on local authority, legibility, continuity, capability security, bonded cooperation, and federation | 2026-08-04 `d195fb1c3` | 2026-08-23 | mega-volume.tex |
| A Unified Architecture for Accountable Autonomous Multi-Agent Work | 2026-08-19 `84f635d5f` | 2026-08-29 `4474d4e57` | mega-volume.tex |
| Seven cross-referenced treatises on local effect hypervisors, evidence-bearing work units, capability attenuation, multi-hop delegation, bounded underwriting, and federated institutions | 2026-08-19 `84f635d5f` | 2026-08-29 `4474d4e57` | mega-volume.tex |
| Seven papers on accountable autonomous work | 2026-08-30 `6efd3dd9f` | 2026-09-06 | mega-volume.tex |
| A textbook of accountable autonomous work | 2026-09-06 `6b1b6693e` | current | textbook.json |
| Autonomy scales only when authority, evidence, and consequence remain coupled at every effect boundary. | 2026-08-30 `6efd3dd9f` | current | title page (`edition.claim`) |
| This book follows that claim from one operator and one machine to work shared across principals, economic interests, and mutually distrustful systems. | 2026-08-30 `6efd3dd9f` | 2026-09-06 | mega-volume.tex |
| This book follows that claim from one machine and one operator to work shared across principals, economic interests, and mutually distrustful systems. | 2026-09-06 `175f3e753` | current | imprint page |
| Eight chapters, in dependency order, on accountable autonomous work | 2026-09-06 | current | `pdfsubject` |
| Seven chapters in one coherent volume, with a global introduction, collated contents and references, implementation ledger, notation concordance, and research roadmap. | 2026-08-23 `96a4030f8` | 2026-08-30 | whitePapers.ts |
| Seven papers on accountable autonomous work, unified by one claim: authority, evidence, and consequence must remain coupled at every effect boundary. | 2026-08-30 `6efd3dd9f` | 2026-09-06 | whitePapers.ts |

The library spine, unchanged since 2026-08-05 (`1cad994e3`): *Memory makes continuity; continuity makes a person, not a spawn; a person accrues a record; a record is reputation; reputation is a tradeable asset; and tradeable assets make a market.*

## C. Part names

Two naming systems have been live together since `6b1b6693e` (2026-09-06):

| numeral | seams-file name | textbook.json title |
|---|---|---|
| I (`machine`) | The Machine | Ground Truth |
| II (`operator`) | The Operator | The Cost of Seeing |
| III (`person`) | The Person | What Survives the Restart |
| IV (`market`) | The Market | Trade Between Strangers |

Part I blurb at `102ed1d4f`: "Two chapters build the machine that the rest of the book holds to account" became "what runs on its behalf runs in a sealed room. Three chapters build the machine…".

Predecessor vocabulary (2026-06-12 `348a5ac18` to 2026-06-15 `1fa1d1555`): **Floor 1 · Kernel — the foundation slab** / *Refusing the consensus problem: one writer, one file, and what falls out.* / **Floor 2: Legibility** / **Floor 3: Personhood** / **Floor 4 — Economy (L3, the trading floor)** / **Beam C: Federated Harbor**.

## D. Per chapter (current order; former numeral in brackets)

### 1. The Single-Writer Kernel [II]
- Subtitle: "A Local Transactional Reference Monitor for Agent Swarms" (2026-06-05 `6dabd7451`, never changed).
- Site subtitle: "The small, stubborn program at the bottom that decides what is true — one writer, one machine, one durable file, no distributed consensus."
- Tagline (2026-06-12 only): "Floor 1 · Kernel — the foundation slab. *Refusing the consensus problem: one writer, one file, and what falls out.* ■ built"
- One-line: "One writer, one durable file, decides what is true so nothing above it has to guess."
- Question: "Where can a rule be made real?"
- Epigraph: Lamport, "A distributed system is one in which the failure of a computer you didn't even know existed can render your own computer unusable."
- Dates: June 2026 Version 1.0 (Harbor Volume) → August 2026 Version 1.1 (revised pre-print) → 1.2 (revised pre-print) → September 2026 Version 1.2 (textbook edition).

### 2. The Anchor Protocol [V]
- Subtitle: "A **Formally Verified** Control Plane for Local Agent Swarms" (2026-03-17 `ad7ad02e5` to 2026-07-04) → "A **Mechanically Analyzed** Control Plane for Local Agent Swarms" (2026-08-04 `d922b0d8e`, current). The most consequential retitling in the corpus.
- Site subtitle: "A mechanically analyzed control plane for local agent swarms: signed identity, scoped authority, bounded delegation, and explicit proof boundaries."
- One-line: "Delegated capability only narrows: every child is a subset of its parent, at every hop, and the verifier checks the whole chain."
- Question: "How may authority travel without silently growing?"
- Epigraph: Saltzer and Schroeder, 1975, least privilege.
- Dates: March 16, 2026 Version 1.1 (Port Daddy v3.7.0) → May 2026 1.2 (v3.13.0) → July 2026 1.3 (v3.23.0) → August 2026 1.4 (revised pre-print) → September 2026 1.5 (textbook edition).

### 3. The Sealed Harbor [new]
- Research-paper form (`paper4.tex`, 2026-08-24 `6b3685957`): "The Sealed Harbor / Mutually Confidential Computation with Explicit, Gated, Bounded Releases / Paper 4 of the Harbor program --- the four-pillar assurance argument, executed".
- Chapter form (2026-09-06 `c7d9d8813`): "Mutually Confidential Computation with Explicit, Gated, Bounded Releases".
- Site subtitle: "Mutually confidential computation with every information release explicit, gated, and bounded — four independently verified pillars, and an honestly priced leakage budget."
- One-line: "A work order runs in a room with two fences and two gates, the only thing that leaves is what the slot lets out, and the budget of what can leak is a ledger that conserves."
- Question: "What can a sealed agent leak, and how would we know?"
- Epigraph: Wittgenstein, *Tractatus* 7, "Whereof one cannot speak, thereof one must be silent."

### 4. The Legible Swarm [I]
- Subtitle: "A Consented Local Leviathan, Legibility-with-Zoom, and the Read-Poverty Bottleneck of Agent Swarms" (2026-06-05 `aa050030d`, current).
- Site subtitle: "Why the operator's real problem is not collision but blindness — and how a swarm becomes one picture you can zoom into, never a wall of diffs."
- One-line: "The operator's problem is blindness, not collision; supervision has an information cost you can price in bits."
- Question: "What must remain visible, and what does seeing cost?"
- Epigraph: James C. Scott, *Seeing Like a State*.
- Dates: June 2026 1.0 (Port Daddy Harbor Volume) → August 2026 1.1 (revised pre-print) → 1.3 (collected-volume figure edition, `d42aef6c7`) → September 2026 1.2 (textbook edition): a version regression to fix.

### 5. From Spawn to Person [III]
- Subtitle: "Identity, Continuity, and the Substrate of Agentic Reputation" (2026-06-05 `c63dfb3e1`, current).
- Eyebrows: "Technical White Paper --- Harbor Volume, Paper 3" / "The Harbor Volume --- Floor 3: Personhood".
- Site subtitle: "The hinge of the library: continuity — memory, a checkpoint, a witnessed record — turns an anonymous spawn into a person with a track record, the raw material of reputation."
- One-line: "Continuity turns an anonymous spawn into a ledger position with a witnessed record; reputation is what that record is worth."
- Question: "What remains long enough to owe anything?"
- Epigraph: Locke, *Essay* II.xxvii.26, "Person, as I take it, is the name for this self. It is a forensic term…"
- Dates: June 2026 1.0 (Harbor Volume, L3 bridge) → July 1.1 → August 1.2 → 1.3 (series-aligned edition) → 1.4 (collected-volume edition) → 1.5 (collected-volume edition) → September 2026 1.5 (textbook edition).

### 6. The Harbor Economy [IV]
- Subtitle: "A Three-Sided Market for Agent Labor, Settling on One Conserving Bond Ledger" (2026-06-05 `b9d75807a`, current).
- Site subtitle: "Where it all arrives: a three-sided market — labor, rentable agents, licensed skills — settling on one conserving bond ledger through explicitly trusted, conditionally restricted custody."
- One-line: "Once records cannot be minted, trust can be rented between operators who never met: a three-sided market on one conserving ledger."
- Question: "What makes cooperation rational without making loss unbounded?"
- Epigraph: Kenneth J. Arrow, *Gifts and Exchanges*, 1972.
- Dates: June 2026 Harbor Volume, Paper 4 of 4 (L3 --- the market) → June 2026 Floor 4 --- Economy (L3, the trading floor) → July 2026 Version 1.1 → August 2026 1.2 (revised pre-print) → September 2026 1.3 (textbook edition).

### 7. The Bonded Commons [VI]
- Subtitle: "Pre-Transactional Trust Infrastructure for Multi-Agent Systems" (2026-03-26 `3f46e7867`, current; the oldest surviving subtitle).
- Site subtitle: "How a group of independent programs can share a workspace without one of them being put in charge."
- One-line: "Bonds, witnesses, audits and appeals turn residual uncertainty into an institution; the ledger's conservation law is mechanically checked."
- Question: "Who may decide, on what evidence, with what consequence?"
- Epigraph: Madison, Federalist No. 51.
- Dates: March 2026 1.0 → April 2.0 (pre-print) → May 2.0.1 → 2.5 → July 2.6 → August 2.7 (revised pre-print) → September 2026 2.8 (textbook edition).

### 8. The Federated Harbor [VII]
- Subtitle: "Identity, Coordination, and Settlement Across Administrative Domains" (2026-05-22 `e61c25b17`, current).
- Site subtitle: "Identity, coordination, and settlement across administrative domains — with conditional guarantees and trust boundaries stated explicitly."
- One-line: "Mutually distrustful machines relay evidence, not sovereignty: what may gossip, what needs an authority point, and how a grant crosses a boundary."
- Question: "What can cross a trust boundary without moving the authority itself?"
- Epigraph: Robert Frost, *Mending Wall*.
- Dates: May 2026 0.9 (pre-print) → July 0.9.1 → August 1.0 (revised pre-print) → September 2026 1.1 (textbook edition).

## E. Series, imprint and edition labels

| variant | first seen | last seen |
|---|---|---|
| Technical White Paper | 2026-03-17 `ad7ad02e5` | 2026-08-04 |
| The Harbor Volume | 2026-06-05 `6dabd7451` | 2026-06-20 `875ede535` |
| Port Daddy Coordination Papers --- Chapter II of VII | 2026-08-04 `d922b0d8e` | 2026-08-29 `4474d4e57` |
| Port Daddy Coordination Papers --- Chapter N of M (macro) | 2026-09-06 `6b1b6693e` | current |
| PORT DADDY COORDINATION PAPERS · CHAPTER #1 OF VII | 2026-08-23 `96a4030f8` | 2026-09-06 `6b1b6693e` |
| The Collected Volume · August 2026 (footer) | 2026-08-23 `96a4030f8` | 2026-09-06 `6b1b6693e` |
| Collected Treatise · August 2026 | 2026-08-19 `84f635d5f` | 2026-08-30 `6efd3dd9f` |
| Textbook Edition · date | 2026-09-06 `6b1b6693e` | current |
| Version 1.0 | 2026-08-04 `d195fb1c3` | 2026-08-23 |
| Version 2.0 (Treatise Edition) | 2026-08-19 `84f635d5f` | 2026-08-24 |
| Version 3.0 (Illuminated Edition) | 2026-08-28 `3cb03857c` | 2026-08-29 |
| Version 3.1 (Research Edition) | 2026-08-30 `6efd3dd9f` | 2026-09-06 |
| 4.0 (Textbook Edition) | 2026-09-06 `6b1b6693e` | current |
| Mundus Press (an invented imprint; replaced by Curiositech) | 2026-09-06 `175f3e753` | 2026-09-06 |
| Erich Owens · Curiositech LLC · engineering@portdaddy.dev | 2026-08-19 `84f635d5f` | current |
| Swiss edition / Technical edition | 2026-09-06 `6262d9019` | current |

Front-matter section titles: "How to use this volume" → "How to use this textbook"; "Introduction: one institution, seven views" and "The claim discipline" (`96a4030f8` to `6efd3dd9f`) → "Introduction: the unit of account is the work" and "What counts as knowing"; "The argument, chapter by chapter" (generated, current).

## F. Site labels for the collection

"The Proofs — 7 papers, the math adversarially reviewed" (`bea645e4c` 2026-08-27 to `6b1b6693e`) · "The four that explain" / "The three that prove" (2026-06-18 `372272d2b` to 2026-09-06) · "Seven papers. Four explain the system. Three prove it." → "Seven chapters. Four explain the system. Three prove it." (`a55ed6843`) → "Seven chapters, in the order the argument needs." (`6b1b6693e`; still says seven with eight chapters) · "The Harbor Library — read it as one book" (2026-08-05, current) · "The spine" · "The L0 → L3 climb" → "The climb" · "From the machine, up to the market." · "Four layers, seven chapters, one bond ledger." → "The spine and the market, drawn." · "The architecture, drawn" · "How to read it" / "Different doors into the same book." (retired) · "Working software vs. finished argument" / "Honest about the seam between them." · "Open the harbor" · reading order: "Start with the wedge" / "Then the floor it stands on" / "Then the hinge" / "Then the market it was all for" · reading paths: "Just tell me what it is." / "Convince the skeptic." / "Prove it to the cryptographer / the economist." · maturity: "the wedge · mostly built".

## Ten that stand out

1. "Refusing the consensus problem: one writer, one file, and what falls out."
2. "The Harbor Volume --- four Floors (explain) × four Beams (prove)"
3. "Floor 1 · Kernel --- the foundation slab."
4. "Autonomy scales only when authority, evidence, and consequence remain coupled at every effect boundary."
5. The library spine sentence (memory → continuity → person → record → reputation → asset → market).
6. "A Formally Verified Control Plane" → "A Mechanically Analyzed Control Plane"
7. "Seven cross-referenced treatises on local effect hypervisors, evidence-bearing work units, capability attenuation, multi-hop delegation, bounded underwriting, and federated institutions"
8. "What Survives the Restart"
9. "Start with the wedge" / "Then the hinge" / "Then the market it was all for"
10. "Working software vs. finished argument. Honest about the seam between them."

## Unresolved

`textbook.json` has two commits, so its one-lines, questions and epigraphs have no earlier drafts in git. The "The Proofs" banner string was introduced in `bea645e4c` and removed in `6b1b6693e` but no `LibraryBanner.tsx` exists by that path on this branch. The library changelog lives inside `whitePapers.ts`, not as a separate file. Several commits share a date across divergent branches, so first/last within a day follows the commit graph, not the clock.
