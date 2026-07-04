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

- `triad-scout-panel.html` — **current**: the corpus has no other Scout mock;
  conformed to ch20 (palette v2, IBM Plex + Recursive, rule-8 micro-flags,
  rule-5 hairline cards).
- `triad-fleetbar-popover.html`, `triad-console-detail.html` — **converged
  base renders** (parley convergence §8): ch20 is the skin/law they evolve
  under (palette v2 expansion, micro-flags, Plex/Recursive, cut-paper slots =
  punch-list item 1); PR #671's overlapping FleetBar/console/Scout renders
  retire in their favor. Also still the ch19 gate-fixture references
  (IT-016/IT-017 anatomy).
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
