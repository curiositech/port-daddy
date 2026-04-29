# Float Plans: Deliberately Deferred

**Load when**: someone proposes wiring Float Plans (collateralized work contracts) into the relay critical path.

## TL;DR

Float Plans **compose over** the relay. They do not **block** it. The relay ships before any economic settlement is live. SaaS billing for relay usage is a separate concern from Float Plans and must not borrow their machinery.

## What Float Plans are

From `agent-transactions-whitepaper.tex` and ADR-0014: a Float Plan is a structured agreement between a *Requester* and a *Worker* agent, with the daemon as escrow holder. Lifecycle:

1. Requester signs a Float Plan (task, acceptance criteria, compute budget, credit bounty).
2. Daemon escrows credits in `EXCLUSIVE` SQLite txn.
3. Worker performs work; produces evidence (Merkle root over session notes / events).
4. Daemon verifies evidence against acceptance criteria.
5. Daemon issues signed receipt; settles credits to Worker.

This is a **trust infrastructure for agent-to-agent labor markets**. It is *not* a SaaS billing system.

## What Float Plans are NOT

- A way to charge customers for relay events
- A way to authenticate users to the relay (that's the PKI choice)
- A way to enforce rate limits at the relay (that's `cap.rate_per_min`)
- A way to do micropayments on the wire
- A blockchain or cryptocurrency

## Why we defer Float Plans relative to the relay

1. **Float Plans are unbuilt.** Per the audit, the escrow column exists but settlement, receipts, and verification are stubs. Wiring an unbuilt feature into a critical path means the path doesn't ship.
2. **Float Plan UX is unsolved.** The whitepaper specifies the cryptography but not the operator workflow — what does a developer do to *use* a Float Plan? Until that's clear, we shouldn't bake assumptions into the relay.
3. **Coupling is asymmetric.** Float Plans benefit from existing on top of a Merkle event chain (it's their evidence layer). The relay does not benefit from Float Plans.
4. **Different threat models.** Float Plans defend against agent dishonesty in payment disputes. The relay defends against communication adversaries. Solving them together over-constrains both.

## Where Float Plans DO eventually compose

After the relay ships (probably v0.3 of relay, v0.1 of Float Plans):

- **Evidence layer**: the Merkle chain head for a publisher's events during a Float Plan period becomes the receipt's evidence root.
- **Attestation transport**: receipts can be published as relay events on a `_floats:receipts` channel for archival and audit.
- **Cross-daemon settlement**: two daemons in different harbors can settle a Float Plan if they share a relay namespace via WoT-exchanged keys.

This is composition, not coupling. The relay does not know what a Float Plan is. The Float Plan layer uses the relay as one possible carrier.

## What about SaaS billing?

If/when we charge for relay usage:

- Use ordinary metered SaaS billing (Stripe, Lago, OpenMeter)
- Identity for billing is the **PD account**, not the harbor or daemon (one account → many daemons → many harbors)
- Keys are namespaced under the account; revocation by account
- DO NOT route payment events through Float Plans — billing is between PD and the customer; Float Plans are between agents

A Float-Plan-style "credits" model could replace SaaS billing later, but only as a customer-facing currency abstraction, not as the primary settlement mechanism.

## Anti-patterns

- **"We need Float Plans before the relay can work"** — false; the relay is a routing/auth/integrity surface
- **"Let's bake credit balances into the harbor card"** — no; cards are capabilities, not balances
- **"Each event costs N credits, debited via Float Plan"** — no; that's billing, not labor markets
- **"The relay is the escrow holder for Float Plans"** — no; the daemon is the escrow holder; the relay doesn't know about plans
- **"Verify Float Plan receipts at the relay"** — no; verification is at the parties; relay just transports

## What to build first when Float Plans become real

In order:
1. ADR for Float Plan v1 — operator workflow, exact data model
2. Pure-function library for Float Plan construction, verification
3. Daemon escrow path with SQLite EXCLUSIVE txn (already exists — extend)
4. Receipts as relay events on a reserved channel (uses existing relay; no relay changes)
5. Dashboard view for in-flight Float Plans
6. Cross-daemon settlement via shared harbor

The relay's API does not change for any of this. That is the test that we did the layering right.

## Decision-making rule

If a relay design proposal mentions "credits", "escrow", "Float Plan", "anchor amount", or "settlement", reject it from the relay scope and re-route to the Float Plan track. Cite this reference.

## Reading list

- ADR-0014 §1 (Float Plan & Verifiable Escrow)
- `agent-transactions-whitepaper.tex` (Bonded Commons)
- `merkle-chain-design.md` (the evidence layer Float Plans will use)
- Stripe / Lago metering docs (for SaaS billing patterns we *will* use)
