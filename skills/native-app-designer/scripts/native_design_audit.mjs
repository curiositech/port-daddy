#!/usr/bin/env node
// native_design_audit.mjs — deterministic audit of a native-ui-spec against
// Apple HIG and this repo's hard native-design rules (no emoji icons, no tiny
// fonts, 44pt tap targets, WCAG contrast, light/dark, safe areas). Pure
// stdlib, no deps.
//
// Usage:
//   node native_design_audit.mjs --input <native-ui-spec.json>
//
// Exports:
//   auditNativeDesign(spec) -> { pass, score, findings, recommendations }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bounded, documented thresholds — see SKILL.md "Quality Gates" and the
// repo-wide "NO TINY FONTS" / "NO EMOJIS AS ICONS" rules these encode.
const MIN_TAP_TARGET_PT = 44; // Apple HIG hard minimum
const MIN_BODY_FONT_PT = 14; // repo-wide readable-text floor
const MIN_CONTRAST_RATIO = 4.5; // WCAG 2.1 AA for normal text

const SEVERITY_WEIGHT = { critical: 12, high: 8, medium: 4, low: 2 };

function assertShape(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('auditNativeDesign: input must be a JSON object');
  }
  const boolFields = [
    'usesSfSymbolsNotEmojiIcons',
    'honorsDynamicType',
    'respectsSafeAreas',
    'lightAndDark',
    'usesSystemMaterials',
  ];
  for (const field of boolFields) {
    if (typeof spec[field] !== 'boolean') {
      throw new Error(`auditNativeDesign: "${field}" is required and must be a boolean`);
    }
  }
  const numberFields = ['minTapTargetPt', 'minBodyFontPt', 'contrastMinRatio'];
  for (const field of numberFields) {
    if (typeof spec[field] !== 'number' || Number.isNaN(spec[field])) {
      throw new Error(`auditNativeDesign: "${field}" is required and must be a number`);
    }
  }
}

function pushFinding(findings, severity, id, message, recommendation, recommendations) {
  findings.push({ severity, id, message });
  if (recommendation) recommendations.push(recommendation);
}

/**
 * Audit a native-ui-spec against Apple HIG and this repo's hard native-design
 * rules. FAILS CLOSED: every signal must be explicitly present and true/at-or-
 * above threshold to be treated as safe — a missing field throws rather than
 * being assumed compliant.
 *
 * @param {object} spec
 * @param {boolean} spec.usesSfSymbolsNotEmojiIcons - true only if all UI icons are SF Symbols (no emoji-as-icon).
 * @param {boolean} spec.honorsDynamicType - true only if body text scales with the system Dynamic Type setting.
 * @param {number} spec.minTapTargetPt - smallest interactive control's tap target, in points.
 * @param {number} spec.minBodyFontPt - smallest body/prose/caption font size, in points.
 * @param {boolean} spec.respectsSafeAreas - true only if layout avoids notch/Dynamic Island/home-indicator intrusion.
 * @param {boolean} spec.lightAndDark - true only if both light and dark appearances are implemented with semantic colors.
 * @param {number} spec.contrastMinRatio - worst-case text/background contrast ratio anywhere in the UI.
 * @param {boolean} spec.usesSystemMaterials - true if system materials (.ultraThinMaterial etc.) are used instead of flat/opaque fills.
 * @returns {{pass:boolean, score:number, findings:Array, recommendations:string[]}}
 */
