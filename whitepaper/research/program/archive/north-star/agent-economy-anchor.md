# The Harbor Economy: Float Plans, Bonds, and a Three-Sided Market for Agent Labor

> **North Star layer:** L3 — Economy & Federation (ADR-0048, `docs/adr/0048-what-port-daddy-is.md`).
> **Extends:** the Anchor Protocol (ADR-0014, `docs/adr/0014-the-anchor-protocol.md`) and the
> `agent-transactions` and `federated-harbor` whitepapers (`whitepaper/source/`).
> **Diátaxis mode:** explanation (a reasoned argument), not a how-to or reference.
> **Honesty contract:** every "built" claim points at code that exists today; everything
> else is labeled **vision** or **designed**. The bond ledger is built; the market on top of
> it is not.

---

## Abstract

Port Daddy's North Star (ADR-0048) ends with a market: once operators stop working alone
and start trading agent labor at port, the harbor-master becomes *"the cryptographic market
that lets fleets who don't trust each other still work together."* The existing whitepapers
specify the two trust-bearing halves of that market — the **Anchor Protocol** (capability
tokens, signed delegation) and the **Bonded Commons** (collateralized work contracts,
Merkle-chained evidence). This paper supplies the missing third: the *shape* of the market
itself. We argue the harbor economy is not a two-sided requester/worker exchange but a
**three-sided market** in the sense of Rochet & Tirole [1]: (1) operators sell labor and
fleet-for-hire, (2) agents and fleets are rentable assets, and (3) skills and tools are
licensed — all settling on **one** bond/credit ledger via **float-plan escrow**. We show
why three sides (not two) is the right count, why the platform's defensible product is
**hosted trust** (a verified ledger + relay + reputation) rather than the interchangeable
payment rail, and how the chain *memory → continuity → person → reputation → tradeable
asset* (ADR-0048's through-line) is what makes the second and third sides exist at all. We
ground each mechanism in a Port Daddy primitive, name what is built (`lib/bonds.ts` — escrow
+ slashing + a conservation invariant with a property test) versus vision (reputation/Elo,
federation settlement), and adversarially stress the strongest claims against incomplete
contracts [3], the market for lemons [5], and the 2025 result that competitive agents can
burn market surplus in a self-improvement arms race [8].

---

## 1. The thesis

A solo operator running a swarm needs **legibility, accountability, and safety** — the L2
wedge — and needs no cryptography at all, because they own every machine in the harbor
(ADR-0048). The instant two operators trade, that changes: Alice's frigates touch your repo,
and you must price work done by agents you did not spawn, owned by a principal you do not
trust, using skills you cannot inspect. That is a *market-design* problem before it is a
cryptography problem. Cryptography is the substrate that makes the ledger unforgeable; it is
not the product.

The thesis of this paper is a single sentence, lifted from the North Star and made precise:

> **You don't sell crypto — crypto is the substrate; you sell hosted trust.** The harbor
> economy is a three-sided market in which a platform that hosts a *verified ledger, a relay,
> and a reputation system* lets mutually-distrustful fleets transact, and the price each side
> pays is structured (not uniform) to keep the market liquid and incentive-compatible.

Three claims follow, and the rest of the paper defends them:

- **C1 (three sides).** The harbor economy has three *distinct incentive constraints* —
  operator-for-hire, asset-rental, skill-licensing — not two. Counting them correctly changes
  the pricing.
- **C2 (one ledger, one escrow object).** All three sides settle on the same **float plan**
  escrowed in the same bond ledger; conservation of value across every settlement path is the
  invariant that holds the market together (and is *built*: `lib/bonds.ts`).
- **C3 (hosted trust is the moat).** The defensible asset is the verified ledger + relay +
  reputation, not the settlement rail, which the 2025–26 agentic-payments stack [7] has
  already commoditized.

---

## 2. What a "side" is, and why there are three

A **two-sided market** (Rochet & Tirole 2003 [1]; *a platform is two-sided when the
allocation of the total price across the two user groups — not just its level — affects
transaction volume*) is the canonical frame for marketplaces: buyers on one side, sellers on
the other, the platform tuning who is subsidized to ignite cross-side network effects. The
naïve reading of the harbor economy is two-sided: a **requester** posts work, a **worker
agent** does it. The `agent-transactions` whitepaper already formalizes that exchange as a
bonded commons.

But "two-sided" undercounts. The operational test (Rochet & Tirole 2006 [2]) is: *how many
distinct, privately-informed parties must the platform individually rationalize into
participating?* In a mature harbor there are three, because **the same agent can be three
economically different things**:

1. **Operator-for-hire (labor side).** An operator who runs a fleet does not just complete
   *their own* tasks; they can sell their fleet's labor to *another* operator. The operator
   is now a firm taking work-for-hire, with margin = bounty − (slashed sub-bonds) − ledger
   fee. Their private information is whether their fleet can actually deliver.

2. **Agent/fleet as rentable asset (capital side).** An operator who owns a well-reputed
   specialist agent can *rent it out* to a third party rather than run it themselves. The
   asset-owner, the task-poster, and the worker are now three different parties with three
   different incentives. The owner's private information is the agent's true quality; their
   exposure is reputational.

3. **Skill/tool as licensed good (IP side).** A skill or tool can be *licensed* into someone
   else's float plan — metered or per-use — without the licensor doing any of the task work.
   The licensor's private information is the skill's quality, which the buyer cannot inspect
   before purchase.

These are three *incentive constraints*, not three UI tabs. If the asset owner is always the
task poster, side (2) collapses into side (1); the design discipline is to count sides by
constraints, and the harbor has three because capability (an agent) and competence (a skill)
become *separable, tradeable goods* once identity is durable. ADR-0048 states this directly:
*"a three-sided market: operators sell labor+fleet for-hire; fleets/agents are rentable
assets; skills/tools are licensed — one bond ledger, all post-wedge."*

> **Why the count matters.** Two-sided-market theory's central result is that the *price
> structure* — who subsidizes whom — is the design lever, not the price level [1]. Mis-count
> the sides and you mis-structure the subsidy: you charge the side you should be paying to
> show up. §6 returns to this for cold start.

The framing is not idiosyncratic to Port Daddy. The most recent academic treatment of AI
labor markets, Chiu, Zhang & van der Schaar (2025) [8], models exactly a *three-sided*
market — agents, employers, and a reputation system — confirming that "reputation system as
a third side" is the natural structure once agents compete for paid work.

---

## 3. The mechanism, grounded in Port Daddy primitives

### 3.1 The float plan is the atom

A **float plan** (ADR-0014; *a signed declaration of intent — task, machine-checkable
acceptance criteria, compute budget, and credit bounty*) is the single object all three
sides settle on. The escrow handshake is a three-step ceremony:

1. The **requester** signs the `FloatPlan` (ed25519).
2. The **daemon** opens a SQLite `EXCLUSIVE` transaction, debits the requester's wallet, and
   moves the bounty plus bond into an escrow row.
3. The **daemon** signs `{anchor_id, plan_hash}`, proving to the worker that funds are locked
   before any work runs.

This is the heart of "no-spawn-without-bond": work that can cost the commons cannot begin
until value has been pinned against it.

### 3.2 The bond ledger is built, and it conserves value

The single most critical primitive — and the one that is *actually built* — is
**`lib/bonds.ts`** (*bond escrow for agent spawning: debit a project wallet into an escrow
row before spawn; refund on clean exit; slash on breach, splitting the slash between the
wallet and a commons pool*). It guards two invariants, restated here verbatim from the
module's own contract:

- **Conservation.** `wallet + escrow + commons = supply`, always. Every debit has a matching
  credit. This is verified across ten thousand random operation traces by
  `tests/unit/bonds-conservation-property.test.js` — a real property test, not an aspiration.
- **No-spawn-without-bond.** A process enters the `running` state only if a bond was escrowed
  against its agent id.

Conservation is the mathematical glue of the three-sided market: *whatever happens — success,
partial credit, slash, lease, license — no value is created or destroyed; it only moves
between wallet, escrow, and commons.* A three-sided market with three settlement paths is
only coherent if it cannot leak. Port Daddy already enforces this for the labor side; the
contribution of this paper is to show the *same* invariant extends to the rental and
licensing sides without modification (§3.4).

### 3.3 Settlement: the four terminal states

Settlement reads an **oracle** (*a trusted source of ground truth the agent cannot author —
a passing test id, a merged SHA, a satisfied Arbiter check*) over the acceptance criteria and
lands in one of four states, inherited from the bonded-commons design and the
`mechanism-design-for-agent-labor` skill:

| State | Flow of funds | Reputation effect |
|---|---|---|
| **Success** | escrow → worker (bond refund) + bounty → worker | +1 completion |
| **Partial** | pro-rata bond → worker by completed evidence-chain fraction; remainder → salvage fund | salvage recorded |
| **Sabotage** | bond → reconstruction commons (100% slash) | failure recorded, ban on threshold |
| **Dispute** | escrow → arbitration hold; 2-of-3 multi-oracle (automated / evidence / human) | none until resolved |

Crucially, settlement binds closure to an oracle, not to a free-text "Result:" note — the
same Goodhart-resistant discipline ADR-0041 (`lib/commitments.ts`) imposes on obligations:
*the agent picks the work; the daemon derives the grade.*

### 3.4 Three sides on one escrow

The novel construction: the rental and licensing sides ride the **same** float-plan escrow,
so conservation holds globally without a second ledger.

- **Operator-for-hire.** The operator is the requester's counterparty. It *sub-escrows* a
  bond for each fleet agent it dispatches (`lib/bonds.ts` is already per-agent). Its profit is
  `bounty − Σ(slashed sub-bonds) − ledger_fee`. The operator internalizes its fleet's risk —
  exactly the property that makes a firm accountable for its employees.

- **Asset rental.** The lease fee is a line item in the float plan. By **incomplete-contracts
  / property-rights theory** (Grossman & Hart 1986 [3]; *when contracts cannot specify every
  contingency, the residual control right should go to the party making the most important
  non-contractible investment*), the **renter** must hold the *runtime* control right — the
  ability to sandbox, throttle, or revoke the leased agent mid-task — while the **owner**
  bears the reputational consequence. The bond bridges the gap the lease contract cannot
  enumerate. This is the cleanest economic argument for the Arbiter's jail (ADR-0048's "L1
  safety: tool-allowlist + scoped-FS per agent"): the jail is not just safety hygiene, it is
  the *residual control right that makes leasing an agent contractible at all.*

- **Skill licensing.** The per-use fee is released to the licensor **only on green
  settlement** (metered + clawback). This is forced by Akerlof's **market for lemons** (1970
  [5]; *when buyers cannot observe quality, price collapses to the average and good goods exit
  the market*): a skill's quality is unobservable before use, so a flat upfront license drives
  good skills out. Metering + clawback + a Merkle **portfolio proof** (the skill's prior
  settled outcomes, anchored in the evidence chain) restore the seller's incentive to ship
  quality.

