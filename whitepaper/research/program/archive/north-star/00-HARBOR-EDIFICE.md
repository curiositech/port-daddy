# The Harbor, As an Edifice — the canonical structure of the papers

> ⚠️ **SUPERSEDED by `00-THE-FOUR-PAPERS.md`.** The "Floors × Beams" 4×4 grid and
> the 8-paper roster below are retired: after a four-audit reconciliation (ADRs,
> the open-problems Ledger, the layer dossiers, and the proof artifacts) the
> volume collapsed to **four self-contained papers** — each carrying its proof
> and its safety slice inline — with the partition justified by where a
> machine-checked equilibrium (the folk-theorem boundary) stops holding.
> Containment is **not** a separate "Beam D"; it returns to its two real homes
> (the machine gate in the Kernel, the human gate in the Legible Swarm). This
> document is kept for history only.
>
> Status (historical): superseded the linear "four explain, three prove" framing
> in `00-HARBOR-VOLUME-ARCHITECTURE.md` and retired the "Port Daddy Trilogy"
> (Paper I/II/III) sequence introduced in #353. Anchored in ADR-0048
> ("What Port Daddy Is", the L0–L3 stack).

Port Daddy's writing kept fracturing because we described **one split twice**:
"four explain / three prove" and "the 4-layer stack / the trilogy" are the same
cut, drawn on top of itself. The fix is to stop listing papers and recognise
that they live on **two orthogonal axes**. The papers form a building.

## The two axes

- **Vertical — the FLOORS you climb (explain).** The 4-layer stack, narrated by
  the four *explaining* papers. This axis carries the **vision**. It is allowed
  to be excited, concrete, and ambitious. It sells.
- **Horizontal — the BEAMS that hold (prove).** The mechanized guarantees, each
  a load-bearing member that runs *across* the floors it secures. This axis
  carries the **authority**. It is where rigour and honest "not-yet" live.

Vision climbs; proof crosses. Neither is redundant because they are
perpendicular.

## The roster — 4 floors + 4 beams = 8 papers

### Floors (explain, bottom → top)

| # | Floor | Paper | Layer | State |
|---|-------|-------|-------|-------|
| 1 | **Kernel** — the foundation slab | The Single-Writer Kernel | L0 daemon + L1 protocol | ▰ built |
| 2 | **Legibility** — the wedge / the lobby | The Legible Swarm | L2 | ▰ built · ★ wedge |
| 3 | **Personhood** — where a spawn becomes a person | From Spawn to Person | L3 bridge | ▰ built · identity root local-only |
| 4 | **Economy** — the trading floor | The Harbor Economy | L3 | ▱ designed |

### Beams (prove, each crosses the floors it secures)

| Beam | Property proved | Paper | Maturity |
|------|-----------------|-------|----------|
| **A** | **Identity & capability** | The Anchor Protocol | ▰ built · ProVerif, Kani |
| **B** | **Conservation & bonding** | The Bonded Commons | ▰ built · TLA⁺, ProVerif |
| **C** | **Federation across machines** | The Federated Harbor | ▰ built · TLA⁺, ProVerif (v0.9) |
| **D** | **Containment & reversibility** | *(new)* Bounded Authority — the Coast Guard | ▱ designed · proof open |

Beam **D is new.** Port Daddy's largest safety ambition — scope containment,
irreversibility gating, the Coast Guard, human-in-the-loop compulsion — had **no
paper**. It is the one beam that runs the **full height** of the building.

## The blueprint (hang this on the wall)

```
                      A Identity   B Conserv   C Federation  D Containment
   ┌────────────────┬───────────┬───────────┬────────────┬────────────┐
 4 │ ECONOMY        │ ▰ transfer│ ▰ ledger  │ ▰ federation│ ▱ bond/halt│
   ├────────────────┼───────────┼───────────┼────────────┼────────────┤
 3 │ PERSONHOOD     │ ▰ keystone│           │ ▰ attest    │ ▱ reversible│
   ├────────────────┼───────────┼───────────┼────────────┼────────────┤
 2 │ LEGIBILITY ★   │           │           │            │ ▱ HITL brake│
   ├────────────────┼───────────┼───────────┼────────────┼────────────┤
 1 │ KERNEL         │ ▰ identity│           │            │ ▱ scope cap │
   └────────────────┴───────────┴───────────┴────────────┴────────────┘
       ▲ spine: MEMORY / resurrection runs floor → floor (the elevator)
       ▰ mechanized   ▱ designed   · open       ★ the wedge
```

Read the geometry and the story tells itself: **the crypto beams cluster at the
top** (Economy, Personhood) because that is where mutually-distrustful operators
meet; **Containment runs the whole height** because safety is owed at every
floor; **the lower floors rest on engineering, not proof**, because you own that
machine and there is no adversary to prove against.

## Doctrine: steel goes where the load is

The grid is **sparse by design**. Empty cells are not missing proofs — they are
floors held up by engineering because no adversary stands there. A beam exists
**only where trust is absent** (across operators, across machines, across the
bond). State this plainly; it converts "incomplete" into a *map of where rigour
is load-bearing*, and the maturity marks (▰/▱/·) turn the open cells into a
roadmap rather than a confession.

## The spine, the elevator, the workbook

- **Memory / continuity (resurrection-with-teeth)** is **not a paper**. It is the
  vertical spine — the elevator that carries a spawn *up* into a person. It is
  narrated through the floors (it surfaces most on Personhood), never as a
  standalone chapter.
- **The grid is the map, not the library.** 4×4 makes sixteen cells; we do **not**
  write sixteen papers. We write the eight *axes*. Cells are where a beam meets a
  floor — a cross-reference, not a chapter.
- **Exercises live in a separate Workbook** (with answers), off both axes. The
  floors stay visionary; the beams stay rigorous; the drills go in the back.

## Editorial law (applies to every paper *and* the web surface)

1. **Vision up, honesty across.** Floors paint the ambition without hedging.
   Beams are where "designed, not yet proved" is stated — as a feature, in the
   maturity mark, never as apology sprinkled through the prose.
2. **No AI tropes.** No "leverage", "delve", "in today's fast-paced", "unlock",
   "game-changer", em-dash sermons, or LLM-tell cadence. Write like an engineer
   who has shipped the thing.
3. **No inexplicable label-tags / design-isms.** Kill decorative chips, badges,
   pill-tags, and status confetti that don't carry a defined meaning. The only
   sanctioned status vocabulary is the maturity key: **built · designed · open**
   (▰/▱/·). These three marks are the *whole* key — there is no fourth label.
   Degrees of "built" (proof stubbed, bounded, v0.9, identity-root local-only)
   are carried as plain verifier text *after* the glyph — e.g. `▰ built · ProVerif`,
   `▰ built · proof stubbed` — never as a separate `BUILT-WEAK` / `partial` tag.
   One accent colour (**cobalt #003FB8**), AAA contrast, status labels
   in muted ink — never a rainbow of bolds.
4. **One typeface per figure; colour reserved for arrows and the single
   "you-are-here" mark.** Restraint reads as authority.

## What changes from today

- Retire the **linear "four explain, three prove"** list and the **Trilogy
  sequence**; both are replaced by Floors × Beams. The three proofs are demoted
  from a numbered series to the (now four) **beams**.
- Make the **explain axis 1:1 with the layers** (4 floors). The Kernel floor
  openly carries two decks (L0 daemon / L1 protocol).
- **Add Beam D (Containment / Bounded Authority).**
- Re-home **exercises** into the Workbook.
- Apply the editorial law site-wide, including `portdaddy.dev/whitepaper`.
