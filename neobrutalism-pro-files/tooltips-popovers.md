# Tooltips & Popovers

> Dependencies: `colors.md`, `radius.md`, `shadows.md`

## Tooltips

### Core Specs
- Padding: 12px horizontal, 8px vertical
- Font: 14px, semibold weight
- Radius: 0px (default)
- Shadow: shadow-xs (hard offset: `2px 2px 0 0`)
- Border: 2px solid border-default
- Transition: opacity, 200ms

### Dark (Default)
- Background: dark (#000000)
- Text: white
- Border: 2px solid border-default

### Light
- Background: neutral-primary-medium
- Text: heading color
- Border: 2px solid border-default

## Popovers

### Core Specs
- Background: neutral-primary
- Radius: 0px (base)
- Shadow: shadow-md (hard offset: `4px 4px 0 0`)
- Border: 2px solid border-default
- Transition: opacity, 200ms

### Header / Title
- Padding: 12px horizontal, 8px vertical
- Background: neutral-secondary-soft
- Bottom border: 2px solid border-default
- Font: 14px, semibold weight, heading color

### Body / Content
- Standard: 12px horizontal, 8px vertical padding; 14px, body color
- Rich: 16px padding; 14px, body color

## Arrows

- Size: 8x8px rotated 45deg
- Color must match the background of the tooltip/popover variant
- Arrow must also have matching 2px border on exposed sides

## Rules

- Tooltips: 0px radius, 2px border
- Popovers: 0px radius, 2px border
- Dark tooltips: dark background, white text
- Light tooltips/popovers: semantic neutral background + border tokens
- Arrows match parent background color with matching border
