# 21 Automations: The Trigger-To-Agent App

Status: design chapter, target-state. This chapter realizes the dedicated
design work order deferred by
`docs/strategy/2026-07-06-distribution-dogfood-and-go-to-market.md` §10 and <!-- cite-exempt: strategy doc lives on the strategy/distribution-and-dogfood branch (PR #707), not yet shipped to main -->
§14 ("the Automations app needs its own design pass and likely its own binder
chapter"). The trigger and sink plumbing it rides on shipped in PR #672
(io-wiring); the app surface, the plan-writing agent, the automation record,
and the gallery are targets until the gates below pass.

Purpose:
  Define the event-trigger automation loop as its own high-level product
  surface — strategy §9's surface #16 — instead of a capability buried in the
  CLI and `pd-fleet.yml`. State the concept, its place in the surface triad
  and the hub/spoke model, the contracts it reuses from F0 v0 and the one new
  record it needs, the trust obligations it inherits, and the acceptance
  gates that make it real.

Grafted seamanship for this chapter (per the chapter 19 rule that a chain
starts by grafting its row): `always-on-agent-applications`,
`fleet-event-spawn-trust`, `webhook-receiver-design`,
`agentic-coding-ux-designer`, `human-gate-designer`,
`architecture-binder-of-record`.

## The concept

One sentence, three clauses:

> **WHEN** a trigger fires — email, webhook, cron, GitHub event, file change,
> inbound SMS — **RUN** agent(s) with named skills under a budget envelope,
> and **DELIVER** the Work Receipt.

The operator describes the automation in plain English:

> "Every morning, summarize overnight Sentry errors and open issues for the
> P1s."

An agent — not the operator — writes the wiring: it navigates the description
into a trigger→plan→sink graph (chapter 19's Navigation, applied to a
standing request instead of a one-shot intent), renders the graph, and stops
at a consent gate. Nothing is armed until the operator approves the trigger,
the tool surface, the budget, and the delivery sinks in one card.

Every firing leaves a Work Receipt. This is the differentiator over Zapier,
n8n, and IFTTT: their runs are logs you squint at; ours are signed, replayable
proof of what the automation actually did, what it cost, and what Port Daddy
allowed and denied. Published automations — with receipts proving they work —
become a shareable and eventually leasable gallery (strategy §4's three-sided
market applied to automations).

Why this is a product and not a feature: it is possibly the widest wedge
(strategy §3) because it reaches non-coders. Nobody who wants "text me when
the deploy fails, with a one-paragraph diagnosis" wants to learn launch verbs,
YAML, or a DAG editor first. Per `always-on-agent-applications`, the winning
shape is a narrow, high-frequency job with a clear persistence ROI — not a
general assistant. Each automation *is* such a narrow vertical, and the app
is the factory for them.

## What exists today versus target

Shipped in the repo (verified paths, this branch):

- `lib/fleet/triggers/` — nine trigger sources: `calendar`, `cron`, `email`,
  `file`, `git`, `github`, `pd`, `sms`, `webhook` (io-wiring, PR #672).
- `lib/fleet/outputs/` — eight sinks: `calendar`, `email`, `file`, `github`,
  `notify-macos`, `pd`, `sms`, `webhook`.
- `lib/fleet/trust.ts`, `url-guard.ts`, `path-guard.ts`, `consent-gate.ts`,
  `webhook-hmac.ts` — the ADR-0093 trust gate and sink guards, wired before
  `requestAgentRun` in the `io-dispatch` fire path.
- The deployed `pd-email-ingress` worker and the webhook receiver route
  (Phase 2 of io-wiring), plus EventKit/Google calendar helpers.
- `pd-fleet.yml` + `fleet/` shell scripts as the current, operator-hostile
  authoring surface for standing agents.
- F0 v0 contracts under `schemas/agent-harbor/v0/`: `work-intent`,
  `work-plan`, `work-receipt`, `guidance-envelope`, `control-command`,
  `skill-graft`, `cost-accrual-event`.

Target-only until the gates below pass:

- the Automations app surface itself (graph view, consent card, run history,
  gallery);
- the plan-writing agent: plain English → trigger→plan→sink graph;
- the `Automation` record and its projections (schema below);
- firings routed through `WorkIntentService` (today `io-dispatch` calls the
  agent-run path directly — the same bridge status as Scout's
  `/visual-tasks` in chapter 19, and the same demotion path once the Work
  Intent API lands);
- receipts linking back to the trigger event that caused them;
- the gallery, sharing, and any leasing economics.

Known defect carried honestly: the fire-time cron gate is missing — weekly
agents declared in `pd-fleet.yml` fire on an approximately ten-minute default
poll rather than their declared schedule (surfaced in PR #655 review). The
Automations app cannot ship on a scheduler that lies about when it fires;
fixing this is a prerequisite of IT-020, not an optional cleanup.

## Placement: fourth app, not fourth authority

Chapter 19's triad rule survives unamended: *no surface owns runtime state;
all surfaces render daemon truth and submit commands through the same
envelopes.* Automations is surface #16 in strategy §9's hub/spoke inventory —
one more spoke that discovers or pairs to the daemon hub (`pd add
automations`), never a second brain.

Division of labor against the triad:

| Surface | Role in the automation loop |
| --- | --- |
| Automations app | author, visualize, arm/disarm, and audit standing automations; browse the gallery |
| FleetBar | render the consent gate when an automation is armed or changed, and per-run gates for irreversible sinks — consent stays on the only surface allowed to demand attention (chapter 19) |
| pd-console | inspect any individual run in full: transcript, files, denials, receipt — the Automations app deep-links into it rather than growing transcript panes |
| Scout | unchanged; a Scout submission is a one-shot intent, not a standing automation |
| `pd` CLI | `pd automations list/arm/disarm/runs/replay` as the agent/emergency surface |

The Automations app is a *seated authoring* surface like the Fleet Control
Center, not a glance surface. Whether it lives as a pane of the Control
Center, a tab of the website, or its own window is an open product question
(below); its *authority* is settled either way: it reads projections from the
cool bus, subscribes to run status on the hot bus, and submits changes as
durable commands — exactly the chapter 19 bus contract, no third transport.

Trigger firings enter the daemon exactly where chapter 14 already says all
work enters:

```text
trigger fires (io-dispatch)
  -> classifyTrust(event)                        # ADR-0093, lib/fleet/trust.ts
  -> validateAllowedToolsForTier(tier, plan)     # fail closed
  -> WorkIntentService.create({source, goal, constraints})   # one intake, no fork
  -> WorkPlanner instantiates the automation's plan template
  -> (approval gate if tier requires it)
  -> AgentNodeService.materialize -> run -> Work Receipt -> sinks
```

The automation does not get its own launch verb, transcript store, budget
system, or state machine. It is a *standing Work Intent generator* bound to a
*reusable Work Plan template*. Everything downstream of intent creation is
chapters 14, 03, and 09 verbatim.

## The differentiator, as a UX contract

Per `agentic-coding-ux-designer`, the loop is the prompt-to-plan-to-diff flow
with the "diff" replaced by a wiring graph, and it must satisfy the same six
obligations — intent shown before action, progress legible, review cheap,
rollback obvious, durable receipt, comeback trigger:

1. **First gesture:** a sentence. The composer accepts plain English (typed
   into the Automations app, FleetBar's command bar, or `pd automate "..."`).
   No trigger picker as the entry point — the picker is what Zapier makes you
   do; here it is the agent's output, not the operator's homework.
2. **Intent before action:** the agent's proposal renders as a graph —
   trigger node (kind, source, trust tier), agent node(s) with grafted skills
   named per chapter 19's Seamanship rule, budget envelope, sink node(s).
   Every node is editable; the graph is a proposal, not a fait accompli.
3. **Consent gate:** one card, per `human-gate-designer`'s presentation
   principles — context ("what this automation will do and when"), the
   decisions highlighted (which tools, which sinks, what trust tier the
   trigger runs at), estimated cost per firing and per month at the observed
   trigger rate, and approve / **modify** / reject where modify takes free
   text back into the plan-writing agent. Chapter 20 law 11 applies: cost
   appears here, at the consent moment, and nowhere else.
4. **Progress legible:** an armed automation shows its last firing, next
   expected firing (for schedules), current-run state on the hot bus, and a
   spend meter against the envelope. Silence is rendered as silence ("no
   firings in 12 days"), never as a spinner — the infinite-spinner trust
   fall is the named anti-pattern.
5. **Rollback obvious:** disarm is one click and takes effect before the next
   firing; every automation edit is a new version with the old one restorable;
   a misbehaving automation's runs are individually replayable against the
   fixed version.
6. **Receipt and comeback:** every run's receipt is one click from the run
   row; the delivery sink carries a link back to the receipt. The comeback
   loop is the receipt itself: "your automation did X, cost Y, here is
   proof" is the notification that makes the operator return.

Per `human-gate-designer`'s placement tree, gates go where the tree says and
nowhere else: at arm/re-arm time (irreversible standing consent), before any
irreversible sink action (send email, post to GitHub, SMS) when the firing's
trust tier requires approval, and on low-confidence plan instantiations.
Not after every node — an automation that interrupts the operator every
firing has failed at its one job.

## Contracts and schemas

Reuse-first, per F0 v0. What already fits, unchanged:

| Need | Existing v0 contract | Notes |
| --- | --- | --- |
| a firing becomes work | `work-intent.schema.json` | `source.kind` already carries `webhook` and `schedule`; `idempotencyKey` is the dedup primitive (below) |
| the plan per firing | `work-plan.schema.json` | the automation stores a plan *template*; each firing instantiates a plan with `intentId` bound |
| proof of the run | `work-receipt.schema.json` | `intent`, `spend`, `actions`, `provenance`, `validation` cover the audit story; `prRefs` covers GitHub sinks |
| skills on nodes | `skill-graft.schema.json` | every plan-template node names its grafted skills, chapter 19 rule |
| per-run gates | `control-command.schema.json` + chapter 18 C5 gate envelopes | approvals land as durable decisions, rendered in FleetBar |
| mid-run steering | `guidance-envelope.schema.json` | operator guidance to a running automation firing is the same signed channel as any run |
| spend tracking | `cost-accrual-event.schema.json` | the budget envelope is enforced against these events |

One new record is genuinely needed — the standing binding itself:

```jsonc
// schemas/agent-harbor/v0/automation.schema.json (proposed)
{
  "schema": "agent-harbor/v0/automation",
  "automationId": "atm_...",
  "name": "Morning Sentry triage",
  "description": "operator's original plain-English request, verbatim",
  "version": 3,                       // every edit bumps; old versions restorable
  "trigger": {
    "kind": "webhook | email | sms | cron | calendar | file | git | github | pd",
    "config": { /* per-kind: HMAC secret ref, cron expr, allowlisted senders, path globs */ },
    "trustPolicy": {                  // ADR-0093 vocabulary, not a new one
      "allowlistedAuthors": ["alerts@sentry.io"],
      "minimumTier": "AUTHENTICATED_EXTERNAL"
    }
  },
  "planTemplate": {                   // work-plan shape with parameter slots
    "shape": "single | chain | dag",
    "nodeSpecs": [ { "goalTemplate": "...", "skillGrafts": [...], "allowedTools": "Read,Bash(gh *)" } ]
  },
  "budget": { "perRunUsd": 0.25, "perMonthUsd": 15, "onExhausted": "pause" },
  "sinks": [ { "kind": "github | email | sms | file | webhook | calendar | notify-macos | pd",
               "config": { /* guarded: url-guard / path-guard apply */ } } ],
  "consent": { "state": "draft | pending | armed | paused | retired",
               "approvedBy": "...", "approvedAt": "...", "gateReceiptRef": "..." },
  "provenance": { "authoredBy": "agent | operator", "authoringSessionId": "...",
                  "galleryOrigin": null },
  "createdAt": "...", "updatedAt": "..."
}
```

And one projection joining the loop end to end (chapter 09 owns the table
shapes): `automation_runs(automationId, version, triggerEventId, intentId,
planId, receiptId, tier, outcome, firedAt)` — the row that lets the operator
ask "what did this automation do in March, and which firing sent that email."

Schema deltas this chapter formally requests from the F0 owner (chapter 16
logs the contradiction if they are refused rather than decided):

1. `work-intent.schema.json` `source.kind` lacks `email`, `sms`, `file`,
   `git`, `github`, and `calendar` — six of the nine shipped trigger kinds
   cannot yet be named honestly as intent sources. Either extend the enum or
   add `source.triggerKind` alongside `kind: "webhook" | "schedule"`.
2. `work-intent` needs an optional `automationRef { automationId, version,
   triggerEventId }` so receipts trace back to the standing object without a
   side channel.
3. `work-receipt` needs the same optional back-reference (or inherits it
   through `intent`).

## Trust obligations (non-negotiable, inherited)

The entire ADR-0093 substrate applies, per `fleet-event-spawn-trust`, and the
plan-writing agent does not get to relax it:

- **Transport auth is not content trust.** An HMAC-verified Sentry webhook
  proves the relay, not the author. `classifyTrust` runs on content source;
  a firing is `AUTHENTICATED_EXTERNAL` only when the author is allowlisted
  *and* `consent_verified` — the automation's `trustPolicy.allowlistedAuthors`
  feeds exactly this check, and the HMAC alone never elevates the tier.
- **Every external-triggered plan template declares `allowedTools`,
  explicitly.** Absent means unrestricted means refused: the consent gate
  will not arm an automation whose external trigger feeds a node with no
  declared tool set. This is the fail-closed rule from
  `validateAllowedToolsForTier`, moved forward to authoring time so the
  operator learns at the consent card, not at 3am.
- **The plan-writing agent is itself an injection surface.** The plain-English
  description is operator-authored (OPERATOR tier), but a gallery-imported
  automation's description and template are third-party content: importing
  from the gallery re-runs the full consent gate with provenance shown, and
  the imported template's tool set is validated against the *importer's*
  policy, never trusted because a receipt elsewhere was green.
- **Sinks are guarded.** Every webhook sink URL passes
  `assertSafeOutboundUrl`; every file sink passes `containPath`. Templates
  with `{date}`-style expansion expand before containment, per the shipped
  guard.
- **Anonymous external firings never act irreversibly without a gate.**
  `requiresApproval` is a whitelist of trusted tiers; an unknown or
  anonymous tier queues a FleetBar gate or runs read-only, per the
  automation's declared policy — and the gate card never renders for a body
  that cannot honor the decision (chapter 19, IT-016).

## Receiver discipline (inherited from the webhook chapter of record)

Per `webhook-receiver-design`, the trigger intake half of every automation
must satisfy the receiver contract, and the v0 reuse makes most of it free:

- **Idempotency:** the provider's event id (e.g. `X-GitHub-Delivery`) maps
  onto `WorkIntent.idempotencyKey` with a uniqueness constraint — a retried
  delivery is one firing, one run, one receipt. This is a DB constraint, not
  a cache.
- **Raw-body HMAC with `timingSafeEqual` and a replay window** — shipped in
  `lib/fleet/webhook-hmac.ts`; the automation record stores a secret *ref*,
  never the secret.
- **Ack fast, run slow:** trigger acknowledgment is decoupled from the agent
  run — the intake persists the event and returns; the run proceeds on the
  daemon's schedule. A provider timeout must never depend on model latency.
- **Out-of-order truth:** automation prompts treat the trigger payload as a
  notification, not a delta — plan templates that act on provider state
  (issues, PRs, calendar) re-read it from the provider at run time.
- **Dead-letter and replay:** a firing that fails N times dead-letters with
  its reason; the Automations app lists dead-lettered firings and replays
  them by id against the pinned automation version. "Sarah replayed them on
  Monday" is a supported flow, not an incident postmortem.

## The gallery (position stated, economics deferred)

A published automation is the automation record minus secrets and
operator-specific config, plus its receipt history as proof-of-function. The
gallery is the receipt-as-good economy (strategy §4) applied to automations:
browsing is free, importing re-runs consent locally (trust section above),
and leasing — running someone's automation with metered payment back to the
author — is M10-territory and explicitly out of scope for the first gates.
What this chapter fixes now is only the *shape*: publication strips secrets,
carries provenance, and imports fail closed. Pricing, revenue share, and
reputation staking go to the economist lane (chapter 11's incentive review),
not here.

## Acceptance gates

Continuing the chapter 00 integration-test numbering after chapter 19's
IT-018:

### IT-019 Plain-English Wiring

Fixture: the operator types "every morning, summarize overnight Sentry
errors and open issues for the P1s" into the composer.

Verify: an agent produces a trigger→plan→sink graph where the trigger is a
webhook (or cron+fetch) with a named trust policy, every plan node names its
skill grafts and an explicit `allowedTools`, and each sink is one of the
shipped output kinds; the consent card shows tools, tier, sinks, and
estimated per-run and per-month cost; nothing fires before approval; the
approval lands as a durable gate decision referenced from the automation
record.

### IT-020 Trigger-To-Receipt Trace

Fixture: an armed automation receives a signed webhook delivery, then the
same delivery retried, then a stale delivery outside the replay window.

Verify: exactly one WorkIntent exists (idempotency key = provider event id);
the run produces a Work Receipt whose back-reference chain
receipt→intent→triggerEventId→automationId resolves; the retry is a dedup
no-op; the stale delivery is rejected; a cron automation fires within its
declared schedule tolerance (the fire-time gate defect is fixed, not worked
around); daemon-down during a firing produces a dead-lettered event that
replays cleanly on restart.

### IT-021 Trust Tiering On The Standing Path

Fixture: the same automation fired three ways — by an allowlisted, verified
author; by an anonymous external sender through the same verified relay; and
with a tampered plan template requesting `Bash` on an anonymous trigger.

Verify: the verified firing runs with exactly the declared tools; the
anonymous firing is gated or degraded per the automation's `minimumTier`,
and the transport HMAC alone never elevates it; the tampered template is
refused at validation with a denial receipt, fail closed; the receipt of
every firing states the tier it ran at.

### IT-022 Disarm, Version, Replay

Fixture: the operator edits an armed automation, then disarms it, then
replays a historical dead-lettered firing.

Verify: the edit creates version N+1 and re-runs the consent gate; firings
between edit and approval run version N; disarm takes effect before the next
firing and is visible on all surfaces within the hot-bus budget; the replay
runs against the version that originally failed and its receipt is marked as
a replay; a gallery export of this automation contains no secret material.

## Relationship to earlier chapters

- Chapter 14 owns the intake spine; this chapter adds a standing generator in
  front of it and no second path. `io-dispatch`'s direct spawn is a bridge
  with the same demotion schedule as `spawn` and `/visual-tasks`.
- Chapter 19 owns the triad and the bus contract; the Automations app is a
  spoke bound by both, and FleetBar keeps the consent monopoly.
- Chapter 03's compliance ladder governs the bodies automations run;
  chapter 13's zero-trust amendments apply to every broker call a firing
  makes.
- Chapter 09 owns the table shapes for the `automation` record and the
  `automation_runs` projection proposed here.
- Chapter 18's C5 gate envelopes are the per-run approval mechanism; this
  chapter adds the arm-time gate as a second use of the same envelope, not a
  new gate kind.
- Chapter 20 governs the app's skin and copy: cost at the consent moment
  (law 11), teaching empty states for a fleet with no automations (law 12),
  honest LIVE/stale chips on run status (law 13).
- Chapter 16's Architect of Record owns the schema deltas requested above
  and logs this chapter's claims until IT-019..IT-022 hold; per
  `architecture-binder-of-record`, the concept is not "covered" by this
  prose — it is covered when each gate names an owner and links evidence.

## Open questions (honest, unresolved)

1. **Name.** "Automations" is the working name; strategy §10 floats "the
   Tideworks deck." Operator call; the harbor vocabulary (chapter 19's
   Navigation/Seamanship precedent) argues for a nautical name, adoption
   argues for the boring one.
2. **Where the graph editor lives.** A Fleet Control Center pane keeps the
   sanctioned-surface count flat (PR #652's consolidation, and the hard rule
   against standalone web surfaces); a web app reaches non-coders who will
   never install a native bundle. Possibly both from one implementation —
   the Control Center's webview *is* the fleet-ui content. Unresolved;
   whichever lands must appear as a `FleetControlSurface` case.
3. **Schema deltas.** The `source.kind` enum gap and the `automationRef`
   back-reference (above) need an F0 owner decision before IT-020 can be
   written honestly.
4. **Scheduler authority.** Fixing the fire-time cron gate is claimed as a
   prerequisite here, but the fix's owner and its relationship to the
   `bosun` supervisor are not yet assigned.
5. **Firing while the laptop sleeps.** Email/webhook triggers already land
   on the relay; whether a relay-buffered firing may *start* a run remotely
   or only queue it for the local daemon touches the chapter 02 authority
   boundary and is not decided here.
6. **Gallery economics.** Leasing, revenue share, and reputation staking are
   deliberately deferred to the economist lane; only the secret-stripping
   and consent-on-import shape is fixed by this chapter.
7. **Budget exhaustion semantics.** `onExhausted: pause` is proposed as the
   default; whether a paused-by-budget automation may auto-resume at the
   month boundary or requires re-consent is a human-gate design call not yet
   made.
