# Shipwright — Docs Index

**What this folder is:** the full spec for Shipwright (the agent),
FleetControl (the enforcement), and the Plane (the virtual-actor platform
every Port Daddy agent lives on). Plus mocks and a static preview you can
open in any browser.

**What this folder is NOT:** production code. Every file here is a promise;
the code lands per the staging order in `SHIPWRIGHT-DESIGN.md §15`.

## Files

### Specs

| File | Purpose |
|---|---|
| `BONDED-COMMONS-PATCHES.md` | **Patch set** (not a standalone paper) for `agent-transactions-whitepaper.tex`. Five scoped edits: (P1) Conservation Theorem proved from `lib/bonds.ts`, (P2) cuckoo-filter revocation protocol for Anchor §2, (P3) Merkle Forest + inclusion proofs extending Bonded Commons §4, (P4) federated-sovereign replacement for the "single-node scope" paragraph in §7, with the KMS specified by abstract properties (not vendor), (P5) pricing: cleanup lower bound + scope multiplier + reputation discount + the **Bonded Advisor** mechanism (which absorbs the Shipwright idea as a mechanism, not a new layer). Self-critical: retracts earlier "fourth layer" framing, drops Cloudflare from theory text, drops the hybrid-filter hedge. Cites Fan 2014, Bloom 1970, Laurie 2013, Shamir 1979, Klein 1998. |
| `SHIPWRIGHT-DESIGN.md` | Master product spec. Vision, CLI contract, survey/propose/simulate engines, UI surfaces, bond/commons framing, Shipwright's own prompt, staging order. |
| `AGENT-MODEL.md` | **The Plane.** Unified virtual-actor runtime for every Port Daddy agent (not just Shipwright). Soul/body duality, mapping of existing primitives, 7 archetypes, zero-break migration plan. Read this before SHIPWRIGHT-DAEMON. |
| `SHIP-GRAMMAR.md` | Ship grammar: identity → `ShipPlan`. Color palette, sigils, trim, scale drift (864 signatures), reference TS impl, R3F + dither + water rendering, snapshot worker (PNG/GIF/APNG). |
| `FLEETCONTROL-HARDENING.md` | Track 1 tech spec. Bond escrow state machine (TLA+ sketch), SQLite schema, module surface, kill-switch pipeline, test matrix. |
| `SHIPWRIGHT-DAEMON.md` | The Shipwright *archetype* — one archetype among seven defined in AGENT-MODEL. DSPy prompt, Klein RPD episodic memory, simulation engine, chat. |
| `COMPONENT-BRIEF.md` | Component contracts (14 React components + R3F suite). Used by 21st.dev MCP + humans. |
| `INTEGRATION-PLAN.md` | Track 3b plan for extending `fleet-config-ui/` instead of creating a second dashboard: surfaces, query routes, state, API, realtime, FleetBar, build/deploy boundaries. |

### Preview — open in a browser

| File | Purpose |
|---|---|
| `preview/index.html` | Component showcase. Token swatches, ship grammar walkthrough, harbor grid, proposal cards with purpose + controls, FleetControl panel, spark-drift demo, motion grammar. Pure HTML + inline SVG — no build step. |
| `preview/ships-3d.html` | Live 3D ships via Three.js (CDN). Three ships on a water plane with vertex-displacement waves, click-to-select emissive. v0 without dither; see `COMPONENT-BRIEF §R3F` for the full BloomPass + DitherEffect pipeline. |
| `preview/buildShip.js` | Browser-side port of `lib/ship-grammar.ts`. Same grammar, same invariants. Fed by both HTML pages. |

> **Running the preview**: to load the ES module + Three.js CDN imports
> cleanly, serve the folder with any static server:
> `npx serve docs/shipwright/preview` or
> `python3 -m http.server 8000 -d docs/shipwright/preview`, then visit
> `/index.html`. Opening via `file://` usually works but some browsers
> block module fetches.

### Mocks (SVG, standalone)

