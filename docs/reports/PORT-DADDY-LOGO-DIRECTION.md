# Port Daddy Logo Direction

## Problem

The current logo is too illustrated and detailed for the product Port Daddy has
become. It reads like a themed app mascot. The website now presents Port Daddy as
a local communication substrate and Mac control plane for coding agents, so the
identity needs to feel systematic, durable, inspectable, and tiny-icon ready.

## Recommendation

Move to a geometric mark plus wordmark:

- no mascot
- no tiny line-art scene
- no gradient-only identity
- no adversarial resource-contest metaphor
- must work at 16 px in the menu bar
- must work as a favicon, app icon, header mark, and GitHub social image

## Selected Direction: PD Circuit Monogram

Use a compact `PD` monogram built from squared strokes and a central blue
channel. It keeps the "agents talk through shared state" idea from the
SVG-maker prototype, but makes the identity more ownable and easier to recognize
than a generic node diagram.

Why it fits:

- agents-to-agents communication is the differentiator
- the blue shared channel maps to notes, claims, actor inboxes, readiness, and
  recoverable handoffs
- the letterform says Port Daddy quickly in app, favicon, and social contexts
- square strokes survive small sizes
- it feels more like infrastructure than a mascot

## Source Prototype

The SVG-maker file at `~/Downloads/svgmaker-2-GBzOdzh7omPYreozvAVA.svg`
confirmed the right motif: a square container, connected nodes, and a central
communication channel. The raw export is too detailed and landscape-shaped for
production, so the shipped SVG is a redrawn square mark.

## Avoid

- anchors, boats, sailor faces, rope, wheels, or old nautical decoration
- overly friendly agent characters
- detailed circuit boards that blur at menu-bar size
- a logo that only works in blue

## Next Steps

1. Export app-icon sizes from the new `PD Circuit Monogram`.
2. Create a one-color FleetBar menu-bar template variant.
3. Export `pd_logo.svg`, `pd_logo_darkmode.svg`, favicon, app icon, and a
   FleetBar menu-bar template variant.
4. Verify at 16 px, 24 px, 40 px, 128 px, and
   social-card size.

Visual board: `docs/reports/port-daddy-logo-direction.html`
