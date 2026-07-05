---
license: Apache-2.0
name: metal-shader-expert
description: 20 years Weta/Pixar experience in real-time graphics, Metal shaders, and visual effects. Expert in MSL shaders, PBR rendering, tile-based deferred rendering (TBDR), and GPU debugging. Activate on 'Metal shader', 'MSL', 'compute shader', 'vertex shader', 'fragment shader', 'PBR', 'ray tracing', 'tile shader', 'GPU profiling', 'Apple GPU'. NOT for WebGL/GLSL (different architecture), general OpenGL (deprecated on Apple), CUDA (NVIDIA only), or CPU-side rendering optimization.
allowed-tools: Read,Write,Edit,Bash(xcrun:*,metal:*,metallib:*),mcp__firecrawl__firecrawl_search,WebFetch
metadata:
  category: Frontend & UI
  tags:
    - metal
    - shaders
    - gpu
    - graphics
    - apple
  provenance:
    kind: first-party
    owners:
      - port-daddy
  pairs-with:
    - skill: gpui-shaders
      reason: gpui renders its custom widgets through Metal shaders on macOS; this skill supplies the MSL/TBDR expertise those shaders need.
    - skill: metal-text-pipeline
      reason: Text rendering pipelines share the same precision/TBDR trade-offs (half vs float, tile memory) this skill's decision matrices cover.
    - skill: vello-parley-rendering
      reason: GPU vector-graphics rendering needs the same bandwidth/occupancy discipline for compute and tile shaders.
    - skill: rust-gpui-motion
      reason: Animated gpui UI often drives per-frame shader parameters; this skill's failure modes (branch divergence, register pressure) apply directly.
  io-contract:
    kind: deliverable
    consumes:
      - kind: shader-requirement
        format: markdown
      - kind: msl-shader-plan
        format: json
    produces:
      - kind: optimized-shader-implementation-guide
        format: markdown
      - kind: shader-perf-audit
        format: json
---
# Metal Shader Expert

20+ years Weta/Pixar experience specializing in Metal shaders, real-time rendering, and creative visual effects. Expert in Apple's Tile-Based Deferred Rendering (TBDR) architecture.

## Decision Points

### Shader Type Selection Matrix

**Massive parallel data processing:**
- If data-independent operations → Compute shader (threadgroup size = data size)
- If per-pixel operations with neighbor access → Tile shader
- If simple per-vertex transformations → Vertex shader
- If per-pixel lighting/materials → Fragment shader

**Memory access patterns:**
- If reading multiple textures per pixel → Fragment shader (tile cache optimized)
- If writing to multiple render targets → Fragment shader with `[[color(n)]]`
- If sharing data between nearby threads → Tile shader with `threadgroup` memory
- If sequential processing → Compute shader with atomic operations

**Performance characteristics needed:**
- If bandwidth-limited (many texture reads) → Tile shader (free tile memory access)
- If ALU-limited (heavy computation) → Compute shader (more threads)
- If geometry-limited → Vertex shader with instancing/amplification

### Memory/Precision Trade-off Decision Tree

```
Input: Variable type needed
├── Position/depth calculations?
│   └── YES: Use `float` (32-bit precision required)
├── Color/normal calculations?
│   ├── HDR/wide gamut? → `float` 
│   └── Standard range? → `half` (saves 50% registers)
├── Iteration counters/indices?
│   └── Use `uint16_t` or `ushort` when possible
└── Temporary calculations?
    ├── Intermediate precision needed? → `float`
    └── Display-bound result? → `half`
```

### TBDR Architecture Decisions

**Render target strategy:**
- If intermediate data not needed after pass → Memoryless texture (`MTLStorageModeMemoryless`)
- If ping-ponging between targets → Use tile shader to avoid store/load
- If multiple render targets → Group related data to minimize bandwidth

## Failure Modes

### 1. "Bandwidth Bandit" - Excessive Memory Traffic
**Detection:** Frame debugger shows high memory bandwidth, low ALU utilization
**Symptoms:** Multiple texture fetches per fragment, storing unnecessary render targets
**Fix:** Use tile shaders for multi-pass effects, memoryless targets for intermediate data
```metal
// BAD: Multiple passes with full store/load
float4 pass1_result = sample_texture(tex1, uv);
// Store to render target, then load in next pass

// GOOD: Tile shader keeps data in tile memory
threadgroup float4 tile_data[64];
// Process multiple steps without memory round-trip
```

### 2. "Register Pressure Cascade" - Poor Data Type Choices
**Detection:** GPU occupancy drops below 50%, register spilling in shader profiler
**Symptoms:** Using `float4` everywhere, large intermediate arrays
**Fix:** Use `half` for display-bound calculations, pack data efficiently
```metal
// BAD: Wastes registers
float4 color, normal, tangent, bitangent;

// GOOD: Efficient packing
half4 color; half3 normal; half2 tangent_packed;
```

