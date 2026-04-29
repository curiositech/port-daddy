# Quality Gates

Use this for implementation review, CI, release readiness, and adversarial
audits.

## Accessibility

Baseline:

- WCAG 2.2 AA hard gate.
- AAA contrast targets where feasible: 7:1 normal text, 4.5:1 large text.
- 3:1 minimum for focus indicators, non-text UI, and meaningful graphics.
- Keyboard access for every interactive element.
- No keyboard traps.
- Visible focus that is not hidden by sticky chrome.
- Accessible names and descriptions for controls.
- Semantic HTML before ARIA.
- Reduced-motion support for animation.
- Touch targets that are practical on mobile.

Automation is not enough. Pair axe/Storybook checks with keyboard testing,
screen-reader spot checks, and focus-order review.

## Performance

Core Web Vitals targets at p75, segmented mobile and desktop:

- LCP <= 2.5s
- INP <= 200ms
- CLS <= 0.1

Also set budgets for:

- route JavaScript
- CSS
- image bytes and dimensions
- font files and preload strategy
- hydration cost
- server response time
- interaction latency for core flows

Prefer server rendering, static generation, islands, route-level splitting, and
lazy loading when they reduce real user cost.

## Storybook and Tests

Required for component systems:

- Storybook configured.
- Stories for every state in the component contract.
- Accessibility addon or Vitest/browser tests with failing CI behavior for
  serious components.
- Interaction tests for menus, dialogs, tabs, forms, command palettes, and data
  tables.
- Visual regression for critical components and templates.

Application tests should include:

- route rendering
- data loading and errors
- form validation
- auth/permission states
- server actions or API routes
- analytics and observability events where important

## Observability

Use Sentry or an equivalent platform when the app is more than a static toy:

- client, server, and edge/runtime initialization where applicable
- release and environment tags
- source maps
- error boundary or global error capture
- tracing sample policy
- replay sample policy with privacy defaults
- structured logs or breadcrumbs for critical flows
- verified test event before launch

Never enable broad PII capture without a deliberate privacy review.

## PWA

If PWA is in scope:

- HTTPS
- valid manifest linked from every installable page
- name, short_name, start_url, scope, display, theme/background color
- icons at 192 and 512 plus maskable icon where appropriate
- offline fallback or explicit online-only behavior
- service-worker update strategy
- installability test
- app shell does not hide browser escape routes for external links

## SEO and Metadata

- Unique title and description per route.
- Canonical URL.
- sitemap and robots.
- Open Graph and Twitter/social metadata.
- Absolute OG image URLs with dimensions and alt where supported.
- Per-page OG images for important pages.
- Structured data where applicable.
- Heading hierarchy and readable content.
- Indexing rules match the launch plan.

## Release Evidence

Before claiming done, record:

- commands run and results
- unresolved risks
- screenshots reviewed on desktop and mobile
- audit script output
- accessibility evidence
- performance evidence
- Storybook/test evidence
- content/SEO/legal evidence

If a gate cannot run, say which one and why.
