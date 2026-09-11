# Data tables for ui-ux-pro-max

Every file here is a CSV lookup table the skill's scripts read; none is prose.
Each row is keyed by `No` and carries a `Keywords` column where one exists, so a
request can be matched to rows before any of it is put in front of the model.
Row counts are the number of data rows, not counting the header.

## Recommendation tables

| File | Rows | What one row is |
|---|---|---|
| [`products.csv`](products.csv) | 95 | A product type, and the style, landing pattern and palette that suit it. Start here when the request names what is being built rather than how it should look. |
| [`styles.csv`](styles.csv) | 67 | A named visual style with its colors, effects and the products it fits. |
| [`ui-reasoning.csv`](ui-reasoning.csv) | 100 | A UI category mapped to a pattern, style priority, color and typography mood, and the effects that carry it. |
| [`landing.csv`](landing.csv) | 30 | A landing-page pattern: section order, where the primary CTA sits, color strategy. |

## Element tables

| File | Rows | What one row is |
|---|---|---|
| [`colors.csv`](colors.csv) | 96 | A palette per product type — primary, secondary, CTA, background, text and border, as hex. |
| [`typography.csv`](typography.csv) | 56 | A font pairing: heading face, body face, mood keywords, and where to get it. |
| [`icons.csv`](icons.csv) | 100 | An icon with its library, import line, and what it is properly used for. |
| [`charts.csv`](charts.csv) | 25 | A data shape mapped to the chart type that reads it, with color guidance and performance cost. |

## Review tables

Consulted when auditing an interface rather than designing one. Each row states
the issue, a Do and a Don't, good and bad code, and a severity.

| File | Rows | Scope |
|---|---|---|
| [`ux-guidelines.csv`](ux-guidelines.csv) | 98 | UX defects across platforms. |
| [`web-interface.csv`](web-interface.csv) | 30 | Web-specific interface defects. |
| [`react-performance.csv`](react-performance.csv) | 44 | React render and bundle costs. |

## Per-stack tables

[`stacks/`](stacks/) holds one CSV per target stack — `astro`, `flutter`,
`html-tailwind`, `jetpack-compose`, `nextjs`, `nuxt-ui`, `nuxtjs`,
`react-native`, `react`, `shadcn` — so a recommendation lands as code in the
stack the project actually uses instead of as generic advice.
