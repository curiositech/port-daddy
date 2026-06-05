# The Harbor Library

Seven co-equal chapters, one argument. **Four chapters *explain* the system** to
someone who has never heard of it — self-contained, pedagogic. **Three chapters
*prove* it** — mechanized, formally verified. They are chapters of one book, not a
front-of-house volume with subordinate companions: each explaining chapter names
which proving chapter discharges its load-bearing claim, and each proving chapter
names the explaining claim it proves. Read the explaining four in ladder order for
the argument; reach for the matching proof chapter when you want it machine-checked.

---

## The four that explain (read these, in order)

A single ladder up the L0→L3 stack. You buy the next rung only when you need it.

| # | Title | Rung | What it is, in one line |
|---|-------|------|--------------------------|
| **I** | **The Legible Swarm** | L2 — *the wedge* | A coding-agent swarm is a state of nature; the operator consents to a *local* authority whose product is **legibility-with-zoom** — see the whole swarm as one picture you can zoom into, never a wall of diffs. The thing a solo developer pays for today. |
| **II** | **The Single-Writer Kernel** | L0/L1 | The always-on local **reference monitor** — one writer, one machine, one file — that decides what is *true* rather than asserts it: who holds which file, who is alive, who promised what, what actually happened. |
| **III** | **From Spawn to Person** | L3 bridge | Continuity (memory + checkpoint + a witnessed-outcome record) turns an anonymous **spawn** into a **person** with a track record — and a track record is the raw material of **reputation**, scored on multiple axes by neutral judges. |
| **IV** | **The Harbor Economy** | L3 — *the market* | A **three-sided market** (labor + fleet-for-hire, rentable agents, licensed skills) settling on one conserving bond ledger via escrow that cannot steal. The defensible product is **hosted trust**, not the payment rail. |

**The through-line that makes it one book:** *memory → continuity → a person, not a
spawn → witnessed outcomes → reputation → a tradeable asset → the market.* Paper II
is the ground it all stands on; Paper I is what you sell first; Paper III is the
bridge from the tool to the network; Paper IV is the network.

---

## The three that prove (chapters V–VII)

These are chapters, not appendices. Where the explaining four say "this is sound,"
these *are* the soundness — mechanized in **ProVerif** (symbolic protocol
analysis), **Kani** (bounded model checking), and **TLA⁺**. Each one discharges a
specific promise the explaining chapters make and points back to it.

| # | Title | Proves | Methods | The explaining chapter it proves |
|---|-------|--------|---------|----------------------------------|
| **V** | **The Anchor Protocol** | A single agent proves identity + capability to the daemon with no trusted third party; capability attenuation is monotone; immune to algorithm-confusion, impersonation, timing side-channels. | ProVerif ×30, Kani ×30 | proves **II** (kernel identity) and **IV** (the cross-harbor transfer ceremony) |
| **VI** | **The Bonded Commons** | Why there should be a coordinator at all: the economics of bonding, evidence trails, and the conservation laws under which value cannot be created or destroyed in settlement. | ProVerif, TLA⁺ ×16 | proves **IV** (the bond ledger + conservation) |
| **VII** | **The Federated Harbor** | Multi-machine sovereignty: capability transfer across trust boundaries, revocation gossip with convergence bounds, and escrow that cannot steal. | ProVerif ×16, TLA⁺ ×11 | proves **IV** (federation) and **III** (cross-operator attestation, named as the open keystone) |

---

## How to point someone at it

- **"What is this?"** → the one-pager (`00-HARBOR-VOLUME-ARCHITECTURE.md`, Tier 0).
- **"Tell me the whole story."** → the introduction (`00-INTRODUCTION.md`), then **Chapter I**.
- **"Convince the skeptic."** → Chapters I→IV in order.
- **"Prove it to the cryptographer / the economist."** → the matching proof chapter (V / VI / VII).

All seven chapters share the same house design, the same honest-status discipline
(a neutral maturity scale in-body, the precise implementation mapping in each
chapter's appendix), and the same named cast in their worked scenarios — so the
seven read as one library, not a pile.

---

### Naming note (what changed and why)

- **Chapter II** is titled *The Single-Writer Kernel*, not *The Anchor Protocol* —
  because the **Anchor Protocol proper** is the *cross-harbor capability-transfer
  ceremony* (an L3 concern), which lives in **Chapter IV** and is proved in the
  **Anchor Protocol** chapter (V). Calling the kernel chapter "Anchor" conflated
  the kernel with the ceremony; the split fixes it.
- The "trilogy" framing is retired, but the three papers it named are not demoted:
  they are **chapters V–VII**, co-equal with the four that explain. There is **one
  library of seven cross-referenced chapters — four explain, three prove.**
