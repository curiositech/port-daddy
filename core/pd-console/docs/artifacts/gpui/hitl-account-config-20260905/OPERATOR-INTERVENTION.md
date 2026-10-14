# pd-console HITL account configuration Porthole proof intervention

The named feature build launched successfully on the primary display:

- app: `pd-console-dev-20260905-0827-hitl-account-config.app`
- version: `3.30.6`
- lane: `dev·hitl-account-config`
- requested surface: `hitl`
- exact Quartz window id: `52748`

Porthole proof could not be automated truthfully. The current signed prototype
was located at:

- `/Users/erichowens/coding/tmp/porthole-stage-package.dWEZo0/Porthole.app`
- bundle id: `dev.portdaddy.porthole`
- Team ID: `P5H9P59X2M`
- CDHash: `727cce2b8ae10d5df2a0c2ed3e7ddec3cfd0f4e0`

The prototype exposes no external control endpoint for selecting an exact
window, approving its scope, entering the stage, stopping, or exporting an
artifact. Its interactive source picker requires operator gestures. Its
automated `--proof-window-title` path is intentionally restricted to the signed
`Porthole Safe Fixture`; it rejects arbitrary pd-console windows. Normal
operator-selected windows remain memory-only and therefore cannot produce the
required screenshot or recording artifact.

A previous standalone capture attempt was stopped after this authority
boundary was clarified. It produced no image or recording. No full-screen or
display-wide media was captured, and no unrelated window content was retained.

The missing integration is Porthole scriptability for an operator-approved,
exact-window allowlist and explicit artifact persistence. No additional macOS
permission is requested here, and no visual proof is claimed.
