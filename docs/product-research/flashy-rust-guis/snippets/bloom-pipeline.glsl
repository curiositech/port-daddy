// Bloom / glow: makes bright sources (alerts, status LEDs, hot metric values) bleed
// light so they read as genuine emission. Three stages: bright-pass threshold ->
// blur (separable Gaussian classically; or a downsample/upsample mip chain — swap in
// the dual-Kawase chain for big radius cheaply) -> additive composite + tonemap.
//
// For pd-console: render emissive accents to an HDR target, threshold -> blur ->
// additively composite so alerts/LEDs genuinely glow instead of just being bright.
//
// Source:  https://learnopengl.com/Advanced-Lighting/Bloom
// License: ⚠️ article prose CC BY-NC 4.0; code samples MIT via
//          https://github.com/JoeyDeVries/LearnOpenGL/blob/master/LICENSE.md (verify per-snippet)
// Production ref: Jorge Jimenez, "Next Gen Post Processing in CoD:AW", SIGGRAPH 2014.
// Pulled June 2026.

// --- 1. bright-pass / threshold (multiple render targets) ---
// layout (location = 0) out vec4 FragColor;
// layout (location = 1) out vec4 BrightColor;
// float brightness = dot(FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
// BrightColor = (brightness > 1.0) ? vec4(FragColor.rgb, 1.0) : vec4(0,0,0,1);

// --- 2. separable Gaussian (ping-pong horizontal / vertical) ---
uniform sampler2D image;
uniform bool horizontal;
uniform float weight[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
void main() {
    vec2 tex_offset = 1.0 / textureSize(image, 0);
    vec3 result = texture(image, TexCoords).rgb * weight[0];
    if (horizontal) {
        for (int i = 1; i < 5; ++i) {
            result += texture(image, TexCoords + vec2(tex_offset.x * i, 0.0)).rgb * weight[i];
            result += texture(image, TexCoords - vec2(tex_offset.x * i, 0.0)).rgb * weight[i];
        }
    } else {
        for (int i = 1; i < 5; ++i) {
            result += texture(image, TexCoords + vec2(0.0, tex_offset.y * i)).rgb * weight[i];
            result += texture(image, TexCoords - vec2(0.0, tex_offset.y * i)).rgb * weight[i];
        }
    }
    FragColor = vec4(result, 1.0);
}

// --- 3. additive composite + HDR tonemap + gamma ---
// vec3 hdr = texture(scene, uv).rgb + texture(bloomBlur, uv).rgb;   // additive
// vec3 result = vec3(1.0) - exp(-hdr * exposure);                   // tonemap
// result = pow(result, vec3(1.0 / 2.2));                            // gamma
