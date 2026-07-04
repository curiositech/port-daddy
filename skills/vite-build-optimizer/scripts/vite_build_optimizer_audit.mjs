#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_CONCERNS = ['dev-startup', 'hmr', 'bundle-size', 'ssr', 'plugin-authoring'];
const VALID_SOURCEMAP_MODES = ['off', 'public', 'hidden', 'inline'];
const VALID_SSR_TARGETS = ['node', 'edge'];
const VALID_PLUGIN_HOOKS = ['config', 'configResolved', 'transform', 'handleHotUpdate', 'generateBundle'];
const SEVERITY_WEIGHTS = { critical: 30, high: 15, medium: 8, low: 3 };

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a Vite build/config plan against vite-build-optimizer's anti-patterns
 * and Quality Gates. Structured/enum/boolean/number fields only.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/vite-build-optimizer-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditViteBuildOptimizer(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a JSON object (not null, not an array)');
  }
  if (!VALID_CONCERNS.includes(plan.concern)) {
    throw new TypeError(`plan.concern must be one of: ${VALID_CONCERNS.join(', ')}`);
  }

  const findings = [];
  const recommendations = [];
  let score = 100;
  let criticalHit = false;

  function fail(rule, severity, message, recommendation) {
    findings.push({ rule, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
    score -= SEVERITY_WEIGHTS[severity] ?? 5;
  }

  // --- Gate: duplicate framework copies need resolve.dedupe ---
  if (plan.duplicateFrameworkDetected === true && plan.dedupeConfigured !== true) {
    fail(
      'duplicate-framework-without-dedupe',
      'critical',
      'duplicateFrameworkDetected is true but dedupeConfigured is not: two copies of React (or another framework) in the bundle produce "Invalid hook call" in production only.',
      "Add resolve.dedupe: ['react', 'react-dom'] (and every framework appearing multiple times in node_modules)."
    );
  }

  // --- Gate: pre-bundling thrash must be covered by optimizeDeps.include ---
  if (plan.prebundleThrashObserved === true && plan.optimizeDepsIncludeCoversWarnings !== true) {
    fail(
      'prebundle-thrash-uncovered',
      'high',
      'prebundleThrashObserved is true but optimizeDepsIncludeCoversWarnings is not: a dep with dynamic CJS imports re-triggers "new dependencies optimized" and a full reload on every discovery.',
      'Enumerate the dynamic subpaths in optimizeDeps.include, or move the dep to optimizeDeps.exclude if it ships ESM.'
    );
  }

  // --- Gate: HMR needs named default-exported components ---
  if (plan.concern === 'hmr' && plan.defaultExportsAreNamedFunctions !== true) {
    fail(
      'anonymous-default-export-breaks-hmr',
      'high',
      'concern is hmr but defaultExportsAreNamedFunctions is not true: React Fast Refresh cannot granularly invalidate `export default () => ...`, so edits trigger a full reload.',
      'Name the function: export default function Page() { ... } — never an anonymous arrow as the default export.'
    );
  }

  // --- Gate: manualChunks must test absolute paths ---
  if (plan.manualChunksConfigured === true && plan.manualChunksUsesAbsolutePaths !== true) {
    fail(
      'manual-chunks-substring-match',
      'high',
      'manualChunksConfigured is true but manualChunksUsesAbsolutePaths is not: substring rules like id.includes("utils") match app code into the vendor chunk and undo route-level splitting.',
      'Test absolute paths (id.startsWith(root + "/node_modules/")) or path.relative(root, id) before classifying a module.'
    );
  }

  // --- Gate: edge SSR targets cannot rely on runtime require ---
  if (plan.ssrTarget === 'edge' && plan.ssrNoExternalConfigured !== true) {
    fail(
      'edge-ssr-without-noexternal',
      'critical',
      'ssrTarget is edge but ssrNoExternalConfigured is not true: edge runtimes have no runtime require, so externalized deps fail with "Cannot find package" only in the SSR build.',
      'Set ssr.noExternal: true (or near-total) with a known allowlist in ssr.external for the edge target.'
    );
  }

  // --- Gate: configResolved is read-only ---
  if (plan.pluginHook === 'configResolved' && plan.hookMutatesConfig === true) {
    fail(
      'mutating-config-in-configresolved',
      'high',
      'pluginHook is configResolved and hookMutatesConfig is true: configResolved is for reading the final config; mutations there are silently ignored or half-applied.',
      'Mutate user config in the `config` hook; use configResolved only to read mode/command/root.'
    );
  }

  // --- Gate: production sourcemap policy ---
  if (plan.sourcemapMode !== undefined && !VALID_SOURCEMAP_MODES.includes(plan.sourcemapMode)) {
    fail(
      'invalid-sourcemap-mode',
      'medium',
      `sourcemapMode "${plan.sourcemapMode}" is not one of: ${VALID_SOURCEMAP_MODES.join(', ')}.`,
      "Use 'hidden' for production: maps are written for the error tracker but not referenced from shipped JS."
    );
  } else if (plan.sourcemapMode === 'off') {
    fail(
      'no-production-sourcemaps',
      'medium',
      "sourcemapMode is 'off': production errors surface as minified column numbers in Sentry/console.",
      "Set build.sourcemap: 'hidden' and upload the maps to the error tracker separately."
    );
  } else if (plan.sourcemapMode === 'public' || plan.sourcemapMode === 'inline') {
    fail(
      'sourcemaps-shipped-to-clients',
      'low',
      `sourcemapMode is '${plan.sourcemapMode}': full source is exposed to every client that asks.`,
      "Prefer 'hidden' so maps exist for debugging without being referenced from the shipped bundle."
    );
  }

  // --- Gate: chunk-size budget ---
  if (typeof plan.largestChunkKB === 'number' && plan.largestChunkKB > 500 && plan.chunkSizeIntentional !== true) {
    fail(
      'oversized-chunk',
      'high',
      `largestChunkKB is ${plan.largestChunkKB} (>500KB unminified) with chunkSizeIntentional not true.`,
      'Split via manualChunks / dynamic import, and review rollup-plugin-visualizer output to find what is inflating the chunk.'
    );
  }

  // --- Gate: bundle-size work reviews the visualizer ---
  if (plan.concern === 'bundle-size' && plan.visualizerReviewed !== true) {
    fail(
      'visualizer-not-reviewed',
      'medium',
      'concern is bundle-size but visualizerReviewed is not true: chunk tuning without rollup-plugin-visualizer output is guesswork.',
      'Generate stats.html with rollup-plugin-visualizer (gzipSize + brotliSize) and review before/after.'
    );
  }

  // --- Gate: build-time budget ---
  if (typeof plan.buildTimeSeconds === 'number' && plan.buildTimeSeconds > 60) {
    fail(
      'build-over-time-budget',
      'medium',
      `buildTimeSeconds is ${plan.buildTimeSeconds} (>60s budget for a typical app).`,
      'Profile with `vite build --profile` and node --cpu-prof to find the slow plugin or transform.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Plan clears every gate this skill checks. Still verify against a real build: run the production build, inspect the chunk graph, and measure an HMR roundtrip.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: vite_build_optimizer_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditViteBuildOptimizer(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`vite_build_optimizer_audit: ${e.message}\n`);
    process.exit(1);
  }
}
