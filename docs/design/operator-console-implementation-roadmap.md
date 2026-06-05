# Operator Console — Implementation Roadmap

Sequences the design arc into a buildable order: **ADR-0046** (Operator TUI /
conversation multiplexer), **ADR-0047** (Conversation Protocol), the **living
harbor** (v10 mockup), and the foundational prerequisites. The `roadmap_items`
table (ADR-0033) is the source of truth; this is the *sequenced view* over it,
with the critical path, the parallel tracks, and the honest gates.

> Naming: "the operator console" = the shipped thing the mockups (v1–v10) and
> ADR-0046 describe. `core/pd-tui` is its codename.

---

## Gate 0 — the platform decision (BLOCKING; needs an ADR + operator sign-off)

Everything downstream depends on this, and it is genuinely open. The mockups are
**HTML**; ADR-0046 says **ratatui** (`core/pd-tui`); the living-harbor motion
(WebGL fireflies, particle physics, dithered waves) is **web-native and hard in a
pure terminal**.

| Option | Gets the rich harbor? | Always-on / low-friction? | Cost |
|---|---|---|---|
| **A. Pure ratatui** (terminal) | Partial — braille/half-block/octant only (the original TUI mocks proved a lot is possible) | Yes — `pd tui`, zero install | Medium; the firefly/WebGL motion is constrained |
| **B. Tauri desktop** (webview wraps the v10 HTML harbor) | **Yes** — full motion, the v10 art ships ~as-is | Desktop app; FleetBar already establishes a native surface | Medium-high; a real app to build/notarize |
| **C. Hybrid (recommended)** | **Yes** in the Tauri harbor; ratatui `pd tui` as the lightweight always-available operator | Both | Highest, but each half is independently useful |

**Recommendation: C, sequenced as B-first.** Ship the **Tauri harbor** (the v10
art is already the design) as the rich console, and keep a thin **ratatui `pd tui`**
(Attention Queue + dispatch + sortie threads, no particle viz) as the always-on,
SSH-able fallback. They share the daemon + the design tokens + the conversation
protocol. **Write ADR-0048 to lock this**, then build.

---

## The critical path (what unblocks what)

```
GATE 0  platform decision (ADR-0048)
   │
FOUNDATION ──┬─ ADR-0047 P0  typed performative envelope on tube  ← the semantic spine
             ├─ daemon endpoints: /attention (live), pd ask/escalations (NEW),
             │   /sorties live (live), typed-comms SSE stream (NEW)
             ├─ ADR-0046 P4  canonical token mirror (kill the cinnabar fork)
             └─ platform shell (Tauri scaffold + ratatui scaffold)
   │
WAVE 1  the spine ─┬─ ADR-0047 P1 protocol registry  (+ P2 delegation-chain, P3 commitment-GPGP)
                   └─ ADR-0046 P0 multiplex shell  +  P3 Attention Queue (Distress/Requests/Signals)
   │
WAVE 2  reach-in + autonomy ─┬─ ADR-0046 P1 avatar dispatch (= Contract Net, 0047 P1)
                             ├─ ADR-0046 P2 pheromone spray  +  P5 code-heat context
                             ├─ ADR-0047 P4 deontic + per-dialogue termination
                             └─ ADR-0046 P6 avatar autonomy loop (gated by pd attest + HiTL)
   │
WAVE 3  the living harbor ─┬─ ADR-0047 P5 render typed comms (each visual = a performative)
                           ├─ living harbor: fireflies/worktree-planes/pheromone-glow/merge-light
                           └─ ADR-0046 P7 feel pass + 15-persona blind-test
```

**Two things gate the whole build and aren't yet built:** (1) the **typed
performative envelope** (ADR-0047 P0) — without it every comm is opaque and the
harbor is Potemkin; (2) the **daemon endpoints** the reach-in actions read/write
(`pd ask`/escalations + a typed-comms SSE stream are NEW routes). Do these first.

---

## Waves (each ships something usable; tracks run in parallel worktrees)

### Foundation (≈1–2 weeks) — sequential-ish, highest leverage
1. **ADR-0048 platform decision** (Gate 0) — short, blocking.
2. **`adr-0047-phase-0-performative-envelope`** — typed tube envelope (`performative
   + conversationId + delegationChain`), tolerant decoder (untyped → `inform`).
