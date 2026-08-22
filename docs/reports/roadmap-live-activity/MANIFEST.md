# Visual evidence manifest — roadmap live-activity data layer

Provenance for every artifact in this directory. Read the **Honesty label**
line before you trust a pixel.

---

## Honesty label (the short version)

**SEEDED FIXTURE · REAL SCHEMA · REAL LIB APIs · REAL ROUTE CALLS · NO LIVE DAEMON.**

- Not a mockup. Not hand-written JSON. Not a screenshot of a design.
- Not a live production daemon either, and this manifest does not pretend it is.

What that means concretely:

| Layer | What was used | Real? |
| --- | --- | --- |
| Database | `initDatabase()` (lib/db.ts) → a throwaway file registry under `$TMPDIR`, built by the **shipped migrations** | REAL |
| Registry writes | `createAgents().register()`, `createSessions().start()/end()`, `createRoadmapItems().upsert()`, `createDispatchQueue()` (full state machine), `FleetApprovalStream.enqueue()` | REAL lib APIs |
| Dispatch states | Reached by driving `propose → claim → start → produce → requestReview → accept / reject / settle`, never INSERTed at a target state | REAL state machine |
| Projection | `createRoadmapActivity()` (lib/roadmap-activity.ts), unmodified | REAL |
| HTTP | `fastify.inject()` over `roadmapActivityPlugin` (routes/roadmap-activity.ts), unmodified | REAL route handler |
| Transport | In-process inject, **not** a socket against a running `pd` daemon | FIXTURE-level |
| Data on screen | Fields of the JSON archived in `responses/` | REAL |
| Styling | A local HTML template in the capture script | Presentation only |

**Two writes bypass a lib API**, both deliberate and both visible in the script:

1. `roadmap_claims` rows are `INSERT`ed with the identical column list
   `lib/roadmap-pop.ts` uses. The table itself is created by the real
   `createRoadmapPop()`. Reason: `pop()` reads an on-disk roadmap progress
   document to choose what to claim; a capture script has no business
   synthesizing the plan-of-record to get a claim row.
2. `roadmap_items.assignee_id` is set with a direct `UPDATE`. Reason: the
   planner column (migration 085) has no field on `upsert()` yet.

Everything else — every agent, session, dispatch transition, heartbeat and
approval — goes through the shipped code.

---

## Liveness was NOT staged

This is the claim most worth attacking, so here is exactly how it was produced.

- **Nothing is backdated.** Every agent calls the real `register()` once, at
  seed time, which writes `last_heartbeat = Date.now()`. No `UPDATE agents SET
  last_heartbeat = <old>` anywhere in the script.
- The **only** lever is the injected projection clock:
  `createRoadmapActivity({ db, now })`.
- At `now = T0 + 600000ms`, every attachment has the **same** `idleMs`
  (≈ 599 950 ms). The shipped `lib/agents.ts` ladder is what splits them, by the
  agent's own status:

| Agent status | `staleThresholdMs` (real, from `getStaleThresholdForStatus`) | idle 600 000 ms ⇒ |
| --- | --- | --- |
| `busy` | `8640000` (2.4 h = 0.6 × 4 h) | **active** |
| `draining` | `180000` (3 m = 0.6 × 5 m) | **stale** |
| any, session `completed` | n/a — `classifySessionLiveness` short-circuits | **done** |

So `liveness-contrast.png` shows one agent ACTIVE and another STALE off
*identical* staleness, purely because the shipped ladder says so.

**Why the `done` attachment sits on a second item, not the same one.** Two real
invariants prevent it, not a staging convenience:

- `roadmap_claims` carries a partial `UNIQUE` index on `slug` for unreleased
  claims (lib/roadmap-pop.ts) — one open claim per item.
- The session-link join reads `sessions WHERE status = 'active'`, so a completed
  session leaves that path entirely.

