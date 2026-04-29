# Design System — Agent Instructions

This skill describes the visual design language for all UI output. Every component, layout, and page should follow the design specs in the module files below. These describe *what the design looks like* — you choose how to implement the styles.

**Style:** Neobrutalism — loud, unapologetic UI built on hard offset shadows, thick 2–3px black borders, zero-radius corners, and punchy saturated color.

Every surface snaps into place with physical weight — buttons press down on click, cards lift on hover, and nothing fades softly.

## Before Writing Any Code

1. **Read every module that applies.** For a landing page, read at minimum: `layout.md`, `typography.md`, `colors.md`, `buttons.md`, `cards.md`, `shadows.md`, `radius.md`, `borders.md`. Do NOT write JSX until you have loaded all relevant modules.

## Critical Rules

- **Tokens are AGNOSTIC, NOT Tailwind classes:** The tokens defined in the `.md` files (like `neutral-primary-soft`, `heading`, `border-default`) are agnostic design system tokens, NOT literal Tailwind classes. Do not blindly use classes like `bg-neutral-primary-soft` unless you have explicitly mapped them in the CSS/Tailwind configuration. You must implement the mapping yourself.

- **Cross-reference modules.** A card containing buttons must satisfy both `cards.md` AND `buttons.md`.
- **Dark mode is automatic.** The CSS custom properties resolve differently in light/dark via `@media (prefers-color-scheme: dark)`. Never manually swap colors.
- **Every interactive element needs hover, focus, and disabled states** — defined in the relevant module.
- **Use semantic HTML:** proper heading hierarchy (`h1`→`h6`), `<button>` for actions, `<a>` for navigation, ARIA attributes where needed.
- **Neobrutalism signature:** all components must use hard offset shadows (no blur), thick solid borders, and sharp or minimal radius. No soft/blurred shadows or subtle borders.

## Module Index

### Foundation (read first for any UI work)
- [colors.md](colors.md) — all background, text, and border color tokens
- [typography.md](typography.md) — heading scale, paragraphs, labels, links
- [layout.md](layout.md) — spacing rhythm, containers, animation, visual depth
- [radius.md](radius.md) — border-radius scale
- [shadows.md](shadows.md) — elevation tokens
- [borders.md](borders.md) — border widths and styles

### Components
- [buttons.md](buttons.md) — button variants, sizes, states, hover/press effects
- [button-group.md](button-group.md) — grouped button structure
- [cards.md](cards.md) — card structure, background, interactivity
- [inputs.md](inputs.md) — form controls, labels, states
- [alerts.md](alerts.md) — alert variants
- [badges.md](badges.md) — badge variants, sizes, dismissible chips
- [lists.md](lists.md) — list components
- [avatars.md](avatars.md) — avatar variants, sizes, indicators
- [icon-shapes.md](icon-shapes.md) — icon containers

### Complex Components
- [accordion.md](accordion.md) — accordion variants
- [dropdown.md](dropdown.md) — dropdown menus
- [modals.md](modals.md) — modal dialogs
- [tabs.md](tabs.md) — tab navigation
- [tables.md](tables.md) — table structure
- [pagination.md](pagination.md) — pagination components
- [sidebars.md](sidebars.md) — sidebar navigation
- [radios-checkboxes-toggle.md](radios-checkboxes-toggle.md) — selection controls
- [tooltips-popovers.md](tooltips-popovers.md) — tooltips and popovers
- [content.md](content.md) — grid system, responsiveness
