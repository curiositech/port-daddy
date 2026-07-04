#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_SITE_KINDS = ['marketing', 'docs', 'blog', 'content', 'spa', 'dashboard'];
const VALID_DIRECTIVES = ['load', 'idle', 'visible', 'media', 'only'];
const VALID_FETCH_LOCATIONS = ['frontmatter', 'client-component', 'mixed'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit an Astro islands-architecture plan against astro-islands-architect's
 * anti-patterns and Quality Gates.
 *
 * @param {unknown} plan - parsed JSON islands plan, see schemas/astro-islands-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditAstroIslands(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a JSON object (not null, not an array)');
  }
  if (!VALID_SITE_KINDS.includes(plan.siteKind)) {
    throw new TypeError(`plan.siteKind must be one of: ${VALID_SITE_KINDS.join(', ')}`);
  }
  if (!Array.isArray(plan.islands)) {
    throw new TypeError('plan.islands must be an array (empty is allowed for a fully static site)');
  }
  for (const island of plan.islands) {
    if (!isPlainObject(island) || typeof island.name !== 'string' || !VALID_DIRECTIVES.includes(island.directive)) {
      throw new TypeError(
        `every island must be an object with a string "name" and a "directive" in: ${VALID_DIRECTIVES.join(', ')}`
      );
    }
  }
  if (plan.dataFetchLocation !== undefined && !VALID_FETCH_LOCATIONS.includes(plan.dataFetchLocation)) {
    throw new TypeError(`plan.dataFetchLocation must be one of: ${VALID_FETCH_LOCATIONS.join(', ')}`);
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

  // --- Rule 1: Astro is the wrong framework for a SPA/dashboard ---
  if (plan.siteKind === 'spa' || plan.siteKind === 'dashboard') {
    fail(
      'astro-used-for-spa',
      'critical',
      `siteKind is "${plan.siteKind}": when most pages are interactive, islands grow until the entire page hydrates and Astro's advantage disappears.`,
      'Reach for Next.js/Remix/TanStack Start for SPA-style apps; use Astro for marketing, docs, and content-heavy sites.'
    );
  }

  // --- Rule 2: client:load only for above-the-fold interactive ---
  for (const island of plan.islands) {
    if (island.directive === 'load' && island.aboveTheFold !== true) {
      fail(
        'client-load-below-the-fold',
        'high',
        `island "${island.name}" uses client:load but aboveTheFold is not true: client:load is the heavy hammer, reserved for above-the-fold interactive components.`,
        `Switch island "${island.name}" to client:idle (non-critical) or client:visible (below-the-fold).`
      );
    }
  }

  // --- Rule 3: client:load everywhere (the flagship anti-pattern) ---
  const loadCount = plan.islands.filter((i) => i.directive === 'load').length;
  if (plan.islands.length >= 3 && loadCount * 2 > plan.islands.length) {
    fail(
      'client-load-everywhere',
      'high',
      `${loadCount} of ${plan.islands.length} islands use client:load: the JS bundle bloats and Astro's hydration story disappears.`,
      'Default to client:idle or client:visible; justify every client:load individually.'
    );
  }

  // --- Rule 4: client:only requires a real browser-API need ---
  for (const island of plan.islands) {
    if (island.directive === 'only' && island.needsBrowserApisAtMount !== true) {
      fail(
        'client-only-without-browser-api-need',
        'medium',
        `island "${island.name}" uses client:only but needsBrowserApisAtMount is not true: skipping SSR causes a blank placeholder and layout shift for no reason.`,
        `Render island "${island.name}" server-side with a hydration directive unless it truly cannot render without browser APIs at mount.`
      );
    }
    if (island.directive === 'only' && island.hasSizedFallback !== true) {
      fail(
        'client-only-without-sized-fallback',
        'medium',
        `island "${island.name}" uses client:only but hasSizedFallback is not true: the browser sees an empty placeholder until JS runs, causing CLS.`,
        `Give island "${island.name}" a placeholder that approximates its final size.`
      );
    }
  }

  // --- Rule 5: content collections must be typed ---
  if (plan.contentCollectionsTyped !== true) {
    fail(
      'untyped-content-collections',
      'high',
      'contentCollectionsTyped is not true: without defineCollection + a zod schema, frontmatter typos ship to production as undefined instead of failing the build.',
      'Define every collection in src/content/config.ts with a zod schema so frontmatter mistakes fail the build.'
    );
  }

  // --- Rule 6: fetch in frontmatter, not in client components ---
  if (plan.dataFetchLocation === 'client-component') {
    fail(
      'data-fetch-in-client-components',
      'high',
      'dataFetchLocation is "client-component": loading spinners on every page and SEO damage, because data fetching moved out of the Astro frontmatter.',
      'Fetch in the --- fences at build/SSR time and pass data to islands as props.'
    );
  } else if (plan.dataFetchLocation === 'mixed') {
    fail(
      'data-fetch-partially-client-side',
      'medium',
      'dataFetchLocation is "mixed": some content still fetches client-side; only genuinely per-user/live data should.',
      'Move every fetch that can run at build/SSR time into the frontmatter; keep client fetches for truly live data only.'
    );
  }

  // --- Rule 7: images belong under src/assets/ ---
  if (plan.imagesUnderSrcAssets !== true) {
    fail(
      'images-outside-src-assets',
      'medium',
      'imagesUnderSrcAssets is not true: public/ is served as-is, so some images skip Sharp and ship at original size.',
      'Move images to src/assets/ and render via <Image>; reserve public/ for OG images and favicons.'
    );
  }

  // --- Rule 8: JS budget enforced in CI ---
  if (plan.jsBudgetCIEnforced !== true) {
    fail(
      'no-js-budget-in-ci',
      'low',
      'jsBudgetCIEnforced is not true: without a per-page first-load JS budget in CI, island creep goes unnoticed until Lighthouse regresses.',
      'Set a first-load JS budget per page and fail CI on regressions.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Plan clears every quality gate this skill checks. Still verify LCP on the slowest representative page and test view transitions across major navigation paths.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: astro_islands_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditAstroIslands(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`astro_islands_audit: ${e.message}\n`);
    process.exit(1);
  }
}
