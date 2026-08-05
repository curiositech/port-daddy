# HITL Operator Interruptions — the contract

**Primitive:** every *blocking* operator instruction escalates to a real
human-in-the-loop interruption, with decaying re-notification that nags
effectively but not stupidly.

An agent that hits a wall only a human can move — a permission the GitHub App
lacks, a fail-closed flag (`blockWithoutSandbox`) with no sandbox provisioned, a
question only the operator can answer — must NOT guess, and must NOT degrade
silently. It files an **operator interruption** on the relay and (when its work
depends on the answer) **blocks by polling** until a human answers, acks, or the
ask expires.

Server implementation: `apps/relay/src/interruptions.ts` (+ migration
`apps/relay/migrations/2026-08-04-operator-interruptions.sql`). Executor-side
escalation: `apps/fleet-executor/src/interruptions.ts`.

---

## 1. The data model

One row per ask in `operator_interruptions`, scoped to an **operator**
(`user_id`) and optionally a GitHub App installation (`installation_id`).

| field | meaning |
|---|---|
| `urgency` | `low` \| `normal` \| `high` \| `critical` |
| `state` | `open` → `acked` \| `answered` \| `expired` (terminal states are terminal) |
| `answer` | operator's free text, present only when `answered` |
| `nag_count` / `decay_stage` / `next_nag_at` | decay/nag engine bookkeeping |

State machine law:

- `open → answered` — a human typed an answer; the agent reads it and proceeds.
- `open → acked` — a human saw it and handled it out-of-band; no text.
- `open → expired` — the nag engine gave up (hard stop). Only the engine expires.
- Nothing ever reopens. Answer/ack **silences the nag engine instantly**.

## 2. The HTTP surface

| route | auth | purpose |
|---|---|---|
| `POST /v1/interruptions` | `pdu_` bearer **or** session | create a blocking ask |
| `GET /v1/interruptions?state=open` | `pdu_` bearer **or** session | poll; agents block on this |
| `POST /v1/interruptions/:id/answer` | **session only** (a human) | answer text → `answered` |
| `POST /v1/interruptions/:id/ack` | **session only** (a human) | → `acked` |
| `GET /account/interruptions` | session | HTML list, plain no-JS forms |
| `GET /account` | session | red INTERRUPTIONS banner when any open |
| `GET /mercy` | public | `openInterruptions` count (number, no titles) |

Create body (JSON): `{ title (required, ≤200), body (≤4000), urgency,
source_agent, source_session?, installation_id? }`. All rows are scoped to the
authenticated operator; you can never see or close another operator's asks.

**Creation rate limit:** at most **5 interruptions per (operator, source_agent)
per hour**. Excess creations *collapse* into that agent's newest open ask (the
response carries `collapsed: true` and the existing row) — a looping agent
cannot nag-bomb its operator. With nothing open to collapse into, creation
returns `429 RATE_LIMITED`.

## 3. The decay/nag engine (server-side)

Runs inside the relay's existing MERCY 5-minute cron. Notifications go to
`MERCY_PAGE_WEBHOOK` (the same PagerDuty/Grafana-OnCall bridge MERCY uses).

- **Full jitter, always:** `next_nag = last + random(0, min(6h, base(urgency)
  × 2^stage))`. Bases: critical 5 min, high 15 min, normal 1 h, low 4 h.
  Never a fixed offset — 50 interruptions opened by one outage must not page
  50 times at the same cron tick.
- **Stage dedupe (the mercy pattern):** the jittered `next_nag_at` advances
  **only when a page is DELIVERED**. A failed webhook POST is retried next
  sweep *at the same stage*; a delivered page is never repeated for its stage.
- **Hard stop:** after **5 delivered nags**, the next due tick flips the ask to
  `expired` and exactly one final **"gave up"** page is sent (delivery pinned by
  `gave_up_paged_at`). Expiry happens even if no webhook is configured — silence
  never keeps a dead ask alive.
- **Per-operator page budget:** at most **6 delivered pages per operator per
  trailing hour** across ALL their interruptions. Overflow collapses into ONE
  digest page (`N asks waiting, top: <title>`), at most one digest per hour.
- **Webhook resilience:** every page POST runs through a minimal circuit
  breaker — ≤2 in-call retries with full jitter, **4xx is never retried**,
  `Retry-After` on 429/503 is honored (the breaker parks that long), and 3
  consecutive delivery failures open the breaker for one sweep cycle.
