# Harbor Research (session codification, 2026-08-16)
Start at `HANDOFF.md` — repo map, crosswalk of all results, 13 paste-ready wave prompts (W1–W13), and the knowledge dump (§3: citations, toolchain pins, the sheaf-harness autopsy, novelty anchors, numeric master table, environment traps).
The three companion skills live in `skills/{harbor-exposition,harbor-results,falsification-first}` — read those SKILL.md files before doing anything.
Build: `make figures` regenerates the PNGs from `skills/harbor-results/scripts/` (seed 20260816); `make docs` compiles the PDFs from `tex/`. Binaries are deliberately not committed.

After applying this patch, run `npm run skills:sync` so every agent runtime discovers the three skills (symlinks into `.claude/skills`, `.codex/skills`, `.gemini/*`, `.cursor/skills`, `.agy`, `.agents` — gitignored, environment-local; auto-discovery, no registration). Add `-- --scope user` (or run `pd setup`) to install account-wide into `~/.claude/skills`. CI's `skills:sync:check` and `check:skill-mirrors` are unaffected: mirrors are only for skills declaring `metadata.mirrors`, which these deliberately do not.
