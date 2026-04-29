# Color Tokens

## Background Tokens

### Neutral
| Token | Light | Dark |
|---|---|---|
| neutral-primary-soft | #FFFFFF | #1A1A1A |
| neutral-primary | #FFFFFF | #1A1A1A |
| neutral-primary-medium | #FFFFFF | #242424 |
| neutral-primary-strong | #FFFFFF | #3A3A3A |
| neutral-secondary-soft | #F5F5F0 | #1A1A1A |
| neutral-secondary | #F5F5F0 | #1A1A1A |
| neutral-secondary-medium | #F5F5F0 | #242424 |
| neutral-secondary-strong | #F5F5F0 | #3A3A3A |
| neutral-tertiary-soft | #EBEBEB | #1A1A1A |
| neutral-tertiary | #EBEBEB | #242424 |
| neutral-tertiary-medium | #EBEBEB | #3A3A3A |
| neutral-quaternary | #E0E0E0 | #3A3A3A |
| quaternary-medium | #E0E0E0 | #4A4A4A |
| gray | #AEAEAE | #4A4A4A |

### Brand
| Token | Light | Dark |
|---|---|---|
| brand-softer | #FFF9E0 | #332A00 |
| brand-soft | #FFF3C4 | #4D3F00 |
| brand | #FFDB33 | #FFDB33 |
| brand-medium | #FAE583 | #4D3F00 |
| brand-strong | #FFCC00 | #FFE066 |

### Status
| Token | Light | Dark |
|---|---|---|
| success-soft | #ECFDF5 | #052E16 |
| success | #16A34A | #22C55E |
| success-medium | #DCFCE7 | #14532D |
| success-strong | #15803D | #16A34A |
| danger-soft | #FEF2F2 | #450A0A |
| danger | #E63946 | #E63946 |
| danger-medium | #FECACA | #7F1D1D |
| danger-strong | #C41E30 | #EF4444 |
| warning-soft | #FFFBEB | #78350F |
| warning | #F59E0B | #F59E0B |
| warning-medium | #FEF3C7 | #78350F |
| warning-strong | #D97706 | #D97706 |

### Button Glint (CSS custom properties, used for the glint box-shadow effect)
| Variable | Light | Dark |
|---|---|---|
| `--color-1-400` | rgba(255,255,255,0) | rgba(255,255,255,0) |
| `--color-1-700` | rgba(0,0,0,0) | rgba(0,0,0,0) |

### Utility
| Token | Light | Dark |
|---|---|---|
| dark | #000000 | #000000 |
| dark-strong | #000000 | #3A3A3A |
| disabled | #F5F5F5 | #242424 |

### Accent
| Token | Value (same both modes) |
|---|---|
| purple | #8B5CF6 |
| sky | #0EA5E9 |
| teal | #14B8A6 |
| pink | #EC4899 |
| cyan | #06B6D4 |
| fuchsia | #D946EF |
| indigo | #6366F1 |
| orange | #FB923C |

## Text Color Tokens

### Base
| Token | Light | Dark |
|---|---|---|
| white | #FFFFFF | #FFFFFF |
| black | #000000 | #000000 |
| heading | #000000 | #F5F5F5 |
| body | #5A5A5A | #A0A0A0 |
| body-subtle | #6B7280 | #A0A0A0 |

### Brand
| Token | Light | Dark |
|---|---|---|
| fg-brand-subtle | #FAE583 | #5C4B00 |
| fg-brand | #B8860B | #FFDB33 |
| fg-brand-strong | #996600 | #FAE583 |

### Status
| Token | Light | Dark |
|---|---|---|
| fg-success | #16A34A | #22C55E |
| fg-success-strong | #15803D | #4ADE80 |
| fg-danger | #E63946 | #F87171 |
| fg-danger-strong | #C41E30 | #FCA5A5 |
| fg-warning-subtle | #D97706 | #F59E0B |
| fg-warning | #92400E | #FBBF24 |
| fg-disabled | #AEAEAE | #5A5A5A |

### Informational / Accent
| Token | Light | Dark |
|---|---|---|
| fg-yellow | #EAB308 | #FACC15 |
| fg-info | #1E40AF | #93C5FD |
| fg-purple | #7C3AED | #8B5CF6 |
| fg-purple-strong | #6D28D9 | #C4B5FD |
| fg-cyan | #0891B2 | #06B6D4 |
| fg-indigo | #4F46E5 | #6366F1 |
| fg-pink | #DB2777 | #EC4899 |
| fg-lime | #65A30D | #84CC16 |

## Border Color Tokens

| Token | Light | Dark |
|---|---|---|
| border-dark | #000000 | #F5F5F5 |
| border-buffer | #FFFFFF | #1A1A1A |
| border-buffer-medium | #FFFFFF | #242424 |
| border-buffer-strong | #FFFFFF | #3A3A3A |
| border-muted | #E0E0E0 | #242424 |
| border-light-subtle | #D0D0D0 | #242424 |
| border-light | #BFBFBF | #2E2E2E |
| border-light-medium | #BFBFBF | #3A3A3A |
| border-default-subtle | #000000 | #2E2E2E |
| border-default | #000000 | #3A3A3A |
| border-default-medium | #000000 | #3A3A3A |
| border-default-strong | #000000 | #4A4A4A |
| border-success-subtle | #16A34A | #14532D |
| border-success | #15803D | #16A34A |
| border-danger-subtle | #E63946 | #7F1D1D |
| border-danger | #C41E30 | #E63946 |
| border-warning-subtle | #D97706 | #78350F |
| border-warning | #D97706 | #F59E0B |
| border-brand-subtle | #FFCC00 | #5C4B00 |
| border-brand-light | #FFDB33 | #FFDB33 |
| border-brand | #FFCC00 | #FFE066 |
| border-dark-subtle | #000000 | #3A3A3A |
| border-purple | #8B5CF6 | #8B5CF6 |
| border-orange | #FB923C | #FB923C |

## Semantic Usage Rules

- Page/section backgrounds: neutral-primary-soft (default), neutral-secondary-soft (alternating)
- Primary buttons: brand background with black text
- Headings: heading text color (#000000 light / #F5F5F5 dark)
- Body text: body text color
- CTA links: fg-brand text color
- Default borders: border-default (#000000 in light — the signature neobrutalism black outline)
- Status borders match intent: success → border-success, danger → border-danger, warning → border-warning
- Disabled: disabled background + fg-disabled text

## Prohibited

- No raw hex/rgb values in component code — always use design tokens
- No brand text color for long-form paragraphs
- No accent text tokens (fg-purple, etc.) for body copy or navigation
- No brand/accent backgrounds for large layout surfaces (pages, sections) unless it's a hero/campaign area
- No manual light/dark value swapping — let the CSS custom properties handle it
- No soft/blurred shadows — neobrutalism uses hard offset shadows only
