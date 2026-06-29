# pd-tube demos — deterministic simulated replay (2026-06-23)

Visual proof for the fix that stops the public pd-tube demos from firing a real
`fetch()` at `http://127.0.0.1:9876` (which tripped the browser's Local Network
permission prompt and then failed with "Failed to fetch").

Captured with headless Playwright against the local Vite build. On localhost the
demos resolve to **SIM** mode (the public-site default), which is exactly what a
visitor to portdaddy.dev sees.

Measured during capture:
- **0** network requests to `:9876` (was: one per click).
- **0** "Failed to fetch" console errors.
- All five demos render their scripted replies; a "Simulated replay" badge is
  visible on every demo.

| File | What it shows |
| --- | --- |
| `fanout_before.png` | Landing fan-out wall before clicking Broadcast |
| `fanout_after.png` | After Broadcast — alice/bob/carol all replied, "3 of 3 listeners replied", Simulated replay badge |
| `fanout-broadcast.gif` | The one→three fork animation + lanes lighting up |
| `pdtube_switchboard.png` | Playground switchboard — Concierge reply routed back to the tile |
| `pdtube_redgreen.png` | Red→green — suite wipes green, Mechanic diagnosis + unified diff |
| `pdtube_editor.png` | Editor lightbulb — Explainer explanation + diff |
| `pdtube_warroom.png` | War room — agent↔agent thread, provenance arrows, ROOT CAUSE banner |

The real daemon path is unchanged and still used for local dev / screenshots when
a daemon URL is signalled (explicit URL, `?daemon=<url>`, `VITE_PORT_DADDY_URL`,
or the embedded `/fleet-ui` console).
