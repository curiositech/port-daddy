# Pricing Model Decision Guide

Use this when choosing a pricing model for a new agent-labor feature or tier, before writing any price.

## The five models, matched to a value metric and a buyer

| Model | Value metric shape | Best-fit buyer | Predictability for buyer | Margin risk for seller |
| --- | --- | --- | --- | --- |
| Per-seat | Flat, roughly uniform usage per person | Small teams, buyers who value budget certainty over usage flexibility | Highest — one number, known in advance | Heavy users can far exceed the implied usage budget baked into the seat price |
| Metered / usage-based | Usage varies widely and correlates with value | Buyers with spiky or unpredictable workloads who want to pay for exactly what they use | Lowest, unless paired with a preview and cap | Low if unit economics are sound; margin tracks usage 1:1 |
| Credits / premium requests | A named, prepaid consumable bucket that abstracts the raw infra metric | Buyers who want "usage-based" flexibility without doing token math | Medium-high — the credit is countable even if its backing cost varies | Medium — depends on how conservatively credits are priced against the most expensive backing model |
| Hybrid (seat + metered/credit overage) | Seat floor covers baseline, overage covers spikes | Teams with a predictable core workload and occasional bursts | High for the base, medium for the overage tail | The overage rate must clear the cost floor or your heaviest hybrid users go negative |
| Outcome-based | Price attaches to a verified, atomic result (merged PR, resolved ticket, passed audit) | Buyers who want to pay for results, not effort, and where the outcome is unambiguous to verify | Highest per unit, hardest to forecast total spend without a rate history | High risk if verification is loose — you can be billed-for "success" that later gets reverted |

## Competitor lessons worth citing in a pricing brief

**Cursor's usage-pricing trust incident (2025).** Cursor moved from a largely flat, request-count-bounded plan toward usage-based pricing tied to underlying model cost. Users who did not track their consumption in real time hit bills far above their expectation, and the backlash was public and fast — screenshots of unexpected charges, cancellations, and a a formal response/adjustment from Cursor. The lesson is not "usage-based pricing is bad" — it is that usage-based pricing shipped **without** a pre-run estimate, a visible running total, and a hard cap is a trust incident waiting to happen, regardless of whether the billing math itself is correct.

**GitHub Copilot's "premium requests" model.** Copilot's move to a credits-style unit — a "premium request" consumed by agent mode and by non-default models, on top of a baseline of included requests — is a hybrid/credits design specifically built to hide the raw token/model-cost metric behind something a buyer can count without doing arithmetic. The unit resets monthly, overage is billed at a fixed rate, and the quota is visible in-product before someone burns through it. This is the shape to copy: a countable, named unit plus a visible remaining balance, not raw token exposure.

**Anthropic Claude's rate-limit windows.** Claude's Pro/Max plans bound usage by wall-clock windows (e.g. a rolling multi-hour or weekly limit) rather than exposing token counts to the buyer directly. This is another way to give a predictable buyer-facing unit ("you get N hours of usage per week") while the backing cost varies by model and task complexity.

**OpenAI API spend limits.** The API dashboard's hard/soft monthly spend limit, configurable by the buyer before they start spending, is the reference implementation of a spend cap as a first-class, buyer-controlled setting — not a support-ticket escape hatch.

## Decision ladder

1. Is usage roughly uniform across buyers on this tier? → Per-seat. Stop here unless heavy users are common enough to matter.
2. Does usage vary a lot, and does the buyer want to pay only for what they use? → Metered, but it is not shippable without the guardrails in `references/unit-economics-and-guardrails.md`.
3. Does the buyer want usage flexibility without doing infra math? → Credits/premium-requests: pick a unit that maps to a completed action, not a token count.
4. Is there a predictable core workload plus occasional bursts? → Hybrid: seat base covers the core, overage rate (never unmetered) covers the burst.
5. Is the outcome atomic, unambiguous, and cheaply verifiable (not just "looks plausible")? → Outcome-based, and only with a verification step that can't be gamed by a plausible-looking but reverted result.

## Anti-pattern: mismatched buyer and model

A staff engineer evaluating a tool for a team will tolerate metered pricing if the preview and cap are solid — they read the fine print. A solo founder or a non-technical buyer evaluating the same tool needs the safety of a seat price or a hybrid floor; they will not audit a per-task cost breakdown before it becomes a problem. Segment the model choice by buyer sophistication and stakes, not just by usage variance.
