// OKLab / OKLCH perceptual color (Björn Ottosson). sRGB/HSL aren't perceptually
// uniform — interpolating saturated hues passes through a gray dead-zone and equal
// lightness steps don't look equal. OKLab fixes that: Euclidean distance ≈ perceived
// difference. It's why CSS Color 4 added oklch() and why GPUI interpolates gradients
// in Oklab. Conversion = two matrix multiplies sandwiching a per-channel cube root —
// cheap enough per-fragment.
//
// For pd-console: define every theme ramp in OKLCH. Fix L,C and sweep H for status
// colors (green->amber->red stays vivid, never grays). Fix H and sweep L for
// elevation/shadow steps. Feed the cosine palette (animated-gradient-cosine-palette.glsl)
// in OKLab so the animated wash never muddies.
//
// In WGSL: replace cbrt(x) with pow(x, 1.0/3.0) for non-negative inputs; matrices identical.
// For OKLCH: (a,b) -> polar (C = length(a,b), H = atan2(b,a)); interpolate H by angle.
//
// Source:  https://bottosson.github.io/posts/oklab/
// License: Public domain OR MIT (explicit on the page). Pulled June 2026.

vec3 linear_srgb_to_oklab(vec3 c) {
    float l = 0.4122214708*c.r + 0.5363325363*c.g + 0.0514459929*c.b;
    float m = 0.2119034982*c.r + 0.6806995451*c.g + 0.1073969566*c.b;
    float s = 0.0883024619*c.r + 0.2817188376*c.g + 0.6299787005*c.b;
    float l_ = pow(l, 1.0/3.0), m_ = pow(m, 1.0/3.0), s_ = pow(s, 1.0/3.0);
    return vec3(
        0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_,
        1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_,
        0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_);
}

vec3 oklab_to_linear_srgb(vec3 c) {
    float l_ = c.x + 0.3963377774*c.y + 0.2158037573*c.z;
    float m_ = c.x - 0.1055613458*c.y - 0.0638541728*c.z;
    float s_ = c.x - 0.0894841775*c.y - 1.2914855480*c.z;
    float l = l_*l_*l_, m = m_*m_*m_, s = s_*s_*s_;
    return vec3(
        +4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
        -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
        -0.0041960863*l - 0.7034186147*m + 1.7076147010*s);
}
