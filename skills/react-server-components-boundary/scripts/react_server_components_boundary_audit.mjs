#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_ROLES = ['layout', 'page', 'provider', 'interactive-leaf', 'wrapper', 'shared-util'];
const SERIALIZABLE_PROP_KINDS = [
  'primitive',
  'plain-object',
  'iterable',
  'date',
  'jsx',
  'promise',
  'server-function',
  'registered-symbol',
];
const NON_SERIALIZABLE_PROP_KINDS = [
  'function',
  'class-instance',
  'null-prototype-object',
  'unregistered-symbol',
];
const VALID_PROP_KINDS = [...SERIALIZABLE_PROP_KINDS, ...NON_SERIALIZABLE_PROP_KINDS];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit an RSC boundary decision against react-server-components-boundary's
 * rules: 'use client' is a module-dependency boundary, so mark the smallest
 * leaf; compose Server children through the slot pattern; only serializable
 * prop kinds cross; and harden the seam with server-only/client-only.
 *
 * @param {unknown} plan - parsed JSON, see schemas/react-server-components-boundary-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditReactServerComponentsBoundary(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_ROLES.includes(plan.componentRole)) {
    throw new TypeError(`plan.componentRole must be one of: ${VALID_ROLES.join(', ')}`);
  }
  if (typeof plan.usesHooksOrBrowserApis !== 'boolean') {
    throw new TypeError('plan.usesHooksOrBrowserApis must be a boolean');
  }
  if (typeof plan.markedUseClient !== 'boolean') {
    throw new TypeError('plan.markedUseClient must be a boolean');
  }
  if (plan.crossingProps !== undefined) {
    if (!Array.isArray(plan.crossingProps)) throw new TypeError('plan.crossingProps must be an array');
    for (const kind of plan.crossingProps) {
      if (!VALID_PROP_KINDS.includes(kind)) {
        throw new TypeError(`crossingProps entry "${kind}" must be one of: ${VALID_PROP_KINDS.join(', ')}`);
      }
    }
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

  // Gate 1: hooks/browser APIs demand a client module.
  if (plan.usesHooksOrBrowserApis === true && plan.markedUseClient !== true) {
    fail(
      'hooks-without-use-client',
      'critical',
      'usesHooksOrBrowserApis is true but markedUseClient is not: hooks/event handlers/browser APIs in a Server Component are the "useState only works in Client Components" runtime error.',
      "Mark the component (or a smaller extracted leaf) with 'use client'."
    );
  }

  // Gate 2: 'use client' on a non-interactive component is pure creep.
  if (plan.usesHooksOrBrowserApis !== true && plan.markedUseClient === true) {
    fail(
      'use-client-without-need',
      'high',
      "markedUseClient is true but the component uses no hooks or browser APIs: every transitive import now ships to the browser for nothing.",
      "Remove 'use client' and leave it a Server Component — a component has no inherent identity until imported across the boundary."
    );
  }

  // Gate 3: leaf-pushing — layouts/pages should not be the boundary if the interactive bit extracts.
  if (
    plan.markedUseClient === true &&
    (plan.componentRole === 'layout' || plan.componentRole === 'page') &&
    plan.interactiveBitExtractable === true
  ) {
    fail(
      'boundary-not-leaf-pushed',
      'high',
      `'use client' sits on a ${plan.componentRole} whose interactive bit is extractable: the whole subtree (and its imports) becomes client code — the bundle-explosion anti-pattern.`,
      "Extract the interactive piece into its own leaf Client Component and promote the layout/page back to Server."
    );
  }

  // Gate 4: Server children inside a Client parent need the slot pattern.
  if (plan.serverChildrenNeeded === true && plan.markedUseClient === true && plan.usesChildrenSlot !== true) {
    fail(
      'server-children-without-slot',
      'high',
      'serverChildrenNeeded is true but the Client component does not take them via a children slot: importing them directly drags server code across the module boundary.',
      'Pass Server Components as children (JSX props) from a Server parent; keep the Client wrapper a pure UI shell.'
    );
  }

  // Gate 5: only serializable prop kinds may cross.
  if (Array.isArray(plan.crossingProps)) {
    for (const kind of plan.crossingProps) {
      if (NON_SERIALIZABLE_PROP_KINDS.includes(kind)) {
        fail(
          'non-serializable-prop-crossing',
          'critical',
          `crossingProps include "${kind}": regular functions, class instances, null-prototype objects, and unregistered symbols cannot cross the Server->Client boundary.`,
          "Convert callbacks to Server Functions ('use server'), and strip class instances to plain objects before they cross."
        );
      }
    }
  }

  // Gate 6: environment poisoning — data layer / secrets in a client module.
  if (plan.markedUseClient === true && plan.importsServerOnlyModules === true) {
    fail(
      'server-module-in-client-bundle',
      'critical',
      "markedUseClient is true and importsServerOnlyModules is true: DB clients / secret-reading utils imported into a client module ship (with empty env vars) to the browser and silently 401.",
      'Move data fetching to a Server parent and pass plain props; the client module must not import the data layer.'
    );
  }

  // Gate 7: shared server-only utils must be guarded.
  if (plan.importsServerOnlyModules === true && plan.serverOnlyGuardUsed !== true) {
    fail(
      'missing-server-only-guard',
      'high',
      "A server-only module is in the dependency graph but serverOnlyGuardUsed is not true: nothing stops a future client import from poisoning the environment silently.",
      "Add import 'server-only' to secret-touching utils (and 'client-only' to window-touching ones) so a bad import becomes a build error."
    );
  }

  // Gate 8: providers wrap children, never <html>.
  if (plan.componentRole === 'provider' && plan.providerWrapsHtml === true) {
    fail(
      'provider-wraps-html',
      'high',
      'providerWrapsHtml is true: a context provider around the whole <html> document blocks static optimization of everything above it.',
      'Render the provider as deep as possible — wrap {children} inside <body>, not the document.'
    );
  }

  // Gate 9: third-party hook libraries need a wrapper.
  if (plan.usesThirdPartyHookLib === true && plan.thirdPartyHookLibWrapped !== true && plan.markedUseClient !== true) {
    fail(
      'unwrapped-third-party-hook-lib',
      'high',
      "usesThirdPartyHookLib is true without a wrapper and without 'use client': importing a hook-using lib that ships no directive into a Server Component throws at build/render.",
      "Create a one-line 'use client' wrapper file that re-exports the third-party component."
    );
  }

  // Gate 10: the timeline test — measure the bundle before and after.
  if (plan.bundleSizeChecked !== true) {
    fail(
      'bundle-size-unchecked',
      'medium',
      'bundleSizeChecked is not true: without diffing the next build route table before and after, a 100KB client-bundle regression ships unnoticed.',
      'Run next build before and after the change and diff the First Load JS column for affected routes.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      "Boundary decision clears every quality gate this skill checks. Still confirm non-interactive routes report 0 KB First Load JS in the next build route table."
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: react_server_components_boundary_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditReactServerComponentsBoundary(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`react_server_components_boundary_audit: ${e.message}\n`);
    process.exit(1);
  }
}
