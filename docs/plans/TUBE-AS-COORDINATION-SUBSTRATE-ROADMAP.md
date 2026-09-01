# Tube as Coordination Substrate — Roadmap

Last updated: 2026-05-02
Owner: Navigator (cartographer alias). Originated from a four-agent panel synthesis with system-architect, creative-design-virtuoso, multi-agent-protocols expert (workgroup-ai catalog), and a repro-pipeline architect. Source conversation preserved at `docs/recovery/IDEAS-TROVE.md` under `tube-as-coordination-substrate`.

This is a real roadmap, not a brainstorm. Phase numbers map to release-cut intent. V1/V2 cut-lines are intentional.

---

## North Star

**Tube is the conversational projection of a channel.** Every other PD coordination primitive answers a different question — channels (who is listening?), inbox (who is this for?), tuples (what shape is this?), notes (when did this happen?). Tube alone asks *"what was said before, and what is this a reply to?"*

The bet: tube is the cleanest path to a vendor-neutral agent-to-agent wire. Anything with stdio or HTTP composes. Humans are first-class participants for free. Threading + cursors give us replayable, durable conversations that no other primitive can produce.

---

## Primitive Distinction Matrix

| Axis | pub/sub | inbox | tuples | tube |
|---|---|---|---|---|
| Addressing | 1:N anonymous | 1:1, registered | content-addressed | 1:N over channel + `inReplyTo` |
| Durability | persisted, ephemeral semantics | persisted, read/unread | persisted with TTL | persisted **+ per-reader cursor** |
| Threading | flat | flat (typed) | none (set) | **threaded envelope** |
| Replay | manual `?after=N` | drainable | non-issue | **automatic via cursor** |
| Consumer | live SSE swarm | one named agent | blackboard / work queue | **unix pipe / human / scripted loop** |

**Anti-patterns.** Specific recipient → inbox. Shared mutable state → tuples. Exactly-once work distribution → `tuples.in()`. Institutional memory → notes. High-frequency telemetry → raw pub/sub. Norm-governed BDI / mechanism design / synchronous CSP / autonomic MAPE-K → richer protocols, tube is the wrong layer.

Source files: `lib/tube.ts`, `lib/messaging.ts`, `lib/agent-inbox.ts`, `lib/tuples.ts`, `lib/channel-registry.ts`, `lib/coordination-judge.ts`.

---

## Coordination Patterns Tube Unlocks

Three named patterns drawn from `~/coding/workgroup-ai/skills/`:

1. **Contract-Net auctions** (`smith-1980-contract-net-protocol`) — CFP as top-level message, bids as threaded replies, award as reply-to-winning-bid. Thread *is* the contract record.
2. **GPGP/TAEMS commitment threads** (`decker-lesser-1995-gpgp-taems`) — commitment is the root, status updates and renegotiations are replies, replay-from-cursor recovers crashed coordinators.
3. **Dialectical / argument-graph debate** (`toulmin-argument-analysis`, `lakatos`, `agent-conversation-protocols`) — claim → rebuttal → counter-rebuttal as a tree. `inReplyTo` IS the argument graph. `coordination-judge.ts` scores subtrees.

Honorable mention: **BDI intention publication** (`agentspeak-bdi`, `bordini-hubner-2007-jason`) — agents subscribe to intent, not just outcomes.

---

## Prerequisites and Blockers (added 2026-05-02 from Spider harvest)

A Spider harvest pass on 2026-05-02 surfaced four hard prerequisites the original synthesis missed. **These gate later phases — not Phase 0.** Do not ship Phase 3 or Phase 4 until the corresponding blocker is closed.

1. **Activity attribution is broken** — sugar/session/sortie writers stamp `target_id = null` for many rows. The roadmap claim *"audit trail is automatic, replay is free"* is currently false on this path. **Gates Phase 3.** Trove ticket: `activity-target-id-nullability-fix` (status `now`).
2. **Harbor-token capability enforcement is verified-but-toothless** — `harbor-tokens.ts` JWTs encode `capabilities[]`; no route or IPC handler reads the array. Spider rediscovered this 5 separate times. Without enforcement at the tube layer, anyone with the daemon socket can post `cfp` or `award` performatives. **Gates Phase 4.** Either ship capability binding with `tube-acl-v1.md` or explicitly declare "all participants on a channel are mutually trusted."
3. **Channel scoping engine vs archaeology** — stale watchers in foreign worktrees can wake on logical-not-physical channel keys. **Gates Phase 6** (every connector is "one channel + one listener"; cross-project leakage breaks the substrate).
4. **Blob store is Phase 0 mandatory, not V2 optional** — original cut said V1 base64-inlines artifacts. Reversed. Spider's view: base64-inlining DOM trees + screenshots + traces in SQLite tube rows grows row size unboundedly, and skipping blob store makes V2 a migration instead of an extension. Adopt blob store in Phase 0 and reference blob ids from Stevedore V1 envelopes.