| File | Purpose |
|---|---|
| `mocks/01-harbor-view.svg` | Default screen — ships as data marks in a Tufte grid. |
| `mocks/02-focus-mode.svg` | Focus on one project — command block + proposal cards (purpose + grammar ships). |
| `mocks/03-simulation-canvas.svg` | Mid-sim — live ships, file-tree glow, cost sparklines. |
| `mocks/04-fleetcontrol-panel.svg` | The cockpit — global controls, slabs, agent roster with row controls, audit log, kill switch. |
| `mocks/05-shipwright-chat.svg` | Right drawer — maritime voices, tool-call blocks, re-simulate CTA. |

| `NEXT-SESSION-PROMPTS.md` | **Ready-to-paste prompts for every follow-up track.** 9 tracks + parallelization map + LAN multi-machine design + "make PD sticky" techniques. The operational capture of the 2026-04-{18..20} session's unfinished work. Read this before opening a new session. |
| `MESH-COORDINATION.md` | T0 LAN + T1 cross-network (Iroh) + T2 phone viewer + Tailscale escape. Addendum: Float-Plan-mediated remote execution (see §12 of NEXT-SESSION-PROMPTS for the full design). |
| `SECURITY-ASSESSMENT.md` | F-01..F-09 findings, fixed + open, with prioritized follow-ups. Covers same-user-process threat model. |

## How to read this in order

1. `SHIPWRIGHT-DESIGN.md` — 15 sections, the product narrative.
2. `AGENT-MODEL.md` — the Plane. Why every agent, not just Shipwright,
   lives here.
3. `SHIP-GRAMMAR.md` — what ships look like + how they're built.
4. `FLEETCONTROL-HARDENING.md` — the load-bearing work that lands first.
5. `SHIPWRIGHT-DAEMON.md` — the archetype, with the runtime moved to AGENT-MODEL.
6. `COMPONENT-BRIEF.md` — once the above is agreed.
7. `INTEGRATION-PLAN.md` — how the component contracts enter Fleet Control Center.
8. `preview/index.html` — see the whole thing. Then `ships-3d.html` for live motion.

## Skills used to author this

- `always-on-agent-architecture`, `agha-actor-model` — the Plane
- `hoare-1978-csp`, `bdi-agency-model`, `rao-georgeff-1991-modeling-rational-agents-bdi` — daemon alternatives we considered and declined
- `fipa-00037-communicative-act-library` — message vocabulary
- `klein-1998-sources-of-power` — RPD reasoning in Shipwright
- `park-2023-generative-agents` — episodic memory
- `khattab-2023-dspy` — structured Shipwright prompt
- `ostrom-commons-governance` — bond/slash/commons
- `tlaplus-practitioner` — bond escrow invariants
- `agentic-zero-trust-security` — bond/slash security semantics
- `swiss-modern-website-design`, `neobrutalist-web-designer` — the UI language
- `data-viz-2025` + Tufte discipline — charts, small multiples
- `design-accessibility-auditor` — a11y requirements (WCAG 2.2, reduced-motion)
- `animation-system-architect` — motion grammar (≤260ms, signal not decoration)
- `design-system-creator` — token hygiene with existing `website-v2/src/styles/tokens.css`
- `vitest-testing-patterns` — test matrix
- `high-quality-vibe-coding` — the discipline layer

## Open questions

See `SHIPWRIGHT-DESIGN.md §14` and `AGENT-MODEL §10`. None block PR #1.

## Standing rules enforced in this folder

- **No keyword-based NLP.** Skill retrieval from `~/coding/wrkgroup-ai`
  is embeddings-only (Voyage, cosine, cached in
  `~/.port-daddy/skill-index.sqlite`).
- **No emojis as icons.** Ships render as 3D voxels or 2D SVG stand-ins
  from the grammar; sigils are pure geometry.
- **All code teaches.** Every component/module docstring explains
  why-not-what, names the failure mode, cites the skill/principle, and
  carries a runnable `@example`.
- **Shipwright isn't special.** It's one archetype among seven. Every
  agent in Port Daddy — human, shell script, fleet cron, daemon-internal
  — gets the same actor runtime.

---

*Last updated 2026-04-19. Maintained by the archivist agent after each
landed PR.*
