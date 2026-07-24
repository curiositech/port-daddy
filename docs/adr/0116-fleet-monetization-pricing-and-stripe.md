# ADR-0116: Fleet Monetization — Funding Model, Pricing, and Stripe Integration

## Status

Proposed — 2026-07-15. Engineering plan; the specific dollar figures are a
recommended starting point for the operator to set, not a committed price.
Builds on ADR-0101 (accounts + the run pages + the `fleet_run_spend` /
funding-tenant primitives). Supersedes the loose "Phase 2 = BYOK" note in
ADR-0101 with a concrete funding + billing decision.

## Context

**The problem: every install spends the operator's money.** Today the fleet's
review ships run on Cloudflare Workers AI on the operator's account. Real data
from the shared relay D1: **171 runs in 30 days across 4 repos (all the
operator's own), ≈ $100+ Cloudflare AI ⇒ ~$0.58/PR-run** with the observed
gpt-oss-no-cache waste. With the prompt caching now in place, the realistic
optimized floor is **~$0.15–0.30/PR-run**. That is a fine cost basis for a
product, but only once someone other than the operator is paying it — otherwise
opening the App to strangers is an unbounded liability.

**Cost breakdown (per the ship roster):** the `code-reviewer` ship runs on the
pricier `@cf/openai/gpt-oss-120b` ($0.35/$0.75 per M tok); every other cloud
ship (`red-team`, `qa`, `copy-pm`, `tautology-sniffer`, ideation) runs on the
cheap `@cf/qwen/qwen3-30b-a3b-fp8` ($0.051/$0.335). Routing is currently
**static-by-role** — the review bot always gets the expensive model.

**Market (mid-2026, researched):**
- Seat pricing clusters at **$24–30/dev/mo** (CodeRabbit $24, Qodo $30,
  Korbit $24, Bito $12–15, Graphite $40 unlimited).
- The market is **migrating to usage/per-review**: GitLab Duo **$0.25/review
  flat**, Cursor BugBot **$1–1.50/review**, GitHub Copilot review = ~$0.01 AI
  credit + Actions minutes.
- **Managed inference is the default; BYOK is niche** (only OSS Qodo PR-Agent
  and self-hosted Greptile).
- Only **Cursor BugBot** (8-pass voting) and **Qodo 2.0** are genuinely
  multi-agent; everyone else is single-pass + memory. So "multi-agent" as a
  *headline* is now table stakes, not a differentiator.
- **The #1 churn driver is signal-to-noise** — distrust of a single confidence
  score, comment spam ("twenty naming comments burying the real bug").
  CodeRabbit shipped auto-pause-after-5-commits to curb volume. Buyers pay for
  *trust per comment*, not comment count. Repeated finding: **agent
  disagreement is the most valuable signal, and nobody surfaces it as UX.**

## Decision

### D1 — Funding model: managed-primary, BYOK-secondary

- **Managed ("they just pay you") is the front door.** Users subscribe / buy
  credits; runs happen on the operator's Workers AI; the operator pays
  Cloudflare and keeps the margin. This is what every successful PR-review tool
  does and it is the lowest-friction path (no key, no setup). At ~$0.30/PR cost
  the margin at any market price is healthy.
- **BYOK / bring-your-own-GitHub-Actions is the enterprise/power-user door.**
  The user pays their model provider directly (a repo secret, or the fleet
  compiled to run in *their* GitHub Actions via the existing
  `needsExecution → GHA` dispatch hook); the operator holds no key and fronts
  no cost. Sold as the cost-sensitive / high-PR / "inference stays in our repo"
  tier. It also sidesteps the RT1 stored-key liability from the ADR-0101 relay
  threat delta.
- **Positive float via prepaid credits.** Stripe collects at checkout → the
  operator grants credits → the fleet draws them down per run → the operator
  incurs Cloudflare cost only for runs already paid for. No accounts-receivable
  risk, no fronting inference for unpaid users.

### D2 — Complexity-escalation routing (cost control + a sellable tier)

Replace static-by-role routing with a **confidence/complexity cascade**
(FrugalGPT / model-cascade pattern):

1. Every ship starts on the cheap model (`qwen3-30b`).
2. Escalate to the expensive model only on a trigger: the cheap model returns
   low confidence / a "needs deeper look" signal; the diff touches a high-risk
   surface (auth, capability, migrations, crypto); or diff/file size exceeds a
   complexity threshold.
3. The escalation *target* is a tier lever: `gpt-oss-120b` on Pro, a real
   frontier model (Claude via the operator's key or BYOK) on the "Deep Review"
   tier.

Most PRs never touch the expensive model → cuts the dominant cost line ~40–70%,
while risky diffs still get heavy artillery. Routing sophistication becomes a
product tier, not just an optimization.

### D3 — Pricing (recommended starting point; operator sets final numbers)

Lead with **usage/per-review + a cap and a BYOK escape valve**, because a fleet
inherently costs more per PR (N ships) and per-review pricing neutralizes the
"fleet = expensive" objection while matching the 2026 buyer's demand for per-PR
predictability. Avoid Greptile's per-*author* overage math (it punished
agent-heavy shops and drew backlash) — **pool credits per installation.**

| Tier | Price (starting point) | What | Inference |
|------|------------------------|------|-----------|
| **Free** | $0 | ~30 PR-reviews/mo, cheap models only, no escalation | operator-funded (trial funnel) |
| **Pro** | prepaid credits, **~$1.00/PR-review** (≈70% margin on ~$0.30 cost) or $20/mo incl. ~40 then $0.75 | full crew + complexity escalation | managed |
| **Team** | **$25–30/dev/mo** *or* pooled credits | Pro + run-detail history/analytics; pooled balance across repos | managed |
| **Enterprise / BYOK** | custom | bring-your-own-key or run in your own GHA; SSO; signed/Merkle run receipts | user-funded |

Per-review at ~$1 sits between GitLab ($0.25 single-pass) and BugBot
($1–1.50, 8-pass) — market-aligned for an N-agent fleet, and 3× the cost basis.

### D4 — Positioning: transparency is the moat

The fleet's agents are *not* the differentiator (BugBot/Qodo already own
"multi-agent"). **The moat is transparency + attributable ships:** the run-page
that shows where ships **agree, disagree, and why**, and named per-ship
identities you can mute one lane at a time. This directly answers the market's
#1 pain (distrust of an opaque confidence score) that nobody else surfaces.
Lead copy: *"Not one reviewer — a fleet. See exactly where your AI reviewers
disagree, and why."* The deliberation page must be the product's centerpiece,
not a footnote — it is the reason the fleet metaphor is defensible.

