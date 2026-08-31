# North Star Doctrine — the L2-built / L3-designed thesis

> **Parent.** ADR-0048, *What Port Daddy Is — the North Star*
> (`docs/adr/0048-what-port-daddy-is.md` — *resolves "what Port Daddy is" into a
> four-layer stack L0→L3, each layer for a different* whom). This volume is the
> **doctrine** companion to the Phase-8 whitepapers in the parent directory
> (`../legibility-leviathan.md`, `../tokens-compaction.md`, …): where those papers
> *argue* the North Star from first principles, these five docs *score* the
> codebase against it, claim by claim, with a zoom-link from every assertion to the
> module that earns it.

**Audience.** A software engineer with a working math/CS background. No prior
multi-agent-systems, mechanism-design, or game-theory coursework assumed — every
term of art is defined on first use.

**Reading conventions (house style, per `../legibility-leviathan.md` and
`docs/research/agent-accountability-proposal.md` §8).** On first use, **every
external technical term is bolded, cited, and given a one-line gloss**, and **every
Port Daddy abstraction is bolded with its source-file path (relative to repo root)
and a one-sentence explanation.** These are **Diátaxis explanation** documents
(*understanding-oriented prose, distinct from tutorial / how-to / reference*), not
tutorials.

**Honesty discipline (per ADR-0045, `docs/adr/0045-loud-fail-invariants-and-honest-attestation.md`).**
Every claim is tagged:

| Tag | Means | Example in this volume |
|---|---|---|
| **[BUILT]** | Code exists on `origin/main` today; you can read it at the cited path. | `lib/bonds.ts` conservation invariant. |
| **[BUILT-WEAK]** | Built but partial — does less than the design asks. | resurrection passes notes, not live state. |
| **[PROPOSED]** | An accepted-or-open ADR / PR, **not merged**. The path does **not** exist on `main`. | `lib/bond-pricing.ts` (PR #339, open). |
| **[DESIGNED]** | Specified in an accepted ADR, no merged code. | the verification oracle for `slash()`. |
| **[VISION]** | Argued direction, unspecified. | the daemon-as-correlator that *recommends*. |

> **A green that wasn't checked is a lie** (ADR-0045). Confusing [BUILT] with
> [DESIGNED] is the exact failure this volume scores against — so this volume holds
> itself to the same bar: **every cited path was `ls`/`grep`-confirmed to exist on
> `origin/main` before commit.** Where a path exists only on an unmerged branch, it
> is tagged [PROPOSED] and the branch is named.

---

## The thesis

> **Port Daddy's L0/L1 (single-writer kernel + conservation) is built and
> TLA⁺-proven; L2 (advisory coordination + legibility + context-economics) is built
> *and* now formally sound; L3 (bond pricing + verification oracle + Sybil-resistant
> reputation) is designed-not-built. This split is *correct* — it sits exactly where
> the folk theorem stops working. Single-operator coordination is game-theoretically
> stable (observable history + worktree-anchored identity + high δ), so it needs no
> economic sword. The market layer exists precisely because federation breaks
> persistent identity (δ→0), and economic enforcement is what replaces the
> game-theoretic guarantee once that guarantee evaporates.**

Three moves make the thesis load-bearing rather than decorative:

1. **The line is not arbitrary; it is the folk-theorem boundary.** The **folk
   theorem** [Friedman 1971; Fudenberg–Maskin 1986] — *repeated play sustains
   cooperative outcomes that one-shot play cannot, provided players are patient
   enough (discount factor δ above a threshold) and can observe each other's
   history* — is the mathematics under the L2/L3 seam. Inside one operator's box,
   all three preconditions hold (history is the immutable note chain, identity is
   the session's `worktree_id`, δ is high because the project lives for weeks), so
   advisory coordination is a Nash equilibrium *with no sword in reserve*
   (`game-theory.md`). Federation breaks the **identity** precondition — an agent
   that re-registers after each defection faces δ→0 — and the equilibrium argument
   collapses. Bonds, pricing, and reputation (L3) are the **economic enforcement
   that substitutes for the lost equilibrium**, not an unrelated feature bolted on
   for monetization.

2. **What is built is built honestly, and the gaps are named, not hidden.** L0/L1
   conservation and the claim-signaling equilibrium are machine-checked
   (`proofs/bonded/conservation/Conservation.tla`,
   `proofs/economics/claim_signaling.tla`); L2's read-surfaces, budget-guard, and
   honest-green liveness are on disk; L3's bond *ledger* is built and conserving but
   its *pricer* is unmerged (PR #339) and its *verification oracle* is unbuilt
   (`slash()` is caller-fiat). Each doc opens with a scorecard that grades exactly
   these.

3. **The held levers are the roadmap.** Three mechanisms are *latent* — present in
   the substrate but not yet activated: the daemon could **recommend** claims (turn
   advisory coordination into a true correlated equilibrium, price of anarchy → 1),
   the bond could be **priced to scope** (PR #339), and `slash()` could bind to an
   **oracle** the agent cannot author. Each doc ends with the lever it holds.

---

## The five docs, mapped to the stack

| Doc (file) | North Star layer | One-line claim it scores | Headline gap |
|---|---|---|---|
| **`mechanism-design.md`** | **L3** — bond pricing | The bond *ledger* conserves [BUILT]; the *pricer* is a scope-proportional closed-form floor [PROPOSED, PR #339]; `slash()` is caller-fiat. | The **verification oracle** is unbuilt. |
| **`cryptoeconomic-security.md`** | **L3** — attack surface | Single-operator masks 3 of 5 attack classes; the two live threats (secret-exfil under-collateralization, griefing) have a structural fix (Coast Guard) and a built fix (compulsion-rent). | The **bond↔Coast-Guard** seam. |
| **`context-economics.md`** | **L2** — tokens as COGS + map | PD's strongest layer: per-reader attention, successor briefing, a cost ledger, loud-fail budget guard, episodic memory, per-sortie budgets. | **Effective-context** budgeting; recursive compaction. |
| **`legibility.md`** | **L2** — digest-with-zoom | Honest-green liveness, legible authority (named refusal reasons), mētis-home (append-only audit chains). | **Force-zoom** on irreversible P0; out-of-the-loop testing. |
| **`game-theory.md`** | **L2/L3 seam** — the capstone | Truthful file-claim signaling is a Nash equilibrium for δ above the folk-theorem threshold, given observable history + persistent identity + high δ. | The **Sybil cliff** (federation breaks identity); the unrealized **correlator** lever. |

The layer stack, with the built-status and *why the line sits where it does*:

| Layer | What it is | Built status | Why the line sits here |
|---|---|---|---|
| **L0** | single-writer kernel — the daemon on `localhost:9876`, SQLite/WAL, state no agent can edit (`lib/db.ts`, `server.ts`) | **[BUILT]**, TLA⁺-proven (conservation) | A single writer needs no consensus and no crypto: one machine, one owner. The hard distributed-systems problems do not arise until federation. |
| **L1** | the coordination protocol — typed performatives, claims, conservation of bonded value (`lib/bonds.ts`, `docs/adr/0047-conversation-protocol.md`) | **[BUILT]**, TLA⁺-proven (conservation) | Conservation (`wallet+escrow+commons=supply`) is provable on one machine because there is one ledger; cross-harbor conservation (L3) needs a second proof and a second machine to distrust. |
| **L2** | advisory coordination + legibility + context-economics — the read-surfaces and the operator's GUI (`lib/attention.ts`, `routes/operator.ts`, `lib/budget-guard.ts`) | **[BUILT]** *and* formally sound (claim-signaling equilibrium) | Advisory (not enforced) coordination is *correct* here: inside one box the folk theorem makes truthful signaling a Nash equilibrium, so a sword is unnecessary. Enforcement would be the wrong frame. |
| **L3** | bond pricing + verification oracle + Sybil-resistant reputation — the market between operators (`lib/bonds.ts` ledger built; pricer PR #339; oracle [DESIGNED]) | **[DESIGNED]**, ledger [BUILT] | Federation breaks persistent identity (δ→0). The folk-theorem guarantee evaporates, so economic enforcement (priced bonds, an unforgeable oracle, Sybil-resistant reputation) must *replace* it. This is the first layer that needs cryptography. |

---

## Reading order

- **If you read one:** `game-theory.md`. It carries the formal capstone — *why the
  L2/L3 line is the folk-theorem boundary* — that every other doc assumes.
- **Build order (recommended for roadmap work):** `context-economics.md` →
  `legibility.md` (the two built L2 layers) → `game-theory.md` (why they suffice
  single-operator) → `mechanism-design.md` → `cryptoeconomic-security.md` (the L3
  market that federation forces).
- **Proof order (recommended for skeptics):** start at
  `cryptoeconomic-security.md` (the attacks a market must survive), walk back through
  `mechanism-design.md` (the bonds that price them), `game-theory.md` (why
  single-operator needs none of it), to the two L2 docs (what is actually built).

---

## How this volume relates to the Phase-8 whitepapers

The parent directory's five whitepapers (`../README.md`) *argue* the North Star
from political philosophy, mechanism design, and the multi-agent canon. This
doctrine volume is the **audit against the code**: same stack, same honesty
contract, but every section opens with a scorecard and grounds every claim in a
path you can open. Where a whitepaper says "the digest IS compaction," this volume
points at `lib/briefing.ts` and grades how much of that is real. The two are
complementary: read a whitepaper for the *why*, read its doctrine sibling for the
*how-much-is-actually-built*.

| This doc | Argued at length in |
|---|---|
| `legibility.md` | `../legibility-leviathan.md` (the Leviathan, digest-with-zoom) |
| `context-economics.md` | `../tokens-compaction.md` (tokens as COGS) |
| `mechanism-design.md` | `../agent-economy-anchor.md` (the three-sided market) |
| `cryptoeconomic-security.md` | `../strategy/dossier-security-crypto.md` (the attack surface) |
| `game-theory.md` | `whitepaper/source/agent-transactions-whitepaper.tex` §7 (the formal proof) |

---

*Doctrine-editor's note: this volume scores the codebase as of `origin/main` at
authoring time. Scorecards are snapshots — when a [PROPOSED] lands or an oracle
ships, the grade moves and the doc should be re-scored. The path citations,
however, are contracts: a doc that cites a path which no longer exists is the
overclaim this volume was written to prevent. Re-verify on every edit.*
