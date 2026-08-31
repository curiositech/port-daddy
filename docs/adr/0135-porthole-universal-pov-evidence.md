# ADR-0135: Porthole as the universal cooperative app stage and evidence fabric

## Status

Accepted program direction; implementation phased (2026-08-30)

- **Program:** Universal Porthole
- **Decision owner:** Port Daddy operator
- **Builds on:** ADR-0029 (accounts and audit), ADR-0058 (transcript archive),
  ADR-0061 (one shared embedder), ADR-0087 (broker TCB), ADR-0089
  (security forensics journal), ADR-0093 (event-to-spawn trust), ADR-0120
  (Rust security boundary), ADR-0122 (harbor authority), ADR-0123 (cloud
  vault), ADR-0124 (fail-closed redaction), ADR-0131 (Helmsman), ADR-0134
  (control ingress)
- **Supersedes as product direction:** any description of Porthole as a
  Parley-specific replay, terminal-only cast viewer, browser extension, or
  passive screen recorder

## Decision in one sentence

**A Porthole is a live, consented cooperative stage for a person and one or
more embodied agents inside any chosen app or website; its append-only,
encrypted, searchable recording is the stage's witness, not the product's
center.**

This ordering is normative. We do not build a recording system and later add
collaboration. We open a stage, prove that its capture and privacy boundaries
are ready, let participants see and act with each other, and derive durable
evidence from the resulting experience.

## Context

The work named Porthole is currently split across several partially overlapping
pull requests and ideas:

- terminal panes and Parley replay;
- a browser extension proposed for `pd-console`;
- window capture and proof recordings;
- body identity, claims, provenance, and sandboxing;
- Harbor Editor's cooperative document state;
- transcript archive, semantic retrieval, and future warehouse sinks.

Each piece is useful, but none describes the whole product. A Parley session is
one excellent multi-agent event source. It cannot be the ontology: there will
be many Parleys, websites, native Swift and Rust apps, simulators, editors,
terminals, design tools, games, and future instrumented applications. A browser
extension can enrich a page with DOM meaning. It cannot be the capture
boundary for an arbitrary GUI. A screen recording can prove pixels. It cannot
by itself tell a person what the agent clicked, let two participants point at
different things, or safely turn a report into a regression test.

The product need is broader:

1. A developer opens a chosen app or website in a Porthole.
2. A person and agents explore it together. Everyone sees the others' ghost
   cursors, selections, focus, anchored comments, and clocks.
3. A single explicit, revocable control lease decides who can affect an
   uninstrumented operating-system window. Pointing and discussion remain
   concurrent.
4. A browser or instrumented app contributes deeper semantic structure and
   deterministic action receipts.
5. The whole encounter becomes trustworthy evidence: searchable when someone
   remembers only a vague detail, reviewable as a bug report, shareable as an
   authorized scrubbed/redacted disclosure, and capable of producing a
   candidate regression test.
6. Background apps, unrelated media, passwords, tokens, and typed secrets do
   not become collateral evidence.

