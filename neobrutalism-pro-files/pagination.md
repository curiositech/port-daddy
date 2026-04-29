# Pagination

> Dependencies: `colors.md`, `radius.md`

## Container

Font: 14px. Items displayed as flex with -1px overlap for seamless borders.

## Pagination Item

- Layout: flex, centered both axes
- Size: 36x36px (or 40x40px)
- Text: body color, semibold weight
- Background: neutral-secondary-medium
- Border: 2px solid border-default (black in light mode)
- Hover: neutral-tertiary-medium background, heading text
- Focus: no outline
- Overlap: -2px left margin

## Previous / Next Buttons

- Horizontal padding: 12px, height: 36px
- First item: 0px radius on inline-start side
- Last item: 0px radius on inline-end side

## Active Page Item

- Text: fg-brand color
- Background: neutral-tertiary-medium
- Hover text: fg-brand (stays same)

## Rules

- Display as flex with -2px child overlap for seamless borders
- Items: neutral-secondary-medium background, 2px border-default border, body text
- Active: fg-brand text, neutral-tertiary-medium background
- First item: sharp start, Last item: sharp end
- All items need hover and focus states
