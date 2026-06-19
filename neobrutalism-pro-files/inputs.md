# Inputs

> Dependencies: `colors.md`, `radius.md`

## Core Specs

- **Display:** block, full width
- **Radius:** 0px (base)
- **Border:** 2px solid border-default (black in light mode)
- **Background:** neutral-primary-soft (#FFFFFF in light)
- **Shadow:** shadow-xs (hard offset: `2px 2px 0 0`)
- **Font:** 14px, heading color, Space Grotesk
- **Padding:** 12px horizontal, 10px vertical
- **Placeholder:** body color
- **Transition:** all properties, 150ms

## Label

- Display: block
- Font: 14px, semibold weight (600), heading color
- Margin bottom: 8px
- Label `htmlFor` must match the input `id`

## States

### Default
- Border: 2px solid border-default (black)
- Background: neutral-primary-soft
- Shadow: shadow-xs

### Hover
- Border: 2px solid border-default-strong

### Focus
- No outline
- Border: 2px solid border-brand
- Shadow: shadow-sm (increased offset)

### Success
- Border: 2px solid border-success
- Focus shadow: shadow-sm with success color

### Error / Danger
- Border: 2px solid border-danger
- Focus shadow: shadow-sm with danger color

### Disabled
- Background: disabled
- Text: fg-disabled
- Border: 2px solid border-light
- Shadow: none
- Cursor: not-allowed

## Input with Icons

- Icon size: 16x16px
- Icon color: body
- Container: relative positioned wrapper
- Start icon: absolutely positioned left, 12px left padding — input gets 36px left padding
- End icon: absolutely positioned right, 12px right padding — input gets 36px right padding
- Icons vertically centered within the wrapper

## Rules

- Every input must have a unique `id`
- Every label must have a matching `htmlFor`
- Padding: 12px horizontal, 10px vertical unless overridden for icon variants
- No arbitrary hex or hardcoded colors
