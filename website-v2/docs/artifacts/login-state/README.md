# Login-state header artifacts (wf-web-login)

Proof captures for the AccountChip header work: signed-out header in light +
dark at 1680 / 1280 / 900 px, full-page context shots, and a short scroll
recording. Captured with Playwright chromium
(`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`) against
`vite preview` of the production build — see `capture.mjs` (run from
`website-v2/` with the preview server on `:4173`).

Provenance / honesty labels:

- `header-signed-out-*.png`, `home-header-*.png`, `home-scroll-signed-out.webm`
  — REAL build output; the relay probe (`relay.portdaddy.dev/auth/status`) is
  route-ABORTED, so these simultaneously prove the graceful-degrade path:
  relay unreachable → the header renders the plain "Sign in" chip.
- `header-signed-in-mocked-dark.png` — the `/auth/status` response is a
  MOCKED fixture (`{login: "mariner", avatarUrl: null}`); it exists to verify
  the signed-in chip's layout (avatar-only at this width), not to claim a real
  session.

`capture.mjs` also asserts pairwise non-overlap of the header controls
(nav / search / repo link / account chip / theme toggle) at every captured
width and fails the run on any collision.