### 3. "Branch Divergence Disaster" - Runtime Branching
**Detection:** Fragment shader shows low efficiency in GPU profiler
**Symptoms:** `if/else` statements based on material properties or uniforms
**Fix:** Use function constants for compile-time specialization
```metal
// BAD: Runtime branching
if (material.has_normal_map) { /* complex normal mapping */ }

// GOOD: Function constant
constant bool has_normal_map [[function_constant(0)]];
if (has_normal_map) { /* branch eliminated at compile time */ }
```

### 4. "Precision Overkill" - Unnecessary Float32 Usage
**Detection:** Memory bandwidth higher than expected, register usage at 100%
**Symptoms:** `float` used for colors, normals, and other display-bound values
**Fix:** Default to `half`, upgrade only when precision artifacts appear
```metal
// BAD: Doubles bandwidth unnecessarily
float3 lighting_calculation(float3 normal, float3 light_dir, float3 albedo)

// GOOD: Half precision for display-bound calculations  
half3 lighting_calculation(half3 normal, half3 light_dir, half3 albedo)
```

### 5. "Query-Based Ray Tracing" - Wrong API Pattern
**Detection:** Ray tracing performance significantly below expectations
**Symptoms:** Using intersection query API instead of intersector
**Fix:** Use intersector API with explicit result handling for hardware alignment

## Worked Examples

### Example 1: PBR Fragment Shader Optimization

**Initial novice implementation:**
```metal
fragment float4 pbr_fragment(VertexOut in [[stage_in]],
                            constant Material& material [[buffer(0)]],
                            texture2d<float> albedo_tex [[texture(0)]]) {
    float4 albedo = albedo_tex.sample(sampler, in.uv);
    float3 normal = normalize(in.normal);
    // ... complex BRDF calculation using float everywhere
    return float4(final_color, 1.0);
}
```

**Expert decision process:**
1. **Precision analysis:** Color output is display-bound → use `half` for most calculations
2. **Register optimization:** Pack material properties, use `half` for intermediate values
3. **TBDR optimization:** Multiple material variants → use function constants

**Optimized implementation:**
```metal
constant bool use_normal_map [[function_constant(0)]];
constant bool use_metallic_roughness [[function_constant(1)]];

fragment half4 pbr_fragment(VertexOut in [[stage_in]],
                           constant MaterialHalf& material [[buffer(0)]],
                           texture2d<half> albedo_tex [[texture(0)]]) {
    half4 albedo = albedo_tex.sample(sampler, in.uv);
    half3 normal = normalize(half3(in.normal)); // Only convert once
    
    if (use_normal_map) {
        // Normal mapping branch eliminated at compile time
    }
    
    // BRDF calculation in half precision
    half3 final_color = calculate_brdf_half(albedo.rgb, normal, material);
    return half4(final_color, albedo.a);
}
```

**Performance impact:** 40% reduction in register usage, 2x occupancy increase

### Example 2: Compute Shader vs Tile Shader Decision

**Scenario:** Blur effect needing neighbor pixel access

**Novice approach:** Compute shader with texture reads
```metal
kernel void blur_compute(texture2d<float, access::read> input [[texture(0)]],
                        texture2d<float, access::write> output [[texture(1)]],
                        uint2 gid [[thread_position_in_grid]]) {
    // Multiple texture reads - expensive on TBDR
    float4 result = input.read(gid + uint2(-1, -1)) * 0.0625 + 
                   input.read(gid + uint2(0, -1)) * 0.125 + /* ... */;
    output.write(result, gid);
}
```

**Expert analysis:**
- Multiple texture reads = bandwidth expensive on TBDR
- Fixed-size neighborhood = perfect for tile shader
- Data can stay in tile memory throughout operation

**Optimized tile shader:**
```metal
kernel void blur_tile(imageblock<float4> img_block,
                     texture2d<half, access::read> input [[texture(0)]],
                     ushort2 tid [[thread_position_in_threadgroup]]) {
    // Load tile data once
    img_block.write(half4(input.read(calculate_position(tid))), tid);
    threadgroup_barrier(mem_flags::mem_threadgroup);
    
    // Blur calculation using tile memory (free access)
    half4 result = sample_tile_neighbors(img_block, tid);
    img_block.write(result, tid);
}
```

**Result:** 60% performance improvement due to eliminated bandwidth

## Quality Gates

**Performance Validation:**
- [ ] GPU occupancy > 75% (check in Instruments GPU profiler)
- [ ] Register usage < 80% of available (visible in shader profiler) 
- [ ] Memory bandwidth < 85% of peak (measure with GPU counters)
- [ ] No register spilling detected (zero spill instructions in disassembly)
- [ ] Frame time meets target: <16.67ms for 60fps, <8.33ms for 120fps

**Correctness Validation:**
- [ ] All shader variants compile without warnings
- [ ] Function constants eliminate all conditional branches in hot paths
- [ ] No NaN/Inf values in debug heat map visualization
- [ ] Precision adequate: no visible banding or artifacts in half-precision paths
- [ ] Memory layout matches expected alignment (structs 16-byte aligned)

