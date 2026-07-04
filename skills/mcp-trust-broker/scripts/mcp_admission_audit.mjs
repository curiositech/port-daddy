#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROVENANCE_VALUES = ['signed', 'unsigned', 'unknown'];
const PERMISSION_SCOPE_VALUES = ['least-privilege', 'broad', 'undeclared'];
const SMOKE_TEST_VALUES = ['passed', 'failed', 'not-run'];
const TEAM_POLICY_VALUES = ['allow', 'approve', 'block', 'none'];

const SEVERITY_WEIGHT = { critical: 30, high: 15, medium: 7, low: 3 };

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

function requireBoolean(value, name) {
  if (typeof value !== 'boolean') {
    throw new Error(`${name} must be a boolean`);
  }
  return value;
}

function requireEnum(value, name, allowed) {
  const str = requireString(value, name);
  if (!allowed.includes(str)) {
    throw new Error(`${name} must be one of: ${allowed.join(', ')} (got '${str}')`);
  }
  return str;
}

/**
 * Audits an MCP server admission request against the MCP minimum contract
 * (manifest, provenance, permission label, health check, disable/repair/
 * uninstall, usage trace) and the quarantine-exit gate.
 *
 * This is a static admission audit, not a live sandbox run — it audits
 * whether the *evidence on file* (signed+verified provenance, a passed
 * sandbox smoke test, a declared least-privilege scope, daemon-routed
 * writes) is sufficient to let a quarantined MCP server run for real. A
 * spec that passes here is safe to let exit quarantine.
 *
 * FAIL CLOSED: an absent or unrecognized signal is never treated as safe.
 * The safe condition is always proven positively — signed AND verified AND
 * a passed smoke test AND least-privilege scope AND daemon-routed writes —
 * never inferred from the absence of an explicit failure.
 *
 * @param {object} spec - parsed mcp-admission-request.schema.json document
 * @returns {{
 *   pass: boolean,
 *   score: number,
 *   findings: Array<{severity: 'critical'|'high'|'medium'|'low', id: string, message: string}>,
 *   recommendations: string[]
 * }}
 */
