# Optimized Shader Implementation Guide

[One-sentence description of the shader(s) this guide covers, e.g. "PBR fragment shader for the character material pipeline."]

## Shader Type Decision

- **Stage chosen:** [fragment|compute|vertex|tile]
- **Why:** [cite the Decision Points matrix: data-independence, memory access pattern, bandwidth vs ALU limited]

## Precision Plan

| Value | Type | Reason |
|---|---|---|
| [e.g. albedo color] | `half4` | display-bound, halves registers/bandwidth |
| [e.g. world position] | `float3` | position math needs 32-bit precision |

## Failure Modes Checked

- [ ] Bandwidth Bandit — no unnecessary multi-pass store/load; memoryless intermediates used
- [ ] Register Pressure Cascade / Precision Overkill — `half` used for all display-bound values
- [ ] Branch Divergence Disaster — no runtime branch on uniforms; function constants used for variants
- [ ] Query-Based Ray Tracing — intersector API used, not intersection query, if ray tracing is involved
- [ ] Tile memory ≤ 32KB per tile
- [ ] Threadgroup size is a multiple of 32

## Implementation

```metal
[final MSL source]
```

## Measured Results

| Metric | Before | After | Target |
|---|---|---|---|
| GPU occupancy | | | ≥ 75% |
| Register usage | | | ≤ 80% |
| Tile memory (KB) | | | ≤ 32 |
| Frame time (ms) | | | < 16.67 (60fps) |

## Shader Perf Audit

Run the deterministic auditor against the plan this guide implements before
shipping:

```bash
node scripts/shader_perf_audit.mjs --input <this-plan-as>.json
```

Paste the `pass`/`findings`/`recommendations` output here, and resolve any
`high` or `critical` finding before merging.
