---
name: beautiful-gui-design
description: Design and build beautiful, accessible graphical interfaces — web, desktop (Electron/Tauri), and native (iOS/macOS/Android). Use for visual hierarchy and layout, color and theming (light/dark, semantic tokens, WCAG contrast), typography systems, motion and micro-interactions, accessibility, component systems and design tokens, responsive/adaptive layout, and platform-native idioms. The GUI counterpart to beautiful-cli-design. NOT for terminal/CLI output (use beautiful-cli-design) or API/data schemas.
license: Apache-2.0
allowed-tools: Read,Write,Edit,Bash,Grep,Glob
metadata:
  category: Design & UX
  tags:
    - gui
    - design-system
    - accessibility
    - design-tokens
    - typography
    - color
    - motion
    - layout
    - native-ui
  provenance:
    kind: first-party
    owners:
      - port-daddy
  pairs-with:
    - skill: gpui-rust-console
      reason: pd-console's panes need this skill's hierarchy/token/accessibility rules translated into gpui's render-agnostic Block/Tone system.
    - skill: rust-gpui-motion
      reason: This skill's motion rules (duration/easing tokens, transform/opacity-only, prefers-reduced-motion) hand off to gpui's compositor-friendly primitives once the target is native Rust.
    - skill: gpui-shaders
      reason: Shader-driven per-pixel effects still answer to this skill's hierarchy/color/motion rules — a shader is the escape hatch, not a substitute for the token/layout system.
    - skill: web-design-expert
      reason: Brand identity, palette, and typography direction sit upstream of this skill's execution rules for tokens, layout, and accessibility.
    - skill: color-contrast-auditor
      reason: Computes the exact WCAG contrast ratios this skill's audit requires; run it on the palette before locking tokens.
  io-contract:
    kind: deliverable
    consumes:
      - kind: gui-design-brief
        format: markdown
      - kind: gui-spec
        format: json
    produces:
      - kind: visual-design-system
        format: markdown
      - kind: gui-design-audit
        format: json
---

# Beautiful GUI Design

Treat the screen as a designed surface, not a dump of controls: hierarchy, color, type, motion, and accessibility are load-bearing, and every choice must survive light/dark mode, small and large viewports, keyboard and screen-reader use, and the conventions of the platform it ships on.

## When to Use

- Designing or reviewing a web app, marketing page, dashboard, or settings/onboarding flow.
- Building a desktop GUI (Electron/Tauri) or a native app (SwiftUI/AppKit, Jetpack Compose, WinUI).
- Establishing a design system: semantic color tokens, a type scale, spacing, elevation, component states.
- Adding light/dark themes, fixing contrast/accessibility failures, or making a layout responsive.
- Choosing a component approach (headless primitives vs. styled kit) or a design-to-code tool.

## NOT for

- Terminal/CLI output, TUIs, prompts, or ANSI rendering. Use `beautiful-cli-design`.
- API response schemas, wire formats, or machine-only output contracts.
- Backend architecture, data modeling, or non-visual logic.
- Brand strategy / copywriting (this is the visual + interaction layer).

## Decision Points

```mermaid
flowchart TD
  A[GUI design task] --> B{Output target?}
  B -->|Web| C{Component adapts to its container or the page?}
  C -->|Its container| C1[Container queries + fluid type]
  C -->|The page| C2[Mobile-first breakpoints]
  B -->|Desktop Electron/Tauri| D[Web tech, but adopt the host OS idioms]
  B -->|Native iOS/macOS| E[SwiftUI + SF Symbols + Apple HIG]
  B -->|Native Android| F[Compose + Material 3 + Material icons]
  C1 --> G{Need ship-fast or full control?}
  C2 --> G
  D --> G
  G -->|Ship fast| H[Styled kit: shadcn/ui on Radix]
  G -->|Full control / cross-platform looks| I[Headless primitives: Radix/Headless UI + own styling]
  H --> J[Layer the system: tokens -> components -> a11y -> motion]
  I --> J
  E --> J
  F --> J
```