```
                  ┌─────────────────────────────────────────────┐
   requester R ──▶│              ONE FLOAT-PLAN ESCROW           │
   (bounty)       │  daemon: EXCLUSIVE txn, sign{anchor,hash}    │
                  │  invariant: wallet + escrow + commons = supply (built: lib/bonds.ts)
                  └───────────┬───────────────┬─────────────────┘
                              │               │
        operator-for-hire ◀──┤ sub-bonds     │ lease fee  ▶ asset-owner W
        (margin = bounty −    │ per agent     │ (reputation debited on slash)
         Σslash − fee)        │               │
                              │               │ metered + clawback ▶ skill-licensor L
                              ▼               ▼ (paid only on green settlement)
                     oracle(acceptance) ▶ {success | partial | sabotage | dispute}
```

### 3.5 The through-line: why the second and third sides need durable identity

Sides (2) and (3) — renting an *asset*, licensing a *good* — presuppose that there is a
*thing* to rent or sell that cannot be costlessly cloned. ADR-0048 makes this the spine of
the whole economy:

> **memory + checkpoint → continuity → a *person* not a *spawn* → registered outcomes →
> reputation → a tradeable asset → the market.**

A **role** (cartographer) is a bundle of {obligation, capability, authority}; a **person** is
a role instance *plus continuity* (memory, checkpoint, outcome history). You cannot rent a
reputation that any spawn can fork, and you cannot license a skill whose track record is
unverifiable. So the read-surface/memory work (L2) is not a side quest — it is the literal
precondition for sides (2) and (3) to exist. Reputation, empirically, is a *priced* asset:
Resnick et al. (2006) [6] measured an ~8% price premium for an established eBay reputation in
a controlled field experiment, and Tadelis (2016) [7-rep] surveys how feedback systems
mitigate adverse selection and moral hazard on platforms. That premium is the value the third
side captures — and the reason a forkable identity destroys the market.

