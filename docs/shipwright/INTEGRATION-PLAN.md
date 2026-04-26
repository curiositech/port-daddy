# Shipwright UI Integration Plan

**Status:** Track 3b plan - 2026-04-26
**Consumes:** `COMPONENT-BRIEF.md`, `SHIP-GRAMMAR.md`, `FLEETCONTROL-HARDENING.md`
**Target app:** `fleet-config-ui/`

Shipwright UI work extends the existing Fleet Control Center. It does not create
a second dashboard, a new Vite app, or a FleetBar-only surface. The daemon already
serves `public/fleet-ui/`; `fleet-config-ui/` already builds there; FleetBar
already opens that control plane. Shipwright should add surfaces to that control
plane and compact projections to FleetBar.

## 1. Existing Shape To Preserve

Current `fleet-config-ui/src/App.tsx` is a Vite React single-page app with:

- global daemon URL selection in `src/api.ts`
- project selection keyed by durable `projectDir`
- top-level surfaces tracked by `?surface=flow|agents|activity|channels|inbox|sorties|memory|yaml`
- FleetBar embed mode tracked by `?embed=fleetbar` and the injected
  `window.__PORT_DADDY_EMBED`
- daemon-backed state in `useFleet()`, `useChannelLog()`, and focused API helpers
- build output to `../public/fleet-ui` through `fleet-config-ui/vite.config.ts`

Shipwright should reuse that shell. The first implementation should add a
`shipwright` surface and internal subviews rather than adding a router package.

## 2. Route And Surface Model

No new app. No separate `/dashboard`. The browser paths stay under
`/fleet-ui/`; view selection is query-param based until the control plane adopts a
real route layer everywhere.

| Desired product URL | Current SPA representation | Purpose |
|---|---|---|
| `/shipwright/harbor` | `/fleet-ui/?surface=shipwright&shipwright=harbor` | All-project harbor grid; one ship/card per survey |
| `/shipwright/focus/:project` | `/fleet-ui/?surface=shipwright&shipwright=focus&project=<projectDir>` | Focus mode for one project, proposal cards, editable envelope |
| `/shipwright/sim/:project` | `/fleet-ui/?surface=shipwright&shipwright=simulation&project=<projectDir>` | Simulation canvas and event replay |
| `/control` | `/fleet-ui/?surface=control&project=<projectDir>` | FleetControl panel: budget, bonds, violations, panic |
| `/ships/:identity` | `/fleet-ui/?surface=ship-debug&ship=<identity>` | Grammar/debug surface for one deterministic ship |

Implementation notes:

- `MainTab` grows `Shipwright` and `Control`, or Shipwright owns a subtab strip
  inside a single top-level `Shipwright` tab.
- Embedded FleetBar mode should deep-link to the same query params but hide
  duplicate shell chrome.
- Project changes must preserve the current Shipwright subview. Switching project
  in focus/simulation/control stays on that subview.

## 3. State Model

Use the existing lightweight hook pattern first. Do not add React Query or Zustand
until we have cache invalidation pressure that the current model cannot handle.

Initial Shipwright state lives in `fleet-config-ui/src/shipwright/`:

```ts
interface ShipwrightUiState {
  surveys: ProjectSurvey[];
  proposals: Record<string, ProposedFleet>;
  simulations: Record<string, SimulationState>;
  selectedProjectDir: string | null;
  selectedAgentId: string | null;
  selectedFilePath: string | null;
}
```

Recommended hooks:

- `useShipwrightSurveys(projectDir?)`
- `useShipwrightProposal(projectDir)`
- `useShipwrightSimulation(projectDir, simulationId?)`
- `useFleetControl(projectDir)` for wallets, bonds, panic, and budget guard

Keep local-only view state in component state:

- selected ship
- selected file
- simulation scrubber position
- right drawer open/closed
- prompt editing draft

Persist only meaningful user intent in the URL: top-level surface, subview,
project, selected ship/agent, and simulation id.

## 4. API Contract

Shipwright UI reads and writes through daemon routes. Stubs may exist for visual
work, but the real app must converge on this contract:

| Need | Method |
|---|---|
| Survey project(s) | `POST /shipwright/survey` then `GET /shipwright/survey?projectDir=` |
| Generate proposal | `POST /shipwright/propose` |
| Read proposal | `GET /shipwright/proposal?projectDir=` |
| Diff/apply proposal | `POST /shipwright/apply` with `diffOnly` or confirmed write |
| Start simulation | `POST /shipwright/simulate` |
| Stream simulation | `GET /shipwright/simulate/:id/events` as SSE |
| Chat | `GET /shipwright/chat?projectDir=` and `POST /shipwright/chat` |
| Wallets | existing `GET /wallets`, `GET /wallets/:project` |
| Bonds | existing `GET /bonds`, `GET /bonds/:id`, `POST /bonds/:id/slash` |
| Panic | existing `GET /fleet/panic`, `POST /fleet/panic`, `POST /fleet/unpanic` |
| Actor lifecycle | `/actors`, `/actors/:id`, and pub/sub `actor:lifecycle` |

Until `/shipwright/*` exists, UI development uses checked-in fixtures under
`fleet-config-ui/src/shipwright/fixtures/`. Fixtures must mirror this table and
carry a visible `fixture: true` flag so the production UI cannot pretend mock
data is daemon truth.