### D5 — Stripe integration architecture

Rides on the relay Worker + D1 + the fleet's existing pre-spend pause gate + the
ADR-0101 installation funding-tenant (MT2: one GitHub installation = one wallet
across its repos).

**New D1 tables (relay):**
```
stripe_customers(installation_id PK, stripe_customer_id, created_at)
credit_ledger(id PK, installation_id, delta_usd, reason, stripe_ref, run_id, created_at)  -- append-only; balance = SUM(delta_usd)
subscriptions(installation_id PK, stripe_sub_id, plan, status, seats, current_period_end)
fleet_run_spend(run_id, installation_id, model, input_tok, output_tok, cost_usd, created_at)  -- ADR-0101 Phase 2 primitive
```

**Stripe primitives:**
- **Products + Prices = the SKUs** above (credit packs + subscription prices).
- **Checkout Session** (hosted; PCI-free) to buy a credit pack or start a plan.
- **Webhook handler on the relay** — `POST /billing/webhook`, signature-verified
  the same way the GitHub webhook already is (`Stripe-Signature`, timing-safe):
  `checkout.session.completed` → grant credits; `invoice.paid` /
  `customer.subscription.*` → update `subscriptions`; `charge.refunded` → debit.
- **Customer Portal** — one Stripe-hosted link for card/plan self-service; no UI
  to build.

