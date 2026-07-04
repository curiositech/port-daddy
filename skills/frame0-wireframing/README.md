# frame0-wireframing

Expertise for building **low-fidelity wireframes, screen mockups, and user-flow diagrams in Frame0** — the
hand-drawn (Balsamiq-style) wireframing tool — through its connected MCP server.

The core value is **API accuracy**: the skill documents the real Frame0 MCP tool surface (parameters,
required vs optional, the relative-`move_shape` coordinate model, and gotchas like page-before-frame and
`search_icons` vs the schema's `get_available_icons` wording) so a model calls the right tool with the right
params on the first try. It also encodes wireframing craft: grayscale boxes-and-labels discipline, the
wireframe→mockup→prototype progression, a UI-element cookbook, and connectors + `set_link` for clickable flows.

- `SKILL.md` — entry point: when to use, decision points, UI-element → tool-call table, anti-patterns, quality gates.
- `references/` — tool reference, pattern cookbook, flows/prototyping, fidelity decision (see `references/INDEX.md`).
- `examples/login-flow-recipe.md` — a full end-to-end build (login + home + connector + link + export).

Prerequisite: the Frame0 desktop app must be running for the MCP tools to connect.

NOT for high-fidelity visual design (use web-design-expert / Figma) or production UI code (use frontend skills).
