#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_TARGETS = ['workers', 'pages'];
const VALID_AUTH = ['oauth', 'api-token', 'global-api-key'];
const VALID_SECRET_METHODS = ['file-redirect', 'printf-pipe', 'cat-pipe', 'dashboard'];
const VALID_SAMESITE = ['strict', 'lax', 'none'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a Cloudflare Workers/Pages deploy plan against
 * cloudflare-workers-debugging's failure catalog and Quality Gates.
 *
 * @param {unknown} plan - parsed JSON deploy plan, see schemas/cloudflare-workers-debug-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditWorkersDebugging(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a JSON object (not null, not an array)');
  }
  if (!VALID_TARGETS.includes(plan.deployTarget)) {
    throw new TypeError(`plan.deployTarget must be one of: ${VALID_TARGETS.join(', ')}`);
  }
  if (!VALID_AUTH.includes(plan.authMethod)) {
    throw new TypeError(`plan.authMethod must be one of: ${VALID_AUTH.join(', ')}`);
  }
  if (plan.secretUploadMethod !== undefined && !VALID_SECRET_METHODS.includes(plan.secretUploadMethod)) {
    throw new TypeError(`plan.secretUploadMethod must be one of: ${VALID_SECRET_METHODS.join(', ')}`);
  }
  if (plan.sessionCookieSameSite !== undefined && !VALID_SAMESITE.includes(plan.sessionCookieSameSite)) {
    throw new TypeError(`plan.sessionCookieSameSite must be one of: ${VALID_SAMESITE.join(', ')}`);
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

  // --- Rule 1: legacy global API key ---
  if (plan.authMethod === 'global-api-key') {
    fail(
      'legacy-global-api-key',
      'high',
      'authMethod is "global-api-key": the legacy key is all-powerful and unscoped; a leak compromises the whole account.',
      'Mint a scoped API token (Workers Scripts:Edit, D1:Edit, etc.) and set CLOUDFLARE_API_TOKEN; never CLOUDFLARE_API_KEY.'
    );
  }

  // --- Rule 2: OAuth is for humans, tokens are for CI ---
  if (plan.ciDeploy === true && plan.authMethod === 'oauth') {
    fail(
      'oauth-in-ci',
      'high',
      'ciDeploy is true with authMethod "oauth": OAuth tokens are interactive-login artifacts; in CI they expire, miss scopes, and cannot be re-consented.',
      'Use a CLOUDFLARE_API_TOKEN minted with exactly the scopes CI needs.'
    );
  }

  // --- Rule 3: the empty-secret trap (aliased cat) ---
  if (plan.secretUploadMethod === 'cat-pipe') {
    fail(
      'secret-via-cat-pipe',
      'high',
      'secretUploadMethod is "cat-pipe": if cat is aliased (e.g. to bat), the pipe delivers zero bytes and wrangler silently stores an empty string.',
      'Use "wrangler secret put NAME < file" or printf \'%s\' "$VAR" | wrangler secret put NAME.'
    );
  }

  // --- Rule 4: secrets must be length-verified after upload ---
  if (plan.secretsVerifiedPostUpload !== true) {
    fail(
      'secrets-not-verified',
      'high',
      'secretsVerifiedPostUpload is not true: "wrangler secret list" shows the NAME even when the VALUE is empty — only a runtime length check catches the empty-secret trap.',
      'Verify each secret post-upload with a temporary length-check endpoint or smoke test; expect len > 0.'
    );
  }

  // --- Rule 5: D1 without --remote hits the local sqlite ---
  if (plan.usesD1 === true && plan.d1MigrationsRemote !== true) {
    fail(
      'd1-migrations-not-remote',
      'high',
      'usesD1 is true but d1MigrationsRemote is not: without --remote, migrations apply to .wrangler/state/v3/d1/ and the production database never changes.',
      'Run wrangler d1 migrations apply <db> --remote, and reconcile local + remote schemas before deploy.'
    );
  }

  // --- Rule 6: OAuth scopes rot when products are added ---
  if (plan.usesD1 === true && plan.authMethod === 'oauth' && plan.oauthScopesRefreshedForNewProducts !== true) {
    fail(
      'stale-oauth-scopes',
      'medium',
      'usesD1 with OAuth but oauthScopesRefreshedForNewProducts is not true: scopes granted at first login predate D1; d1 commands will fail with "Authentication error" while whoami works.',
      'wrangler logout && wrangler login, consenting to the newly listed scopes.'
    );
  }

  // --- Rule 7: observability on everywhere ---
  if (plan.observabilityEnabled !== true) {
    fail(
      'observability-disabled',
      'medium',
      'observabilityEnabled is not true: without [observability] enabled = true, the dashboard logs view is crippled and wrangler tail is your only window.',
      'Set [observability] enabled = true in every environment; the cost is negligible.'
    );
  }

  // --- Rule 8: compatibility_date freshness ---
  if (typeof plan.compatibilityDateAgeDays === 'number' && plan.compatibilityDateAgeDays > 90) {
    fail(
      'compatibility-date-stale',
      'medium',
      `compatibilityDateAgeDays is ${plan.compatibilityDateAgeDays}: old compat dates pin old runtimes, so code that works locally fails in production (URLPattern/EventSource undefined).`,
      'Bump compatibility_date to within the last 90 days; add compatibility_flags only for specific opt-ins.'
    );
  }

  // --- Rule 9: rename + custom domain = stale assignment ---
  if (plan.customDomain === true && plan.workerRenamed === true && plan.staleDomainAssignmentCleared !== true) {
    fail(
      'stale-custom-domain-assignment',
      'critical',
      'workerRenamed is true with a custom domain but staleDomainAssignmentCleared is not: the domain assignment does not migrate on rename, so the route keeps hitting the old worker (or 522s).',
      'Dashboard -> Workers & Pages -> Triggers: delete the old domain assignment, then redeploy so the new worker re-creates it.'
    );
  }

  // --- Rule 10: bindings must be loud at startup ---
  if (plan.bindingsEnumeratedAtStartup !== true) {
    fail(
      'bindings-not-enumerated',
      'medium',
      'bindingsEnumeratedAtStartup is not true: wrangler.toml is hopeful, the deploy is the truth — a binding missing from the artifact fails silently at first use.',
      'Log Object.keys(env) at startup and fail loudly when an expected binding is absent.'
    );
  }

  // --- Rule 11: SameSite=Strict drops cookies on the login redirect ---
  if (plan.cookieSetOnRedirect === true && plan.sessionCookieSameSite === 'strict') {
    fail(
      'strict-cookie-on-redirect',
      'high',
      'cookieSetOnRedirect is true with sessionCookieSameSite "strict": the browser drops the cookie on the immediate navigation, so the post-login page sees no session.',
      'Use SameSite=Lax for session cookies that must ride a top-level redirect; reserve Strict for cookies that never accompany cross-origin navigation.'
    );
  }

  // --- Rule 12: Pages previews need their own project/branch ---
  if (plan.deployTarget === 'pages' && plan.pagesPreviewProjectIsolated !== true) {
    fail(
      'pages-preview-not-isolated',
      'medium',
      'deployTarget is "pages" but pagesPreviewProjectIsolated is not true: manual preview deploys and git-push production deploys writing to the same project clobber each other.',
      'Deploy previews with a distinct --project or --branch so production pushes cannot overwrite them.'
    );
  }

  // --- Rule 13: CPU-limit errors tracked ---
  if (plan.cpuLimitMonitored !== true) {
    fail(
      'cpu-limit-not-monitored',
      'low',
      'cpuLimitMonitored is not true: 1102 (CPU exceeded) errors creep in with payload growth; untracked, the first signal is a user report.',
      'Track 1101/1102 counts over time and alert on trend, not just occurrence.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Plan clears every quality gate this skill checks. Still confirm live behavior changed after deploy — a green wrangler exit code is not proof the route serves the new code.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: workers_debugging_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditWorkersDebugging(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`workers_debugging_audit: ${e.message}\n`);
    process.exit(1);
  }
}
