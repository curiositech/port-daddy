#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_IMPORT_MODELS = ['import-tailwindcss', 'v3-tailwind-directives'];
const VALID_DYNAMIC_STRATEGIES = ['literal-map', 'css-variable', 'template-literal', 'none'];
const VALID_DARK_MODE = ['media', 'class', 'data-attribute', 'none', 'multiple'];
const CSS_BUDGET_KB_GZIPPED = 50;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a Tailwind v4 setup/migration plan against tailwind-v4-expert's
 * anti-patterns and Quality Gates. All rules operate on structured
 * enum/boolean/number fields -- no free-text matching.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/tailwind-v4-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditTailwindV4(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_IMPORT_MODELS.includes(plan.importModel)) {
    throw new TypeError(`plan.importModel must be one of: ${VALID_IMPORT_MODELS.join(', ')}`);
  }
  if (!VALID_DYNAMIC_STRATEGIES.includes(plan.dynamicClassStrategy)) {
    throw new TypeError(`plan.dynamicClassStrategy must be one of: ${VALID_DYNAMIC_STRATEGIES.join(', ')}`);
  }

  const findings = [];
  const recommendations = [];
  let score = 100;
  let criticalHit = false;

  function fail(rule, severity, message, recommendation) {
    findings.push({ rule, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
    score -= { critical: 30, high: 15, medium: 8, low: 3 }[severity] ?? 5;
  }

  // --- Gate: v4 import model, not v3 directives ---
  if (plan.importModel === 'v3-tailwind-directives') {
    fail(
      'v3-directives-in-v4',
      'critical',
      'importModel is v3-tailwind-directives: `@tailwind base/components/utilities` is the v3 entry point and does not drive the v4 Oxide engine.',
      'Replace the three directives with a single `@import "tailwindcss";` in the root CSS file.'
    );
  }

  // --- Gate: tailwind.config.js deleted ---
  if (plan.configFileDeleted !== true) {
    fail(
      'tailwind-config-js-still-present',
      'high',
      'configFileDeleted is not true: v4 ignores tailwind.config.js, so a surviving file means theme/content/plugins were never migrated.',
      'Move theme.extend into @theme, content globs into @source, plugins into @variant/CSS, then delete the file (npx @tailwindcss/upgrade@latest for a first pass).'
    );
  }

  // --- Gate: no dynamic class names Oxide cannot see ---
  if (plan.dynamicClassStrategy === 'template-literal') {
    fail(
      'dynamic-classes-invisible-to-oxide',
      'critical',
      'dynamicClassStrategy is template-literal: Oxide is a static scanner, so `text-${color}-500` works in dev and vanishes in production.',
      'Map dynamic values to literal classes (a const variants object), or move the dynamic part into a CSS variable (`style={{ "--accent": color }} class="bg-[--accent]"`).'
    );
  }

  // --- Gate: workspace deps with Tailwind classes have @source globs ---
  if (plan.workspaceDepsWithClasses === true && plan.sourceGlobsDeclared !== true) {
    fail(
      'workspace-dep-missing-source-glob',
      'high',
      'workspaceDepsWithClasses is true but sourceGlobsDeclared is not: the default scan covers the project root only, so the UI package\'s classes are absent from production CSS.',
      'Add an @source glob per workspace dep (relative to the CSS file, not the project root).'
    );
  }

  // --- Gate: one dark-mode strategy, in one place ---
  if (plan.darkModeStrategy !== undefined) {
    if (!VALID_DARK_MODE.includes(plan.darkModeStrategy)) {
      fail(
        'invalid-dark-mode-strategy',
        'medium',
        `darkModeStrategy "${plan.darkModeStrategy}" is not one of: ${VALID_DARK_MODE.join(', ')}.`,
        'Declare media, class, data-attribute, none, or multiple so the strategy can be audited.'
      );
    } else if (plan.darkModeStrategy === 'multiple') {
      fail(
        'dark-mode-strategy-scattered',
        'medium',
        'darkModeStrategy is multiple: mixing media-query and class/data-attribute variants across components produces pages that half-switch.',
        'Pick exactly one @variant dark definition, documented in one place.'
      );
    }
  }

  // --- Gate: design tokens live in @theme (one source of truth) ---
  if (plan.themeTokensInTheme !== true) {
    fail(
      'tokens-outside-theme',
      'medium',
      'themeTokensInTheme is not true: tokens defined outside @theme generate no utilities and split the source of truth between CSS vars and config.',
      'Define colors/fonts/breakpoints/spacing as @theme tokens so they generate utilities AND are readable as var(--...) in raw CSS.'
    );
  }

  // --- Gate: v3 plugins ported, not copy-pasted ---
  if (plan.v3PluginsPorted === false) {
    fail(
      'v3-plugins-unported',
      'high',
      'v3PluginsPorted is false: the v4 plugin API is incompatible with most v3 plugins, so builds fail or silently drop the plugin\'s utilities.',
      'Use the v4-native plugin version where one exists, or rewrite the plugin\'s effects with @variant / @layer components / custom utilities.'
    );
  }

  // --- Gate: CSS bundle within budget ---
  if (plan.cssBundleKbGzipped !== undefined) {
    if (typeof plan.cssBundleKbGzipped !== 'number' || plan.cssBundleKbGzipped < 0) {
      fail(
        'invalid-css-bundle-size',
        'low',
        'cssBundleKbGzipped must be a non-negative number when provided.',
        'Report the gzipped CSS bundle size in KB.'
      );
    } else if (plan.cssBundleKbGzipped > CSS_BUDGET_KB_GZIPPED) {
      fail(
        'css-bundle-over-budget',
        'medium',
        `cssBundleKbGzipped is ${plan.cssBundleKbGzipped} (> ${CSS_BUDGET_KB_GZIPPED}KB): usually a symptom of @apply-everything component files that do not dedupe.`,
        'Apply once at the component boundary and compose variants via class strings (clsx/cva) instead of deep @apply chains.'
      );
    }
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Plan clears every gate this skill checks. Still diff the production CSS against dev for missing utilities before shipping the migration.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: tailwind_v4_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditTailwindV4(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`tailwind_v4_audit: ${e.message}\n`);
    process.exit(1);
  }
}
