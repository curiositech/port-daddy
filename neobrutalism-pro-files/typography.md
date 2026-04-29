# Typography

> Dependencies: `colors.md`

## Core Rules

- **Heading font:** Archivo Black, sans-serif — configured at app level via `--font-head`, never override
- **Body font:** Space Grotesk, sans-serif — configured at app level via `--font-sans`, never override
- **Headings:** bold weight (700–900), heading text color, Archivo Black
- **Body copy:** Space Grotesk, body text color, never use brand color for paragraphs longer than one sentence
- **Semantic HTML:** Use `h1`–`h6` in order, never skip levels

## Heading Scale

### Desktop

| Element | Size | Line-height | Letter-spacing | Margin-bottom |
|---|---|---|---|---|
| `h1` | 64px | 1 | -1px | 24px |
| `h2` | 48px | 1.1 | -0.5px | — |
| `h3` | 36px | 1.15 | — | — |
| `h4` | 30px | 1.2 | — | — |
| `h5` | 24px | 1.3 | — | — |
| `h6` | 20px | 1.25 | — | — |

### Responsive

| Element | Tablet (≥768px) | Mobile (default) |
|---|---|---|
| `h1` | 44px | 36px |
| `h2` | 38px | 30px |
| `h3` | 30px | 24px |
| `h4` | 26px | 22px |
| `h5` | 22px | 20px |
| `h6` | 18px | 18px |

Mobile-first: start with mobile sizes, scale up at tablet and desktop breakpoints.

Never reduce line-height below 1.1 for any heading.

## Paragraphs

### Leading Paragraph
- Size: 20px
- Weight: normal (400)
- Font: Space Grotesk
- Color: body
- Line-height: 1.7
- Max width: ~70 characters

### Normal Paragraph
- Size: 16px
- Weight: normal (400)
- Font: Space Grotesk
- Color: body
- Line-height: 1.7
- Max width: ~65 characters

### Small Supporting Copy
- Size: 14px
- Weight: normal (400)
- Font: Space Grotesk
- Color: body
- Line-height: 1.6
- Use only for helper text, legal text, captions, metadata.

## UI Labels

| Context | Size | Weight |
|---|---|---|
| Button labels | 16px | 600 (semibold) |
| Input labels | 14px or 16px | 600 (semibold) |
| Captions / meta / badges | 12px or 14px | 500 (medium) |

Do not apply paragraph line-height (1.7) to control labels.

## Links

- **Inline links:** Same size as surrounding text, fg-brand color, underline, hover → no underline
- **CTA links:** fg-brand color, semibold weight, underline, hover → no underline

## Emphasis

- `<strong>` for high-priority emphasis in body text
- `<em>` for tone emphasis only, not visual hierarchy
- All-caps only for short labels: uppercase, 0.8px letter-spacing, 12px or 14px

## Dark Mode

Hierarchy stays identical. Only color tokens change (automatic via CSS custom properties). Size, weight, and spacing remain constant.