**Architecture Compliance:**
- [ ] Tile memory usage < 32KB per tile (Apple GPU limit)
- [ ] Threadgroup size matches workload (powers of 32 for compute shaders)
- [ ] Memoryless textures used for all intermediate render targets
- [ ] TBDR-specific optimizations applied (avoid unnecessary stores)

## Reference Files

Load these on demand instead of inlining them here — each is self-contained:

- `references/pbr-shaders.md` — full Cook-Torrance BRDF, Fresnel-Schlick, GGX distribution, Smith geometry.
- `references/noise-effects.md` — hash functions, smooth noise, FBM, Voronoi, domain warping, animated effects.
- `references/debug-tools.md` — heat maps, debug visualization modes, overdraw/mipmap/NaN detection, live value inspector, performance profiler overlay.
- `references/production-and-performance.md` — Weta/Pixar artist-facing material authoring, procedural surface variation, the bandwidth/ALU/occupancy/divergence profiling mental model, and the debug-tooling checklist.

## Deterministic Shader-Perf Auditor

Given a JSON shader plan (see `schemas/shader-plan.schema.json`), run the
auditor to catch this skill's five failure modes mechanically instead of by
eye:

```bash
node scripts/shader_perf_audit.mjs --input examples/sample-input.json
```

It flags bandwidth-bandit multi-pass store/load, float-for-display-bound
precision overkill, low occupancy / high register usage, runtime branching on
a uniform instead of a function constant, tile memory over the 32KB limit,
and threadgroup sizes that aren't a multiple of 32. Use `templates/output-template.md`
to write the optimized-shader implementation guide this skill produces.

## NOT-FOR Boundaries

**Wrong platforms/APIs:**
- **WebGL/OpenGL ES:** Use `webgl-shader-expert` - different precision rules, extension handling
- **CUDA/OpenCL:** Use `gpu-compute-expert` - different memory model, NVIDIA-specific optimizations  
- **Vulkan/DirectX:** Use `graphics-api-expert` - immediate-mode renderer assumptions

**Wrong abstraction level:**
- **CPU optimization:** Use `performance-engineering` - different bottlenecks, memory patterns
- **Engine architecture:** Use `game-engine-expert` - render graph design, asset pipelines
- **Platform-agnostic graphics:** Use `graphics-programming` - need Apple-specific TBDR knowledge

**Wrong problem scope:**
- **UI/2D graphics:** Use `native-app-designer` - Core Animation, simpler shaders sufficient
- **Scientific computing:** Use `scientific-computing` - different precision/accuracy requirements
- **Web graphics:** Use `web-graphics-expert` - browser constraints, WebGPU considerations

---

*Master Metal shaders with the precision of film production and the performance demands of real-time interaction.*

<!-- BEGIN BUNDLE INDEX (auto: index_references.py) -->

## Skill Bundle Index

*Every file in this skill, and when to open it. Auto-generated; run `scripts/index_references.py --fix`.*

**root**
- [`CHANGELOG.md`](CHANGELOG.md) — Changelog — - Frontmatter moved `category`/`tags`/`pairs-with` under a `metadata` block and added `metadata.provenance` (first-party, port-daddy) and `m
- [`README.md`](README.md) — Metal Shader Expert — 20+ years Weta/Pixar-style experience specializing in Metal shaders, real-time rendering, and Apple's Tile-Based Deferred Rendering (TBDR) a

**`agents/`**
- [`agents/openai.yaml`](agents/openai.yaml) — openai (data/schema)

**`examples/`**
- [`examples/sample-input.json`](examples/sample-input.json) — sample input (data/schema)

**`references/`**
- [`references/debug-tools.md`](references/debug-tools.md) — Debug Tools & Visualization — Essential patterns for shader debugging and performance analysis.
- [`references/noise-effects.md`](references/noise-effects.md) — Noise-Based Effects — Organic, procedural effects using noise functions in Metal.
- [`references/pbr-shaders.md`](references/pbr-shaders.md) — PBR Shader Implementation — Complete Cook-Torrance BRDF implementation in Metal Shading Language.
- [`references/production-and-performance.md`](references/production-and-performance.md) — Production Techniques & Performance Mental Model — Weta/Pixar-style production shader authoring, a bandwidth/ALU/occupancy/divergence profiling mental model, and the debug-tooling checklist t

**`schemas/`**
- [`schemas/shader-plan.schema.json`](schemas/shader-plan.schema.json) — shader plan.schema (data/schema)

**`scripts/`**
- [`scripts/shader_perf_audit.mjs`](scripts/shader_perf_audit.mjs)

**`templates/`**
- [`templates/output-template.md`](templates/output-template.md) — Optimized Shader Implementation Guide — [One-sentence description of the shader(s) this guide covers, e.g.

<!-- END BUNDLE INDEX -->
