# Debug Tools & Visualization

Essential patterns for shader debugging and performance analysis.

## Heat Map Visualization

```metal
// Visualize scalar values: 0=blue, 0.5=green, 1=red
float3 heat_map(float v) {
    v = saturate(v);
    return v < 0.5
        ? mix(float3(0,0,1), float3(0,1,0), v*2)
        : mix(float3(0,1,0), float3(1,0,0), (v-0.5)*2);
}

// Extended heat map with purple for overflow
float3 heat_map_extended(float v) {
    if (v < 0.0) return float3(0.5, 0, 0.5);  // Magenta: negative
    if (v > 1.0) return float3(1, 0, 1);       // Purple: overflow
    return heat_map(v);
}
```

## Debug Visualization Modes

```metal
fragment float4 debug_fragment(
    VertexOut in [[stage_in]],
    constant uint& mode [[buffer(0)]]
) {
    switch (mode) {
        case 0: // World normals
            return float4(in.world_normal * 0.5 + 0.5, 1.0);

        case 1: // UV coordinates
            return float4(in.texcoord, 0.0, 1.0);

        case 2: // Depth (linear)
            float depth = in.position.z / in.position.w;
            return float4(float3(depth), 1.0);

        case 3: // Tangent space
            return float4(in.tangent * 0.5 + 0.5, 1.0);

        case 4: // Bitangent
            return float4(in.bitangent * 0.5 + 0.5, 1.0);

        case 5: // World position (wrapped)
            return float4(fract(in.world_position), 1.0);

        default:
            return float4(1, 0, 1, 1);  // Magenta = error
    }
}
```

## Overdraw Visualization

```metal
// Increment counter per fragment
kernel void overdraw_counter(
    texture2d<uint, access::read_write> counter [[texture(0)]],
    uint2 gid [[thread_position_in_grid]]
) {
    uint current = counter.read(gid).r;
    counter.write(uint4(current + 1), gid);
}

// Visualize overdraw
fragment float4 overdraw_visualize(
    VertexOut in [[stage_in]],
    texture2d<uint> counter [[texture(0)]]
) {
    uint2 pos = uint2(in.position.xy);
    uint count = counter.read(pos).r;

    // Heat map: 1=green, 2=yellow, 3+=red
    float normalized = float(count) / 5.0;
    return float4(heat_map(normalized), 1.0);
}
```

## Mipmap Level Visualization

```metal
// Shows which mipmap is being sampled
float3 mip_colors[] = {
    float3(1,0,0),   // Mip 0 - Red
    float3(1,0.5,0), // Mip 1 - Orange
    float3(1,1,0),   // Mip 2 - Yellow
    float3(0,1,0),   // Mip 3 - Green
    float3(0,1,1),   // Mip 4 - Cyan
    float3(0,0,1),   // Mip 5 - Blue
    float3(0.5,0,1), // Mip 6 - Purple
    float3(1,0,1),   // Mip 7 - Magenta
};

fragment float4 mip_debug(
    VertexOut in [[stage_in]],
    texture2d<float> tex [[texture(0)]]
) {
    // Calculate mip level from UV derivatives
    float2 dx = dfdx(in.texcoord);
    float2 dy = dfdy(in.texcoord);
    float delta = max(dot(dx, dx), dot(dy, dy));
    float mip = 0.5 * log2(delta * tex.get_width() * tex.get_width());

    int mip_index = clamp(int(mip), 0, 7);
    return float4(mip_colors[mip_index], 1.0);
}
```

## NaN/Inf Detection

```metal
float4 nan_check(float4 color) {
    if (any(isnan(color))) return float4(1, 0, 1, 1);  // Magenta = NaN
    if (any(isinf(color))) return float4(0, 1, 1, 1);  // Cyan = Inf
    return color;
}
```

## Wireframe Overlay

```metal
// Barycentric wireframe (requires vertex shader to pass barycentrics)
float wireframe(float3 bary, float thickness) {
    float3 d = fwidth(bary);
    float3 a = smoothstep(float3(0), d * thickness, bary);
    return min(min(a.x, a.y), a.z);
}

fragment float4 wireframe_overlay(
    VertexOut in [[stage_in]],
    constant float4& base_color [[buffer(0)]],
    constant float4& wire_color [[buffer(1)]]
) {
    float edge = wireframe(in.barycentrics, 1.5);
    return mix(wire_color, base_color, edge);
}
```

## Performance Timers

