# Port Daddy V3.7: The "Cute & Charming" Agentic Control Plane

## Vision
Define an industry-standard for Agentic OS interfaces that is both **Ambitious** (high-fidelity, real-time, complex) and **Charming** (approachable, playful, "purring").

## 1. Visual DNA (The Vibe)

| Attribute | Specification | Rationale |
|-----------|---------------|-----------|
| **Core Palette** | `oklch(25% 0.05 260)` (Slate Base) <br> `oklch(70% 0.15 190)` (Glow Teal) <br> `oklch(85% 0.20 85)` (Sunny Amber) | Sophisticated dark mode with "neon-cute" highlights. |
| **Typography** | Header: **Geist Bold** (Tight tracking) <br> Body: **Geist Regular** <br> Data: **Geist Mono** | Modern, clean, and highly readable. |
| **Corner Radius** | `24px` (3xl) minimum for cards | Softens the "technical" edge, making it feel "charming". |
| **Interactions** | Spring: `stiffness: 400, damping: 25` | "Snappy but soft" motion that feels like a physical toy. |

## 2. Maritime Signal Flags 🚩

Maritime flags are not just decoration; they are **Semantic Indicators**:
- **Flag P (Pilot):** Indicates a "Master" or "Orchestrator" agent is active.
- **Flag D (Daddy):** Indicates the core Daemon is healthy.
- **Flag O (Man Overboard):** Indicates an agent has died and needs **Salvage**.
- **Flag U (Standing into Danger):** Indicates a **Lock Conflict** or rate limit.

## 3. Component Patterns

- **The "Bento Harbor":** A grid of soft-rounded cards that group agents by harbor. Use `glassmorphism` with a subtle "frosted" texture.
- **The "Floating Sailor":** The logo should bob gently, reacting to mouse movement (parallax).
- **Glow Trails:** When agents publish messages, subtle glowing "pulses" should travel along the edges of the orchestration graph.

## 4. Implementation Priorities

1.  **Refine Graph:** Ensure the `LiveOrchestrationGraph` uses the spring physics defined above.
2.  **Flag System:** Integrate `MaritimeFlags.tsx` into the status badges of all cards.
3.  **Local DNS Proxy:** Implement the port-abstracting proxy to allow `http://pd.local`.
