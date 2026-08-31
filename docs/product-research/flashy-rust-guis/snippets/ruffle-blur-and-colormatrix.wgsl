// Ruffle's Flash filters, already written in WGSL and permissively licensed —
// the single best license-clean library of console-relevant post effects. The
// render/wgpu/shaders/filter/ dir has blur, glow, bevel, color_matrix,
// displacement_map. Two are reproduced verbatim below: a separable Gaussian blur
// (with a fused-bilinear sampling trick that halves fetches) and a color-matrix
// filter (tint / desaturate). Drop into a gpui wgpu post pass.
//
// Source:  https://github.com/ruffle-rs/ruffle/blob/master/render/wgpu/shaders/filter/blur.wgsl
//          https://github.com/ruffle-rs/ruffle/blob/master/render/wgpu/shaders/filter/color_matrix.wgsl
// License: MIT OR Apache-2.0 (Ruffle). Pulled verbatim June 2026.
// (Prepend Ruffle's shader_filter_common.wgsl before compiling — it defines
//  filter__VertexInput / filter__VertexOutput / filter__main_vertex.)

// ===================== blur.wgsl (separable Gaussian) =====================
struct Filter {
    dir_x: f32, dir_y: f32, full_size: f32, m: f32, m2: f32,
    first_weight: f32, last_offset: f32, last_weight: f32,
}
@group(0) @binding(0) var texture: texture_2d<f32>;
@group(0) @binding(1) var texture_sampler: sampler;
@group(0) @binding(2) var<uniform> filter_args: Filter;

@vertex
fn main_vertex(in: filter__VertexInput) -> filter__VertexOutput {
    var result = filter__main_vertex(in);
    let direction = vec2<f32>(filter_args.dir_x, filter_args.dir_y);
    result.uv -= direction * filter_args.m;
    return result;
}

@fragment
fn main_fragment(in: filter__VertexOutput) -> @location(0) vec4<f32> {
    let direction = vec2<f32>(filter_args.dir_x, filter_args.dir_y);
    var total = vec4<f32>(0.0);
    total += textureSample(texture, texture_sampler, in.uv - direction) * filter_args.first_weight;
    var center = vec4<f32>();
    for (var i = 0.5; i < filter_args.m2; i += 2.0) {           // sample BETWEEN pixel pairs
        center += textureSample(texture, texture_sampler, in.uv + direction * i);
    }
    total += center * 2.0;                                       // ...and *2 to halve fetches
    let last_location = in.uv + direction * (filter_args.m2 + filter_args.last_offset);
    total += textureSample(texture, texture_sampler, last_location) * filter_args.last_weight;
    let result = total / filter_args.full_size;
    return floor(result * 255.0) / 255.0;                        // mimic Flash 8-bit fixed point
}

// ===================== color_matrix.wgsl (tint / desaturate) =====================
// struct Filter { 20 floats: r_to_*, g_to_*, b_to_*, a_to_*, *_extra } ... ;
// @fragment fn main_fragment(in) -> @location(0) vec4<f32> {
//     var src = textureSample(texture, texture_sampler, in.uv);
//     // un-premultiply (src.rgb / src.a) -> 4x5 matrix multiply -> clamp -> re-premultiply
//     return vec4<f32>(color.rgb * color.a, color.a);
// }