Route first:
- **Tokens before components, components before screens.** A screen built on ad-hoc values can't be themed or kept consistent. Build the three-tier token model (primitive → semantic → component) first. See `references/06-component-systems-tokens-and-platform-idioms.md`.
- **Headless primitives** (Radix/Headless UI) when you need full visual control or different looks per platform; **styled kits** (shadcn/ui) when you want 80% shipped with accessibility already handled. Never hand-roll an interactive control without the ARIA/keyboard logic a primitive gives you.
- **Container queries** when a component appears at multiple widths (sidebar vs. grid); **breakpoints** for page-level layout.
- **Native means native.** A web look shipped on iOS/Android reads as a web app. Adopt the platform's icons, spacing, type, and controls.

## Visual System Rules

- **Spacing is a system, not vibes.** Use an 8pt grid (4pt for micro-adjustments). One base per project. `references/01`.
- **Hierarchy needs contrast, not just color.** Distinguish tiers by ≥1.5–2× size plus weight/position — never color alone. `references/01`.
- **Color is semantic tokens, never raw hex in components.** Build a perceptually-uniform (OKLCH) ramp; derive light/dark and every state from it. `references/02`.
- **Type: `rem` not `px`, a modular scale, body ≥ 14px (0.875rem).** 45–75ch measure, role-based line-height. Honor OS Dynamic Type; never lock zoom. `references/03`.
- **Motion is communication, not decoration.** 100–300ms, ease-out to enter / ease-in to exit, animate only transform/opacity, always honor `prefers-reduced-motion`. `references/04`.
- **Accessibility is a design input, not a retrofit.** Semantic HTML/native controls first, visible focus always, 4.5:1 body contrast, 44/48pt touch targets, keyboard + screen-reader passes. `references/05`.
- **Icons are an icon system (SF Symbols / Lucide / Heroicons), never emoji.** Emoji as UI icons reads as cheap and renders inconsistently.

## Failure Modes

### Anti-Pattern: "Rainbow Vomit"
**Symptom**: Many unrelated colors; states (hover/error/focus) are indistinguishable from intent (primary/info).
**Detection rule**: Count unique colors in a 400×400px screenshot — more than ~8 is a smell.
**Fix**: One primary + one accent + semantic status colors; derive hover/active/disabled by lightness offset. `references/02`.

### Anti-Pattern: "Invisible in Light Mode" (or Dark)
**Symptom**: Looks fine in one theme, unreadable in the other (light text on light, low-contrast accents).
**Detection rule**: Hardcoded theme colors; contrast checker reports < 4.5:1 (text) or < 3:1 (UI) in either mode. `scripts/gui_design_audit.mjs` flags `low-text-contrast` (critical) when `textContrastMinRatio` < 4.5, and `missing-light-dark` (high) when `lightAndDark` is false.
**Fix**: Semantic tokens with real light AND dark values (not an inversion); verify both with a contrast tool. `references/02`.

### Anti-Pattern: "Tiny Type / Locked Zoom"
**Symptom**: Body/caption text below 14px; `user-scalable=no` or `maximum-scale<2`; ignores OS text size.
**Detection rule**: Grep for `font-size: 0.[0-7]…`, Tailwind `text-xs` on prose, `user-scalable=no`. `scripts/gui_design_audit.mjs` flags `tiny-body-font` (critical) when `minBodyFontPx` < 14.
**Fix**: `rem`-based scale, ≥14px body, honor Dynamic Type, never disable zoom. `references/03`, `references/05`.

### Anti-Pattern: "Decorative Motion / Layout Thrash"
**Symptom**: Animations on width/height/top/left, parallax, >300ms repeated transitions; janky on mobile.
**Detection rule**: DevTools Performance shows tall Layout/Recalc bars during animation; no `prefers-reduced-motion` path.
**Fix**: Animate transform/opacity only; tokenize durations/easing; honor reduced-motion. `references/04`.

### Anti-Pattern: "Web Look on Native"
**Symptom**: Material ripples on iOS, 4pt corners and emoji icons, centered controls that fight the HIG.
**Detection rule**: Side-by-side with a first-party app (Settings, Messages) — corners/spacing/icons/controls differ.
**Fix**: Use the platform's primitives, icon set, spacing, and type. `references/06`.

