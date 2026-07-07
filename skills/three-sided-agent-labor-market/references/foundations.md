# Foundations — academic anchors for three-sided agent-labor markets

Each entry: full cite → one-line gloss → which design decision it binds.

## Multi-sided platform economics
- **Rochet & Tirole (2003), "Platform Competition in Two-Sided Markets," *JEEA* 1(4):990–1029.** Platforms must choose the *price structure* (allocation across sides), not just the level; volume depends on who pays. → Binds the cold-start subsidy decision: subsidize the side carrying the cross-side externality.
- **Rochet & Tirole (2006), "Two-Sided Markets: A Progress Report," *RAND J. Econ.* 37(3):645–667.** Unifies membership vs usage externalities; a market is two-sided iff price structure affects volume. → The operational test for "is this actually multi-sided."
- **Armstrong (2006), "Competition in Two-Sided Markets," *RAND J. Econ.* 37(3):668–691.** Cross-group externalities and single-/multi-homing drive equilibrium prices. → Whether agents/skills multi-home across harbors changes federation pricing.

## Incomplete contracts / theory of the firm
- **Grossman & Hart (1986), "The Costs and Benefits of Ownership," *JPE* 94(4):691–719.** When contracts are incomplete, residual control rights should go to the party with the most important non-contractible investment. → The rented-agent design: renter holds runtime control rights, owner holds reputation consequences.
- **Hart & Holmström (Nobel 2016, contract theory).** Control rights and observability shape optimal contracts. → Why a leased agent needs a runtime control right, not just a bond.

## Information asymmetry
- **Akerlof (1970), "The Market for 'Lemons,'" *QJE* 84(3):488–500.** Hidden quality collapses price to the average and drives out good goods. → Why opaque flat-rate skill licensing fails; metered + clawback + portfolio proof.
- **Myerson (1981), "Optimal Auction Design," *Math. of OR* 6(1):58–73.** Revelation principle + revenue equivalence; truthful direct mechanisms. → Why settlement should be a direct, IC mechanism, not a strategic protocol.

## Reputation as economic asset
- **Resnick, Zeckhauser, et al. (2006), "The Value of Reputation on eBay: A Controlled Experiment," *Experimental Economics* 9(2):79–101.** Measured ~8% price premium for an established good reputation. → Reputation is a *priced* asset, justifying the third side existing.
- **Tadelis (2016), "Reputation and Feedback Systems in Online Platform Markets," *Annual Review of Economics* 8:321–340.** Survey of how feedback/reputation mitigate adverse selection & moral hazard on platforms. → The reputation-system "side" is the standard platform answer to information asymmetry.

## Contemporary agent labor markets (2025–2026)
- **Chiu, Zhang & van der Schaar (2025), "Strategic Self-Improvement for Competitive Agents in AI Labour Markets," arXiv:2512.04988.** Explicitly models a *three-sided* market (agents / employers / reputation system); competitive self-improvement can burn surplus in an arms race. → Adversarial check: cap the marginal return of the reputation signal; reward settled outcomes over capability spend.
- **Agentic payment stack (2025–26): AP2 (Google), ACP (OpenAI/Stripe), x402 (Coinbase), MPP.** Signed mandates + stablecoin/HTTP settlement; commoditizing the rail. → Evidence that the *rail* is fungible, so the product must be hosted trust, not the rail.

## Commons / bonding (inherited)
- **Ostrom (1990), *Governing the Commons*.** Durable cooperation needs boundaries, monitoring, graduated sanctions, dispute resolution co-located with the commons. → The bond ledger + Arbiter + appeals path are these, as daemon services.
- **Proof-of-stake slashing lineage (Casper, Tendermint).** Bonded participation: collateral forfeited on misbehavior. → Direct ancestor of slash-on-breach; PD departs (co-located adversary, bonded act is coordination not validation).
