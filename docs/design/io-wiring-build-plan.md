# I/O Wiring — Registry → Engine Build Plan

Status: **Phase 1 implemented in this branch (`feat/io-wiring-registry`).** Phases
2–5 are ROADMAP. The honesty rule is load-bearing: a channel is only "shipped"
when it has real creds-or-no-creds dispatch AND a green end-to-end test. Anything
short of that is tagged `WIRED` (resolves through the engine but `available()`
returns `{ready:false}`) or `STUB`.

This plan grounds in two facts verified by reading the code (June 2026), not the
design summary:

1. The legacy engine (`lib/fleet-engine.ts`) treats `agent.trigger` as a **channel
   name** — it calls `resolveChannel(agent.trigger)` and subscribes via
   `options.messaging.subscribe(...)` (see `startAgent`, ~L910). It has **no
   awareness** of the `kind:type(filters)` trigger-spec grammar.
2. The pluggable registry (`lib/fleet/triggers/*`, `lib/fleet/outputs/*`,
   `lib/fleet/types.ts`) is **fully typed and partially real but has zero engine
   callers**. Its only consumers today are the pure-function tests in
   `tests/unit/fleet-personal-triggers.test.js`. This is the "unwired island" the
   design doc names.

---

## Current state — what is real vs not (quoting code)

### The engine seam (where wiring slots in)

`startAgent(agent)` in `lib/fleet-engine.ts` is the dispatch fork. Today:

```ts
if (agent.trigger) {
  const physicalTriggerChannel = resolveChannel(agent.trigger);
  const unsubscribe = options?.messaging?.subscribe(physicalTriggerChannel, (message) => {
    void requestAgentRun(agent, contextFromMessage(agent.trigger!, message));
  });
  // ... fallback to `pd watch` subprocess if no in-process messaging
}
```

Outputs today are **only** `on_success: publish <channel>` / `on_failure:` hooks,
fired via `fireHook(...)` which POSTs to `/msg/<channel>`. There is **no
registry-backed output dispatch** at all.

### The registry (the island)

- `buildTriggerRegistry(deps)` → `Map<TriggerSourceKind, TriggerSource>` and
  `resolveTrigger(raw, registry)` → `{ source, spec }` exist and work
  (`lib/fleet/triggers/index.ts`).
- `buildOutputRegistry(deps)` → `Map<OutputSinkKind, OutputSink>` and
  `resolveOutput(raw, partial, registry)` → `{ sink, payload }` exist and work
  (`lib/fleet/outputs/index.ts`).
- `parseTriggerSpec` / `parseOutputTarget` (`lib/fleet/types.ts`) parse the
  `kind:type(filters)` grammar and **validate the kind against a known list**.

### Per-channel reality (verified by reading each `available()` / `dispatch()` / `start()`)

| Channel | Trigger | Output | Needs creds? | Phase |
|---|---|---|---|---|
| **file** | REAL (`fs.watch`, debounced, `available()→{ready:true}`) | REAL (`writeFileSync`/`appendFileSync`, `{date}`/`{iso}` tokens, consent-gated at `pii:high`) | No | **Phase 1 (proven)** |
| **schedule** (cron) | REAL (façade over engine cron) | n/a | No | Phase 1 (registered) |
| **webhook** | REAL once a receiver registers a handler; `available()→{ready:true}` but `start()` is a no-op until `registerHandler` is supplied | REAL (HMAC + SSRF-guarded, `lib/fleet/outputs/webhook.ts`) | URL/secret | Phase 2 |
| **pd** / **git** / **github** | REAL via channel subscribe | REAL (`gh` for github via `lib/fleet/github-output.ts`; pd internal) | gh/token | already shipped (legacy path) |
| **notify** (macOS) | n/a | REAL (`osascript`) | macOS only | Phase 2 |
| **email** | STUB (`available()→{ready:false, reason:'IMAP credentials'}`; `fetchUnseen` returns `[]`) | STUB (`send()` returns `{stubbed:true}`) | SMTP/IMAP | **ROADMAP** |
| **sms** | STUB (`{ready:false}`, Twilio/iMessage) | STUB | Twilio | **ROADMAP** |
| **calendar** | STUB (`{ready:false}`, EventKit/CalDAV/Google) | STUB | CalDAV/OAuth | **ROADMAP** |

The stubs are **honest** today: each `available()` returns `{ready:false, reason}`.
The wiring's job is to make the engine *resolve through the registry so those
honest signals surface*, and to make the real channels (file, webhook) actually
fire and dispatch.

---

## Target architecture

```
pd-fleet.yml
  agent:
    trigger: file:changed(~/notes/)      # singular OR…
    triggers:                            # …plural (NEW, additive)
      - file:changed(~/notes/)
    outputs:                             # NEW, additive
      - file:append(~/notes/digest.md)

        │  fleet-ast.ts: parse plural triggers[]/outputs[] → FleetAgent
        ▼
FleetAgent { trigger?, triggers?: string[], outputs?: string[], … }
        │
        ▼  fleet-engine.ts startAgent():
        │   for each trigger string:
        │     spec = parseTriggerSpec(raw)
        │     if spec is a REGISTRY kind (file/webhook/schedule/email/…):
        │         resolveTrigger → source.available() → source.start(spec, emit)
        │         on emit(event): requestAgentRun(agent, contextFromTriggerEvent(event))
        │     else:                       # legacy channel name (qa:findings, git:committed)
        │         resolveChannel + messaging.subscribe   (unchanged)
        │
        ▼  on agent completion (runAgentOnce success path):
            for each output string:
              resolveOutput(raw, {body,title,…}, outputRegistry)
              → sink.available() → sink.dispatch(payload)   (consent-gated inside sink)
```

