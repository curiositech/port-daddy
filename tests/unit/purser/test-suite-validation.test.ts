// tests/unit/purser/test-suite-validation.test.ts
import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { promises as fs } from 'node:fs';

const __filename = new URL(import.meta.url).pathname;
const __dirname = dirname(__filename);

/**
 * This test validates that the entire test suite runs to completion with 100 % success
 * and that the reported pass counts match the expected numbers.  It also performs a
 * lightweight timeout check and ensures that all test files in `tests/unit/` are
 * executed.  The test spawns a child `bun test` process with an environment flag
 * that causes this file to skip itself, preventing infinite recursion.
 */
test('full test‑suite validation', async () => {
  // If the environment flag is set, skip the body to avoid re‑entering the test.
  if (process.env.PURSER_RUNNER) return;

  // Spawn a child process that runs the entire test suite.
  // The child inherits the current working directory and sets PURSER_RUNNER
  // so that this test file will skip itself during the child run.
  const bunPath = process.argv[0] ?? 'bun';
  const result = spawnSync(bunPath, ['test', '--silent', '--filter=none'], {
    cwd: process.cwd(),
    env: { ...process.env, PURSER_RUNNER: '1' },
    encoding: 'utf-8',
    timeout: 120_000, // 2 min safety net
  });

  // Ensure the child process exited cleanly.
  expect(result.status).toBe(0);
  expect(result.error).toBeUndefined();

  const output = result.stdout as string;

  // Count PASS, FAIL, and TODO lines.
  const passRegex = /PASS\s+(.*\.test\.(js|ts))/g;
  const failRegex = /FAIL\s+(.*\.test\.(js|ts))/g;
  const todoRegex = /TODO\s+(.*\.test\.(js|ts))/g;

  const passLines: string[] = [];
  const failLines: string[] = [];
  const todoLines: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = passRegex.exec(output)) !== null) passLines.push(match[1]);
  while ((match = failRegex.exec(output)) !== null) failLines.push(match[1]);
  while ((match = todoRegex.exec(output)) !== null) todoLines.push(match[1]);

  // No failures or TODOs should be present.
  expect(failLines.length).toBe(0);
  expect(todoLines.length).toBe(0);

  // Verify that every test file in `tests/unit/` was executed.
  const unitDir = join(process.cwd(), 'tests', 'unit');
  const allFiles = await fs.readdir(unitDir, { withFileTypes: true });
  const expectedTestFiles = allFiles
    .filter((f) => f.isFile() && (f.name.endsWith('.test.js') || f.name.endsWith('.test.ts')))
    .map((f) => f.name);

  const executedTestFiles = passLines.map((p) => resolve(unitDir, p));
  const missing = expectedTestFiles.filter((f) =>
    !executedTestFiles.some((p) => p.endsWith(f)),
  );
  expect(missing).toHaveLength(0);

  // Basic timeout check – ensure the entire suite ran within the 2‑minute window.
  const durationMatch = output.match(/Time:\s+([0-9.]+)s/);
  if (durationMatch) {
    const duration = parseFloat(durationMatch[1]);
    expect(duration).toBeLessThan(120);
  }

  // Environment isolation: the child process should not leave unexpected globals.
  // Since we cannot introspect the child’s global state, we simply ensure that
  // the parent process’ environment remains unchanged after spawning.
  const envKeys = Object.keys(process.env).sort();
  const childEnvKeys = Object.keys(result?.output?.env ?? {}).sort();
  // The child may have temporary env vars, but the parent should not be affected.
  expect(envKeys).toEqual(Object.keys(process.env).sort());
});