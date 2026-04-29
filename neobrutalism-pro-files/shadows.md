# Shadows

> Neobrutalism uses hard offset shadows with no blur. The shadow color matches the border token (black in light mode, dark gray in dark mode).

| Token | CSS value |
|---|---|
| shadow-2xs | `1px 1px 0 0 var(--color-border-default)` |
| shadow-xs | `2px 2px 0 0 var(--color-border-default)` |
| shadow-sm | `3px 3px 0 0 var(--color-border-default)` |
| shadow-md | `4px 4px 0 0 var(--color-border-default)` |
| shadow-lg | `6px 6px 0 0 var(--color-border-default)` |
| shadow-xl | `10px 10px 0 1px var(--color-border-default)` |
| shadow-2xl | `16px 16px 0 1px var(--color-border-default)` |

## Component Mapping

| Component type | Token |
|---|---|
| Subtle separators, tiny UI details | shadow-2xs or shadow-xs |
| Inputs, buttons, small controls, lightweight cards | shadow-xs or shadow-sm |
| Standard cards, popovers, dropdowns | shadow-md |
| Prominent cards, sticky surfaces | shadow-lg |
| Modals, high-priority overlays | shadow-xl |
| Hero overlays, top-level emphasis (sparingly) | shadow-2xl |

## Rules

- Use only these tokens — no custom box-shadow values
- All shadows are hard offset (no blur radius, no spread except xl/2xl)
- Shadow color always uses the border-default token for automatic light/dark handling
- Keep elevation steps intentional; avoid jumping multiple levels
- Components in the same family share the same baseline elevation
- Hover/focus on interactive elevated elements: step up by one level (e.g. shadow-sm → shadow-md)
- Never stack multiple shadow tokens on one element
- Never use shadow-xl/shadow-2xl for dense list items or body containers
