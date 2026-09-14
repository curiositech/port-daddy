/**
 * oklab-cvd.mjs — OKLab, Delta E, and colour-vision-deficiency simulation, in one place.
 *
 * Companion to wcag.mjs. That file answers "can this ink be read on this
 * ground"; this one answers the different question "can these two inks be told
 * apart", which contrast cannot answer at all: two colours of identical
 * luminance have contrast 1.00 against each other and may still be a perfectly
 * legible pair, or an invisible one.
 *
 * The method is the one the `dataviz` skill fixes as the standard, and the
 * numbers only mean what they claim if the model is the one the thresholds
 * were calibrated against, so both are pinned here:
 *
 *   - Delta E is Euclidean distance in OKLab (Bjorn Ottosson, 2020), x100.
 *   - CVD is simulated with Machado, Oliveira and Fernandes (2009) at severity
 *     1.0, applied in LINEAR RGB -- which is the space the paper derives them
 *     in. Applying them to gamma-encoded sRGB is a common implementation bug
 *     and inflates every separation, so the linearisation here is not
 *     incidental.
 *   - protanopia and deuteranopia GATE. Tritanopia is computed and reported
 *     but does not gate: the >= 8 / >= 6 thresholds are calibrated on the two
 *     red-green forms, and tritanopia is some three orders of magnitude rarer.
 *     Reporting it without gating on it is deliberate -- see check_separation
 *     in check-figure-palette-separation.mjs.
 */

const LINEAR = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const ENCODE = (v) => {
  const c = Math.min(1, Math.max(0, v))
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
}

/** Linear-light sRGB triple from a six-digit hex colour. */
export function linearRgb(hex) {
  const clean = hex.replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) throw new TypeError(`not a six-digit hex colour: ${hex}`)
  return [0, 2, 4].map((i) => LINEAR(parseInt(clean.slice(i, i + 2), 16) / 255))
}

/** OKLab [L, a, b] of a linear-light sRGB triple. */
export function oklabFromLinear([r, g, b]) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const [l_, m_, s_] = [l, m, s].map((v) => Math.cbrt(v))
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ]
}

/** OKLab [L, a, b] of a hex colour. */
export const oklab = (hex) => oklabFromLinear(linearRgb(hex))

/** OKLCH [L, C, h-degrees] of a hex colour — the form a ramp is stepped along. */
export function oklch(hex) {
  const [L, a, b] = oklab(hex)
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360]
}

/** Machado, Oliveira & Fernandes (2009), severity 1.0, in linear RGB. */
export const MACHADO = Object.freeze({
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.011820, 0.042940, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.303900],
  ],
})

/** The two forms the >= 8 / >= 6 thresholds are calibrated on. */
export const GATED_CVD = Object.freeze(['protanopia', 'deuteranopia'])

/** Simulate one CVD form; returns OKLab, with the sRGB gamut clamp applied. */
export function simulate(hex, kind) {
  const M = MACHADO[kind]
  if (!M) throw new TypeError(`unknown CVD form: ${kind}`)
  const lin = linearRgb(hex)
  // Clamp through the display encoding, exactly as a screen or a press would:
  // an out-of-gamut simulated colour is not reachable and must not be scored
  // as if it were.
  const out = M.map((row) => ENCODE(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]))
  return oklabFromLinear(out.map(LINEAR))
}

/** Euclidean OKLab distance x100 between two OKLab triples. */
export const distance = (p, q) => 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])

/** Delta E x100 between two hex colours under normal vision. */
export const deltaE = (a, b) => distance(oklab(a), oklab(b))

/** Delta E x100 between two hex colours under one simulated CVD form. */
export const deltaECvd = (a, b, kind) => distance(simulate(a, kind), simulate(b, kind))

/**
 * Every separation measurement for one pair: normal vision, each simulated
 * form, and `worstGated` — the minimum over the forms that actually gate.
 */
export function separation(a, b) {
  const cvd = {}
  for (const kind of Object.keys(MACHADO)) cvd[kind] = deltaECvd(a, b, kind)
  return {
    normal: deltaE(a, b),
    ...cvd,
    worstGated: Math.min(...GATED_CVD.map((k) => cvd[k])),
  }
}