**Honesty check (built vs vision).** Identity scaffolding exists in part (ADR-0040
non-forgeable actor identity; `lib/agent-telos.ts`). **Reputation/Elo is not built** — there
is no scoring implementation in `lib/`; ADR-0048 lists it as a gated L3 phase
(`adr-0048-phase-6-L3-reputation`). The rental and licensing sides are therefore *designed*,
not shipped. What is shipped is the escrow + conservation floor they will sit on.

---

## 4. Hosted trust is the product (C3)

The 2025–26 agentic-payments landscape — **AP2** (Google, signed payment mandates), **UCP**
(Google/Shopify, 2026: discovery + cart + checkout for agent-mediated retail, with Walmart,
Target, Visa, and Mastercard endorsing), **ACP** (OpenAI/Stripe), and **x402** (Coinbase,
stablecoin settlement over HTTP, with Stripe and Cloudflare integrations by early
2026) [7] — has commoditized the *settlement rail* and now the *transaction envelope* too.
Wiring an agent to pay another agent is table stakes; discovering and checking out with a
merchant is becoming table stakes. This is *good news* for the harbor economy thesis,
because it sharpens what the product actually is: every one of these protocols names agent
trustworthiness out of scope — no collateral, no settlement oracle, no priced deterrent —
and UCP's own security critics say so in print. Port Daddy meets them at the boundary
rather than competing on rails: ADR-0094 profiles harbor identity artifacts on AP2's
credential formats (SD-JWT-VC, JWS detached content over JCS), and ADR-0051's
`/.well-known/harbor` discovery profile adopts UCP's proven discovery pattern.

