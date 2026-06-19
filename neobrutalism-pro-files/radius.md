# Border Radius

> Neobrutalism defaults to sharp corners (0px). Rounded variants exist for specific use cases like pills and avatars.

| Token | Value | Default usage |
|---|---|---|
| base | 0px | Buttons, cards, inputs, modals, sections |
| default | 0px | Badges, tooltips, dropdown items, small controls |
| sm | 0px | Checkboxes, tiny elements |
| full | 9999px | Pills, avatars, toggles, dot indicators |

## Rules

- 0px is the default radius across the product — sharp corners are the neobrutalism signature
- Never use arbitrary radius values outside this scale
- Radius must be consistent within each component family
- Use `full` (9999px) only for explicitly pill-shaped or circular elements (avatars, toggles, pill badges)