Apple's ScreenCaptureKit can bind capture to one selected window with
`SCContentFilter(desktopIndependentWindow:)`, rather than requiring a display
capture ([Apple documentation](https://developer.apple.com/documentation/screencapturekit/sccontentfilter/init%28desktopindependentwindow%3A%29)).
It supplies pixels, not application semantics. macOS Accessibility supplies a
separate semantic and action surface through `AXUIElement`
([Apple documentation](https://developer.apple.com/documentation/applicationservices/axuielement_h)).
For an owned Chromium browser, Playwright and Chrome DevTools Protocol supply a
deeper source of actions, DOM/layout snapshots, accessibility nodes, console,
and restricted network metadata
([Playwright test generator](https://playwright.dev/docs/codegen),
[CDP DOMSnapshot](https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/),
[CDP Accessibility](https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/)).
These are complementary adapters behind one Porthole contract.

## Product invariants

The following are release gates, not aspirations.

1. **Stage first, witness second.** A replay without live cooperation is an
   evidence viewer, not a complete Porthole.
2. **Any chosen GUI.** The baseline works with an arbitrary, exact native
   window without requiring source changes. Instrumentation improves meaning;
   it does not decide eligibility.
3. **Body-neutral.** A person, Codex, Claude, a local model, a remote agent, or
   another verified body joins through the same participant and effect
   contracts. Parley is one producer.
4. **Capture ready before action.** A body cannot take the first consequential
   action until the selected perspective reports capture-ready, a visible
   indicator is present, redaction policy is loaded, and the initial clock
   anchor is durable.
5. **Exact target or no capture.** A target-bound adapter never silently falls
   back from one window or browser context to the display, desktop, another
   tab, or another app.
6. **One controller, many collaborators.** One explicit lease controls an
   uninstrumented OS input stream. Everyone may point, select, comment, and
   request control at the same time.
7. **Effects, not claimed intent.** A click becomes durable only after the body
   adapter witnesses its target and outcome or marks the outcome unknown.
8. **Gaps are data.** Permission loss, dropped frames, redaction quarantine,
   adapter restart, clock uncertainty, and offline periods produce explicit
   gap events. They never disappear behind a smooth replay.
9. **Privacy before persistence.** Target selection, secure-field masks, and
   secret suppression run before media encoding, archival sealing, indexing,
   logging, or transport.
10. **Raw evidence, authorized retrieval, and analytics are different planes.**
    No search or warehouse convenience weakens raw-evidence access.
11. **Append-only does not mean immortal plaintext.** Event order and deletion
    receipts remain append-only; payload keys and ciphertext can expire or be
    destroyed under policy.
12. **Every search result cites evidence.** A result names the Porthole,
    perspective, stream, time interval, event ids, redaction state, and
    completeness state from which it was derived.
13. **Every disclosure is itself evidence.** Sharing creates a signed,
    append-only disclosure receipt describing exactly what was released, to
    whom, for how long, under which redaction pipeline and key grant.
14. **Always filming means always truthfully capture-ready while a body acts.**
    It never means ambient display surveillance, hidden capture, microphone-on,
    or recording unrelated background windows.
15. **Raw evidence is local-only.** Under ADR-0124, no raw Porthole archive,
    stream key, or decryptable raw payload is synced, warehoused, or shared.
    Remote live viewing is a separately consented, ephemeral E2EE session;
    durable off-device artifacts are newly built scrubbed/redacted derivatives.

## Scope and terminology

### Porthole Stage

A `PortholeStage` is the bounded live room. It has a harbor, project, target,
participants, privacy policy, clock anchors, realtime room, evidence ledger,
and lifecycle:

`proposed -> consenting -> preparing -> capture-ready -> live -> draining -> sealed | aborted`

`live` is unreachable until every required perspective is either ready or
explicitly waived with a durable, visible reduced-completeness receipt.

Cardinality is many-to-many. A Parley, Fleet run, work item, person, or agent
may participate in many Portholes; one Porthole may contain many people and
agents; one body may move between targets only by opening a new perspective and
renewing consent. The active-body roster cues the live or most recent Porthole
for each body. It never collapses all multi-agent work into one Parley or one
global recording.

### Participant, Body, and presence

A participant is a durable person or `AgentNode`. A Body is the concrete
runtime embodiment presently acting for that identity: process, browser,
desktop host, editor bridge, or remote device. Presence is ephemeral state such
as cursor position, hover, viewport, and typing indicator. Presence can be
lost. Identity, authority, control grants, comments, actions, and effects
cannot depend on presence being durable.

The operator is a participant, not an invisible recorder. Operator clicks,
comments, selections, grants, redactions, shares, and test decisions enter the
same attributable append-only history as agent effects. Every durable event
names the person/AgentNode and concrete Body that produced or witnessed it.

### Perspective and stream

A perspective is exactly one independently attestable, independently keyed
stream of stage observation, such as exact-window pixels, accessibility tree,
DOM, application operations, terminal pane bytes, console errors, or agent tool
receipts. A participant POV is a set of perspectives joined by stage,
participant, concrete Body, and observation-group id. Each perspective has its
own sequence, key, completeness receipt, clock mapping, and hash commitment.
This atomic v1 boundary prevents a polished composite replay from laundering a
missing source modality and makes retention/deletion indivisible with its key.
An embodied perspective never has a null `bodyId`; a person viewing through
`pd-console` also has a concrete viewer Body.

### Anchor

An anchor attaches participant meaning to target state. It may be:

- native screen coordinates plus exact-window geometry and frame id;
- an AX element path and stable attributes;
- a DOM backend node id plus resilient Playwright locator candidates;
- a Harbor Editor block/Loro object id and operation frontier;
- a terminal pane id plus source byte interval;
- an app-SDK semantic object id and application revision.

Anchors are versioned and can resolve, drift, become ambiguous, or expire. The
viewer displays that state instead of pretending an old coordinate is still a
semantic target.

### Control lease

A `PortholeControlLease` is a short, attributable, revocable capability to send
consequential input to the target. It names holder, target, body, allowed action
classes, issue and expiry times, issuer, reason, and current state. It is not
derived from cursor ownership, room membership, recent activity, or UI focus.
It also binds target/focus generation, authority snapshot and step-up level,
maximum action count, and physical-user preemption. Default leases permit one
consequential action and expire within 30 seconds; no lease permits more than
five actions without a new grant. Dispatch atomically revalidates focus and
target generation, so a focus change cannot redirect a queued event to another
window. `clipboard-read` and `clipboard-write` are separate capabilities;
reading is denied by default, and neither authorizes ambient clipboard logging.

## The experience, sequentially

### 1. Open a Porthole

The host chooses a specific target from an operating-system picker, owned
browser session, simulator, or instrumented-app registry. The consent sheet
shows:

- exact app, window, tab, device, or document identity;
- perspectives that will exist and their expected completeness;
- whether remote participants can view, point, comment, request control, or
  receive a disclosure;
- media capture, audio, OCR, DOM/AX, console, and network policy separately;
- retention tier, storage estimate, project quota, and current grants;
- visible controls to pause, stop, redact, remove a participant, and revoke
  control.

The stage never starts from a broad `capture my screen` permission if an exact
window or owned browser context can satisfy the request. The selected target is
named in the permanent capture indicator.

### 2. Prepare and prove readiness

The target adapter starts before the first embodied action. It emits:

- target binding and window/browser/document identity;
- permission and capability result;
- first complete frame or semantic snapshot;
- secure-region mask version;
- privacy-pipeline receipt id, policy hash, and scanner version;
- a pre-action schedule commitment naming the source sequence origin, cadence or
  provider sequence, watchdog, and the rule used to decide what "complete"
  means;
- local monotonic-to-wall-clock anchor and uncertainty;
- stream key and hash-chain initialization commitments;
- visible-indicator attestation;
- `capture-ready` or a precise refusal.

The agent harness checks the readiness receipt at the action boundary. A stale,
paused, invisible, quarantined, wrong-target, or missing receipt blocks the
action. The operator can waive a nonessential semantic stream, but cannot waive
the exact-target and visible-capture requirements for media collection.

Expected sequence bounds are not invented when capture stops. Fixed-cadence,
provider-sequenced, and event-driven adapters commit their expectation rule
before the first embodied action. The terminal completeness receipt applies
that committed rule and cites it. A recorder cannot hide a dropped tail merely
by declaring the rows it happened to retain to be the expected rows.

### 3. Join and co-explore

Every participant receives a stable color/pattern/name combination and a ghost
cursor. Cursors, hover, viewport, drag preview, and gaze-like focus are lossy,
rate-limited presence. Selections and comments are reliable state:

- a selection can name one or more anchors and an optional time range;
- a click clock shows local action time, effect time, and uncertainty;
- a comment is timestamped, attributed, anchored, editable only by append-only
  revision, and resolvable as open/fixed/not-reproducible/converted-to-test;
- people and agents see each other's live selections, comments, lease state,
  and capture health;
- follow-presenter and independent exploration are separate modes.

Uninstrumented native apps have one real OS pointer/focus, so only the lease
holder can apply input. Other cursors remain visible proposals. An instrumented
cooperative app may support concurrent logical cursors and document operations,
but any bridge to a single OS pointer still honors the lease.

### 4. Request, grant, and revoke control

Control is a four-step witnessed exchange:

1. participant requests a lease, with intended action class and duration;
2. current authority grants, modifies, rejects, or ignores the request;
3. the body adapter acknowledges the exact lease id before accepting input;
4. each resulting effect cites the lease, action, target anchor, precondition,
   observed outcome, and evidence range.

Only one lease for a given uninstrumented target can be active. The host can
interrupt it immediately. Blur, target replacement, participant removal,
capture loss, policy change, timeout, or secure-field focus revokes it. Queued
input is discarded after revocation. A remote pointer packet is never itself
authority.

### 5. Mark a moment, report a bug, or derive a test

A participant drags across the timeline or says “the checkout broke here.” The
stage freezes a bounded evidence interval around the anchor, captures the
expected result in the person's own words, and attaches relevant actions,
effects, console failures, build/revision identity, gaps, and privacy state.
This becomes a structured bug-report candidate. Test generation is a later,
reviewed derivation, not an automatic assertion that a click trace is correct.

An app may also offer an explicitly consented **support buffer**. It is an
exact-app, device-local, visibly active, byte/time-bounded encrypted circular
buffer that makes “report what just happened” possible without uploading or
indexing a continuous customer session. Every segment is source-masked and
receives an exact-target privacy receipt before its first encrypted write; the
buffer is never an unsanitized staging area. A detector-suspect segment is
quarantined and inaccessible even to the ordinary preview. The default is the
smaller of 120 seconds or 256 MiB, overwriting oldest segments; policy may raise
this only through new consent, never above 5 minutes or 1 GiB. Its ephemeral
buffer key is device-local, is not backed up, rotates after a report, and is
destroyed on consent withdrawal/expiry with overwrite and read-back proof.
Pressing Report freezes only the selected pre/post interval, runs the current
privacy pipeline again, shows the reporter the exact disclosure preview, and
submits a newly encrypted bug package. No support buffer may silently expand to
the display, another app, microphone, browser profile, clipboard, or global
input stream.

### 6. Search and share

The Library lets a developer search “the native app where the agent opened the
purple settings panel and the button stopped responding” without knowing the
session, actor, app, or date. Results jump to cited intervals, show why each
matched, disclose missing streams, and request authorization only when the
selected evidence requires it.

Sharing begins from a frozen interval, not a live unbounded room. The sender
previews the exact scrubbed/redacted pixels, semantic text, comments,
identities, metadata, redactions, and gaps that will leave the harbor. The
system then creates a freshly encrypted derivative, recipient-scoped grant,
and disclosure receipt. It never grants a recipient the raw source key.

## Adapter architecture

Every adapter implements the same bounded contract:

`prepare -> attestTarget -> enumerateSecureRegions -> start -> ready -> observe -> act -> drain -> seal`

It declares capabilities rather than claiming parity it cannot supply.

| Adapter | Baseline evidence | Semantic enrichment | Action path | Test derivation |
|---|---|---|---|---|
| `macos-window` | exact selected-window frames, geometry, occlusion/completeness, cursor effects | macOS AX snapshot/deltas where permission and target support permit | lease-gated `CGEvent`/AX actions, with body receipt | AX/app-specific candidate; XCUITest when project supplies target metadata |
| `pd-console` | exact console window plus native block render ids | GPUI block/lane/document state and command receipts | native command bridge under lease | Rust unit/integration snapshot or accessibility test |
| `browser-owned` | one isolated Playwright browser context/page, screenshot/video when policy permits | DOM, AX, locator candidates, navigation, selected console and redacted network metadata | Playwright actions under lease | candidate Playwright spec plus trace and clean rerun |
| `browser-attached` | chosen tab/window visual stream | opt-in extension/CDP augmentation with origin boundaries | extension/native host, never page-script authority alone | browser candidate with reduced trust label |
| `harbor-editor` | editor window frames | Loro operation ids/frontiers, blocks, selections, diagnostics, file/build refs | cooperative editor operation bridge | deterministic operation replay and Rust/editor tests |
| `terminal-pane` | independently hash-bound source pane bytes plus rendered projection | command boundaries, cwd, exit status, tool receipts | terminal body under existing harness authority | shell/CLI regression candidate |
| `app-sdk` | optional app-owned render frames | stable semantic object ids, state transitions, redaction regions | app-defined capability RPC | app-defined Swift/Rust/other test adapter |
| `simulator-device` | chosen simulator/device surface | platform accessibility tree and app hooks | platform automation driver | XCUITest/Android instrumentation candidate |

### Native arbitrary-window baseline

The first universal body uses ScreenCaptureKit's exact-window filter. Apple's
sample explicitly distinguishes chosen-window filtering from display capture
([Apple ScreenCaptureKit sample](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos)).
The adapter stores the selected `SCWindow` identity and refuses if it cannot
prove the stream still corresponds to that target. It excludes Porthole's own
cursor/comment/control overlays from captured pixels. Overlay events remain a
separate semantic stream so replays can render or hide them without corrupting
source evidence.

AX is an enrichment and action adapter, not a substitute for pixels. If AX is
unavailable or ambiguous, the stage remains visually usable and says “visual
only.” It does not infer a confident element name from coordinates.

### Owned browser baseline

The high-trust browser mode is a Porthole-owned Playwright context with a known
profile boundary, not the person's ambient browser profile. Playwright codegen
can record actions and generate locators, and its trace viewer demonstrates the
value of action-by-action DOM snapshots
([codegen](https://playwright.dev/docs/codegen),
[trace viewer](https://playwright.dev/docs/trace-viewer-intro)). Porthole uses
those primitives but applies stricter capture and disclosure policy.

Locators prefer user-facing role, label, and text contracts because Playwright
documents them as the resilient choice
([Playwright locators](https://playwright.dev/docs/locators)). Raw DOM and AX
values are still sensitive data and pass through the same pre-persistence
policy as pixels.

An attached-browser extension remains useful for a person's existing tab, but
it is an optional semantic producer. It is not the universal capture substrate,
is never injected into unapproved origins, and cannot silently expand capture
to other tabs, browser chrome, profiles, extensions, or downloads.

### Harbor Editor and instrumented native apps

Harbor Editor is the reference deeply instrumented cooperative app. It emits
accepted Loro operations, object/frontier ids, editor selections, diagnostics,
file revision, build identity, and action-effect receipts. This permits true
multi-cursor document work without pretending the OS has multiple physical
pointers.

The same small Porthole SDK is available to Swift, Rust, and other GUI apps. It
offers semantic ids, selections, safe action RPC, secure-region masks, app
revision, deterministic operation receipts, and test-adapter hooks. The SDK is
an enrichment path; developers do not have to adopt it before a window can be
shared.

## Realtime protocol and archival protocol are separate

Realtime collaboration optimizes for latency and recovery in a live room.
Evidence optimizes for completeness, immutability, attribution, and later
verification. They share event ids and clocks, not delivery assumptions.

| Channel | Delivery | Purpose | Durable source of truth? |
|---|---|---|---|
| media track | realtime, congestion-controlled | chosen target pixels/audio if explicitly enabled | no; archival media segments are independently sealed |
| cursor/hover/viewport | lossy, latest-value-wins | smooth participant presence | no |
| selection/comment text | reliable ordered stream plus ack | cooperative meaning | only after append receipt |
| control request/decision | bounded RPC with timeout | lease negotiation | decision becomes durable before capability issuance |
| action/effect/gap | reliable local append; only an exportable scrubbed envelope may relay | evidence | yes, on the producing device |
| index/summary/lineage | asynchronous derivation | retrieval and analysis | rebuildable projection |

The initial remote transport is a self-hostable LiveKit room, because its data
APIs distinguish reliable and lossy packets and provide RPC
([data packets](https://docs.livekit.io/transport/data/packets/),
[RPC](https://docs.livekit.io/transport/data/rpc/)). LiveKit is an SFU/media and
ephemeral room substrate, not Port Daddy's evidence database or authorization
authority. Self-hosting remains available
([LiveKit self-hosting](https://docs.livekit.io/transport/self-hosting/)).
Local, same-machine stages do not require a remote SFU.

LiveKit's E2EE covers realtime media and data only when clients enable it, and
its signaling/API traffic is still server-readable; LiveKit also delegates key
distribution to the application
([LiveKit encryption](https://docs.livekit.io/transport/encryption/)). Port Daddy
therefore owns participant authorization, key grants, signaling minimization,
and all durable sealing. Nothing may imply that E2EE makes room metadata or
archival evidence private by itself.

A remote live stage is the sole current exception to the ordinary “raw never
leaves the producing device” flow: with separate, current consent, exact-target
pixels and semantic messages may be E2EE-streamed ephemerally to named live
participants. Server recording/egress is disabled, room keys expire at close,
and no receiver-side durable copy is created by Porthole. The producing device
alone writes the raw target witness. Every participant Body independently seals
a small local observation receipt naming the target frame/event ids actually
rendered, viewport, delivery acknowledgements for comments/selections,
staleness and clock uncertainty, and gaps across disconnect/reconnect. It does
not duplicate raw target pixels. This is the evidence of what the person or
agent could actually have observed under lag or packet loss; the producer's
archive cannot substitute for it. A remote participant may still use external
screen-recording tools outside Porthole's control; the consent UI says this
plainly. Any durable off-device report, share, sync row, or archive is built
through ADR-0124's scrubbed/redacted export gate.

### Agent-facing embodied-environment protocol

An agent Body never receives an undifferentiated video feed and a mouse tool.
Each observation turn is a versioned bundle containing the latest authorized
frame/event ids, viewport and clock uncertainty, resolved semantic anchors,
human selections/comments with explicit trust labels, secure/uncapturable
regions, active control lease and remaining budget, completeness/gap state, and
a freshness/precondition token. Page/app text and human comments are data, not
authority; only signed capability and lease records authorize effects.

The Body acknowledges which bundle and comment/selection versions it actually
accepted, proposes an action against that precondition, and receives one of:
refused-stale, refused-policy, dispatched, observed-effect, unknown-effect, or
revoked. Input dispatch rechecks focus, target identity, secure-field state,
lease epoch, authorization, and freshness atomically. The person sees the same
proposal, ghost cursor, lease, effect, and uncertainty. The Phase 2 gate must
prove that a person points and comments, the agent cites the exact delivered
version, acts under the current lease, and both sides can open the attributable
effect and observation receipts afterward.

## Time, clocks, and replay truth

Every source preserves at least four times:

- `sourceMonotonicTime`: local ordering at the producer;
- `sourceWallTime`: human-correlatable time with uncertainty;
- `stageTime`: mapping to the current stage epoch;
- `displayTime`: the edited or condensed replay position.

Clock anchors record mapping parameters, uncertainty, host boot id, and
resynchronization. A jump cut changes display time, never source time. A click
clock displays request, lease acknowledgment, input dispatch, observed effect,
and archival commit times. Source discontinuity, restart, or clock uncertainty
renders as an explicit band or marker.

### Terminal perspective reference adapter

PR #9902 remains the first terminal-perspective reference adapter inside this
program. Its evidence implementation commit
`933792db103812e08859fbd26f5ad4638c753014` and current-main reconciliation head
`b03180034e2ee46e2604a1245e10c1b8deaeaa77` retain exact lineage. The adapter's
dual source/display clocks, real jump cuts, lifecycle cleanup, intermediate
frame proof, independently hash-bound pane histories, source inspector, tests,
and visual artifacts remain intact rather than being recreated from prose.

Its existing public casts and pane JSON are **sanitized historical disclosure
derivatives**. They are not raw encrypted archives and do not prove source
completeness. The outer tmux cast is a derived display composite. Each pane
sidecar corresponds to an independently attestable perspective in the target
architecture, but the bridge must not retroactively claim that the historical
sidecar had a pre-action schedule, independent key, signed terminal event, or
completeness receipt. Cast/proof gates establish artifact and presentation
integrity only. Jump cuts belong to display-time mapping, not capture-gap
accounting. Regex semantic highlighting is derived presentation, never privacy,
redaction, retrieval, or completeness authority.

`/harness` teaches the Harness: what Port Daddy injects, observes, refuses, and
receipts across lifecycle moments. Porthole is its evidence viewer, and Parley
is one real worked moment. The universal evidence ladder, cross-source activity
history, and Library remain Porthole product surfaces rather than being encoded
as one Harness scene. A later bridge PR maps terminal casts and pane sources
into `Perspective`, `StageEvent`, completeness, and disclosure vocabulary with
the historical limits visibly preserved.

## Privacy and security threat model

### Assets

- visual state of the chosen app or site;
- comments, selections, bug reports, and expected behavior;
- source code, customer data, tokens, credentials, payments, health or legal
  information, and other secrets visible in the target;
- participant identity, activity, social graph, and work habits;
- agent prompts, tool inputs/outputs, control grants, and resulting effects;
- encryption keys, search projections, share grants, and warehouse rows.

### Threats

We design for a compromised relay/SFU/object store, curious project member,
mistaken share recipient, removed participant with old keys, malicious page or
app, prompt-injected agent, background window containing private data,
overbroad browser trace, secret typed into a secure field, OCR/classifier miss,
stale index entry, and a recorder or viewer crash. We also design for ordinary
operator error: sharing too much, forgetting capture is live, selecting the
wrong window, or assuming a partial replay is complete.

Porthole cannot make an already viewed or exported secret unknowable to its
recipient. Revocation prevents future authorized retrieval and destroys keys
the system controls; disclosure receipts make the limitation explicit.

### Capture minimization and background-media ignorance

1. **Exact-target allowlist.** The capture adapter binds to the selected window,
   page/context, simulator, document, or pane. Target changes require a new
   consent event. No display fallback.
2. **Foreground relation is explicit.** A chosen window may continue to record
   when partially covered if the platform's exact-window API produces its
   content, but background windows and their audio are never sampled. The UI
   states whether capture includes offscreen/covered target content.
3. **Porthole overlays are out-of-band.** Ghost cursors, comments, control UI,
   notifications, unrelated menus, and Porthole's own key prompts are excluded
   at the capture source. The viewer composes them from semantic events. The
   live indicator, lease owner, and authority state render in protected
   `pd-console` chrome outside target pixels with an anti-spoof pattern and OS
   window identity; target content can never draw an authoritative Porthole
   badge, cursor, or consent prompt.
4. **Child windows are deny-by-default.** File pickers, password dialogs,
   popovers implemented as separate windows, and system sheets require adapter
   classification and explicit policy. Unknown children create a gap rather
   than broadening capture.
5. **Audio and microphone are off by default.** They require separate consent,
   a visible level meter, their own stream key, transcript policy, mute
   control, and disclosure preview. Background application audio is never
   mixed into the target stream. On macOS this is a hard implementation rule,
   not a UI promise: ScreenCaptureKit can isolate one window's video while its
   audio filtering remains application-wide, so the exact-window adapter does
   not request application audio ([Apple WWDC22](https://developer.apple.com/videos/play/wwdc2022/10155/?time=1345)).
6. **No ambient clipboard, keylogger, or global input log.** Porthole records
   lease-authorized semantic actions and effects. It does not install a global
   event tap that stores raw keystrokes. Text-entry receipts contain element
   identity, classification, and outcome. For protected/password/PIN fields
   they contain neither characters nor length/change shape; even secret length
   is potentially identifying.
7. **No background OCR.** OCR runs only on already allowed target pixels, in a
   bounded local worker, after secure masks and before any OCR text persists.
   It never scans the desktop or neighboring windows.

### Secure-field protection occurs before encoding

Adapters identify protected regions from the strongest available source:

- native secure text/AX roles and app-SDK masks;
- browser `input[type=password]`, payment/authentication field policy,
  autocomplete semantics, sandboxed cross-origin frames, and project-supplied
  selectors;
- Harbor Editor secret-file/region policy and terminal secret-entry state;
- system-owned authentication sheets, Touch ID/passkey surfaces, and password
  managers as uncapturable by default.

The producer composites opaque masks into the frame in memory before the video
or image encoder sees it. It removes or replaces protected DOM/AX values before
serialization. It suppresses matching action payloads before logging. The mask
event itself is durable but contains classification and geometry only.

OCR, entropy detection, provider-token patterns, private-key markers, known
secret names, and optional on-device vision classification run as
defense-in-depth on the already masked target. They do not justify persisting a
raw frame first. A suspected leak goes to a local encrypted quarantine whose
key is not available to indexing, sync, or share builders. Unknown redaction
state fails closed under ADR-0124.

Porthole uses explicit protection classes rather than claiming that a scanner
proved the absence of secrets:

- **source-excluded:** the platform/app never supplied the region or value;
- **source-masked:** a deterministic AX/DOM/SDK secure-region rule replaced it
  in the same producer buffer before encoding, with frame id, geometry,
  policy, and mask commitment bound into that segment's privacy receipt;
- **scanner-withheld:** a probabilistic detector raised suspicion, so the
  segment is quarantined and cannot be called scrubbed, indexed, shared, or
  counted complete;
- **review-redacted:** an authorized derivative was human-previewed and binds
  the exact reviewed artifact manifest, but retains disclosed residual risk.

OCR, entropy, and vision success are never evidence that an arbitrary window
contains no unknown secret. The UI and disclosure receipt state the guarantee
class and residual threat envelope. The release corpus includes one-frame
secrets, focus races, animation transitions, and mask geometry changes; any
unmasked encoded frame is a hard failure.

Exact-window selection also does not make every pixel inside that window safe.
Embedded camera/video, ads, cross-origin canvas, notification toasts,
autocomplete and IME overlays, drag previews, accessibility announcements,
child popovers, and rapidly flashing content are denied, deterministically
masked, or separately consented by adapter policy. Unknown in-target media is
withheld; it never becomes allowed merely because it shares a process/window.

### Browser trace restrictions

CDP can expose far more than a screenshot. The DOM snapshot domain can include
input values, text, attributes, frames, and layout
([CDP DOMSnapshot](https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/));
the Network domain can expose headers, request bodies, and response bodies
([CDP Network](https://chromedevtools.github.io/devtools-protocol/1-3/Network/)).
Therefore:

- browser capture runs in a dedicated context with explicit origin allowlists;
- cookies, local/session storage, IndexedDB, cache contents, autofill values,
  downloads, raw request/response bodies, WebSocket payloads, authorization and
  cookie headers are not collected by default;
- console arguments are locally scrubbed and size-bounded before persistence;
- network evidence defaults to method, redacted origin/path template, status,
  resource class, timing, and sanitized failure;
- cross-origin iframes are opaque unless separately allowed;
- DOM snapshots use an allowlist of semantic fields and never persist hidden
  form values merely because CDP can expose them;
- service workers, extensions, DevTools pages, browser chrome, other tabs, and
  popups do not join the target implicitly;
- every broader diagnostic mode is time-bounded, separately consented, visibly
  labeled, and non-shareable until a new redaction preview succeeds.

### Privacy state machine

Each segment has a closed state:

`preparing -> masked -> scrubbed -> sealed -> indexed-derivative`

and exceptional terminals:

`withheld | quarantined | gap | crypto-shredded`.

Only `scrubbed` material can be sealed for ordinary retention. Only a derivative
whose own policy state is `scrubbed` can enter retrieval or analytics. `raw`,
`unknown`, and `quarantined` never leave the producing device. A later redaction
appends a tombstone/replacement event, destroys controlled payload access, and
causes all derived indexes and caches to invalidate by lineage.

The evidence writer does not infer this state from the fact that a caller sent
it bytes. Every segment carries an encrypted `PortholePrivacyReceipt` naming the
exact-target binding, background exclusion, policy and pipeline versions,
secret-scan outcome, secure-mask outcome, and `scrubbed` or `quarantined`
disposition. The storage boundary rejects missing, unknown, or contradictory
receipts. Quarantined segments use a separate local key, are absent from normal
replay/search/share, and prevent a perspective from receiving a `complete`
status until they are safely replaced or declared as visible gaps.

## Append-only evidence model

### Canonical record types

- stage proposed/consented/prepared/ready/live/draining/sealed/aborted;
- participant invited/joined/left/removed and capability changed;
- perspective and stream opened/rekeyed/paused/resumed/gapped/sealed;
- target bound/changed/refused and secure-mask policy changed;
- clock anchor, discontinuity, source/display mapping, jump cut;
- cursor sample summary, selection, comment/revision/resolution;
- control request/decision/lease/revocation/expiry;
- action intent, input dispatch, observed effect, unknown effect;
- encrypted media/semantic segment committed;
- redaction/quarantine/tombstone/crypto-shred;
- bug report, expected behavior, candidate test, rerun result, review decision;
- index/summary/embedding/lineage derivation;
- share proposed/previewed/granted/accessed/revoked/expired;
- storage transition, quota decision, compaction, and deletion receipt.

Every event has `eventId`, `stageId`, `harborId`, participant/body attribution,
source perspective/stream, monotonic sequence, source/stage times, causal parent
ids, schema/policy version, completeness state, and a commitment to the prior
event in that stream. Large payloads are content-addressed encrypted blobs; the
ledger contains a ciphertext commitment, codec class, key coordinate, privacy
receipt state, and authenticated routing metadata, never a public plaintext
hash, plaintext/ciphertext length correlation, target title/URL, or equality
oracle. Size and cost facts live in a separately authorized, scrubbed metering
projection rather than the generally inspectable event skeleton.

SQLite enforces no-update/no-delete triggers for local ledger rows. Segment
writers use atomic temp-write, fsync, rename, directory-fsync, then append the
commit event. A crash before commit leaves an unreferenced ciphertext candidate
for salvage; a commit without a readable blob produces a durable corruption
gap. Repeated ingestion with the same event id is idempotent only when the
authenticated ciphertext and metadata match.

Completeness receipts are per source stream, then aggregated without claiming
more than the weakest required source. They cite the pre-action schedule
commitment and name expected and observed sequence/time bounds, authenticated
and unreadable segment counts, gaps, redaction withholds, clock uncertainty,
verification result, and issuer device signature. The writer appends a terminal
stream event first; the independently signed receipt commits to that terminal
event hash, so the proof has no self-hash cycle. Missing, corrupt, quarantined,
or uncommitted source data can never produce `complete`. A display composite is
never its own proof of source completeness.

### Unified operator and agent activity spine

Porthole is one evidence producer inside the larger append-only history, not a
replacement for non-GUI agent history. A minimal signed `ActivityEnvelope`
joins transcript messages, prompt/tool call and result receipts, AgentRuns,
coordination messages, control/effect events, commits, PRs, builds, tests, work
items, disclosures, and Porthole moments. It carries only opaque ids and routing
facts: actor person/AgentNode, concrete Body, session/run, repo/worktree/commit/
build, source type and native event reference, causal refs, source/commit times
with uncertainty, privacy/completeness state, and citations. Secret-bearing
payload remains encrypted in its native source ledger; the spine is not a
convenient duplicate transcript.

Each session closes with a signed coverage receipt enumerating the source
streams expected for that kind of work, their head commitments, terminal
receipts, declared gaps, and deliberately absent modalities. An agent that
never used a GUI can still have complete transcript/tool/commit evidence; an
embodied action cannot be complete without its target perspective, observation
receipt, lease, action, and effect sources. Identity pages and search query the
authorized scrubbed projection of this spine, so “when did this agent change
the login button?” can open the exact transcript/tool/commit/test and Porthole
moment rather than only listing recordings.

Every stream begins with a signed genesis commitment to stage, policy, schedule,
and previous epoch. Stage checkpoints periodically sign the ordered set of
current stream heads and are co-witnessed by another enrolled participant when
one is present. Rekey/restart events link epochs explicitly. This does not make
a compromised producer honest, but it makes silent truncation/replacement after
another participant observed a checkpoint detectable.

## Encryption and grants

### Key hierarchy

1. **Device identity key:** hardware/OS protected where available; signs device
   and readiness receipts.
2. **Harbor root secret:** held in the producing device's local OS Keychain,
   Secure Enclave/HSM-backed broker where available; never stored beside
   ciphertext. Account KMS may protect exportable derivative/grant keys under
   ADR-0123, but never the raw local archive root.
3. **Local evidence stage epoch key:** random per Porthole stage and rotated on
   local compromise or evidence-policy change; it is never the realtime room
   key.
4. **Perspective key:** independently derived per participant perspective.
5. **Stream key:** independently derived per media, AX/DOM, comment, action,
   terminal, console, and other stream.
6. **Segment key/nonce:** unique per immutable segment, derived or randomly
   generated under the stream key with domain-separated authenticated data.

Payloads use the repository's Rust `pd-vault` AEAD boundary under ADR-0120.
Keys are labeled by harbor/stage/perspective/stream/epoch and are zeroized after
use. Nonces cannot repeat under a key. Ciphertext authenticates the schema id,
ids, ordinal, timestamps, policy/redaction state, previous commitment, and
codec so blobs cannot be transplanted into another history.

### Devices and recipients

Raw stage, perspective, stream, and segment keys remain on the producing device
under ADR-0124. They are never wrapped to a share recipient, warehouse, relay,
object store, or ordinary new-device sync. A new device can receive exportable
scrubbed/redacted derivatives, commitments, and withheld markers; access to raw
history requires local access to the producing device.

Realtime room grants and durable disclosure grants each use fresh keys. We use
HPKE rather than inventing an envelope scheme; RFC 9180 defines
recipient-public-key hybrid encryption from a KEM, KDF, and AEAD
([RFC 9180](https://www.rfc-editor.org/info/rfc9180/)). A durable disclosure
builder first creates a scrubbed/redacted derivative, seals it under a new
disclosure key, and HPKE-wraps only that derivative key. Grant records include
issuer, recipient device key, purpose, artifact/time bounds, capabilities,
issue/expiry, redaction/disclosure version, and revocation handle.

The relay, LiveKit service, R2 bucket, warehouse, search service, and shared-link
host do not receive harbor root, raw stage keys, or unrestricted perspective
keys. Realtime room keys, local raw archive keys, and disclosure-derivative keys
are distinct. Compromise of an ephemeral room or disclosure key cannot decrypt
the local raw archive or another perspective.

### Durability boundary and device loss

ADR-0124's raw-local-only boundary intentionally accepts one failure mode:
catastrophic loss of the producing device/key destroys exact raw evidence. The
UI labels such evidence `device-only; no disaster recovery`; it never implies
that an append-only ledger is immortal. Within a healthy device, the Phase 0
RPO is zero committed events and at most one not-yet-committed segment, with
recovery/read verification within 30 seconds of restart. Device-loss RPO is the
last explicitly exported scrubbed derivative and raw RTO is `unrecoverable`.

Provider-blind raw backup, another-device raw-key sync, or account-KMS custody
would materially change the privacy boundary and requires a separate approved
ADR with recipient enrollment, recovery authority, ransomware/deletion threat
model, and device-loss tests. Until then, teams that need disaster recovery pin
and export a reviewed scrubbed/redacted derivative; Porthole does not smuggle a
raw backup into object storage under the word “encrypted.”

### Rotation, revocation, and crypto-shredding

- participant removal rotates the realtime room epoch and invalidates any
  future disclosure grant; local device loss, suspected compromise,
  target/evidence-policy change, or explicit “lock now” rotates the local
  evidence epoch;
- future content and disclosures use new keys; old recipients are not granted
  them;
- revocation blocks future unwrap and retrieval, invalidates caches and links,
  and appends a receipt;
- already downloaded or viewed material cannot be recalled, which the UI says
  plainly;
- expiration or deletion destroys the controlled segment/epoch key and
  ciphertext where policy requires, while retaining a minimal signed commitment
  and crypto-shred receipt;
- search snippets, thumbnails, OCR, summaries, test artifacts, exports, and
  warehouse rows are lineage-linked dependents and are deleted or regenerated
  when their source is redacted or shredded.

## Three deliberately separate data planes

| Plane | Contains | Who can read | Storage and indexing rule |
|---|---|---|---|
| **Encrypted immutable evidence** | source media, DOM/AX/app operations, comments, actions/effects, raw receipts | producing device under local harbor authority | local-only content-addressed ciphertext plus append-only ledger; no raw sync/share/warehouse and no general semantic index over raw content |
| **Authorized retrieval** | scrubbed time-bounded text/image descriptions, citations, thumbnails, test/report projections | harbor members or share recipients authorized for the cited source | per-harbor/project hybrid index; every row carries lineage, policy, grant class, and invalidation state |
| **Scrubbed analytics** | counts, durations, gaps, action classes, adapter/build/test outcomes, storage and cost metrics | project/team analytics roles | no secret-bearing text, pixels, raw comments, DOM values, prompts, or participant content by default |

Moving data between planes is an explicit versioned job with lineage and an
egress gate. Encryption does not authorize analytics. Redaction does not grant
membership. A warehouse table never becomes the convenient back door to raw
evidence. Provider-blind raw cloud archival is not authorized by this ADR; it
would require a separately approved decision that explicitly supersedes
ADR-0124's local-only raw-retention boundary.

## Indexing and retrieval

### Search documents

The indexer creates small, cited documents from scrubbed evidence:

- comment and bug-report text;
- action/effect phrases such as “agent clicked Save; dialog remained open”;
- allowed AX/DOM/app semantic names and state changes;
- locally generated descriptions of approved frames or intervals;
- redacted console/terminal failures;
- build, repository, branch, commit, file, symbol, test, app, window, URL-origin,
  participant role, and adapter metadata;
- gap, privacy, capture-health, and completeness statements.

Each document cites an interval and exact source event ids. It stores no
uncited model-generated assertion. If a summarizer says “checkout failed,” the
document distinguishes that inference from a witnessed status code, visible
error, participant comment, or test failure.

The visual-description producer is local, bounded, and citation-preserving. On
already source-masked frames it combines approved OCR, AX/DOM/app labels,
computed style where available, coarse color clusters, geometry/layout classes,
and state changes into a structured description such as “purple settings panel;
Save button disabled.” Every field names its producer, confidence/uncertainty,
frame interval, and privacy receipt; low-confidence facts are not silently
promoted to witnessed truth. The canonical text embedder indexes that scrubbed
description, so visual recall does not require CLIP or a second embedding model.
The gate uses at least 200 fixed vague visual queries, including color/layout
paraphrases and privacy negatives, against seeded masked intervals.

### Hybrid retrieval, one embedder

Search uses:

- BM25/structured filters for exact ids, filenames, symbols, commands, error
  codes, participants, dates, builds, and quoted phrases;
- the repository's one canonical local embedder,
  `Xenova/all-MiniLM-L6-v2`, through `createLocalEmbedder()` or `pd embed`, for
  vague semantic recall;
- reciprocal rank fusion (RRF) over lexical and dense rankings;
- an optional bounded reranker only after relevance and cost evaluation.

Lexical-only search is a degraded mode that must say so and point at the local
embedding repair. Porthole does not introduce CLIP, a remote embedding API, or
a second model as a hidden special case. Visual evidence becomes searchable
through locally produced, scrubbed OCR/app semantics/descriptions embedded by
the same canonical text model. A future multimodal model requires an explicit
revision to ADR-0061 and a privacy/evaluation gate.

Results are authorization-filtered before snippets and scores are returned.
They show match reasons, source class, redaction version, gaps, and a “jump to
time” control. Search evaluation includes vague-memory queries, exact artifact
queries, negative privacy probes, cross-project isolation, revoked-content
removal, and citation correctness. Recall, precision, nDCG, time-to-first-cited
result, index lag, and authorization false-positive rate are release metrics;
the last metric must remain zero in adversarial fixtures.

Local retrieval starts with SQLite metadata/FTS plus the shared in-process
vector index. LanceDB or embedded Qdrant Edge can be evaluated only when the
local index no longer meets measured latency or memory targets. Network Qdrant
is optional for a large multi-device/team corpus requiring filtered hybrid
queries and independent scaling; Qdrant documents dense+sparse fusion with RRF
([Qdrant hybrid queries](https://qdrant.tech/documentation/search/hybrid-queries/)).
It is not a day-one dependency and never receives unredacted evidence.

## Evidence sharing and bug-report intake

### Share builder

A share is an immutable disclosure version over a bounded evidence set:

1. select stage, streams, and time interval;
2. resolve all cited dependencies and gaps;
3. apply the recipient disclosure policy and current redaction pipeline;
4. render a canonical artifact manifest and preview, hash both, and bind every
   source id to its source commitment and every derived file to its hash;
5. require attributable approval for identities, comments, media, DOM/AX,
   console/network, and test artifacts separately;
6. seal those exact approved bytes under a new disclosure key, verify the
   delivered manifest/hash equals the reviewed preview, then create
   recipient/device HPKE envelopes for that derivative key, expiry,
   view/download/comment capabilities, watermarking policy, and revocation
   handle;
7. append and sign the disclosure receipt before making the link usable; every
   access, download, comment, expiry, denial, and revoke appends a signed scoped
   access event.

The receipt records the reviewed preview hash, canonical delivered-artifact
manifest and equality check, one-to-one source commitments, withheld ranges,
redaction/policy versions, recipient, purpose, issuer, key grants, expiration,
and later access/revocation events. Sensitive recipient, purpose, work-item,
and reviewer metadata is sealed for authorized viewers; the public skeleton is
opaque. Updating a share creates a new version; it never mutates the old
disclosure claim.

Links reveal no project, participant, title, thumbnail, or search result before
authorization. Crawlers are denied. Download is separate from view. Recipient
comments append to a scoped review stream and do not grant control of the live
stage. An intake link for a user bug report grants only report submission into
a named project target, not evidence browsing.

An external recipient need not have a pre-existing Port Daddy account: the
landing page first creates a browser/device ephemeral public key and redeems a
single-use, purpose-bound enrollment token that reveals no artifact metadata.
The issuer approves or pre-authorizes that enrollment and wraps only the
reviewed derivative key to the resulting recipient key. Bug reporters use the
same one-way bootstrap for submission receipts; it never grants project search,
stage membership, raw evidence, or future disclosures.

### Bug-report package

A bug-report package includes:

- reporter's statement and expected behavior;
- selected source-time interval and anchor;
- app/browser version, build, commit, platform, window/viewport, feature flags,
  and sanitized environment facts;
- preceding actions and observed effects with controller/lease attribution;
- chosen visual and semantic evidence, console/network subset, gaps, and
  completeness receipt;
- reproduction attempt and outcome;
- candidate test and its review/run receipt when one exists.

The reporter sees the same disclosure preview before submission. Projects can
offer a one-click capture target, but cannot ask the user to surrender an
ambient desktop or browser profile.

## Test derivation

### Browser

The derivation job brackets the reported interval, converts witnessed actions
to Playwright operations, proposes resilient role/label/test-id locators,
captures the reporter's expected behavior as a candidate assertion, and emits a
reviewable spec. It then starts a clean isolated browser context and reruns the
candidate against the cited build or declared successor.

The job never treats the final broken DOM as the expected oracle. It never
copies cookies, authorization headers, form secrets, or response bodies into a
fixture. Generated test code is untrusted until a developer reviews it. The
`PortholeRegressionReceipt` records source interval, generator/version, privacy
scan, files proposed, clean-run result, flake attempts, reviewer, and accepted
commit or rejection reason.

Before any candidate runs, a language-aware validator permits only the bounded
test API/AST, treats page/app strings as inert data, scans code and fixtures for
secrets, rejects dynamic code/process/filesystem escape, confines execution to
an isolated disposable worktree/profile, and denies network egress except the
declared target fixture. The signed run receipt binds validator version,
sandbox/egress policy, clean-profile attestation, exact source/build, attempts,
artifacts, and outcome. Developer review authorizes a candidate for the project;
it does not retroactively make an unsafe generation attempt trusted.

### Native and instrumented apps

An arbitrary visual+AX trace can propose a generic accessibility replay, but it
cannot promise a stable unit test. Instrumented Swift/Rust apps supply semantic
object ids, deterministic actions, state assertions, launch configuration, and
test adapter metadata. The generator chooses, in order:

1. app-native deterministic state/operation test;
2. XCUITest or platform accessibility test;
3. bounded visual regression with explicit tolerance and accessibility anchor;
4. a reproduction script/commentary when no stable oracle exists.

Harbor Editor converts cited Loro operations/frontiers into deterministic
operation replay and editor-level assertions before considering pixel tests.
Every candidate is lineage-linked to source evidence, expected behavior, build,
generator version, review, and later test results.

## Data lineage, warehouse, and aggregation

### Lineage is emitted, not reconstructed later

Every transformation emits an OpenLineage run with exact input/output datasets
and versioned Port Daddy facets. OpenLineage facets attach structured metadata
to runs, jobs, inputs, and outputs
([OpenLineage facets](https://openlineage.io/docs/spec/facets/)); its explicit
lineage facet avoids inventing a Cartesian product between unrelated inputs and
outputs
([lineage facet](https://openlineage.io/docs/next/spec/facets/job-facets/lineage/)).

Named jobs include:

- `mask-and-seal-segment`;
- `scrub-semantic-event`;
- `describe-approved-interval`;
- `build-search-document` and `embed-search-document`;
- `build-disclosure-version`;
- `derive-regression-candidate` and `run-regression-candidate`;
- `compact-media-tier`;
- `export-scrubbed-analytics`;
- `redact-and-invalidate-descendants`;
- `expire-or-crypto-shred`.

Lineage is itself a privacy plane. The local authorized graph may carry exact
stage/perspective/native event ids and attributable actor ids. Any exported
OpenLineage facet uses randomized per-plane dataset ids, role-class rather than
stable person identity, coarse time/cost buckets, and only the export-safe
policy/model/schema/build facts required for invalidation. The mapping back to
native ids is encrypted per harbor and never sent to an external collector.
Collectors, query logs, and backups are membership-scoped, encrypted, residency
bound, retention-limited, and audited like the authorized retrieval plane.

The local lineage graph powers “why is this in search?”, “who could see it?”,
“what must be invalidated if this segment is redacted?”, and “which test came
from this bug?” A source redaction disables shares immediately, removes local
index/cache descendants within 30 seconds, queues warehouse/lineage derivatives
for verified deletion or rebuild within 15 minutes, and emits a signed
invalidation receipt. No exported facet exposes the social graph merely to make
the lineage UI convenient.

### Storage ladder

1. **Local foundation:** append-only SQLite ledger, encrypted
   content-addressed blobs, local hybrid index. This is the authoritative
   offline experience.
2. **Object archive:** encrypted immutable *scrubbed/redacted derivatives* in
   R2/S3-compatible storage, with lifecycle transitions and separate disclosure
   or sync key custody. Raw evidence and raw stream keys remain local-only.
3. **Analytical files:** scrubbed event and lineage projections written as
   partitioned Parquet. Parquet is a compressed columnar format, and DuckDB can
   query it directly with filter and projection pushdown
   ([DuckDB Parquet](https://duckdb.org/docs/current/data/parquet/overview),
   [Apache Parquet](https://parquet.apache.org/docs/)).
4. **Local/ad-hoc warehouse:** DuckDB over Parquet for developer, project, and
   scheduled aggregate queries. It is reproducible from lineage-linked exports.
5. **Scale services only on evidence:** optional Qdrant for distributed hybrid
   retrieval; optional ClickHouse for high-concurrency, high-volume event
   analytics; optional Iceberg for a multi-engine lake requiring transactional
   table evolution; optional LanceDB for embedded vector-heavy local datasets.

No optional service becomes authoritative. Promotion requires a measured
capacity report and security review. Starting decision thresholds are:

- vector service: sustained corpus/latency/memory or concurrent-query SLO misses
  after local tuning, plus a need for independent replication;
- ClickHouse: DuckDB/Parquet misses the agreed interactive concurrency or scan
  SLO on production-sized scrubbed data;
- Iceberg: multiple independent writers/engines need schema/partition evolution
  and snapshot coordination that immutable Parquet manifests no longer supply;
- LanceDB: an embedded vector corpus needs disk-native nearest-neighbor behavior
  that the shared local index cannot meet.

The architecture review records actual corpus size, QPS, p50/p95/p99 latency,
memory, ingest lag, recovery objective, monthly cost, and operational owner.
Product phase numbers or vendor enthusiasm are not thresholds.

### Scrubbed analytics schema

Facts: stage duration, participants by role (pseudonymous where appropriate),
adapter/capability, capture readiness, gaps, lease durations, action/effect
classes, comment/report/test lifecycle, search latency/click-through, share
grant/access/revocation, bytes and compute by tier, privacy failures, and costs.

Dimensions: harbor/project, application/build/platform, adapter/version,
participant role, date/time bucket, privacy policy version, redaction pipeline,
storage tier, test type/result, and source completeness. Raw comment text,
prompt/tool payloads, pixels, DOM/AX values, clipboard/keystrokes, URL query
strings, headers, customer fields, and stable person-level productivity scores
are excluded by default.

“Scrubbed” is neither anonymous nor self-authorizing. Search databases,
embeddings, Parquet manifests, DuckDB files, query/audit logs, caches, and their
backups use independent per-harbor/project keys, row/partition tenant guards,
residency policy, short query-log retention, and no cross-tenant result-count or
timing oracle. Membership changes invalidate caches and rotate export keys.
Deletion proof covers text rows, vector rows, thumbnails, manifests, backups at
expiry, and query logs; an embedding is treated as sensitive derived data, not
harmless math.

## Cost, retention, and capacity control

The system attributes bytes, encoder time, OCR/description time, embedding time,
realtime egress, object operations, warehouse scans, and test-run compute to
harbor/project/stage/perspective/participant role. The opening consent sheet
shows an estimate; the live stage shows actual rate and quota; the Library shows
retention consequences.

Cost controls:

- event-driven capture with adaptive frame rate; unchanged-frame detection and
  keyframe/delta encoding where verifiable;
- source visual quality sufficient for evidence, not indiscriminate 4K/60;
- semantic deltas rather than whole DOM/AX snapshots after the initial state;
- batching for segments, embeddings, lineage emission, and warehouse export;
- index only scrubbed cited documents, not every frame or raw event;
- local-first processing and caching of the one embedding model;
- hot/warm/cold/archive tiers with explicit transitions;
- per-stage, per-project, per-device, and per-harbor byte/compute/egress quotas;
- warning and hard-stop thresholds. Budget pressure may reduce frame cadence or
  resolution only while the committed witness schedule is updated by a visible
  policy event and still meets the irreducible floor: signed observation,
  lease, action/effect, gap/clock evidence plus masked target frames bracketing
  every consequential input. If that floor cannot be retained, embodied input
  stops; there is no “continue unwitnessed” mode;
- pinned bug reports, accepted tests, legal/security holds, and disclosure
  versions are separate retention classes, never accidental exceptions.

Initial defaults are conservative and must be tested before general release:

- append-only metadata, commitments, comments, and scrubbed search documents
  follow project history retention;
- high-quality local media is hot for 7 days, compacted/warm through 30 days,
  then cold or crypto-shredded according to project policy;
- a user explicitly pins an interval for long-lived evidence or bug-report
  retention;
- raw/quarantined content never gains longer retention merely because a derived
  report was pinned;
- share-specific keys expire with the share even when the source remains.

Defaults are visible and configurable at the harbor/project level. Enterprise
retention, legal hold, and residency policy can override them only through an
attributable policy event. “Append-only” never hides an unbounded media bill.

## Operator and developer interfaces

### Live stage

- exact target title/icon and persistent capture indicator;
- participant rail with identity/body/capabilities and connection health;
- patterned ghost cursors, selections, and anchored comment pins;
- visible controller badge, lease expiry, request queue, and instant revoke;
- local/source/display clocks and uncertainty on interaction;
- capture health per perspective, with unmistakable gap/quarantine bands;
- pause/stop/redact/share/report controls at the point of need;
- independent and follow-presenter viewport modes;
- semantic inspector that shows pixel, AX/DOM/app anchor, action, effect, and
  provenance without forcing raw protocol output into the main view.

### Porthole Library

- one search box for exact and vague recall;
- filters for project/app/build/person or agent role/date/action/test/report/
  share/completeness;
- result cards with short scrubbed preview, match reason, citation interval,
  privacy state, and gaps;
- a synchronized multi-track timeline for media, participants, comments,
  actions/effects, AX/DOM/app state, terminal/console, tests, shares, and lineage;
- source inspector and completeness receipt beside the composite replay;
- frozen-interval share and bug-report builders;
- “why this result,” “who can see this,” and “derived from” lineage views.

### Identity history and Porthole cueing

Every person and AgentNode has one discoverable append-only activity view. It
lists live, preparing, paused, gapped, and sealed Portholes; current Body and
target; capture readiness; controller; last witnessed effect; open comments;
and searchable past intervals. From the agent/body roster, a developer can open
the live Porthole in one action, or jump to the last complete perspective when
the Body is no longer live. From any event, they can pivot to participant,
stage, work item, build, file/symbol, bug report, test, or disclosure.

An agent admitted to embodied GUI work is cued a Porthole before its first
action. If no capture-ready Porthole exists, the body is visibly “not witnessed”
and consequential GUI input is blocked. This is the precise product meaning of
Portholes “always filming”: all embodied action has an exact-target witness,
not that every idle agent, operator desktop, or background process is recorded.

### Accessibility and visualization requirements

The experience is keyboard-operable and screen-reader named. Cursor identity is
never color-only: pattern, label, and participant list provide redundant cues.
Timeline zoom, pan, selection, comments, lease actions, and gap navigation have
keyboard equivalents. Motion respects reduced-motion settings; ghost cursors
can become discrete labeled positions. Contrast meets WCAG AA, body text stays
at least 14px and follows platform/browser scaling, and focus never disappears
under remote overlays.

Every chart or timeline summary has a data-table/text alternative. Dense views
use progressive disclosure, track folding, aggregation, and small multiples
instead of stacking every source into an illegible rainbow. A replay can hide
participant overlays without hiding source evidence. Exported evidence includes
descriptive alt text and a machine-readable manifest.

## Observability and safety operations

Health is content-blind where possible. Metrics include target binding,
capture-ready latency, frames/segments/events accepted and dropped, gaps by
reason, clock uncertainty, redaction/quarantine outcomes, seal/verify latency,
index lag, search quality suites, share-access failures, test-generation yield,
storage/compute/egress cost, key rotation, and lineage backlog. Telemetry never
ships pixels, comments, DOM/AX values, prompts, tokens, or raw URLs merely to
monitor the product.

Kill switches exist at device, harbor, project, stage, participant, adapter,
stream, indexing, sharing, and remote-transport levels. Stopping a stage drains
accepted events, seals completeness receipts, revokes the control lease, closes
room grants, and visibly reports anything that could not be committed. A crash
recovery path salvages ciphertext and emits gaps; it never fabricates continuity.

Abuse controls include short capability TTLs, recipient-scoped share grants,
rate limits, participant removal, agent action budgets, project egress policy,
origin allowlists, isolated browser profiles, auditable administrative access,
and adversarial tests for confused-deputy input, prompt-injected control
requests, covert background capture, malicious overlays, link guessing,
cross-project search leakage, and revoked-key reuse.

## Pull-request disposition

These PRs are inputs to one program, not competing definitions of the product.

| PR | Direction | Material to preserve |
|---|---|---|
| **#9902** | keep and finish as the intact terminal-perspective reference adapter; ADR-0135 remains the universal product authority | exact lineage from `933792db1` through `b03180034`; dual source/display clocks, jump cuts, discontinuity markers, lifecycle cleanup, independently verifiable source pane streams, source inspector, intermediate-frame proof, gates, and visual artifacts |
| **#9914** | hold disposition during the active three-way settlement; keep Sugar-first Parley independently useful and body-neutral rather than folding it into Porthole | exact commit/file/test lineage identified by its active owner; generic semantic-review policy, typed coordination events, and executable runtime proof without making Sugar the Porthole ontology |
| **#9929** | supersede the Parley/Sugar presentation coupling | generic session-begin purpose convergence and machine-mode tests if still absent on main |
| **#9924** | continue only as a generic claim/provenance producer | append-only claim and ownership evidence that a Porthole can consume |
| **#9960** | continue only as a generic provenance/body identity producer | durable body/action attribution and receipts, independent of Porthole rendering |
| **#9898** | keep as security/containment input, not a UI definition | sandbox, secret, egress, and action-boundary enforcement feeding readiness and effect receipts |
| **#9817** | make Harbor Editor the deeply instrumented reference body | Loro operations, semantic anchors, native multi-cursor, deterministic test derivation |

Before closing a superseded PR, the successor records exact commits/files/tests
being transplanted and those intentionally rejected. #9902 is not in that
superseded set: its active author owns the terminal adapter and the future
bridge. No stale PR is merged merely to save effort. No active agent's branch
is taken over without a current coordination check. The universal foundation
PR remains path-disjoint and lands contracts, security boundaries, and a
measurable first slice without rewriting the terminal evidence artifact.

The agreed integration sequence is:

1. preserve and land or separately extract the Parley notification fix at
   `9a26ed8bd` so Node and Bun can both record formal turns;
2. finish #9902's exact-head gates as the truthful terminal adapter;
3. land this path-disjoint universal foundation from current `main`; and
4. let #9902's author deliver the small bridge PR, with an extraction receipt
   and without upgrading historical disclosure derivatives into raw or
   complete evidence.

Steps 1 through 3 may progress concurrently where their file and runtime
boundaries are disjoint; step 4 waits for both source contracts to be stable.

## Delivery program and measurable gates

### Phase 0: converge direction and contracts

Deliver:

- this ADR; stage, perspective, event, control-lease, completeness, disclosure,
  and regression-receipt schemas with fixtures;
- PR disposition comments and extraction map;
- privacy threat model, key hierarchy, retention classes, lineage facet,
  adapter capability matrix, and source/display clock contract;
- a local encrypted append-only evidence store with no update/delete path.

The Phase 0 store is an internal seam only. It has no daemon route, share
builder, or production capture consumer until every gate below passes under
cross-process contention and crash injection.

Gate:

- schema fixture suite passes across TypeScript/Rust boundaries;
- wrong key, replayed ordinal, hidden capture, unknown redaction, target drift,
  and attempted update/delete all fail closed;
- a missing, truncated, replaced, or quarantined ciphertext cannot yield a
  `complete` receipt, and remains discoverable by post-close verification;
- capture expectation rules are committed before action and terminal receipts
  are signed over the terminal source event;
- concurrent writers cannot accept conflicting bytes as an idempotent retry or
  append after a terminal event;
- a public ledger contains no plaintext, secret, raw hash/equality oracle, or
  length-correlation metadata, target descriptor, or decryptable key material.

### Phase 1: arbitrary-window witness in `pd-console`

Deliver:

- macOS exact-window chooser and ScreenCaptureKit adapter;
- capture-ready-before-action handshake with the first agent body;
- pre-encode overlay exclusion and secure-region masks;
- encrypted frame/segment streams, clock anchors, explicit gaps, completeness
  viewer, and visible pause/stop indicator;
- local replay of one person plus one embodied agent in a non-browser Swift or
  Rust app.

Gate:

- an automated adversarial fixture places a token and another app behind/beside
  the target; neither appears in ciphertext-derived replay, OCR, index, logs, or
  diagnostics;
- killing permissions/recorder/process produces a visible gap and blocks the
  next agent action until readiness returns;
- ciphertext tampering and omitted segments fail verification;
- a developer can jump from an action to its source frame and completeness
  receipt.

### Phase 2: cooperative live stage and control lease

Deliver:

- participant room, patterned ghost cursors, selections, anchored comments,
  clocks, follow/independent view;
- lossy presence, reliable comments/selections, durable effect append;
- one explicit revocable control lease with request/modify/reject/grant,
  timeout, focus-loss, secure-field, and operator-interrupt handling;
- same-machine only. Remote transport is structurally forbidden until Phase 6
  ships E2EE media/data, trusted device enrollment, membership-bound room-key
  distribution, removal rekeying, and remote revoke latency proof.

Gate:

- two people and one agent can point concurrently while exactly one body can
  affect the target;
- median local cursor latency meets the interactive budget, reliable comments
  survive disconnect/rejoin, and no lossy cursor packet becomes authority;
- revoke prevents subsequent queued input and produces an attributable receipt;
- accessibility-only operation is complete without a pointer.

### Phase 3: owned browser, semantic bug report, and Playwright candidate

Deliver:

- isolated Playwright context; DOM/AX/action/console and restricted network
  streams; origin and popup boundaries;
- click-to-element anchors and resilient locator candidates;
- frozen bug interval, expected-behavior capture, candidate Playwright spec,
  privacy scan, clean rerun, and developer review receipt.
- the minimum local cited FTS+dense/RRF index over scrubbed report intervals,
  using the canonical embedder; Phase 5 turns this into the full Library and
  multi-source activity search.

Gate:

- a seeded web defect can be reported from the stage, found by vague search,
  converted to a candidate test, rerun on a clean profile, reviewed, and
  accepted without copying cookies, passwords, authorization headers, request
  bodies, or unrelated tabs;
- browser corpus privacy probes have zero unauthorized snippets/results;
- generated locators survive the agreed non-semantic DOM reshuffle fixture.

### Phase 4: Harbor Editor and native app SDKs

Deliver:

- Harbor Editor Loro/frontier/block/action bridge and deterministic replay;
- small Swift and Rust SDKs for semantic anchors, secure masks, selections,
  actions/effects, revision/build identity, and test adapters;
- XCUITest/native deterministic regression candidates.

Gate:

- two logical cursors edit Harbor Editor while source operations and visual
  evidence reconcile at cited frontiers;
- a native seeded defect yields a reviewed deterministic or XCUITest candidate;
- an uninstrumented app still works visually, with capability limits stated.

### Phase 5: Library, semantic retrieval, and evidence sharing

Deliver:

- local scrubbed BM25+dense/RRF index using the canonical MiniLM embedder;
- multi-track timeline, source inspector, match reasons, gap navigation, and
  lineage views;
- disclosure preview, freshly built redacted derivative, HPKE recipient grants
  for the derivative key, view/download separation, expiration/revocation,
  access log, and immutable disclosure receipts;
- scoped external bug-report intake.

Gate:

- blind evaluators find a target interval from vague-memory prompts and exact
  identifiers within the agreed latency/quality thresholds;
- every result opens the cited source interval and reports completeness;
- cross-project, revoked, raw, quarantined, and unknown-redaction content never
  leaks through result counts, snippets, embeddings, caches, or share metadata;
- a recipient can verify the disclosure receipt; hosted retrieval and future
  unwrap stop after revocation/expiry, while the receipt/UI states that an
  already downloaded copy cannot be recalled.

### Phase 6: remote stages and multi-device grants

Deliver:

- self-hostable LiveKit SFU integration, E2EE media/data, TURN deployment,
  participant reconnect, device enrollment, stage rekeying, and remote input
  budgets;
- relay/archive sync of exportable sealed events, commitments, and encrypted
  scrubbed/redacted derivatives with local authority; raw evidence stays local;
- network and membership change gaps/receipts.

Gate:

- relay/SFU/object-store compromise fixture reveals no plaintext content or
  content keys;
- removed participant cannot decrypt a new epoch;
- reconnect preserves durable comments/effects without treating missed presence
  as complete;
- remote stop/revoke works within the agreed safety latency under packet loss.

### Phase 7: lineage, warehouse, scale, and cost discipline

Deliver:

- OpenLineage events/facets for every derivation and invalidation;
- scrubbed Parquet exports and DuckDB reports;
- hot/warm/cold transitions, quotas, attribution, forecasts, alerts, and
  crypto-shred jobs;
- benchmark reports before selecting any optional Qdrant/LanceDB/ClickHouse/
  Iceberg deployment.

Gate:

- a source redaction traverses lineage and removes or rebuilds every derived
  search, share, test, cache, and analytics artifact;
- storage/compute/egress can be attributed to a stage and project;
- budget caps degrade capture honestly or stop it without silent gaps;
- warehouse reconciliation matches ledger aggregates and contains no blocked
  fields in adversarial scans.

### Phase 8: device, simulator, and ecosystem breadth

Deliver:

- iOS/Android simulator and permitted physical-device adapters;
- remote VM/Linux/Windows capture adapters with equivalent exact-target and
  privacy proofs;
- published app-SDK and test-adapter contract; evidence-package verification
  tools for recipients.

Gate:

- each adapter passes the same target isolation, readiness, secret, gap,
  control, encryption, citation, accessibility, and disclosure conformance kit;
- unsupported platform capabilities render as limits, never fabricated parity.

## Implementation Matrix

| Phase | Roadmap slug | Status | Depends on | Description |
|---|---|---|---|---|
| 0 | universal-porthole-embodied-pov-encrypted-history-and-search | now | — | Canonical direction, body-neutral contracts, privacy threat model, append-only encrypted store, and stale-PR disposition |
| 1 | porthole-exact-window-witness | backlog | universal-porthole-embodied-pov-encrypted-history-and-search | Exact-window ScreenCaptureKit witness, AX/native semantics, capture-ready gate, gaps, and local replay |
| 2 | porthole-cooperative-live-stage | backlog | porthole-exact-window-witness | Human and agent presence, cursors, selections, comments, clocks, and one explicit revocable control lease |
| 3 | porthole-browser-regression | backlog | porthole-cooperative-live-stage | Isolated Playwright/CDP browser adapter, semantic bug package, candidate test, clean rerun, and receipt |
| 4 | porthole-native-adapters | backlog | porthole-cooperative-live-stage | Harbor Editor reference body plus Swift/Rust semantic, privacy-region, action/effect, and test adapters |
| 5 | porthole-library-search-sharing | backlog | porthole-browser-regression, porthole-native-adapters | Accessible Library/timeline, cited hybrid retrieval, disclosure builder, recipient grants, and bug-report intake |
| 6 | porthole-remote-e2ee-stage | backlog | porthole-library-search-sharing | Self-hostable E2EE realtime rooms, device enrollment, epoch rotation, reconnect, and exportable derivative sync |
| 7 | porthole-lineage-warehouse-cost | backlog | porthole-library-search-sharing | OpenLineage derivations, scrubbed Parquet/DuckDB analytics, tiering, attribution, quotas, and measured scale gates |
| 8 | porthole-device-ecosystem | backlog | porthole-native-adapters, porthole-remote-e2ee-stage | Mobile, simulator, remote-VM, Linux, and Windows adapters plus a shared conformance kit |

## Verification strategy

The program maintains a conformance corpus with:

- known secrets in secure fields, visible text, console, URLs, DOM attributes,
  network headers/bodies, clipboard, terminal prompts, and background windows;
- target-window replacement, minimized/covered/offscreen states, popups, system
  sheets, browser tab/origin transitions, permission revocation, sleep/wake,
  recorder crash, disk-full, clock jump, offline/reconnect, and corrupted blob;
- concurrent pointers, stale or forged lease ids, queued input after revoke,
  malicious participant data, and prompt-injected control requests;
- vague search, exact search, negative privacy search, revoked result, stale
  index, misleading summary, omitted stream, and wrong timestamp citation;
- share preview mismatch, guessed link, expired/revoked grant, recipient device
  loss, download/view boundary, and redaction after disclosure;
- browser/native/Harbor candidate tests whose oracle is missing, wrong, flaky,
  privacy-unsafe, accepted, or later invalidated.

Tests verify source, compiled artifact, runtime, visual output, exact commit, and
live capture health as distinct witnesses. A golden screenshot or passing unit
test cannot stand in for target-isolation or secret-leak proof.

### Frozen reference gates

These are the initial failing thresholds on the recorded reference hardware,
100k-document local corpus, 200-query relevance corpus, 10k-query authorization
probe set, and declared LAN/WAN impairment profiles. A versioned benchmark/corpus
revision may change them; hidden configuration or “agreed later” may not.

| Gate | Initial threshold |
|---|---|
| local capture ready | p95 <= 2 s after consent and already-granted OS permission |
| secure mask alignment | same source frame, <= 33 ms geometry skew at 30 fps, zero unmasked encoded frames in flash corpus |
| dropped source detection | gap visible <= 250 ms; durable gap receipt <= 1 s |
| ghost cursor | local p50 <= 40 ms / p95 <= 100 ms; impaired WAN p50 <= 120 ms / p95 <= 250 ms |
| control stop | no dispatch after revoke receipt; local worst case <= 50 ms, impaired WAN <= 250 ms; max lease 30 s and one default consequential action |
| reconnect | reliable comment/selection/effect convergence p95 <= 5 s after transport recovery |
| cited search | recall@10 >= .90, nDCG@10 >= .80, p95 <= 300 ms, index lag <= 5 s, authorization false positives 0/10k |
| invalidation | share disabled <= 1 s; local index/cache <= 30 s; lineage/warehouse/export descendants <= 15 min |
| crypto-shred | local key/ciphertext and buffer read-back proof <= 60 s; backup expiry is separately reported |
| crash durability | zero committed-event loss, at most one uncommitted segment, verified local read RTO <= 30 s |
| support buffer | default min(120 s, 256 MiB), hard max min(5 min, 1 GiB), overwrite/key rotation proof <= 5 s |
| warehouse reconciliation | exact discrete-event counts; duration/byte aggregates within .1% of authorized source projection |
| default stage budget | warn at 1.5 GiB or 90 min; stop embodied input at 2 GiB or 120 min unless an attributable extension is granted |

No threshold relaxes the zero-tolerance gates for unauthorized pixels, secret
values, cross-tenant snippets/counts, forged authority, or post-revoke input.

## Consequences

### Positive

- Porthole becomes a reusable product for arbitrary software, not a handsome
  replay tied to one multi-agent scene.
- Developers and users can cooperate with embodied agents, then reuse the same
  truthful trail for debugging, search, sharing, review, and regression tests.
- Exact-window capture gives immediate breadth while DOM/AX/Loro/app SDKs add
  meaning without fragmenting the product.
- The three-plane boundary lets search and analytics become useful without
  turning warehouses and vector stores into copies of private raw history.
- Independent streams, keys, clocks, gaps, citations, lineage, and disclosure
  receipts make omissions and derived claims inspectable.

### Negative

- Exact-window media, AX/DOM/app semantics, realtime collaboration, durable
  archival, search, sharing, and test generation are separate systems that must
  agree on identity and time. The program is deliberately larger than a replay
  widget.
- Secure masking before encoding is platform- and app-sensitive. Unknown states
  must interrupt or reduce evidence, which will sometimes frustrate users.
- One OS control lease limits simultaneous action in uninstrumented apps. The
  alternative is dishonest multi-controller UI or unsafe interleaved input.
- Strong key separation, lineage-driven invalidation, disclosure preview, and
  cost attribution add work before broad cloud scale.
- Visual evidence is expensive; conservative defaults may compact or delete
  unpinned payloads while retaining the append-only historical skeleton.

## Rejected alternatives

- **Porthole is Parley replay.** Parley becomes one producer and useful demo,
  not the universal data model.
- **Porthole is a browser extension.** Extensions enrich approved pages but do
  not cover native software or provide the strongest isolated-browser body.
- **Porthole is screen recording.** Pixels alone lack cooperation, semantic
  anchors, action authority, effect receipts, and test derivation.
- **Capture the whole display and crop later.** Background pixels have already
  crossed the privacy boundary; post-crop is not target isolation.
- **Egress raw and redact only in the share viewer.** Off-device blobs,
  derivatives, indexes, backups, and warehouses become long-lived secret
  stores. Raw retention remains local-only; redaction must precede every
  derivative and egress.
- **OCR will find secrets.** OCR is probabilistic defense-in-depth, not a secure
  field boundary.
- **Record raw global keystrokes for perfect replay.** This is an ambient
  keylogger and unnecessary when semantic action/effect receipts exist.
- **Everyone controls the OS cursor.** Interleaved input has no coherent
  attribution or revocation. Concurrent presence plus one explicit lease is
  truthful.
- **Use one reliable channel for all stage events.** Cursor backlog harms live
  interaction; reliable delivery is still not durable evidence. Reliability is
  chosen by semantics.
- **Use the vector database as the evidence store.** A derived retrieval index
  cannot be the append-only, encrypted, verifiable source of truth.
- **Adopt Qdrant, ClickHouse, Iceberg, or another platform on day one.** Local
  SQLite, encrypted blobs, Parquet, and DuckDB prove the contracts first;
  measured thresholds justify operational dependencies.
- **Automatically ship generated tests.** A trace records what happened, not
  what should have happened. Expected behavior and review remain explicit.

## End state

When this program is done, a developer can open a Porthole around a website,
Swift app, Rust app, Harbor Editor, terminal, simulator, or another GUI. A
person and several agents enter the same bounded stage. They see each other's
ghost cursors, selections, focus, comments, and clocks. One clearly named body
holds a short control lease for the physical app while everyone else can point,
discuss, and request control. The agent cannot act until exact-target capture is
visibly ready. The operator can interrupt or revoke immediately.

The encounter leaves independently verifiable, encrypted perspectives with
explicit gaps, action/effect receipts, and source/display time. Background
windows and media are ignored; overlays are separate; secure fields are masked
before encoding; raw keystrokes, ambient clipboard, protected browser state,
and broad network bodies are absent. Search operates on scrubbed, cited
derivatives and can recover a vaguely remembered moment without leaking another
project's existence. A developer can freeze that moment into a reviewed bug
report, derive a candidate Playwright or native test, or share a precise
evidence interval through an expiring recipient grant and immutable disclosure
receipt.

The raw evidence store, authorized retrieval index, and scrubbed warehouse stay
separate. Every derivation carries OpenLineage provenance; every cost belongs to
a project/stage; every payload has a retention and key lifecycle; every result
jumps back to its source. Parley looks excellent inside this system, but it is
one of many cooperative experiences the system can host and remember.
