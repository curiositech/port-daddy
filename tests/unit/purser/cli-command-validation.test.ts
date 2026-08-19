// tests/unit/purser/cli-command-validation.test.ts

import { promises as fs } from 'fs';
import path from 'path';
import { test, expect } from '@jest/globals';

const readmePath = path.resolve(__dirname, '../../../README.md');
const cliCommandsDir = path.resolve(__dirname, '../../../cli/commands');
const permissionTiersPath = path.resolve(__dirname, '../../../cli/permission-tiers.ts');

/**
 * Extract all unique pd verb names from the README.
 *
 * We look for occurrences of `pd <verb>` in any context (code fences, inline
 * examples, etc.). The regex is intentionally simple – it matches a word
 * following `pd` and stops at the first non‑word character.
 */
async function extractReadmeVerbs(): Promise<Set<string>> {
  const content = await fs.readFile(readmePath, 'utf8');
  const verbRegex = /\bpd\s+(\w+)/g;
  const verbs = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = verbRegex.exec(content)) !== null) {
    verbs.add(match[1]);
  }
  return verbs;
}

/**
 * Load the permission tiers registry from cli/permission-tiers.ts.
 *
 * The module may export the registry as a default export, a named export,
 * or simply as the module itself. We try all common patterns.
 */
async function loadPermissionTiers(): Promise<Record<string, unknown>> {
  const mod = await import(permissionTiersPath);
  if (mod.permissionTiers && typeof mod.permissionTiers === 'object') {
    return mod.permissionTiers as Record<string, unknown>;
  }
  if (mod.default && typeof mod.default === 'object') {
    return mod.default as Record<string, unknown>;
  }
  // Fallback: the module itself is the registry.
  return mod as Record<string, unknown>;
}

/**
 * Verify that every command referenced in the README exists in the permission
 * tiers registry and that a source file exists in cli/commands.
 *
 * If any command is missing, the test fails with a clear diagnostic.
 */
test('README CLI commands are valid', async () => {
  const [readmeVerbs, permissionTiers] = await Promise.all([
    extractReadmeVerbs(),
    loadPermissionTiers(),
  ]);

  const validVerbs = new Set<string>(Object.keys(permissionTiers));

  const missingInTiers: string[] = [];
  const missingInSources: string[] = [];

  for (const verb of readmeVerbs) {
    if (!validVerbs.has(verb)) {
      missingInTiers.push(verb);
      continue; // No point checking sources if the tier is missing
    }

    const tsPath = path.join(cliCommandsDir, `${verb}.ts`);
    const jsPath = path.join(cliCommandsDir, `${verb}.js`);

    try {
      await fs.access(tsPath);
    } catch {
      try {
        await fs.access(jsPath);
      } catch {
        missingInSources.push(verb);
      }
    }
  }

  const errors: string[] = [];
  if (missingInTiers.length) {
    errors.push(
      `The following commands are referenced in README but missing from permission-tiers.ts: ${missingInTiers.join(
        ', ',
      )}`,
    );
  }
  if (missingInSources.length) {
    errors.push(
      `The following commands are referenced in README but missing from cli/commands: ${missingInSources.join(
        ', ',
      )}`,
    );
  }

  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  // Ensure the test actually ran and found nothing
  expect(errors).toHaveLength(0);
});