### Anti-Pattern: "Magic Numbers in Components"
**Symptom**: `padding: 13px`, one-off hex, hand-picked hover colors scattered through component files.
**Detection rule**: Grep components for numeric literals and `#[0-9a-f]{6}` — every hit is un-tokenized. `scripts/gui_design_audit.mjs` flags `no-semantic-tokens` (critical) when `semanticTokensUsed` is false, and `ad-hoc-spacing` (high) when `spacingScale` is `"ad-hoc"`.
**Fix**: Three-tier tokens; components reference semantic tokens only. `references/06`.

### Anti-Pattern: "Stateless / Inaccessible Controls"
**Symptom**: A control with only default + click; no focus ring, no disabled/loading/error, `<div>`-as-button.
**Detection rule**: Tab through the UI — focus vanishes; render the control in all states — most are missing. `scripts/gui_design_audit.mjs` flags `no-interactive-states` (critical) when `interactiveStatesDefined` is false.
**Fix**: Full state machine (default/hover/active/focus/disabled/loading) on a semantic element or headless primitive. `references/05`, `references/06`.

### Anti-Pattern: "Cramped Touch Targets"
**Symptom**: Buttons/icons sized to their visual glyph (e.g. a 20×20px icon button) with no invisible hit-area padding; taps miss or double-fire on mobile.
**Detection rule**: Rendered hit area (including padding) measures below 44×44pt (iOS) / 48dp (Android) / the 24px WCAG 2.5.8 floor, with tight surrounding spacing. `scripts/gui_design_audit.mjs` flags `touch-target-below-minimum` (high) when `touchTargetMinPx` < 44.
**Fix**: Pad the interactive element — not just the glyph — to at least the platform minimum, and space adjacent targets so they don't crowd. `references/05`.

### Anti-Pattern: "Design-by-Committee Type System"
**Symptom**: Every screen introduces a new font weight or one-off size; the type scale has ballooned past a handful of steps and reads inconsistent.
**Detection rule**: More than ~3 font weights or more than ~8 distinct font sizes in the shipped system. `scripts/gui_design_audit.mjs` flags `too-many-font-weights` (medium) when `fontWeightsCount` > 3, and `too-many-font-sizes` (medium) when `fontSizesCount` > 8.
**Fix**: Collapse to a modular scale (~6–8 sizes) and 2–3 weights (regular/medium/bold); every new size must justify itself against the scale. `references/03`.

## Worked Example: A Button, Done Right

**Before** — hardcoded, themeless, inaccessible:
```jsx
<button style={{ background: '#0066FF', color: '#fff', padding: '13px', borderRadius: 4 }}>Save</button>
```
Problems: raw hex (no theme), magic padding, no hover/active/focus/disabled, white text may fail contrast, no dark mode.

**After** — tokens + states + a11y:
```css
.btn-primary {
  background: var(--color-primary);
  color: var(--color-text-on-primary);
  padding: var(--space-2) var(--space-4);      /* 8pt grid */
  border-radius: var(--radius-md);
  font-size: 1rem;                              /* ≥14px */
  transition: background-color 150ms cubic-bezier(0,0,.2,1);  /* ease-out */
}
.btn-primary:hover    { background: var(--color-primary-hover); }   /* −10% L */
.btn-primary:active   { background: var(--color-primary-active); transform: scale(.98); }
.btn-primary:focus-visible { outline: 3px solid var(--color-focus-ring); outline-offset: 2px; }
.btn-primary:disabled { background: var(--color-surface-subtle); color: var(--color-text-disabled); cursor: not-allowed; }
@media (prefers-reduced-motion: reduce) { .btn-primary { transition: none; } }
```
Why it works: a semantic `<button>` (keyboard + SR for free), tokens that flip cleanly for dark mode, every state defined, contrast guaranteed by token design, motion that respects the user. The same tokens render natively via SF Symbols/SwiftUI on iOS and Compose on Android (`references/06`).

## Quality Gates

