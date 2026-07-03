# Work Packet: Scout Browser Extension Technical Specification

Status: technical contract for the Scout surface.
Supersedes as contract: the prose embedded in
`docs/design/fleetbar-mockups/extension-feedback.html` and
`docs/design/fleetbar-mockups/ask-agent-panel.html`. Those files remain the
visual source; this packet is the buildable truth.

Chapter home: `19-operator-surface-triad.md`. Terms and schemas defer to the
binder README glossary and `09-data-model-and-api.md`.

## Product claim

Scout is browser-side visual task intake. The operator looks at a running web
product, selects the defect they can see, annotates it, and fires it to the
local harbor with the evidence already attached. The second face of the same
surface — the ask-agent panel — lets the operator ask a specific compliant
Agent Node a question and read its reply without leaving the page.

Scout wins on one axiom: **capture where the operator's eyes already are.**
Every alternative (screenshot into chat, prose bug report, terminal paste)
loses evidence at the seam. Scout keeps the DOM path, region bounds, URL,
viewport, and pixels in one envelope.

## Shipped today (verified)

- `apps/pd-scout-extension/manifest.json` — MV3, v0.1.0. Permissions:
  `activeTab`, `scripting`, `storage`, `tabs`. Host permissions loopback-only:
  `http://127.0.0.1:*/*`, `http://localhost:*/*`. Command `capture-region`
  bound to Alt+Shift+P.
- `apps/pd-scout-extension/background.js` — service worker: capture via
  `chrome.tabs.captureVisibleTab(format: png)`, content-script injection with
  honest failure on restricted pages ("This page does not allow extension
  capture."), last-capture persistence in `chrome.storage.local`, submit via
  `POST {daemonUrl}/visual-tasks`.
- `apps/pd-scout-extension/content-script.js` — Shadow-DOM region picker,
  DOM context sampling (selector/XPath/text/bounds), viewport metadata.
- `routes/visual-tasks.ts` + `lib/visual-task-intake.ts` — daemon intake with
  8 MB body limit, typed input errors, blob persistence for screenshots,
  publish to the `visual-feedback` channel, optional target-agent inbox
  message, reviewable work item creation. Operator vocabulary only (issue,
  local agent, cloud fleet, review queue) — no dispatch/worker words in the UI.

Not shipped: the ask-agent panel, Work Intent routing, device pairing, any
auth beyond loopback, redaction, retention wiring, category taxonomy.

## Envelope contract

Version the submission as `pd.scout.visual-task.v1`. Field names align with
the chapter 09 canonical event schema (camelCase, `agentNodeId` when
addressing an agent, blob references not inline payloads beyond the capture):

```json
{
  "schema": "pd.scout.visual-task.v1",
  "capturedAt": "2026-07-03T18:22:04Z",
  "page": { "url": "http://localhost:3000/pricing", "title": "Pricing" },
  "viewport": { "width": 1440, "height": 900, "dpr": 2 },
  "region": { "x": 412, "y": 305, "width": 342, "height": 90 },
  "image": { "blobRef": "blob:...", "mimeType": "image/png" },
  "domContext": {
    "selector": ".pricing__cards > .card:nth-child(2) .card-price",
    "xpath": "...",
    "text": "$199/m",
    "bounds": { "x": 412, "y": 305, "width": 118, "height": 34 }
  },
  "category": "bug",
  "comment": "Growth card price clips to $199/m — max-width too tight.",
  "target": { "agentNodeId": null, "project": "acme-web" },
  "client": { "extensionVersion": "0.1.0", "browser": "chrome" }
}
```

Category taxonomy is closed and maps to the coordination state colors used
across the triad (FleetBar spec, section "State grammar"): `bug` (cinnabar),
`nit` (amber), `feedback` (cobalt), `tangent` (plum), `question` (forest).
Free-text categories are rejected; the taxonomy is an enum precisely so the
planner can shape work from it.

Daemon-side, the envelope becomes:

1. one blob (`image.blobRef`) with the harbor's retention policy attached;
2. one Work Intent of source kind `scout` (target state) or one bridge work
   item (today), with the envelope as evidence;
3. one publish on `visual-feedback` (hot bus) for live listeners;
4. one inbox message (cool bus) when `target.agentNodeId` is set.

Intake rule from chapter 14 applies: Scout never chooses the execution shape.
A `bug` on one selector usually shapes to a single node with a QA follow-up; a
`tangent` may shape to a planning placeholder. That is the planner's call, and
the popup shows the operator what shape was chosen ("routed to: one agent,
worktree acme-web, est. $0.12").

## Ask-agent panel (v2 surface)

The second popup face. Contract:

- Roster comes from the daemon roster query (today `/agents`; target
  `/agent-nodes`), rendered with compliance level and last-heartbeat age.
  An agent without a fresh heartbeat renders as stale; the panel never shows
  a synthetic "active" state (chapter 10 LIVE rule).
- A question is a cool-bus inbox message to one `agentNodeId`, tagged with the
  page URL as context. The reply streams over SSE scoped to that exchange.
- Ask history is durable (it is inbox traffic), so closing the popup loses
  nothing.
- The panel is a scoped conversation, not a console: no transcript history
  beyond the exchange, no steering controls, no file views. "Open in
  pd-console" deep-links the session for anything deeper (chapter 19 boundary
  rule).
- Send is disabled with an honest reason when the target agent's compliance
  level lacks suggestibility (below C3): "This agent cannot receive messages
  mid-run; it will see your note at its next turn start" — or the message is
  queued for turn-start delivery via the suggestibility envelope (chapter 03),
  which is the normal path.

## Security model

Threats, in the order they will actually occur:

| Threat | Defense |
| --- | --- |
| Arbitrary web page posts to the daemon (the extension is not the only thing that can reach loopback) | daemon CORS policy (`lib/daemon-cors.ts`) plus, target-state, a device-pair token: Scout completes the same pairing flow as mobile (milestone M3), stores a scoped token in `chrome.storage.local`, and the daemon rejects unauthenticated `/visual-tasks` once pairing is enabled for the harbor |
| Screenshot captures secrets visible in the page (tokens in query strings, PII in forms) | redaction before persistence (chapter 06 rule "redact before persistence"): the daemon runs the screenshot and `domContext.text` through the same redaction pass as transcripts, and the blob store records a redaction receipt; fixture required |
| Extension over-capture (whole-tab screenshots when only a region was selected) | crop at capture time in the background worker; the full-tab image never leaves the browser when a region exists |
| Malicious page spoofs the region picker UI | picker renders in a closed Shadow DOM with extension-owned styles; submission always shows a final confirm in the extension popup (extension-trusted surface), never page-trusted chrome |
| Scout as an exfiltration channel (agent replies rendered into arbitrary pages) | replies render only in the extension popup/panel, never injected into page DOM; content script is capture-only |
| Scope creep toward a shell | permanent rule from chapter 19: Scout never receives `act`-class capabilities; it submits intents and reads replies; the manifest's permission list is the enforcement and any expansion requires an AoR entry |

Loopback-only host permissions are a real boundary today and stay until
pairing exists. Remote harbors (viewing a staging site, daemon on another
machine) go through the relay with the same pairing token — covered by
`tunnels-for-agents` patterns, explicitly not by widening host permissions.

## Compliance and honesty rules

- The popup's daemon status chip has three states: connected (version +
  agent count from a live query), unreachable (with the exact URL tried and a
  `pd doctor` hint), and unpaired (target state). No optimistic states.
