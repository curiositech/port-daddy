# Changelog

## [2.1.0] - 2026-07-03

### Changed
- Frontmatter moved `category`/`tags`/`pairs-with` under a `metadata` block and
  added `metadata.provenance` (first-party, port-daddy) and
  `metadata.io-contract` (consumes a shader requirement + MSL shader plan,
  produces an optimized-shader implementation guide + shader-perf audit).
- `pairs-with` replaced `native-app-designer`/`2000s-visualization-expert`
  with the verified-to-exist, more directly relevant `gpui-shaders`,
  `metal-text-pipeline`, `vello-parley-rendering`, `rust-gpui-motion`.
- Folded the orphaned top-level `reference.md` (a pre-2.0.0-split leftover
  that was never linked from `SKILL.md`) into `references/`: its Live Value
  Inspector and Performance Profiler Overlay sections were appended to
  `references/debug-tools.md`; its Weta/Pixar production techniques,
  optimization mental model, tools checklist, and closing philosophy became
  the new `references/production-and-performance.md`. `reference.md` deleted.
- Added a "Reference Files" section to `SKILL.md` linking all four
  `references/*.md` files, which previously existed but were never
  referenced from `SKILL.md`.

### Added
- `scripts/shader_perf_audit.mjs` — deterministic `auditShaderPerf(plan)`
  auditor covering all five failure modes (bandwidth bandit, register
  pressure cascade / precision overkill, branch divergence, tile memory
  >32KB, threadgroup size not a multiple of 32).
- `schemas/shader-plan.schema.json` (draft-07) and `examples/sample-input.json`
  (a two-shader plan that scores `pass: true`).
- `README.md`, `agents/openai.yaml`, `templates/output-template.md`.

## [2.0.0] - 2024-12-XX

### Changed
- **SKILL.md restructured** for progressive disclosure (406 → ~115 lines)
- Shader code examples extracted to reference files
- Removed duplicate Philosophy section

### Added
- `references/pbr-shaders.md` - Complete Cook-Torrance BRDF, Fresnel-Schlick, GGX distribution, Smith geometry
- `references/noise-effects.md` - Hash functions, smooth noise, FBM, Voronoi, domain warping, animated effects
- `references/debug-tools.md` - Heat maps, debug modes, overdraw visualization, NaN detection, wireframe overlay
- Shibboleths table (half vs float, TBDR architecture, intersector API)
- Apple Family 9 note on threadgroup memory changes

### Migration Guide
- No changes to frontmatter or activation triggers
- Shader code now in reference files for copy-paste use
- Philosophy section deduplicated (single version retained)
