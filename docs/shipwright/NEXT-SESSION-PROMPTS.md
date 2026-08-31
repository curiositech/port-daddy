# NEXT-SESSION-PROMPTS · pick a track, open a session, ship

> *"Wow big session."* — yes. This is the capture.

**What this doc is.** Every follow-up from the 2026-04-{18..20} Shipwright/FleetControl/Security session, organized as **ready-to-paste prompts** for the next Claude/Codex session. Each track is self-contained: quote the prompt, open a session, ship. Tracks marked **⚡ PARALLEL** can be worked concurrently (different files, no shared state). Tracks marked **🔗 SERIAL** depend on another track being done first.

**What this doc is not.** A progress log. A priority ranking (you pick). A roadmap for v5. It's operational: "here's what's on the stack; here's how to work it."

**Standing rules, inviolable.**
1. **Use Port Daddy aggressively while building.** See §0 — every session opens with `pd begin`, emits pheromones, leaves tuples, ends with `pd done`. Not scaffolding; the product.
2. **Teachable code.** Every new file ships with module docstring (why-not-what), `@example` on every export, inline comments citing the principle/failure-mode it prevents.
3. **Zero test regressions.** 4543+ unit tests currently green. Keep them there.
4. **Parity surfaces.** CLAUDE.md §"Command Parity Matrix" lists 11 surfaces. Any new feature lands across all of them before merge.
5. **Stable promotion after substantial work.** `./scripts/promote-stable.sh` before calling a track done.

**How to read the map.** §0 is the opening every session uses. §1–§9 are the tracks. §10 is the parallelization map. §11 is the "make PD sticky" techniques that make every future agent want to use it. §12 is the LAN multi-machine story that the user specifically asked about — read that BEFORE Track 6 mesh.

---

## §0 The Port Daddy Opening (copy into every session, top)

Every new session begins with this handshake. It's ~20 seconds of shell and makes you legible to the rest of the fleet.

```bash
# Before touching code:
pd status                                           # daemon alive? (pd start if not)
pd whoami                                           # who am I in this slot?
pd look --since 120                                 # 2h sitrep synthesis (activity+notes+salvage+spawns)
pd look --heat                                      # file heat map — where is the contention?
pd ideas search "<topic>"                           # canonical trove + tuples + notes + markdown
pd tuple rd '["session:live"]' --harbor fleet       # who else is live

# Establish identity + session (mandatory for any task that edits code):
pd begin "<what I'm doing, one sentence, future-me will thank you>" \
         --identity port-daddy:<stack>:<task-slug>

# For each file you're about to edit:
pd session files add <path> [<path>...]             # claim files in active session

# As you go — one verb, one call, many fan-outs:
pd say "<observation / decision / finding>"                      # note only (audit trail)
pd say "fixed bug in <path>" --pin --heat <path>=0.7             # note + tuple + pheromone
pd say "build broken" --broadcast alerts                         # note + pub/sub

# When you finish:
pd done --summary "<one-sentence result>"
```

**If the daemon is down:** `pd start` then `pd status` to confirm. It should always be running as a launchd service.

**If no harbor exists:** `pd harbor create port-daddy:fleet` once, then everyone uses it.

**Why this is mandatory for edit tasks:**
- Salvage: if your process crashes, the next agent reads your notes and picks up where you left off. Without a session, your work is unrecoverable.
- Reputation: your bond history accrues. Skipping sessions means zero rep, which means bigger bonds required for future sensitive work.
- Coordination: other agents see your file claims and avoid stepping on you. Without claims, they merge-conflict you.
- Stigmergy: your pheromones tell the next agent "this file was hot — check it before you edit."

**Exceptions (no session needed):**
- 30-second reads (browsing docs, running `ls`, answering a question without touching anything).
- Running pure observation commands (`pd status`, `pd agents`).

If in doubt: run `pd begin`. The overhead is seconds; the coordination value is hours.

---

## §1 TRACK 1b — Wire bonds + budget-guard into server.ts [🔗 SERIAL root]

**Status:** spec complete (`FLEETCONTROL-HARDENING.md`); modules shipped (`lib/bonds.ts`, `lib/budget-guard.ts`, tests green); **not wired into the daemon**. No HTTP routes, no CLI, no dashboard integration. The code is ready; the exposure is missing.

**Dependencies:** None — all modules exist.
**Unblocks:** Track 3 (UI consumes routes), Track 6 (mesh can use bonds for remote work), Track 7 (phone viewer shows bond state).

### Prompt

