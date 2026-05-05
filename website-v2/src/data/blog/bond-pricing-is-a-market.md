# Bond Pricing Is a Market, Not a Constant

Daily budgets are training wheels. They keep agents from spending all your money in one bad night, and they will keep doing that. But they are not how risk should be priced for autonomous work, and the v2 of the Bonded Commons paper says so out loud.

This post translates the §8 pricing rewrite --- including the new competitive-insurance section contributed by Thomas Youle (Indiana University) --- into what it means for Port Daddy as a product.

![Bond pricing as a market](/img/generated/blog-control-plane-product.jpg)

## What Daily Budgets Actually Are

Today, when you cap an agent at $5 per day, you are doing two things at once:

1. **Estimating expected damage.** You believe an agent that spends more than $5 in a day is probably wedged or runaway.
2. **Buying insurance against that estimate being wrong.** You forfeit the $5 if the worst happens.

Daily budgets fold those two jobs into one number. That works for solo developers. It stops working the moment you have a fleet, because the right number is not "$5 per agent per day" --- it is *"the expected loss from this agent doing this kind of work, plus a risk premium."*

Anyone who has filled out an insurance form recognizes this. Insurance markets exist because expected loss varies by kind of trip, kind of car, kind of driver, kind of weather. Static budget caps treat every drive the same.

## The Cleanup Lower Bound

The first concrete thing v2 commits to is a floor. Let `c` be your project's *cleanup cost per breach event* --- the human-plus-compute cost to detect, assess, and recover from a budget breach. Then for any Float Plan, the bond must satisfy:

```
π(F) ≥ c
```

This is not subtle. If the bond is smaller than cleanup, breaches drain the commons. The system bankrupts itself through enforcement. So:

- `c` becomes a project health metric. Port Daddy can publish it next to wallet, escrow, and pool balances.
- Rising `c` is a rising-stress signal. The authority can raise required bonds automatically when `c` crosses a threshold --- making risky spawns expensive when the project needs them least.
- Your daily-budget number, in this framing, is "guess at `c` plus a fudge factor." We can do better.

## The Scope Multiplier

`c` alone is too coarse. A Float Plan that touches three files in a sandbox is not the same risk as one that holds `db:write` plus production-deployment capability.

```
π(F) ≥ c · (1 + α · s(F))
```

Where `s(F)` is plan scope (files claimed, presence of `db:write`, prod-deploy capability) and `α` is calibrated from observed cleanup per scope unit. Empirically, cleanup is super-linear in scope --- coordination cost dominates the high end. A project with `α` near zero has clean, easily-audited work. A project with high `α` has tangled dependencies. Both `c` and `α` are publishable from the audit log.

In product terms: we will surface `α` and `c` as project-level numbers on the FleetBar overview. They are how operators reason about whether *their* project's bonds match *their* project's coordination cost, not someone else's.

A reputation discount sits on top:

```
π(F, p) = π(F) · (1 − ρ(p))    with    ρ(p) ∈ [0, r_max],   r_max ≤ 0.5
```

A clean track record buys you a discount, capped at half --- enough to make participation cheaper for trusted principals, not so much that a good history dissolves the bond entirely.

## The Bonded Advisor

Once you have a floor and a multiplier, the question is who picks `α`. v2 names a pattern: the **Bonded Advisor**.

A Bonded Advisor is an agent whose only job is to propose Float Plans for a project. Its bond on the proposing plan is slashed proportionally to the accepted fleet's eventual breach rate. Clean settlements accumulate reputation; breaches shrink it. Over time, advisors who price well charge for their proposals; advisors who over- or under-price get priced out.

The pricer is priced. This is recursion, not regression --- and it is exactly the structure we already have for Shipwright, the agent that proposes fleets for new projects. The v2 paper formalizes that role.

For users, this looks like:

- A new top-level surface in FleetBar: *Advisor proposals.* You see a candidate fleet, the advisor's reputation, the breach-rate-adjusted bond, and a pre-flight that a human gates before any spawn.
- Reputation is a number you can audit. Every advisor's bond, slash history, and clean-settlement count are visible from the dashboard. There is no hidden trust.

## Insurance, Not Just Bonds (Pre-Print, Pending Review)

