# The Harbor Volume — Reading Guide & Architecture

> **Purpose of this document.** Port Daddy's writing had drifted into *eight
> disjoint papers* (a published trilogy + five North-Star drafts) that no
> newcomer could thread together. This is the editorial spine that fixes that:
> one coherent **library of seven co-equal chapters** that climbs a single ladder
> (the L0→L3 stack from **ADR-0048**), with **progressive-disclosure depth** so a
> reader can enter at a one-page glance, a blog-length essay, or a full academic
> paper — and so someone you are *showing Port Daddy to* can actually follow it.
>
> **The pinned model: four papers *explain* the system, three *prove* it.** All
> seven are co-equal cross-referenced chapters of one book — not a four-paper
> volume with three subordinate companions. The four that explain (I The Legible
> Swarm, II The Single-Writer Kernel, III From Spawn to Person, IV The Harbor
> Economy) are pedagogic; the three that prove (V The Anchor Protocol, VI The
> Bonded Commons, VII The Federated Harbor) are mechanized. Each chapter names
> what it *assumes* from below, what it *underwrites* above, and which proof
> chapter *proves* it. See `00-HARBOR-LIBRARY.md` for the cross-reference map and
> `00-INTRODUCTION.md` for the rendered spine.
>
> This is a **plan + the Tier-0 and Tier-1 drafts**. The four explaining papers
> are produced from this spine as a unified LaTeX set; the three proving papers
> are the mechanized chapters they cross-reference.

---

## 0. The problem this set has to solve

Not "document the architecture." The problem is **explainability to an outsider**:
a developer you sit next to, open a laptop, and say *"here's what I built."*
Today that fails — the artifacts are eight academic PDFs with overlapping scope,
drifting vocabulary, and no front door. A reader cannot tell where to start, what
depends on what, or what the single idea is.

The fix is two moves:

1. **One ladder, not eight ledges.** Every artifact hangs off the same spine —
   the L0→L3 stack — so each one announces *where it sits* and *what it assumes*.
2. **Three depths of the same story.** A one-pager, a blog-length essay, and the
   deep papers are not different content; they are the same arc at three zoom
   levels (the project's own "legibility-with-zoom" principle, applied to its own
   docs).

---

## 1. The spine (excerpt from ADR-0048 — condensed for navigation; canonical text in `docs/adr/0048-what-port-daddy-is.md`)

**One sentence:** *Port Daddy is the harbor-master for agent swarms — the
local-first authority that makes many coding agents legible, accountable, and
safe to one operator, and, once operators trade, the cryptographic market that
lets fleets who don't trust each other still work together.*

**The stack (each layer is for a different *whom*):**

| Layer | What it is | For whom | State |
|---|---|---|---|
| **L0 — Daemon (kernel)** | always-on local SQLite source of truth: ports, claims, sessions, tube, commitments, Arbiter, memory | the **machine** | **built** |
| **L1 — Coordination protocol** ("agent OS") | typed conversation + commitments + delegation + Arbiter; the rules of the road | the **agents** | designed (ADR-0047) |
| **L2 — Legibility & authority** (the Leviathan; the GUI) | digest-with-zoom, roadmap-as-truth, adversarial review, read-surfaces, the ratatui console | the **operator** | **the wedge** |
| **L3 — Economy & federation** | anchor protocol, escrow, reputation, harbor federation, the labor/skill/agent market | the **market between operators** | whitepaper'd |

**The through-line (why this is one story, not four):**
> memory + checkpoint → **continuity** → a *person*, not a *spawn* → registered
> outcomes → **reputation** → a hireable/sellable asset → **the market.**

