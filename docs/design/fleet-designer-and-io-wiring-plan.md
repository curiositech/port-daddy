# Fleet Designer + I/O Wiring — Design & Plan

A design for the GUI that **creates and edits agent / trigger / output configs**, a
concrete **build plan for the email / SMS / iMessage / calendar trigger+output
wiring**, and the **big example ideas** that fall out of both.

Grounded in two code audits (June 2026). The honesty rule throughout: **never
present a stubbed capability as shipped.** Every feature below is tagged
`SHIPPED`, `WIRED-NOT-EXPOSED`, or `ROADMAP`.

---

## 0. What actually exists today (the baseline)

- **Two layers.** The **legacy fleet engine** (`lib/fleet-engine.ts`) is what runs.
  It parses a *singular* `trigger:` / `schedule:` per agent and fires
  `on_success:` / `on_failure:` hooks. A **clean, fully-typed pluggable
  trigger/output registry** (`lib/fleet/triggers/*`, `lib/fleet/outputs/*`,
  `lib/fleet/types.ts`) exists but **has zero engine callers** — it is an unwired
  island. The plural `triggers:` / `outputs:` YAML is **not parsed by anything**.
- **Shipped triggers:** git-commit, cron `schedule`, pub/sub channel, tuple-space,
  watchers, and the one closed external-inbound loop — **GitHub webhook**
  (CF Worker → HMAC-verified receiver → channel → ship → `gh` PR comment back).
- **Shipped outputs:** pub/sub, shell exec, **GitHub PR comment / issue / draft-PR
  via `gh`** (`lib/fleet/github-output.ts`), macOS notification, generic outbound
  webhook (HMAC + SSRF-guarded), file write.
- **Real but unexposed:** the registry's `available()` contract — every
  `TriggerSource`/`OutputSink` returns `{ ready, reason, requires }`. This was
  *designed* for a status board. And `lib/fleet/consent-gate.ts` (default-deny,
  per-(sink,recipient) allowlists, JSONL audit, `pd fleet consent grant/revoke`) is
  **complete and shippable.**
- **Stubbed (do NOT sell):** inbound email (IMAP poll returns `[]`), outbound email
  (`send()` returns `{stubbed:true}`), SMS, iMessage, calendar, the registry `github`
  sink (returns `#stub`).

---

## 1. The Fleet Designer — a GUI for authoring agent/trigger/output configs

### The core tension
YAML is precise and diffable but intimidating and easy to get subtly wrong
(wrong channel name, cyclic triggers, a budget typo). Prose is approachable but
ambiguous. **Resolve it with one bidirectional surface, three synchronized
representations** — never make the user choose a format up front.

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │  FLEET DESIGNER                                   [Form] [YAML] [Graph]│
  ├───────────────────────────────┬──────────────────────────────────────┤
  │  DESCRIBE (prose → config)    │   LIVE pd-fleet.yml (syntax-highlit)  │
  │  "When a PR opens, review it  │   gardener:                          │
  │   for security bugs and       │     trigger: pull_request:opened  ✓  │
  │   comment on the PR."         │     backend: cli:claude-code      ✓  │
  │            ↓ Propose          │     prompt: |                        │
  │  ┌─────────────────────────┐  │       You are the security…          │
  │  │ trigger  [pull_request▾]│  │     output: github:pr-comment     ✓  │
  │  │ backend  [claude-code ▾]│  │                                      │
  │  │ budget   [$2/day ──●──] │  │   ● valid · acyclic · in budget      │
  │  │ prompt   [ large editor]│  │                                      │
  │  └─────────────────────────┘  │                                      │
  └───────────────────────────────┴──────────────────────────────────────┘
