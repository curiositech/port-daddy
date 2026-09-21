# Multi-Agent Telemetry & Active Sheaf Cohomology: Wireframes & User Stories

> **Epistemic Thesis**: A multi-agent dashboard must not be a static collection of disconnected cards. It must be an **integrated cognitive instrument of causal playback**—visually juxtaposing continuous mathematical invariants ($r(t)$, $\mathcal{L}(g)$) against discrete physical side-effects (AST lock leases, FIPA communicative arcs, file mutations, and human disruptions).

---

## 1. Synthesis of Foundational Literature & References

### A. Edward Tufte & Data-Ink Maximization (`tufte-principles.md`)
1. **Eradication of "Chartjunk" & Card Nesting**: The current UI suffers from low data-ink ratio (~0.25)—thick rounded container borders, vast empty dark-blue panels, redundant headers, and detached metrics. 
2. **Micro-Visualizations & Sparklines**: Replace static numeric cards with data-dense inline sparklines showing direction of change, 95th percentile bands, and min/max thresholds embedded directly beside metric labels.
3. **Integrated Direct Labeling**: No detached color legends requiring mental lookup. In the topological graph and timeline swimlanes, identities, models (`deepseek-chat`, `gpt-4o-mini`, `gemini-1.5-flash`), and AST symbol paths (`src/auth.ts::handleRegistration`) are rendered directly adjacent to their glyphs.

### B. Narrative Arc & Data Storytelling (`data-storytelling.md`)
Every run through the swarm tells a dramatic story with a 4-act narrative arc:
```
1. HOOK       → E0: Swarm launches; r(t) = 0.0000. Calm consensus.
2. CONTEXT    → E1-E2: SecDev claims auth.ts; AuthDev attempts concurrent lease.
3. DISRUPTION → E3: "Messy Human" interrupts; injects race condition. r(t) spikes to 45.3!
4. RESOLUTION → E4: CR-4 Min-Cut fences rogue lease; residual drops to 0.0000. Consensus restored.
```
**Insight-First Framing**: The top summary banner must never just say "CONSENSUS ACTIVE 0.0000". It must declare the **System Invariant Diagnosis**:
> *"Epoch 3 Anomaly: High-Curl Conflict on `src/auth.ts::handleRegistration` ($r=45.27$, $\mathcal{L}=0.67$). Resolved via CR-4 Min-Cut fencing."*

### C. Designing Data-Intensive Applications (DDIA / Martin Kleppmann)
1. **The Immutable Event Log as Source of Truth (Chapter 11)**:
   - State is not mutable memory; state is a **deterministic projection of an append-only event stream**.
   - The UI provides an interactive **Time-Travel Scrubber**: dragging the playhead to any millisecond $t$ re-evaluates the boundary operators $\delta_0(t), \delta_1(t)$, re-projects the cochain $g_K(t)$, and reconstructs the AST lease table and file system state.
2. **Causal Consistency & Happens-Before Order (Chapter 9)**:
   - Agent actions are not independent; they form a Directed Acyclic Graph (DAG) of causality. If Agent $A$ acquires an exclusive lock, Agent $B$'s subsequent request happens-before Agent $C$'s review rejection.
   - We render **Causal Arcs** (bezier curves) connecting communicative acts across agent tracks.
3. **Leases, Fencing Tokens, and In-Doubt States (Chapter 9)**:
   - Visualizing locks requires showing their full lifecycle: *Requested $\to$ Granted $\to$ Contested $\to$ Expired $\to$ Revoked/Fenced*.
   - When an agent is fenced (e.g. AuthDev after the race injection), its lease ribbon displays a visual fracture glyph with a red fencing strike-through.

### D. Motion & Temporal Pacing (`data-viz-commercials`)
- Synchronized playhead that links the continuous line graph, the discrete agent Gantt swimlanes, the topological complex, and the terminal log.
- Smooth transitions via `selection.join()` with spring physics when nodes transition from *Idle $\to$ Thinking $\to$ Contended $\to$ Fenced*.

---

## 2. User Personas & User Stories

### Persona 1: Sarah — Autonomous Fleet Operator ("The Messy Human")
- **Profile**: Manages 10-50 concurrent coding agents across a monorepo. Frequently injects priority overrides, changes requirements mid-flight, and needs to know if agents are stepping on each other's toes.
- **Pain Point**: "I have no idea if two agents are silently editing the same TypeScript function until git merge conflicts blow up or CI fails."
- **User Story 1.1**: *As a fleet operator, I want to see an immediate visual clash indicator when two agents attempt to claim overlapping AST symbols, so that I can see the contention before files are corrupted.*
- **User Story 1.2**: *As a fleet operator, I want to hover over an alarm spike on the timeline and immediately see which human or agent action caused the disruption, so that I understand why the swarm diverged.*

