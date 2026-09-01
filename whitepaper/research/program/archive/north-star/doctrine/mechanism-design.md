# Mechanism Design — bond pricing, and the oracle that isn't built

**Layer.** L3 — *the market between operators* — of the Port Daddy North Star
(**ADR-0048**, `docs/adr/0048-what-port-daddy-is.md`). This doc scores Port Daddy's
**bond** machinery: the collateral an agent's principal posts against the risk the
agent imposes on the shared commons.

**Audience.** A software engineer with a working math/CS background. Every
mechanism-design term is defined on first use.

**Honesty discipline (ADR-0045).** **[BUILT]** = on `origin/main`. **[BUILT-WEAK]**
= partial. **[PROPOSED]** = open PR / accepted ADR, not merged (path not on `main`).
**[DESIGNED]** = specified, no code. **[VISION]** = argued, unspecified.

---

## Scorecard — graded against the four pricing tiers

The whitepaper (`whitepaper/source/agent-transactions-whitepaper.tex`
§6.5, §6.6) names four threat-class bond tiers. This is the natural scorecard for a
pricing mechanism: does the code price *each* tier correctly?

| # | Pricing tier (threat class) | Target collateral | Verdict | Grounded at |
|---|---|---|---|---|
| M1 | **Careless** (accidental damage during honest work) | 10–25% of claim ceiling | **[PROPOSED]** — pricer computes the floor, but the band selector is unmerged | PR #339 `feat/scope-proportional-bond-pricer`; whitepaper §6.6 |
| M2 | **Abandonment** (walk-away mid-task; cleanup dominates) | 25–50% of claim ceiling | **[PROPOSED]** — same | PR #339; whitepaper §6.6 |
| M3 | **Active sabotage** (intentional destruction) | 100–200% of claim ceiling | **[PROPOSED]** — same | PR #339; whitepaper §6.6 |
| M4 | **Data exfiltration** (read & leak confidential context) | *no bond is adequate* — structural defense only | **[BUILT structural]** / **[DESIGNED bond]** — exfil is explicitly out of bond scope; covered by isolation | whitepaper §6.6 (`\SpecOnly`); `lib/coast-guard.ts`; `cryptoeconomic-security.md` |
| M5 | **Conservation** — money never vanishes across all four paths | invariant `wallet+escrow+commons=supply` | **[BUILT]**, property-tested + TLA⁺ | `lib/bonds.ts:25`, `proofs/bonded/conservation/Conservation.tla` |
| M6 | **Settlement oracle** — who decides a breach happened? | an oracle the agent cannot author | **[DESIGNED]** — `slash()` is caller-fiat today | `lib/bonds.ts:550` (`slash(id, portionUsd, reason)`) |

**One-line grade.** The *conserving substrate* is built and proven (M5); the
*scope-proportional pricer* exists as a closed-form floor but lives on an unmerged
PR (M1–M3); the *verification oracle* that would make slashing non-fiat is the
single biggest gap (M6). The mechanism is **honest accounting waiting on a judge.**

---

## 1. What was there before, and what PR #339 adds

> **The bond is the L3 primitive every market side settles on. Today it conserves
> value perfectly but prices it crudely; the pricer that makes the bond
> scope-proportional is designed and coded, but not yet on `main`.**

**Before: Fixed Bonds [BUILT].** The shipped **bond ledger** (`lib/bonds.ts` —
*tracks per-project wallet, escrow, and a commons pool; on spawn it escrows a bond,
on clean exit it refunds, on breach it slashes part to the commons*) takes a
**caller-supplied** bond amount (`bondUsd`). The caller decides how much to post.
This is correct as a substrate and arbitrary as a *price*: nothing ties the bond to
the risk of the work.

