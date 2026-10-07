# Visual artifacts — Porthole player (landing page terminal demos)

Captured headless via Playwright against a local `vite --port 5183` dev
server serving the production build, with the local `pd` daemon live so
`/casts/porthole/*.cast` resolve exactly as they do in production (the
casts are static files; no daemon calls happen at render time).

| File | Shows |
|---|---|
| `https://media.portdaddy.dev/sha256/3b/3ba3221877d51b4230011a61e98973aae9a5a05d453247cc44e66d35484c2acd.png` | The `#demos` section, light theme, "No Collisions" cast mid-playback (`pd begin "apply schema migration..."`). |
| `https://media.portdaddy.dev/sha256/ac/acb2d401a42fe145e310f40fc99ce3921a448d37406c2477feb6aebf90463350.png` | Same section, dark theme, same cast/position — confirms the terminal chrome intentionally stays near-black in both page themes (matches `CodeBlock`/`TerminalGif` convention) while the surrounding page and tab rail follow the theme toggle. |
| `https://media.portdaddy.dev/sha256/b9/b9275538f657d93ba839bb61177102f326f1fb167487106ba6909f476f5303a0.png` | "No Collisions" tab active, tight terminal crop. |
| `https://media.portdaddy.dev/sha256/bd/bdc2be39e61847913b550022ccee1c081ae1c49a1965a2e3ab7460081f8fff4f.png` | "Catch Up Instantly" tab active. |
| `https://media.portdaddy.dev/sha256/3f/3fb7cc7c4752bebd57412aa8d537d15431cd0d25a34419c7135dfa6bb3d2b65c.png` | "No Port Fights" tab active. |
| `https://media.portdaddy.dev/sha256/f0/f07cfd04158e9469df30649fb49ba49b425d61c48e59accf6715872d4da785d8.png` | "Nothing Lost" tab active. |
| `https://media.portdaddy.dev/sha256/ff/ffe29fa37a21a13d42321555772423d05342fecec2b1feaa4c4d75c03e581dcb.png` | "First Contact" tab active. |
| `https://media.portdaddy.dev/sha256/5e/5e1a9654fe79ed224a9ef2cf6851c6f46239156a3d2f8f0f37f8012c31d618fc.webm` | ~10.5s screen recording: page load → "No Collisions" plays for ~3.5s → click "Catch Up Instantly" tab, plays ~3.5s → click "No Port Fights" tab, plays ~3.5s. Shows real tab switching, real playback (not a static frame), and the provenance strip (`SOURCE` / `CAPTURED` / `EVENTS` / `FIDELITY`) updating per cast. |

Theme toggled via `localStorage['pd-theme']` set through `page.addInitScript`
(the real persistence key read by `website-v2/src/lib/theme.tsx`), not a
guessed key.
