/**
 * CLI-tube smoke test.
 *
 * Skipped unless the `claude` (claude-code) CLI is on PATH AND
 * `PD_RUN_CLI_TUBE_SMOKE=1` is set. We don't run this in CI by default
 * because:
 *   - The CLI hits the operator's Claude Max subscription
 *   - The CLI requires interactive auth setup that CI won't have
 *   - A flaky network or auth state would block the whole test run
 *
 * Run locally with:
 *   PD_RUN_CLI_TUBE_SMOKE=1 npm test -- spawner-cli-tube-smoke
 */

import { execFileSync } from 'node:child_process';
import { spawnViaCliTube } from '../../lib/spawner/backends/cli-tube.js';

function binaryExists(name) {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const claudeAvailable = binaryExists('claude');
const codexAvailable = binaryExists('codex');
const explicitOptIn = process.env.PD_RUN_CLI_TUBE_SMOKE === '1';

const claudeShould = explicitOptIn && claudeAvailable;
const codexShould = explicitOptIn && codexAvailable;

const claudeDescribe = claudeShould ? describe : describe.skip;
const codexDescribe = codexShould ? describe : describe.skip;

claudeDescribe('cli:claude-code smoke (requires `claude` + PD_RUN_CLI_TUBE_SMOKE=1)', () => {
  test('returns non-empty output for a trivial prompt', async () => {
    const result = await spawnViaCliTube({
      cli: 'claude-code',
      prompt: 'Reply with the single word "ack".',
      timeoutMs: 60000,
    });
    if (result.error) {
      throw new Error(`cli:claude-code smoke failed: ${result.error}`);
    }
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.exitCode).toBe(0);
  }, 90000);
});

codexDescribe('cli:codex smoke (requires `codex` + PD_RUN_CLI_TUBE_SMOKE=1)', () => {
  test('returns non-empty output for a trivial prompt', async () => {
    const result = await spawnViaCliTube({
      cli: 'codex',
      prompt: 'Reply with the single word "ack".',
      timeoutMs: 60000,
    });
    if (result.error) {
      throw new Error(`cli:codex smoke failed: ${result.error}`);
    }
    expect(result.output.length).toBeGreaterThan(0);
  }, 90000);
});

if (!explicitOptIn) {
  // eslint-disable-next-line no-console
  console.log('[spawner-cli-tube-smoke] Skipped — set PD_RUN_CLI_TUBE_SMOKE=1 to run (claude available:', claudeAvailable, ', codex available:', codexAvailable, ')');
}
