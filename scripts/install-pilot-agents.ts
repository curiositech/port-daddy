#!/usr/bin/env bun
/**
 * Install the Port Daddy Pilot agent into every local LLM runtime.
 *
 * Renders the canonical source (agents/port-daddy-pilot/) into each tool's
 * native agent format and writes it under $HOME. Called by `pd setup` on every
 * brew install/upgrade; also runnable directly:
 *
 *   bun scripts/install-pilot-agents.ts            # install for $HOME
 *   bun scripts/install-pilot-agents.ts --dry-run  # preview, write nothing
 *   bun scripts/install-pilot-agents.ts --base-dir "$HOME/coding/tmp/pilot-install" # test target
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installPilotAgents, resolvePilotSourceDir, type PilotInstallResult } from '../lib/pilot-agent-render.js';

/** Walk up from this file to the canonical Port Daddy source root. */
function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (
      existsSync(join(dir, 'package.json')) &&
      existsSync(join(dir, 'agents', 'port-daddy-pilot', 'agent.config.json'))
    ) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}

export function summarize(result: PilotInstallResult, dryRun: boolean): string[] {
  const verb = dryRun ? 'would write' : 'wrote';
  const lines = [
    `Port Daddy Pilot: ${verb} ${result.written.length} runtime definition(s) from ${result.sourceDir}`,
  ];
  for (const w of result.written) {
    const state = w.changed ? '(updated)' : '(unchanged)';
    lines.push(`  ${w.runtime}: ${w.path} ${state}`);
  }
  for (const e of result.errors) {
    lines.push(`  ! ${e.runtime}: ${e.path} — ${e.error}`);
  }
  return lines;
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const baseIdx = args.indexOf('--base-dir');
  const baseDir = baseIdx !== -1 ? args[baseIdx + 1] : undefined;

  const sourceDir = resolvePilotSourceDir(findRepoRoot());
  if (!sourceDir) {
    console.error('Port Daddy Pilot source not found (brew prefix or repo checkout).');
    process.exit(1);
  }

  const result = installPilotAgents({ sourceDir, baseDir, dryRun });
  for (const line of summarize(result, dryRun)) console.log(line);
  process.exit(result.errors.some((e) => !e.error.includes('not a Port Daddy Pilot')) ? 1 : 0);
}

// Only run main() when invoked as a script, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
