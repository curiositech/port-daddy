# Content & Grid System

> Dependencies: `layout.md`, `typography.md`

## Containers

| Type | Max width | Horizontal padding |
|---|---|---|
| Standard | 1280px | 16px |
| Internal (reading) | 768px | — (45–75 char line length) |

## Vertical Padding

| Breakpoint | Vertical padding |
|---|---|
| Mobile | 32px |
| Tablet (≥768px) | 48px |
| Desktop (≥1024px) | 64px or 96px for hero/feature sections |

## Grid System

Mobile-first with flexible desktop configurations.

| Context | Gap |
|---|---|
| Standard content/cards | 32px |
| Compact widgets/metadata | 16px |

### Responsive Columns

| Breakpoint | Columns |
|---|---|
| Mobile (default) | 1–2 |
| Small/Tablet (≥640px) | 2–4 |
| Desktop (≥1024px) | 3–12 |

Full support for 6, 7, 8, 9+ column grids where needed.

## Breakpoints

| Name | Width |
|---|---|
| Small | 640px |
| Medium | 768px |
| Large | 1024px |
| Extra large | 1280px |
| 2x Extra large | 1536px |

## Rules

- Always design mobile-first
- Use layout shifts (column → row) to accommodate horizontal space
- Lists: 24px indentation, 8px vertical gap between items
- Body copy: 16px, 1.625 line-height
- All interactive links follow brand underline/hover protocol
