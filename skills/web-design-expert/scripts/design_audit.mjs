#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Weights sum to 100. Each maps to one Quality Gate in SKILL.md.
const GATE_WEIGHTS = {
  primaryActionObviousWithin3s: 10,
  textContrastMinRatio: 15,
  worksAt320pxNoHscroll: 15,
  touchTargetsMinPx: 10,
  brandColorsConsistent: 8,
  typographyDiscipline: 12, // fontWeightsCount + fontSizesCount combined
  loadInteractiveSeconds: 10,
  navMatchesMentalModel: 12,
  lightAndDark: 4,
  interactiveStatesDefined: 4,
};

const REQUIRED_FIELDS = [
  'primaryActionObviousWithin3s',
  'textContrastMinRatio',
  'worksAt320pxNoHscroll',
  'touchTargetsMinPx',
  'brandColorsConsistent',
  'fontWeightsCount',
  'fontSizesCount',
  'loadInteractiveSeconds',
  'navMatchesMentalModel',
  'lightAndDark',
  'interactiveStatesDefined',
];

const MIN_CONTRAST_RATIO = 4.5;
const MIN_TOUCH_TARGET_PX = 44;
const MAX_FONT_WEIGHTS = 3;
const MAX_FONT_SIZES = 4;
const MAX_BUTTON_STYLES = 3;
const MAX_LOAD_INTERACTIVE_SECONDS = 3;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isBoolean(value) {
  return typeof value === 'boolean';
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Audit a web design plan against this skill's Quality Gates and its five
 * named failure modes: design-by-committee, decoration-over-function,
 * mobile-afterthought, low-contrast, and information-architecture collapse.
 *
 * Deterministic: every check reads a structured field on `plan`. No text or
 * keyword matching is performed anywhere in this function.
 *
 * @param {unknown} plan - parsed JSON design plan (see schemas/design-plan.schema.json).
 * @returns {{pass: boolean, score: number, findings: Array<{id: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditWebDesign(plan) {
  if (!isPlainObject(plan)) {
    throw new Error('design plan must be a JSON object');
  }

  const findings = [];
  const recommendations = [];
  let score = 0;
  let criticalHit = false;

  function fail(id, severity, message, recommendation) {
    findings.push({ id, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
  }

  const missingFields = REQUIRED_FIELDS.filter((key) => !(key in plan));
  if (missingFields.length > 0) {
    fail(
      'missing-fields',
      'high',
      `design plan is missing required field(s): ${missingFields.join(', ')}.`,
      'Fill every field in schemas/design-plan.schema.json before auditing; an absent field cannot be assumed to pass or fail.'
    );
  }

  // --- Quality Gate: primary action obvious within 3s ---
  if (isBoolean(plan.primaryActionObviousWithin3s)) {
    if (plan.primaryActionObviousWithin3s) {
      score += GATE_WEIGHTS.primaryActionObviousWithin3s;
    } else {
      fail(
        'primary-action-not-obvious',
        'medium',
        'Primary user action is not obvious within 3 seconds of page load.',
        'Give the primary CTA the strongest visual weight above the fold; remove competing calls to action.'
      );
    }
  }

  // --- Quality Gate + failure mode: low-contrast ---
  if (isFiniteNumber(plan.textContrastMinRatio)) {
    if (plan.textContrastMinRatio >= MIN_CONTRAST_RATIO) {
      score += GATE_WEIGHTS.textContrastMinRatio;
    } else {
      fail(
        'low-contrast',
        'critical',
        `textContrastMinRatio is ${plan.textContrastMinRatio}:1, below the WCAG AA minimum of ${MIN_CONTRAST_RATIO}:1.`,
        'Darken text or lighten the background until the ratio meets 4.5:1 (3:1 for large text); re-check with a contrast tool, not by eye.'
      );
    }
  }

  // --- Quality Gate + failure mode: mobile-afterthought (part 1: 320px hscroll) ---
  let mobileAfterthought = false;
  if (isBoolean(plan.worksAt320pxNoHscroll)) {
    if (plan.worksAt320pxNoHscroll) {
      score += GATE_WEIGHTS.worksAt320pxNoHscroll;
    } else {
      mobileAfterthought = true;
      fail(
        'mobile-afterthought-hscroll',
        'high',
        'Layout requires horizontal scrolling at 320px width.',
        'Rebuild the layout mobile-first; fixed-width elements wider than 320px are the usual cause.'
      );
    }
  }

  // --- Quality Gate + failure mode: mobile-afterthought (part 2: touch targets) ---
  if (isFiniteNumber(plan.touchTargetsMinPx)) {
    if (plan.touchTargetsMinPx >= MIN_TOUCH_TARGET_PX) {
      score += GATE_WEIGHTS.touchTargetsMinPx;
    } else {
      mobileAfterthought = true;
      fail(
        'mobile-afterthought-touch-target',
        'high',
        `touchTargetsMinPx is ${plan.touchTargetsMinPx}px, below the ${MIN_TOUCH_TARGET_PX}px minimum.`,
        'Increase interactive element hit areas to at least 44x44px, even if the visible glyph stays smaller.'
      );
    }
  }
  if (mobileAfterthought) {
    recommendations.push(
      'Failure mode: mobile-afterthought detected. Test the real layout at 320px width on an actual device before shipping.'
    );
  }

  // --- Quality Gate: brand colors consistent ---
  if (isBoolean(plan.brandColorsConsistent)) {
    if (plan.brandColorsConsistent) {
      score += GATE_WEIGHTS.brandColorsConsistent;
    } else {
      fail(
        'inconsistent-brand-colors',
        'low',
        'Brand colors are not used consistently (different hex values for the same role across components).',
        'Consolidate to a single source-of-truth token per brand color and reference it everywhere.'
      );
    }
  }

  // --- Quality Gate + failure mode: design-by-committee (typography + optional buttons) ---
  let designByCommittee = false;
  const hasFontWeights = isFiniteNumber(plan.fontWeightsCount);
  const hasFontSizes = isFiniteNumber(plan.fontSizesCount);
  if (hasFontWeights || hasFontSizes) {
    const weightsOk = !hasFontWeights || plan.fontWeightsCount <= MAX_FONT_WEIGHTS;
    const sizesOk = !hasFontSizes || plan.fontSizesCount <= MAX_FONT_SIZES;
    if (weightsOk && sizesOk) {
      score += GATE_WEIGHTS.typographyDiscipline;
    } else {
      designByCommittee = true;
      if (!weightsOk) {
        fail(
          'design-by-committee-font-weights',
          'medium',
          `fontWeightsCount is ${plan.fontWeightsCount}, above the maximum of ${MAX_FONT_WEIGHTS}.`,
          'Collapse to at most 3 font weights across the whole design.'
        );
      }
      if (!sizesOk) {
        fail(
          'design-by-committee-font-sizes',
          'medium',
          `fontSizesCount is ${plan.fontSizesCount}, above the maximum of ${MAX_FONT_SIZES}.`,
          'Collapse to at most 4 font sizes across the whole design.'
        );
      }
      // Partial credit if only one of the two typography dimensions failed.
      score += GATE_WEIGHTS.typographyDiscipline * 0.3;
    }
  }
  if (isFiniteNumber(plan.buttonStylesCount) && plan.buttonStylesCount > MAX_BUTTON_STYLES) {
    designByCommittee = true;
    fail(
      'design-by-committee-button-styles',
      'medium',
      `buttonStylesCount is ${plan.buttonStylesCount}, above the maximum of ${MAX_BUTTON_STYLES}.`,
      'Consolidate to at most 3 button styles (e.g. primary, secondary, ghost) and reuse them everywhere.'
    );
  }
  if (designByCommittee) {
    recommendations.push(
      'Failure mode: design-by-committee detected. Establish a single design-principles document as the source of truth.'
    );
  }

  // --- Failure mode: decoration-over-function (optional field) ---
  if (isFiniteNumber(plan.unjustifiedAnimationsCount) && plan.unjustifiedAnimationsCount > 0) {
    fail(
      'decoration-over-function',
      'medium',
      `${plan.unjustifiedAnimationsCount} animation(s) or visual element(s) have no stated user-facing purpose.`,
      'Remove or justify every animation/decoration in terms of the user goal it serves.'
    );
  }

  // --- Quality Gate: interactive within 3s on 3G ---
  if (isFiniteNumber(plan.loadInteractiveSeconds)) {
    if (plan.loadInteractiveSeconds <= MAX_LOAD_INTERACTIVE_SECONDS) {
      score += GATE_WEIGHTS.loadInteractiveSeconds;
    } else {
      fail(
        'slow-time-to-interactive',
        'medium',
        `loadInteractiveSeconds is ${plan.loadInteractiveSeconds}s, above the ${MAX_LOAD_INTERACTIVE_SECONDS}s target on a 3G connection.`,
        'Defer non-critical JS, compress hero imagery, and inline critical CSS to hit interactivity within 3s.'
      );
    }
  }

  // --- Quality Gate + failure mode: information architecture collapse ---
  if (isBoolean(plan.navMatchesMentalModel)) {
    if (plan.navMatchesMentalModel) {
      score += GATE_WEIGHTS.navMatchesMentalModel;
    } else {
      fail(
        'ia-collapse',
        'high',
        'Navigation does not match the user mental model (task completion rate is not confirmed above 80%).',
        'Run card sorting or a task-completion study on navigation; restructure until >80% complete the primary task.'
      );
    }
  }

  // --- Quality Gate: light and dark ---
  if (isBoolean(plan.lightAndDark)) {
    if (plan.lightAndDark) {
      score += GATE_WEIGHTS.lightAndDark;
    } else {
      fail(
        'no-dark-mode',
        'low',
        'Design does not work in both light and dark system preferences.',
        'Add a dark-mode palette derived from the same brand tokens, not a naive color inversion.'
      );
    }
  }

  // --- Quality Gate: interactive states defined ---
  if (isBoolean(plan.interactiveStatesDefined)) {
    if (plan.interactiveStatesDefined) {
      score += GATE_WEIGHTS.interactiveStatesDefined;
    } else {
      fail(
        'missing-interactive-states',
        'medium',
        'Hover, focus, and active states are not all defined for interactive components.',
        'Define hover/focus/active for every interactive component; never remove the focus outline without a replacement.'
      );
    }
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && missingFields.length === 0 && clampedScore >= 80;

  if (findings.length === 0) {
    recommendations.push(
      'Design plan clears all Quality Gates and named failure modes. Spot-check the real build against this plan before shipping — the audit trusts the numbers it was given.'
    );
  }

  return {
    pass,
    score: clampedScore,
    findings,
    recommendations,
  };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: design_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditWebDesign(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`design_audit: ${error.message}\n`);
    process.exit(1);
  }
}