### Persona 2: Dr. Aris Thorne — Distributed Systems & AI Researcher
- **Profile**: Evaluating active cellular sheaf cohomology as a mathematical framework for multi-agent coordination. Reads the preprint paper and wants to empirically verify the theorems.
- **Pain Point**: "Authors claim acyclic trees are mathematically blind ($r_{\text{tree}} \equiv 0$) while simplicial complexes with 2-simplices catch micro-contract breaches. I want to see the two mathematical comparators side-by-side on identical live data."
- **User Story 2.1**: *As a researcher, I want a juxtaposed comparator showing $r(t)$ alongside $r_{\text{tree}}(t) \equiv 0$, so that I have undeniable visual proof of tree blindness.*
- **User Story 2.2**: *As a researcher, I want to inspect the Simplicial Hodge Decomposition ($\operatorname{im} \delta_0 \oplus \ker L_1 \oplus \operatorname{im} \delta_1^*$) and Swarm Legibility Ratio $\mathcal{L}(g)$ for any selected epoch, so that I can formally classify errors into macro network cavities vs. micro AST lease breaches.*

### Persona 3: Marcus — Incident Responder & Reliability Engineer
- **Profile**: Audits agent safety, security boundaries, and spend caps.
- **Pain Point**: "When an agent hallucinates or goes rogue, I need to replay the execution turn-by-turn to audit the prompt, the tool calls, the communicative acts, and the file side-effects."
- **User Story 3.1**: *As an auditor, I want a scrubbable timeline with playback controls (Play, Pause, Step-Forward, Step-Back) that rewinds the entire swarm state to any epoch, so that I can perform post-mortem root cause analysis.*
- **User Story 3.2**: *As an auditor, I want to see the tangible side effects (files modified, lines added/deleted, external API calls, cost accrued) attached directly to each agent's timeline track.*

---

## 3. Visual Juxtaposition Architecture

To eliminate cognitive fragmentation, the interface is organized into **Three Horizontally Aligned, Causally Linked Horizons**:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ HORIZON 1: THE INVARIANT & ALARM PLANE (Continuous Mathematics)                             │
│ • Synchronized Shared X-Axis (Time t / Epochs E0 → E4)                                      │
│ • Dual-Area Trajectory: Sheaf Residual r(t) [Crimson/Green] vs Tree Comparator [Cyan Blind] │
│ • Event Annotations & Hodge Spectral Decomposition Badges (Gradient / Harmonic / Curl)      │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ HORIZON 2: THE CAUSALITY & SIDE-EFFECT SWIMLANES (Discrete Agent Operations)                │
│ • Identical X-Axis Alignment with Horizon 1                                                 │
│ • Agent Tracks: v0 Coordinator | v1 SecDev | v2 AuthDev | v3 RedTeam | v4 Auditor           │
│ • State Ribbons: Planning | Coding | Reviewing | Waiting                                    │
│ • AST Lock Brackets: Held symbol leases with conflict highlights                            │
│ • Causal Bezier Arcs: Cross-agent FIPA message exchange & Human Disruption injection        │
│ • Side-Effect Badges: File diffs (+42/-12), Commits, API Spend ($)                          │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ HORIZON 3: THE TOPOLOGICAL & REPLAY STATE (Spatial & Symbolic Projections at Time t)        │
│ ┌──────────────────────────────────────┐ ┌───────────────────────────────────────────────┐ │
│ │ 2D Simplicial Complex Graph          │ │ Side-Effect & Contract Inspector              │ │
│ │ • Nodes = Agents (Status, Model, V)  │ │ • AST Lease Ownership Table                   │ │
│ │ • Edges = Cochain Tension ||g_e||    │ │ • Causal Event Log Stream (FIPA Speech Acts)  │ │
│ │ • Triangles = Circulation Curl       │ │ • Prompt & Tool Call Inspection Drawer        │ │
│ └──────────────────────────────────────┘ └───────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Visualizing Agent Timelines & Side Effects: The Causality Ribbon

### The Anatomy of an Agent Track
Rather than simple bars, each agent's timeline track contains **three stacked visual registers**:

```
[Agent Label & Model]  [00:00]              [00:05]         [00:10]                   [00:15]
v1: SecDev             ├── PLANNING ────────┼─── CODING ────┼──── REVIEW ─────────────┤
DeepSeek-V3 ($0.002)   │                    │ [auth.ts: EXCLUSIVE]                    │
                       │                    │   ├── 📝 +45/-12 lines                  │
                       │                    │   └── 💬 INFORM(v0) ────────╮           │
                       │                    │                             │ (Causal Arc)
v2: AuthDev            ├── IDLE ────────────┼────────── CODING ───────────▼───────────┤
GPT-4o-mini ($0.004)   │                    │ [auth.ts: CONTESTED! ⚡]                 │
                       │                    │   └── ⚠️ 409 Lock Clash!                 │
                       │                    │   └── 🛡️ CR-4 Fenced!                   │
```

### Visual Encodings for Side Effects
1. **AST Leases**: Rendered as a distinct under-ribbon. Green outline = Shared lock. Solid violet = Exclusive lock. Pulsing flashing crimson with hazard stripes = Contested collision.
2. **File & AST Modifications**: Rendered as micro-badges directly below the coding span: `📝 auth.ts (+38/-4)`. Hovering reveals the unified diff.
3. **Communicative Acts (FIPA)**: Rendered as directional dot-anchored cubic Bezier curves originating from the sender track at time $t_{\text{send}}$ and terminating at the receiver track at time $t_{\text{recv}}$.
4. **Human Interruption ("Messy Human")**: Rendered as a vertical amber lightning needle dropping from the top margin across all tracks, labeled with the operator's exact disruption prompt.
5. **Coast Guard / Min-Cut Fencing**: Rendered as an octagonal shield glyph with a red diagonal line across the agent's active lease, indicating the spawner has clamped process execution.

---

## 5. ASCII High-Density Wireframes

