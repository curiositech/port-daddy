// iced custom_shader: WGSL fragment shader for the glass cubes — diffuse +
// specular lighting, normal-mapped reflection/refraction of a cubemap sky, and
// exponential volumetric fog. Standalone WGSL: liftable into any wgpu pass,
// including gpui's backend, behind a custom element.
//
// Source:  https://github.com/iced-rs/iced/blob/master/examples/custom_shader/src/shaders/cubes.wgsl
// License: MIT (iced-rs/iced). Pulled June 2026.

const CUBE_BASE_COLOR: vec4<f32> = vec4<f32>(0.294118, 0.462745, 0.611765, 0.6);
const REFLECTIVITY: f32 = 0.8;
const REFRACTION_INDEX: f32 = 1.31;
const FOG_DENSITY: f32 = 0.15;
const FOG_GRADIENT: f32 = 8.0;
const FOG_COLOR: vec4<f32> = vec4<f32>(1.0, 1.0, 1.0, 1.0);
const SHINE_DAMPER: f32 = 8.0;

@fragment
fn fs_main(in: Output) -> @location(0) vec4<f32> {
    let to_camera = in.tangent_camera_pos - in.tangent_pos;
    var normal = textureSample(normal_texture, tex_sampler, in.uv).xyz;
    normal = normal * 2.0 - 1.0;
    let dir_to_light: vec3<f32> = normalize(in.tangent_light_pos - in.tangent_pos);
    let brightness = max(dot(normal, dir_to_light), 0.0);
    let diffuse: vec3<f32> = brightness * uniforms.light_color.xyz;
    let dir_to_camera = normalize(to_camera);
    let reflected_light_dir = reflect(-dir_to_light, normal);
    let specular_factor = max(dot(reflected_light_dir, dir_to_camera), 0.0);
    let specular: vec3<f32> = pow(specular_factor, SHINE_DAMPER) * uniforms.light_color.xyz * REFLECTIVITY;
    let distance = length(to_camera);
    let visibility = clamp(exp(-pow((distance * FOG_DENSITY), FOG_GRADIENT)), 0.0, 1.0);
    let reflection_color = textureSample(sky_texture, tex_sampler, reflect(dir_to_camera, normal));
    let refraction_color = textureSample(sky_texture, tex_sampler, refract(dir_to_camera, normal, REFRACTION_INDEX));
    let final_reflect_color = mix(reflection_color, refraction_color, 0.5);
    var color = vec4<f32>(CUBE_BASE_COLOR.xyz * diffuse + specular, CUBE_BASE_COLOR.w);
    color = mix(color, final_reflect_color, 0.8);
    color = mix(FOG_COLOR, color, visibility);
    return color;
}
