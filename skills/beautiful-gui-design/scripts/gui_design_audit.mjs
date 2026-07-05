#!/usr/bin/env node
// gui_design_audit.mjs — deterministic audit of a GUI design spec against the
// beautiful-gui-design Quality Gates (SKILL.md). Pure stdlib, no deps.
//
// Usage:
//   node gui_design_audit.mjs --input <gui-spec>.json
//
// Exports:
//   auditGuiDesign(spec) -> { pass, score, findings, recommendations }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bounded, documented thresholds — see SKILL.md "Visual System Rules" and
// "Quality Gates" for the rationale behind each number.
const MIN_TEXT_CONTRAST = 4.5; // WCAG 2.2 AA, body text
const MIN_TOUCH_TARGET_PX = 44; // iOS HIG 44pt / Android 48dp / WCAG 2.5.8 24px floor
const MIN_BODY_FONT_PX = 14; // the 14px floor — never tiny fonts
const MAX_FONT_WEIGHTS = 3; // regular/medium/bold is the ceiling before it's design-by-committee
const MAX_FONT_SIZES = 8; // a modular scale runs ~6-8 steps

const VALID_SPACING_SCALES = new Set(['8pt', '4pt', 'ad-hoc']);
const SEVERITY_WEIGHT = { critical: 12, high: 8, medium: 4, low: 2 };

function severityWeight(severity) {
  if (!Object.prototype.hasOwnProperty.call(SEVERITY_WEIGHT, severity)) {
    throw new Error(`unknown finding severity "${severity}" (expected one of ${Object.keys(SEVERITY_WEIGHT).join(', ')})`);
  }
  return SEVERITY_WEIGHT[severity];
}

function assertShape(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('auditGuiDesign: input must be a JSON object');
  }
  const numberFields = [
    'textContrastMinRatio',
    'touchTargetMinPx',
    'fontWeightsCount',
    'fontSizesCount',
    'minBodyFontPx',
  ];
  for (const field of numberFields) {
    if (typeof spec[field] !== 'number' || Number.isNaN(spec[field]) || spec[field] < 0) {
      throw new Error(`auditGuiDesign: "${field}" is required and must be a non-negative number`);
    }
  }
  const boolFields = ['semanticTokensUsed', 'lightAndDark', 'interactiveStatesDefined'];
  for (const field of boolFields) {
    if (typeof spec[field] !== 'boolean') {
      throw new Error(`auditGuiDesign: "${field}" is required and must be a boolean`);
    }
  }
  if (typeof spec.spacingScale !== 'string' || !VALID_SPACING_SCALES.has(spec.spacingScale)) {
    throw new Error('auditGuiDesign: "spacingScale" is required and must be one of "8pt", "4pt", "ad-hoc"');
  }
}

function pushFinding(findings, recommendations, severity, id, message, recommendation) {
  findings.push({ severity, id, message });
  if (recommendation) recommendations.push(recommendation);
}

/**
 * Audit a GUI design spec against the beautiful-gui-design Quality Gates:
 * contrast, readable type, semantic tokens, light/dark, an 8pt/4pt spacing
 * grid, a disciplined type system, touch targets, and defined interactive
 * states. Fails closed — every gate must be positively satisfied; there is
 * no field whose absence is treated as "safe" (assertShape requires all nine).
 *
 * @param {object} spec
 * @param {number} spec.textContrastMinRatio - Worst-case body-text contrast ratio measured (e.g. 4.8).
 * @param {number} spec.touchTargetMinPx - Smallest interactive hit-area, in px, across the design.
 * @param {"8pt"|"4pt"|"ad-hoc"} spec.spacingScale - The spacing system actually in use.
 * @param {number} spec.fontWeightsCount - Distinct font weights shipped.
 * @param {number} spec.fontSizesCount - Distinct font sizes shipped.
 * @param {boolean} spec.semanticTokensUsed - True only if components reference semantic tokens, not raw hex/px.
 * @param {boolean} spec.lightAndDark - True only if light AND dark are both designed and contrast-verified.
 * @param {number} spec.minBodyFontPx - Smallest body/caption font size shipped, in px.
 * @param {boolean} spec.interactiveStatesDefined - True only if every interactive element defines
 *   default/hover/active/focus-visible/disabled (+ loading where async).
 * @returns {{pass:boolean, score:number, findings:Array, recommendations:string[]}}
 */
