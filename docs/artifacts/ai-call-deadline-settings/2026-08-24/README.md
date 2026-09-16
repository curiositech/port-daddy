# Visual proof — `/account/repos` AI call timeout field (PR #9800)

Requested by the human adversarial review on PR #9800 (finding 5, MEDIUM):
`/account/repos` is an operator-facing page and the PR that added the new
"Fleet AI call timeout" field marked itself visual-exempt without evidence.

## What these are, honestly

These are **not** a live Cloudflare Worker + D1 capture (no `wrangler dev`
instance was stood up for this). They ARE the actual, unmodified,
production `renderRepoSettingsPage()` export from
`apps/relay/src/repo-settings-page.ts` — the exact function
`handleRepoSettingsPage` calls in production — invoked directly with
representative `RepoSettingRow` data and screenshotted with headless
Chromium. The HTML pixels are real; the data feeding them is a fixture.

## Files

- `settings-normal-light.png` / `settings-normal-dark.png` — the rendered
  control for two repositories: `curiositech/port-daddy` at the untouched
  default (5 minutes, `settings_json: '{}'`) and `acme/widgets` showing the
  **resulting live receipt field** after an admin set it to 10 minutes
  (`settings_json: '{"aiCallDeadlineMs":600000}'`) — i.e. what a real save
  by an authorized admin actually persists and renders back.
- `settings-error-light.png` — the validation/error state: the notice a
  non-admin sees when `handleRepoSettingsSet` rejects an attempt to change
  `acme/widgets`'s already-admin-set deadline (the admin-authority gate
  added in response to finding 3 of the same review).

## Repro

```
node -e "
  import('/home/user/port-daddy/apps/relay/src/repo-settings-page.ts').then(({default: m}) => {
    // m.renderRepoSettingsPage(user, rows, notice) — see this file's git
    // history for the exact fixture rows used.
  })
"
```
Screenshotted via `chromium.launch()` (Playwright), viewport 1100×1400,
`colorScheme: 'light' | 'dark'`, `fullPage: true`.