The most ambitious move in v2 is the new §8.4, contributed by Thomas Youle: instead of the commons authority picking a bond size, allow a market of *insurer agents* to bid on underwriting each transaction.

An insurer `I` quotes `(qᵢ, cᵢ)`: the premium it requires (`qᵢ`) and the claim ceiling it will cover (`cᵢ`). The principal selects. If damages happen and fall within `cᵢ`, the insurer pays. Otherwise the principal pays the gap from its own stake.

In equilibrium under competition, the premium converges to the insurer's expected loss --- the classical Rothschild-Stiglitz result, applied to agent transactions. The market discovers the price the authority was guessing.

The bonded commons gives this mechanism the public reputation history (from the Merkle forest, see [the next post](/blog/evidence-that-survives-machines)), the principal-bound slashing, and the recursive bond on the insurer's own claim ceilings. Everything an insurance market needs to function without an external regulator is already in the substrate.

We are flagging this section as **pre-print pending economist review**. The mechanism itself is buildable today against the existing bond infrastructure; the welfare claim that "market premium Pareto-dominates any authority-chosen static parameter" needs Youle's full proof in the appendix before we make it in marketing copy.

A minimal insurer-agent loop, sketched against the existing bond ledger:

```typescript
interface InsurerQuote {
  insurerId: string
  premium: number    // q_I
  ceiling: number    // c_I
  expiresAt: number  // unix ms
}

async function priceTransaction(
  txn: FloatPlan,
  history: AgentReputation,
): Promise<InsurerQuote[]> {
  const candidates = await pdInsurers.list({ project: txn.project })
  const quotes = await Promise.all(
    candidates.map((I) => I.quote({ txn, history })),
  )
  // Principal selects --- not the daemon.
  return quotes.filter((q) => q.expiresAt > Date.now())
}
```

The daemon's job is matchmaking and reputation oracle. It does not pick the price. The principal picks an insurer, the insurer collects the premium, the bond ledger records the claim ceiling, and a breach triggers payment from the insurer's own posted bond. The mechanism is recursive in the right way: insurers are bonded to the same commons they underwrite.

![FleetBar resources surface where bonds and budgets live today](/img/app-screens/resources-light.png)

## What Changes for the Product

The product implications, ordered from "doable now" to "still being designed":

1. **Surface `c` and `α` as project-level metrics.** Both are computable from the existing audit log. This is a dashboard pass, not a protocol change.
2. **Reputation discount on bonds.** Principals with clean settlements pay less. Bounded by `r_max ≤ 0.5` to prevent trivialization. Functional form is calibrate-from-data; we ship a default and let projects tune.
3. **Promote the Bonded Advisor pattern.** Shipwright already plays this role in spirit. Make the bond-on-proposal explicit, make slashing automatic, make reputation auditable.
4. **Insurer-agent prototype.** Build the smallest insurer that quotes `(q, c)` against the existing bond ledger. Run it dual-pipe with static-cap budgets for one project before flipping the default.
5. **Eventually deprecate the daily budget as the primary risk control.** Not until insurance pricing has run long enough to be trusted. Daily budgets stick around as a circuit breaker.

## What This Lets Operators Stop Guessing

The thing operators have to do today, and that they should not have to do once the market is real:

- **Set a daily cap by intuition.** Most teams pick a round number and adjust when they hit pain. With `c` and `α` exposed, that intuition becomes calibration against a measured cleanup cost, not a vibe.
- **Decide whether a "trusted" agent gets a higher cap.** A reputation discount is a structural answer: trusted principals pay less collateral for the same scope, bounded so trust never trivializes the bond.
- **Pick between "let it run" and "kill it" when an agent flirts with the cap.** Graduated sanctions (throttle at 80%, kill at 100%) let the daemon make a softer move first, on a published policy, instead of forcing a binary call from the operator at 2 a.m.
- **Choose how much to insure.** With insurer agents in the loop, a principal can buy a bigger claim ceiling for a risky transaction without raising its own posted stake, because the insurer is taking the tail risk in exchange for a market-priced premium.

The headline: *bond pricing is a mechanism design problem, not a configuration value*. Port Daddy is the substrate that makes a real market for it possible. Static caps are what we ship today because the market needs reputation history to function, and reputation history needs the Merkle forest --- which is what the next post is about.