- **Kill switch:** KV key `interruptions:paused` (any truthy value) makes the
  nag engine no-op entirely. Clear it to resume.

## 4. The UI contract — every PD surface MUST implement this

Applies to **FleetBar**, **pd-console**, the **CLI (`pd interruptions`)**, the
`/account` web page, and any future operator surface.

1. **Poll** `GET /v1/interruptions?state=open` for the logged-in operator
   (device-flow `pdu_` token or web session). Poll interval ≤ 30 s with full
   jitter, so that:
2. **Surface within 60 seconds.** An open interruption must be visible to the
   operator at most 60 s after creation: FleetBar badge + item, pd-console
   banner/pane, `pd interruptions` non-empty listing with a non-zero exit-worthy
   notice, web red banner on `/account`. Display at minimum: title, urgency,
   source agent, age. `critical`/`high` must be visually loud (red).
3. **Block dependent agent work while critical asks are open.** A surface that
   launches or gates agent work must refuse to start NEW work that depends on
   an unresolved `critical` interruption for that operator (e.g. FleetBar's
   spawn actions, `pd` commands that dispatch fleets). Show *why* — the open
   ask's title — and link/deep-link to the answer surface. Non-critical asks
   warn but do not block.
4. **Offer answer/ack.** Web: the plain forms on `/account/interruptions`.
   Native/CLI surfaces without a web session must deep-link the operator to
   `/account/interruptions` (answer/ack is session-gated by design — a bearer
   token an agent holds must never be able to silence its own escalations).
5. **Never fabricate.** Zero open asks renders an honest empty state, not a
   hidden widget; a failed poll renders "unknown", never "all clear".

## 5. The agent contract — blocking on an interruption

An agent that files an ask and cannot proceed without the answer blocks **by
polling**, under these hard rules:

- **Poll with full-jitter backoff:** `delay = random(0, min(10 min, 30 s ×
  2^attempt))` between polls of `GET /v1/interruptions` (checking its ask's
  `state`). Base 30 s, cap 10 min. Each poll carries a ≤10 s request timeout —
  a slow relay counts as a failed poll, not an excuse to hang.
- **One retry layer only.** The poll loop IS the retry layer. Do not wrap the
  HTTP call in its own retry loop, and do not add retries above the poll —
  nested retry layers multiply attempts as a product. A `4xx` (bad/revoked
  token, bad request) is not retried at all: park and report `awaiting
  operator` — it will never start succeeding on its own. Honor `Retry-After`
  on 429/503 as the minimum next-poll delay.
- **Circuit-break an unreachable relay.** After 3 consecutive poll failures,
  fail fast: stop polling for at least one full backoff interval before probing
  again with a single call (a one-probe half-open). Never hammer a dead relay.
- **HARD DEADLINE — never block forever on a silent human.** The
  interruption's expiry IS the agent's deadline (this is deadline propagation:
  one deadline, minted where the ask was born, honored downstream). When the
  poll shows `state: expired` — or the relay is unreachable past the ask's
  worst-case expiry (≈ 5 nags at the 6 h cap ≈ 30 h) — the agent MUST:
  1. **park its work as salvageable** (commit/stash to a branch, persist its
     partial state, write its transcript), and
  2. **exit with an honest `awaiting operator` status** — never spin, never
     pretend success, never discard the work.
- **On `answered`:** read `answer`, treat it as the operator's instruction, and
  proceed. **On `acked`:** the human handled it out-of-band; re-check the
  original precondition once and proceed or re-file (the rate limiter collapses
  a re-file into an open duplicate if one exists).

## 6. Executor escalation (fire-and-forget)

`apps/fleet-executor` files interruptions on blocking degradations:

- **403 `contents: write`** while the purser stacks its test PR → `high`.
- **Sandbox absent + `blockWithoutSandbox: true`** (a fail-closed BLOCK is now
  waiting on a human) → `critical`.

Feature-gated exactly like squid events: BOTH `INTERRUPTIONS_URL` (the relay's
`POST /v1/interruptions`) and `INTERRUPTIONS_TOKEN` (an operator's `pdu_`
device-flow token) must be set, or no fetch is ever attempted. Escalations are
fire-and-forget: they never throw, never block, and never change a run or a
verdict — the run's transcript remains the honest record either way. The
executor is a queue consumer, not a blocked agent, so it does NOT poll; the
BLOCK verdict it already emitted is what holds the merge gate while the human
decides.
