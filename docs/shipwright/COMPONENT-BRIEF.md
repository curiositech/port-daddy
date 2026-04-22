# COMPONENT BRIEF — Shipwright UI

> *"Components without contracts are just vibes in TypeScript. Contracts without examples
> are just vibes in JSDoc. We write contracts AND examples AND we make them sing."*

**For:** the 21st.dev MCP (`mcp__magic__21st_magic_component_builder`) and any human
building a component by hand.

**Design system anchor:** `website-v2/src/styles/tokens.css`. Do not introduce new
tokens. Do not soften radii. Do not add gradients. Everything is neobrutalist-Swiss:
`radius: 0`, hard offset shadows, Radnika sans, ink/paper/blue/lime palette, voice
semantics from the maritime system.

**Accompanying skill context (pass via the MCP "inspiration" + "refiner" steps):**
- `swiss-modern-website-design` (typography-first, grid-disciplined, asymmetrical-with-math)
- `neobrutalist-web-designer` (hard borders, offset shadows, radius 0, no soft UI)
- `data-viz-2025` + Tufte (small multiples, data-ink, no chart chrome)
- `design-accessibility-auditor` (WCAG 2.2 AA+, focus rings, `prefers-reduced-motion`)
- `animation-system-architect` (180ms linear/ease-out only, motion is signal)
- `high-quality-vibe-coding` (strict TS, tests colocated, no `any`)

**Code standard for every component below:**

```tsx
/**
 * <ComponentName> — one-sentence purpose.
 *
 * WHY IT EXISTS: the reason this couldn't be a one-off inline JSX. The failure mode
 * it prevents. The piece of the Shipwright story it tells.
 *
 * DESIGN NOTES: tokens used, motion, keyboard behavior, a11y considerations.
 *
 * @example
 *   <ComponentName
 *     prop="value"
 *     onThing={(ev) => ...}
 *   />
 *   // Result: a grid cell with a ship at (col, row), 180ms drift animation,
 *   //   clicking fires `onThing({ projectId: 'port-daddy' })`.
 */
```

Tests colocated. Every component has:
1. A Storybook / Ladle story with three states (default, hover, disabled/edge).
2. A Vitest `@testing-library/react` test asserting one behavior + one a11y invariant.
3. A screenshot under `docs/shipwright/component-shots/<name>.png`.

---

## The inventory

### 1. `HarborGrid`

Top-level Tufte small-multiple of projects. Renders one `ShipCard` per survey.

**Props**
```ts
interface HarborGridProps {
  /** Project survey records, as returned by `/shipwright/survey`. */
  surveys: ProjectSurvey[];
  /** Currently-focused project id (for transition-from state). */
  focusedId?: string;
  /** Fires when user clicks or hits Enter on a card. */
  onFocus(projectId: string): void;
  /** Optional search query (prefix-matches on name + intent). */
  query?: string;
  /** Honor prefers-reduced-motion. Defaults to reading from `matchMedia`. */
  reducedMotion?: boolean;
}
```

**Behavior**
- 12-col CSS grid, 24px gutter, 8px baseline. Card min-height 168px.
- Keyboard: arrows move a roving-tabindex; Enter focuses; `/` focuses search input.
- Motion: each card gets a subtle 1-cell drift every `N = 60/commitsPerHour` seconds,
  180ms ease-out. Disabled when `reducedMotion`.
- When `focusedId` set, the matching card animates to the Focus-mode target position
  via shared-element transition; peers fade (180ms).

**21st.dev brief**: "Grid of rectangular cards, hard 2px black border, 5px offset
hard black shadow, radius 0. Inside each card: left-aligned monochrome ship glyph
(SVG slot), bold project name in Radnika Black at 22px, uppercase meta caption at
11px / 0.14em tracking, monospace stats row. One 6px colored dot in the stern for
fleet status. Paper bg `#f2eee6`, ink `#121212`, optional blue `#0055ff` or lime
`#dfff00` accents only. No hover shadow softening — hover shifts shadow to 2px
(pressed)."

---

### 2. `ShipCard`

The unit. Used inside `HarborGrid` and as the "command block" in Focus mode.