Key seam principles:

- **Additive, non-breaking.** Singular `trigger:`/`schedule:` and `on_success:`
  hooks keep working untouched. The registry path only engages when a trigger
  string parses as a *registry-kind* spec (and that kind is not one already owned
  by the legacy channel path, i.e. `pd`/`git`/`github`/`schedule` stay on the
  channel/cron path to avoid double-dispatch — see Phase 1 scope below).
- **Honest availability.** Before a source `start()`s, the engine calls
  `available()`. If `{ready:false}`, the engine refuses to start that trigger and
  emits a clear diagnostic (it does NOT silently hang) — this is what makes the
  email/sms/calendar stubs *visible as "not wired"* instead of pretending.
- **Consent stays in the sink.** Output sinks already call
  `getSharedConsentGate().assertAllowed(...)` internally (file does at `pii:high`).
  The engine does not bypass it.

---

## Phases

### Phase 1 (THIS BRANCH) — core registry→engine wiring, proven on `file`
Scope, deliberately narrow so it is real and testable end to end:

- `fleet-ast.ts` + `fleet-engine.ts` types: parse additive `triggers:` (string
  list) and `outputs:` (string list) into `FleetAgent.triggers` / `.outputs`.
  Singular `trigger:` is folded in as the first element.
- New module `lib/fleet/io-dispatch.ts`: a thin, dependency-injected bridge that
  builds the trigger + output registries and exposes:
  - `resolveAgentTriggers(agent)` → which trigger strings are registry-kind vs
    legacy-channel.
  - `startRegistryTrigger(spec, onFire)` → calls `available()` then `start()`,
    returns a `TriggerHandle` (or a typed refusal when not ready).
  - `dispatchAgentOutputs(agent, payload)` → resolve + dispatch each output,
    returning per-sink results/errors.
- `startAgent()`: for each registry-kind trigger, route through the bridge; legacy
  channel triggers stay on the existing path. Handles are added to
  `cleanupHandles` so `stopRunningRecord` tears them down.
- `runAgentOnce()` success path: after `agent_completed`, dispatch declared
  `outputs:` through the bridge. Failures route to `on_failure`-style logging but
  do not crash the agent.
- **Proven path:** `file:changed(<dir>)` trigger → agent runs → `file:write/append`
  output lands on disk. Both are real, no creds.
- `schedule` registry kind is intentionally **left on the legacy cron path**
  in Phase 1 (the `schedule:` field and `trigger: schedule:…` both already work)
  to avoid double-firing; the registry `CronTriggerSource` is registered for
  future use by the designer/health board.

Honesty: `email`/`sms`/`calendar` trigger strings, if declared, will resolve
through the registry and be **refused at `available()`** with their existing
`{ready:false, reason}` — surfaced as a diagnostic, never silently dropped.

### Phase 2 — webhook + notify end-to-end + health board
- Supply the engine's webhook `registerHandler` dep (the receiver route exists in
  `routes/github-webhook.ts`; generalize to arbitrary slugs) so `webhook:<slug>`
  triggers fire for real.
- Wire `notify:` (macOS) and `webhook:` outputs into the same dispatch path
  (both already real sinks).
- Stand up `pd fleet sources` + Mac-app health board reading every
  `available()→{ready,reason,requires}`. (Design doc §1 / §2 Step 1.)

### Phase 3 — Email OUT (`outputs/email.ts`)  — ROADMAP (needs SMTP creds)
Drop in `nodemailer` (SMTP) + SendGrid/Postmark fallback. Consent-gated `pii:high`.
Badge `stubbed → wired → shipped` only on a green creds test. *Adds dep.*

### Phase 4 — Email IN + SMS  — ROADMAP (needs IMAP / Twilio)
`imapflow` poll with seen-UID bootstrap; Twilio out + inbound webhook reusing the
Phase-2 receiver path.

### Phase 5 — iMessage + Calendar  — ROADMAP (macOS FDA / CalDAV / OAuth)
chat.db tail + AppleScript (gated behind Full Disk Access + loud consent);
CalDAV-first calendar then Google Calendar API.

---

## What remains ROADMAP after Phase 1 (explicit)

- **email** (trigger + output): needs SMTP/IMAP provider integration. STUB today.
- **sms** (trigger + output): needs Twilio (or macOS iMessage chat.db). STUB today.
- **calendar** (trigger + output): needs CalDAV/Google OAuth/EventKit. STUB today.
- **webhook trigger firing**: real sink today; trigger needs the receiver
  `registerHandler` dep injected (Phase 2).
- **Health board / `pd fleet sources`** surface (Phase 2).

No marketing copy should claim any of the above works until its phase lands with a
green test.

---

## Appendix — files touched in Phase 1
- `lib/fleet-ast.ts` — parse `triggers:` / `outputs:` string lists.
- `lib/fleet-engine.ts` — `FleetAgent.triggers`/`.outputs` types; registry routing
  in `startAgent`; output dispatch in `runAgentOnce`.
- `lib/fleet/io-dispatch.ts` — NEW bridge (registry build + resolve + dispatch).
- `tests/unit/fleet-io-wiring.test.js` — NEW: registry resolution, dispatch,
  unknown-channel + not-ready refusal, end-to-end file→file.
