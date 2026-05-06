# PR-2 — Agents + integrations + chart palette tokens

**Branch name:** `voice-design-pr2-agents-integrations`
**Worktree path:** `~/coding/port-daddy/.claude/worktrees/voice-design-pr2-agents-integrations`

## Files you own (and ONLY these)

- `website-v2/src/pages/AgentsPage.tsx`
- `website-v2/src/pages/MCPPage.tsx`
- `website-v2/src/pages/integrations/**` (entire integrations subtree)
- `website-v2/src/docs-content/referenceArchitectures.ts` *(102 raw-color
  literals to fix — chart palette)*

## What to do

1. **Voice pass** — apply the user voice profile to copy on AgentsPage,
   MCPPage, and the integrations pages. Same playbook as PR-1.
2. **Color blocking + padding cuts** — same patterns as PR-1.
3. **Chart palette → tokens** — `referenceArchitectures.ts` has raw hex
   colors used for chart/diagram palettes. Either:
   - (preferred) Move them to a colocated `chartTokens.ts` file that
     references CSS variables and exposes a typed palette, OR
   - Move them to `tokens.semantic.css` as new chart-tier tokens and
     consume via `getComputedStyle(document.documentElement).getPropertyValue('--chart-N')`.
   Pick the option that fits the existing pattern. Audit re-run should
   bring the raw-color count for this file to 0.

## Validation gates + PR template

Same as PR-1, but the validation focuses on:

- `referenceArchitectures.ts` raw-color count: 102 → 0
- AgentsPage and MCPPage screenshots in `.scratch/`
- All charts/diagrams render correctly in light + dark mode