**The discipline (Scott's warning, made a rule):** every summary is *a lens that
zooms to the real artifact, never a replacement for it.* Legibility is the
product; over-flattening is the failure.

---

## 2. The library: 8 disjoint → 7 co-equal climbing chapters

The trilogy and the five North-Star drafts are **not holy** — they are raw
material. They collapse into **seven co-equal chapters**: four that *explain* the
system (ordered by the ladder, front-loaded by *what you sell first* — the wedge —
not by formal dependency) and three that *prove* it (the mechanized chapters the
explaining four cross-reference). Nothing is subordinate; the proofs are chapters
V–VII, not appendices.

```
                     READER ENTERS HERE
                            │
   Tier 0  ▸  One-pager  ──┤  "what is this" (60 sec)
   Tier 1  ▸  Overview  ───┤  the whole arc (one sitting)
                            │
   Tier 2  ▸  Paper 1  The Legible Swarm        L2  ◀── the wedge / flagship
             Paper 2  The Anchor Protocol      L0/L1 ◀── the formal core
             Paper 3  From Spawn to Person     L3-bridge
             Paper 4  The Harbor Economy        L3  ◀── the market
```

### Paper 1 — **The Legible Swarm** *(L2 — the wedge; the flagship, read first)*
**Absorbs:** `legibility-leviathan` (core) + `tokens-compaction` (as the "digest
engine" section) + `discovery-guilds` (as the "read-poverty" section).
**Thesis:** a coding-agent swarm is Hobbes' state of nature; the operator
consents to a *local* Leviathan whose product is **legibility-with-zoom**.
Over-flattening (crushing *mētis*) is the failure. The binding constraint at
scale is **read-poverty**, not write-contention. Tokens are simultaneously the
swarm's COGS *and* its legibility mechanism — the digest *is* compaction.
**Why first:** this is the single-player product a solo developer pays for
*today*. It needs no economy, no crypto, no second operator.

### Paper 2 — **The Anchor Protocol** *(L0/L1 — the formal core)*
**Absorbs:** the existing `whitepaper/source/anchor-protocol-whitepaper.tex` (keep; it is the
strongest formal artifact — ProVerif + Kani verified), reframed with a stack map.
**Thesis:** how a single agent proves identity and capability to the daemon
without a trusted third party. The cryptographic spine everything else stands on.
**Why second:** it is the load-bearing proof; the rest of the volume cites it.

### Paper 3 — **From Spawn to Person** *(L3 bridge — identity → reputation)*
**Absorbs:** `identity-reputation` + the new **ADR-0049** (local reputation +
multi-dimensional quality evaluation + neutral judges).
**Thesis:** a *role* is {obligation, capability, authority}; a *person* is a role
instance **plus continuity** (memory, checkpoint, outcome history). Reputation is
only as real as the identity it keys on. The estimator is cheap; the **substrate
that makes the score real** — witnessed outcomes on a non-forgeable identity — is
the gate. Reputation is multi-dimensional (accuracy / aesthetics / efficiency),
**never ends**, and is judged by **neutral, conflict-free evaluators** (the
"universities and rating agencies" of the harbor), explicitly **not** a bandit
problem.
**Why here:** it is the bridge from the wedge (a legible *person* doing work) to
the market (a *reputation* worth trading on).

### Paper 4 — **The Harbor Economy** *(L3 — the market)*
**Absorbs:** `whitepaper/source/agent-transactions-whitepaper.tex` (Bonded Commons) + the Federated
Harbor material + `agent-economy-anchor`.
**Thesis:** the harbor economy is a **three-sided market** (operators sell
labor + fleet-for-hire; fleets/agents are rentable assets; skills/tools are
licensed) settling on **one conserving bond ledger** via float-plan escrow.
Federation across machines you don't own needs revocation gossip with convergence
bounds and escrow that cannot steal. The defensible product is **hosted trust**
(verified ledger + relay + reputation), not the commoditized payment rail.
**Why last:** it depends on every layer below it; it is the platform, deferred
behind the wedge by design.

---

## 3. Nomenclature normalization key (apply across all four)

The North-Star index flagged real seams. Resolutions, to be applied uniformly:

| # | Drift | Resolution (canonical form for the whole volume) |
|---|---|---|
| 1 | `[DESIGNED]` / `[PROPOSED]` / `[BUILT-WEAK]` / `[BUILT, weak]` used inconsistently | **One three-mark key (canonical in `00-HARBOR-EDIFICE.md`):** `▰ built` · `▱ designed` · `· open`. There is no fourth label: degrees of "built" — `BUILT-WEAK`, `partial`, `proof stubbed`, `v0.9`, `PROPOSED` — are carried as plain verifier text *after* the glyph (e.g. `▰ built · ProVerif`, `▰ built · proof stubbed`), never as a separate tag. Matches the honest-label discipline applied via `pd attest` (ADR-0045 governs invariant attestation; these status labels are a parallel convention applied to paper headers for the same reason). |
| 2 | reputation = "cheap and last" (P3) vs. "the moat" (P4) | State it once, cross-linked: **the score is cheap; the substrate it scores over (witnessed outcomes on a non-forgeable id) is the gate.** Both papers point at this sentence. |
| 3 | "three-sided market" (headline) vs. "two-sided today" (honesty note) | Canonical: **"a three-sided market by design; two-sided until reputation ships (ADR-0049/0040)."** The third side *is* the tradeable-person terminus of Paper 3. |
| 4 | ADR-0040 (non-forgeable identity) load-bearing but unbuilt | Name it once as **the highest-leverage unbuilt keystone**; every L3 claim that depends on it says so in one clause. |
| 5 | "trilogy" (manifesto) vs. five North-Star papers | The "trilogy" *framing* is retired; the three trilogy papers are **not** — they are chapters V–VII (the proofs), co-equal with the four that explain. There is **one library of seven cross-referenced chapters: four explain, three prove**, plus a manifesto front-matter. `docs/manifesto-why-agent-economies.md` already matches ("four explain the system; three more prove it"). |

---

## 4. Tier 0 — the one-pager (DRAFT)

> *Problem-first. Zero undefined jargon in the first 100 words. The diagram is the
> payload.*

**Port Daddy — the harbor-master for your agent swarm.**

You opened five coding agents to go faster. By 3 a.m. two of them edited the same
file, a third "fixed" the test by deleting it, and you cannot tell from the pile
of pull requests what actually happened. More agents made you *less* sure, not
more.

That is a coordination problem, and it has a known shape. Thomas Hobbes called a
world of rational actors with no referee a *state of nature* — everyone worse off
than if they'd consented to one authority. Port Daddy is that consented
authority for your agents: a small always-on program on your machine that hands
out the locks, records who did what, and shows you the swarm as **one legible
picture you can zoom into** — never a wall of diffs.

It is local-first (your machine, your rules; no cloud required) and it grows with
you in four layers:

```
  L3  Economy & federation   ── trade fleets/skills with people you don't trust
  L2  Legibility & authority ── SEE the swarm; the part you'd pay for today  ◀ wedge
  L1  Coordination protocol  ── the rules agents talk by
  L0  The daemon             ── the always-on local source of truth  ✓ built
```

You only ever buy the next layer when you need it. A solo developer lives at L2:
fewer footguns, automatic review, a roadmap that stays true, and a human-in-the-
loop the moment something can't be reconciled. The economy (L3) only appears when
you sail out to trade with another operator.

```bash
brew install curiositech/tap/port-daddy
pd begin --identity myapp:api --purpose "refactor auth"
```

---

## 5. Tier 1 — the overview essay (DRAFT, ~blog length)

> *The arc you hand someone. Lead with the pain; the Hobbes metaphor lands only
> after the failure is felt. Bonds explained by the contractor analogy. Ends with
> a runnable command.*

### Why your agent swarm needs a harbor-master

The pitch for running many coding agents at once is simple: parallelism. Five
agents, five times the work. The reality, the first time you try it on a real
repository, is a specific kind of dread. Two agents claim the same file and race
each other's writes. One agent, asked to make the tests pass, makes them pass by
deleting the failing one. A fourth opens a pull request you can't review because
three others have opened five more. You spawned a team and got a mob. The work
didn't get more parallel; your *uncertainty* got more parallel.

This is not a prompt-engineering problem. It is a coordination problem, and
coordination problems have a literature. Hobbes' wager in *Leviathan* was that
rational actors in a state of nature — no referee, no shared record — end up in a
war of all against all, and will *consent* to a sovereign because the alternative
is worse. Your agents are in exactly that state of nature. They don't need
better prompts; they need a referee they've agreed to obey.

**Port Daddy is that referee, running on your laptop.** It is a small, always-on
local program — no cloud, no account — that owns the things agents collide over:
who holds which file, which port is taken, what was promised, what actually
happened. An agent that wants to edit `auth.ts` asks Port Daddy first, the way a
contractor pulls a permit before opening a wall. That's the L0 daemon, and it's
the part that already exists and runs today.

But a referee that only prevents collisions would be a glorified lockfile. The
reason you'd actually *pay* for Port Daddy is the next layer up: **legibility.**
James Scott's *Seeing Like a State* describes how states make a territory
governable by making it *legible* — surveys, standardized names, maps. The danger
he warns about is *over*-legibility: a map so flattened it erases the local
knowledge that made the place work. Port Daddy takes both halves seriously. It
renders your whole swarm as one picture — what every agent is doing, where they
disagree, what's blocked — but every line of that summary is **a lens you can
zoom through to the real diff, the real test, the real database row.** The
summary is never a replacement for the truth; it's an index into it. That
discipline — *legibility with zoom* — is the product. A solo developer drowning
in agent chaos buys exactly this: see the swarm, catch the footguns, keep the
roadmap honest, and get pulled in only when something genuinely needs a human.

Here's the move that turns a coordination tool into something bigger. To
coordinate well, Port Daddy has to remember — what an agent was doing when it
died, what it promised, what it delivered. Give an agent durable memory, a
checkpoint, and a history of outcomes, and something changes: it stops being an
anonymous *spawn* and becomes a *person* with a track record. (A *role* —
"cartographer" — is just a job description: obligations, capabilities,
authority. A *person* is that role plus continuity.) And the instant you have
persons with track records, you have the raw material of **reputation**: which
agent, which model, which skill, which tool is actually good — and good *at
what*, because quality isn't one number. Accuracy, aesthetics, and efficiency are
different axes, judged by different experts. Port Daddy scores them with neutral
evaluators that have no stake in the outcome — the harbor's universities and
rating agencies — and the score never expires, because a reputation you can
outrun is no reputation at all.

Reputation is the hinge between the tool you run alone and the network you join.
Once an agent's track record is real and forgery-proof, it becomes a *hireable,
sellable asset.* You and a collaborator — call her Alice — each run a fleet on
your own machines. You want her front-end specialist for an afternoon. That's a
trade across a trust boundary you don't control, and it needs three things a
local lockfile never did: a way to prove identity without a central authority, an
escrow that can hold a bond without being able to steal it, and a reputation that
travels. This is where the cryptography finally earns its place. You don't sell
the cryptography — it's plumbing. You sell **hosted trust**: a verified ledger, a
relay, and a reputation system that lets fleets who don't trust each other work
together anyway. The contractor analogy holds all the way up: hiring across the
network is hiring a bonded contractor, and the bond is structured, recoverable
context — not a hostage payment.

So the whole thing is one ladder, climbed in order: a local referee (**L0**), the
rules agents speak by (**L1**), the legible authority you'd pay for today
(**L2** — the wedge), and, only when you sail out to trade, the market between
operators (**L3**). Each rung is real to a different person — the machine, the
agents, the operator, the market — and you never buy a rung before you need it.
The economy is exciting and it is deliberately last, because the thing that makes
it possible — memory that turns spawns into persons — is the same thing that
makes the single-player tool good. Build the harbor first. The trade comes when
the ships do.

```bash
brew install curiositech/tap/port-daddy
pd begin --identity myapp:api --purpose "refactor auth"
# open your agents; they coordinate through the harbor from here.
```

---

## 6. Production plan (Tier 2 — the four LaTeX papers)

1. **House style:** match `whitepaper/source/anchor-protocol-whitepaper.tex` exactly —
   `article` 11pt, `lmodern`, the hh-* color palette, `fancyhdr`, TikZ figures in
   `whitepaper/source/figures/`, theorem/definition/lemma envs, the Reader's-Map table,
   the honesty-label key (§3 above), bold-cite-gloss for external terms,
   bold-path-gloss for PD abstractions.
2. **Each paper opens** with the same stack-map figure (which rung, what it
   assumes, which papers it cites) so the volume reads as one thing.
3. **Adversarial review by field, not just CS** — see §7.
4. **Manifesto** (`docs/manifesto-why-agent-economies.md`) is the front-matter for
   the seven-chapter library — *four explain, three prove* — with the "trilogy"
   framing dropped (the three proofs are chapters V–VII, co-equal, not a separate
   trilogy).

---

## 7. Adversarial review panel (steelman-first, by domain)

Per operator instruction: reviewers are **domain experts for whatever field a
claim actually draws on**, not generic CS reviewers, and each must **steelman the
paper before attacking it**. Run across the model backends available via `pd spawn`
(`claude`, `codex`, `cloudflare`, `ollama`, or any custom transport — see `lib/llm-backend-resolver.ts`).

| Lens | Field | Guards which paper's claims |
|---|---|---|
| **Mechanism design / game theory** | economics | P4 three-sided market, escrow incentive-compatibility, price-of-anarchy-when-reputation-is-for-sale |
| **Political theory** | Hobbes/Scott scholarship | P1 Leviathan-consent + legibility/*mētis* claims (don't misread the canon) |
| **Distributed systems / crypto** | security | P2 anchor proofs, P4 revocation-gossip convergence, FLP on federated membership |
| **HCI / human factors** | automation literature | P1 digest-with-zoom, forced-zoom sampling rate, operator trust calibration |
| **Category theory** | math | the manifesto's olog/functor claims (real structure-preservation vs. decorative analogy) |
| **Cross-paper editor** | — | does the volume *stitch*? each paper's stack-map, citations, and shared vocabulary cohere |

Workflow: each paper → steelman pass → per-field adversarial pass → editor
stitch-check → revisions. Findings logged, not silently applied.

---

## 8. Before the papers: layer avatars (brainstorm → expand → debate → stitch)

> **Operator correction (load-bearing):** *"My brief ideas weren't meant to be a
> spanning tree — I wager you need brainstorming and expansion and debate on
> these layers. Push each layer avatar to be completionist and consistent."*

The five seed drafts are **inputs, not coverage.** Before any paper is written,
each layer of the stack gets an **avatar** — an agent that owns that rung and is
pushed on two axes:

- **Completionist** — enumerate the *whole* space of the layer (primitives,
  obligations, failure modes, open problems, prior art), surfacing what the seed
  ideas missed. This is the L2 "completionist obligation" (ADR-0048) turned on the
  writing itself.
- **Consistent** — every claim must cohere with the adjacent layers (what it
  assumes from below, what it provides above), the canon (ADR-0048/0047/0045), and
  the shipped code's honest state (BUILT / BUILT-WEAK / DESIGNED / VISION).

| Avatar | Rung | Draws on (fields for debate) | Seeds |
|---|---|---|---|
| **L0 — the Daemon** | machine | systems, reliability, local-first/CRDT, security | (code is the source) |
| **L1 — the Protocol** | agents | multi-agent systems (Contract-Net, GPGP/TÆMS, BDI), deontic logic, distributed systems | ADR-0047 |
| **L2 — the Leviathan** | operator | political theory (Hobbes/Scott), HCI/automation, information design | legibility-leviathan, tokens-compaction, discovery-guilds |
| **L3 — the Market** | operators | mechanism design/game theory, crypto/security, category theory | identity-reputation, agent-economy-anchor, the three proof chapters (V Anchor Protocol, VI Bonded Commons, VII Federated Harbor) |

**The pipeline:** each avatar produces a **layer dossier** (complete idea-space +
gaps + open problems + adjacency contract) → a per-field panel **steelmans then
attacks** it → a **cross-layer stitch editor** reconciles vocabulary,
dependencies, and the through-line across all four. *Then* the dossiers — not the
raw seeds — are the source the papers are written from.

---

## 9. Pedagogic spec (every paper, non-negotiable)

> *"Big beautiful diagrams, reading guides, exercises, and a pedagogic focus. Use
> the voice of the existing."*

Match `whitepaper/source/anchor-protocol-whitepaper.tex` exactly, and
add the teaching layer:

- **Voice** — measured-academic but vivid: named metaphors in quotes (the "Ghost
  in the Harbor"), threat-vector / problem-first framing, a *Reading time: ~N min*
  note, companion-paper cross-refs, real citations with `\cite{}`. Never dry.
- **Big diagrams** — **≥ 10 substantial TikZ figures per paper** (not decorative):
  reuse/extend the `whitepaper/source/figures/` library (hh-* palette, `arrows.meta`,
  `positioning`, `fit`, `backgrounds`). Every paper opens with the **stack-map
  figure** (which rung, what it assumes, which papers it cites).
- **Figure typography (the clean bar — a defect if violated).** A figure is noisy
  when it mixes font families and accent colors. The rule: **one typeface per
  figure** (match the body's serif; do not drop into `\sffamily`), **one** accent
  color (cinnabar) used *only* for the single "you are here / THIS PAPER" marker,
  **state/status labels in muted black or gray** (never colored), color otherwise
  reserved for **arrows**, and **no multi-colored or multi-weight bolds** in one
  box. Restraint reads as authority; a rainbow of bolds reads as a ransom note.
- **Reading guide** — the Reader's-Map table at the top (by reader type → the
  section + load-bearing artifact), plus an explicit reading order within the
  volume.
- **Exercises** — an `Exercises` block per major section: a mix of *check-your-
  understanding*, *trace-the-mechanism*, and *open-problem* prompts (the §2.5
  open problems become starred exercises). Pedagogy, not padding.
- **Pull-quotes + theorem/definition/lemma envs + honesty-label key** as in the
  house style (§3).
- **Callouts** — a `\keyidea{}` / `\pitfall{}` sidebar idiom (new commands in the
  shared preamble) for the teaching beats.