3. **Daemon endpoints** (new roadmap items): `pd ask` + `escalations` route;
   `GET /comms/stream` SSE of typed performatives; confirm `/attention`, `/sorties`,
   `/harbors`, `/roadmap/items` cover the reach-in reads.
4. **`adr-0046-phase-4-canonical-token-mirror`** — generate Rust/Swift/TS token
   mirrors from `tokens.semantic.css`; delete `design/tokens/primitives.json`.
5. **Platform shell** — Tauri scaffold (loads v10 harbor) + ratatui scaffold.
   *Milestone: a window/terminal that reads live daemon state.*

### Wave 1 — the spine (parallel: Track-Protocol + Track-Console)
- **Track-Protocol:** `adr-0047-phase-1-protocol-registry` (Contract-Net dispatch
  + supervisor-worker sortie threads + critique-refine review, each with stop
  conditions) · `…-phase-2-delegation-chain` · `…-phase-3-commitment-gpgp`.
- **Track-Console:** `adr-0046-phase-0-conversation-multiplex-shell` (avatar +
  agent-chat panes) · `adr-0046-phase-3-hitl-roadmap-fleet-strips` (**the Attention
  Queue** — the doctrine's step 1; reorganize, don't add tiles).
- *Milestone: you can watch ≥2 real agent threads + a live triaged Attention Queue.*

### Wave 2 — reach-in + autonomy (parallel: Track-Reach + Track-Autonomy)
- **Track-Reach:** `adr-0046-phase-1-avatar-dispatch-loop` (uses Contract-Net) ·
  `…-phase-2-pheromone-spray-action` · `…-phase-5-code-heat-context-inline`.
- **Track-Autonomy:** `adr-0047-phase-4-deontic-termination` (obligation→commitment,
  prohibition→Arbiter, permission→capability; quiescence/TTL/HiTL termination) ·
  `adr-0046-phase-6-avatar-autonomy-loop` (roadmap→PR→test→merge→done, `pd attest`-gated).
- *Milestone: talk to the avatar → it dispatches via Contract-Net → you steer with
  a spray → one roadmap item goes `now`→`done` through the console with HiTL gates.*

### Wave 3 — the living harbor + feel (parallel: Track-Harbor + Track-Feel)
- **Track-Harbor:** `adr-0047-phase-5-render-typed-comms` (wire the performative
  SSE into the harbor — firefly/laser/leaf/merge-flash = real `cfp`/`request`/
  `inform`/`finalize`) · the v10 living-harbor motifs hardened (stacked ghost
  worktree planes as stage, pheromone-glow rows, merge-as-light, fireflies-seek).
- **Track-Feel:** `adr-0046-phase-7-feel-and-blindtest` (motion/sound/reduced-motion,
  14px floor, 15-persona blind-test as the merge gate).
- *Milestone: the harbor renders a real, typed, live comms stream you'd leave on a
  second monitor — non-Potemkin.*

---

## Honest gates & risks (carry these, don't paper over)
- **Daemon endpoints are the Potemkin line.** The reach-in actions are only real
  with `pd ask`/escalations + the typed-comms SSE. Until then: designed, mock,
  VISION-labeled. *(Foundation step 3 closes this.)*
- **The mute compiled `pd` in agent/sandbox contexts** (a bun-stdio issue, not
  user-facing) means fleet agents must coordinate via the daemon, not the CLI —
  and `pd attest`'s `liveness.cli-self-speech` invariant (#242) now flags it. The
  autonomy loop (Wave 2) must talk daemon-routes, not shell out to `pd`.
- **`pd spawn` was fail-closed** (telemetry); #237 unblocked it in code — the live
  daemon needs a rebuild before the autonomy loop can dogfood-spawn.
- **Several harbor surfaces are V4 vision** (anchor protocol, multi-device
  presence, credits/brig) — they render as labeled VISION, not built, until their
  whitepapers ship.

## How to run it
Per-track worktrees off the relevant branch; each wave's tracks in parallel;
merge gate = the headless gauntlet (themes × views × motion × 14px floor ×
console-clean) + the blind-test for console work, and "Done when" + a live-daemon
smoke for protocol/daemon work (ADR-0043 matrices already carry these). The
`roadmap_items` `now` pile is the live queue; this doc is the sequence.
