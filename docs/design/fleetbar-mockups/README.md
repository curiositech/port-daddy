# FleetBar Mockups

This folder preserves FleetBar design exploration that previously lived under
`.scratch/fleetbar-mockups/`.

These files are review artifacts, not shipped app surfaces. Keep them here while
the FleetBar/TUI design direction is being reconciled with the native Swift app,
the shared token work in `design/`, and the `core/pd-tui` prototype.

## Design authority (parley settled 2026-07-05)

Binder ch20 (story linework, PR #657) is the design constitution; its
normative app mocks live in `docs/design/story-linework/apps.html`
(FleetBar, pd-console, Fleet Control Center, CLI, Harbor co-edit). Status of
the files here:

**THE CONVERGED SET (punch-list item 1, executed 2026-07-05)** — seven
surfaces on one skin (`ch20-tokens.css`: palette v2, rule-8 micro-flags,
IBM Plex + Recursive, fractional linework), light+dark:

- `triad-fleetbar-popover.html` — three faces incl. verdict-1 state-dependent
  stacking (resting/armed/drawer) + berth lanes. Punch-list items 1+2.
- `triad-console-detail.html` — layer-hued rail, brackets on the live pane,
  denial-as-evidence transcript, hot-bus status bar.
- `triad-scout-panel.html` — capture + ask-agent + honest daemon chips.
- `triad-login.html` — trust model in one screen (cobalt local-first slab,
  pairing ritual, no-custodial-keys). Content: PR #671.
- `triad-account.html` — violet keyring slab, receipt drawer, consent ledger,
  device capability roles. Content: PR #671.
- `triad-control-center.html` — one cobalt running zone, budget wears gold,
  Papa teaching empty state, micro-flag activity rail. Content: PR #671.
- `triad-coop-harbor.html` — remote co-op: crew capability cards (humans and
  agents), claims as line-range stripes, hatched conflict forecast, structured
  parley, gold-cost gates, durable ledger. Content: PR #671.

These are also the ch19 gate-fixture references (IT-015..IT-018 anatomy).
- Older `v*`/`operator-tui-*` files predate the ch19/ch20 decisions; idea
  sources only.

## Technical contracts

The buildable truth for these mockups now lives in the Agent Harbor binder;
the HTML files remain the visual source:

- `interactive-mockup.html` (intent-first reframe) and `research-report.html`
  (fractional-border design language, six-state grammar, tokens) →
  `docs/architecture/agent-harbor-technical-binder/work-packets/fleetbar-technical-spec.md`
- `extension-feedback.html` and `ask-agent-panel.html` (Scout) →
  `docs/architecture/agent-harbor-technical-binder/work-packets/scout-extension-technical-spec.md`
- Surface placement, hot/cool bus, and the enforced-MCP position →
  `docs/architecture/agent-harbor-technical-binder/19-operator-surface-triad.md`

## Superseded by chapter 20 (Story Linework)

The 2026-07-05 design parley (`docs/design/2026-07-05-surface-redesign/03-parley-convergence.md`)
converged all surface styling on binder ch. 20
(`docs/architecture/agent-harbor-technical-binder/20-design-system-story-linework.md`),
operator-approved 2026-07-04. Consequences for this folder:

- `operator-console-v12-synthesis.html` and the `v12-feelpass-slices/` palette are
  **superseded**: their 8/12px border-radius and 6px offset shadows contradict both the
  fractional-linework law and ch. 20 rule 6 (1px texture / 1.5px linework / 2px enclosure),
  and mustard-as-brand retires in favor of palette v2 hue-as-layer (budget/economy
  surfaces wear gold). Keep the files for lineage; do not build from them.
- `interactive-mockup.html` / `research-report.html` remain valid *lineage* for the
  fractional-border taxonomy and the stripe+dot motion contract (pulse only in-flight,
  repaint on change), both absorbed into ch. 20's rules 8–9.
- The `triad-*.html` spec pixels (PR #658) are the base renders the ch. 20 evolution
  builds on (parley §8).