**Props**
```ts
interface ShipCardProps {
  survey: ProjectSurvey;
  /** "harbor" = small tile, "focus" = large hero block. */
  variant: 'harbor' | 'focus';
  /** Ghost = surveyed but no fleet. Renders with dashed border, 2px outline glyph. */
  ghost?: boolean;
  onClick?(): void;
  /** Render slot for custom glyph if archetype overrides default by kind. */
  glyphSlot?: React.ReactNode;
}
```

**States**
- `default` | `hover` (shadow shifts to 2px) | `active` (shadow 0, ink-filled)
- `ghost` | `stale` (opacity 0.55) | `slashed` (red corner stripe)

---

### 3. `ShipGlyph`

Pure presentational SVG. No props beyond `kind` and `size`. 5 kinds:
`battleship | cruiser | frigate | sloop | ghost`. Monochrome, currentColor.

This is the only component that may be imported from an `icons/` barrel. It is
load-bearing for visual identity — iterate with the designer, not 21st.dev.

---

### 4. `ModelTierSelector`

Three hard-bordered pill buttons: HAIKU / SONNET / OPUS. Active pill is lime.

**Props**
```ts
interface ModelTierSelectorProps {
  value: 'haiku' | 'sonnet' | 'opus';
  onChange(v: 'haiku' | 'sonnet' | 'opus'): void;
  /** $/hr for each tier — displayed under the pill. */
  pricing?: Record<'haiku' | 'sonnet' | 'opus', number>;
  /** Keyboard shortcut "1/2/3" when the container has focus. Default true. */
  keyboardShortcuts?: boolean;
}
```

---

### 5. `CostBreakdownPanel`

Stacked sparkline small-multiples, one line per agent + a total. Tufte discipline:
no legends (labels inline), no gridlines, no fill, one ink weight per line except
total at 2px.

**Props**
```ts
interface CostBreakdownPanelProps {
  /** Per-agent cost-per-simulated-minute series. */
  series: Array<{ agentId: string; values: number[]; annotation?: string }>;
  /** Simulated minute labels, length matches each series. */
  labels: string[];
  /** Envelope line, rendered as a faint horizontal rule. */
  budgetUsdPerDay?: number;
}
```

Recharts is fine but lock the config: no `CartesianGrid`, no `Tooltip`, no
animated entrance. Everything static after render.

---

### 6. `SimulationCanvas`

The 6×5 staging grid. Ships move rectilinearly. File-tree on the right edge. Lines
drawn from ship stern to written files on `file.write` events.

**Props**
```ts
interface SimulationCanvasProps {
  /** SSE stream of events per the event taxonomy in SHIPWRIGHT-DESIGN.md §6.2. */
  eventStream: AsyncIterable<SimEvent>;
  /** Agents to place. Position assigned by archetype family. */
  agents: ProposedAgent[];
  /** Called when user clicks a file node in the tree. */
  onFileClick(path: string): void;
  onAgentClick(agentId: string): void;
  /** Seed for the pheromone glow RNG (keep deterministic). */
  seed: number;
}
```

**Internals**
- Ship position: archetype → family → cell. Never random.
- On `agent.spawn`: ghost → filled transition (180ms fill, stroke stays).
- On `file.write`: `<path>` from ship to file node, 400ms draw, 1s lime glow then
  geometric decay over 60s (match `lib/pheromone.ts`).
- On `arbiter.violation` or `bond.slash`: red corner stripe on ship, halt drift.
- Reduced-motion: snaps, no drift, no draw animation.

---

### 7. `MutatedFileDiff`

Side panel that opens on `onFileClick`. Shows the synthesized diff + agent notes,
tool calls, thinking chunks.

**Props**
```ts
interface MutatedFileDiffProps {
  path: string;
  events: SimEvent[];             // all events scoped to this path
  /** Allow user to edit the prompt that produced this write; emits on Enter. */
  onEditPrompt?(newPrompt: string): void;
}
```

Uses `@codemirror/diff` or `diff2html`. No syntax-highlight rainbow — one ink
weight for context, blue for additions, red for deletions. Period.

