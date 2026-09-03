#!/usr/bin/env -S npx tsx
/**
 * Install the Port Daddy Pilot agent into every local LLM runtime.
 *
 * Renders the canonical source (agents/port-daddy-pilot/) into each tool's
 * native agent format and writes it under $HOME. Called by `pd setup` on every
 * brew install/upgrade; also runnable directly:
 *
 *   npx tsx scripts/install-pilot-agents.ts            # install for $HOME
 *   npx tsx scripts/install-pilot-agents.ts --dry-run  # preview, write nothing
 *   npx tsx scripts/install-pilot-agents.ts --source-dir ./agents/port-daddy-pilot --dry-run
 *   npx tsx scripts/install-pilot-agents.ts --base-dir ~/coding/tmp/pilot-preview
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installPilotAgents, resolvePilotSourceDir, type PilotInstallResult, type PilotSourceHashes } from '../lib/pilot-agent-render.js';

/** Walk up from this file to the repo root (marked by Formula/port-daddy.rb). */
function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'Formula', 'port-daddy.rb'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}

/**
 * Design: report captured provenance beside outcomes so a preview can bind a later apply.
 * @param result Installer outcomes from the exact bytes used to render.
 * @param dryRun Whether these are proposed rather than performed writes.
 * @returns Human-readable provenance and per-runtime results, not an atomic-install claim.
 */
export function summarize(result: PilotInstallResult, dryRun: boolean): string[] {
  const verb = dryRun ? 'would write' : 'wrote';
  const lines = [
    `Port Daddy Pilot: ${result.outcome}; ${verb} ${result.written.length} runtime definition(s) from ${result.sourceDir}`,
  ];
  if (result.provenance) {
    lines.push(`  Source directory: ${result.provenance.sourceDir}`);
    lines.push(`  AGENT.md SHA-256: ${result.provenance.agentSha256}`);
    lines.push(`  agent.config.json SHA-256: ${result.provenance.configSha256}`);
  }
  if (result.plan) {
    lines.push('  Target preview SHA-256: ' + result.plan.digest);
    for (const target of result.plan.entries) {
      lines.push('  Plan ' + target.action + ': ' + target.path + ' (was ' + target.before.kind + ')');
    }
  }
  if (result.recovery) lines.push('  Recovery handle: ' + result.recovery.runId + ' (evidence: ' + result.recovery.directory + ')');
  for (const w of result.written) {
    const state = w.changed ? '(updated)' : '(unchanged)';
    lines.push(`  ${w.runtime}: ${w.path} ${state}`);
  }
  for (const e of result.errors) {
    lines.push(`  ! ${e.runtime}: ${e.path} — ${e.error}`);
  }
  return lines;
}

interface InstallArguments {
  dryRun: boolean;
  help: boolean;
  baseDir?: string;
  sourceDir?: string;
  expectedSource?: PilotSourceHashes;
  expectedTarget?: string;
  operation?: 'uninstall';
  recoveryRun?: string;
}

/**
 * Parse before discovery or home defaults: misspelled intent must never install.
 * @param args Standalone CLI arguments, using separate option/value tokens.
 * @returns Validated options; unknown, duplicate, missing and incomplete pins throw.
 */
export function parseInstallArguments(args: string[]): InstallArguments {
  if (args.length === 1 && args[0] === '--help') return { help: true, dryRun: false };
  const values = new Map<string, string>();
  const switches = new Set<string>();
  const valueFlags = new Set(['--base-dir', '--source-dir', '--expect-agent-sha256', '--expect-config-sha256', '--expect-target-sha256', '--recover']);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--dry-run' || arg === '--uninstall') {
      if (switches.has(arg)) throw new Error('Duplicate ' + arg);
      switches.add(arg);
    } else if (valueFlags.has(arg)) {
      if (values.has(arg)) throw new Error(`Duplicate ${arg}`);
      const value = args[++index];
      if (value === undefined || value.trim().length === 0 || value.startsWith('-')) {
        throw new Error(`Missing value for ${arg}`);
      }
      values.set(arg, value);
    } else {
      throw new Error('Unknown installer argument; use --help for supported options');
    }
  }
  const expectedTarget = values.get('--expect-target-sha256');
  const recoveryRun = values.get('--recover');
  if (expectedTarget !== undefined && !/^[a-f0-9]{64}$/.test(expectedTarget)) throw new Error('Target preview digest must be lowercase SHA-256');
  if (recoveryRun !== undefined && !/^[a-f0-9-]{36}$/.test(recoveryRun)) throw new Error('Recovery requires an exact recorded run ID');
  if ((recoveryRun || switches.has('--uninstall')) && (!values.has('--base-dir') || !values.has('--source-dir'))) {
    throw new Error('Recovery and uninstall require explicit --base-dir and --source-dir');
  }
  if (recoveryRun && (switches.size > 0 || expectedTarget)) throw new Error('Recovery cannot be combined with preview, uninstall or target pins');
  const agentSha256 = values.get('--expect-agent-sha256');
  const configSha256 = values.get('--expect-config-sha256');
  if ((agentSha256 !== undefined || configSha256 !== undefined)
    && (!agentSha256 || !configSha256 || !/^[a-f0-9]{64}$/.test(agentSha256) || !/^[a-f0-9]{64}$/.test(configSha256))) {
    throw new Error('Provide both --expect-agent-sha256 and --expect-config-sha256 as lowercase SHA-256 digests');
  }
  return {
    help: false,
    dryRun: switches.has('--dry-run'),
    baseDir: values.get('--base-dir'),
    sourceDir: values.get('--source-dir'),
    expectedSource: agentSha256 && configSha256 ? { agentSha256, configSha256 } : undefined,
    expectedTarget,
    operation: switches.has('--uninstall') ? 'uninstall' : undefined,
    recoveryRun,
  };
}

/**
 * Run the standalone source installer, validating intent before filesystem effects.
 * @returns Nothing; failures set a nonzero process exit status without fallback/retry.
 */
function main(): void {
  try {
    const options = parseInstallArguments(process.argv.slice(2));
    if (options.help) {
      console.log('Usage: install-pilot-agents.ts [--dry-run] [--base-dir <directory>] [--source-dir <directory>] [--expect-agent-sha256 <sha256> --expect-config-sha256 <sha256>]');
      console.log('Explicit source selection never falls back to Homebrew. Preview reports exact source hashes; paired pins bind a later apply. Without --source-dir, package-first discovery remains the default.');
      console.log('Use --expect-target-sha256 <preview digest> to bind a reviewed target plan. --uninstall and --recover <recorded run ID> require explicit source and target directories; neither adopts unmanaged files.');
      return;
    }
    const sourceDir = resolvePilotSourceDir(findRepoRoot(), options.sourceDir);
    if (!sourceDir) throw new Error('Port Daddy Pilot source not found (brew prefix or repo checkout).');
    const result = installPilotAgents({ ...options, sourceDir });
    for (const line of summarize(result, options.dryRun)) console.log(line);
    process.exitCode = result.errors.length ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Pilot installation failed');
    process.exitCode = 1;
  }
}

// Only run main() when invoked as a script, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
