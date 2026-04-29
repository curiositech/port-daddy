# Cards

> Dependencies: `colors.md`, `radius.md`, `shadows.md`, `typography.md`

## Core Specs

- **Background:** neutral-primary-soft (#FFFFFF in light)
- **Border:** 2px solid border-default (black in light mode)
- **Radius:** 0px (base)
- **Shadow:** shadow-md (hard offset: `4px 4px 0 0`)

## Card Heading

- Desktop: 20px, semibold weight, heading color
- Mobile: 16px, semibold weight, heading color
- Never skip heading levels — the page hierarchy must logically arrive at the card heading level.

## States

### Static Card (no interactivity)
- Background: neutral-primary-soft
- Border: 2px solid border-default
- Radius: 0px
- Shadow: shadow-md
- No hover styles. Non-interactive cards must NOT have hover background changes.

### Interactive Card (clickable)
- Same base styles as static card
- Hover: translate -2px up and -2px left, shadow increases to shadow-lg (`6px 6px 0 0`)
- Active: translate 2px right and 2px down, shadow reduces to shadow-xs (`2px 2px 0 0`)
- Transition: all 100ms
- Cursor: pointer

## Rules

- Background: neutral-primary-soft
- Border: 2px solid border-default (black)
- Radius: 0px
- Shadow: shadow-md (hard offset)
- Interactive hover: lift effect with increased shadow
- Non-interactive: no hover styles
