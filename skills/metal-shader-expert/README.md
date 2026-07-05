# Metal Shader Expert

20+ years Weta/Pixar-style experience specializing in Metal shaders, real-time
rendering, and Apple's Tile-Based Deferred Rendering (TBDR) architecture.

Use this skill when writing or reviewing MSL (fragment/compute/vertex/tile)
shaders, choosing half vs float precision, debugging register pressure or
branch divergence, or auditing a shader plan against Apple GPU limits (tile
memory, threadgroup size, occupancy).

## Quick Start

1. Read `SKILL.md` for the shader-type decision matrix, precision trade-off
   tree, and the five core failure modes with worked before/after examples.
2. Load `references/pbr-shaders.md`, `references/noise-effects.md`,
   `references/debug-tools.md`, or `references/production-and-performance.md`
   on demand — each is self-contained.
3. Fill `templates/output-template.md` for the shader at hand, or write a
   plan matching `schemas/shader-plan.schema.json` directly.
4. Run `node scripts/shader_perf_audit.mjs --input plan.json`.

A plan that scores `pass: true` has cleared the bandwidth-bandit,
register-pressure/precision-overkill, branch-divergence, tile-memory, and
threadgroup-size gates this skill teaches. If it doesn't, fix the shader
plan, not the auditor.
