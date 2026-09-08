# pd-console — Information Architecture & User Stories

*Design pass before building more. The console is the **single operator seat** that
replaces driving Port Daddy from the CLI. Everything below serves one person — the
operator — running a fleet of AI agents.*

---

## 1. The operator loop (what the job actually is)

```
   SEE ──▶ JOIN ──▶ STEER ──▶ (LAND) ──▶ remember
    ▲                                       │
    └───────────── SPAWN ◀──────────────────┘
```

Eight jobs, in priority order:

| # | Story | "I want to…" | Today |
|---|-------|--------------|-------|
| **S1** | **See the fleet** | glance at every agent and instantly know who's running, blocked, or *waiting on me* | Fleet pane exists but is a flat block list, not a roster |
| **S2** | **Join a session** | drop into an agent's live chat, beautifully formatted; ↑/↓ to pick, **Enter** to dive in, **←** to back out | `AgentTranscript` surface + SSE exist; list→detail join, selection cursor, and role bubbles now work |
| **S3** | **Steer** | grab the wheel: send a message, interrupt, approve/deny a HITL ask, pause/resume | Interrupt, compose/send, and inline HITL approve/adjust/deny now work |
| **S4** | **Spawn** | start a new session (provider+tier+goal) and *immediately watch it run* | Spawn picker exists and now auto-joins the exact new agent on success |
| **S5** | **Decide** | answer agents that are blocked on me — as one-decision cards | Alerts/HITL surface exists (#22); not fed by real escalations |
| **S6** | **Land** | review & merge what they finished (diffs, accept/reject) | Dispatch review gate scaffolded; not the queue |
| **S7** | **Govern** | see today's spend, per-project burn, set budgets | Cost surface exists, needs the roster treatment |
| **S8** | **Sight/Remember** | the context: roadmap, claims, ADRs, activity, memory | 7 separate panes — too fragmented |

**The hero is S1→S2→S3.** That's the "see the fleet and join in" the operator keeps asking
for. Build that flow to delight first; everything else hangs off it.

---

## 2. Page consolidation — 21 surfaces → 6 pages + System

The current 21 NAV items are noise. Most operators never touch 15 of them, and the
overlap (Fleet/Lane/Sessions/Conductor all = "agents"; Roadmap/Claims/ADRs/Activity/
Lineage/Memory/PRs all = "context") makes the rail unreadable. Collapse to **6 primary
pages** in the nav rail, each absorbing its neighbors:

| Page | Absorbs (today's surfaces) | Is |
|------|----------------------------|----|
| **① Fleet** *(home)* | Fleet, Lane, Sessions, Conductor | the agent roster + live-chat detail (S1–S3) |
| **② Dispatch** | Dispatch, Sorties, Cockpit, the Spawn flow | one place to launch *and* review work (S4, S6) — finishes #41 |
| **③ Decisions** | Alerts/HITL, Suggest, Inbox | the cards where agents wait on you (S5) |
| **④ Cost** | Cost/ledger, wallets, bonds | spend hero + budgets (S7) |
| **⑤ Map** | Roadmap, Claims, ADRs, Activity, Lineage, PRs, Memory | the context atlas (S8) — tabbed inside |
| **⑥ System** | Health, C.Guard, Substrate, Peek | daemon/coordination health — mostly a status strip |

The nav rail (just built) slims from 21 rows to **6**. The absorbed surfaces become
*tabs or sections inside* their parent page, not top-level noise.

---

## 3. The navigation model (GUI-first, chords retired)

- **Left nav rail** → the 6 pages. **Click** to switch. (No `Ctrl-A`.)
- **Inside Fleet** → master/detail:
  - **↑/↓** move the selection cursor in the roster (visible highlight).
  - **Enter** *or* **click a row** → join → the chat detail fills the pane.
  - **←** *or* **Esc** *or* a visible **‹ Back** chip → return to the roster.
- Keyboard chords (`Ctrl-A …`) still *work* for power use but are **never shown and never required**.
- Every action that exists as a key also exists as a **visible, clickable control**.

This is the distinction the operator drew: arrow/Enter/Back *inside a visible list* is
discoverable GUI navigation (good); a hidden leader-key with memorized syntax is not (bad).

---

## 4. Mockups

### ① Fleet — home (roster view)  ·  S1

```
┌─ NAVIGATE ─┬──────────────────── FLEET · 5 agents ─────────────── [ + New session ]─┐
│ ▸ Fleet    │  ●  copy-humanizer        running   · port-daddy  · edited 3 files   $0.42 │
│   Dispatch │ ▸●  cartographer-map       BLOCKED→you· port-daddy  · awaiting answer  $1.10 │  ◀ cursor
│   Decisions│  ◐  release-3.21            running   · port-daddy  · CI green          $0.08 │
│   Cost     │  ○  spider-wave-12          done      · windags     · merged #519      $2.30 │
│   Map      │  ◐  pd-copy-pm              running   · expungement · reviewing PR      $0.55 │
│   System   │ ─────────────────────────────────────────────────────────────────────────  │
│            │  ↑/↓ select   ⏎ join   ⟵ back        2 waiting · 3 running · today $4.45    │
└────────────┴──────────────────────────────────────────────────────────────────────────┘
```
- State dot: ● running · ◐ working · ○ done · **▸● = blocked on you** (mayday-pink, sorts to top).
- Row = name · state · project · last-activity · cost. Click or **⏎** dives in.

### ① Fleet — joined (live chat detail)  ·  S2 + S3

```
┌─ NAVIGATE ─┬─ ‹ Back   cartographer-map · BLOCKED→you · port-daddy ─────── ◼ Interrupt ─┐
│   Fleet    │                                                                             │
│   …        │   ┌ you ─────────────────────────────────────────────┐                     │
│            │   │ map the V4 roadmap and find the hottest lane      │                     │
│            │   └───────────────────────────────────────────────────┘                    │
│            │            ┌ cartographer-map ──────────────────────────────────────────┐  │
│            │            │ Reading docs/V4-UNIFIED-ROADMAP.md … Phase 3 is hottest with │  │
│            │            │ 9 curated items.                                             │  │
│            │            │  ⌁ tool  grep "now" roadmap_items → 34 hits                  │  │
│            │            └──────────────────────────────────────────────────────────────┘ │
│            │   ▌ DECISION  "Capture Operator Tooling Arc as a parallel track?"            │
│            │   ▌          [ Approve ]  [ Adjust… ]  [ Deny ]                              │  ◀ inline HITL
│            │ ───────────────────────────────────────────────────────────────────────────│
│            │  › type a message to cartographer-map…                            [ Send ]  │
└────────────┴──────────────────────────────────────────────────────────────────────────┘
```
- Role-colored bubbles (you = mustard edge, agent = panel). Tool calls = monospace `⌁` rows.
- Streams live (SSE). Compose box + **Interrupt** always reachable. HITL asks render **inline as cards** *and* collect in ③ Decisions.

### ② Dispatch — spawn + review, unified (S4 + S6)

```
┌── DISPATCH ───────────────────────────────────────────────────────────────────────┐
│ [ Launch ▾ ]  provider ‹Claude ▾›  tier ‹high·opus-4-8 ▾›  goal […………]  [ Spawn ▶ ] │
│ ─ Review queue (3 awaiting you) ──────────────────────────────────────────────────  │
│  ▸ copy-humanizer   PR #371  +142/-30  3 files   [ Diff ] [ Accept ✓ ] [ Reject ✕ ] │
│    spider-wave-12   PR #519  +88/-12   1 file    [ Diff ] [ Accept ✓ ] [ Reject ✕ ] │
└────────────────────────────────────────────────────────────────────────────────────┘
```

### ③ Decisions (HITL cards) · ④ Cost · ⑤ Map — sketch
- **Decisions**: one card per blocked agent — question, context, `[Approve] [Adjust] [Deny]`; clears on answer; deep-links to the agent's chat.
- **Cost**: today's-spend hero number, per-project burn bars, budget caps with `[Set budget]`.
- **Map**: tabbed `Roadmap | Claims | ADRs | Activity | PRs | Memory` — the context atlas, not 7 rail items.

---

## 5. Build order (after sign-off)

1. **Fleet roster** — real selectable/clickable rows, state dots, ↑/↓ cursor, blocked-sorts-top (S1).
2. ✅ **Join + live transcript detail + steering** — Enter/click → bound `AgentTranscript`, ←/Esc back to Fleet, type+Send publishes to `agent:<id>`, role bubbles render the stream, inline HITL cards answer over the same tube (S2/S3). *The hero.*
3. ✅ **Spawn auto-joins** the new agent (S4 → S2) via the spawn success alert's exact `join_agent_id`.
4. Slim the nav rail to the 6 pages; absorb the rest as tabs.
5. Dispatch review queue (S6), Decisions cards (S5), Cost roster (S7), Map tabs (S8).

*Open question for the operator: does the 21→6 consolidation feel right, or are there
surfaces in the "absorbed" column you want to keep as first-class rail items?*