- A submission that fails returns the daemon's typed error verbatim
  (`VisualTaskInputError` statusCode + message), not "something went wrong."
- The "recent feedback" list renders from daemon queries, not local cache,
  so it survives popup reload and never shows items the daemon lost.
- When the daemon routes a submission to an agent, the popup shows the
  compliance level of that agent. An `observed` responder is labeled
  observed. Scout inherits the binder's core honesty invariant: no state
  without evidence.

## Build slices and gates

Slice S1 — envelope v1 and honest status (extend shipped code):
  version the envelope, close the category enum, add the status chip states,
  crop-at-capture.
Gate: IT-015 (chapter 19) passes for the bridge intake path; restricted-page
  and daemon-offline fixtures render honest errors.

Slice S2 — Work Intent routing:
  `/visual-tasks` submits through `WorkIntentService` when it exists; popup
  shows intent id and chosen shape; bridge behavior retained behind the same
  route.
Gate: milestone M2 launch-path gate traces a Scout submission end to end
  (intent id, plan id, node ids, transcript stream id or unmanaged reason).

Slice S3 — redaction and retention:
  screenshot + DOM text redaction pass, redaction receipts, blob retention
  policy wiring.
Gate: secret-bearing fixture page produces a redacted blob and a receipt;
  unredacted bytes are absent from disk (negative probe).

Slice S4 — ask-agent panel:
  roster query, inbox exchange, SSE reply stream, compliance-gated send,
  pd-console deep link.
Gate: reply renders only with stream evidence; a below-C3 target shows the
  queued-for-turn-start path; killing the daemon mid-stream degrades honestly.

Slice S5 — pairing:
  device-pair token flow shared with mobile pairing (milestone M3+).
Gate: unauthenticated submission rejected once pairing is on; local-only mode
  provably uploads nothing (chapter 00 criterion 9).

## Skill backing

Graft per slice (WinDAGs graft as default preparation):

- Surface and product shape: `developer-surface-strategist`,
  `agentic-coding-ux-designer`, `web-design-expert` (PR #650),
  `product-appeal-analyzer` (PR #650).
- Intake and envelope design: `agent-interchange-formats`,
  `always-on-agent-inputs`, `swarm-invocation-designer`.
- Daemon integration: `daemon-development`, `fleet-event-spawn-trust`
  (trust gate on the event→work path), `sqlite-durable-agent-state`.
- Security slices: `macos-host-security`, `agentic-zero-trust-security`,
  `sandboxed-adversarial-test-harness` (negative probes).
- Testing: `webapp-testing` (Playwright drives the fixture pages),
  `qa-automation-specialist`.
- Remote/relay path: `tunnels-for-agents`, `pd-relay-zero-trust`.

## What this packet does not claim

- No Firefox/Safari port until the Chrome surface passes IT-015; the MV3
  service-worker model is the reference implementation.
- No screen recording, no ambient capture, no always-on observation. Scout is
  operator-initiated capture only (chapter 06 safety defaults).
- No marketplace/public-harbor distribution story; that waits for the store
  packaging milestone alongside signed app distribution
  (`rust-app-distribution` covers the app side; the extension store listing is
  its own later packet).