**Draw-down + the per-installation gate (the operator's flagged "next thing"):**
- The executor's existing pre-spend pause check gains a **balance check**:
  resolve the installation → `SELECT SUM(delta_usd)`; if ≤ 0 and no active
  subscription/trial quota, skip the run and post a "top up to resume" check-run
  message. This is the same mechanism as the abuse gate — build it once.
- After each run, debit `credit_ledger` by the run's `cost_usd` (from
  `fleet_run_spend`, keyed on `run_id`). Requires persisting real token counts
  per run (a small fix — today only `outputLength` is stored, so cost is an
  estimate).

**Money flow:** user buys $20 pack → Stripe deposits (−~3%) → webhook grants $20
credits → runs debit at ~$0.30/PR cost → the operator owes Cloudflare only for
paid-for runs.

## Build order

1. **Per-installation balance/abuse gate** in the executor (protects the
   operator *today*, before any Stripe work; needed regardless of pricing).
2. **Persist real per-run token counts** → accurate `fleet_run_spend` (kills the
   cost-estimate guesswork).
3. **Stripe Checkout + webhook + `credit_ledger`** on the relay.
4. **Draw-down wiring** + the "top up" UX on the run page + Customer Portal link.
5. **Complexity-escalation routing** (D2) — independent, ships anytime; folds
   into the Pro/Deep-Review tiers.

Estimate: ~2–3 weeks for the managed-credits path (1–4); routing (5) is a
parallel ~3-day task.

## Deferred (not decided here)

- **PR-authoring tier.** If the fleet gains a ship that *writes* PRs, the
  researched table-stakes intake is a **tracker issue assigned-to / `@mentioned`
  the bot — GitHub Issues + Linear first, Jira as the enterprise unlock**; docs
  (Notion/Google) are consumed as *context*, not as the trigger. Metering is
  usage/credits (ACU-style), never pure per-PR (authoring difficulty varies).
  Differentiators: an in-tracker plan+confidence gate (Devin/Jules-style)
  surfaced before code, doc-to-ticket distillation, and honest per-task cost.
  Its own ADR when it's on the roadmap.
- **Other paid surfaces (considered, not planned):** frontier "Deep Review"
  escalation, more repos/seats, private/self-hosted, priority latency, custom
  ships ("Shipwright" author-your-own-ship on higher tiers), run-detail
  analytics/trends, and the **cryptographic run receipts** (signed / Merkle
  audit) as a compliance/enterprise line — that last is uniquely the operator's
  and a real enterprise wedge.

## Consequences

**Positive:** unbounded install liability becomes bounded (the balance gate);
the product can open to the public with positive float; pricing matches the
fleet's cost shape and the 2026 usage-migration; transparency is a defensible
moat rather than a me-too "multi-agent" claim.

**Negative:** the operator now runs billing (Stripe, webhooks, refunds, dunning)
and carries margin/cash-flow risk on the managed tier; a new PCI-adjacent
surface (mitigated by Stripe-hosted Checkout/Portal — no card data touches the
relay); and per-run cost attribution needs the token-persistence fix before
draw-down can be exact.

## References

- ADR-0101 (accounts, run pages, `fleet_run_spend`, funding-tenant), ADR-0053
  (anchor/macaroon spend-cap caveats — the Phase 3 rail-agnostic funding
  instrument), the ADR-0101 relay threat delta (RT1 stored-key liability that
  BYOK-to-relay carries and BYOK-to-GHA avoids).
- `apps/fleet-executor/src/fleet.ts` (ship roster + model routing),
  `apps/fleet-executor/src/execute.ts` (pre-spend pause gate — the balance-gate
  insertion point).
- Market research 2026-07-15: CodeRabbit / Greptile / Graphite / Cursor BugBot /
  Qodo / GitLab Duo pricing; HN signal-to-noise churn threads; PR-authoring
  intake (Devin/Copilot/Jules/Codex/Factory — tracker-issue-assignment pattern).
