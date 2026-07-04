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
- `triad-fleetbar-popover.html`, `triad-console-detail.html` — **superseded**
  by `apps.html` for styling; retained as ch19 structural/gate-fixture
  references (IT-016/IT-017 anatomy). Banners inside say so.
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
