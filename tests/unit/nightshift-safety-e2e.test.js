/**
 * End-to-end (dry-run) safety pipeline test.
 *
 * Exercises:
 *   - propose -> queue -> planRunFor with safety layers on
 *   - sandbox wrap inserts `sandbox-exec` ahead of the inner command
 *   - rationale enumerates the wired defenses
 *   - disable flag short-circuits runNext(dryRun=false)
 *   - mock spawnAdapter records expected env vars + worktree-locked cwd
 *
 * This is a no-op intent: we never actually execute claude or codex. The
 * adapter inspects the plan and returns succeeded. The point is to catch
 * regressions in how the runner stitches the safety layers together.
 */

import { jest } from '@jest/globals';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { createTestDb } from '../setup-unit.js';
import { createNightshiftQueue } from '../../lib/nightshift/queue.js';
import { planRunFor, runNext, NIGHTSHIFT_WORKTREE_ROOT } from '../../lib/nightshift/runner.js';
import {
  disableNightshift,
  enableNightshift,
} from '../../lib/nightshift/control.js';

function freshStateDir() {
  const dir = join(homedir(), 'coding', 'tmp', `pd-night-e2e-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  process.env.PD_STATE_DIR = dir;
  return dir;
}
function cleanupStateDir(dir) {
  delete process.env.PD_STATE_DIR;
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe('nightshift safety pipeline -- end-to-end (dry-run)', () => {
  let db;
  let queue;
  let stateDir;
  beforeEach(() => {
    stateDir = freshStateDir();
    db = createTestDb();
    queue = createNightshiftQueue({ db });
  });
  afterEach(() => {
    db.close();
    cleanupStateDir(stateDir);
  });

  test('planRunFor with safety layers on wraps argv via sandbox-exec on darwin', () => {
    const intent = queue.propose({ intent: 'no-op safety check', autoQueue: true });
    const plan = planRunFor(intent, { wrapWithSandboxExec: true, wrapGit: true });
    if (process.platform === 'darwin') {
      expect(plan.command).toBe('/usr/bin/sandbox-exec');
      expect(plan.args[0]).toBe('-p');
      expect(plan.args[2]).toBe('--');
      // After the `--` the inner backend follows.
      expect(['claude', 'codex']).toContain(plan.args[3]);
    } else {
      // Non-darwin: sandbox-exec is silently skipped.
      expect(['claude', 'codex']).toContain(plan.command);
    }
  });

  test('planRunFor surfaces wired safety layers in the rationale', () => {
    const intent = queue.propose({ intent: 'rationale check', autoQueue: true });
    const plan = planRunFor(intent, { wrapWithSandboxExec: true, wrapGit: true });
    const r = plan.rationale.join('\n');
    expect(r).toMatch(/ulimit f = 1 GB/);
    expect(r).toMatch(/git-nightshift|git wrapper/);
    if (process.platform === 'darwin') {
      expect(r).toMatch(/sandbox-exec/);
    }
  });

  test('plan env carries the run id and ulimit hint', () => {
    const intent = queue.propose({ intent: 'env carry', autoQueue: true });
    const plan = planRunFor(intent, { wrapWithSandboxExec: true, wrapGit: true });
    expect(plan.env.PD_NIGHTSHIFT_ID).toBe(intent.id);
    expect(plan.env.PD_NIGHTSHIFT_SLUG).toBe(intent.slug);
    expect(plan.env.PD_NIGHTSHIFT_BRANCH).toBe(plan.branchName);
    expect(plan.env.PD_NIGHTSHIFT_ULIMIT_F_BYTES).toBe('1073741824');
  });

  test('worktree path is always under ~/coding/tmp/nightshift -- never /tmp', () => {
    const intent = queue.propose({ intent: 'wt path', autoQueue: true });
    const plan = planRunFor(intent, { wrapWithSandboxExec: false, wrapGit: false });
    expect(plan.worktreePath.startsWith(NIGHTSHIFT_WORKTREE_ROOT)).toBe(true);
    expect(plan.worktreePath.startsWith('/tmp/')).toBe(false);
    expect(plan.worktreePath.startsWith('/private/tmp/')).toBe(false);
  });

  test('branch is always night-shift/<slug>-<idShort> -- never main/master', () => {
    const intent = queue.propose({ intent: 'branch check', autoQueue: true });
    const plan = planRunFor(intent);
    expect(plan.branchName.startsWith('night-shift/')).toBe(true);
    expect(plan.branchName).not.toBe('main');
    expect(plan.branchName).not.toBe('master');
  });

  test('runNext(dryRun=false) refuses to start when disable flag is set', async () => {
    queue.propose({ intent: 'should not run', autoQueue: true });
    disableNightshift('e2e check');
    const adapter = jest.fn(async () => ({ status: 'succeeded' }));
    await expect(
      runNext(queue, { dryRun: false, spawnAdapter: adapter }),
    ).rejects.toThrow(/disabled/);
    expect(adapter).not.toHaveBeenCalled();
    enableNightshift();
  });

  test('runNext(dryRun=false) hands the adapter a plan with safety env vars + budget cap', async () => {
    const intent = queue.propose({ intent: 'adapter sees plan', autoQueue: true, budgetUsd: 3 });
    let observed = null;
    const adapter = jest.fn(async ({ plan }) => {
      observed = plan;
      return { status: 'succeeded', costUsd: 0.05 };
    });
    await runNext(queue, {
      dryRun: false,
      spawnAdapter: adapter,
      wrapWithSandboxExec: true,
      wrapGit: true,
    });
    expect(observed).not.toBeNull();
    expect(observed.budgetUsd).toBe(3);
    expect(observed.env.PD_NIGHTSHIFT_ID).toBe(intent.id);
    expect(observed.worktreePath).toContain(intent.id);
    expect(observed.branchName.startsWith('night-shift/')).toBe(true);
    if (process.platform === 'darwin') {
      expect(observed.command).toBe('/usr/bin/sandbox-exec');
    }
  });
});