**After: the scope-proportional closed-form floor [PROPOSED — PR #339].** PR #339
(`feat/scope-proportional-bond-pricer`, open at authoring time) adds
**`lib/bond-pricing.ts`** — *a pricing function that derives a bond floor from the
scope of the Float Plan, not from caller whim*. The path **does not exist on
`origin/main`**; it lives only on the PR branch. Per the honesty contract, it is
scored [PROPOSED], not [BUILT]. Its formula is the whitepaper's §6.5 closed form:

> **π(F, p) = c · (1 + α·s) · (1 − ρ)**

where (whitepaper §6.5, `sec:cleanup-bound`):

- **c** — the **cleanup cost per breach event** (*the human-plus-compute cost to
  detect, assess, and recover from one breach*), observable from the audit log.
- **s = s(F)** — **plan scope** (*files claimed, presence of `db:write`,
  production-deployment capability*). Cleanup scales **super-linearly** with scope
  (coordination cost dominates the high end), which is why scope enters the price.
- **α** — calibrated from observed cleanup per scope unit; **publishable from the
  audit log**. Low-α projects are simple and easily audited; high-α projects have
  tangled dependencies.
- **ρ = ρ(p)** — a **history discount** for the principal *p*: a strong track record
  lowers the bond (the `(1 − ρ)` factor), so reliable principals are not priced out.

The floor obeys two theorems the whitepaper proves:

1. **Cleanup Lower Bound (§6.5, `thm:cleanup-bound`):** for any Float Plan,
   **π(F) ≥ c**. If the bond were below cleanup cost, breach would be *cheap* — the
   bond is forfeit for less than the cost of cleaning up after it, and a
   commons-funded cleanup drains the pool per breach until the system bankrupts
   itself through enforcement.
2. **Risk-sensitivity + accessibility:** π rises with scope/criticality (deterrence)
   but is bounded by the `(1 − ρ)` discount and the band caps (accessibility), so
   legitimate agents are not frozen out of the commons.

---

## 2. The four-tier scorecard, in prose

The closed-form floor of §1 is **threat-agnostic** — and the whitepaper is candid
that this is *wrong in both directions* (§6.6): a single curve calibrated to deter
sabotage prices capable agents out of low-risk work, while a curve calibrated for
accessibility underprices the rare adversary who actually intends harm. So the
mechanism stratifies into four bands by threat class (whitepaper §6.6,
`tab:threat-bonds` and §6.8):

- **M1 — Careless: 10–25% of the claim ceiling.** Accidental damage during an
  honest attempt. The bond covers expected cleanup of a good-faith mistake.
- **M2 — Abandonment: 25–50%.** The agent walks away mid-task; the cleanup of a
  half-finished change dominates, so the band is higher than careless.
- **M3 — Active sabotage: 100–200%.** The agent intentionally damages shared state.
  The bond must cover full reconstruction of polluted files *plus* the cleanup of
  downstream agents that consumed the bad state — capital-inefficient above 100%,
  but acceptable for critical files where reconstruction dwarfs the bond.
- **M4 — Data exfiltration: no bond.** The agent reads and leaks confidential
  context. The whitepaper marks this **`\SpecOnly`** and states the hard truth:
  *bonds are an inadequate deterrent — leaked context is worth far more than any
  feasible bond.* The defense is **not** economic; it is **capability scoping** and
  **isolation domains** (`lib/coast-guard.ts`). This is the seam where mechanism
  design hands off to cryptoeconomic security (`cryptoeconomic-security.md` §3).

The graduated-access bootstrap (whitepaper §6.8) admits new principals only to the
careless and abandonment bands, gating the sabotage-coverage tier on accumulated
clean settlements — the same composite mechanism the competitive-insurance section
uses. **Scored [PROPOSED]:** the bands are specified and the floor is coded, but the
band-selector logic is on the PR, not `main`.

---

## 3. Conservation is the part that is fully real [BUILT]

The one tier that is unambiguously [BUILT] and *proven* is M5 — **conservation**.
`lib/bonds.ts` documents and enforces the invariant (`lib/bonds.ts:25`):

> **wallet + escrow + commons = supply**  — *money never vanishes; a slash moves
> value from escrow to wallet and commons, it does not destroy it.*

The module exposes a `conservation(project)` method returning
`{ walletUsd, escrowUsd, commonsUsd, supplyUsd }` with the contract that
`walletUsd + escrowUsd + commonsUsd === supplyUsd`, *always* (`lib/bonds.ts:75–77`).
This is the **mathematical glue of a multi-sided market**: the four terminal
settlement states (success / partial / sabotage / dispute) are only coherent if no
settlement path can leak value. The invariant is restated in TLA⁺ and machine-checked
at **`proofs/bonded/conservation/Conservation.tla`**, and property-tested over
thousands of randomized traces. **No-spawn-without-bond** — work that can cost the
commons cannot begin until value is escrowed against it — rides directly on this
ledger.

This is why the volume's thesis can say L0/L1 are "TLA⁺-proven": the conservation
property is the kernel invariant, and it holds because single-operator there is
**one ledger on one machine**. Cross-harbor conservation (two operators, two
ledgers) is a *different* theorem L3 must discharge — and the reason federation is
genuinely harder, not just bigger.

---

## 4. The headline gap — `slash()` is caller-fiat (the missing oracle)

The deepest gap is M6, and it is structural. The slash entry point is
(`lib/bonds.ts:550`):

> `function slash(id: number, portionUsd: number, reason: string): boolean`

The **caller** supplies both *how much* to slash (`portionUsd`) and *why*
(`reason` — e.g. `'budget-breach'`, `'arbiter: doc-drift'`,
`lib/bonds.ts:545–548`). Nothing in the bond layer **verifies** that a breach
actually occurred. The bond ledger is a perfectly honest *accountant* that will
debit whatever a caller asserts — it is not a *judge*.

This is the **verification oracle** problem, and it is [DESIGNED], not [BUILT]. An
**oracle** [Chainlink lit.; here, the agent-transactions sense] — *a trusted source
of an external fact the protocol itself cannot compute* — is what a settlement needs
so that closure binds to ground truth (a merged SHA, a passing test, a satisfied
**Arbiter** invariant — `lib/arbiter.ts`, *the runtime monitor that makes forbidden
states unreachable*) rather than to self-report. The whitepaper §6.7 sketches the
fix — **factor settlement across three oracles** with different cost and gameability
profiles, settling on **majority agreement** rather than unanimous appeal, escalating
to human arbitration on no-majority — but no code implements multi-oracle settlement
on `main`.

Until that oracle exists, the bond mechanism inherits its trust from *whoever calls
`slash()`*. Single-operator that caller is the operator's own daemon, which is fine —
the operator trusts their own machine. **Federated, a caller-fiat slash is an
attack surface** (an operator could slash a rival's bond on a fabricated `reason`),
which is exactly why the oracle is an L3 prerequisite and not a wedge feature. This
is the same boundary `game-theory.md` §5 proves from the other direction:
single-operator needs no judge because the equilibrium holds; federation needs one
because it doesn't.

---

## 5. The held lever — bond → pricer → oracle, in that order

The roadmap the scorecard implies is a three-step pipeline, each step gated on the
last:

1. **Merge the pricer (PR #339).** Promote `lib/bond-pricing.ts` from [PROPOSED] to
   [BUILT]. This makes the bond *scope-proportional* instead of caller-whim, closing
   M1–M3. Low-risk and unblocked.
2. **Calibrate α and ρ from the audit log.** Both are publishable from the
   immutable evidence chain (`lib/sessions.ts`) the system already keeps. This is
   data work, not new mechanism.
3. **Build the verification oracle (M6).** The structural gap. Bind `slash()`'s
   `reason`/`portion` to a multi-oracle verdict (merged SHA / test result / Arbiter
   invariant) instead of a caller string. This is the single change that converts
   the bond from honest accounting into enforceable judgment — and the precondition
   for *any* federated settlement.

The lever is held, not pulled: every piece of the pipeline is designed and most is
coded, but the chain is only as enforceable as its weakest link, and today that link
is the caller-fiat slash.

---

## References

- Whitepaper: `whitepaper/source/agent-transactions-whitepaper.tex` §6.5
  (`sec:cleanup-bound`, the closed form + Cleanup Lower Bound), §6.6
  (`tab:threat-bonds`, the four tiers), §6.7 (three-oracle settlement), §6.8
  (graduated-access bootstrap).
- Code: `lib/bonds.ts` (ledger + conservation + `slash`), `lib/bond-pricing.ts`
  (PR #339, the pricer — not on `main`), `lib/arbiter.ts` (the runtime monitor).
- Proof: `proofs/bonded/conservation/Conservation.tla`.
- Companion: `../agent-economy-anchor.md` (the three-sided market this bond
  settles); `cryptoeconomic-security.md` (the exfil tier's structural defense);
  `game-theory.md` §5 (why the oracle is a federation-only requirement).