> (Port Daddy Opening per §0. Identity: `port-daddy:api:track1b-bonds-wiring`. Purpose: "Expose bonds + budget-guard via HTTP / CLI / MCP / completions.")
>
> **Read first:**
> - `docs/shipwright/FLEETCONTROL-HARDENING.md` — full spec, API table in §8
> - `lib/bonds.ts` — note the `BondsDeps { harbors?, noteEncryption?, broadcast? }` shape
> - `lib/budget-guard.ts` — `BudgetGuardDeps { broadcast? }`
> - `server.ts` — module composition pattern around lines 240–280 (where `createSessions`, `createAgents`, etc. are wired)
> - `routes/index.ts` — the `FastifyPluginAsync<{ deps }>` pattern
> - `routes/sessions.ts` or `routes/bonds.ts` (does not exist yet — use `routes/tuples.ts` or `routes/harbors.ts` as pattern)
> - `features.manifest.json` — parity source of truth
>
> **Do, in order:**
>
> 1. **Compose the modules in `server.ts`.**
>    ```ts
>    const bonds = createBonds(db, {
>      harbors,
>      noteEncryption,
>      broadcast: (channel, event) => messaging.publish(channel, event),
>    });
>    const budgetGuard = createBudgetGuard(db, {
>      throttleThreshold: 0.80,
>      killThreshold: 1.00,
>    }, {
>      broadcast: (channel, event) => messaging.publish(channel, event),
>    });
>    ```
>    Plumb into `ROUTE_DEPS` for route registration.
>
> 2. **Write `routes/bonds.ts`.** Endpoints (from `FLEETCONTROL-HARDENING.md §8`):
>    - `GET  /bonds` (filter: project, state)
>    - `GET  /bonds/:id`
>    - `POST /bonds/:id/slash` (operator-authorized; audit log entry)
>    - `GET  /wallets`
>    - `GET  /wallets/:project`
>    - `POST /wallets/:project/top-up` (body: `{ usd }`)
>    - `GET  /fleet/panic` (returns `{ armed, reason? }`)
>    - `POST /fleet/panic` (body: `{ reason }`, 2-step: first POST arms, second confirms)
>    - `POST /fleet/unpanic`
>
> 3. **CLI commands** in `cli/commands/`:
>    - `pd wallet show <project>`
>    - `pd wallet top-up <project> --usd 20`
>    - `pd wallet history <project> [--since 7d]`
>    - `pd bond list [--project P] [--state escrowed|running|slashed|refunded]`
>    - `pd bond slash <id> --portion 0.5 --reason <text> [--yes]`
>    - `pd fleet panic [--reason <text>]`
>    - `pd fleet unpanic --reason <text>`
>
> 4. **SDK methods** in `lib/client.ts` with typed response interfaces.
>
> 5. **Completions**: bash + zsh + fish. All three. Fish is always the worst — triple-check.
>
> 6. **Integration tests** in `tests/integration/`:
>    - `bonds-wiring.integration.test.js` — escrow → spawn → cost-tracker.record → budget-guard.onCharge at 80% → throttle broadcast observed. Then 100% → kill → SIGTERM observed → bond slashed → arbiter violation recorded.
>    - `fleet-panic.integration.test.js` — two running spawns → POST /fleet/panic → both SIGTERM within 6s → bonds refunded (panic is operator action, not misbehavior) → arbiter records.
>
> 7. **features.manifest.json + CLAUDE.md + README + CHANGELOG.** Update all four.
>
> 8. **Promote stable** when green: `./scripts/promote-stable.sh`.
>
> **Acceptance:**
> - 4543+ unit tests + new integration tests all green.
> - `pd wallet show port-daddy` works from a fresh clone.
> - Dashboard still shows what it showed before (we add a FleetControl panel in Track 3, but don't break existing).
> - Budget-kill integration test shows a SIGTERM within 5s of the 100% crossing.
>
> **Port Daddy stickiness while you work:**
> - Pheromone-spray `server.ts`, `routes/bonds.ts`, `lib/client.ts` each edit (0.6 strength).
> - Tuple: `pd tuple out '["bonds-wiring-progress",{"stage":"routes","pct":60}]' --harbor port-daddy:fleet` between stages.
> - `pd note` each decision you make about which error shape to return.
> - Call `pd catch_me_up` before each major step so you absorb any parallel changes from Track 3 or Track 4.

### Parallel breakdown

- Routes + CLI can be one branch.
- SDK + completions can be one branch (depends only on the route shapes being settled).
- Integration tests can be one branch (depends on routes).

Three worktrees, three agents. Merge order: routes → SDK → tests.

---

## §2 TRACK 2 — Shipwright daemon code (actor runtime + archetypes) [⚡ MASSIVELY PARALLEL after runtime]

**Status:** architecture fully specced (`AGENT-MODEL.md`, `SHIPWRIGHT-DAEMON.md`); zero code written.

**Dependencies:** Only internal (runtime → archetypes). Track 1b helpful but not required.

### Prompt (sub-track 2a — the runtime)

> (Port Daddy Opening. Identity: `port-daddy:daemon:actor-runtime`. Purpose: "Ship lib/actors.ts — the Plane runtime described in AGENT-MODEL.md.")
>
> **Read first:**
> - `docs/shipwright/AGENT-MODEL.md` (the full Plane spec; mapping table in §2 lists existing modules the runtime WRAPS, not replaces)
> - `lib/agents.ts` — registry, heartbeats, identity columns
> - `lib/agent-inbox.ts` — the mailbox substrate
> - `lib/sessions.ts` — state substrate
> - `lib/messaging.ts` — pub/sub transport
> - `lib/resurrection.ts` — supervision-adjacent
>
> **Do:**
> 1. `lib/actors.ts` (~250 lines):
>    - Interfaces: `ActorIdentity`, `ActorMessage`, `ActorRef`, `ActorBehavior<S>`, `ActorContext`.
>    - Registry: `registerArchetype(behavior)`, keyed by archetype name.
>    - Activation: route inbox message → behavior's `receive(state, msg, ctx)` → persist next state.
>    - Deactivation: idle >10min → unload behavior, state stays.
>    - Supervision: throwing handler → salvage queue + optional bond slash.
>    - Pub/sub on `actor:lifecycle` for observability.
>
> 2. Tests in `tests/unit/actors.test.js`:
>    - Activation on first message, deactivation after idle.
>    - Supervision: crashing behavior routes to salvage queue.
>    - Rehydration: kill + recreate keeps state.
>    - Multiple archetypes coexist.
>
> 3. Routes `/actors`, `/actors/:id`, `/actors/:id/message` in `routes/actors.ts`.
>
> **Stickiness hooks:** the runtime IS the stickiness mechanism for future agents. Every future Track 2 sub-track inherits it. Make it observable — every message emits on pub/sub, every state transition appends to the activity log.

### Prompt (sub-track 2b — skill-index) [⚡ PARALLEL with 2a]

> (Opening. Identity: `port-daddy:daemon:skill-index`. Purpose: "Embeddings-backed skill retrieval for Shipwright and any agent that needs to route work to skills.")
>
> **Do:**
> 1. `lib/skill-index.ts`: walk `~/coding/wrkgroup-ai/skills/*/SKILL.md`, embed frontmatter+intro via Voyage AI (`voyage-3-lite`, cheap), cache L2-normalized floats in `~/.port-daddy/skill-index.sqlite`. Top-K cosine search. NEVER keyword matching.
> 2. Nightly re-embed on `~/coding/wrkgroup-ai/.git/HEAD` change (use `chokidar` or a cron actor).
> 3. Fall-back: OpenAI `text-embedding-3-small` when Voyage unavailable.
> 4. Tests: pure-function cosine on fixture embeddings; no live API calls.
> 5. Expose as daemon-internal actor `daemon:skill-index` with `skill.search` message kind.

### Prompt (sub-track 2c — archetypes) [⚡ PARALLEL, 5–7 worktrees]

> (Opening. Identity: `port-daddy:daemon:archetype-<name>`. Purpose: "Ship the <name> archetype.")
>
> Each archetype is ~50–120 lines. Ship in parallel: one per worktree, one per agent. Merge order doesn't matter.
>
> Required: `lib/archetypes/shipwright.ts` (needs 2a + 2b).
> Parallel: `sentinel.ts`, `sweeper.ts`, `scribe.ts`, `hawk.ts`, `spark.ts`, `sentry.ts`, `gardener.ts`.
>
> Each archetype exports an `ActorBehavior<State>` with:
> - `archetype` name
> - `initial(identity)` — initial belief state
> - `receive(state, msg, ctx)` — message handler
>
> Archetype-specific prompts (the ones Shipwright edits): `prompts/archetypes/<name>.md`. Users edit these; code reads them at runtime.
>
> Tests: spawn the archetype with mock ctx, feed it messages, assert state transitions. Archetype-level, not integration.

---

## §3 TRACK 3 — Shipwright UI (R3F + fleet-config-ui integration) [🔗 SERIAL on Track 1b routes]

**Status:** mocks shipped (`docs/shipwright/mocks/*.svg`, `preview/index.html`, `preview/ships-3d.html`); component contracts partially specced (`COMPONENT-BRIEF.md` — 14 components with props); **R3F suite not specced, INTEGRATION-PLAN not written**.

**Dependencies:** Track 1b for bonds/wallet routes the panel consumes. Track 2 for live actor state (can stub initially).

### Prompt (sub-track 3a — R3F component suite)

> (Opening. Identity: `port-daddy:ui:r3f-suite`. Purpose: "Write the R3F component contracts into COMPONENT-BRIEF.md and scaffold them in fleet-config-ui/.")
>
> **Read:**
> - `docs/shipwright/SHIP-GRAMMAR.md` §6 (rendering stack) and §7 (reference impl)
> - `docs/shipwright/preview/buildShip.js` (the JS grammar)
> - `docs/shipwright/preview/ships-3d.html` (vanilla Three.js demo — the R3F version mirrors this structure)
> - `docs/shipwright/COMPONENT-BRIEF.md` (existing contracts — add R3F as a NEW section at the end, don't clobber)
>
> **Component contracts to author + scaffold:**
>
> 1. **`<AgentShip identity status selected />`**
>    - Reads `buildShip(identity)`, walks the `ShipPlan` into `<mesh><boxGeometry/><meshStandardMaterial/></mesh>` for each block (mainframe, prow, core, clusters, towers, nacelles, trim, sigil).
>    - `useFrame` drives sine-wave bob (`position.y = sin(t*2+phase)*0.1`) + cosine roll.
>    - Selection: `meshStandardMaterial.emissive` lerps to `metrics.colorPrimary`, `emissiveIntensity` lerps to 2.0 over 200ms.
>    - States: `running | idle | throttled | selected | unselected | ghost | slashed | mayday` — each a material property tweak.
>    - Reduced-motion: bob disabled, selection snaps.
>    - Props doc with `@example`.
>
> 2. **`<FleetStage />`**
>    - Subdivided `planeGeometry(240, 240, 64, 64)` rotated to horizontal.
>    - Custom `ShaderMaterial` with `uTime` uniform; vertex shader: low-freq sum of two sines on Y-axis (`sin(x*0.08 + t*0.6)*0.35 + cos(z*0.11 + t*0.45)*0.25`); fragment: pale blue-gray with slight elevation shade.
>    - OrthographicCamera at 30° elevation (so pixel-accurate dither later).
>    - Low-key ambient + directional light.
>
> 3. **`<DitherPipeline palette />`**
>    - `<EffectComposer>` with `<BloomPass>` (picks up emissive) then `<DitherEffect>` (custom `ShaderPass`).
>    - DitherEffect: 8×8 Bayer threshold matrix; per-fragment, find closest palette color; quantize. Palette default `['#f2eee6','#121212','#bf2f2f','#0055ff','#dfff00']`.
>    - Bloom BEFORE dither so the halo gets chunked into stipples (that's the retro-glow trick).
>    - Version the shader so we can rev without breaking caches.
>
> 4. **`<AgentCardThumbnail identities[] />`**
>    - ONE shared `<Canvas frameloop="demand">` rendering N ships at tiny scale in a row.
>    - Re-renders only on `identities` change or selection change.
>    - Avoids N WebGL contexts (which would hit the 16-context browser limit at scale).
>    - Alternative implementation: static SVG stand-ins from `renderShipSVG` (from `preview/buildShip.js`) for zero-GPU path; pick via `<AgentCardThumbnail mode="svg|r3f"/>` prop.
>
> 5. **`<SnapshotWorkerClient identity state size mode />`**
>    - Thin React hook + component: `POST https://snap.portdaddy.dev/shipwright/snapshot` with `{identity, state, size, mode:"gif"|"png"|"apng"}`.
>    - Returns `<img src={objectUrl}/>`. Used in FleetBar compact, Slack unfurls, OG images — wherever WebGL isn't available.
>    - Server-side impl (another track) renders R3F headlessly via Playwright + gifsicle.
>
> **Scaffold:** create `fleet-config-ui/src/ships/` directory with stub files for each component (no implementation yet — just contracts + prop types + docstrings + one smoke test). Production impl lands in sub-track 3c.

### Prompt (sub-track 3b — INTEGRATION-PLAN.md)

> (Opening. Identity: `port-daddy:ui:integration-plan`.)
>
> Write `docs/shipwright/INTEGRATION-PLAN.md`:
> - Which existing React app to extend (spoiler: `fleet-config-ui/`, not a new app).
> - How tokens flow (copy `website-v2/src/styles/tokens.css` → `fleet-config-ui/src/styles/` at build time? Or symlink? Or package as a tiny shared module?).
> - Route table: `/shipwright/harbor`, `/shipwright/focus/:project`, `/control`, `/ships/:identity` (debug).
> - State management (React Query / SWR for API; Zustand for local UI state).
> - WebSocket subscription to `actor:lifecycle` and `bond:lifecycle` channels for real-time updates.
> - FleetBar (SwiftUI macOS app) stays on HTTP — no bundling, no WebGL; uses snapshot worker for ship images.
> - Build + deploy story (`fleet-config-ui` already builds to `public/fleet-ui/`; the existing workflow stays).

### Prompt (sub-track 3c — actually build the UI) [🔗 SERIAL on 3a + 3b + Track 1b]

> Biggest sub-track. Split further if useful. Build order matches `COMPONENT-BRIEF.md §"Build order"` — ShipGlyph → ShipCard → HarborGrid → ModelTierSelector → CostBreakdownPanel → SimulationCanvas → ShipwrightChat → FleetControlPanel → FleetBar compact.

---

## §4 TRACK 4 — Apply `BONDED-COMMONS-PATCHES.md` to the LaTeX whitepaper [⚡ FULLY PARALLEL, doc-only]

**Status:** patch set specced, not applied.

**Prompt:**

> (Opening. Identity: `port-daddy:paper:bonded-commons-patches`. Purpose: "Merge P1..P5 from BONDED-COMMONS-PATCHES.md into the canonical LaTeX source. Delete the patch set doc afterward.")
>
> **Read:**
> - `docs/shipwright/BONDED-COMMONS-PATCHES.md` (the patches)
> - `whitepaper/source/agent-transactions-whitepaper.tex` (the target)
> - `docs/adr/0014-the-anchor-protocol.md` and `docs/reports/PORT_DADDY_ANCHOR_WHITEPAPER.md` (P2 targets)
>
> **Per-patch actions:**
> - P1 Conservation Theorem → insert after §7 (TLA+ spec, before §8), or as a new §7.3. Theorem + case-analysis proof + reference to the code.
> - P2 Cuckoo revocation → insert into Anchor Protocol paper §2 or as new §2.4. Short — the hybrid is dropped; just cuckoo.
> - P3 Merkle Forest → extend §4.2 "Merkle-Chained Auditability" with the forest structure, inclusion proofs, KMS witness.
> - P4 Federated Sovereign → replace the "Single-node scope" paragraph in §7 Discussion with the new abstract-KMS-properties framing.
> - P5 Pricing (Cleanup Lower Bound + Bonded Advisor) → extend §8 (Open Problems: Pricing) as a new subsection §8.3 or §8.4.
>
> **Also:** apply threat-model corrections C-1..C-3 from `SECURITY-ASSESSMENT.md` (most already applied in markdown companion docs, but the LaTeX needs mirroring).
>
> **When done:**
> - Rebuild the PDF (`pdflatex agent-transactions-whitepaper.tex` twice for refs).
> - Delete `docs/shipwright/BONDED-COMMONS-PATCHES.md` (its job is done).
> - Update `docs/shipwright/README.md` to reflect.
> - Commit with a clear message: `paper(bonded-commons): apply P1..P5 patches from 2026-04 session`.

---

## §5 TRACK 5 — Security follow-ups [⚡ MOSTLY PARALLEL]

### Sub-track 5a — swap `/usr/bin/security` for `@napi-rs/keyring` [🔗 SERIAL: needs install]

> (Opening. Identity: `port-daddy:sec:napi-keyring`. Purpose: "Replace execFileSync('/usr/bin/security', …) in lib/keychain.ts with @napi-rs/keyring native binding.")
>
> **Why:** the current impl briefly exposes the key on `ps auxww` during write. Native binding closes that window. Also unblocks Linux (Secret Service) and Windows (Credential Manager) parity.
>
> **Do:**
> 1. `npm install @napi-rs/keyring` (it ships prebuilts per-platform — no compile needed for most; verify on CI).
> 2. Refactor `lib/keychain.ts`:
>    - Replace `execFileSync('/usr/bin/security', …)` with `Entry.setPassword` / `Entry.getPassword` / `Entry.deletePassword`.
>    - Keep the base64-wrap convention (still useful for multi-line PEMs if any native impl has edge cases).
>    - Delete the `isHexDump` path (was compensating for the CLI hex-dump quirk).
>    - Extend `available()` to return true on Linux/Windows when the keyring dep loads cleanly.
> 3. Tests: keychain abstraction still works on macOS; skipped on Linux/Windows CI runners lacking a keyring daemon (detect and skip cleanly).
> 4. Full suite green before promote-stable.
>
> **Acceptance:** same external behavior, no `ps` window, cross-platform ready.

### Sub-track 5b — Passkey-first KMS worker (separate repo: `port-daddy-kms`)

> (Opening. Identity: `port-daddy-kms:worker:scaffold`.)
>
> **Read:**
> - `docs/shipwright/USER-ACCOUNTS-KMS.md` — passkey-first design (the rewritten version from 2026-04-20)
>
> **New repo** at `~/coding/port-daddy-kms`:
> - Cloudflare Worker + D1 + KV.
> - WebAuthn registration & authentication (use a library like `@simplewebauthn/server`).
> - Device registry: account → [{deviceName, pubkey, addedAt, lastSeen}].
> - Signed-challenge auth for daemon ↔ KMS calls.
> - Email magic-link recovery (Cloudflare Email Routing).
> - Harbor session key endpoints: PUT (wrap-for-user), GET (fetch-my-wrapped), DELETE (rotate-out).
> - Witness log endpoint: POST `/v1/witness/harbor-root`.
> - Rate limiting + audit log.
>
> **Integration:** daemon's `lib/auth.ts` (new) wraps the worker API. `pd login` opens a local browser flow, does WebAuthn ceremony, registers daemon device.

### Sub-track 5c — Tighten other quick hits from `SECURITY-ASSESSMENT.md`

> F-07 (bond wallet numeric encryption): deferred, low-priority. Named for eventual coverage when encrypt-at-rest is universal.
>
> F-08 (activity log plaintext): same.
>
> Also: do a fresh pass to confirm F-05 (tunnel env scrub) works correctly after the real-world tunnel-spawn paths run. Integration test with a fake `ngrok` shim.

---

## §6 TRACK 6 — Mesh coordination (LAN + cross-network + phone viewer) [⚡ TIERED PARALLEL]

**Status:** architecture specced (`MESH-COORDINATION.md`, tiers T0/T1/T2/Tx); zero code.

**Tiers independently shippable.** Start with T0.

### Sub-track 6a — T0 LAN mesh (same-Wi-Fi daemons)

> (Opening. Identity: `port-daddy:mesh:t0-lan`. Purpose: "Same-network daemon↔daemon discovery + authenticated messaging via mDNS.")
>
> **Do:**
> 1. `lib/mesh/lan-discover.ts` — advertise + discover `_portdaddy._tcp.local` via mDNS. Node's `multicast-dns` package. TXT records: `pubkey`, `account`, `harbors`, `port`.
> 2. `lib/mesh/lan-transport.ts` — WebSocket server at `/mesh` on the existing Fastify, handshake via mutual Harbor Card exchange.
> 3. CLI: `pd mesh discover` (list nearby daemons), `pd mesh connect <identity>` (manual pair), `pd mesh peers` (show paired).
> 4. Capabilities over the channel (v0): remote session creation, live activity-log streaming. Defer Float-Plan execution until Track 7.
>
> **Test:** two daemons on `localhost` with different ports; LAN discovery finds them; handshake succeeds; messages flow; revocation-filter sync works.

### Sub-track 6b — T1 cross-network (Iroh sidecar) [🔗 SERIAL on T0 interface]

> (Opening. Identity: `port-daddy:mesh:t1-iroh`.)
>
> **Do:**
> 1. Decide: ship Iroh as a prebuilt binary alongside the daemon (like we ship `better-sqlite3` prebuilts) vs. require user install.
> 2. `lib/mesh/iroh-client.ts` — talk to the Iroh sidecar over localhost HTTP/gRPC. NodeId addressing, relay fallback, NAT hole-punching.
> 3. Ticket-based pairing: KMS issues short base32 tickets; user pastes into other machine.
> 4. CLI: `pd mesh pair <ticket>` to consume a ticket.
> 5. Same message semantics as T0; transport is the only thing that changes.

### Sub-track 6c — T2 phone viewer (relay broker + React Native / PWA)

> (Opening. Identity: `port-daddy-kms:worker:viewer-relay`.)
>
> Separate work in KMS worker + a PWA (maybe Tauri mobile for the brave). Phone connects via `wss://relay.portdaddy.dev/viewer` with passkey-auth; daemons push state changes; phone signs low-stakes actions.

### Sub-track 6d — Tailscale detection (Tx)

> One-afternoon task. `lib/mesh/tailnet-detect.ts` — check if Tailscale is running (`tailscale status --json`); if yes, register peer IPs and prefer them. No dep, just OS detection.

---

## §7 TRACK 7 — Remote execution model (the ACTUAL answer to "gaming PC + laptop") [🧠 DESIGN + CODE]

**Status:** The user asked "what is the LAN story for 2+ computers? SSH + mutate? clones in sync?" The answer is neither. This track designs and builds it.

**Depends on:** Track 6a (LAN transport) at minimum. Track 2 (actor runtime) if we want full actor semantics across machines.

### The answer (short)

**Unit of coordination across machines: the Float Plan, not the file.** Each machine has its own clone + git worktrees. Work happens in each machine's local filesystem. Results cross the boundary as commits, pushes, and evidence notes. Not as file-system writes.

**Why not SSH mutation:** filesystems drift silently across machines, no audit trail, no conflict reconciliation, violates evidence chain semantics.

**Why not continuous sync (Syncthing-style):** bidirectional continuous sync + git = ten thousand conflicts. Git is the conflict-resolution layer; sync on top of git is redundant and fragile.

**Why Float Plans:** they're already the unit of work in the bonded commons. They carry authorization (signed principal), acceptance criteria (verifiable), budget/bond (economic settlement). Extending them across machines is a natural fit.

### Design sketch

```
LAPTOP (where user vibe-codes)                  GAMING PC (has GPU, CPU, RAM)
─────────────────────────────                  ─────────────────────────────
repo at ~/code/myapp                            repo at ~/code/myapp  (same repo, own clone)
branch: feature/new-renderer                   remote: same git server (GitHub / self-hosted)
daemon: port-daddy:myapp:laptop                 daemon: port-daddy:myapp:gamingpc
                                                worktree: ~/code/myapp-worktrees/plan-abc123
user runs:                                      daemon receives Float Plan:
                                                  {
  pd mesh spawn \                                 id: "abc123",
    --to port-daddy:myapp:gamingpc \              branch: "feature/new-renderer",
    --plan "render scene-v3 via gpu" \            commit: <sha>,
    --budget-usd 2 --bond-usd 0.50                task: "render scene-v3 via gpu",
                                                  acceptance: ["output/scene-v3.png exists and > 10MB"],
                                                  budget_usd: 2, bond_usd: 0.50,
  mesh sends the Float Plan via                   signed_by: <laptop's daemon pubkey>
  encrypted channel (§6)                        }

                                                gamingpc daemon:
                                                  1. bonds.escrow(0.50)
                                                  2. git fetch + checkout branch@commit
                                                     into ~/code/myapp-worktrees/plan-abc123
                                                  3. spawn agent in that worktree
                                                  4. agent writes output/scene-v3.png
                                                  5. agent commits + pushes "render: scene-v3"
                                                  6. acceptance check: file exists? size > 10MB? yes → settle.
                                                  7. bond refunded; notes emitted; evidence chain commits.
                                                  8. result streams back: "done, sha=<newsha>"

laptop daemon:
  9. receives "done"; git pull.
  10. local worktree updated.
  11. user sees scene-v3.png locally.
  12. notes from gaming pc are readable via `pd notes --session <id>`.
```

### Why this is the right answer

- **Git is the shared state.** Machines catch up to each other via commits, not file copies. Standard, understood, already works.
- **Worktrees isolate plans.** Each remote Float Plan runs in its own worktree on the remote machine. No cross-contamination between parallel remote plans.
- **Acceptance criteria enable settlement.** The daemon on the remote machine verifies acceptance (file exists, tests pass, coverage ≥ X) before settling. No manual "did it work?" back-and-forth.
- **Evidence chain crosses machines.** Notes emitted on gaming-pc gossip back to laptop via mesh. The Merkle chain records the cross-machine handoff.
- **No "who owns the file" ambiguity.** Each machine has its own checkout. The branch is the shared namespace.
- **Bonds make misbehavior expensive.** Remote machine runs an agent on behalf of a requester; if the work breaches (wrong files touched, acceptance failed), bond slashes just like local misbehavior.

### Prompt

> (Opening. Identity: `port-daddy:mesh:remote-execution`. Purpose: "Remote Float Plan execution across mesh peers, via per-plan worktrees and git as the state-sync layer.")
>
> **Read:**
> - `docs/shipwright/MESH-COORDINATION.md` (T0 LAN is already spec'd)
> - `docs/VISION-AND-PERSPECTIVES.md` (Float Plans concept)
> - `lib/worktree.ts` (existing worktree primitives)
> - `lib/bonds.ts` (escrow semantics)
>
> **Design first, code second.** Write `docs/shipwright/REMOTE-EXECUTION.md` covering:
>
> 1. Float Plan cross-machine schema additions (`requester_daemon_pubkey`, `remote_daemon_pubkey`, `git_remote`, `branch`, `commit_sha`, `worktree_path_on_remote`).
> 2. Acceptance criteria grammar — files exist, tests pass, coverage ≥ X, arbitrary shell exit 0, LLM judge.
> 3. Worktree lifecycle on the remote (pre-plan fetch, post-plan cleanup, conflict handling).
> 4. Push back strategies: direct push to origin vs. bundle+ship-over-mesh vs. a mesh-native git transport.
> 5. Evidence chain across machines: notes from the remote daemon need to be readable on the requester side. Gossip via Merkle witness, or via explicit mesh message with signed blob.
> 6. Failure modes: remote machine goes offline mid-plan → salvage queue across mesh; evidence preserved.
>
> **Then code** (in a follow-up session after the design PR merges):
> - `lib/mesh/remote-execution.ts` — the cross-machine Float Plan client + server.
> - `cli/commands/mesh.ts` — `pd mesh spawn --to <identity> --plan "..."`.
> - Integration test with two ephemeral daemons on localhost (different ports + different worktrees).

### Parallelizable sub-work

- Design doc (1 worktree, 1 agent).
- Acceptance grammar implementation (1 worktree).
- Mesh-git-transport (1 worktree — big).
- Cross-mesh evidence gossip (1 worktree).

---

## §8 TRACK 8 — Make Port Daddy sticky (tooling + templates)

**Status:** not started. This is the "encourage future agents to use PD aggressively" track.

### Prompt

> (Opening. Identity: `port-daddy:tooling:stickiness`. Purpose: "Produce artifacts that make it uncomfortable for Claude/Codex to skip Port Daddy.")
>
> **Artifacts to ship:**
>
> 1. **Project `CLAUDE.md` update.** Add the §0 Opening verbatim to `CLAUDE.md` at the project root. Every future session starts with it in context.
>
> 2. **Skill: `skills/port-daddy-fluency/`.** A port-daddy skill file (`SKILL.md`) that activates on trigger phrases (e.g., "edit a file", "implement a feature"). The skill body shows:
>    - The §0 Opening.
>    - Why each step matters (salvage, coordination, reputation, stigmergy).
>    - Cost of skipping ("your work becomes invisible to fleets").
>
> 3. **MCP tool signatures.** The existing `mcp/server.ts` has tools — audit them for "this tool should nudge the user toward `pd begin` if there's no active session." Return a `session_nudge` field in the response (this pattern exists — extend it).
>
> 4. **Pre-commit hook template.** A `.git/hooks/pre-commit` shipped as `scripts/install-hooks.sh` that blocks commits when `pd whoami` reports no active session. Override with `--no-verify` (standard) for emergency cases.
>
> 5. **Dashboard "you are invisible" banner.** When dashboard sees uncommitted changes + no active session + recent file edits, shows a "you're working unlogged — `pd begin` to join the fleet" banner. Gentle, honest, persistent.
>
> 6. **`pd catch_me_up` improvements.** Output should lead with "what would have helped the previous agent be less stuck" — pheromones, tuples, recent notes. Make it feel like reading a good checkpoint.
>
> 7. **Cheaper-than-not-using-it primitive.** Implement `pd cache '<prompt>' --ttl 1h` — local LLM response cache keyed on prompt + model. Agents that use it are faster than agents that don't. Make it a one-liner in Claude's instructions. (This aligns with prompt caching.)
>
> 8. **Pheromone-first search.** `pd grep '<pattern>'` that weights matches by pheromone strength. Hot files surface first. Agents that grep raw are slower than agents that `pd grep`.
>
> **The strategy isn't to force it; it's to make the tool so useful that skipping it is stupid.** Every one of these removes a reason to skip `pd begin`.

---

## §9 TRACK 9 — The Shipwright UI lives (end-to-end demo)

**Depends on:** 1b, 2, 3, 6a at minimum.

> A capstone session: wire everything up, boot the daemon, open `http://localhost:9876/shipwright/harbor`, see the fleet, click a project, propose a fleet, simulate, apply, watch the dashboard reflect reality. Live 3D ships bobbing. FleetControl panel showing real bond state. If any of these doesn't work end-to-end, find the gap, file a focused follow-up.

---

## §10 Parallelization map

```
                                 TIME →

TRACK 1b (bonds wiring)          ────●────────
                                      ↓
                                      (unblocks Track 3 UI + Track 7 remote exec)

TRACK 2a (actor runtime)         ────●────────
                                      ↓
TRACK 2b (skill-index)           ────●────────   ← parallel with 2a
                                      ↓
TRACK 2c (archetypes ×6+)             ────●●●●●●    ← fan-out after 2a

TRACK 3a (R3F specs)             ────●────────
TRACK 3b (INTEGRATION-PLAN)      ────●────────   ← parallel with 3a
TRACK 3c (build UI)                   ────●●●●─    ← serial on 3a+3b+1b

TRACK 4 (LaTeX patches)          ─────●────────   ← fully parallel, doc-only

TRACK 5a (napi-rs/keyring)       ────●─────       ← parallel; needs npm install
TRACK 5b (KMS worker new repo)   ────●●●●●        ← parallel (separate repo)

TRACK 6a (T0 LAN mesh)           ────●──          ← parallel (after Track 2a helpful)
TRACK 6b (T1 Iroh)                    ────●●      ← serial on 6a
TRACK 6c (T2 phone viewer)            ────●●●    ← parallel (with KMS worker)
TRACK 6d (Tx Tailscale)          ──●             ← trivial, drop-in anytime

TRACK 7 (remote exec)                 ────●●●    ← serial on 6a + 2a; DESIGN doc first

TRACK 8 (stickiness tooling)     ────●●          ← parallel (CLAUDE.md, skills, hooks)

TRACK 9 (capstone demo)                   ────●  ← serial: needs 1b, 2, 3, 6a
```

### Worktree allocation (one possible assignment)

- **Worktree A** · Tracks 1b → 3c (API → UI — the product line)
- **Worktree B** · Track 2 (daemon-side — actor runtime + archetypes)
- **Worktree C** · Track 6 → 7 (mesh + remote execution)
- **Worktree D** · Track 4 + Track 5 + Track 8 (docs, security, tooling — mixed but all low-touch to the others)
- **Worktree E** · `port-daddy-kms` new repo (KMS worker — Track 5b + 6c infra)

Five parallel agents, all using Port Daddy to coordinate file claims across the worktrees. Disjoint filesystem scopes minimize conflict.

---

## §10.5 Cross-session coordination — what to paste when multiple agents are live

When 2+ Claude/Codex sessions are open on the same repo at the same time (say: bug-fighter + website-cleanup + daemon-promotion + the-current-thing), they need to talk. Port Daddy is the bus. Paste the block below into EACH open session at the start; the sessions will self-coordinate from there.

### The session-registration block

```bash
# 1. Announce yourself with a unique role suffix.
AGENT_ID="port-daddy:session:$(whoami)-$(date +%s | tail -c 5)"
pd begin "<one sentence: what you're doing>" --identity "$AGENT_ID"

# 2. Broadcast live status as a pinned note (note + tuple in one call).
pd say "live: <short work summary> — files: <comma-sep> — branch: $(git branch --show-current)" \
  --pin --kind "session:live" --as "$AGENT_ID"

# 3. Look around before acting.
pd look --since 120                               # 2h sitrep synthesis (activity+notes+salvage+spawns)
pd look --heat                                    # file heat map (pheromone contention)
pd tuple rd '["session:live"]' --harbor fleet     # who else is live
pd ideas search "<topic>"                         # trove + tuples + repo markdown

# 4. Before each file edit (advisory conflict detection):
curl -s "http://127.0.0.1:9876/files/who-owns?path=<path>" | jq
pd session files add <path>

# 5. Direct DM to another session (when 3.8.4 `pd say --dm` lands, replace this):
pd agent inbox send <their-agent-id> '{"re":"<topic>","msg":"<text>"}'

# 6. Leave a finding — this is the one-call pattern that replaced four:
pd say "fixed <X> in <path> — commit <sha>" \
       --pin --heat <hot-path>=0.7
#   ^note  ^tuple (cross-session)   ^pheromone on the file

# 7. Broadcast an alert to a channel:
pd say "build broken on main — rolling back" --broadcast alerts

# 8. When you finish a chunk:
pd done "<one-sentence result>"
```

### What each session publishes so others don't have to scroll a transcript

**The rule:** every non-trivial discovery or fix becomes a tuple. Every file you touch hot gets a pheromone. Every session has a live status tuple. Every cross-session question is an inbox message, not a guess. Humans shouldn't have to relay findings between sessions — the PD substrate does that.

### Deconfliction policy (by convention, not enforced)

- **Who goes first on an overlapping file:** whoever claimed it first in `pd files who-owns`. If simultaneous, the lower agent-id (lexicographic) wins; the other waits or scopes differently.
- **Website vs core:** if one session is working under `website-v2/` and another under `lib/`, they're disjoint. Cross-check via `pd files who-owns` only for boundary files (tests that touch both, `server.ts` if it's reorganizing).
- **Promote-stable windows:** the promoting session writes a tuple `deploy:gate:<epoch>:armed` before `./scripts/promote-stable.sh`. Other sessions don't merge until a matching `deploy:gate:<epoch>:cleared` tuple appears.

### The "how did I find out what to merge" question

When multiple sessions land changes to a shared file (e.g., `server.ts`), the integrating session runs:

```bash
git log --since="3 hours ago" --oneline server.ts
# then see what tuples/notes were filed in that window:
pd tuple rd '["bug"]' --harbor port-daddy:fleet --limit 20
pd notes                                 # recent notes across sessions
pd ideas search "server.ts"              # trove + notes + markdown hits
```

That narrative usually makes the merge obvious. Conflicts come from *different changes solving the same problem* — and tuples let you see which problem was being solved.

### Worked example — the 2026-04-20 parallel session

On this day, three Claude/Codex sessions were open simultaneously:

1. **Security hardening** (this session) — `lib/bonds.ts` wiring, `lib/note-encryption.ts` Keychain migration, docs.
2. **Bug-fighting** — agent-lifecycle drift, `lib/agents.ts` + `lib/sessions.ts` + `server.ts` reconciliation.
3. **Website cleanup** — `website-v2/**` refactor.

Three completely disjoint filesystem scopes (except for `server.ts`, where session 1 added `snapshotSensitiveEnv()` at the top and session 2 added `sessions.abandonOrphanedActive()` in the cleanup loop). Both edits committed without git-conflict because they touched different regions. Both tests pass after integration. Neither session had to be aware of the other in real time — but they should have been publishing tuples as they went, so that if the edits HAD conflicted, there'd be a trace.

**Lesson:** file-level git merge-without-conflict is luck; tuple-level coordination is design. Don't trust the luck.

---

## §11 Making Port Daddy sticky — concrete techniques

Beyond the Track 8 tooling, here are the *behavioral* moves that make Claude/Codex agents WANT to use the product:

1. **Start-of-session ritual in CLAUDE.md.** First thing the agent reads. It says §0 Opening and frames everything else around it. Agents follow CLAUDE.md.

2. **Make `pd catch_me_up` the first command an agent runs.** It should be shorter and denser than re-reading the repo. If done well, agents will prefer it over git log + grep + LS.

3. **File claims prevent stepping on toes, so skipping them costs time.** In multi-agent sessions, an agent that skips `pd session files claim` discovers conflicts at merge time — when it's expensive. Burn-in experience teaches the lesson.

4. **Pheromones surface relevant files.** `pd grep` weighted by pheromone is strictly better than `rg`. Make it a one-liner. Make the output prettier.

5. **Tuples are cheaper than re-researching.** If agent A discovers "this project uses jose v5 with custom Fastify plugin pattern" and writes it to a tuple, agent B picks it up in 10ms instead of 10 minutes.

6. **Salvage is quietly magic.** An agent that crashes and re-spawns picks up where it left off if it was using sessions. An agent that wasn't using them starts over. The lesson is taught gently the first time; remembered thereafter.

7. **Reputation discount on bonds.** This is the big one. An agent's principal accumulates reputation; reputation discounts future bonds. Skipping sessions means no reputation means higher bonds means more expensive agent work. Economic incentive, not moral.

8. **Dashboard is visible to the user.** The user can see in real time which agents are doing work and which are ghosts. Agents skipping sessions are invisible — and users (correctly) assume invisible means nothing happened.

9. **Teach via embarrassment.** The first time an agent takes 30min to re-research something that was in a tuple, note it in the activity log. The next agent reads the log and grins.

10. **Cheat sheet on the desktop.** `pd cheat` prints a postcard-sized ASCII art of the 10 commands that matter. Save as `~/.port-daddy/cheat.txt`; `cat` on session start.

### The "begging" outcome

When Port Daddy is sticky enough, an agent opens a new session, runs `pd catch_me_up`, sees 40 lines of context it would have spent an hour re-assembling, and thinks (if it thinks): "oh thank god, I know what's happening." That's begging. Engineer the conditions that produce it.

---

## §12 LAN story for 2+ computers — the honest answer

**The user asked:** "what is the lan story for 2+ computers? someone ssh's over and mutates my file systems? two clones kept in mostly sync?"

**Neither.** Both extremes are bad. Here's why and what to do instead.

### Why not SSH + mutate
- No audit trail for who changed what.
- No conflict resolution; concurrent edits from two machines silently clobber.
- Files get out of sync with git state (uncommitted on both sides).
- Violates the Port Daddy evidence-chain semantics: work needs to be attributable.

### Why not "two clones in continuous sync"
- Continuous bidirectional sync + git = ten thousand merge conflicts.
- Git is *already* the conflict-resolution layer for code; wrapping it in Syncthing doubles the machinery and introduces new failure modes.
- Working-tree churn from sync makes `git status` lie about reality.

### What does work: **Float Plan + per-plan worktree + git as state layer**

- Each machine has its **own clone** of the repo. Different paths, different work states, owned separately.
- A Float Plan names `(branch, commit_sha, task, acceptance)`.
- When laptop sends "run this plan on gaming-pc": gaming-pc's daemon creates a **new worktree** from the named commit, runs the agent there, commits the work back, pushes to the shared remote.
- Laptop pulls to update its own checkout.
- **Files never mutate across machines via network.** Commits cross machines via git, which handles conflicts natively.
- Evidence (notes, Merkle entries) gossips via mesh messaging.

### Multi-machine mental model

```
Shared truth:      git remote (GitHub / Gitea / Forgejo)
Per-machine truth: local clone + worktrees, owned independently
Unit of hand-off:  Float Plan (authorization + task + acceptance)
Propagation:       git push / pull for code; mesh messages for evidence
Conflict domain:   git (handles it well); file claims across mesh (prevents it)
```

### What about "my gaming PC has the GPU, my laptop doesn't"?

That's the killer use case and this model handles it cleanly:
- Laptop: "hey gaming-pc, run `render scene-v3` via plan `<Float Plan JSON>`."
- Gaming-pc: escrows bond, fetches branch, runs agent in worktree, commits `render: scene-v3` with the output PNG, pushes.
- Laptop: pulls; has the rendered PNG locally.

If the PNG is a big binary (unsuitable for git), extend with `git-lfs` or use mesh-direct transfer: gaming-pc streams the file to laptop over the authenticated mesh channel after pushing the metadata commit. Both machines end up with the artifact; neither had to cp-over-ssh it.

### Safety net: file claims span the mesh

If laptop's Shipwright and gaming-pc's sentinel both want to edit `lib/foo.ts`, the file-claim system (already in Port Daddy, extended across mesh in Track 6a) detects the conflict BEFORE either machine commits. Neither steps on the other.

### What the user does NOT need to worry about

- Two laptops with slightly-different uncommitted changes silently diverging (they can't — all work goes through Float Plans which demand commits).
- The gaming PC stealing files or leaving debris (per-plan worktrees are cleaned up on completion).
- Losing work if a machine dies mid-plan (the salvage queue picks it up; another machine can claim the plan).

### Three concrete `pd mesh` commands this unlocks

```bash
# One-shot remote execution:
pd mesh spawn --to port-daddy:myapp:gamingpc \
              --plan "train model on my gpu with the current HEAD" \
              --budget 2.00 --bond 0.50 \
              --accept "model/checkpoint.bin exists and > 100MB"

# Ambient advisor: "propose what would be a good remote plan":
pd mesh advise --to port-daddy:myapp:gamingpc

# Continuous: "this gaming-pc should watch the 'experiment/*' branches
# and auto-run any with a float-plan.yml":
pd mesh subscribe --to port-daddy:myapp:gamingpc --branch-glob "experiment/*"
```

All of these are Float-Plan-mediated. None of them mutate the laptop's filesystem from the gaming PC. Git is the state layer; the mesh is the coordination layer; Port Daddy is the accountant.

---

## §14 TRACK 14 — 3.9.0 Attention-Queue-first UI [🧠 DESIGN done → BUILD]

Full design in `CONSOLIDATED-VERBS-AND-UI.md`. One sentence: replace the
15-panel symmetric dashboard with a single **Attention Queue** whose three
lanes are **Distress** (red, acked), **Requests** (amber, countdown), and
**Fresh Signals** (neutral, collapsible). Everything else is a deep-browse
tab.

**New verbs to land first (enable the queue with real data):**
- `pd ask "<question>" --options a,b,c --deadline 10m --default a`
- `pd distress <kind> --summary "..." --evidence <path>` (kinds: `repeated_failure`, `auth`, `conflict`, `permission`, `budget_exhausted`, `invariant`, `dependency_missing`, `human_required`)
- `pd relate A --to B --kind <edge-kind> --confidence <0..1>`
- `pd propose <class> "<text>" [--branch X] [--alternatives ...]`
- `pd suggest channels --for "<task-text>"` (cheap Shipwright, Haiku-tier)

**Surfaces per verb:** route, CLI, SDK, completions (3), MCP tool, docs, tests. Parity checklist.

**Build order** (CONSOLIDATED-VERBS-AND-UI.md §8):
1. Attention Queue UI frame fed by existing primitives (pheromones,
   salvage queue, recent notes).
2. `pd distress` + `distress` table + red lane.
3. `pd ask` + `escalations` table + SSE reply plumbing + amber lane.
4. Sortie thread view.
5. Pheromone dimension registry (§3 of the UI doc).
6. Channel radio dial.
7. `pd relate` + `pd propose`.
8. `pd suggest` (cheap Shipwright).
9. Visualizations (heat-tree, tuple timeline, graph explorer).
10. Mobile push for Attention-Queue items (after phone viewer).

---

## §15 TRACK 15 — Pheromone lifecycle + heat-tree [🧠 DESIGN done → BUILD]

Full design in `PHEROMONE-LIFECYCLE-AND-HEAT-TREES.md`. Mutable pheromones
with lineage (`pheromone_events` table, revoke/rename/fork verbs, expiry
contracts) + hierarchical correlation-clustered heat-tree rendering with
per-layer normalization borrowed from gene-expression visualization.

**Shippable chunks:**
- Chunk 1: lineage table + on-spray event logging + `pd pheromone lineage` verb. Small.
- Chunk 2: `pd pheromone revoke`, `pd pheromone rename`. Medium (needs consumer migration for rename).
- Chunk 3: expiry contract evaluators (lazy on read).
- Chunk 4: `GET /pheromone/heat-tree` server-side dendrograms (centroid linkage).
- Chunk 5: `fleet-config-ui/src/components/HeatTree.tsx` visualization.

---

## §16 TRACK 16 — Vibe time + token telemetry + replay [🧠 DESIGN done → BUILD]

Full design in `VIBE-TIME.md`. Three coupled changes:

- Token-rate endpoints + per-project sparkline widget (free — plumbing).
- Vibe-time warped calendar axis (derived from token-rate + agents + commits + keystrokes).
- Full-spectrum replay (`~/.port-daddy/replay/<project>/<date>/<agent-id>.jsonl`), `pd replay list/show/export/resume/diff` verbs, encrypted + redacted at write time, LRU evicted.

**Critical safety bar:** replay is *off by default*, opt-in per project, and passes through the same redaction hooks as session notes (F-06 threat model).

**Killer feature:** `pd replay resume <run-id> --at <step>` — cold-start another agent from step K of a prior run. Generalizes salvage.

---

## §17 TRACK 17 — Cooperative vibe coding (browser extension) [🧠 DESIGN spec NEEDED]

One-line vision (from `UTOPIAN-VISION.md §2.7`): cmd-shift-p on any web
page → draw a rectangle → daemon receives screenshot + DOM coordinates +
stack trace to responsible source file → Shipwright opens a scoped sortie
with budget cap.

**Precondition work:**
- Chrome extension manifest v3 with websocket to local daemon (localhost:9876).
- DOM-node-to-source-map: use the build's sourcemap in dev mode; fall back to best-effort React DevTools component hierarchy in prod.
- Daemon endpoints: `POST /annotations` with `{screenshot, dom_path, page_url, component_hint, user_comment}`. Creates a tuple + spawns a scoped sortie.
- Playwright script auto-generation: from the (page_url, dom_path, before/after screenshot pair) tuple, synthesize a `test.ts` that asserts the fix.
- Websocket channel for agent replies and cursor presence.

**Shipwright becomes the admiral** here — the operator's comment is an
ask; Shipwright marshals the right agents to answer.

**Revenue hook:** this is the most "oh wow" demo in the product, the one
that converts skeptical onlookers into users.

---

## §18 TRACK 18 — Event sources & integrations [⚡ PARALLEL, auth-gated]

Once `USER-ACCOUNTS-KMS.md` lands, each of these becomes a shippable
integration. **Every one requires OAuth + per-user encrypted token
storage in the Keychain/KMS.**

Priority order (based on coding-operator value):
1. **VS Code extension** — FleetBar as an always-open VS Code panel.
   Shows pheromones, file claims, attention queue, agent cursors inline
   with your files. "Another view layer for our control plane."
2. **GitHub** — PRs → Attention Queue (request class). CI failures →
   Distress class. Stale branches → cleanup sortie proposals.
3. **Email / calendar** — *read-only first.* "Meeting at 10" surfaces
   as a soft yellow bar: "focus time ends in 23m; want to park
   anything?" Agents can propose calendar blocks for heavy
   refactors.
4. **Slack** — DM and channel bridges. `@port-daddy sitrep` returns
   the synthesis. `/pd ask` opens an ask from Slack.
5. **IDE save hooks** — autocommit suggestions when heat drops on
   a file; pheromone `saved_since_review` for stale pending reviews.
6. **IFTTT** — low priority; most integrations better built direct.

**FleetBar evolution:** menu bar app today → VS Code extension +
browser extension + (later) desktop electron + phone app. Same data,
different viewports.

---

## §19 TRACK 19 — System agents (background assistants for the operator) [🧠 DESIGN + BUILD]

The user calls these *"a background agent acting as the system-wide
suggestibility layer (or project layer)."* They help the operator keep
track of the dozen threads and ideas across all sessions.

Canonical system agents to build (as fleet entries):

1. **Attention-Minder** — reads the queue every 60s; notices when a
   distress has been unresolved for >30m and escalates (inbox DM,
   phone push).
2. **Cross-Project Pollinator** — mirror the Spark ideas-trove agent
   but cross-project. Reads your other repos; surfaces "this pattern
   looks similar to what you fixed in X."
3. **Channel Steward** — renames/deprecates channels that haven't
   been used in 30 days, proposes consolidations.
4. **Vibe-Time Reporter** — posts a daily summary tuple: "yesterday's
   vibe time was 4.2 hours across 3 projects; top agents were X, Y."
5. **Pheromone Gardener** — reads lineage events; flags stale high-
   strength pheromones whose producers are inactive.
6. **Sortie Groomer** — notices failing sorties, proposes scope-
   reductions or kill decisions.
7. **Morning Briefer** — first tuple of the day, a short
   `pd look --since "24 vibe-hours"` with Shipwright commentary on
   what to work on first.

Build them as fleet entries in `pd-fleet.yml` in the PD repo itself
(dogfood). Each agent is tiny (Haiku, tight prompt) and writes notes
+ tuples; the UI reads them like any other signal.

---

## §20 TRACK 20 — 10 Spider/Spark features for 3.9 (or 3.8.5) [🐜 incremental]

These are small, individually shippable features that extend the
existing indexer (spider) and ideas-trove (spark) agents.

**Spider (semantic connector):**
1. Extract invariants from code into `graph_edges` (kind
   `guards-invariant`) — detect assert, invariant, check* patterns.
2. Stale-doc detection — doc files that haven't been edited but whose
   referenced source files have. Pheromone `doc_drift` surfaces it.
3. AST-level symbol-claim inference — when a session edits lines
   120-145 of a function, auto-extend the claim to `start_line`/
   `end_line`/`symbol` fields (already schema-present, unused).
4. Reverse-engineer channel naming from observed pub/sub traffic —
   propose declarations for undeclared channels with >N uses.
5. Find redundant session scopes — two sessions with >80% file
   overlap; propose a merge or a rename.

**Spark (novelty filter):**
6. Cross-project ideas synthesis — recurring patterns across your
   repos. One-shot Haiku per day.
7. "Cheaper alternative" suggestions for each agent spawn —
   does the same task have a Haiku-tier precedent?
8. Propose new pheromone dimensions when agents keep monitoring the
   same thing through bespoke tuples.
9. Morning "what to work on" briefing — seeded from attention queue
   + ideas trove.
10. Propose sortie templates from recurring manual work (three
    similar ad-hoc spawns → a named recipe).

Each of these is a day of work. Grouped, they change the feel of the
product substantially — it starts to *anticipate*.

---

## §21 TRACK 21 — Whitepaper v2 (Thomas Youle co-author) [📝 DOC]

Full spec in `WHITEPAPER-PATCHES-V2.md` (to be written — §22 of this
doc). Apply `BONDED-COMMONS-PATCHES.md` P1-P5 to the LaTeX source plus
the new material from this session:

- §4 Bonded Commons: extend with pheromone lineage and mutable-commons
  semantics (from `PHEROMONE-LIFECYCLE-AND-HEAT-TREES.md`).
- §7 Federation: replace the single-node-scope paragraph with the
  passkey-first accounts + Merkle forest story from
  `USER-ACCOUNTS-KMS.md`.
- §8 Pricing: the Bonded Advisor. **Thomas Youle (Indiana University
  Business Economics & Public Policy) as co-author on this section.**
  Competitive insurer-agent auction mechanism replacing the static-
  parameter pricing.
- New §10: Multi-agent coordination as a substrate — the expressive-
  act taxonomy (Signal/Request/Distress/Commons/Proposal) from
  `CONSOLIDATED-VERBS-AND-UI.md`.
- New §11: Vibe time as a causal-density temporal model (from
  `VIBE-TIME.md`).

Each section declares proofs to land:
- ProVerif model of the passkey-first handshake.
- Kani + TLA+ on the bond conservation theorem.
- Empirical measurement section (cost + replay corpus from §16).

---

## §22 What makes people give money (candid)

From `UTOPIAN-VISION.md §4`:

1. **Hosted Shipwright** — premium Shipwright on a personal plan.
   Monthly fee. Shipped first because it proves the product idea.
2. **LAN/cross-network mesh** — hosting others' agent work on your
   hardware is a bond-backed economic action. PD collects routing +
   escrow fees. Useful at aggregate scale (one gaming PC is a toy;
   ten thousand is a distributed compute market).
3. **Agent transactions marketplace** — priced, bonded capabilities.
   Bonded Advisor matches supply and demand. Fees are for real
   work (routing, escrow, audit), not rent.

Order of operations: hosted Shipwright → LAN mesh → full marketplace.

---

## §13 What not to do

- **Don't build one gigantic PR.** Every track on this list is scoped to be shippable independently. Bundle is the enemy of quality review.
- **Don't skip stable promotion.** Every track merge should end with `./scripts/promote-stable.sh`. The stable branch is the invariant users rely on.
- **Don't re-read the whole session history.** If you find yourself needing context beyond what's in this doc and its companions, the doc has failed; improve it instead of forking context.
- **Don't let any track languish past ~2 weeks.** If a track isn't getting love, cut scope or pass it to a dedicated session. Architectural items rot fastest.

---

## Pointers

- `docs/shipwright/README.md` — file index.
- `docs/shipwright/AGENT-MODEL.md` — the Plane (Track 2 foundation).
- `docs/shipwright/SHIPWRIGHT-DESIGN.md` — master spec (Track 3).
- `docs/shipwright/FLEETCONTROL-HARDENING.md` — Track 1b spec.
- `docs/shipwright/SHIP-GRAMMAR.md` — Track 3a reference impl.
- `docs/shipwright/USER-ACCOUNTS-KMS.md` — Track 5b spec (passkey-first).
- `docs/shipwright/MESH-COORDINATION.md` — Track 6 tiers.
- `docs/shipwright/SECURITY-ASSESSMENT.md` — Track 5 threat model + follow-ups.
- `docs/shipwright/BONDED-COMMONS-PATCHES.md` — Track 4 patch set (delete after Track 4 merges).
- `docs/shipwright/CONSOLIDATED-VERBS-AND-UI.md` — Track 14 spec (Attention Queue, new verbs).
- `docs/shipwright/PHEROMONE-LIFECYCLE-AND-HEAT-TREES.md` — Track 15 spec (mutable pheromones + phylogenetic heat-trees).
- `docs/shipwright/VIBE-TIME.md` — Track 16 spec (warped temporal axis, token telemetry, replay).
- `docs/shipwright/UTOPIAN-VISION.md` — the happy product vision that ties it all together.
- `docs/shipwright/WHITEPAPER-PATCHES-V2.md` — Track 21 whitepaper patches (Youle as co-author).
- `docs/shipwright/preview/` — Track 3 working mocks (keep; they're the design truth).

---

*Wow, big session. Write good commits.*
