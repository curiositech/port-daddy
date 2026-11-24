# Harbor Work Register navigation proof

Source commit `e3c9e280d5389f97215d19c8822318a10a2ed80f`. The Playwright test uses the actual Relay renderers and request handlers with an in-memory D1 fixture, a synthetic browser session, and stubbed GitHub responses. OAuth initiation preserves the fixed Register destination. The browser journey begins at Relay sign-in, uses the seeded session to open Account, and reaches the repository’s **Authorize this task** form using the keyboard.

| Artifact | Captured state |
| --- | --- |
| `login-light.png` | Register link in the standard Relay sign-in card |
| `account-dark.png` | Register link in signed-in Account navigation |
| `chooser-mobile-dark.png` | Repository chooser with keyboard focus at 390 px |
| `board-light.png` | Board for the synthetic repository with the approval form visible |
| `journey.webm` | Headless Chromium recording at 1280 × 900 |
| `journey.gif` | Reduced-size preview derived from the recording |

Run `REGISTER_TASK_PROOF_DIR=<owned-output-dir>` with the Node 22 Vitest invocation for `apps/relay/tests/work-register-grant-page.test.ts` to reproduce the capture. The separate mobile assertion submits a synthetic approval form outside the recording. The fixture media contains no live OAuth, real account credentials, or pairing code.