export function auditMcpAdmission(spec) {
  requireObject(spec, 'spec');

  const server = requireObject(spec.server, 'spec.server');
  requireString(server.name, 'spec.server.name');
  const manifestPresent = requireBoolean(server.manifestPresent, 'spec.server.manifestPresent');
  const provenance = requireEnum(server.provenance, 'spec.server.provenance', PROVENANCE_VALUES);
  const signatureVerified = requireBoolean(server.signatureVerified, 'spec.server.signatureVerified');
  const permissionScope = requireEnum(server.permissionScope, 'spec.server.permissionScope', PERMISSION_SCOPE_VALUES);
  const sandboxSmokeTest = requireEnum(server.sandboxSmokeTest, 'spec.server.sandboxSmokeTest', SMOKE_TEST_VALUES);
  const healthCheck = requireBoolean(server.healthCheck, 'spec.server.healthCheck');
  const hasDisableRepairUninstall = requireBoolean(server.hasDisableRepairUninstall, 'spec.server.hasDisableRepairUninstall');
  const usageTrace = requireBoolean(server.usageTrace, 'spec.server.usageTrace');

  const quarantine = requireObject(spec.quarantine, 'spec.quarantine');
  const exitRequested = requireBoolean(quarantine.exitRequested, 'spec.quarantine.exitRequested');

  const teamPolicy = requireEnum(spec.teamPolicy, 'spec.teamPolicy', TEAM_POLICY_VALUES);
  const writeToolsRouteThroughDaemonPolicy = requireBoolean(
    spec.writeToolsRouteThroughDaemonPolicy,
    'spec.writeToolsRouteThroughDaemonPolicy',
  );

  const findings = [];
  const recommendations = [];

  function add(severity, id, message, recommendation) {
    findings.push({ severity, id, message });
    recommendations.push(recommendation);
  }

  const provenanceProven = provenance === 'signed' && signatureVerified === true;

  // --- Unconditional minimum-contract checks (apply regardless of quarantine state) ---

  if (!manifestPresent) {
    add(
      'critical',
      'no-manifest',
      `Server '${server.name}' has no manifest on file. The MCP minimum contract starts with a manifest; nothing downstream (provenance, permission label, health check) can be trusted without one.`,
      `Require ${server.name} to publish a manifest before any further admission review proceeds.`,
    );
  }

  if (provenance === 'signed' && signatureVerified !== true) {
    add(
      'high',
      'signature-unverified',
      `Server '${server.name}' claims signed provenance but the signature has not been verified.`,
      `Run signature verification against ${server.name}'s published key before treating provenance as proven.`,
    );
  }

  if (provenance === 'unknown') {
    add(
      'high',
      'provenance-unknown',
      `Server '${server.name}' has unknown provenance — origin and publisher cannot be established at all.`,
      `Trace ${server.name} to a concrete source (registry entry, package, repo) and classify it as signed or unsigned before continuing review.`,
    );
  }

  if (sandboxSmokeTest === 'failed') {
    add(
      'high',
      'sandbox-smoke-test-failed',
      `Server '${server.name}' failed its sandbox smoke test.`,
      `Investigate and fix the smoke-test failure, then re-run it; a failed smoke test is not resolved by re-requesting quarantine exit.`,
    );
  }

  if (!healthCheck) {
    add(
      'high',
      'no-health-check',
      `Server '${server.name}' has no runtime health check wired up.`,
      `Wire ${server.name} into 'pd doctor' (or the equivalent runtime health probe) before admitting it.`,
    );
  }

  if (!hasDisableRepairUninstall) {
    add(
      'high',
      'no-lifecycle-controls',
      `Server '${server.name}' is missing disable/repair/uninstall lifecycle controls.`,
      `Add disable/repair/uninstall affordances for ${server.name} — the minimum MCP contract requires all three.`,
    );
  }

  if (!usageTrace) {
    add(
      'medium',
      'no-usage-trace',
      `Server '${server.name}' does not emit a usage trace.`,
      `Wire ${server.name}'s invocations into the usage/failure trace so admins can see call volume and failures, not just install state.`,
    );
  }

  if (teamPolicy === 'none') {
    add(
      'high',
      'no-team-admission-policy',
      `No team admission policy (allow/approve/block) is set for '${server.name}'.`,
      `Set an explicit teamPolicy for ${server.name} — 'none' leaves admission ungoverned.`,
    );
  }

  if (writeToolsRouteThroughDaemonPolicy !== true) {
    add(
      'critical',
      'write-tool-bypasses-daemon-policy',
      `Server '${server.name}' has write tools that do not route through daemon policy.`,
      `Route every write-capable tool ${server.name} exposes through daemon policy before it is admitted at any scope.`,
    );
  }

  // --- Pending-review signals: not blocking on their own while still quarantined,
  //     but tracked so they are not silently forgotten. ---

  if (!exitRequested) {
    if (permissionScope === 'undeclared') {
      add(
        'medium',
        'undeclared-permission-scope',
        `Server '${server.name}' has not yet declared a permission scope.`,
        `Require ${server.name} to declare a permission scope (least-privilege preferred) before quarantine exit is requested.`,
      );
    } else if (permissionScope === 'broad') {
      add(
        'medium',
        'broad-permission-scope',
        `Server '${server.name}' declares a broad (non-least-privilege) permission scope.`,
        `Push ${server.name}'s publisher to scope down to least-privilege, or document why broad access is unavoidable, before quarantine exit.`,
      );
    }

    if (sandboxSmokeTest === 'not-run') {
      add(
        'medium',
        'sandbox-smoke-test-not-run',
        `Server '${server.name}' has not yet had a sandbox smoke test run.`,
        `Run the sandbox smoke test for ${server.name} before quarantine exit is requested.`,
      );
    }
  }

  // --- The quarantine-exit gate: fail closed. Exit is safe only when every one
  //     of these is positively proven, never merely "not explicitly failing". ---

  if (exitRequested) {
    if (teamPolicy === 'block') {
      add(
        'critical',
        'team-policy-blocks-exit',
        `Quarantine exit was requested for '${server.name}' but team policy is 'block'.`,
        `Do not exit quarantine while team policy is 'block'; escalate for an explicit policy change first, do not route around it.`,
      );
    }

    if (!provenanceProven) {
      add(
        'critical',
        'quarantine-exit-without-provenance',
        `Quarantine exit was requested for '${server.name}' without proven provenance (signed AND signature-verified).`,
        `Do not exit quarantine until ${server.name}'s provenance is 'signed' and signatureVerified is true.`,
      );
    }

    if (sandboxSmokeTest !== 'passed') {
      add(
        'critical',
        'quarantine-exit-without-smoke-test',
        `Quarantine exit was requested for '${server.name}' without a passed sandbox smoke test (status: '${sandboxSmokeTest}').`,
        `Run the sandbox smoke test for ${server.name} to completion and require 'passed' before exit.`,
      );
    }

    if (permissionScope !== 'least-privilege') {
      add(
        'critical',
        'quarantine-exit-undeclared-scope',
        `Quarantine exit was requested for '${server.name}' with a non-least-privilege permission scope ('${permissionScope}').`,
        `Require ${server.name} to declare and be scoped to least-privilege before exit; undeclared or broad scope must not exit quarantine.`,
      );
    }
  }

  const hasCritical = findings.some((f) => f.severity === 'critical');
  const penalty = findings.reduce((sum, f) => sum + ((SEVERITY_WEIGHT[f.severity] ?? (() => { throw new Error(`unknown finding severity: ${f.severity}`); })())), 0);
  const score = Math.max(0, 100 - penalty);
  const pass = !hasCritical && score >= 75;

  return { pass, score, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: mcp_admission_audit.mjs --input <spec>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const spec = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditMcpAdmission(spec), null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`mcp_admission_audit: ${e.message}\n`);
    process.exit(1);
  }
}
