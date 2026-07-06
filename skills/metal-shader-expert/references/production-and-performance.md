# Production Techniques & Performance Mental Model

Weta/Pixar-style production shader authoring, a bandwidth/ALU/occupancy/divergence
profiling mental model, and the debug-tooling checklist that keeps a shader team fast.

## Weta/Pixar Production Techniques

### Shader Authoring for Artists

```metal
// Material definition that artists can understand and control

struct ArtistMaterial {
    // Base properties
    float3 base_color;
    float base_color_intensity;

    // Surface
    float metallic;
    float roughness;
    float specular_tint;
    float sheen;
    float sheen_tint;

    // Subsurface
    float subsurface;
    float3 subsurface_color;
    float subsurface_radius;

    // Clearcoat (car paint, etc.)
    float clearcoat;
    float clearcoat_roughness;

    // Emission
    float3 emission_color;
    float emission_strength;

    // Special FX
    float iridescence;
    float anisotropic;
    float anisotropic_rotation;
};

// The key: Make complex physically accurate, but expose artist-friendly controls
```

### Procedural Variation for Uniqueness

```metal
// Add procedural variation so every instance looks unique
// (Pixar trick: never have two identical things on screen)

float3 add_surface_variation(
    float3 base_color,
    float3 world_pos,
    float variation_amount
) {
    // Subtle color variation
    float color_var = fbm(world_pos * 5.0, 3) * 0.1;
    base_color *= (1.0 + color_var * variation_amount);

    // Slight hue shift
    float hue_shift = (hash(world_pos.xz) - 0.5) * 0.05 * variation_amount;
    // Apply hue shift (simplified - real version uses HSV conversion)

    return base_color;
}

float add_roughness_variation(
    float base_roughness,
    float3 world_pos,
    float variation_amount
) {
    // Add wear patterns, dirt, micro-scratches
    float wear = fbm(world_pos * 10.0, 4);
    float dirt = fbm(world_pos * 20.0, 3) * 0.5;

    float variation = (wear + dirt) * variation_amount * 0.2;

    return saturate(base_roughness + variation);
}
```

## Performance Optimization

### Profiling Mental Model

```
GPU Performance Bottlenecks (in order of likelihood):

1. Memory Bandwidth
   - Texture fetches
   - Buffer reads/writes
   - Fix: Reduce texture size, compress, use mipmaps

2. ALU (Arithmetic Logic Unit)
   - Complex math in shaders
   - Too many instructions
   - Fix: Simplify math, use lookup tables, reduce precision

3. Occupancy
   - Register pressure
   - Shared memory usage
   - Fix: Reduce register usage, simplify shaders

4. Divergence
   - Branching (if/else) in shaders
   - Non-uniform control flow
   - Fix: Minimize branching, use select() instead of if
```

### Optimization Examples

```metal
// BAD: Branch divergence
fragment float4 slow_conditional(VertexOut in [[stage_in]]) {
    if (in.texcoord.x > 0.5) {
        // Complex calculation A
        return complex_calc_A(in);
    } else {
        // Complex calculation B
        return complex_calc_B(in);
    }
}

// GOOD: Branchless with select
fragment float4 fast_branchless(VertexOut in [[stage_in]]) {
    float4 result_a = complex_calc_A(in);
    float4 result_b = complex_calc_B(in);

    // select(false_value, true_value, condition)
    return select(result_b, result_a, in.texcoord.x > 0.5);
}

// BAD: Texture sampling in loop
float calculate_blur(texture2d<float> tex, sampler s, float2 uv) {
    float sum = 0.0;
    for (int i = -5; i <= 5; i++) {
        for (int j = -5; j <= 5; j++) {
            float2 offset = float2(i, j) / 512.0;
            sum += tex.sample(s, uv + offset).r;
        }
    }
    return sum / 121.0;  // 11x11 = 121 samples
}

// GOOD: Separable blur (11x11 -> 11+11 samples)
float calculate_blur_fast(texture2d<float> tex, sampler s, float2 uv) {
    // First pass: horizontal blur (done separately)
    // Second pass: vertical blur on pre-blurred texture
    float sum = 0.0;
    for (int i = -5; i <= 5; i++) {
        float2 offset = float2(0, i) / 512.0;
        sum += tex.sample(s, uv + offset).r;
    }
    return sum / 11.0;
}
```

## Internal Tools Philosophy

"Build the tool you wish you had yesterday."

### Essential Debug Tools Checklist

- [ ] **Shader Hot Reload**: Edit shader, see changes in <1 second
- [ ] **Value Inspector**: Click any pixel, see all shader variables
- [ ] **Heat Maps**: Visualize complexity, overdraw, bandwidth
- [ ] **Wireframe Toggle**: See geometry structure
- [ ] **Texture Viewer**: Inspect all textures, mipmaps, channels
- [ ] **Performance Overlay**: Frame time, draw calls, triangles
- [ ] **Capture/Replay**: Record frames, step through rendering
- [ ] **Shader Compiler Warnings**: Catch inefficiencies early
- [ ] **GPU Counters**: ALU, bandwidth, cache, occupancy
- [ ] **Diff Tool**: Compare shader versions side-by-side

See `debug-tools.md` for the implementation of the heat map, overlay, and
inspector primitives this checklist assumes.

## The Weta/Pixar Mindset

### Quality Over Everything

"Never let technology limit artistry."

- If it doesn't look right, it's wrong (even if technically correct)
- Artists drive the vision, engineers enable it
- Iterate until it's beautiful, then optimize
- The audience doesn't see the tech, they feel the emotion

### Collaboration

"The best shots come from engineers who understand art and artists who understand tech."

- Learn to speak both languages (technical and artistic)
- Build tools artists love using
- Pair with artists during development
- Take feedback seriously

### Continuous Learning

"The technology changes every 2 years. Stay curious."

- Study new GPU features
- Read papers from SIGGRAPH, GDC
- Experiment with unreleased techniques
- Share knowledge generously

---

Shaders are where art meets mathematics meets engineering. Make them
beautiful, make them fast, and make tools that let you iterate quickly. The
best shader is the one that makes the artist say "Yes! That's exactly what I
imagined."
