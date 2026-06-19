# 0010. Maritime Design Language Throughout CLI and Dashboard

## Status

Accepted

## Context

Port Daddy needed a visual and semantic design language for its CLI output and dashboard. Developer tools often use one of three default aesthetics:

1. **Terse Unix style**: bare text, minimal formatting, no color
2. **Generic status output**: green checkmarks, red X marks, yellow warnings
3. **Framework-specific style**: copying the aesthetic of Webpack, Vite, or whatever framework is popular at the time

None of these felt right for a tool named "Port Daddy" — a daemon that manages *ports*, runs as a *daemon* (nautical: a harbor worker), coordinates *agents* (ships and their crews), and manages *channels* (pub/sub channels, but also maritime channels). The name and the domain metaphor were already nautical. The design language should be too.

The maritime metaphor also offered something the generic alternatives did not: a rich, consistent vocabulary for expressing agent coordination concepts. Ship-to-ship communication has well-defined protocols (Mayday, Pan-Pan, Securite, Roger, Wilco, Over, Out). Signal flags have defined meanings (Charlie = affirmative, November = negative, Kilo = ready to communicate). These map naturally to the states and events in a multi-agent development system.

## Decision Drivers

- **Memorability**: The tool should have a distinctive identity that makes it recognizable and memorable.
- **Semantic richness**: The maritime vocabulary must add meaning, not just aesthetic novelty. Each signal should map to a real state in the system.
- **Consistency**: The same maritime concepts should appear across CLI output, dashboard UI, and documentation.
- **Accessibility**: The design language must be decipherable without maritime knowledge — every signal should be self-explanatory in context.
- **Professional quality**: The aesthetic should read as polished and intentional, not as a novelty gimmick.

## The Maritime Vocabulary

### Signal Flags (Status Indicators)

Used in CLI output via `lib/maritime.ts`. Each flag maps to a system state:

| Flag | ASCII Art | Meaning | Used For |
|------|-----------|---------|----------|
| Charlie | `▓▒░` | Affirmative | Success, acquired, completed |
| November | `░▓░` | Negative | Errors, failures |
| Kilo | `▓▓` | Ready to communicate | Listening, standby, ready |
| Uniform | `░▓` | Danger ahead | Warnings, conflicts |
| Victor | `╲╱` | Require assistance | Mayday, help needed |
| Lima | `▓░` | Stop immediately | Stop, halt, blocked |

These flags appear in CLI output when agents register, when sessions start and end, and when coordination events occur. The flag's visual representation is compact enough to not clutter terminal output while still being distinctive.

### Radio Call Signals (Agent Voices)

Agents communicate over "the radio" — the pub/sub messaging system. Messages use radio telephony terminology:

| Signal | Color | Meaning |
|--------|-------|---------|
| `mayday` | RED | EMERGENCY — critical failure |
| `pan-pan` | YELLOW | URGENT — serious but not immediately dangerous |
| `securite` | CYAN | SAFETY — navigational hazard or weather warning |
| `hail` | GREEN | Announcing presence (agent registration) |
| `roger` | GREEN | Message received and understood |
| `wilco` | GREEN | Will comply |
| `report` | WHITE | Sharing a finding (neutral information) |
| `over` | GRAY | Finished, awaiting response |
| `out` | GRAY | Finished, no response expected |

The three-tier urgency system (mayday > pan-pan > securite) maps to the severity levels common in monitoring and alerting. Developers familiar with emergency radio communications instantly understand the severity ordering. Those unfamiliar with maritime radio still understand it from context — red/critical, yellow/warning, cyan/informational.

### Channel Tokens (Identity Coloring)

The `project:stack:context` identity format (see ADR-0003) is rendered with color-coded segments in maritime output:

- **Cyan** — the `scope`/`project` segment (horizon blue-green, like the sea)
- **Yellow** — the `topic`/`stack` segment (signal flag = attention)
- **Green** — the `qualifier`/`context` segment (starboard = right/specific)
- **Gray** — the `:` separators (structural, not semantic)

This coloring makes identity strings scannable at a glance. The eye immediately locates the project name (cyan) versus the service type (yellow) versus the branch context (green).