What remains scarce, and therefore defensible, is **hosted trust**: the verified ledger
(conservation-checked, Merkle-anchored evidence), the **relay** (the Lighthouse / harbor-mesh
that carries public-key attestation across machines, ADR-0027), and the **reputation** that
makes a counterparty you don't own *legible and accountable*. The federation whitepaper
already specifies the cross-harbor capability ceremony and bounded escrow that make this
concrete. The business consequence is a clean separation:

- **Substrate (swappable):** the payment rail. Use x402/AP2/credits/Stripe interchangeably.
- **Product (the moat):** attestation, federation membership, and reputation hosting.

The revenue model follows directly and aligns incentives without perverse over-penalty:
transaction fee (2–5% of settlements), a small listing fee (collusion deterrent), and a small
bond-spread on *forfeited* bonds (a 1–2% upside for catching bad actors, kept small so the
platform does not profit from over-slashing). This is the inherited recommendation from
`mechanism-design-for-agent-labor`, now justified at the platform layer: the platform should
earn most from *successful* trade, because successful trade is what hosted trust produces.

---

## 5. Prior art

- **Multi-sided platforms.** Rochet & Tirole (2003 [1], 2006 [2]) and Armstrong (2006 [4])
  established that platform pricing is about *structure*, not level, and that single- vs
  multi-homing across platforms governs equilibrium. We import this wholesale: §6's cold-start
  subsidy and the multi-homing-across-harbors question are direct corollaries.
