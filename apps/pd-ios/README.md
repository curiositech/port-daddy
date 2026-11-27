# Port Daddy iOS: Relay preview

The native SwiftUI app has two ways to look around. Open **Interruptions** or
**Harbors** in your browser to see your account, or choose **Explore sample
data** to try the native inbox and harbor views without signing in. The samples
are labeled in the list and detail views. A stale harbor observation is not a
current reading, an unknown reading does not mean unreachable, and an expired
sample interruption has no answer action.

This preview is not the full [ADR-0125 operator surface](../../docs/adr/0125-ios-operator-surface.md).
It does not sign in, poll, register for push, show live transcripts, or send
commands. The existing roadmap and other design fixtures stay in the package
for development, but they are not reachable from the preview’s app entry.

## Authority boundary

The browser destinations are fixed HTTPS pages on `relay.portdaddy.dev`:
`/account/interruptions` and `/account/harbors`. Relay handles sign-in in the
browser; the app does not pass credentials, record IDs, or callback state in
the URL. If Relay redirects to sign-in, use the requested account page again
after signing in. Answering an interruption remains a browser-session action.

The JSON read routes accept browser sessions or a `pdu_` **account bearer**
([`device-flow.ts`](../relay/src/device-flow.ts), an access token that grants
account authority to whoever holds it). The existing device exchange mints a
token without an expiry or a read-only scope. The same resolver is used for
writes such as creating a harbor ([`harbors.ts`](../relay/src/harbors.ts)).
Restricting client code to `GET` does not narrow the token's server-side
authority. Nothing in the app initiates that exchange, accepts a pasted
token, imports a cookie, or stores a credential.

The existing typed client is retained and exercised with intercepted fixture
responses. It allows bodyless reads, refuses redirects, and uses no cookie,
credential, or response cache. Errors do not repeat server response text or
raw transport diagnostics. The app entry does not construct the client.
Before enabling native reads, Relay must issue an expiring, revocable phone
grant scoped to the intended read endpoints, with negative tests at mutation
endpoints and a supported enrollment path. That is a separate Relay contract
change. Keychain custody cannot replace it. The existing transport also needs
bounded response accumulation before it handles untrusted data in the app.

## Build and evidence

`project.yml` defines the existing `ai.portdaddy.PortDaddy` app; it generates
an untracked Xcode project with XcodeGen. `Package.swift` defines `PortDaddyKit`
and its Swift tests. The test scheme does not own the app entry when built
through Swift Package Manager, so a package build alone is not app proof.
The icon in the app catalog is the opaque 1024 px raster of
[the source anchor](Design/RelayAnchor.svg). No Apple team or export credential
is configured in the project.

- For an unsigned device archive, stage a copy of the app and its adjacent
  `PortholeMediaKit` dependency in the linked worktree's scratch directory.
  Generate from `project.yml` in that copy, then archive the `PortDaddy` scheme
  for `generic/platform=iOS` with signing disabled and scratch-local derived
  data. An unsigned `.xcarchive` is not a TestFlight binary.
- The existing CI job builds and tests `PortDaddyKit`. The separate hosted
  capture job invokes [the app’s fixture harness](scripts/capture-screenshots.sh).
  It checks the disconnected launch, sample inbox, expiration, harbor list
  and stale reading at standard and largest accessibility text sizes in
  light and dark mode. It never opens the live pages. Compile-only results
  do not satisfy the rendered evidence gate. Do not launch the app locally
  while the operator halt is in effect.
- Maritime signals, the control contract and the interruption wire-shape
  fixtures are generated. `npm run fixtures:pd-ios:check` checks their
  parity without rewriting any of them.

## Private TestFlight gate

Before any upload, require independent review of the exact source, accepted
native visual evidence, and a readback of the dedicated `ai.portdaddy.PortDaddy`
record on the Curiositech LLC team named by ADR-0125. Verify distribution signing
and the next version/build against that record, not the local placeholders.
Developer ID signing used by the Mac apps is not iOS distribution signing.
[Apple upload requirements](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)
and [cloud-managed signing](https://developer.apple.com/help/account/certificates/cloud-managed-certificates/)
describe separate checks. This preview is not evidence that the ADR’s pairing,
revocation, command, push, or delivery gates pass.

For an already-eligible tester, use a one-person internal group with automatic
distribution off. Otherwise use a private email-only external group and
Apple’s beta review as required. Do not add any account role.
[Internal testing](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/)
and [external testing](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/)
have different eligibility and build rules. Record the signed artifact hashes,
Apple upload and processing states, exact group/build assignment, and invitation
status independently. Do not include tester details in Git or pull requests.
