# ADR-0125: iOS Operator Surface

- **Status:** Accepted
- **Date:** 2026-08-16
- **Supersedes:** ADR-0105 open question 6 ("Mobile app vs PWA") — the
  PWA-first stance for mobile is retired; mobile steering ships native
- **Demanded by:** binder ch15 C17 and reality-check gate 9 (device-control
  gate)
  (`docs/architecture/agent-harbor-technical-binder/15-recursive-critical-synthesis.md`)
  and binder ch19's sanctioned-surface set
  (`docs/architecture/agent-harbor-technical-binder/19-operator-surface-triad.md`)
- **Builds on:** ADR-0027 (relay harbor mesh, phone device role), ADR-0105
  (portdaddy.dev account surface), ADR-0103/ADR-0110 (Apple signing and
  unified distribution), ADR-0122 (harbor authority epochs)
- **Siblings (2026-08-16 shared-harbors program):** ADR-0122 (Harbor
  Authority), ADR-0123 (Cloud Vault / Account KMS), ADR-0124 (Transcript
  Redaction), ADR-0126 (Shared-Harbors Re-sequencing)
- **Doctrine drawn from:** `skills/operator-surface-authority-designer`,
  `skills/agent-control-command-contract`, `skills/native-app-designer`

## Context

Binder chapter 19 places one operator at three distances from the work —
Scout inside the artifact, FleetBar ambient in the macOS menu bar,
pd-console deep and seated — and deliberately leaves mobile outside the
triad as "a capability-scoped observer (chapter 01)." ADR-0027's device-role
table gives the phone the same modest job: "thin approval and reply
surface... no daemon and no raw filesystem authority by default."
ADR-0105's open question 6 punted on form factor: "Mobile-first surfaces
(steering, tunnel viewing) could be a PWA initially; an iOS app comes later
if the PWA is friction. Out of scope here."

Three things have shifted since ADR-0105 was written, and together they
settle native iOS as the canonical mobile control surface:

1. **The HITL interruption contract shipped and binds every operator
   surface.** `docs/hitl-interruptions.md` §4 requires that an open
   interruption be visible to the operator at most 60 seconds after
   creation, on "any future operator surface." Web Push is technically
   viable on iOS for Home Screen web apps and uses APNs; Apple says those
   notifications appear like native notifications, including on the Lock
   Screen. It therefore is not honest to reject a PWA as incapable of
   background delivery. It does require the user to add the app to the Home
   Screen and grant permission after direct interaction. Native iOS is the
   chosen canonical product surface; the browser remains a fallback, not a
   second mobile control authority. Primary platform reference:
   <https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/>.
2. **Binder ch15 C17 hardened phone control into a gated path.** Mobile
   pause/interrupt and push approvals are control authority, and the
   whitehat closure demands WebAuthn/passkey device cards, per-command
   `jti`, short command expiry, and fail-closed revocation fixtures.
   Passkeys exist on both native and web surfaces. Native is chosen so the
   device-card lifecycle, separate wrapping-key custody, command receipts,
   and revocation UX have one canonical mobile implementation rather than
   two security-sensitive clients drifting apart.
3. **The shared-harbors siblings specify the primitives a phone needs to be
   safe.** ADR-0122 puts an authority epoch on every control command and
   makes stale or revoked commands fail visibly; ADR-0123 gives devices
   key custody that keeps plaintext off the relay and the hosted tier;
   ADR-0124 gates what a transcript may contain before it is persisted or
   synced. A phone rendering transcripts off-Mac was blocked on precisely
   those three. The accepted ADRs now settle the contracts; implementations
   and adversarial fixtures remain launch gates.

Operator decision 2026-08-16: build it native, SwiftUI, HITL-first v1.
This ADR makes that surface legal in the operator-surface authority model
and records the contract it must satisfy.

## Decision

### 1. `ios` is the fourth sanctioned operator surface

A native SwiftUI app at `apps/pd-ios/` joins Scout, FleetBar, and
pd-console as the fourth sanctioned operator surface, named `ios` in the
surface enum. Its distance-model role, stated in the vocabulary of
`skills/operator-surface-authority-designer/references/distance-based-authority-model.md`:

- **Ambient consent, off-Mac.** FleetBar owns the ambient distance on
  macOS; `ios` owns it when the operator is away from the Mac, where no
  menu bar exists. This preserves the one-owner cardinality rule: the
  ambient distance has exactly one canonical surface per platform, never
  two surfaces competing on one.
- **Read-only slices of pd-console's deep truth.** The transcript tail and
  receipts render on the phone as read-only projections labeled with
  freshness. Full-evidence inspection, files, diffs beyond summaries, and
  editing remain pd-console's alone — the evidence-screen rule binds `ios`
  exactly as it binds FleetBar: anything needing more than one screen of
  evidence is a console feature, and the phone shows the honest slice
  rather than growing panes.