export function auditGuiDesign(spec) {
  assertShape(spec);

  const findings = [];
  const recommendations = [];

  // --- Contrast & theming ---------------------------------------------------
  if (spec.textContrastMinRatio < MIN_TEXT_CONTRAST) {
    pushFinding(
      findings, recommendations, 'critical', 'low-text-contrast',
      `Worst-case text contrast is ${spec.textContrastMinRatio}:1, below the ${MIN_TEXT_CONTRAST}:1 WCAG AA floor.`,
      'Darken/lighten the token pair (or the surface behind it) until the pair verifies at 4.5:1+ in a contrast checker.',
    );
  }
  if (spec.lightAndDark === false) {
    pushFinding(
      findings, recommendations, 'high', 'missing-light-dark',
      'Only one theme (light or dark) is designed; the other is missing or a naive inversion.',
      'Design real light AND dark values for every semantic token and contrast-verify both — never invert one to get the other.',
    );
  }

  // --- Typography -------------------------------------------------------------
  if (spec.minBodyFontPx < MIN_BODY_FONT_PX) {
    pushFinding(
      findings, recommendations, 'critical', 'tiny-body-font',
      `Smallest body/caption font is ${spec.minBodyFontPx}px, below the ${MIN_BODY_FONT_PX}px floor.`,
      `Raise body/caption text to >=${MIN_BODY_FONT_PX}px (0.875rem); reserve anything smaller for weight>=600 uppercase eyebrow labels with tracking>=0.1em.`,
    );
  }
  if (spec.fontWeightsCount > MAX_FONT_WEIGHTS) {
    pushFinding(
      findings, recommendations, 'medium', 'too-many-font-weights',
      `${spec.fontWeightsCount} font weights are shipped, over the ${MAX_FONT_WEIGHTS}-weight ceiling before it reads as design-by-committee.`,
      `Collapse to ${MAX_FONT_WEIGHTS} weights (e.g. regular/medium/bold) and justify any exception.`,
    );
  }
  if (spec.fontSizesCount > MAX_FONT_SIZES) {
    pushFinding(
      findings, recommendations, 'medium', 'too-many-font-sizes',
      `${spec.fontSizesCount} distinct font sizes are shipped, over the ~${MAX_FONT_SIZES}-step modular-scale ceiling.`,
      `Rebuild the type scale as a single modular ramp (~${MAX_FONT_SIZES} steps) and map every existing size onto it.`,
    );
  }

  // --- Tokens & spacing ---------------------------------------------------------
  if (spec.semanticTokensUsed === false) {
    pushFinding(
      findings, recommendations, 'critical', 'no-semantic-tokens',
      'Components reference raw hex/px values instead of semantic design tokens.',
      'Build the three-tier token model (primitive -> semantic -> component) and point every component at semantic tokens only.',
    );
  }
  if (spec.spacingScale === 'ad-hoc') {
    pushFinding(
      findings, recommendations, 'high', 'ad-hoc-spacing',
      'Spacing values are not on an 8pt or 4pt grid — one-off pixel values scattered through the system.',
      'Adopt a single 8pt (or 4pt for micro-adjustments) spacing scale and re-map every existing spacing value onto it.',
    );
  }

  // --- Interaction & accessibility ------------------------------------------------
  if (spec.touchTargetMinPx < MIN_TOUCH_TARGET_PX) {
    pushFinding(
      findings, recommendations, 'high', 'touch-target-below-minimum',
      `Smallest interactive hit-area is ${spec.touchTargetMinPx}px, below the ${MIN_TOUCH_TARGET_PX}px minimum.`,
      `Pad the interactive element (not just its visible glyph) to >=${MIN_TOUCH_TARGET_PX}px and space adjacent targets so they don't crowd.`,
    );
  }
  if (spec.interactiveStatesDefined === false) {
    pushFinding(
      findings, recommendations, 'critical', 'no-interactive-states',
      'One or more interactive elements are missing hover/active/focus-visible/disabled states.',
      'Define the full state machine (default/hover/active/focus-visible/disabled, +loading where async) on every interactive element.',
    );
  }

  const totalWeight = findings.reduce((sum, f) => sum + (severityWeight(f.severity)), 0);
  const score = Math.max(0, 100 - totalWeight);
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const pass = !hasCritical && score >= 75;

  if (pass) {
    recommendations.push('Spec meets the beautiful-gui-design Quality Gates: contrast, type, tokens, spacing, targets, and states all clear.');
  }

  return { pass, score, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: gui_design_audit.mjs --input <gui-spec>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditGuiDesign(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`gui_design_audit: ${error.message}\n`);
    process.exit(1);
  }
}
