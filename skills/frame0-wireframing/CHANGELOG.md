# Changelog — frame0-wireframing

## 0.1.0 — 2026-06-26

Initial release.

- Authored `SKILL.md`: activation triggers + NOT-for boundary (hi-fi design → web-design-expert/Figma;
  production code → frontend skills), fidelity and primitive decision-point mermaids, a UI-element → Frame0
  tool-call cookbook table, Novice/Expert anti-patterns (premature hi-fi, absolute-positioning vs frames+align,
  guessing params, linking before shapes exist), quality gates, and a worked-example pointer.
- `references/01-frame0-mcp-tool-reference.md`: accurate per-tool parameter contract for the full Frame0 MCP
  surface (pages, frames, shapes, edits, connectors, links, export), verified against the live MCP tool schemas
  (June 2026). Documents the absolute-coordinate / relative-`move_shape` model and the `search_icons` vs
  `get_available_icons` schema-wording discrepancy.
- `references/02-wireframing-patterns.md`: grayscale/8pt layout discipline + build recipes for button, input,
  card, navbar, list row, modal, empty state, tab bar, media placeholder.
- `references/03-flows-and-prototyping.md`: connectors vs `set_link`, multi-page navigation, wireflows, the
  wireframe→mockup→prototype progression, export/handoff.
- `references/04-when-wireframe-vs-mockup.md`: low-fi vs hi-fi decision and escalation/handoff.
- `references/INDEX.md`: reference routing table.
- `examples/login-flow-recipe.md`: end-to-end build (login + home + connector + clickable link + export).

Note: live MCP tool calls were unavailable during authoring because the Frame0 desktop app was not running
(MCP could not reach its local port); all parameters were verified against the loaded MCP tool JSON schemas.