The triad's honesty rule extends verbatim to the fourth surface: `ios`
owns **no runtime state**, renders daemon truth, and submits commands
through the same command/query/event envelopes as the other three. It
never shells out to the CLI or MCP internally, and it never renders a
control the daemon cannot enforce. Killing the daemon (or losing the
relay) degrades the phone to the same honest disconnected state as the
rest of the fleet; reconnecting rebuilds its view from ledger truth with
no phantom state.

### 2. v1 scope is HITL-first

The first shippable app is the human-in-the-loop surface, nothing more:

1. **Consent gates and interruptions.** APNs push is the delivery channel
   for the relay's operator-interruption pages; the decaying-nag state
   machine (`docs/hitl-interruptions.md` §3 — full jitter, stage dedupe,
   hard stop after five delivered nags, per-operator page budget) stays
   server-side and unchanged. The app is a renderer and an answer path,
   not a second nag engine. The §4 UI contract binds verbatim: poll
   `GET /v1/interruptions?state=open` at ≤30 s with full jitter, surface
   within 60 seconds, block dependent work while a `critical` ask is open,
   deep-link to the session-gated answer/ack surface, and never fabricate
   — a failed poll renders "unknown," never "all clear."
2. **Harbors list with per-harbor reachability verdicts.** The X2 enum
   (`possible|degraded|impossible|unknown`,
   `docs/proposals/relay-grand-plan.md` §X2 — "the exact boolean a future
   mobile client needs"), rendered per §6 below.
3. **Roadmap home and the do-this-next rail.** The binder ch23 rail —
   "surfaced at the entry of every sanctioned surface" — appears on the
   phone as it does everywhere else.
4. **Live transcript tail.** Redaction-gated per ADR-0124: the tail
   streams exportable events only, and a withheld segment renders as
   withheld — never a silent hole, never a raw secret payload on the
   phone. Decryption is on-device per ADR-0123, so the relay and hosted tier
   never hold plaintext the phone can read.
5. **Pairing** (§3 below).

Deferred, not denied: intent composition, fleet spawning, budget
management, diff review beyond summaries, and any editing. Each returns
through its own surface-authority decision, not by accretion.

### 3. Pairing mints a passkey-backed device card

Pairing follows the ch20 Login mock
(`docs/design/2026-07-05-surface-redesign/mockups-ch20/login.html`, the
normative mocks binder ch20 adopts): the 4-digit ritual under the Quebec
masthead — pratique, requesting permission to enter — with the co-op
mockups' QR invite flow as the harbor-invite path. The ceremony
mints an ADR-0027 device membership record (`deviceKind: 'phone'`) backed
by a WebAuthn/passkey credential for authorization and a distinct X25519
wrapping key for encrypted key delivery, per ADR-0123 and the ch15 C17
whitehat closure. No email-only recovery path exists for control authority.

Every remote command the app submits carries a per-command `jti` and the
harbor authority epoch it was authorized under (ADR-0122 §4). A command
from a revoked device or carrying a stale epoch fails visibly with a
recorded reason — never silently dropped, downgraded, or retried under the
new epoch.

Ship gate (binder ch15 C17 / reality-check gate 9): the
**stolen-device**, **replayed-command**, **expired-approval**, and
**revoked-device** fixtures must all fail closed BEFORE the app ships.
Mobile control does not ship on the promise of these tests; it ships on
their passing.

### 4. Control verbs follow the control-command contract

The app's controls are governed by the per-backend verb matrix of
`skills/agent-control-command-contract`. For remote bodies — the
`cloudflare-remote` row in
`skills/agent-control-command-contract/examples/sample-input.json` — the
supported set is `steer`, `interrupt`, `kill`, and `checkpoint`, each a
distinct claim with the full `queued`/`delivered`/`acknowledged`/`failed`/
`expired` lifecycle. A sixth state, `unsupported`, exists for the case this
paragraph is about — a command issued against a verb the backend does not
have. It is deliberately its own terminal state rather than a flavour of
`failed`: "this backend cannot do that" and "this backend tried and could
not" are different answers, and collapsing them would let an unsupported
verb read as a transient failure worth retrying.

`pause` and `fork` render as **honest unsupported
affordances**: visible, disabled, with the stated reason — never hidden,
never wired to a no-op, never quietly substituted by `kill`. A backend
gaining a verb re-opens the matrix; a passing contract from last quarter
is not evidence about today's adapters.

The UI never collapses a command's lifecycle to a single spinner. The
operator sees whether a control was queued, delivered, acknowledged,
failed, expired, or unsupported — the ch15 diagram 2b rule, applied to a
surface where delivery latency is at its worst.

### 5. Authorization reads authoritative state only

Command authorization uses `authoritative-lease` or `authoritative-event`
sources exclusively — never a cached projection, never UI state. An iOS
app on a flaky cellular network is the worst case this rule exists for:
the app may render a roster that is minutes stale (and must label it
stale), but a tap sends an envelope, and the daemon-side handler
re-resolves the target against the lease or the appended event log at the
moment of authorization. If the target is gone, re-leased, or under a new
authority epoch, the command fails closed with a recorded reason. The
phone's cached view can inform what the operator sees; it can never widen
what a command is allowed to do.

### 6. Reachability follows the split-plane law

Per-harbor reachability verdicts obey the rule from
`skills/status-attestation-split-plane`: **verdicts inform degradation,
never gate existence.** Concretely:

- No splash screen ever blocks on a status fetch. The app opens to its
  last-known state immediately.
- `unknown` renders the cached last verdict plus its age, and retries with
  full jitter. `unknown` is never treated as `impossible`.
- Hard gates are permitted only on a machine-readable `impossible`, per
  capability, with the reason rendered on the face of the disabled
  control — never for the app as a whole.
- Disconnected, the phone shows cached read-only status with a clear stale
  marker and "must not pretend to have live authority" (ADR-0027,
  verbatim).

### 7. Design and platform bar

The app is SwiftUI against the ch20 design system through the
cross-runtime token mapping (`docs/design/story-linework/apps.html`).
State flags render through `lib/maritime-signals.ts`; no surface
hand-picks letters. The `skills/native-app-designer` hard rules apply: SF
Symbols, never emoji, as UI icons; Dynamic Type honored with no body text
below 14 pt; every tap target ≥ 44 pt; both themes shipped together; state
never color alone. The design does not ship until
`skills/native-app-designer/scripts/native_design_audit.mjs` passes
against its spec.

## Consequences

### Positive

- The HITL interruption contract is finally honorable off-Mac: an open
  `critical` ask reaches the operator's pocket within its 60-second
  window, through the same nag engine the other surfaces already poll.
- ADR-0105's phone story lands with one canonical mobile control client and
  C17's fail-closed fixtures as a ship gate rather than a hope. Web Push
  remains a technically capable browser fallback, not a competing authority.
- The ambient distance gains an owner where FleetBar cannot exist, without
  breaking the one-owner cardinality rule or letting a fourth surface own
  runtime state.

### Negative

- App Store review cadence now sits in the release path of an operator
  control surface. A contract change cannot assume same-day client
  updates; what makes this tolerable is that every safety property in this
  ADR — epochs, `jti` replay refusal, expiry, revocation — is enforced
  server-side and fails closed against an old client.
- A fourth surface is a fourth place for drift. The audits below are the
  standing answer, not a one-time chore.
- Swift/iOS joins the build and test matrix alongside the daemon,
  FleetBar, and pd-console toolchains.

### Neutral

- ADR-0105's mobile-PWA track is retired for steering; its Phase W3
  "mobile-friendly layout" survives as a browser fallback, and
  portdaddy.dev remains the accounts/receipts/distribution surface it
  already is.

### Mechanical consequences

1. Binder ch19's sanctioned-surface set and the canonical enum in
   `skills/operator-surface-authority-designer/scripts/surface_authority_audit.mjs`
   (`{ intake: 'scout', ambient: 'fleetbar', deep: 'pd-console' }`) must
   be extended for `ios` before any capability is assigned to it; every
   `ios` capability placement runs through that audit.
2. The `ios` verb spec runs through
   `skills/agent-control-command-contract/scripts/control_contract_audit.mjs`
   with the remote-body backend rows before any control renders as
   clickable, and re-runs on any backend or verb change.
3. Release train: the FleetBar Apple signing/notary lineage is reused —
   the same Curiositech LLC team (`P5H9P59X2M`) and notary tooling proven
   by ADR-0103 and ADR-0110 (`scripts/sign-and-notarize.mjs`). App Store
   Connect submission is the one genuinely new leg — those ADRs proved
   Developer ID distribution outside the App Store — but it rides the
   same team and credentials. No parallel pipeline.

## See also

- [ADR-0027](0027-relay-harbor-mesh.md) — the phone device role and
  membership record this surface inhabits
- [ADR-0105](0105-portdaddy-dev-account-surface.md) — the account surface;
  its open question 6 is superseded here
- [ADR-0122](0122-harbor-authority.md) — authority epochs on every control
  command
- [ADR-0123](0123-cloud-vault-account-kms.md) — key custody behind
  on-device decryption
- [ADR-0124](0124-transcript-redaction.md) — the redaction gate ahead of
  the transcript tail
- ADR-0126 (Shared-Harbors Re-sequencing) — where this build slots in the
  shared-harbors program, including the ADR-0124 stamping prerequisite the
  transcript tail ships behind
- `docs/architecture/agent-harbor-technical-binder/19-operator-surface-triad.md`,
  `15-recursive-critical-synthesis.md` (C17),
  `20-design-system-story-linework.md`, `23-onboarding.md`
- `docs/hitl-interruptions.md` — the interruption contract §4 binds this
  surface verbatim