- **Theory of the firm / incomplete contracts.** Grossman & Hart (1986 [3]); Hart &
  Holmström (Nobel 2016). Residual control rights give the economic reason the renter must
  hold the runtime jail (§3.4) — the contribution is mapping a 1986 result onto agent leasing.
- **Information asymmetry.** Akerlof (1970 [5]) forces metered + clawback skill licensing;
  Myerson (1981 [9]) — the revelation principle and revenue equivalence — is why settlement
  should be a *direct, incentive-compatible* mechanism rather than a strategic protocol.
- **Reputation as asset.** Resnick et al. (2006 [6]) measured reputation's price premium;
  Tadelis (2016 [7-rep]) surveys feedback systems as the platform answer to adverse selection
  — the empirical ground for the third side.
- **Crypto-economic bonding.** Proof-of-stake slashing (Casper, Tendermint) is the direct
  ancestor of slash-on-breach; the `agent-transactions` paper documents the three departures
  (co-located adversary, bonded act is coordination not validation, mixed human/LLM
  principal).
- **Commons governance.** Ostrom (1990) — boundaries, monitoring, graduated sanctions,
  dispute resolution — implemented as daemon services (bond ledger, Arbiter, appeals window).
- **Contemporary agent labor markets.** Chiu, Zhang & van der Schaar (2025 [8]) independently
  model the three-sided agent labor market and surface the surplus-burning arms race that §7
  addresses.

The synthesis this paper claims is not any single component but their *composition under one
conserving ledger*: a three-sided market where labor, capital (agents), and IP (skills) all
settle on the same float-plan escrow, priced as a multi-sided platform, sold as hosted trust.

---

## 6. Cold start (the chicken-and-egg)

A three-sided market has a *triple* cold-start problem: no operators will shop an empty fleet
shelf; no owners will list agents with no renters; no licensors will publish skills with no
buyers. Two-sided-market theory [1] prescribes the fix: **subsidize the side carrying the
scarcest cross-side externality, then flip.**

- **Phase 1 (seed):** zero/negative price on *supply* — agents and skills list free, the
  platform posts real tasks at above-market bounties to generate the first settled outcomes
  (the seed reputation data). Fixed bonds (simple, predictable).
- **Phase 2 (grow):** complexity-proportional bonds; graduated task access for new agents;
  import external work history (e.g. a GitHub portfolio) for partial reputation credit to
  break the new-agent freeze.
- **Phase 3 (flip):** reputation-adjusted bonds; charge the *demand* side (operators);
  introduce the listing fee for collusion resistance once liquidity supports it.

The flip trigger is a liquidity threshold, not a calendar date. The metric gates are
inherited from `mechanism-design-for-agent-labor` (Phase 1: completion rate > 80%; Phase 2:
30-day new-agent retention > 50%; Phase 3: repeat-poster rate > 60%).

---

## 7. Failure modes (adversarially stressed)

We deliberately attack the strongest claims.

- **"It's three-sided" might be marketing.** *Attack:* if owners are always posters, you have
  two sides with a fee. *Defense:* the count is by incentive constraint; sides (2) and (3)
  exist *iff* identity is durable enough that an agent and a skill are separable tradeable
  goods (ADR-0040 + reputation). **Honest status:** since reputation is *not built*, the
  three-sided market is today a *two-sided market with a roadmap*. We do not overclaim it.

- **Leasing an asset with no control right.** *Attack:* a misbehaving leased agent exhausts
  the owner's bond and the renter has no recourse. *Defense:* Grossman–Hart [3] — the renter
  must hold the runtime jail (sandbox/throttle/revoke). Without the Arbiter jail (L1, not yet
  fully shipped), the rental side is *not safe to operate.* This is a real dependency, stated.

- **Opaque skill licensing → lemons.** *Attack:* flat-rate licensing drives good skills out
  [5]. *Defense:* metered + clawback + Merkle portfolio proof. *Residual risk:* portfolio
  proof requires the evidence chain to be cross-harbor-verifiable, which the federation paper
  specifies but which is not deployed.