- [ ] **Spacing on an 8pt system**; one base; no magic numbers in components.
- [ ] **Hierarchy reads when squinting** — focal point obvious via size/weight/position, not color alone.
- [ ] **Color is semantic tokens**; light AND dark both designed and contrast-verified (4.5:1 text, 3:1 UI).
- [ ] **Type in `rem`, body ≥14px**, modular scale, 45–75ch measure; OS text-size honored; zoom never locked.
- [ ] **Every interactive element** has default/hover/active/focus-visible/disabled (+ loading where async).
- [ ] **Keyboard pass**: full operability, visible focus on every stop, modals trap + restore focus.
- [ ] **Screen-reader pass**: semantic elements/labels; ARIA only where needed and correct.
- [ ] **Motion**: transform/opacity only, tokenized duration/easing, `prefers-reduced-motion` honored.
- [ ] **Touch targets** ≥44×44pt (iOS) / 48dp (Android) / ≥24px (WCAG), adequately spaced.
- [ ] **Icons from an icon system** (SF Symbols/Lucide/Heroicons), never emoji-as-icon.
- [ ] **Native builds use native idioms** (controls, icons, spacing, type) — no web look shipped on native.
- [ ] **Tokens flow to all targets** from one source (web CSS vars, iOS Swift, Android Kotlin).

## Deterministic Audit

Once a design is measurable as data — one spec per surface, per `schemas/gui-spec.schema.json` — run it through `scripts/gui_design_audit.mjs` to check it against the Quality Gates above before calling the work done:

```bash
node skills/beautiful-gui-design/scripts/gui_design_audit.mjs --input skills/beautiful-gui-design/examples/sample-input.json
```

`auditGuiDesign(spec)` returns `{ pass, score, findings, recommendations }`, flagging low text contrast, missing light/dark, a too-small body font, an un-tokenized (raw hex/px) system, ad-hoc spacing off the 8pt/4pt grid, too many font weights/sizes, undersized touch targets, and interactive elements missing their full state machine. It audits the measured *spec*, not the rendered UI — the Keyboard pass, Screen-reader pass, and "built and run" checks above still have to happen by hand.

## Fork Guidance

Fork when the work has distinct lanes owned by different actors:
- **Visual-system lane**: hierarchy, color, type, spacing, elevation (`references/01`–`03`).
- **Interaction lane**: component states, motion, micro-interactions (`references/04`, `06`).
- **Accessibility lane**: keyboard, screen reader, contrast, targets, reduced-motion (`references/05`).
- **Platform lane**: native idioms, token flow, responsive/adaptive (`references/06`).

Keep final visual-language decisions in the parent so one actor owns coherence.

## Reference Map

- `references/01-visual-hierarchy-layout-spacing.md` — Gestalt, the 8pt/4pt system, layout grids and safe areas, focal point, density vs. whitespace, elevation, layout archetypes.
- `references/02-color-and-theming.md` — semantic tokens, OKLCH ramps, light/dark done right, WCAG contrast math, state colors, data-viz vs. chrome, theming architecture.
- `references/03-typography.md` — modular scales, `rem`, line-height/measure, pairing, variable fonts, web-font loading, fluid type, Dynamic Type, the 14px floor.
- `references/04-motion-and-microinteractions.md` — duration/easing tokens, spring vs. tween, purposeful motion, the compositor budget, honest progress, reduced-motion.
- `references/05-accessibility-and-inclusive-design.md` — WCAG 2.2 AA, semantic-first, keyboard + focus management, targets, live regions, forms, testing workflow.
- `references/06-component-systems-tokens-and-platform-idioms.md` — three-tier tokens, component anatomy/states, headless vs. styled, token flow web↔native, responsive/adaptive, iOS/macOS/Android/Windows idioms, design-to-code tooling.

Machine-checkable governance layer, for turning a design brief into an auditable spec:

- `schemas/gui-spec.schema.json` — the JSON shape of a GUI design spec (contrast, type, tokens, spacing, targets, states).
- `scripts/gui_design_audit.mjs` — `auditGuiDesign(spec)`, a deterministic check of a spec against the Quality Gates above.
- `examples/sample-input.json` — a complete, passing GUI spec.
- `examples/expected-output.md` — a failing spec audited, then the fix walkthrough to a passing one.
- `templates/output-template.md` — a fill-in template for the visual-design-system-and-layout deliverable.
- `agents/openai.yaml` — a subagent descriptor for delegated GUI design work.

