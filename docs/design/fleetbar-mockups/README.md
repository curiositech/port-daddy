# FleetBar Mockups

This folder preserves FleetBar design exploration that previously lived under
`.scratch/fleetbar-mockups/`.

These files are review artifacts, not shipped app surfaces. Keep them here while
the FleetBar/TUI design direction is being reconciled with the native Swift app,
the shared token work in `design/`, and the `core/pd-tui` prototype.

## Spec-aligned mockups (current generation)

Static renders of what the binder ch19 specs actually commit to — system SF
type, tabular mono, fractional borders, placeholder palette pending PR #455:

- `triad-fleetbar-popover.html` — intent-first home + fleet drawer, six-state
  grammar, gate card, inline expansion
- `triad-scout-panel.html` — region selection, annotation panel with closed
  category taxonomy and routed-shape confirmation, ask-agent face, daemon chips
- `triad-console-detail.html` — pd-console roster/detail, transcript with a
  governance denial, compliance-gated controls

Older `v*`/`operator-tui-*` files predate the ch19 vocabulary and type/palette
decisions; treat them as idea sources only.

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