```

### How it's encoded
The single source of truth is `pd-fleet.yml`. The GUI is a *projection* of that
file — it reads/writes the real schema (`agent: { trigger, backend, fallbacks,
singleton, prompt, identity, telos, cooldown_ms }`), so there is no GUI-only
state to drift. Open an existing repo's `pd-fleet.yml` → it round-trips through
the editor losslessly. (`WIRED-NOT-EXPOSED`: the parse/serialize already exists
in `fleet-ast.ts`.)

### The three views (toggle, always in sync)
1. **Describe (prose → config).** A natural-language box that proposes a
   structured agent. This is the **Shipwright** capability made interactive
   (`SHIPPED` as a CLI/console concept: it surveys a repo and proposes a fleet).
   "Every morning, summarize what changed and post it to the team channel" →
   fills `schedule: 0 8 * * *`, `output: pd:channel`, a prompt scaffold. The
   prose is a *starting point*, never the stored form — it compiles to the
   structured config the user then refines.
2. **Form.** One card per agent. Typed controls: a **trigger dropdown that only
   enables SHIPPED triggers** (git, schedule, channel, tuple, GitHub webhook);
   stubbed triggers (email, SMS, calendar) appear **disabled with a "not wired
   yet — see roadmap" tag**, never as if they work. A backend **ladder picker**
   (claude-code → codex → cloudflare fallbacks). A **budget slider** bound to
   `budget_usd_per_day`. A `singleton` toggle.
3. **Prompt editor — first class.** The prompt is the load-bearing field
   ("where the hell is the agent prompt"), so it gets a large, monospace,
   syntax-aware editor pane, not a cramped textarea. Token/cost estimate live.
4. **YAML.** The live file with **syntax highlighting** (the YAML highlighter
   already shipped on the site — same token colors), bidirectional: edit YAML,
   the form updates; edit the form, the YAML updates. Dev appeal: this is the
   real artifact, copy-pasteable, diffable, git-committable.
5. **Graph.** The trigger→agent→output **wiring diagram** (the operad/anatomy
   view): boxes for agents, edges for channels, so you *see* who wakes whom.

### Easy to **see / validate / fix / read / adjust / think about**
- **Validate (live, inline, green/amber/red):** unknown channel name (amber:
  "no agent publishes to `qa:findings`"), **cyclic trigger graph** (red — the
  daemon already checks acyclicity; surface it as you type), budget ceiling
  exceeded, a trigger that is a stub ("`email:received` won't fire — not wired").
  Validation is honest about roadmap features instead of letting you author a
  config that silently never runs.
- **Fix:** every red/amber has a one-click suggested fix ("create the missing
  channel", "lower the budget", "switch to a shipped trigger").
- **Read / think:** an **Explain mode** = the AgentAnatomy view (every line
  labeled with what it does and who acts on it) plus a plain-language sentence
  per agent ("Wakes on every PR; runs Claude Code; comments on the PR; capped at
  $2/day").
- **Rehearse before commit:** the Shipwright already *rehearses* cost and wake
  times — surface that as a "dry run" panel: "this fleet would wake ~12×/day and
  cost ≤ $5.50, here's the first thing each agent would see."

### User appeal vs dev appeal
- **Dev:** lives in the YAML + Graph views, gets real validation, commits the
  file. The GUI is a faster, safer editor — not a replacement for the file.
- **Non-dev / new user:** lives in Describe + Form, never sees raw YAML unless
  they ask. The prose box + dropdowns + sliders make a fleet without learning
  the schema.
- **Both:** the same file underneath, so a dev can review what a non-dev
  authored as a normal diff. Colorful, house cobalt/coral, syntax highlighting,
  the wiring graph — legible, not a wall of gray text.

### Where it lives
- **Mac app / FleetBar** — the natural home (`FleetStore.swift` already models
  fleets). A new "Designer" surface.
- **Or a web `/fleet/new`** authoring page on the site, exporting a `pd-fleet.yml`
  to download + a `pd fleet up` CTA. Lower lift, no native work, and it doubles
  as marketing (try it before you install).

---

## 2. Build plan — email / SMS / iMessage / calendar / wiring

The transports are stubbed AND the registry that would host them is unwired. So
the plan has **one keystone task** followed by **per-transport work**, each
landing behind the honest health board.

### Step 0 (KEYSTONE) — wire the registry into the engine
Make `fleet-engine.ts` resolve triggers/outputs through `buildTriggerRegistry`
/ `buildOutputRegistry` / `resolveOutput` and parse the plural `triggers:` /
`outputs:` YAML. **This single task converts ~6 stubbed/partial sources into a
coherent substrate** and is the prerequisite for everything below. Until it
lands, no transport matters because nothing dispatches through it.
- Add plural-form parsing to `fleet-ast.ts` (keep singular as sugar).
- Engine: for each agent, instantiate its `TriggerSource`(s), subscribe, and on
  fire run the agent; on completion route results through each `OutputSink`.
- Gate every sink call through the existing `consent-gate.ts` (already done in
  the registry sinks — just needs to actually be invoked).

### Step 1 — the honesty surface first (cheap, high-trust)
Stand up the **trigger-source health board** (Mac app + `pd fleet sources`)
reading each source/sink's `available() → {ready, reason, requires}`. It shows
"Email: not configured — set `PD_EMAIL_IMAP_HOST`" and "iMessage: macOS only,
Full Disk Access required." This ships *before* any transport and makes the
stubs honest (status, not pretense). It also de-risks every later step: the moment
a transport works, its row flips to ready with no marketing change.

### Step 2 — transports, in ascending order of ick
Each is a small, isolated change to one `triggers/*.ts` or `outputs/*.ts` file;
the architecture and consent gating already exist.
1. **Email OUT** (`outputs/email.ts send()`): drop in `nodemailer` (SMTP) with a
   SendGrid/Postmark fallback. Already consent-gated `pii:'high'`. Lowest risk,
   highest "morning briefing" demo value. *Adds dep: nodemailer.*
2. **Email IN** (`triggers/email.ts fetchUnseenSinceLastPoll`): `imapflow` poll,
   seen-UID bootstrap already designed (won't replay history). Filter syntax
   `email:received(from:@team.com,subject:standup)` already specified.
3. **SMS** (`triggers/sms.ts` + `outputs/sms.ts`): Twilio out + Twilio inbound
   webhook (reuses the real webhook receiver path). Cleaner than chat.db.
4. **iMessage** (`triggers/sms.ts` chat.db branch): macOS-only, tail
   `~/Library/Messages/chat.db` for inbound; AppleScript for outbound. Gate hard
   behind Full Disk Access + a loud consent prompt (reading iMessage is
   sensitive). Lowest priority, highest privacy surface.
5. **Calendar** (`triggers/calendar.ts` + `outputs/calendar.ts`): CalDAV first
   (works for iCloud/Google/Fastmail), Google Calendar API as a richer option.
   Enables `calendar:event-starting(30m)` triggers.

### Step 3 — the rule for each as it lands
Badge progression per transport: **`stubbed` → `wired (behind health board)` →
`shipped (creds + a green e2e test)`**. Only the last state earns marketing copy.
Mirror the Mac-install contract test: a per-transport contract test that the docs'
commands match the code, plus a gated live smoke test (like
`website-v2/scripts/test-mac-install.sh`).

---

## 3. Big example ideas (synthesized)

### Shippable today (use these for marketing now)
- **GitHub bot on your laptop** *(SHIPPED)* — "Your repo's CI bots, but they run
  on your machine and write to the PRs you already read." The full loop ships:
  webhook receiver → ship → `gh` PR comment/issue. **Strongest honest story.**
- **Notify-me agent** *(SHIPPED)* — schedule/git-triggered ship → macOS banner or
  a generic outbound webhook to a Slack incoming-webhook URL. Slack *outbound*
  works today via the generic webhook (Slack-as-typed-sink does not).
- **Signed event webhooks** *(SHIPPED)* — "every lock, claim, and message can fire
  an HMAC-signed webhook" (`lib/webhooks.ts`, SSRF-guarded).
- **Consent center** *(SHIPPED backend)* — "personal-agent outputs are default-deny,
  every PII send is gated and audited." A real trust story even pre-transports.

### Unlocked by the wiring (label "needs §2")
- **Email a repo, a fleet triages it** — inbound email → agent (needs Email IN +
  keystone).
- **Morning briefing email** — cron ship → outbound email summary (needs Email
  OUT + keystone; the cheapest first win).
- **Calendar-aware standup** — `calendar:event-starting(30m)` → agent assembles
  the standup from git + notes (needs Calendar + keystone).
- **SMS incident page** — a `qa:findings` channel event → SMS to the on-call
  (needs SMS + keystone).

### Site placement
The shippable four belong on the examples page now (the GitHub bot especially).
The wiring-unlocked four belong in the Fleet Designer's "describe an agent"
gallery as *templates*, clearly marked "available once the connector ships" —
which is exactly what the health board makes honest.

---

## Appendix — key files
- Engine (runs): `lib/fleet-engine.ts`, `lib/fleet-daemon.ts`, `fleet-ast.ts`
- Registry (island): `lib/fleet/triggers/*`, `lib/fleet/outputs/*`, `lib/fleet/types.ts`
- Consent (real): `lib/fleet/consent-gate.ts`
- Real GitHub output: `lib/fleet/github-output.ts` (NOT `outputs/github.ts`, a stub)
- GitHub inbound: `routes/github-webhook.ts`, `apps/github-app-receiver/`
- Shipwright (fleet proposal): `lib/shipwright/archetypes.ts`
- Mac app stores: `FleetStore.swift`, `DispatchStore.swift`, `CostStore.swift`, `SecretsView.swift`