export function auditNativeDesign(spec) {
  assertShape(spec);

  const findings = [];
  const recommendations = [];

  // --- NO EMOJIS AS ICONS IN APPS -----------------------------------------
  if (spec.usesSfSymbolsNotEmojiIcons !== true) {
    pushFinding(
      findings, 'critical', 'emoji-icons-not-sf-symbols',
      'UI icons use emoji instead of SF Symbols — a hard repo rule ("NO EMOJIS AS ICONS IN APPS") and an HIG violation.',
      'Replace every emoji-as-icon with the matching SF Symbol (or a custom vector asset drawn to SF Symbol grid conventions).',
      recommendations,
    );
  }

  // --- NO TINY FONTS: absolute floor + Dynamic Type ------------------------
  if (spec.minBodyFontPt < MIN_BODY_FONT_PT) {
    pushFinding(
      findings, 'critical', 'body-font-below-minimum',
      `Smallest body/prose/caption font is ${spec.minBodyFontPt}pt, below the ${MIN_BODY_FONT_PT}pt readable-text floor.`,
      `Raise body/caption text to at least ${MIN_BODY_FONT_PT}pt; eyebrow/uppercase tracked-out labels may sit lower only at weight >=600 with letter-spacing.`,
      recommendations,
    );
  }
  if (spec.honorsDynamicType !== true) {
    pushFinding(
      findings, 'critical', 'dynamic-type-not-honored',
      'Text does not scale with the system Dynamic Type setting — SwiftUI text styles must be used instead of hard-coded point sizes.',
      'Use SwiftUI semantic text styles (.font(.body), .font(.headline), etc.) or UIFontMetrics-scaled fonts so text honors the user\'s Dynamic Type setting.',
      recommendations,
    );
  }

  // --- Tap targets ----------------------------------------------------------
  if (spec.minTapTargetPt < MIN_TAP_TARGET_PT) {
    pushFinding(
      findings, 'critical', 'tap-target-too-small',
      `Smallest interactive control's tap target is ${spec.minTapTargetPt}pt, below Apple HIG's ${MIN_TAP_TARGET_PT}pt minimum.`,
      `Enlarge the hit area to at least ${MIN_TAP_TARGET_PT}x${MIN_TAP_TARGET_PT}pt (padding may extend beyond the visible control).`,
      recommendations,
    );
  }

  // --- Contrast ---------------------------------------------------------------
  if (spec.contrastMinRatio < MIN_CONTRAST_RATIO) {
    pushFinding(
      findings, 'critical', 'contrast-below-wcag',
      `Worst-case text/background contrast is ${spec.contrastMinRatio}:1, below the WCAG 2.1 AA minimum of ${MIN_CONTRAST_RATIO}:1 for normal text.`,
      'Darken/lighten foreground or background (or switch to a semantic color token with a verified contrast pair) until every text/background pairing clears 4.5:1.',
      recommendations,
    );
  }

  // --- Light/Dark ---------------------------------------------------------------
  if (spec.lightAndDark !== true) {
    pushFinding(
      findings, 'critical', 'no-light-dark-support',
      'Design does not implement both light and dark appearances with semantic colors.',
      'Define semantic color tokens (e.g. Color("primaryText") in an asset catalog) that resolve correctly in both light and dark, and verify both.',
      recommendations,
    );
  }

  // --- Safe areas ---------------------------------------------------------------
  if (spec.respectsSafeAreas !== true) {
    pushFinding(
      findings, 'critical', 'ignores-safe-areas',
      'Layout does not respect safe areas — content may be clipped by the notch, Dynamic Island, or home indicator.',
      'Lay out content within safeAreaInsets (or SwiftUI\'s default safe-area behavior) and only intentionally bleed background/media under it.',
      recommendations,
    );
  }

  // --- System materials (HIG recommendation, not a hard rule) ------------------
  if (spec.usesSystemMaterials !== true) {
    pushFinding(
      findings, 'medium', 'no-system-materials',
      'Surfaces use flat/opaque fills instead of system materials (.ultraThinMaterial, .regularMaterial, etc.).',
      'Prefer system materials for chrome/overlay surfaces so the UI inherits platform vibrancy and stays visually current across OS releases.',
      recommendations,
    );
  }

  const totalWeight = findings.reduce((sum, f) => sum + ((SEVERITY_WEIGHT[f.severity] ?? (() => { throw new Error(`unknown finding severity: ${f.severity}`); })())), 0);
  const score = Math.max(0, 100 - totalWeight);
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const pass = !hasCritical && score >= 75;

  if (pass) {
    recommendations.push('Design meets the native-design bar: SF Symbols, readable/Dynamic-Type text, 44pt targets, WCAG contrast, light/dark, safe areas. Ship it.');
  }

  return { pass, score, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: native_design_audit.mjs --input <native-ui-spec>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditNativeDesign(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`native_design_audit: ${error.message}\n`);
    process.exit(1);
  }
}
