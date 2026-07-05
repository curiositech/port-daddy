#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_COPY_ORDERS = ['manifest-first', 'source-first'];
const VALID_SECRETS = ['secret-mount', 'build-arg', 'env', 'runtime-injection', 'none-needed'];
const VALID_USERS = ['nonroot', 'numeric-uid', 'root'];
const VALID_LANGUAGES = ['node', 'python', 'go', 'rust', 'jvm', 'other'];
const VALID_ARM64_BUILDERS = ['native', 'qemu', 'none'];
const COMPILED_LANGUAGES = ['go', 'rust', 'jvm'];
// Size gates from this skill's Quality Gates: <=300MB Node/Python, <=100MB Go/Rust.
const SIZE_LIMIT_MB = { node: 300, python: 300, jvm: 400, go: 100, rust: 100, other: 500 };

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a Docker build plan against dockerfile-build-cache-mastery's thesis —
 * speed comes from invalidating as few layers as possible — and its Quality
 * Gates. Rules operate on structured enum/boolean/number fields only.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/docker-build-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditDockerBuildPlan(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (typeof plan.buildkitEnabled !== 'boolean') {
    throw new TypeError('plan.buildkitEnabled must be a boolean');
  }
  if (!VALID_COPY_ORDERS.includes(plan.copyOrder)) {
    throw new TypeError(`plan.copyOrder must be one of: ${VALID_COPY_ORDERS.join(', ')}`);
  }
  if (!VALID_LANGUAGES.includes(plan.runtimeLanguage)) {
    throw new TypeError(`plan.runtimeLanguage must be one of: ${VALID_LANGUAGES.join(', ')}`);
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

  // --- Gate: BuildKit on — nothing else in this skill works without it ---
  if (plan.buildkitEnabled !== true) {
    fail(
      'buildkit-disabled',
      'critical',
      'buildkitEnabled is false: without BuildKit there are no cache mounts, secret mounts, or parallel stages — none of the rest of this plan can work.',
      'Set DOCKER_BUILDKIT=1 (or use docker buildx); Docker 23+ defaults to BuildKit.'
    );
  }

  // --- Gate: manifest-first COPY ordering (the #1 cache killer) ---
  if (plan.copyOrder === 'source-first') {
    fail(
      'copy-source-before-deps',
      'high',
      "copyOrder is 'source-first': COPY . . before the install step invalidates the dependency layer on every code change — the classic slow-build cause.",
      'Copy the lockfile/manifest first, run the install, then COPY the source (manifest -> install -> source -> build).'
    );
  }

  // --- Gate: cache mount on the package-manager directory ---
  if (plan.cacheMountForPackageManager !== true) {
    fail(
      'no-package-manager-cache-mount',
      'medium',
      'cacheMountForPackageManager is not true: every build re-downloads packages even when the lockfile is unchanged.',
      'Add RUN --mount=type=cache,target=<pm-cache-dir>,sharing=locked to the install step (e.g. /root/.npm, the pnpm store, /root/.cache/go-build).'
    );
  }

  // --- Gate: multi-stage separates build deps from runtime ---
  if (plan.multiStage !== true) {
    fail(
      'single-stage-build',
      'high',
      'multiStage is not true: build tools, dev dependencies, and source ship to production in the final image.',
      'Split into build stage(s) plus a slim runtime stage (distroless for Node/Python, scratch/static for Go/Rust).'
    );
  }

  // --- Gate: final image within the size budget for its stack ---
  if (typeof plan.finalImageSizeMB === 'number') {
    const limit = SIZE_LIMIT_MB[plan.runtimeLanguage] ?? 500;
    if (plan.finalImageSizeMB > limit) {
      fail(
        'final-image-over-budget',
        'medium',
        `finalImageSizeMB is ${plan.finalImageSizeMB} for a ${plan.runtimeLanguage} app; the gate is <= ${limit}MB.`,
        'Inspect the final stage for build tools/dev deps, switch to a distroless or scratch runtime base, and check .dockerignore.'
      );
    }
  }

  // --- Gate: .dockerignore present ---
  if (plan.dockerignorePresent !== true) {
    fail(
      'missing-dockerignore',
      'high',
      'dockerignorePresent is not true: COPY . . ships node_modules, .git, and .env files into the build context and layer cache.',
      'Add a .dockerignore excluding node_modules, .git, dist, *.log, and .env before anything else.'
    );
  }

  // --- Gate: cold CI builds pull a registry cache ---
  if (plan.ciColdBuilds === true && plan.registryCacheConfigured !== true) {
    fail(
      'cold-ci-without-registry-cache',
      'medium',
      'ciColdBuilds is true but registryCacheConfigured is not: cold runners rebuild everything — the 10-min-vs-1-min difference.',
      'Add --cache-to type=registry,ref=<repo>:cache,mode=max and a matching --cache-from to the CI build.'
    );
  }

  // --- Gate: secrets never in ARG/ENV ---
  if (plan.secretsHandling !== undefined) {
    if (!VALID_SECRETS.includes(plan.secretsHandling)) {
      fail(
        'invalid-secrets-handling',
        'medium',
        `secretsHandling "${plan.secretsHandling}" is not one of: ${VALID_SECRETS.join(', ')}.`,
        'Name how build-time credentials reach the build so the ARG/ENV leak rule can be checked.'
      );
    } else if (plan.secretsHandling === 'build-arg' || plan.secretsHandling === 'env') {
      fail(
        'secret-in-arg-or-env',
        'critical',
        `secretsHandling is '${plan.secretsHandling}': ARG and ENV values persist in image metadata and are readable via docker history.`,
        'Use RUN --mount=type=secret for build-time credentials, or inject at runtime; never ARG/ENV a secret.'
      );
    }
  }

  // --- Gate: runtime stage runs as nonroot ---
  if (plan.runtimeUser !== undefined) {
    if (!VALID_USERS.includes(plan.runtimeUser)) {
      fail(
        'invalid-runtime-user',
        'low',
        `runtimeUser "${plan.runtimeUser}" is not one of: ${VALID_USERS.join(', ')}.`,
        'State the runtime USER so the nonroot gate can be checked.'
      );
    } else if (plan.runtimeUser === 'root') {
      fail(
        'runtime-runs-as-root',
        'high',
        "runtimeUser is 'root': the production container runs with root in its namespace, failing the USER nonroot quality gate.",
        'Set USER nonroot (or a numeric UID) in the runtime stage.'
      );
    }
  }

  // --- Gate: --no-cache is not the CI default ---
  if (plan.noCacheFlagInCI === true) {
    fail(
      'no-cache-default-in-ci',
      'medium',
      'noCacheFlagInCI is true: someone added --no-cache to fix one flake and every build has been cold since.',
      "Cache by default; reserve --no-cache for an explicit 'rebuild from scratch' job."
    );
  }

  // --- Gate: compiled-language arm64 builds should not rely on QEMU ---
  if (plan.targetsArm64 === true) {
    if (!VALID_ARM64_BUILDERS.includes(plan.arm64Builder)) {
      fail(
        'arm64-builder-unspecified',
        'low',
        `targetsArm64 is true but arm64Builder is not one of: ${VALID_ARM64_BUILDERS.join(', ')}.`,
        'Name the arm64 build path (native or qemu) so the emulation-speed rule can be checked.'
      );
    } else if (plan.arm64Builder === 'qemu' && COMPILED_LANGUAGES.includes(plan.runtimeLanguage)) {
      fail(
        'qemu-for-compiled-arm64',
        'medium',
        `arm64Builder is 'qemu' for a ${plan.runtimeLanguage} build: emulation is 5-10x slower for compiled languages.`,
        'Use a native arm64 builder (Docker Build Cloud or a self-hosted arm64 runner) for compiled targets.'
      );
    }
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Plan clears every quality gate this skill checks. Still verify with --progress=plain that a no-op rebuild hits cache on every layer and completes in <= 30 seconds.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: docker_build_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditDockerBuildPlan(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`docker_build_audit: ${e.message}\n`);
    process.exit(1);
  }
}