## Layout QA gate (mechanical — run before shipping)

Before calling any rendered page, artifact, dashboard, deck, or component done,
run the mechanical overflow/collision checker. It renders the page headlessly and
flags text-vs-text collisions, clipped/ellipsis-truncated elements, text escaping
its container, and horizontal page scroll — the visual defects a screenshot hides
and that only appear at a specific width or in one theme.

Resolve `layout-overflow-guard` from the active skill catalog before running it.
The command below shows the standard Claude install path; use the path reported
by your harness. If the skill is absent, install or sync it instead of skipping
this gate.

```bash
python3 ~/.claude/skills/layout-overflow-guard/scripts/check_layout.py <file-or-url> \
  --widths 1280,1100,860,720,390 --themes light,dark
```

You do **not** need to read `check_layout.py` — invoke it with the Bash tool and
act on its report and exit code (non-zero = a defect). The script's source never
enters your context; only its findings do. Drive it to zero violations across
every width and both themes before you ship. Full detail: the
`layout-overflow-guard` skill.

<!-- BEGIN BUNDLE INDEX (auto: index_references.py) -->

## Skill Bundle Index

*Every file in this skill, and when to open it. Auto-generated; run `scripts/index_references.py --fix`.*

**root**
- [`CHANGELOG.md`](CHANGELOG.md) — Beautiful GUI Design — Changelog — - Upgraded to the agentic-family standard: `license`, block-style `provenance` (first-party/port-daddy), `pairs-with` (gpui-rust-console, ru
- [`README.md`](README.md) — Beautiful GUI Design — Treat the screen as a designed surface, not a dump of controls: hierarchy, color, type, motion, and accessibility are load-bearing, and ever

**`agents/`**
- [`agents/openai.yaml`](agents/openai.yaml) — openai (data/schema)

**`examples/`**
- [`examples/expected-output.md`](examples/expected-output.md) — Example Output: Beautiful GUI Design — Scenario: the "Before" button from `SKILL.md`'s Worked Example, generalized to a whole screen — hardcoded hex, magic padding, no dark theme,
- [`examples/sample-input.json`](examples/sample-input.json) — sample input (data/schema)

**`references/`**
- [`references/01-visual-hierarchy-layout-spacing.md`](references/01-visual-hierarchy-layout-spacing.md) — Visual Hierarchy, Layout & Spacing — **Visual hierarchy is the art of making some elements more prominent than others through spatial relationships, sizing, color, and alignment
- [`references/02-color-and-theming.md`](references/02-color-and-theming.md) — Color & Theming: Semantic Tokens, Accessible Contrast, and Multimode Systems — Raw hex colors in components are **the root of evil**.
- [`references/03-typography.md`](references/03-typography.md) — Typography Systems — A modular type scale anchors all typographic decisions.
- [`references/04-motion-and-microinteractions.md`](references/04-motion-and-microinteractions.md) — Motion & Micro-Interactions Reference — Motion is communication—feedback on state, guidance through hierarchy, reassurance during waits, and affordance signaling on interactive ele
- [`references/05-accessibility-and-inclusive-design.md`](references/05-accessibility-and-inclusive-design.md) — Accessibility & Inclusive Design: WCAG 2.2 AA Essentials — True accessibility is a design discipline, not a retrofit.
- [`references/06-component-systems-tokens-and-platform-idioms.md`](references/06-component-systems-tokens-and-platform-idioms.md) — Component Systems, Design Tokens & Platform-Native Idioms — A professional design system bridges the gap between **tokens** (semantic units of visual design), **components** (reusable building blocks 

**`schemas/`**
- [`schemas/gui-spec.schema.json`](schemas/gui-spec.schema.json) — gui spec.schema (data/schema)

**`scripts/`**
- [`scripts/gui_design_audit.mjs`](scripts/gui_design_audit.mjs)

**`templates/`**
- [`templates/output-template.md`](templates/output-template.md) — Visual Design System & Layout Brief — Fill in every section before handing this off for implementation.

<!-- END BUNDLE INDEX -->