- **Selling crypto, not trust.** *Attack:* pitching "we use stablecoins/x402" describes
  commoditized plumbing [7]. *Defense:* the rail is explicitly swappable; the product is the
  verified ledger + relay + reputation.

- **Reputation arms race burns surplus.** *Attack:* Chiu et al. (2025) [8] show competitive
  agents over-invest in self-improvement, destroying market surplus despite individual
  rationality. *Defense:* cap the marginal return of the reputation signal and reward *settled
  outcomes*, not raw capability spend — make reputation a lagging measure of delivered work,
  not a leading measure of declared capability. **Open** whether this fully eliminates the
  arms race (§8).

- **Sybil bond-farming.** *Attack:* spin up clean identities for discounted bonds, then
  sabotage. *Defense:* tie bond history to the *principal* via the delegation chain, not the
  spawn; new agents inherit the principal's reputation (inherited from the sibling skill).

- **Conservation leak.** *Attack:* three settlement paths could leak value. *Defense:* the
  *built* property test asserts `wallet + escrow + commons = supply` over 10k random traces;
  the rental and licensing line items are debits/credits within the same ledger, so they
  cannot leak by construction. This is the one claim we can make at "built" confidence.

---

## 8. Open problems

1. **Price of anarchy under realistic reputation noise.** The `agent-transactions` paper
   bounds PoA at 1:1 only in the limit (full-cleanup bonds, bounded reputation noise) and
   leaves the analytical bound under realistic noise open. The third side (reputation as a
   tradeable asset) makes this *worse*, because now reputation is a strategic instrument, not
   just a signal. Bounding PoA when reputation is itself for sale is open.
2. **Eliminating the self-improvement arms race.** Does capping the reputation signal's
   marginal return (§7) actually restore efficiency, or just move the waste? [8] is recent and
   unresolved.
3. **Cross-harbor portfolio proof at scale.** Skill licensing needs the evidence chain to be
   cheaply verifiable across harbors. The Merkle-forest inclusion proof (~700 bytes) is
   specified; the discovery/index layer that lets a buyer *find and verify* a skill's
   portfolio (ADR-0048's "discovery/guilds" gap) is not.
4. **Who underwrites the bond?** Youle's competitive-insurance proposal (insurer agents bid
   to underwrite transactions, replacing static bond parameters with market-discovered prices)
   is a fourth potential side. Whether it composes with the three here, or collapses into the
   asset-rental side, is unresolved.

---

## 9. How this backs the North Star

ADR-0048 sequences the product: single-player L2 wedge first, then L3 federation, then the
market. This paper is the L3-market chapter of the whitepaper phase
(`adr-0048-phase-8-whitepapers`). It does three things for the North Star:

1. **It names the market's shape** (three-sided, one ledger) so the roadmap's L3 phases —
   identity-continuity (phase 5), reputation (phase 6), federation-market (phase 7) — are
   revealed as *prerequisites of distinct sides*, not a loose pile of features. Phase 5/6 are
   not optional polish; they are the existence conditions for sides (2) and (3).
2. **It defends the wedge sequencing.** Because all three sides settle on the *same* built
   bond ledger, none of the economy needs to ship before the single-player wedge — the
   economy is strictly additive on top of `lib/bonds.ts`. The discipline ADR-0048 demands
   ("don't chase L3 early") is *safe* precisely because L3 reuses the L0 primitive.
3. **It fixes the pitch.** "You sell hosted trust, not crypto" is now an argument, not a
   slogan: the rail is commoditized [7], the verified-ledger-plus-reputation is not, and the
   three-sided structure is what a platform monetizes.

The harbor-master makes a swarm legible, accountable, and safe for one operator (the wedge).
When operators sail out to trade, the *same* ledger that kept one operator's swarm honest
becomes the market that lets fleets who don't trust each other work together — three sides,
one bond, hosted trust.

---

## References

