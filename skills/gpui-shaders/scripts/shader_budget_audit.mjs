#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FBM_OCTAVE_BUDGET = 5;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Audit a shader-effect plan against this skill's "earn the GPU pass" thesis
 * and its documented failure modes (see SKILL.md Failure Modes / Quality Gates).
 *
 * Checks each effect in `plan.effects` for:
 *  - "Shadering a widget": needsPerPixelWork === false means the effect is a
 *    fill/gradient/shape the element tree or Vello already draws for free.
 *  - "The ambient shader that never sleeps": pausesWhenOffscreen === false
 *    means CPU/GPU stays pegged while the pane is hidden/unfocused.
 *  - "Hardcoded hex in WGSL": colorFromAccentUniform === false or
 *    hardcodedHex === true means the theme token never reaches the shader.
 *  - Reduced-motion not frozen: reducedMotionFreezesTime === false means
 *    reduced-motion produces a blank frame instead of a still, on-brand one.
 *  - "Per-RGB dither rainbow": ditherTarget === 'per-rgb' produces colored
 *    speckle instead of a clean two-tone dissolve.
 *  - "fbm to the moon": fbmOctaves at/above the frame budget without
 *    pixelateFirst drops frames on full window size or an iGPU.
 * Plus a plan-level check that wgpu is kept out of the Linux CI workspace.
 *
 * @param {unknown} plan - parsed JSON shader-effect plan.
 * @returns {{pass: boolean, findings: Array<{id: string, severity: string, effect: string|null, message: string}>, recommendations: string[]}}
 */
export function auditShaderPlan(plan) {
  if (!isPlainObject(plan)) {
    throw new Error('plan must be a JSON object');
  }

  const findings = [];
  const recommendations = [];
  let criticalOrHigh = false;

  function fail(id, severity, effect, message, recommendation) {
    findings.push({ id, severity, effect, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical' || severity === 'high') criticalOrHigh = true;
  }

  const effects = Array.isArray(plan.effects) ? plan.effects : [];
  if (effects.length === 0) {
    fail(
      'no-effects',
      'medium',
      null,
      'plan.effects is empty or missing — nothing to audit.',
      'List at least one effect in plan.effects with its per-pixel-work justification.'
    );
  }

  effects.forEach((effect, index) => {
    if (!isPlainObject(effect)) {
      fail('malformed-effect', 'high', `#${index}`, 'Effect entry is not an object.', 'Each entry in plan.effects must be an object with a name field.');
      return;
    }

    const name = isNonEmptyString(effect.name) ? effect.name : `#${index}`;

    // "Shadering a widget"
    if (effect.needsPerPixelWork !== true) {
      fail(
        'shadering-a-widget',
        'high',
        name,
        `"${name}" has needsPerPixelWork=false — it is a fill/gradient/shape, not true per-pixel work (noise/sdf/water/raymarch/full-res dither).`,
        `Draw "${name}" with a gpui primitive (div/paint_quad) or a Vello vector pass instead of a fragment shader.`
      );
    }

    // Companion vs render-to-texture must be chosen deliberately.
    if (effect.path !== 'companion' && effect.path !== 'render-to-texture') {
      fail(
        'undeclared-path',
        'medium',
        name,
        `"${name}" does not declare a path ('companion' or 'render-to-texture').`,
        `Choose companion-window (ship-now, focused/modal) or render-to-texture (ambient, in-pane) for "${name}" and record it.`
      );
    }

    // "The ambient shader that never sleeps"
    if (effect.pausesWhenOffscreen !== true) {
      fail(
        'never-sleeps',
        'high',
        name,
        `"${name}" does not pause/cap when offscreen, occluded, or unfocused — CPU/GPU stays pegged while hidden.`,
        `Gate "${name}"'s render loop on visibility/focus and cap ambient frame rate (e.g. 30fps).`
      );
    }

    // "Hardcoded #FFDB33 in WGSL"
    if (effect.hardcodedHex === true || effect.colorFromAccentUniform !== true) {
      fail(
        'hardcoded-hex',
        'high',
        name,
        `"${name}" does not derive color from the accent theme uniform (colorFromAccentUniform=${effect.colorFromAccentUniform === true}, hardcodedHex=${effect.hardcodedHex === true}).`,
        `Push the theme token as u.accent for "${name}" and derive all color via palette()/mix from it — never a literal hex in WGSL.`
      );
    }

    // Reduced-motion must freeze time to a still, not go blank.
    if (effect.reducedMotionFreezesTime !== true) {
      fail(
        'reduced-motion-not-frozen',
        'high',
        name,
        `"${name}" does not freeze time for reduced-motion — likely renders blank or keeps animating.`,
        `Freeze u.time to a hand-picked still frame for "${name}" when the OS prefers reduced motion.`
      );
    }

    // "Per-RGB dither rainbow"
    if (effect.ditherTarget === 'per-rgb') {
      fail(
        'per-rgb-dither',
        'medium',
        name,
        `"${name}" dithers r,g,b independently (ditherTarget='per-rgb'), producing colored speckle instead of a clean two-tone dissolve.`,
        `Dither luminance or the palette parameter t for "${name}", then map the result through the palette.`
      );
    } else if (effect.ditherTarget !== 'luminance' && effect.ditherTarget !== 'palette-t') {
      fail(
        'undeclared-dither-target',
        'low',
        name,
        `"${name}" does not declare a ditherTarget ('luminance' or 'palette-t').`,
        `Record ditherTarget for "${name}" so the Bayer threshold's target is explicit.`
      );
    }

    // "fbm to the moon"
    const octaves = typeof effect.fbmOctaves === 'number' ? effect.fbmOctaves : null;
    if (octaves !== null && octaves >= FBM_OCTAVE_BUDGET + 1 && effect.pixelateFirst !== true) {
      fail(
        'fbm-to-the-moon',
        'medium',
        name,
        `"${name}" uses ${octaves} fbm octaves without pixelating first — likely drops frames at full window size or on an iGPU.`,
        `Pixelate "${name}" before the noise pass and cap octaves to ${FBM_OCTAVE_BUDGET} (4-5), or reduce render resolution and upscale.`
      );
    } else if (octaves !== null && octaves >= FBM_OCTAVE_BUDGET + 1) {
      recommendations.push(`"${name}" is at ${octaves} fbm octaves — pixelateFirst is set, but confirm the frame budget still holds at full window size.`);
    }
  });

  // Plan-level: wgpu must be kept out of the Linux CI workspace.
  if (plan.keptOutOfLinuxCI !== true) {
    fail(
      'wgpu-in-linux-ci',
      'high',
      null,
      'plan.keptOutOfLinuxCI is not true — wgpu risks compiling into the rust-console Linux CI gate.',
      'Isolate the shader crate as a companion crate (like pd-timeline-proto) so the Linux CI workspace never compiles wgpu.'
    );
  }

  if (findings.length === 0) {
    recommendations.push('Plan is structurally sound. Spot-check the actual WGSL for fwidth-based AA and contrast over the busiest region before shipping.');
  }

  return {
    pass: !criticalOrHigh,
    findings,
    recommendations,
  };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: shader_budget_audit.mjs --input <plan>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditShaderPlan(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`shader_budget_audit: ${error.message}\n`);
    process.exit(1);
  }
}