## 5. Realtime

Use SSE, not polling, for hot simulation and lifecycle surfaces.

Existing state:

- `subscribeFleetEvents()` and `subscribeActivity()` already wire fleet/activity
  streams.
- `useChannelLog()` polls channel history for page-level channel inspection.

Add:

- `subscribeShipwrightSimulation(simulationId, onEvent)`
- `subscribeActorLifecycle(onEvent)` over `actor:lifecycle`
- `subscribeBondLifecycle(onEvent)` over `bond:lifecycle`

Fallback polling is acceptable for low-rate wallet/bond summaries, but
`SimulationCanvas` must not poll. The canvas is an event playback surface.

## 6. Tokens And Styling

Do not introduce a third token language.

Near-term:

- Shipwright components use existing Fleet UI CSS variables from
  `fleet-config-ui/src/index.css`.
- Any Swiss/neobrutalist hardening needed by Shipwright lands as semantic
  variables there first, then components consume `var(--pd-*)`.
- No component-level hex literals except inside the pure ship grammar and dither
  palette constants, where the spec intentionally freezes the five-color
  quantization palette.

Medium-term:

- Extract the shared Port Daddy token contract from `website-v2/src/styles/` into
  a small shared source file or generated CSS artifact.
- `website-v2` and `fleet-config-ui` both import generated role/source/semantic
  layers rather than hand-copying values.
- Build fails if role tokens drift without updating the generated artifact.

Do not symlink app source directories. Symlinks are brittle under Vite, editors,
and published package boundaries. Prefer generated CSS or a tiny local package.

## 7. Component Placement

Current Track 3a scaffold lives under `fleet-config-ui/src/ships/`:

- `ship-grammar.ts`
- `AgentShip.tsx`
- `FleetStage.tsx`
- `DitherPipeline.tsx`
- `AgentCardThumbnail.tsx`
- `SnapshotWorkerClient.tsx`

Next UI modules should live under:

- `fleet-config-ui/src/shipwright/api.ts`
- `fleet-config-ui/src/shipwright/types.ts`
- `fleet-config-ui/src/shipwright/fixtures.ts`
- `fleet-config-ui/src/shipwright/ShipwrightPanel.tsx`
- `fleet-config-ui/src/shipwright/HarborView.tsx`
- `fleet-config-ui/src/shipwright/FocusView.tsx`
- `fleet-config-ui/src/shipwright/SimulationView.tsx`
- `fleet-config-ui/src/shipwright/FleetControlView.tsx`

Keep `src/ships/` generic. It should know how ships render, not what Shipwright
surveys or proposals mean.

## 8. FleetBar Boundary

FleetBar stays compact and HTTP-first:

- no bundled WebGL
- no R3F canvas inside the native popover
- no separate data model
- use `SnapshotWorkerClient` or deterministic SVG thumbnails
- deep-link into `/fleet-ui/?embed=fleetbar&surface=shipwright&...`

FleetBar compact should show:

- top 3 active projects with ship thumbnails
- current budget/bond status
- latest simulation/proposal result
- one action: open the full control plane

Approval, panic, and apply flows can be visible in FleetBar only after the daemon
enforces the same confirmation and bond semantics through HTTP.

## 9. Build And Deploy

The existing build path stays:

```bash
cd fleet-config-ui
npm run lint
npm run build
```

`npm run build` writes to `public/fleet-ui/`. Source slices should not commit that
generated output unless the task is explicitly a runtime promotion/control-plane
bundle update. Generated output is promotion material, not design-source truth.

Before claiming a UI slice done:

- `npm run lint` in `fleet-config-ui`
- `npm run build` in `fleet-config-ui`
- focused unit tests for pure modules, such as `tests/unit/ship-grammar.test.ts`
- browser screenshot for new visible surfaces once a route renders real UI
- no new hardcoded daemon URL literals in enforced paths

## 10. Implementation Order

1. **Track 3a scaffold** - complete enough to continue: ship grammar, SVG
   fallback contracts, snapshot client boundary, focused grammar tests.
2. **Track 3b integration shell** - this document, plus route/surface decisions.
3. **Shipwright API client and fixtures** - add typed helpers and fixture data
   matching the future `/shipwright/*` daemon contract.
4. **Harbor view** - survey cards using `AgentCardThumbnail` in SVG mode.
5. **Focus view** - proposal cards, model tier selector, cost/bond envelope.
6. **FleetControl view** - consume existing wallets/bonds/panic routes before any
   simulation canvas work.
7. **Simulation view** - event playback with fixture stream first, SSE stream
   second.
8. **R3F renderer** - introduce Three/R3F only after SVG surfaces are useful and
   tested.
9. **Snapshot worker** - headless rendering for FleetBar/unfurls.

## 11. Open Questions

- Should `surface=control` be a top-level tab, or should control live inside
  `surface=shipwright&shipwright=control` until non-Shipwright fleets need it?
- Does `/shipwright/survey` store survey files in the project worktree, daemon DB,
  or both?
- Does proposal application write `pd-fleet.yml` directly or open a merge-queue
  entry first?
- Which daemon channel name is canonical for bond lifecycle events:
  `bond:lifecycle`, `bonds:lifecycle`, or actor-scoped events from
  `daemon:fleetcontrol`?

None of these block the next implementation slice; they define the review points
before the UI graduates from fixtures to live daemon data.
