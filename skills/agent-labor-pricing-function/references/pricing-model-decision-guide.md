# Pricing Model Decision Guide

Choose a model after naming the buyer, the buyer-visible unit, the cost basis, and the service boundary. The five models are alternatives with different failure modes, not a maturity ladder.

| Model | Good fit | Worked contrast | Evidence to retain |
| --- | --- | --- | --- |
| Per-seat | similar work envelope per active user | $30/seat may be understandable for a uniform reviewer workflow; it fails if one user can initiate 100× the modeled jobs | high-use seat cost and scope limit |
| Metered | use varies and completion units are buyer-countable | $0.50 per verified ticket is clearer than raw tokens; it still needs a preview before the buyer starts a batch | pre-run estimate and cap behavior |
| Credits | named requests abstract backing variation | 20 “review credits” is countable; it is misleading if one credit can consume arbitrary expensive work | conversion, expiry, and expensive-request test |
| Hybrid | predictable baseline plus spikes | $100/month includes 100 tasks, then $1/task; unlike free overage, every burst has a declared treatment | included cost, overage floor, heavy persona |
| Outcome | result and verifier are precise | $5 for a verifier-confirmed repair can be legible; “looks fixed” cannot settle a bill | verifier, reversal, unknown and appeal policy |

## Decision procedure

1. List candidate units the buyer can forecast from their work: seats, submitted cases, accepted deliverables, or a named request. Write why each maps to value.
2. Reject raw infrastructure units as the primary product metric unless the actual buyer manages that budget and can predict it. Retain them in the cost ledger.
3. Map usage distribution to the table. If the choice is hybrid or metered, write the excess-use path before naming a price.
4. Ask what happens before commitment, while spend approaches a limit, after a task, on retry, and when the result is unknown. A model is incomplete if any answer is “we will decide later.”
5. Run the checker against the planned buyer personas, then preserve both failures and revision rationale.

## Research and market-source boundaries

The original bundle cited product examples as lessons. Treat product terms, prices, quotas, and incidents as date-sensitive and check their official documentation for a live product decision. This draft does not use them as a source of current prices.

- OpenAI API pricing: <https://developers.openai.com/api/docs/pricing> (official page; rate card changes).
- Stripe pricing: <https://stripe.com/pricing> (official page; fee depends on geography/product).
- GitHub Copilot requests and billing: <https://docs.github.com/en/copilot/concepts/billing/copilot-requests> (official documentation).
- Google Gemini quotas: <https://docs.cloud.google.com/gemini/docs/quotas> (official documentation).

A product analogy does not establish that a chosen agent-labor unit is demand-tested or that a particular guardrail is deployed.

## Persona workshop

For each persona record: authority to buy, forecast horizon, acceptable interruption, reconciliation need, and heavy-use case. A constructed example may say “solo buyer, 10 tasks/month, chooses a $25 cap”; it must not be presented as customer research. Compare it with the staff buyer who needs a pre-run batch estimate and the administrator who needs a receipt and an exception path.
