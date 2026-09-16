# Marginalia placement proposal (Wave 12 §12.2)

A proposal, not a placement: where each cleared portrait's subject is
critical in the chapter sources, found by searching each chapter for the
surname. The lead decides whether to place, move, or skip any of these.
Plates and sidecars are at `website-v2/public/whitepaper/plates/marginalia/`;
credits are in `website-v2/public/whitepaper/figures/pd-marginalia-credits.tex`.

File paths below are relative to the repo root. The kernel chapter's source
of record is `whitepaper/single-writer-kernel.tex` (the Book pulls this file,
not a same-named copy under `website-v2/`); the rest are under
`website-v2/public/whitepaper/`.

| Slug | Chapter | Section | Source line(s) | Caption |
|---|---|---|---|---|
| `lampson` | The Single-Writer Kernel | §"Why 'reference monitor,' and why not consensus'" | `whitepaper/single-writer-kernel.tex:319-320` — *"The right mental model is the \textbf{reference monitor} of Anderson and Lampson~\cite{anderson1972,lampson1974}..."* | Lampson's 1971 *Protection* gave operating systems the access-matrix model this kernel still enforces, one gate at a time. |
| `wonham` | The Single-Writer Kernel | §"The general boundary: regimentation is controllability" | `whitepaper/single-writer-kernel.tex:1064` — *"...that is Ramadge–Wonham controllability with the model's own steps as the uncontrollable alphabet."* | Wonham's 1980s supervisory-control theory, built for factory floors, is the exact reason software policy can be proven enforceable rather than merely hoped for. |
| `lamport` | The Single-Writer Kernel | §"What the substrate assumes from the machine" | `whitepaper/single-writer-kernel.tex:2086` — *"...an intra-node hazard for every expiry sweep that the inter-node ordering of Lamport~\cite{lamport1978} does not cover."* | Lamport showed that "happened-before," not a shared clock, is what a distributed system can actually trust — which is exactly the ordering this daemon's wall clock cannot give it for free. |
| `ostrom` | The Bonded Commons | §"Related Work in Crypto-Economic Bonding" (paragraph "Commons governance") | `website-v2/public/whitepaper/agent-transactions-whitepaper.tex:314` — *"Ostrom's eight design principles for governing common-pool resources~\cite{ostrom1990governing} predict that durable cooperation emerges only when boundaries, monitoring, graduated sanctions, and dispute resolution are co-located with the commons."* | Ostrom's fieldwork on real-world commons — fisheries, pastures, irrigation networks — won a Nobel for showing that "tragedy of the commons" is a design failure, not a law of nature. |
| `aumann` | The Bonded Commons | §"The Daemon as Correlating Device" | `website-v2/public/whitepaper/agent-transactions-whitepaper.tex:386` — *"Aumann~\cite{aumann1974subjectivity} introduced the \emph{correlated equilibrium}: a mediator draws a recommendation tuple..."* | Aumann's correlated equilibrium is the precise, decades-old answer to when a private whisper from a referee changes what a rational player does — the daemon's whole claim to authority rests on it. |
| `parfit` | From Spawn to Person | §"Parfit's repair: continuity, not connectedness" | `website-v2/public/whitepaper/spawn-to-person.tex:694` — *"\textbf{Parfit's repair}~\cite{parfit1984} (\textit{Reasons and Persons}, 1984 --- identity is an overlapping chain of..."* | Parfit argued that personal identity is not a further fact but an overlapping chain of psychological continuity — precisely the shape this chapter gives an agent's identity across spawns. |
| `leviathan` | The Legible Swarm | §"Introduction: the swarm is a state of nature" | `whitepaper/legible-swarm.tex:366-367` — *"\textbf{Thomas Hobbes}, \emph{Leviathan} (1651)~\cite{hobbes1651} --- the foundational social-contract text..."* | Hobbes gave political theory its sovereign-by-consent argument in 1651; this chapter runs the same argument on one machine, three and a half centuries later. |
| `scott` | The Legible Swarm | §"The mechanism: legibility-with-zoom" | `whitepaper/legible-swarm.tex:687-692` — *"\textbf{James~C.\ Scott}, \emph{Seeing Like a State} (1998)~\cite{scott1998} --- states impose legibility... to make populations countable and governable..."* | Scott's *Seeing Like a State* is the standing warning behind this chapter's central rule: a legible summary that erases the local know-how it was built from has already failed. |
| `shannon` | The Legible Swarm | §"A legibility lower bound" | `whitepaper/legible-swarm.tex:1417-1418` — *"...there is an information floor below which a digest \emph{cannot} be a faithful zoomable index, no matter how it is written."* | Shannon's information theory is the reason a digest has a hard floor at all: you cannot compress below the entropy of what you need the reader to recover. |
| `wald` | The Sealed Harbor | §"Canaries with a power curve and a clock" | `website-v2/public/whitepaper/sealed-harbor.tex:749-757` — *"Theorem: Latency (Wald)... is optimal in the Wald–Wolfowitz sense."* | Wald's sequential probability ratio test, developed for wartime quality control, is still the fastest way to decide "has this canary tripped" at a guaranteed error rate. |
| `lovelace` | — | — | — | **No placement proposed.** No chapter source mentions Lovelace, the Analytical Engine, or a phrase that would naturally anchor her; the plate and sidecar are ready if the lead finds or writes a home for her (a title page, the front matter, or a new aside). |
| `coase` (NOT CLEARED) | The Harbor Economy | — | — | **No image and no anchor.** Coase's photographs are not cleared (see `plates/marginalia/coase.NOT-CLEARED.json`), and a search of `harbor-economy.tex` for "Coase," "transaction cost," and "Coasean" found no citation of his work to caption even if an image existed. If the book wants a Coase portrait and citation, both need to be added together. |

## Notes for the lead

- **Kernel chapter has three candidates in two nearby subsections.** Lamport's
  most critical line (`single-writer-kernel.tex:1108`, "prefix-closed
  languages are exactly Lamport's safety properties") sits in the *same*
  subsection as Wonham's citation (§"The general boundary: regimentation is
  controllability"). To respect the "at most one per section" rule from
  `HANDOFF-TEXTBOOK.md` §4, this proposal instead anchors Lamport to his
  weaker, but still genuine, second citation at line 2086 (a different
  subsection). If the lead would rather keep Lamport's stronger citation, move
  Wonham to a different anchor or accept two portraits in adjacent
  subsections of one section.
- **Wonham's plate is soft.** The only Commons photo is a group shot cropped
  down to a ~90×180px region and enlarged 4.3× for print (see
  `plates/marginalia/wonham.json`); it is usable but visibly softer than the
  others. Worth a second look if a better-sourced Wonham photo turns up.
- **Aumann and Ostrom both land in "The Bonded Commons,"** not "The Harbor
  Economy" as the plan's shorthand suggested — that's where their ideas are
  actually cited in the current chapter sources. `harbor-economy.tex` itself
  only names Ostrom once, in a bibliography-adjacent list (line 2315), with no
  standalone discussion to caption.
- **Lovelace and Coase are held back** rather than force-fit: Lovelace has no
  natural textual home in the current eight chapters, and Coase has neither a
  cleared image nor an existing citation.
