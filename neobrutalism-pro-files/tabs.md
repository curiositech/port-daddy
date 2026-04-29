# Tabs

> Dependencies: `colors.md`, `radius.md`, `shadows.md`

## Core Specs

- Typography: 14px, semibold weight, body color
- Transitions: all properties, 100ms

## Variants

### 1. Underline (Default)

**Wrapper:** bottom border, 2px solid border-default

**Tab Item:**
- Padding: 16px horizontal, 16px vertical
- Bottom border: 3px, transparent
- Top corners: 0px radius
- Transition: colors, 100ms

| State | Appearance |
|---|---|
| Active | fg-brand text, border-brand bottom border |
| Inactive | transparent bottom border; hover → heading text, border-default-strong bottom border |
| Disabled | fg-disabled text, not-allowed cursor |

### 2. Pills

**Tab Item:**
- Padding: 16px horizontal, 10px vertical
- Radius: 0px (base)
- Font weight: semibold
- Border: 2px solid border-default
- Transition: all, 100ms

| State | Appearance |
|---|---|
| Active | brand background, black text, shadow-sm (hard offset) |
| Inactive | body text; hover → neutral-secondary-soft background, heading text |
| Disabled | fg-disabled text, not-allowed cursor |

### 3. Full Width

Children overlap with -1px left margin on all except first.

**Tab Item:**
- Full width, centered text
- Padding: 16px horizontal, 16px vertical
- Background: neutral-primary-soft
- Border: 2px solid border-default
- Transition: colors, 100ms
- Hover: neutral-secondary-medium background, heading text

| State | Appearance |
|---|---|
| Active | neutral-secondary-soft background, fg-brand text |
| First item | sharp start (0px) |
| Last item | sharp end (0px) |

## Tabs with Icons

- Icon size: 16x16px or 20x20px
- Spacing: 8px right margin
- Layout: inline-flex, centered
- Icons inherit the text color of the tab state