```metal
// Measure shader complexity by counting iterations
kernel void complexity_visualize(
    texture2d<float, access::write> output [[texture(0)]],
    constant uint& max_iterations [[buffer(0)]],
    uint2 gid [[thread_position_in_grid]]
) {
    uint iterations = 0;

    // Your algorithm with iteration counting
    while (/* condition */ iterations < max_iterations) {
        // Work...
        iterations++;
    }

    float complexity = float(iterations) / float(max_iterations);
    output.write(float4(heat_map(complexity), 1.0), gid);
}
```

## GPU Capture Integration

Use Xcode GPU Capture for:
- Frame timeline analysis
- Shader profiler
- Memory bandwidth
- Occupancy metrics
- Pipeline state inspection

### Best Practices

1. **Always have a debug mode**: Toggle with function constant
2. **Color-code errors**: Magenta for NaN, Cyan for Inf
3. **Visualize intermediate buffers**: G-buffer, shadow maps
4. **Add performance overlays**: FPS, draw calls, triangles
5. **Hot-reload shaders**: Metal Library at runtime

## Debug Macro Pattern

```metal
#if DEBUG_MODE
    return float4(heat_map(some_value), 1.0);
#else
    return final_color;
#endif
```

Use function constants for runtime toggling without recompilation.

## Live Value Inspector

```metal
// Draw numbers on screen (for debugging values)
// Uses a simple bitmap font stored in a texture

struct DebugText {
    float2 screen_pos;  // Where to draw (normalized 0-1)
    float value;        // Value to display
    float3 color;       // Text color
};

fragment float4 debug_text_overlay_fragment(
    float2 screen_pos [[position]],
    constant DebugText* debug_values [[buffer(0)]],
    constant uint& debug_count [[buffer(1)]],
    texture2d<float> font_atlas [[texture(0)]],
    sampler font_sampler [[sampler(0)]]
) {
    float4 output = float4(0.0);  // Transparent background

    for (uint i = 0; i < debug_count; i++) {
        DebugText dt = debug_values[i];

        // Convert value to string (simplified - just show as digits)
        // In real implementation, format as "123.45" etc.

        // Check if we're in the text region
        float2 local_pos = screen_pos - dt.screen_pos;

        if (local_pos.x > 0.0 && local_pos.x < 100.0 &&
            local_pos.y > 0.0 && local_pos.y < 20.0) {

            // Sample font atlas (simplified)
            float2 uv = local_pos / float2(100.0, 20.0);
            float alpha = font_atlas.sample(font_sampler, uv).r;

            output.rgb = mix(output.rgb, dt.color, alpha);
            output.a = max(output.a, alpha);
        }
    }

    return output;
}
```

## Performance Profiler Overlay

```metal
struct GPUMetrics {
    float frame_time_ms;
    float vertex_shader_time_ms;
    float fragment_shader_time_ms;
    float memory_usage_mb;
    uint triangle_count;
    uint draw_call_count;
};

// Draw performance overlay (graphs, numbers, bars)
kernel void render_performance_overlay(
    texture2d<float, access::write> output [[texture(0)]],
    constant GPUMetrics& metrics [[buffer(0)]],
    constant float* frame_history [[buffer(1)]],  // Last 120 frames
    uint2 gid [[thread_position_in_grid]]
) {
    float2 uv = float2(gid) / float2(output.get_width(), output.get_height());

    float4 color = float4(0.0, 0.0, 0.0, 0.0);

    // Draw frame time graph (top left corner)
    if (uv.x < 0.3 && uv.y < 0.2) {
        float2 graph_uv = uv / float2(0.3, 0.2);

        // Sample frame history
        uint history_index = uint(graph_uv.x * 120.0);
        float frame_time = frame_history[history_index];

        // Draw line graph
        float graph_value = 1.0 - (frame_time / 33.0);  // 33ms = 30fps
        float y_threshold = graph_uv.y;

        if (abs(graph_value - y_threshold) < 0.01) {
            // Graph line
            color = float4(0.0, 1.0, 0.0, 0.8);
        }

        // 60fps line (16.67ms)
        if (abs((1.0 - 16.67/33.0) - y_threshold) < 0.005) {
            color = float4(1.0, 1.0, 0.0, 0.5);
        }

        // Background
        if (color.a == 0.0) {
            color = float4(0.1, 0.1, 0.1, 0.7);
        }
    }

    // Draw current metrics (numbers - simplified)
    // In real version, use the text rendering system

    output.write(color, gid);
}
```
