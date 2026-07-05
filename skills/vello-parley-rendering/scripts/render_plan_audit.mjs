#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Known-good Linebender stack pairings. Pre-1.0 crates (vello, parley, peniko,
 * kurbo, winit) are compared at major.minor granularity; wgpu is compared at
 * major-only granularity (wgpu ships plain integer majors, e.g. "22", "23").
 *
 * Extend this table as new vello releases pin new companion versions — do NOT
 * guess a row; verify against the tagged release's Cargo.toml before adding one.
 */
const KNOWN_GOOD_MATRIX = [
  { vello: '0.3', wgpu: '22', parley: '0.2', peniko: '0.2', kurbo: '0.11', winit: '0.30' },
];

const VALID_AA_SUPPORT = ['area', 'msaa8', 'msaa16'];
const VALID_AA_METHOD = ['Area', 'Msaa8', 'Msaa16'];
// AaSupport::area_only() only enables Area; MSAA support must be explicitly
// requested and must match the corresponding AaConfig at render time.
const AA_SUPPORT_TO_METHOD = {
  area: 'Area',
  msaa8: 'Msaa8',
  msaa16: 'Msaa16',
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** First two dot-separated components, e.g. "0.3.1" -> "0.3". */
function majorMinor(v) {
  return String(v).split('.').slice(0, 2).join('.');
}

/** First dot-separated component, e.g. "22.1.0" -> "22". */
function majorOnly(v) {
  return String(v).split('.')[0];
}

function findMatrixRow(velloVersion) {
  const target = majorMinor(velloVersion);
  return KNOWN_GOOD_MATRIX.find((row) => row.vello === target) ?? null;
}

/**
 * Audit a Vello/Parley render plan against this skill's known failure modes:
 * version skew between vello/wgpu/parley/peniko/kurbo/winit, an AA
 * support/method mismatch (panics at render time), never requesting a
 * redraw (static output on an event-driven windowing system), diffing or
 * mutating a Scene in place (fights the immediate-mode API), skipping
 * Parley's glyph-coords bridge (either a type mismatch or a hand-rolled
 * glyph atlas standing in for Parley), and inconsistent logical/physical
 * pixel handling across layout and geometry.
 *
 * @param {unknown} plan - parsed JSON render plan object.
 * @returns {{pass: boolean, findings: Array<{id: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditRenderPlan(plan) {
  if (!isPlainObject(plan)) {
    throw new Error('render plan must be a JSON object');
  }

  const findings = [];
  const recommendations = [];

  function flag(id, severity, message, recommendation) {
    findings.push({ id, severity, message });
    if (recommendation) recommendations.push(recommendation);
  }

  // --- deps block ---
  const deps = plan.deps;
  const requiredDeps = ['vello', 'wgpu', 'parley', 'peniko', 'kurbo', 'winit'];
  if (!isPlainObject(deps)) {
    flag('missing-deps', 'critical', 'No deps block: cannot verify version pairing at all.', 'Add deps.{vello,wgpu,parley,peniko,kurbo,winit} version strings.');
  } else {
    const missing = requiredDeps.filter((k) => !isNonEmptyString(deps[k]));
    if (missing.length > 0) {
      flag('incomplete-deps', 'high', `deps missing: ${missing.join(', ')}`, 'Record every pinned version, not just the ones that seemed relevant.');
    }

    if (isNonEmptyString(deps.vello)) {
      const row = findMatrixRow(deps.vello);
      if (!row) {
        flag(
          'vello-version-not-in-matrix',
          'medium',
          `vello ${deps.vello} is not in the known-good matrix; pairing cannot be auto-verified.`,
          'Verify companion versions by hand against the tagged vello release\'s Cargo.toml, then add a row to KNOWN_GOOD_MATRIX.'
        );
      } else {
        const mismatches = [];
        if (isNonEmptyString(deps.wgpu) && majorOnly(deps.wgpu) !== row.wgpu) {
          mismatches.push(`wgpu ${deps.wgpu} (expected major ${row.wgpu})`);
        }
        for (const dep of ['parley', 'peniko', 'kurbo', 'winit']) {
          if (isNonEmptyString(deps[dep]) && majorMinor(deps[dep]) !== row[dep]) {
            mismatches.push(`${dep} ${deps[dep]} (expected ${row[dep]})`);
          }
        }
        if (mismatches.length > 0) {
          flag(
            'version-skew',
            'critical',
            `vello ${deps.vello} expects ${row.wgpu ? `wgpu ${row.wgpu}` : ''}/parley ${row.parley}/peniko ${row.peniko}/kurbo ${row.kurbo}/winit ${row.winit}, but plan has: ${mismatches.join('; ')}.`,
            'Let vello own the wgpu version (depend on vello only and use vello::wgpu::…), or pin every companion crate to exactly the matrix row for this vello version. Verify with `cargo tree -d`.'
          );
        }
      }
    }
  }

  // --- duplicate wgpu in tree (the #1 time sink, independent of matrix knowledge) ---
  if (plan.duplicateWgpuInTree === true) {
    flag(
      'duplicate-wgpu-in-tree',
      'critical',
      'duplicateWgpuInTree is true: two incompatible wgpu majors are in the dependency tree, which produces "expected wgpu::Device, found wgpu::Device" style errors.',
      'Run `cargo tree -d` and remove the direct wgpu dependency, or pin it to exactly the major vello re-exports.'
    );
  }
  if (plan.usesVelloReexportedWgpu !== true && plan.duplicateWgpuInTree !== true) {
    recommendations.push('Prefer `vello::wgpu::…` over a direct wgpu dependency — it structurally prevents version skew instead of relying on manual pinning discipline.');
  }

  // --- AA support/method agreement ---
  const aaSupport = plan.aaSupport;
  const aaMethod = plan.aaMethod;
  if (!VALID_AA_SUPPORT.includes(aaSupport)) {
    flag('invalid-aa-support', 'high', `aaSupport "${aaSupport}" is not one of ${VALID_AA_SUPPORT.join(', ')}.`, 'Set aaSupport to the RendererOptions.antialiasing_support value actually configured.');
  } else if (!VALID_AA_METHOD.includes(aaMethod)) {
    flag('invalid-aa-method', 'high', `aaMethod "${aaMethod}" is not one of ${VALID_AA_METHOD.join(', ')}.`, 'Set aaMethod to the RenderParams.antialiasing_method value actually requested.');
  } else if (AA_SUPPORT_TO_METHOD[aaSupport] !== aaMethod) {
    flag(
      'aa-support-method-mismatch',
      'critical',
      `aaSupport "${aaSupport}" does not agree with aaMethod "${aaMethod}" — this pairing panics at render time.`,
      `RendererOptions.antialiasing_support and RenderParams.antialiasing_method must match exactly (aaSupport "${aaSupport}" pairs only with aaMethod "${AA_SUPPORT_TO_METHOD[aaSupport]}").`
    );
  }

  // --- present mode sanity ---
  const validPresentModes = ['AutoVsync', 'AutoNoVsync', 'Fifo', 'Immediate', 'Mailbox'];
  if (isNonEmptyString(plan.presentMode) && !validPresentModes.includes(plan.presentMode)) {
    flag('unknown-present-mode', 'low', `presentMode "${plan.presentMode}" is not a recognized wgpu present mode.`, 'Use one of: ' + validPresentModes.join(', ') + '.');
  }
  if (plan.presentMode === 'AutoNoVsync') {
    recommendations.push('AutoNoVsync is for benchmarking raw GPU headroom only — do not ship it; use AutoVsync for tear-free, display-capped frame pacing.');
  }

  // --- redraw-every-frame ---
  if (plan.requestsRedrawEveryFrame !== true) {
    flag(
      'no-redraw-requested',
      'medium',
      'requestsRedrawEveryFrame is not true: winit is event-driven and will not redraw on its own, so animation/scrubbing/auto-play will appear static.',
      'Call window.request_redraw() from resumed, after input, and at the end of each animating frame — or confirm the surface is genuinely one-shot/static.'
    );
  }

  // --- Scene model ---
  if (plan.cachesSceneInPlace === true) {
    flag(
      'scene-cached-in-place',
      'high',
      'cachesSceneInPlace is true: Vello is immediate-from-your-side — you rebuild the Scene each frame via scene.reset() then re-fill/stroke/draw_glyphs. Diffing or mutating a Scene in place is not the API model.',
      'Rebuild the Scene every frame (it is CPU-cheap, microseconds for thousands of primitives). Only use Scene::append of cached sub-scenes for measured 100k+ primitive static regions.'
    );
  }

  // --- glyph coords bridge ---
  if (plan.glyphCoordsReinterpreted !== true) {
    flag(
      'glyph-coords-not-bridged',
      'medium',
      'glyphCoordsReinterpreted is not true: Parley yields variation coords as &[i16] but Vello/Skrifa\'s draw_glyphs wants &[NormalizedCoord] (F2Dot14). Left unbridged this is either a compile-time type mismatch, or a sign that glyphs are not flowing through Parley at all (a hand-rolled glyph atlas standing in for it).',
      'Reinterpret the slice (both are 2-byte, layout-identical) before calling draw_glyphs, and confirm glyph runs originate from a Parley Layout rather than a hand-rolled bitmap atlas — see references/parley-glyph-runs.md.'
    );
  }

  // --- logical/physical pixel consistency ---
  if (plan.scaleFactorThreadedThrough !== true) {
    flag(
      'scale-factor-not-threaded',
      'medium',
      'scaleFactorThreadedThrough is not true: winit gives physical surface sizes while layout is usually authored in logical points. Mixing the two renders text/geometry at half or double size on HiDPI.',
      'Pass window.scale_factor() into both Parley\'s layout (ranged_builder\'s scale) and your geometry transform, and pick one coordinate space to convert at the boundary.'
    );
  }

  const criticalOrHigh = findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
  const pass = criticalOrHigh.length === 0;

  if (findings.length === 0) {
    recommendations.push('Plan is clean against known failure modes. Still run `cargo tree -d` once for real — this audit only checks the numbers you reported.');
  }

  return { pass, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: render_plan_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditRenderPlan(data), null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`render_plan_audit: ${e.message}\n`);
    process.exit(1);
  }
}