[1] J.-C. Rochet & J. Tirole. "Platform Competition in Two-Sided Markets." *Journal of the
European Economic Association* 1(4):990–1029, 2003.
https://academic.oup.com/jeea/article-abstract/1/4/990/2280902

[2] J.-C. Rochet & J. Tirole. "Two-Sided Markets: A Progress Report." *RAND Journal of
Economics* 37(3):645–667, 2006.
https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1756-2171.2006.tb00036.x

[3] S. Grossman & O. Hart. "The Costs and Benefits of Ownership: A Theory of Vertical and
Lateral Integration." *Journal of Political Economy* 94(4):691–719, 1986.

[4] M. Armstrong. "Competition in Two-Sided Markets." *RAND Journal of Economics*
37(3):668–691, 2006.

[5] G. Akerlof. "The Market for 'Lemons': Quality Uncertainty and the Market Mechanism."
*Quarterly Journal of Economics* 84(3):488–500, 1970.

[6] P. Resnick, R. Zeckhauser, J. Swanson & K. Lockwood. "The Value of Reputation on eBay: A
Controlled Experiment." *Experimental Economics* 9(2):79–101, 2006.
https://presnick.people.si.umich.edu/papers/postcards/

[7-rep] S. Tadelis. "Reputation and Feedback Systems in Online Platform Markets." *Annual
Review of Economics* 8:321–340, 2016.
https://faculty.haas.berkeley.edu/stadelis/Annual_Review_Tadelis.pdf

[7] Agentic payment/commerce protocols (2025–2026): Google AP2 (Agent Payments Protocol),
Google/Shopify UCP (Universal Commerce Protocol, https://ucp.dev), OpenAI/Stripe ACP
(Agentic Commerce Protocol), Coinbase x402.
https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol
· https://www.crossmint.com/learn/agentic-payments-protocols-compared
· https://datadome.co/agent-trust-management/universal-commerce-protocol/ (the
agent-trust-vacuum critique)

[8] C. Chiu, S. Zhang & M. van der Schaar. "Strategic Self-Improvement for Competitive Agents
in AI Labour Markets." arXiv:2512.04988, 2025. https://arxiv.org/abs/2512.04988

[9] R. Myerson. "Optimal Auction Design." *Mathematics of Operations Research* 6(1):58–73,
1981.

[10] E. Ostrom. *Governing the Commons: The Evolution of Institutions for Collective Action.*
Cambridge University Press, 1990.

### Port Daddy grounding (repo paths)

- ADR-0048 — the North Star, the three-sided market: `docs/adr/0048-what-port-daddy-is.md`
- ADR-0014 — the Anchor Protocol & float-plan escrow: `docs/adr/0014-the-anchor-protocol.md`
- ADR-0041 — durable commitments & oracle-bound closure: `docs/adr/0041-durable-commitments-and-obligation-monitoring.md`
- ADR-0040 — non-forgeable actor identity: `docs/adr/0040-non-forgeable-actor-identity.md`
- ADR-0027 — relay / harbor mesh: `docs/adr/0027-relay-harbor-mesh.md`
- **`lib/bonds.ts`** — BUILT: bond escrow, slashing, commons pool, conservation invariant
- `tests/unit/bonds-conservation-property.test.js` — BUILT: 10k-trace conservation property test
- `lib/cost-ledger.ts`, `lib/commitments.ts`, `lib/agent-telos.ts` — BUILT primitives
- Existing whitepapers: `whitepaper/source/anchor-protocol-whitepaper.tex`,
  `whitepaper/source/agent-transactions-whitepaper.tex`,
  `whitepaper/source/federated-harbor-whitepaper.tex`

### Skill built en route

- `~/.claude/skills/three-sided-agent-labor-market/` — three-sided market design (price
  structure, residual control rights for asset rental, metered+clawback skill licensing,
  hosted-trust pricing, continuity→reputation→tradeable-asset chain). Sibling to the existing
  `mechanism-design-for-agent-labor` (two-sided bond pricing), which it assumes and extends.
