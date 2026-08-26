# Port Daddy iOS — the operator surface

Slice D1 of ADR-0125: a native SwiftUI, HITL-first operator app. It renders
what the daemon and relay own, and it holds no runtime state of its own.

## What this is, and what it is not

**Is:** the human-in-the-loop surface. Roadmap home, harbors with reachability
verdicts, the interruptions inbox, and an honest control-verb matrix.

**Is not:** a fleet manager. Intent composition, fleet spawning, budget
management, and any editing are deferred by the ADR — deferred, not denied.
Each returns through its own surface-authority decision rather than by
accretion.

## Layout

```
apps/pd-ios/
  Package.swift                  SwiftPM, mirroring apps/FleetBar/Package.swift
  PortDaddy-Info.plist           bundle metadata for the future Xcode app target
  App/PortDaddyApp.swift         the @main entry — NOT compiled by SwiftPM
  PortDaddy/                     the PortDaddyKit library target (all the logic)
    Resources/                   fixtures, two of them generated
  Tests/PortDaddyKitTests/       XCTest
  scripts/                       CI helper
```

`swift build` cannot target iOS, so the compiled artifact is a **library**
target and the compile proof is `xcodebuild` against an iOS Simulator
destination. That is the one structural difference from FleetBar, and it is why
the `@main` App struct sits outside the package: SwiftPM cannot produce an iOS
`.app` bundle, and six lines of shim that CI does not compile is a smaller lie
than a target that pretends it can.

## Building

There is no Xcode project. Open `apps/pd-ios/Package.swift` in Xcode, or:

```sh
cd apps/pd-ios
xcodebuild build -scheme PortDaddyKit -destination 'generic/platform=iOS Simulator'
xcodebuild test  -scheme PortDaddyKit -destination 'platform=iOS Simulator,name=iPhone 16'
```

CI runs the same two commands against a simulator it resolves at runtime — see
the `pd-ios` job in `.github/workflows/ci.yml`.

## Running the real app + screenshots

The `pd-ios` gate above proves `PortDaddyKit` compiles and its XCTests pass. It
does **not** render the UI or compile `App/PortDaddyApp.swift` (the `@main`
shim) — SwiftPM cannot emit an iOS `.app`. To actually boot the app in a
simulator and capture what it draws:

```sh
brew install xcodegen        # one-time
apps/pd-ios/scripts/capture-screenshots.sh
open apps/pd-ios/pd-ios-screenshots   # 01-roadmap … 04-controls
```

The script assembles a runnable app target **ephemerally** with XcodeGen (spec:
`project.yml`), links `PortDaddyKit`, drives all four `RootTab` cases through an
XCUITest (`UITests/ScreenshotTests.swift`), and exports one PNG per tab. The
generated `PortDaddy.xcodeproj` is git-ignored — the checked-in contract stays
"no `.xcodeproj`, no XcodeGen output committed"; only the spec is tracked. The
run is deterministic and offline: `RootView` is fixture-backed by default, so a
cold launch renders real content with no network, pairing, or auth.

To open it interactively instead: `cd apps/pd-ios && xcodegen generate && open
PortDaddy.xcodeproj`, then Run the `PortDaddy` scheme on any iPhone simulator.

## Generated fixtures — the drift gates

Two files in `PortDaddy/Resources/` are generated and must not be hand-edited:

| fixture | canonical source |
| --- | --- |
| `maritime-signals.fixture.json` | `lib/maritime-signals.ts` |
| `control-contract.fixture.json` | `skills/agent-control-command-contract/examples/sample-input.json` |

```sh
npm run fixtures:pd-ios          # regenerate
npm run fixtures:pd-ios:check    # verify (this is what CI runs)
```

`MaritimeSignals.swift` and `ControlVerbs.swift` are hand-written ports of those
sources. The fixtures freeze the canonical answers; the XCTest suite asserts the
Swift reproduces them. Edit the TypeScript without regenerating and the CI check
fails; regenerate without updating the Swift and the tests fail. Neither side
moves alone.

## Honesty rules this app implements

These are not style preferences. Each one exists because the alternative
misleads an operator who is about to act.

- **Never a fake LIVE.** A roadmap item's LIVE chip requires a dispatch, a
  timestamp, and a timestamp inside the projection's own freshness window.
  Anything else renders STALE or NO EVIDENCE, next to the projection's own
  sentence about what it knows.
- **`unknown` is not `impossible`.** A harbor whose presence read failed looks
  different from a harbor whose daemons are all down. Only `impossible` gates a
  capability, and only the capability that needs a live body.
- **Never "all clear".** Before the first successful interruptions poll, and
  after any failed one, the inbox is `unknown` and carries no badge. A zero
  badge is a claim; an unread inbox has not earned it.
- **Unsupported verbs stay on screen.** `pause` and `fork` are unsupported on
  remote bodies. They render visible, disabled, and labelled with the reason,
  never hidden and never silently substituted by `kill`.
- **Fixture data says so.** Every screen driven by a fixture shows a provenance
  bar naming it. There is no unlabelled path.

## Known gaps

| gap | state |
| --- | --- |
| Roadmap projection endpoint | The relay's route is real (`GET /roadmap/projection`, #9223) — this client just doesn't call it yet. D1 has no live network wiring for any tab; `RelayClient.fetchRoadmapProjection()` throws `.serverSideUnbuilt`, and the home screen runs on a fixture and says so. |
| Reachability verdict endpoint | Deferred to v2+ by the relay's own harbors module. Verdicts are derived on-device from `GET /v1/harbors/:ns/:name/presence` and labelled as derived. |
| Answer / ack from the app | Not possible, by design. The relay's `closeInterruption` requires a signed-in session and a same-origin check; a device bearer token cannot close an ask. The app deep-links to `/account/interruptions`. |
| Pairing (ADR-0125 §3) | Not built. No control can be issued. The Keychain-backed token store lands with it. |
| APNs registration | The route exists in the relay's push module; until that deploys, registration returns 404. |
| TestFlight / App Store lane | **Not built, and blocked on credentials that do not exist.** See below. |

## The distribution gap

This repo's five `APPLE_*` secrets are a **macOS Developer ID + notarization**
pair — the Gatekeeper path for FleetBar and pd-console. They do not cover iOS.
Shipping this app to a device or to TestFlight needs, additionally:

- an **Apple Distribution** certificate (not Developer ID),
- an iOS **provisioning profile** for `ai.portdaddy.PortDaddy`,
- App Store Connect app record + API key scoped for upload,
- an APNs auth key already used by the relay's push module.

None of that exists in this account today. It is a spend-and-credentials
decision, not a coding task, and the CI job here deliberately passes
`CODE_SIGNING_ALLOWED=NO` so nothing can start quietly depending on a
certificate before that decision is made.
