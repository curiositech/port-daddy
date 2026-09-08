# Visual artifacts — Porthole player (landing page terminal demos)

Captured headless via Playwright against a local `vite --port 5183` dev
server serving the production build, with the local `pd` daemon live so
`/casts/porthole/*.cast` resolve exactly as they do in production (the
casts are static files; no daemon calls happen at render time).

| File | Shows |
|---|---|
| `section-light.png` | The `#demos` section, light theme, "No Collisions" cast mid-playback (`pd begin "apply schema migration..."`). |
| `section-dark.png` | Same section, dark theme, same cast/position — confirms the terminal chrome intentionally stays near-black in both page themes (matches `CodeBlock`/`TerminalGif` convention) while the surrounding page and tab rail follow the theme toggle. |
| `tab-collision.png` | "No Collisions" tab active, tight terminal crop. |
| `tab-visibility.png` | "Catch Up Instantly" tab active. |
| `tab-ports.png` | "No Port Fights" tab active. |
| `tab-recovery.png` | "Nothing Lost" tab active. |
| `tab-quickstart.png` | "First Contact" tab active. |
| `demo-playback.webm` | ~10.5s screen recording: page load → "No Collisions" plays for ~3.5s → click "Catch Up Instantly" tab, plays ~3.5s → click "No Port Fights" tab, plays ~3.5s. Shows real tab switching, real playback (not a static frame), and the provenance strip (`SOURCE` / `CAPTURED` / `EVENTS` / `FIDELITY`) updating per cast. |

Theme toggled via `localStorage['pd-theme']` set through `page.addInitScript`
(the real persistence key read by `website-v2/src/lib/theme.tsx`), not a
guessed key.
