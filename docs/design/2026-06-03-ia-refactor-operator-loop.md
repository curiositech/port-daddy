# Port Daddy IA Refactor — The Operator Loop

**Status:** Design draft (operator-direct ask, 2026-06-03) · **rescued + reconciled 2026-06-05**
**Spine chosen:** Operator loop · **Surfaces:** unify on `/fleet-ui/`
**Author:** session `feat/pheromone-viz-design-v2`

> This is the plot, not the build. It commits to a *conceptual core* and a
> surface map. Implementation lands as a follow-on ADR + phased PRs.

---

## Update — 2026-06-05 (rescue + reconcile + first verb shipped)

This doc spent two days stranded in a recovery commit (never on a branch). It is
now durable. Three reconciliations against what landed since 2026-06-03:

1. **Naming.** The stage formerly called **"Orient"** is renamed **"Sight"**
   (the term "orient" carries Orientalism baggage — cheap to fix now, expensive
   later in a tutorial series). The loop is now:
   **Found → Sight → Dispatch → Watch → Intervene → Land** (+ Remember).
   The Sight verb ships as **`pd periscope`** (aliases `pd sight`, `pd scope`) —
   raise the periscope: *what's the state, what's the next cut.*
2. **Layering vs the new ADRs.** Since this doc, **ADR-0046** (the Operator
   Console = a *conversation multiplexer* driven through an operator-avatar),
   **ADR-0047** (conversation protocol), **ADR-0048** (North Star — what Port
   Daddy *is*), and `docs/design/operator-console-implementation-roadmap.md`
   all landed. They are **not** a competing IA — they are the **interface
   paradigm**; this loop is the **task structure** underneath. The avatar
   dispenses work along the loop; each stage is a thing you ask the avatar for
   or open as a zone. Found/Sight/Dispatch/Watch/Intervene/Land are the verbs
   the console is organized around.
3. **Shipped so far.** `pd periscope` (the Sight stage) is built, tested, and
   running against the live daemon. The First-Run / `/setup/overview` install
   detection and the Roadmap-tab scroll bug — both surfaced while building this —
   are fixed in the same PR. The rest of §9 remains the plan.

---

## 1. The problem, stated honestly

Port Daddy works, but it has no center. The recon turned up:

- **90+ CLI verbs, 143 MCP tools, 40+ distinct nouns** (ports, claims, locks,
  sessions, agents, actors, notes, tuples, channels, pheromones, roadmap,
  commitments, sorties, harbors, bonds, wallets, guard…). Every subsystem
  arrived with its own vocabulary, config file, and failure mode. There is no
  unifying mental model a new user — or a tutorial reader — can hold.
- **8 web surfaces doing 3 jobs.** `/fleet-ui/` (React) is the real one.
  `public/index.html` is deprecated-but-live with a *duplicate* roadmap panel.
  `cockpit.html` is an isolated HITL island. `metrics.html`,
  `fleet-live.html`, `fleet-config.html`, `app-surgery.html` are orphans.
- **FleetBar has 11 "surfaces," several dead.** `Backend`, `Nightshift`/
  `Dispatch`, `BackendPicker` were deleted in PR #218. That is why "Switch
  Backend" does nothing — the button, endpoint, and handler are *gone*, not
  broken.

The three live complaints map cleanly onto holes in the structure:

| Complaint | Root cause | True nature |
|---|---|---|
| "Switch Backend should switch backend, for just things not working" | Backend-switch UI deleted (PR #218); only ever wrote a global `~/.port-daddy-cli-backend` env file + daemon restart. **Per-agent override never existed.** | Missing **IA zone** (Intervene), not a missing button. |
| "Coordination guard is totally broken" | `cli/commands/guard.ts`: guard is Tier-1 and skips the daemon-freshness gate, so a stale Homebrew `pd` queries a fresh daemon and gets wrong claim data. Config written to two divergent paths. PATH-fallback picks whichever `pd`/`port-daddy` is first. | Guard has **no home in the IA** — a silent git-hook side-effect you only meet on failure. |
| "Can't scroll the roadmap on the flow page, still" | `fleet-config-ui/src/components/RoadmapPanel.tsx:166` — `overflow-hidden` on an `h-full` flex parent clips the inner `overflow-auto` (line 197). | One-line symptom of nobody owning the layout contract across 14 crammed tabs. |

**Thesis:** give Port Daddy a single conceptual core — an operator loop that
*starts from nothing* — and every surface, tab, and command hangs off it. The
sprawl becomes navigable; the holes become obvious; the bugs fix themselves as
the structure forms.

---

## 2. The core: a six-stage operator loop

You do not think in nouns ("show me the locks table"). You run a loop. The
core of the new IA is that loop, with a cold-start head so it works from an
empty directory:

```
   FOUND ──▶ ORIENT ──▶ DISPATCH ──▶ WATCH ──▶ INTERVENE ──▶ LAND
     │          ▲                                              │
  (Day 0)       └──────────────── next cycle ─────────────────┘

            REMEMBER  ── cross-cuts every stage ──
```

| Stage | The question it answers | What happens |
|---|---|---|
| **0 · Found** | "There's nothing here yet — make a world." | Empty dir → registered project + harbor + workspace + fleet config + guard installed + roadmap seeded. The null-state engine. |
| **1 · Orient** | "What's the state, what's next?" | Live truth + the next cut. Flow graph, roadmap, briefing. |
| **2 · Dispatch** | "Start / configure work." | Spawn agents, run sorties, bring the fleet up, edit `pd-fleet.yml`. |
| **3 · Watch** | "What's happening live?" | Activity, events, channels, tube, resources, metrics, pheromone trails. |
| **4 · Intervene** ⭐ | "This agent is failing — act on it." | Per-agent action rail: retry · **switch backend** · pause · kill · reassign. *(Does not exist today.)* |
| **5 · Land** ⭐ | "Merge safely." | Guard pre-flight, claim conflicts, version-drift, "safe to commit" light, roadmap pop. *(Buried in git hooks today.)* |
| **× · Remember** | "What did we learn?" | Memory, graph, notes, changelog, inbox — written *during* every stage, not a tab you visit. |

The two starred stages are exactly where the live bugs live. They are not new
features bolted on; they are the missing third of the loop.

### Why this beats noun-grouping

The 14 fleet-ui tabs collapse to 5 task-zones + a cold-start. A reader (human
or agent) can be told "you are in **Watch**, your agent died, go to
**Intervene**" — a sentence that means something. "Go to the Sorties tab" does
not.

---

## 3. One loop, many archetypes

The loop is invariant. Its **presets** flex per project archetype, chosen (or
detected) at **Found** time and stored on the project record. This is what lets
the same tool drive a Fortune-500 monorepo and a Saturday-night prototype
without either feeling wrong.

| Archetype | Found defaults | Guard (Land) | Watch emphasis | Dispatch shape |
|---|---|---|---|---|
| **Prototype / greenfield** | Single harbor, advisory everything, roadmap = a stub "what am I even building." | **Advisory** — warn, never block. Speed over safety. | Cheap: activity + cost. No metrics noise. | 1–3 agents, fast spawn, no bond/budget gates. |
| **Big-but-unstable** (Port-Daddy-itself tier) | Multi-harbor, worktree-per-agent, roadmap seeded from ADRs. | **Enforce**, but loud-fail tolerant — surface drift, allow override with a reason. | Full: pheromone trails, resource governance, merge queue. | Fleets (declared `pd-fleet.yml`), sorties, budget caps. |
| **Mature enterprise** | Harbor per service, strict identity, roadmap = real backlog FK'd to tickets. | **Enforce + quorum** — claims mandatory, second-approver on land. | Compliance: audit log, attestation, who-owns, cost attribution. | Department model: orchestrator plugin, approval gates. |
| **Mobile** | Harbor + simulator/device-farm registry as "services." | Enforce; gate on build-signing claims. | Device sessions, crash reports, build status as Watch signals. | Build/test agents; sortie = a TestFlight cut. |
| **VR / XR** | Harbor + headset session registry; heavier asset/binary discipline. | Enforce; gate on large-binary + asset-pipeline claims. | Frame budget, asset bake status, headset connection as Watch signals. | Render/bake agents; long-running sorties. |

> The archetype is a **profile object**, not a fork of the code. It maps to:
> guard mode, default fleet template, which Watch signals are surfaced, and
> which Found steps run. New archetypes = new profiles, not new UIs. This keeps
> the surface honest as the tool meets project types it has never seen.

The archetype list above is a starting set; the profile schema must be open so
"some other Port-Daddy-level thing" lands as a profile, not a special case.

---

## 4. The null-state walkthrough (= the tutorial spine)

This is the canonical path the tutorials teach. Every command below must work
from an **empty directory** with only the daemon running. Where a verb is
aspirational (not yet built / renamed), it is marked ⟂.

```
$ mkdir acme-checkout && cd acme-checkout

# ── STAGE 0 · FOUND ──────────────────────────────────────────────
$ pd found --archetype enterprise          ⟂ (unifies init/setup/harbor create)
  ✓ project 'acme-checkout' registered (archetype: enterprise)
  ✓ harbor 'acme-checkout' created (durable workspace)
  ✓ workspace ready at ./ (git init, .portdaddy/ scaffolded)
  ✓ fleet template written: pd-fleet.yml (enterprise preset)
  ✓ coordination guard installed (mode: enforce)
  ✓ roadmap seeded: 1 item ("Decide what acme-checkout is")
  → next: pd orient

# ── STAGE 1 · ORIENT ─────────────────────────────────────────────
$ pd orient                                ⟂ (rolls up status+sitrep+briefing+roadmap)
  state: greenfield · 0 agents · 1 roadmap item · guard: enforce ✓
  next cut: "Decide what acme-checkout is"
  → open the Flow zone: pd open flow   (or FleetBar ▸ Found/Orient)

# ── STAGE 2 · DISPATCH ───────────────────────────────────────────
$ pd dispatch "scaffold a Next.js checkout app"   ⟂ (spawn/sortie unified verb)
  ✓ sortie #1 dispatched → agent acme-checkout:scaffold (backend: claude-cli)
  → watch it: pd watch

# ── STAGE 3 · WATCH ──────────────────────────────────────────────
$ pd watch
  ● acme-checkout:scaffold  RUNNING  2m  ▓▓▓░  writing app/checkout/page.tsx
  (live tail; pheromone trail in the Watch zone)

# ── STAGE 4 · INTERVENE ──────────────────────────────────────────  ⭐
$ pd intervene acme-checkout:scaffold --switch-backend gemini   ⟂
  ✓ agent re-pointed: claude-cli → gemini (this agent only)
  # ^ THE fix for "switch backend for just things not working"
  # also: pd intervene <agent> --retry | --pause | --kill | --reassign

# ── STAGE 5 · LAND ───────────────────────────────────────────────  ⭐
$ pd land                                  ⟂ (guard pre-flight + commit + roadmap pop)
  guard pre-flight:
    ✓ binary/daemon version match (v3.17.0)     ← fixes the drift bug
    ✓ no conflicting claims on staged files
    ✓ roadmap item 'scaffold' satisfied → pop
  safe to commit ✓  → committed, PR opened.

# REMEMBER cross-cuts: pd note / pd memory write happen throughout,
# surfaced in every zone, never a place you "go."
```

The tutorial is literally this transcript with prose between the stages. A
prototype tutorial is the same six stages with `--archetype prototype` and a
shorter Land. A mobile tutorial swaps Dispatch/Watch signals. **The spine never
changes** — that is the whole point, and what makes the tutorials a *series*
instead of six unrelated docs.

### Found must be idempotent and resumable

Tutorials get interrupted; users `^C`. `pd found` re-run on a half-built world
must converge, not error or duplicate (the existing claim/release idempotency
discipline extends here). The "null state" is rarely perfectly null.

---

## 5. Surface map — everything hangs off the loop

### 5.1 Web (`/fleet-ui/`) — the canonical surface

14 tabs → 6 zones. Same names as the loop stages:

| Zone | Folds in today's tabs/panels | New work |
|---|---|---|
| **Found** | *(new)* | Cold-start wizard: archetype pick → harbor/workspace/fleet/guard/roadmap, with the CLI transcript mirrored as a visual checklist. |
| **Orient** | Flow (DAG), Roadmap, Briefing | Fix `RoadmapPanel.tsx:166` scroll. One "what's next" hero. |
| **Dispatch** | Agents (start), Sorties, Shipwright, YAML | One "start work" affordance instead of four tabs. |
| **Watch** | Activity, Events, Channels, Tube, Resources, Metrics | Pheromone trail (from the parallel viz design) lives here. |
| **Intervene** ⭐ | *(absorbs cockpit triage + per-agent actions)* | The action rail: retry · switch backend · pause · kill · reassign. Backed by a real `POST /agents/:id/backend`. |
| **Land** ⭐ | *(surfaces guard, which was invisible)* | Pre-flight panel: version-drift (loud-fail, per ADR-0045), claim conflicts, green/red commit light, roadmap pop. |
| **Remember** | Memory, Inbox | Ambient — a drawer/rail present in every zone, not a tab. |

### 5.2 FleetBar — a thin native shell

- **Popover** = **Orient + Intervene**: glance at fleet health, act fast on a
  red agent (switch backend / kill) without opening the window.
- **Window** = keeps embedding `/fleet-ui/`; its surface-picker mirrors the **6
  zones**, not 11 half-dead surfaces. Dead enum cases are re-pointed or
  hidden from the picker — not removed from the code.
- **Restore backend-switch** as a per-agent action inside **Intervene** — never
  again a deleted global section.

### 5.3 CLI / MCP — keep primitives, add a task layer

Do **not** break the 90 verbs. Instead:

- Add six **loop verbs** as the front door: `pd found`, `pd orient`,
  `pd dispatch`, `pd watch`, `pd intervene`, `pd land`. Each is a thin
  composition over existing primitives (e.g. `pd orient` = status + sitrep +
  briefing + roadmap-head).
- Regroup `pd help` and the MCP "essential" set by the six stages so discovery
  follows the loop.
- Merge obvious synonym pairs over time: `sitrep`/`status`, `inbox`/`channels`,
  `graph`/`ideas`. Old verbs stay as aliases — no flag-day.

---

## 6. What gets demoted (operator rule: DELETE NOTHING)

Consolidation is achieved by **routing and hiding**, never deletion. Every
surface below stays on disk and stays reachable; it just stops being a *primary*
entry point. Nothing is removed, including apps that look dormant.

| Surface | Fate (no deletion) |
|---|---|
| `public/index.html` (deprecated dashboard) | **Demote** to a deep-link / `?legacy=1` route. Its 15 panels are reachable via the 6 zones; the file stays as a fallback. |
| `public/cockpit.html` | **Surface inside** the **Intervene** zone (embed/iframe or shared component). The standalone page keeps working. |
| `public/metrics.html` | **Deep-link from** **Watch**. Untouched on disk. |
| `public/fleet-live.html`, `fleet-config.html`, `app-surgery.html` | **Leave as-is**, unrouted-but-present. Optionally add a "Legacy surfaces" drawer so they're discoverable, not orphaned. |
| FleetBar dead surface enums (Backend/Nightshift/Dispatch) | **Re-point**, don't remove: Backend returns as an Intervene action; Nightshift/Dispatch enum cases stay until their replacement is proven, then become aliases. |
| `apps/github-app-fleet/` and any other app | **Do not touch.** Out of IA scope. Dormant ≠ deletable. |

If something genuinely must go, that is a *separate*, explicit, operator-approved
decision — never a side effect of this refactor.

---

## 7. The three bugs, in the new frame

These are independently shippable *now* and de-risk the refactor:

1. **Roadmap scroll** — `RoadmapPanel.tsx:166`: drop `overflow-hidden` from the
   `h-full` flex parent (the inner `overflow-auto` at line 197 is correct).
   ~1 line. Belongs to **Orient**.
2. **Guard drift** — `cli/commands/guard.ts`: add a binary↔daemon version check
   before evaluating claims (guard currently skips the freshness gate as a
   Tier-1 command); collapse the two config paths to one; make the loud-fail
   surface in **Land**. ~½ day.
3. **Switch backend** — new `POST /agents/:id/backend` + Intervene action rail;
   this is the **Intervene** zone's first real capability, and the headline of
   the whole refactor.

---

## 8. Open questions for the build phase

1. **Verb naming.** `found` vs `init` vs `new`? `dispatch` vs `spawn`? The loop
   names are clean but collide with muscle memory. Aliases solve it, but the
   *primary* name shown in help matters for the tutorials.
2. **Archetype detection vs declaration.** Does `pd found` ask, or sniff
   (package.json → mobile/web, `*.unity`/`*.xcodeproj` → VR/iOS)? Probably:
   sniff, then confirm.
3. **Per-agent backend mechanics.** Live re-point of a running agent, or only
   on retry/respawn? The deleted code only did global env + restart; live
   re-point is a real runtime change to the spawner.
4. **Remember as a rail.** Is "ambient memory present in every zone"
   buildable without it becoming noise? Needs a UX pass.
5. **Migration ordering.** Ship the six loop verbs first (cheap, additive),
   then the zone re-layout, then the deletions? Or zones first?

---

## 9. Next steps

1. Land the **three bug fixes** as standalone PRs (scroll, guard drift,
   `POST /agents/:id/backend` + minimal Intervene rail). Proves the frame.
2. Write the **ADR** that promotes this from design to decision (archetype
   profile schema is the load-bearing part).
3. Prototype the **Found** wizard + `pd found` against one archetype
   (enterprise) end-to-end — that *is* the first tutorial.
4. Re-layout `/fleet-ui/` into the 6 zones behind a flag; demote (do not
   delete) the legacy surfaces — route them behind deep-links / a legacy drawer.