Provenance: see Spider harvest report (2026-05-02), §4 "Connections that contradict or warn." Affected Spider waves: 5 separate findings on harbor capability gap (`2026-03-31-v2`, `2026-04-05-eighth`, `2026-04-07-seventeenth`, `2026-04-07-eighteenth`, `2026-03-31-third-run`); activity attribution amplified across S95/S97/S138.

---

## Phases

### Phase 0 — Foundation (this week)

**Goal:** make tube a real substrate, not just a CLI nicety.

- [ ] **`lib/blob.ts` + `routes/blob.ts`** — content-addressed store at `~/.port-daddy/blobs/<sha>`. `POST /blob` (multipart, returns `{id, sha256, size}`), `GET /blob/:id`. ~80 LOC. **Mandatory in Phase 0** (Spider 2026-05-02 reversed the V1-punt decision). Unblocks every artifact-bearing tube use case AND Spark's `shipping receipts` / `autodraft release notes` items.
- [ ] **`docs/coordination/primitives.md`** — codify the distinction matrix above as durable docs. Replaces ad-hoc explanations in tutorials.
- [ ] **`docs/tutorials/pd-tube-as-ui-button.md`** — second tube tutorial showing channel-as-UI-button pattern (post-from-curl, react-from-listener).
- [ ] **Three-horizon briefings follow-on** — `pd briefing` consumes `tuples.scan()` to surface the live-tuple horizon alongside the activity-log horizon. Absorbs Spark item `spider-2026-04-07-three-horizon-briefing.md`.

### Phase 1 — Scout (Chrome extension A, 1 week)

**Goal:** general capture from any web page into a project-scoped tube.

- Manifest V3 extension at `apps/pd-scout-extension/`.
- `Cmd+Shift+K` opens Spotlight-style project picker over `/projects` results, ranked by recency-of-`pd begin`.
- Capture modes: Page, Selection, Region. Readability.js extract for clean text. Screenshot via `chrome.tabs.captureVisibleTab`.
- POST envelope to `<project>:scout:inbox`.
- Reference triage agent: `fleet/triage.sh` calling `pd spawn --backend claude-cli`. Classifies: research-note | issue-draft | skill-graft proposal | "not relevant". Replies in-thread.
- Reply UX: toast (8s auto-dismiss) + Inbox tab on toolbar popover.

**Wow moment to demo.** HN post → 3 keystrokes → 30s later the triage agent replies *"already evaluated this one — see notes/embeddings-bake-off.md, was 2nd to bge-m3, not worth the swap. Rejecting."*

### Phase 2 — Stevedore V1 (Chrome extension B, 2 weeks)

**Goal:** localhost-only rect-select feedback with reproducible artifacts.

- Manifest V3 extension at `apps/pd-feedback-extension/`. Localhost-only enforcement at three layers (manifest `host_permissions`, content script, service worker).
- Drag-rect overlay with cinnabar crosshair. `backdrop-filter: blur(6px)` veil outside rect.
- 3-second decompose: `captureVisibleTab` crop → 16-pt grid `elementsFromPoint` sample → meaningfulness filter (`data-testid` / `aria-label` / `role` / listener / `cursor:pointer`) → subtree minimization (LCA).
- Component-bones overlay with React fiber `_debugSource` (V1: React only).
- Right rail: Tree / A11y / Styles / Data accordions.
- Type tiles: `B` bug | `N` nit | `I` idea. Severity 1–5 for bugs (`nuisance, annoyance, blocker, broken, data-loss`).
- Repro recorder: content-script captures `pointerdown/keydown/input/change`; persistent 4px cinnabar viewport border + draggable HUD pill.
- On stop: emit `repro.spec.ts` from string template. Selector preference: `data-testid` > `getByRole(role,{name})` > short CSS path. Assertion: `expect(...).toBeVisible()`.
- POST to `<project>:feedback:<branch>`. V1 base64-inlines artifacts (skip blob store dependency).
- Redaction: `<input type=password>` and `[data-pd-redact]` zeroed before screenshot.

**Wow moment.** Drag rect on a misaligned button → 90s later a draft PR appears with the failing Playwright test attached.

### Phase 3 — Tube-as-UI rewire (1 week, parallelizable)

**Goal:** make every UI surface a tube participant.

- Migrate destructive dashboard actions (claim/release/lock/spawn/abort) from RPC to tube performatives on `<project>:ui:requests`. Reads stay RPC.
- Same migration for FleetBar destructive actions.
- Each meaningful UI button becomes a *performative* — `request`, `propose`, `approve`, `reject`, `cancel` — not a custom route.
- Payoff: dashboard-driven approval and agent-driven approval are the same wire format. Audit trail is automatic. Replay is free.

### Phase 4 — A2A Protocol Layer (2 weeks)

**Goal:** turn tube into a vendor-neutral agent-conversation language.