---

### 8. `AgentThoughtStream`

Collapsed by default; expands when `AgentThoughtStream.forceOpen=true` or user
clicks. Shows interleaved `agent.thinking` / `agent.tool` / `agent.note` events,
each typed and tinted.

Maritime voices from tokens.css color the note labels:
`mayday` / `pan-pan` / `securite` / `hail` / `roger` / `wilco` / `report` / `over` / `out`.

---

### 9. `ShipwrightChat`

Right drawer. Plain text composer. Enter sends, Shift+Enter newline.

**Props**
```ts
interface ShipwrightChatProps {
  projectId: string;
  /** Transcript. Server-side-stored, hydrated on mount. */
  messages: ShipwrightMessage[];
  onSend(text: string): Promise<void>;
  /** Hook for inline edits to the current proposal (prompts, bonds, skills). */
  onProposalEdit(patch: ProposalPatch): void;
  /** Re-run simulation with current proposal. */
  onReSimulate(): void;
}
```

---

### 10. `FleetControlPanel`

The cockpit. Three slabs + agent roster strip + kill switch. This one lives in the
`/control` route AND is embeddable in FleetBar as a compact variant.

**Props**
```ts
interface FleetControlPanelProps {
  variant: 'full' | 'compact';        // compact = FleetBar 480px
  project: string;
  budget: BudgetGauge;                // { spentUsd, dailyUsd, throttleAt, killAt }
  bondPool: BondPool;                 // { escrowedUsd, availableUsd, commonsUsd, entries[] }
  violations: ArbiterViolation[];
  agents: AgentRosterEntry[];
  panic: { armed: boolean; reason?: string };
  onPanic(reason: string): Promise<void>;
  onUnpanic(reason: string): Promise<void>;
}
```

Accessibility — the kill switch is:
- `role="button"`, `aria-pressed={panic.armed}`, `aria-describedby="panic-help"`.
- 2-step confirm dialog uses `role="alertdialog"`, traps focus, Escape cancels.

---

### 11. `BudgetGauge` (part of FleetControlPanel, extracted for reuse)

Vertical bar with 80%/100% tick marks. 2px border, `radius: 0`, no gradient.

---

### 12. `BondPoolBar`

Horizontal stacked bar: escrowed / available / commons. Hard ink rules between
segments. Labels below each segment, not inside.

---

### 13. `KillSwitch`

Hard-bordered, ink-filled, lime-text button. Two-step confirm. Animated only by
a 120ms `opacity` pulse when armed (respects reduced-motion).

---

### 14. `ActivityRailLite` (FleetBar compact)

Fixed 480px wide vertical list: top 3 projects × cost tick + status chip. Wraps
`FleetControlPanel variant="compact"`.

---

## Build order (for the MCP)

1. **Tokens sanity test** — before any component call, read `tokens.css` and include
   the relevant CSS variables in the component's CSS. Do not ship hex values.
2. **`ShipGlyph`** first — dependency of HarborGrid and ShipCard.
3. **`ShipCard`** — dependency of HarborGrid.
4. **`HarborGrid`** — the default page.
5. **`ModelTierSelector`** + **`CostBreakdownPanel`** — used in Focus mode.
6. **`SimulationCanvas`** + supporting diff/thought-stream components.
7. **`ShipwrightChat`**.
8. **`FleetControlPanel`** + its subcomponents.
9. **FleetBar compact** last — just a layout wrapper.

Each step: build → visual check → Vitest + a11y test → commit.

---

## Rejection criteria (auto-reject before merge)

- Any `border-radius` > 0 outside `--radius-full` (for avatars/dots only).
- Any `box-shadow` not from the `--shadow-*` token set.
- Any color literal in a className. Use `var(--token)`.
- Any animation > 260ms.
- Any component missing the module docstring or `@example`.
- Any component without a keyboard story in Storybook/Ladle.
- Any component that renders text below `--text-sm` for body content.

These are the "Swiss poster discipline" guardrails from the swiss-modern skill.
They are boring. They are also the entire reason the site looks like it does.

---

*End of COMPONENT-BRIEF.md.*
