#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const THREAT_CLASSES = ['ssrf', 'path-traversal', 'secret-exfil', 'resource-exhaustion', 'side-effect-write'];
const ISOLATION_DIMENSIONS = ['filesystem', 'network', 'process', 'secrets', 'resources'];

function list(value) {
  return Array.isArray(value) ? value : [];
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

/**
 * Statically audits a sandboxed-adversarial-test-harness spec: does its coverage,
 * egress/path policy shape, secret handling, and fail-mode choices actually prove
 * containment, or do they just look like a test suite?
 *
 * This does not execute the adversarial cases against a live sandbox — it audits
 * whether the *design* of the harness spec can, even in principle, prove
 * containment. A spec that passes here is safe to wire into a real execution
 * harness and gate deployment on.
 *
 * @param {object} spec - parsed harness-spec.schema.json document
 * @returns {{
 *   pass: boolean,
 *   coverageByThreatClass: Record<string, {total:number, containedAssertions:number, containmentRate:number}>,
 *   findings: string[],
 *   recommendations: string[]
 * }}
 */
export function auditContainment(spec) {
  requireObject(spec, 'spec');
  requireString(spec.name, 'spec.name');

  const isolationDimensions = list(spec.isolationDimensions);
  if (isolationDimensions.length === 0) {
    throw new Error('spec.isolationDimensions must list at least one dimension');
  }

  const egressPolicy = requireObject(spec.egressPolicy, 'spec.egressPolicy');
  requireString(egressPolicy.mode, 'spec.egressPolicy.mode');
  requireString(egressPolicy.default, 'spec.egressPolicy.default');

  const pathPolicy = requireObject(spec.pathPolicy, 'spec.pathPolicy');
  requireString(pathPolicy.mode, 'spec.pathPolicy.mode');
  requireString(pathPolicy.jailRoot, 'spec.pathPolicy.jailRoot');

  const secretHandling = requireObject(spec.secretHandling, 'spec.secretHandling');
  requireString(secretHandling.mode, 'spec.secretHandling.mode');
  if (typeof secretHandling.exposedToSandbox !== 'boolean') {
    throw new Error('spec.secretHandling.exposedToSandbox must be a boolean');
  }

  const adversarialCases = list(spec.adversarialCases);
  if (adversarialCases.length === 0) {
    throw new Error('spec.adversarialCases must include at least one case');
  }
  const normalizedCases = adversarialCases.map((rawCase, index) => {
    const entry = requireObject(rawCase, `spec.adversarialCases[${index}]`);
    requireString(entry.id, `spec.adversarialCases[${index}].id`);
    requireString(entry.invariant, `spec.adversarialCases[${index}].invariant`);
    requireString(entry.threatClass, `spec.adversarialCases[${index}].threatClass`);
    requireString(entry.expected, `spec.adversarialCases[${index}].expected`);
    requireString(entry.failMode, `spec.adversarialCases[${index}].failMode`);
    return entry;
  });

  const failMode = requireString(spec.failMode, 'spec.failMode');

  const findings = [];
  const recommendations = [];

  // Coverage per threat class — the critical computation. A harness that never
  // even attempts a given attack cannot claim to contain it, no matter how green
  // the rest of the suite is.
  const coverageByThreatClass = {};
  for (const threatClass of THREAT_CLASSES) {
    const casesForClass = normalizedCases.filter((c) => c.threatClass === threatClass);
    const containedAssertions = casesForClass.filter((c) => c.expected === 'contained').length;
    coverageByThreatClass[threatClass] = {
      total: casesForClass.length,
      containedAssertions,
      containmentRate: casesForClass.length === 0 ? 0 : containedAssertions / casesForClass.length,
    };
    if (casesForClass.length === 0) {
      findings.push(`No adversarial case exercises threat class '${threatClass}'. Coverage cannot be claimed for it.`);
      recommendations.push(`Add at least one adversarial case with threatClass '${threatClass}' before gating deployment on this harness.`);
    }
  }

  // Unknown threat classes referenced by cases (typo/drift guard).
  const unknownThreatClasses = [...new Set(normalizedCases.map((c) => c.threatClass))].filter(
    (tc) => !THREAT_CLASSES.includes(tc),
  );
  for (const unknown of unknownThreatClasses) {
    findings.push(`Adversarial case references unrecognized threatClass '${unknown}'. It will not count toward coverage.`);
    recommendations.push(`Rename '${unknown}' to one of: ${THREAT_CLASSES.join(', ')}, or extend the taxonomy deliberately.`);
  }

  // Isolation dimensions the spec claims but does not actually name.
  const missingDimensions = ISOLATION_DIMENSIONS.filter((d) => !isolationDimensions.includes(d));
  for (const dimension of missingDimensions) {
    findings.push(`Isolation dimension '${dimension}' is not covered by this spec.`);
    recommendations.push(`Decide explicitly whether '${dimension}' isolation is in scope; if it is, name it and add a case.`);
  }

  // Denylist-based policies: catastrophic recall by construction (repo rule: no
  // keyword/denylist NLP-style approaches; the same logic applies to egress/path
  // filtering — you cannot enumerate every bad host or bad path in advance).
  if (egressPolicy.mode === 'denylist') {
    findings.push("egressPolicy.mode is 'denylist'. Denylisted egress hosts/IPs have catastrophic recall — obfuscated IP literals, DNS rebinding, and redirects all evade a blocklist.");
    recommendations.push("Switch egressPolicy.mode to 'allowlist' with an explicit exact-host allowlist; classify IPv4/IPv6 literal forms (dotted/octal/hex/mapped) rather than string-matching known-bad hosts.");
  }
  if (pathPolicy.mode === 'denylist') {
    findings.push("pathPolicy.mode is 'denylist'. Denylisted path patterns (e.g. '../', '/etc/') are trivially evaded by symlinks, absolute paths, and encoding tricks.");
    recommendations.push('Switch pathPolicy.mode to \'allowlist\' — canonicalize (realpath) both the target and the jail root, then assert containment by prefix, not by pattern-matching the raw path string.');
  }

  // Default-allow egress is fail-open by definition.
  if (egressPolicy.default === 'allow') {
    findings.push("egressPolicy.default is 'allow'. Any host not explicitly denied is reachable, including newly-provisioned metadata/internal endpoints the policy predates.");
    recommendations.push("Set egressPolicy.default to 'deny' and enumerate the allowed hosts explicitly.");
  }

  // Fail-open anywhere is disqualifying: ambiguity must resolve to deny.
  if (failMode === 'fail-open') {
    findings.push("spec.failMode is 'fail-open'. When containment cannot be proven for an input, this harness lets the action through.");
    recommendations.push("Set spec.failMode to 'fail-closed'. An unrecognized trigger kind, malformed URL, or unresolvable symlink must default to deny, not allow.");
  }
  const failOpenCases = normalizedCases.filter((c) => c.failMode === 'fail-open');
  for (const failOpenCase of failOpenCases) {
    findings.push(`Adversarial case '${failOpenCase.id}' (${failOpenCase.threatClass}) declares failMode 'fail-open'.`);
    recommendations.push(`Change case '${failOpenCase.id}' to failMode 'fail-closed', or document it as an accepted residual risk outside this harness.`);
  }

  // A case whose own expectation is not containment defeats the point of the harness.
  const nonContainedExpectations = normalizedCases.filter((c) => c.expected !== 'contained');
  for (const escapedCase of nonContainedExpectations) {
    findings.push(`Adversarial case '${escapedCase.id}' does not assert 'contained' (found '${escapedCase.expected}').`);
    recommendations.push(`Rewrite case '${escapedCase.id}' to assert containment, or move it out of adversarialCases into a documented residual-risk section.`);
  }

  // Secrets: real credentials exposed to code under adversarial test is a live
  // exfiltration risk regardless of how the rest of the harness scores.
  if (secretHandling.mode === 'real' && secretHandling.exposedToSandbox === true) {
    findings.push('secretHandling.mode is \'real\' and exposedToSandbox is true. Untrusted/adversarial code under test has a path to genuine credentials.');
    recommendations.push("Use secretHandling.mode 'fake-credentials' (canary values with no real capability) for anything the adversary's code path can reach.");
  }
  if (secretHandling.mode === 'none' && isolationDimensions.includes('secrets')) {
    findings.push("isolationDimensions claims 'secrets' coverage but secretHandling.mode is 'none' — there is nothing to contain or verify.");
    recommendations.push("Either add fake-credentials/redacted secret handling, or remove 'secrets' from isolationDimensions until it is implemented.");
  }

  const pass = findings.length === 0;

  return {
    pass,
    coverageByThreatClass,
    findings,
    recommendations,
  };
}

function parseArgs(argv) {
  const inputIndex = argv.indexOf('--input');
  if (inputIndex === -1 || !argv[inputIndex + 1]) {
    throw new Error('usage: containment_audit.mjs --input harness-spec.json');
  }
  return { input: argv[inputIndex + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const spec = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditContainment(spec), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`containment_audit: ${error.message}\n`);
    process.exit(1);
  }
}