- Extend envelope: `pd tube --act <performative> --protocol <name>`. Performatives drawn from `fipa-00037-communicative-act-library` (`request | inform | propose | accept | refuse | cfp | failure`). Protocol templates from `fipa-00025-interaction-protocol-library` (`fipa-contract-net`, `fipa-request`, `fipa-iterated-contract-net`).
- **`pd auction <channel>`** — first-class CFP/bid/award helper. Writes threaded tube messages. Resolves on bid timeout. First real test of the envelope.
- `coordination-judge.ts` learns thread-shape templates: "is this thread a well-formed contract-net round?"
- Publish `tube-acl-v1.md` spec.

### Phase 5 — Stevedore V2 (3 weeks)

- Vue (`__vueParentComponent.type.__file`) and Svelte (`__svelte_meta__.loc`) source-map adapters.
- Generic source-map fallback via `source-map` lib in service worker, resolved from a wrapped fake-error stack at click time.
- DevTools panel for live capture preview.
- CDP `Page.captureScreenshot` (retina, full-page) + `Overlay.highlightNode` while dragging.
- Playwright `trace.zip` capture via sidecar codegen process.
- Voice memo + Whisper transcription.
- Redaction rule editor (per-project, persisted).
- Auto-PR drafting on the agent side (independent shipping cadence — depends on repro reliability).

### Phase 6 — External Connector Zoo (1 week, mostly glue)

Each is ~50 LOC of glue at `bin/connectors/<name>.ts` that converts external events → tube messages and tube replies → external actions.

| Source | Tube channel | Use |
|---|---|---|
| GitHub webhook | `<project>:github:events` | PRs/issues/reviews → agents react |
| Slack `/pd` slash | `ops:slack:commands` | Team-wide command surface |
| iMessage / SMS | `me:phone:inbox` | Existing Track B1 of phone-integration-master-plan |
| Linear webhook | `<project>:linear:issues` | Triage agents auto-respond |
| `git post-commit` | `<project>:git:commits` | Doc-sync agent on every commit |
| Sentry | `<project>:sentry:errors` | Auto-file repro from stack trace |
| Calendar | `me:calendar:upcoming` | Pre-meeting prep |
| Cron / launchd | `<project>:cron:fired` | Scheduled fleet runs |
| FleetBar context menu | `<project>:ui:requests` | Native-feel UI driving agents |

**The unifying point.** PD does not need an integration framework. A tube channel + a `pd tube chat` listener IS the integration framework.

### Phase 7 — Thread-as-Argument-Graph Viewer (3 weeks)

**Goal:** the wow feature that makes PD distinctive in the multi-agent space.

- Render any tube thread as a Toulmin/Lakatos tree in the dashboard.
- `coordination-judge.ts` scores argument quality on the subtree.
- This is the piece *no other PD primitive can do* — only tube has both threading and replay.

### Phase 8 — Open Spec

- Publish `tube-acl-v1.md` with envelope + performatives + interaction-protocol templates.
- Long bet: vendor-neutral wire becomes the default A2A substrate for indie developers.

---

## Cut-Lines

- **Phase 0 + 1 + 2** = a shippable, demo-able product in **4 weeks**.
- **Phase 3 + 4** = the architectural payoff. Do these *before* phase 5 so V2 rides the cleaned-up substrate.
- **Phase 7 + 8** are long bets that turn PD from a personal tool into category-defining infrastructure.

---

## What We Do Not Do

- No keyword-based intent classification on the triage agent — embeddings or Haiku per `~/.claude/CLAUDE.md` policy.
- No emojis as UI icons — Lucide / SF Symbols / SVG only.
- No tube for blackboard state → use tuples.
- No tube for high-frequency metrics → use raw pub/sub.
- No richer A2A protocol layer until the simple envelope has been used in anger for at least one shipped agent loop. Premature ACL design is the swamp this whole space is stuck in.
- No browser extension that touches non-localhost origins. Ever.

---

## Open Questions

- Does Stevedore V1 need the blob store, or is base64-inlining sufficient for 2-week ship? Current call: skip blob store in V1, add in V2 alongside trace.zip.
- Should `pd auction` be its own command or `pd tube auction <channel>`? Lean toward standalone for discoverability.
- How does the triage agent route between Scout and Stevedore? Same agent with different prompts, or two agents? V1: same agent, different prompts.
- Project picker source-of-truth: `/projects` HTTP, or a daemon-pushed snapshot to extension storage? V1: poll on popup open. V2: SSE-pushed.

---

## Provenance

- Synthesis conversation: 2026-05-02 panel of architect / designer / multi-agent-protocols / repro-architect.
- Skill catalog reference: `~/coding/workgroup-ai/skills/` (agent-conversation-protocols, smith-1980-contract-net-protocol, decker-lesser-1995-gpgp-taems, fipa-00037-communicative-act-library, fipa-00025-interaction-protocol-library, agha-actor-model, hoare-1978-csp, bordini-hubner-2007-jason, normative-bdi-agents).
- Source primitives: `lib/tube.ts`, `cli/commands/tube.ts`, `docs/tutorials/pd-tube.md`.
- Existing master plan: `docs/plans/PHONE-INTEGRATION-MASTER-PLAN.md` (Track B1 originated tube).