### Wireframe A: Master Viewport Layout (1440px Desktop)

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ⚓ PORT DADDY // SWARM COHOMOLOGY CONTROL PLANE          [● LIVE PLAYBACK] [⏮ ◀ ❚❚ ▶ ⏭] [1x ▾]   2026-09-19T09:25:00Z  ⚙ │
├───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [SYSTEM DIAGNOSIS] ⚡ EPOCH 3 CONFLICT DETECTED & RESOLVED                                                                 │
│ Invariant: r(t) = 45.2714 (High-Curl AST Collision) ──► Fenced by CR-4 Greedy Min-Cut ──► E4 Restored to r = 0.0000     │
├───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ HORIZON 1: COHOMOLOGICAL RESIDUAL & TREE BLINDNESS INVARIANT                                   [Zoom: Fit | 1m | 5m | All] │
│ 50 ┼                                                                                   ▲ E3: Race Injected                │
│    │                                                                                  ╱ ╲  r = 45.27                      │
│ 25 ┼                                                                                 ╱   ╲  r_tree = 0.00 (Blind!)        │
│    │                                                                                ╱     ╲                               │
│  0 ┼────●─────────────────────────●──────────────────────────●─────────────────────●       ●────── [r(t) Cohomology]     │
│    └────┴─────────────────────────┴──────────────────────────┴─────────────────────┴───────┴────── [r_tree Tree Baseline] │
│       E0: Launch               E1: Auth Spec              E2: Lock Clash        E3: Chaos E4: Restored                    │
│       [r = 0.0000]             [r = 0.0000]               [r = 0.7493]         [r = 45.27] [r = 0.0000]                   │
├───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ HORIZON 2: AGENT CAUSALITY SWIMLANES & SIDE-EFFECT REGISTERS                                              [Synchronized]  │
│                                                                                    │ (Playhead Needle @ E3.2)             │
│ v0 Coordinator  [  PLANNING  ]───►[ DELEGATING ]──────────────────────[ AUDIT ]────┼──────────────────[ HARVEST ]──────── │
│    Claude-3.5-S  💬 PROPOSE ──╮         💬 DISPATCH ──╮                            │                                      │
│                               │                       │                            │                                      │
│ v1 SecDev       [   IDLE     ]│  [   CODING: auth.ts   ]─╭─────────────────────────┼──────[ VERIFIED COMMIT ]──────────── │
│    DeepSeek-V3                ╰─►│ [AUTH.TS: EXCLUSIVE] ││ 💬 INFORM(v0)           │      📝 git: 4bc6690 (+42/-8)        │
│                                  └─── 📝 +42/-8 lines ──┘│                         │                                      │
│                                                          │ (Contention Arc)        ▼ (Operator Bomb Injected!)            │
│ v2 AuthDev      [   IDLE     ]───────────────────────────┴──►[ ⚡ CONTESTED LEASE ]══════[ 🛡️ FENCED / REVERTED ]─────── │
│    GPT-4o-mini                                               │ [AUTH.TS: CLASH!]  │                                       │
│                                                              └─── 📝 +18/-0 lines ┘                                       │
│                                                                                                                           │
│ v3 RedTeam      [   IDLE     ]──────────────────────────────────────────────[ FUZZING & REVIEW ]───────────────────────── │
│    Gemini-Flash                                                             └── 💬 REJECT(v2): Equivocation detected      │
├───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ HORIZON 3: SPATIAL SIMPLICIAL TOPOLOGY & LOGICAL STATE INSPECTION                                                         │
│ ┌─────────────────────────────────────────────────────────┐ ┌───────────────────────────────────────────────────────────┐ │
│ │ 2D SIMPLICIAL COMPLEX TOPOLOGY (t = E3.2)               │ │ ACTIVE CONTRACT & SIDE-EFFECT INSPECTOR                   │ │
│ │                                                         │ │                                                           │ │
│ │                    (v0 Coordinator)                     │ │ Active AST Leases:                                        │ │
│ │                         ●                               │ │ • src/auth.ts::handleRegistration                         │ │
│ │                        ╱│╲                              │ │   Holder: v1 SecDev (EXCLUSIVE, Epoch 1)                  │ │
│ │                       ╱ │ ╲                             │ │   Contender: v2 AuthDev (REJECTED, 409 Conflict)          │ │
│ │                      ╱  │  ╲                            │ │                                                           │ │
│ │                     ╱   │   ╲                           │ │ Simplicial Hodge Spectral Class (E3):                     │ │
│ │                    ╱    │    ╲                          │ │ • Gradient Component (im δ₀) : ||grad|| = 1.414           │ │
│ │    (v1 SecDev)    ●═════╪═════● (v2 AuthDev)            │ │ • Curl Component (im δ₁*)    : ||curl|| = 44.821          │ │
│ │                   │ ╲ ▲ │   ▲ │ [FENCED]                │ │ • Harmonic Component (ker L₁): ||harm|| = 0.812           │ │
│ │                   │  ╲│ │  ╱  │                         │ │ • Legibility Ratio L(g)      : 0.671 (Micro-Contract)     │ │
│ │                   │   ╲ │ ╱   │                         │ │                                                           │ │
│ │                   │    ╲│╱    │                         │ │ Causal Speech-Act Stream:                                 │ │
│ │                   ●─────●─────●                         │ │ [E3.01] ⚡ OPERATOR: "Cancel auth, reassign to v2 right now!"│
│ │               (v3 Red) (v4 Aud)                         │ │ [E3.04] v2 AuthDev requests EXCLUSIVE on handleReg       │ │
│ │                                                         │ │ [E3.05] ⚠️ AST Engine: 409 Conflict (Held by v1 SecDev)  │ │
│ │ Legend: ═ Contested Edge | ▵ Shaded Face (Curl) | ● Node│ │ [E3.08] v3 RedTeam: REJECT(v2) Signature mismatch         │ │
│ └─────────────────────────────────────────────────────────┘ └───────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Implementation Architecture & Interaction Specifications

### 1. Dual-Axis Temporal Scrubbing
- Dragging the playhead needle horizontally scrubs all three horizons in lockstep ($< 16$ms frame latency via Canvas 2D or optimized D3 transitions).
- Keyboard shortcuts: `Space` = Play/Pause, `Left/Right` = Step 1 turn, `Home/End` = Jump to Start/End, `1-4` = Jump directly to Epoch milestones.

### 2. Micro-Interaction: Contested Edge Hover
When hovering over the contested edge $(v_1, v_2)$ in the simplicial graph:
- The exact cochain tension vector $g_e = g(v_1, v_2)$ is highlighted with a floating tooltip.
- The corresponding AST lease in the table flashes gold.
- Horizon 2 highlights the exact causal arc where Agent $v_2$ attempted the competing write.

### 3. Accessible Responsive Strategy
- **Wide Screens (> 1200px)**: Full three-horizon stacked layout with side-by-side topology and contract inspector.
- **Laptop / Tablet (768px - 1200px)**: Simplicial graph and inspector collapse into a tabbed split view; timeline swimlanes collapse secondary metadata into expandable agent drawers.
- **Mobile (< 768px)**: Summary story card on top; sparkline overview; vertical expandable agent event list.