`done` is therefore only reachable via a claim, and a claim is exclusive per
slug. The second item (`finished-session-salvage-signal`) carries an unreleased
claim on a completed session: liveness `done`, and the item still rolls up to
`stacked` — a fresh heartbeat does not resurrect finished work.

---

## Reproduction

```bash
# From the repo root, on branch claude/roadmap-live-activity
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers   # any chromium build works
npx tsx scripts/capture-roadmap-activity-evidence.ts
# → docs/reports/roadmap-live-activity/{*.png,*.gif,*.webm,responses/*.json}
# Optional: --out <dir> to write elsewhere.
```

The script resolves `playwright` from `node_modules`, then from the global npm
root, so it needs no package.json dependency. If it cannot resolve a browser it
**throws** — it never falls back to producing an image without a real capture.

Re-running produces new wall-clock timestamps (T0 is `Date.now()` at seed) but
identical relative offsets, identical liveness classifications, and identical
stage/count rollups.

---

## Recorded run

| Field | Value |
| --- | --- |
| Repository | `curiositech/port-daddy` |
| Branch | `claude/roadmap-live-activity` |
| Tree captured | `7f49f2fe36b045e7a91de01a40a5553a647e115d` (the PR's feature commit; these artifacts land in its child commit) |
| Capture script | `scripts/capture-roadmap-activity-evidence.ts` (committed alongside) |
| Command | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx tsx scripts/capture-roadmap-activity-evidence.ts` |
| Seed clock `T0` | `1787441890897` (`2026-08-22T23:38:10.897Z`) — real `Date.now()` at seed |
| Injected projection clock (stills) | `1787442490897` = `T0 + 600000ms` |
| Injected projection clock (motion) | `T0 + {0, 45000, 90000, 185000, 240000, 300000}ms` |
| Harbor | `port-daddy:fleet` |
| Board response `counts` | `items 10 · stacked 2 / executing 6 / review 1 / done 1 · activeAgents 7 · staleAttachments 1 · openClaims 4 · attention 3` |
| Renderer | headless Chromium via Playwright, `deviceScaleFactor: 2`, `colorScheme: 'dark'`, `fullPage: true` — headless only, per `skills/port-daddy-agent-skill/references/visual-evidence.md` rung 1 |
| GIF assembly | Pillow (python3). ImageMagick / `vhs` / `agg` are not installed in this container. |
| WEBM assembly | the Playwright-bundled ffmpeg (`$PLAYWRIGHT_BROWSERS_PATH/ffmpeg-*/ffmpeg-linux`, vp8/webm-only build), fed a concatenated MJPEG stream because its `image2` numbered-sequence demuxer is compiled out |

---

## Artifacts

### `board-feed.png` — 755 KB · 2720×2936
`GET /roadmap/activity?includeStacked=1`. The mandate shot: agent work in flight
across **all four stages simultaneously** (2 stacked / 6 executing / 1 review /
1 done), with the header histogram and the full count strip. Each row prints the
attachment's agent, liveness, raw `idleMs`, raw `staleThresholdMs`, join sources,
and the cockpit/transcript URLs.
Raw: `responses/board-activity.json`.

### `item-detail.png` — 463 KB · 2720×1774
`GET /roadmap/items/roadmap-activity-board-feed/activity`. One attachment
corroborated by **four** join paths at once (`claim`, `session-link`, `dispatch`,
`assignee-agent`), with the complete field set: agent identity, `agentRegistered`,
`transcriptUrl`, `cockpit.streamUrl`, `cockpit.steeringChannel`, and
`cockpit.interrupt` — which the real response reports as
`available: false` with its reason and the planned `/agent-nodes/:id/control`
ingress. The projection refuses to draw an unacknowledged control as wired.
Raw: `responses/item-board-feed-activity.json`.

### `liveness-contrast.png` — 937 KB · 2720×3806
**HONEST LIVENESS.** `GET /roadmap/items/liveness-contrast-slice/activity` beside
`GET /roadmap/items/finished-session-salvage-signal/activity`. ACTIVE next to
STALE next to DONE, with `idleMs`, `staleThresholdMs` and `lastHeartbeatMs`
printed for each. See "Liveness was NOT staged" above.
Raw: `responses/item-liveness-contrast-activity.json`.

### `attention-state.png` — 764 KB · 2720×3076
**ATTENTION.** The three items whose response carries `needsAttention: true` —
dispatch states `salvage`, `rejected`, `failed` — with `dispatch.errorMessage`
printed **verbatim**. Board `counts.attention = 3`. None of them roll up to
`done`. The `rejected` item also carries a real held HITL spawn approval
(enqueued on a real `FleetApprovalStream`) with its `decisionUrl`.
Raw: `responses/items-attention-activity.json`.

### `null-and-empty-states.png` — 329 KB · 2720×1460
**NULL / EMPTY.** Left: an existing item with zero activity —
`attachments: []`, `dispatch: null`, `assigneeId: null`, stage `stacked`,
HTTP **200 not 404** (`GET /roadmap/items/nobody-is-on-this-slice/activity`).
Right: an empty board — a **second** throwaway registry, migrated and never
seeded, so `items: []` and every count is `0`.
Raw: `responses/item-null-state-activity.json`, `responses/board-activity-empty.json`.

### `board-feed-motion.gif` — 370 KB · 1160×573 · 6 frames · 1.7 s/frame
### `board-feed-motion.webm` — 213 KB · 1160×573 · 10.2 s · vp8
**MOTION.** The feed changing as work moves. A third registry; each frame
advances the injected clock, drives the **real** dispatch state machine, re-calls
`GET /roadmap/activity?includeStacked=1`, and screenshots the response:

| Frame | Clock | What the real response does |
| --- | --- | --- |
| 1 | `T0+0ms` | dispatch `proposed`, `attachments: []` → item **stacked** |
| 2 | `T0+45000ms` | `claim()` + a claim row + a live session → item **executing** |
| 3 | `T0+90000ms` | `start()` → dispatch `in_progress` |
| 4 | `T0+185000ms` | the `draining` agent crosses its 180 000 ms threshold → its attachment flips **active → stale**, `staleAttachments` 0→1, `activeAgents` 2→1, and its item falls back to **stacked** |
| 5 | `T0+240000ms` | `produce()` + `requestReview()` → dispatch `review_pending` → item **review** |
| 6 | `T0+300000ms` | `accept()` + `sessions.end()` → item **done**; the stale attachment is *still* reported stale |

Raw first/last frames: `responses/motion-frame-00-board.json`,
`responses/motion-frame-05-board.json`.

### `responses/*.json`
The verbatim envelopes returned by `fastify.inject()` for every shot. Diff them
against the pixels — the renderer prints fields, it does not compute stages,
liveness, or counts.

---

## Known quirks visible in the evidence (not renderer bugs)

- `dispatch.errorMessage` on the **accepted** item reads `accepted: merged`.
  That is real: `lib/dispatch/queue.ts`'s `acceptStmt` parks the operator's
  accept note in the `error_message` column. The renderer prints it verbatim but
  styles it neutrally rather than as an alarm, because the response says
  `needsAttention: false`.
- `durable-roster-projection-backfill` shows stage **executing** *and*
  `needsAttention: true` with dispatch `salvage`. Also real: `classifyStage`
  routes on live attachments, and its session is still active. The attention flag
  is exactly the mechanism that keeps this from reading as healthy.
- The `rejected` dispatch's reject reason is not on screen because
  `RoadmapItemDispatch` does not expose `reject_reason`. It was not invented.

## What is NOT shown

- No live `pd` daemon over a socket, no production registry, no real agent
  processes. The evidence is a seeded fixture exercised through the real code
  path, and is labeled that way everywhere it appears.
- No UI surface. This PR is the data layer; the roadmap board that consumes it
  ships separately. These captures render the API's real output so a human can
  read it — they are not a proposed design for that board.
