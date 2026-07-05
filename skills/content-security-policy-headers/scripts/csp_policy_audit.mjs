#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_STRATEGIES = ['nonce', 'hash', 'allowlist', 'unsafe-inline'];
const VALID_MODES = ['report-only', 'enforced'];
const VALID_HTML_GENERATION = ['server-rendered', 'static'];
const VALID_NONCE_INJECTION = ['template-emission', 'html-rewrite-middleware'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a CSP policy plan against content-security-policy-headers' baseline
 * (nonce/hash + strict-dynamic, object-src 'none', base-uri 'none') and its
 * Quality Gates. Rules operate on structured enum/boolean/number fields only.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/csp-policy-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditCspPolicy(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_STRATEGIES.includes(plan.scriptSrcStrategy)) {
    throw new TypeError(`plan.scriptSrcStrategy must be one of: ${VALID_STRATEGIES.join(', ')}`);
  }
  if (!VALID_MODES.includes(plan.deploymentMode)) {
    throw new TypeError(`plan.deploymentMode must be one of: ${VALID_MODES.join(', ')}`);
  }
  if (!VALID_HTML_GENERATION.includes(plan.htmlGeneration)) {
    throw new TypeError(`plan.htmlGeneration must be one of: ${VALID_HTML_GENERATION.join(', ')}`);
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

  // --- Gate: no unsafe-inline in script-src (the legacy escape hatch) ---
  if (plan.scriptSrcStrategy === 'unsafe-inline') {
    fail(
      'unsafe-inline-script-src',
      'critical',
      "scriptSrcStrategy is 'unsafe-inline': any inline <script> runs regardless of nonce/hash, defeating the point of CSP.",
      "Switch to a nonce- or hash-based script-src with 'strict-dynamic'; unsafe-inline is what strict CSP exists to leave behind."
    );
  }

  // --- Gate: no unsafe-eval ---
  if (plan.usesUnsafeEval === true) {
    fail(
      'unsafe-eval-present',
      'critical',
      'usesUnsafeEval is true: runtime code from strings (eval, new Function) runs unrestricted despite the CSP.',
      'Find the eval caller via report-only violation reports and replace the library; modern alternatives do not need eval.'
    );
  }

  // --- Gate: no wildcard in script-src ---
  if (plan.wildcardInScriptSrc === true) {
    fail(
      'wildcard-script-src',
      'critical',
      'wildcardInScriptSrc is true: script-src * allows scripts from any origin and defeats CSP entirely.',
      "Remove the wildcard; use 'nonce-...' or 'sha256-...' plus 'strict-dynamic' instead of origin allowlists."
    );
  }

  // --- Gate: allowlist CSP is the brittle old way ---
  if (plan.scriptSrcStrategy === 'allowlist') {
    fail(
      'cdn-allowlist-instead-of-strict-csp',
      'high',
      "scriptSrcStrategy is 'allowlist': CDN URL allowlists are brittle and bypassable (any JSONP-serving domain is a vector).",
      "Switch to nonce or hash plus 'strict-dynamic' and drop the URL list."
    );
  }

  // --- Gate: strict-dynamic accompanies nonce/hash ---
  if ((plan.scriptSrcStrategy === 'nonce' || plan.scriptSrcStrategy === 'hash') && plan.strictDynamic !== true) {
    fail(
      'missing-strict-dynamic',
      'medium',
      "strictDynamic is not true: without 'strict-dynamic', every dynamically-inserted third-party script must be enumerated, which drives teams back to allowlists or unsafe-inline.",
      "Add 'strict-dynamic' so scripts loaded by nonce/hash-trusted scripts are allowed transitively."
    );
  }

  // --- Gate: object-src 'none' and base-uri 'none' in the baseline ---
  if (plan.objectSrcNone !== true) {
    fail(
      'object-src-not-none',
      'high',
      "objectSrcNone is not true: object-src falls back to default-src, leaving <object>/<embed> XSS vectors open despite a strict script-src.",
      "Always include object-src 'none' in the strict baseline."
    );
  }
  if (plan.baseUriNone !== true) {
    fail(
      'base-uri-not-none',
      'high',
      "baseUriNone is not true: an injected <base> tag can rewrite every relative URL on the page.",
      "Include base-uri 'none' in the strict baseline."
    );
  }

  // --- Gates specific to the nonce strategy ---
  if (plan.scriptSrcStrategy === 'nonce') {
    if (typeof plan.nonceEntropyBits === 'number' && plan.nonceEntropyBits < 128) {
      fail(
        'nonce-entropy-too-low',
        'high',
        `nonceEntropyBits is ${plan.nonceEntropyBits}: below the 128-bit minimum, nonces become guessable.`,
        'Generate nonces with >= 128 bits of entropy (crypto.randomBytes(16), base64-encoded).'
      );
    }
    if (plan.nonceFreshPerResponse !== true) {
      fail(
        'nonce-reused-across-responses',
        'critical',
        'nonceFreshPerResponse is not true: a nonce generated at startup or per-route lets an XSS payload that captured one nonce inject scripts on later requests.',
        'Generate a fresh nonce on every response.'
      );
    }
    if (plan.nonceInjection === 'html-rewrite-middleware') {
      fail(
        'nonce-added-by-html-rewrite',
        'critical',
        "nonceInjection is 'html-rewrite-middleware': a rewrite that stamps nonces onto all <script> tags also stamps attacker-injected ones, making the CSP useless (OWASP's exact warning).",
        'Attach the nonce only at known emission points (template engine, server-rendered HTML), never via a post-hoc HTML rewrite.'
      );
    }
    if (plan.htmlGeneration === 'static') {
      fail(
        'nonce-strategy-on-static-html',
        'high',
        "htmlGeneration is 'static' but scriptSrcStrategy is 'nonce': statically generated/cached HTML cannot carry a fresh per-response nonce.",
        "Use a hash-based CSP ('sha256-...') computed at build time for static or cached pages, per the web.dev guidance."
      );
    }
  }

  // --- Gate: two-phase rollout (>= 7 days report-only before enforcing) ---
  if (plan.deploymentMode === 'enforced') {
    const days = typeof plan.reportOnlyDays === 'number' ? plan.reportOnlyDays : 0;
    if (days < 7) {
      fail(
        'enforced-without-report-only-soak',
        'high',
        `deploymentMode is 'enforced' with reportOnlyDays=${days}: enforcing without >= 7 days in Content-Security-Policy-Report-Only risks breaking legitimate scripts you never observed.`,
        'Run the identical policy under Content-Security-Policy-Report-Only for at least 7 days and fix reported violations before flipping to enforcement.'
      );
    }
  }

  // --- Gate: violation reporting wired up (report-to AND report-uri during transition) ---
  if (plan.reportToConfigured !== true && plan.reportUriConfigured !== true) {
    fail(
      'no-violation-reporting',
      'medium',
      'Neither reportToConfigured nor reportUriConfigured is true: without a report endpoint, new violations (attack attempts or regressions) are invisible.',
      'Emit both report-to (with Reporting-Endpoints) and the legacy report-uri during the transition; browsers that support report-to ignore report-uri.'
    );
  } else if (plan.reportToConfigured === true && plan.reportUriConfigured !== true) {
    fail(
      'report-uri-fallback-missing',
      'low',
      'reportToConfigured is true but reportUriConfigured is not: older browsers that lack report-to support will report nothing.',
      'Set both directives during the transition, per the OWASP recommendation.'
    );
  }

  // --- Gate: frame-ancestors must be a header, not <meta> ---
  if (plan.frameAncestorsViaMetaOnly === true) {
    fail(
      'frame-ancestors-in-meta-tag',
      'high',
      'frameAncestorsViaMetaOnly is true: frame-ancestors is header-only per CSP3 and is silently ignored inside <meta http-equiv>.',
      'Set frame-ancestors via the Content-Security-Policy HTTP header; meta-tag CSP is only an acceptable fallback for other directives.'
    );
  }

  // --- Gate: legacy vendor-prefixed headers removed ---
  if (plan.legacyHeadersRemoved === false) {
    fail(
      'legacy-csp-headers-present',
      'low',
      'legacyHeadersRemoved is false: X-Content-Security-Policy / X-WebKit-CSP are obsolete, inconsistent, and buggy per OWASP.',
      'Remove the vendor-prefixed headers and rely on the standard Content-Security-Policy header.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Plan matches the strict-CSP baseline and clears every quality gate this skill checks. Still verify in a real browser that the header nonce matches the rendered HTML nonce on every response.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: csp_policy_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditCspPolicy(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`csp_policy_audit: ${e.message}\n`);
    process.exit(1);
  }
}