### Dashboard Aesthetic

The dashboard's glassmorphism dark theme extends the maritime metaphor visually:
- Deep navy/indigo backgrounds (`--bg-deep: #0c0a1a`) evoke deep water
- Cyan accent color (`--accent: #00e5ff`) references the sea and horizon
- Frosted-glass card panels suggest looking through porthole glass
- The sidebar's logo mark uses a gradient from cyan to violet — the transition from sea to sky

The dashboard header uses `━━━━━━━━━` box-drawing characters rather than dashes, referencing chart plotting. Card borders use `rgba(0,229,255,0.1)` — a translucent cyan — that recalls the blue of maritime charts.

## Decision

Adopt the **maritime design language** as the canonical design system for Port Daddy's CLI output, dashboard, and documentation.

This decision is implemented in:
- **`lib/maritime.ts`**: Signal flag rendering functions (`flag()`, `status()`, `highlightChannel()`), radio message formatters, and the ANSI color constants
- **`cli/utils/prompt.ts`**: Interactive prompting uses maritime-themed prompts and signals
- **`public/index.html`**: Dashboard uses the navy/cyan/violet color palette, glassmorphism panels, and SVG icons (not emojis — see global CLAUDE.md guidelines)
- **`lib/resurrection.ts`**: The file opens with a maritime quote: "What's dead may never die, but rises again harder and stronger"
- **`lib/log-prefix.ts`**: Orchestrator log prefixes use maritime status codes

## Rationale

A distinctive design language does several things for a developer tool:

1. **Brand recognition**: A developer who sees a `Charlie ▓▒░` success indicator immediately knows it is Port Daddy output.
2. **Semantic clarity**: Mayday/Pan-Pan/Securite gives developers an instantly intuitive severity ordering that plain "error/warning/info" lacks.
3. **Consistent metaphor**: The tool manages ports (harbors), runs as a daemon (a harbor worker), coordinates agents (ships), and routes messages through channels. The maritime metaphor is not grafted on — it grows from the problem domain.
4. **Developer joy**: Tools that have a coherent personality are more pleasant to use than tools that are purely functional. Port Daddy's maritime theme is a small but meaningful investment in the developer experience.

The signal flags were chosen because they represent actual international communication standards — every flag has a precise, internationally agreed-upon meaning. This is not an arbitrary mapping; Charlie has meant "affirmative" in the International Code of Signals since 1857. Borrowing a communication standard that has been tested over 165 years is appropriate for a tool designed to coordinate agents that must communicate precisely.

The requirement that no emojis be used as UI icons (from the global CLAUDE.md) aligns perfectly with this approach: signal flags rendered in ASCII/Unicode are more distinctive and more purposeful than emoji.

## Consequences

### Positive

- Port Daddy's output is immediately recognizable — developers know at a glance that they are reading Port Daddy logs, not another tool's output
- The severity system (mayday > pan-pan > securite) is semantically richer than simple error/warning/info
- Channel coloring (cyan/yellow/green for project:stack:context) makes identity strings scannable without reading them character by character
- The maritime vocabulary provides ready-made terms for new features: "the radio" for pub/sub, "the harbor" for port management, "the resurrection queue" for dead agents

### Negative

- Contributors who are not familiar with maritime terminology may need a brief orientation period. The `lib/maritime.ts` file opens with an extensive design system comment that documents all signals and their meanings.
- The ASCII signal flag representations (`▓▒░`, `░▓░`) use Unicode block characters that may not render correctly in all terminal emulators. Fallback behavior (plain text labels) should be provided for terminals that cannot render these characters.
- There is a risk of the maritime theme feeling forced if extended too aggressively. The current implementation uses it for output formatting and visual design, not for all variable and function names throughout the codebase — keeping the metaphor as a surface concern rather than a structural one.

### Neutral

- The `pd learn` tutorial (`cli/commands/tutorial.ts`) uses maritime-themed interactive prompts to teach new users the Port Daddy workflow. The tutorial is the primary place where the maritime vocabulary is explained to users encountering it for the first time.
- The dashboard uses SVG icons rendered inline (no icon library dependency), maintaining visual consistency without importing an icon set that might drift from the maritime aesthetic.
