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
| `https://media.portdaddy.dev/sha256/fe/fe37e662722231ff84757b99a9eb578a0187fd9fe560659f36d88851aca53202.png` | Landing fan-out wall before clicking Broadcast |
| `https://media.portdaddy.dev/sha256/56/56543933cc2a484830d784c8abfc64e2f350cf7ea961933162eb82fa3ddb5966.png` | After Broadcast — alice/bob/carol all replied, "3 of 3 listeners replied", Simulated replay badge |
| `https://media.portdaddy.dev/sha256/96/9603e9a1d19e57514f9e67466b54d9a65f40ee11766ffdc97f6c1c76c4654d23.gif` | The one→three fork animation + lanes lighting up |
| `https://media.portdaddy.dev/sha256/00/0082bb829bfed7a3251d39524241de9681b18fd8b8ed4c9efa172bd7e83d9af8.png` | Playground switchboard — Concierge reply routed back to the tile |
| `https://media.portdaddy.dev/sha256/f0/f0db6171b01401a9fbe825fac40df6462e80cc8686df2c75a8d5254598f9a501.png` | Red→green — suite wipes green, Mechanic diagnosis + unified diff |
| `https://media.portdaddy.dev/sha256/53/539d92ab6b1a381b54d2798138467ecb4c31668ff54a98f6e65c4cb601d70544.png` | Editor lightbulb — Explainer explanation + diff |
| `https://media.portdaddy.dev/sha256/ce/ce82df7606971a6eced07e15cb203d9e43580bfc3851dc556f795ba1d137fa90.png` | War room — agent↔agent thread, provenance arrows, ROOT CAUSE banner |

The real daemon path is unchanged and still used for local dev / screenshots when
a daemon URL is signalled (explicit URL, `?daemon=<url>`, `VITE_PORT_DADDY_URL`,
or the embedded `/fleet-ui` console).
