# Work Packet: FleetBar Technical Specification

Status: technical contract for the FleetBar surface.
Supersedes as contract: the prose embedded in
`docs/design/fleetbar-mockups/interactive-mockup.html` (the intent-first
reframe) and `docs/design/fleetbar-mockups/research-report.html` (the
fractional-border design language). Those files remain the visual source and
the design apotheosis; this packet is the buildable truth.

Chapter home: `19-operator-surface-triad.md`.

## Product claim

FleetBar is the ambient consent surface. It lives in the macOS menu bar, costs
the operator nothing to glance at, and is the only Port Daddy surface allowed
to *demand* attention — and only for human gates. Its reframe is adopted as
product direction:

> The fleet is plumbing. The front door is intent.

The popover opens to what the operator wants to *do*, not to a roster of what
agents *are*. Read/write/suggest, precisely:

- **Read**: the six-state glance grammar; one look answers "is anything on
  fire, is anything waiting on me."
- **Write**: approve/deny/modify pending gates, submit a Work Intent from the
  command bar, resume a project, interrupt a run.
- **Suggest**: the daemon's proposals surface as cards — a team proposal with
  cost and scope at the consent gate, a "catch me up" digest, turn-start
  suggestions that became operator-relevant.

## Shipped today (verified)

`apps/FleetBar/FleetBar/` (SwiftUI, Swift Package):

- `FleetBarApp.swift`, `FleetPopover.swift` — menu-bar app and popover.
- `DispatchStore.swift` — dispatch list with `approve(id:)`; approvals exist
  today as fleet-dispatch approvals in the nightshift section.
- `FleetControlCenter.swift`, `FleetControlPlaneWebView.swift` — a native
  shell window that loads the daemon's `/fleet-ui/` web surface (flow graph,
  YAML editor, inbox, sortie workspace, memory explorer).
- `FleetControlRoute.swift` — routes including `inbox`.
- `CostStore.swift`, `CostDashboard.swift`, `BudgetPauseStore.swift` — cost
  display and budget pause.
- `SecretsStore.swift`, `SecretsView.swift` — managed-secret views.
- `DaemonLocation.swift` — canonical preferred port 9876 discovery.
- `SingleInstanceGuard.swift`, `BackendPicker.swift`, `BerthDirectory.swift`,
  `OperatorTUILauncher.swift`, theme and preferences.

Landing in tandem (open PRs this packet aligns with, not duplicates):

- PR #652: sanctioned desktop surfaces become FleetBar + Fleet Control Center
  + pd-console; the Browser toolbar pill and browser-tab escapes are removed;
  nightshift transcripts render in an in-app sheet. The Control Center is
  FleetBar's deep window face, not a separate product.
- PR #648: the HITL proposal queue — daemon-persisted proposal packets,
  native Yes/No approval in the popover, pd-console pending awareness,
  approval feeds the build queue. This is the shipped v1 of "Waiting on you."
- PR #645: app-lane auto-refresh with FleetBar lanes.

Gap between shipped and this contract: the shipped popover is roster-and-
sections-first; approvals beyond the #648 proposal class are not yet
architecturally privileged; there is no command bar; state display predates
the six-state grammar; the webview shell imports the web surface's vocabulary
instead of the popover owning intent. Several shipped identifiers
(`DispatchStore`, the fleet-ui "sortie" workspace tab) carry old launch-verb
vocabulary — they are implementation names on the chapter 14 collapse path
and must not leak into new operator-facing copy. This packet is the inversion
order.

## Popover information architecture

Home, top to bottom (matches `interactive-mockup.html`):

1. **Waiting on you** — pending human gates, count-badged. Present only when
   nonempty. Each card: what wants to run, why, estimated cost, estimated
   time, network access class, files/scope affected; Approve (↵), Modify,
   Deny (⎋).
2. **Command bar** — free-text Work Intent composer. ⌘K opens the popover
   focused here from anywhere.
3. **Resume** — recent projects/sessions with one-line status and last-edit
   age; Enter re-enters (open worktree, restore console context, or reopen
   the artifact).
4. **Quick actions** — show me what you built; catch me up; talk to the
   fleet (one conversational entry point, no named persona — mockup persona
   names do not survive into the product); show the fleet (drawer).
5. **Footer** — daemon status, version, today's spend as one number.

Secondary faces, each a push within the popover (never a modal, never a new
window): resume detail, fleet drawer, artifacts, live swarm view after an
approval. Row click expands inline (Raycast list-item-detail pattern); expanded
rows show current step as streaming text, tool chips, and inline
pause/interrupt affordances — never hidden kebab menus.

Interaction contract:

- No ordinary action requires typing an id (chapter 00 criterion; chapter 10).
- Keyboard-complete: ⌘K open/focus, ↵ approve/primary, ⎋ deny/back, ⌘[ back,
  ⌘F fleet drawer, ⌘N intent, arrows navigate.
- Popover geometry: 380 pt width, dynamic height with a 40 pt clip buffer
  (research report, Stream 01).

## Human gates are the privileged object

PR #648's proposal queue is the first shipped gate class: a staff agent
submits a proposal packet, FleetBar renders native Yes/No, approval assigns
the packet to the build queue. This packet generalizes that shape rather than
inventing a parallel one — C5 pre-action gates, budget escalations, and
parley requests become further packet classes in the same queue, same card
anatomy, same durable decision path.

FleetBar renders chapter 18's C5 shapes directly:

- A gate card is a rendered **human gate payload** (work order C5): action,
  reason, policy that triggered it, cost estimate, scope, alternatives.
- Approve/Modify/Deny becomes a durable **ControlCommand**; the decision and
  its latency land in the transcript and the Work Receipt (denial receipts
  included).
- Gate cards render only for bodies whose compliance level can honor the
  decision (C4+ for pre-action gates). For anything weaker, FleetBar shows
  state and remediation, never a decorative button (chapter 00 criterion 6).
- Notification policy: gates may post a user notification; everything else is
  glance-only. The menu-bar icon carries at most one signal (count of pending
  gates or a single error tick). `human-gate-designer` owns the payload
  design; `app-sound-design` and `sound-design-and-audio` own the restrained
  audio cue set (chapter 13 sound policy: few sounds, all meaningful,
  silence-first).

## Data planes

Per the chapter 19 bus contract:

| Need | Plane | Mechanism |
| --- | --- | --- |
| roster states, current steps, cost ticks, pending-gate count | hot | the hot-bus WebSocket (chapter 19's single transport decision); the popover renders from an in-memory projection of digest frames |
| approvals, denials, intent submissions | cool | command envelopes; optimistic UI is forbidden — the card resolves when the durable ack returns |
| resume list, artifacts, receipts, catch-me-up | cool | daemon queries on open; cached per popover session with staleness label |

Rules:

- The digest stream is the only push channel; FleetBar never tails logs or
  scrapes notes.
- Reconnect renders the disconnected state honestly (gray states, controls
  disabled) within one frame; no phantom LIVE (chapter 10).
- Updates repaint on state *change*, not on poll tick — no micro-blinking
  (research report, state-dot contract).
- Steering (interrupt from an expanded row) follows the dual-path rule: hot
  intent for speed, durable ControlCommand for history.

## State grammar

Six states — the research report's state-dot contract (§05), adopted as Port
Daddy's own and mapped to daemon truth:

| State | Daemon condition | Color | Animation |
| --- | --- | --- | --- |
| Running | active stream/heartbeat within threshold | cobalt `#003FB8` | pulse ring 1.8 s ease-out, the only animation |
| OK | last run completed, no findings | emerald `#2E7D5B` | static |
| Warn | completed with warnings / degraded compliance | amber `#B8801F` | static |
| Error | failed, denied, or dead body with soul preserved | cinnabar `#B5392E` | static |
| Blocked | waiting on operator gate or parley | plum `#6B3F8A` | static |
| Idle | registered, no work | ash `#98928A` | static, stripe optional |

One state carrier per row: 3 px left-edge stripe restated by an 8 px dot; no
spinner may co-render with the dot; color is never the sole signal (label +
relative time always present). `Blocked` rows are what "Waiting on you"
aggregates; the two must never disagree, because both render the same
projection.

## Design token contract

From the research report, adopted as the FleetBar token set (Swiss-modern,
sparse color blocks, fractional borders):

- **Palette**: authority is the brand color system landing in PR #455
  (`website-v2` color rollout, enforced by `check-brand-colors`). The mockup
  values (paper/ink/cobalt and the five status hues) are placeholders until
  mapped onto brand tokens. The *structural* rules are binding regardless of
  final hues: one system accent, status colors as stripes only, maximum one
  accent plus status stripes — three competing accents on one panel is a
  defect. Contrast is verified at APCA thresholds with a WCAG 2 fallback
  check.
- **Type**: the mockups' literal faces are explicitly *not* adopted — they
  are the 2026 defaults that make every dev tool look the same. What carries
  forward is the scale and the rules; the faces are chosen per the
  `typography-expert` decision procedure:
  - UI chrome (rows, labels, controls): the platform family — SF Pro via
    system text styles, so Dynamic Type and the GRAD-axis dark-mode
    compensation come free. A menu-bar app that fights the platform font
    reads as a web page in a costume.
  - Brand/display moments (masthead, empty states, consent-gate headline):
    one distinctive variable family owned by the brand, selected with the
    brand system landing in PR #455 — candidates per the skill's
    decision tree for a warm-technical voice: Switzer, General Sans, or
    PP Mori; explicitly excluded: high-contrast humanist faces with rounded
    terminals, and the default-everywhere geometric sans set.
  - Numerics and paths (durations, costs, file paths): one mono family with
    `slashed-zero tabular-nums` as the default, not an opt-in; ligatures off
    for UI surfaces. Candidates: IBM Plex Mono or Berkeley Mono; decided
    with the brand pass.
  - Scale: display 36/40, subhead 22/28, body 15/24, mono 13 — with
    per-scale tracking (display tight-negative, body near-zero, caption
    slightly positive), never one uniform letter-spacing.
  - Floor: body text never below 14 px/0.875 rem; the only 12 px surface is
    the eyebrow (uppercase, w≥600, tracking ≥0.10 em). This is a hard
    accessibility line, not taste.
  - Dark mode: compensate apparent weight with the GRAD axis (or the SF
    equivalent), never by bumping weight — weight changes glyph widths and
    breaks line ends.
- **Fractional borders**, exactly four patterns and no others: panel-scope
  corner brackets (12 px L-ticks, 1.5 px stroke) · left-edge accent stripes
  (3 px, the load-bearing state carrier) · midline rules (64 px, 32 %
  opacity, section boundaries) · one color zone maximum (the singular
  currently-running highlight; a second concurrent runner stays in the list
  with a pulsing stripe). Never: box-shadow, border-radius card chrome,
  segmented strokes, open-corner frames, dashed persistent UI.
- **Grid**: 4 px base, 8 px element gap, Linear spacing scale
  (4/8/12/16/20/24/32/48/64/96/128). Brackets land on the grid.
- **Budget as a lint rule**: if the popover's styling exceeds the equivalent
  of ~100 lines of CSS, something is decorative. In SwiftUI terms: tokens are
  one `Theme` namespace; a view that defines local colors or font sizes
  outside `Theme` fails review.
- **Diagnostic**: remove every bracket — hierarchy must survive on color,
  spacing, and type alone. If it does not, the brackets were hiding a missing
  system.

Cost display rule (from the reframe): cost appears at the consent gate and as
one footer number. Per-agent ambient cost is available in the drawer on
expand, not on the home face — the surface must not fetishize spend.

## Build slices and gates

Slice F1 — token layer and state grammar:
  `Theme` refactor to the token contract; six-state projection from existing
  store data; stripe/dot/relative-time row rendering.
Gate: golden screenshots for all six states in light/dark; no spinner+dot
  co-render possible by construction; 14 px floor verified in an accessibility
  pass at 200 % scaling.

Slice F2 — intent-first home:
  home face reordered (gates → command bar → resume → quick actions); fleet
  becomes a drawer; ⌘K global open.
Gate: mockup parity review against `interactive-mockup.html`; no id-typing
  path remains for any home action.

Slice F3 — digest stream:
  one multiplexed hot-bus subscription replacing per-store polling; honest
  disconnect state; repaint-on-change discipline.
Gate: IT-017 (chapter 19) triad consistency within latency budget; daemon
  kill/restart fixture.

Slice F4 — human gate cards:
  render C5 human-gate payloads; durable approve/modify/deny; compliance-
  gated card visibility; notification + single restrained sound cue.
Gate: IT-016 (chapter 19); denial visible in transcript and Work Receipt;
  below-C4 body shows remediation instead of buttons.

Slice F5 — resume and artifacts:
  resume projection (worktree/session/artifact re-entry), "show me what you
  built" from receipt/artifact queries, catch-me-up digest.
Gate: resume from a captured session preserves old evidence (chapter 00
  criterion 5); artifacts open from receipt links, not guessed paths.

Ordering note: F1/F2 are pure client work and can start now against existing
endpoints. F3 depends on the digest stream (C1/C2 chains). F4 depends on the
C5 governance chain. Do not hold F1/F2 hostage to the daemon chains — the
inversion is visible value on day one.

## Skill backing

Graft per slice (a Seamanship act; chapter 19):

- Design system and tokens: `beautiful-gui-design`, `design-system-bootstrap`,
  `color-theory-palette-harmony-expert` (PR #650), `typography-expert` (owns
  the type decision procedure above — face selection, per-scale tracking,
  GRAD dark-mode compensation, APCA verification),
  `swiss-modern-website-design` (the lineage source for the border taxonomy).
- Interaction and flow: `agentic-coding-ux-designer`, `ux-friction-analyzer`
  (PR #650), `human-centered-design-fundamentals`, `mobile-ux-optimizer` for
  the glance-density tradeoffs.
- Human gates: `human-gate-designer`, `agent-work-receipt-designer` (decision
  → receipt), `checklist-discipline`.
- Platform: `cross-platform-desktop` (menu-bar conventions, later Windows
  question), `native-app-designer`, `macos-launchd-supervision` (login item /
  daemon relationship), `rust-app-distribution` (signed app + FleetBar
  bundling).
- Sound: `app-sound-design`, `sound-design-and-audio` (chapter 13 restraint
  policy).
- Data planes: `agent-interchange-formats`, `swarm-invocation-designer`
  (hot/durable split), `caching-strategies` (popover-session cache staleness).
- Product honesty: `product-reality-reviewer`,
  `port-daddy-user-surrogate-pm-review` for the slice reviews.

## What this packet does not claim

- FleetBar does not grow transcript panes, file previews, or editing; those
  are pd-console (chapter 19 boundary). The `/fleet-ui/` webview shell is a
  transitional surface and shrinks as native faces land; it must not acquire
  new exclusive capabilities.
- No Windows/Linux tray port until the macOS surface passes IT-016/IT-017.
- "Talk to the fleet" ships only after the ask-agent plumbing (Scout packet
  S4) proves the inbox exchange over the hot bus — same substrate, second
  client.
