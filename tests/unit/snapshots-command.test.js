/**
 * Unit tests for `pd snapshots` — list/show/restore/prune over the
 * claim-watcher's snapshot directory.
 *
 * Strategy: point the module at a tmp snapshot root via
 * PORT_DADDY_SNAPSHOT_ROOT (avoids libuv's cached HOME/passwd entry),
 * seed it with synthetic manifests, then drive the dispatcher with
 * synthetic CLIOptions. Stdout/stderr are captured per-call.
 */
import { describe, expect, test, beforeEach, afterEach, jest } from '@jest/globals';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let snapRoot;
let priorEnv;

// Jest replaces console.log/error with its own logger, so monkey-patching
// process.stdout.write doesn't capture the daemon-side output. We patch
// the console methods themselves and join the resulting lines.
async function captureStdoutAsync(fn) {
  const out = [];
  const origLog = console.log;
  const origWrite = process.stdout.write.bind(process.stdout);
  console.log = (...args) => { out.push(args.map(String).join(' ') + '\n'); };
  // @ts-ignore — test-only monkeypatch
  process.stdout.write = (chunk) => { out.push(chunk.toString()); return true; };
  try { await fn(); } finally {
    console.log = origLog;
    process.stdout.write = origWrite;
  }
  return out.join('');
}

async function captureStderrAsync(fn) {
  const out = [];
  const origErr = console.error;
  const origWrite = process.stderr.write.bind(process.stderr);
  console.error = (...args) => { out.push(args.map(String).join(' ') + '\n'); };
  // @ts-ignore — test-only monkeypatch
  process.stderr.write = (chunk) => { out.push(chunk.toString()); return true; };
  try { await fn(); } finally {
    console.error = origErr;
    process.stderr.write = origWrite;
  }
  return out.join('');
}

function writeSnapshot(sessionId, filePath, snapshotName, contents, snapshotAt) {
  const dir = join(snapRoot, sessionId);
  mkdirSync(dir, { recursive: true });
  const snapshotPath = join(dir, snapshotName);
  writeFileSync(snapshotPath, contents);
  const entry = {
    sessionId,
    agentId: null,
    filePath,
    snapshotPath,
    priorHash: 'deadbeef'.repeat(8),
    priorBytes: contents.length,
    snapshotAt: snapshotAt || new Date().toISOString(),
  };
  const manifest = join(dir, 'manifest.jsonl');
  const line = JSON.stringify(entry) + '\n';
  writeFileSync(manifest, (existsSync(manifest) ? readFileSync(manifest, 'utf8') : '') + line);
  return entry;
}

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-snapshots-test-'));
  snapRoot = join(dir, 'snapshots');
  mkdirSync(snapRoot, { recursive: true });
  priorEnv = process.env.PORT_DADDY_SNAPSHOT_ROOT;
  process.env.PORT_DADDY_SNAPSHOT_ROOT = snapRoot;
});

afterEach(() => {
  if (priorEnv === undefined) delete process.env.PORT_DADDY_SNAPSHOT_ROOT;
  else process.env.PORT_DADDY_SNAPSHOT_ROOT = priorEnv;
  rmSync(snapRoot, { recursive: true, force: true });
  jest.resetModules();
});

describe('pd snapshots', () => {
  test('list returns empty when no snapshots exist', async () => {
    const { handleSnapshots } = await import('../../cli/commands/snapshots.js');
    const out = await captureStdoutAsync(async () => {
      await handleSnapshots(['list'], { json: true });
    });
    const parsed = JSON.parse(out);
    expect(parsed.success).toBe(true);
    expect(parsed.count).toBe(0);
    expect(parsed.entries).toEqual([]);
  });

  test('list returns newest-first across sessions and respects --session filter', async () => {
    writeSnapshot('sess-a', 'src/a.ts', 'snap-a-1', 'old', '2026-04-01T00:00:00.000Z');
    writeSnapshot('sess-b', 'src/b.ts', 'snap-b-1', 'newer', '2026-04-15T00:00:00.000Z');
    writeSnapshot('sess-a', 'src/a.ts', 'snap-a-2', 'newest', '2026-04-20T00:00:00.000Z');

    const { handleSnapshots } = await import('../../cli/commands/snapshots.js');
    const all = JSON.parse(await captureStdoutAsync(async () => {
      await handleSnapshots(['list'], { json: true });
    }));
    expect(all.count).toBe(3);
    expect(all.entries[0].snapshotAt).toBe('2026-04-20T00:00:00.000Z');
    expect(all.entries[2].snapshotAt).toBe('2026-04-01T00:00:00.000Z');

    const filtered = JSON.parse(await captureStdoutAsync(async () => {
      await handleSnapshots(['list'], { json: true, session: 'sess-b' });
    }));
    expect(filtered.count).toBe(1);
    expect(filtered.entries[0].sessionId).toBe('sess-b');
  });

  test('list --path filters by file substring', async () => {
    writeSnapshot('sess-a', 'src/foo.ts', 'snap1', 'x');
    writeSnapshot('sess-a', 'src/bar.ts', 'snap2', 'y');

    const { handleSnapshots } = await import('../../cli/commands/snapshots.js');
    const out = JSON.parse(await captureStdoutAsync(async () => {
      await handleSnapshots(['list'], { json: true, path: 'foo' });
    }));
    expect(out.count).toBe(1);
    expect(out.entries[0].filePath).toBe('src/foo.ts');
  });

  test('show prints snapshot bytes via suffix selector', async () => {
    const entry = writeSnapshot('sess-x', 'src/file.ts', 'unique-snap-name', 'PRIOR-CONTENT');

    const { handleSnapshots } = await import('../../cli/commands/snapshots.js');
    const captured = await captureStdoutAsync(async () => {
      await handleSnapshots(['show', 'unique-snap-name'], {});
    });
    expect(captured).toBe('PRIOR-CONTENT');
    expect(entry.snapshotPath).toMatch(/unique-snap-name$/);
  });

  test('show with ambiguous selector exits non-zero', async () => {
    writeSnapshot('sess-a', 'src/a.ts', 'shared-name-1', 'a');
    writeSnapshot('sess-b', 'src/b.ts', 'shared-name-2', 'b');

    const { handleSnapshots } = await import('../../cli/commands/snapshots.js');
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => { throw new Error('EXIT:' + code); });
    let err;
    try {
      await captureStderrAsync(async () => {
        await handleSnapshots(['show', 'shared-name'], {});
      });
    } catch (e) { err = e; }
    expect(err?.message).toBe('EXIT:1');
    exitSpy.mockRestore();
  });

  test('restore writes snapshot bytes to original filePath', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'pd-snapshot-restore-'));
    const target = join(projectRoot, 'src', 'restored.ts');
    writeSnapshot('sess-r', target, 'restore-snap', 'ORIGINAL-BYTES');

    const { handleSnapshots } = await import('../../cli/commands/snapshots.js');
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
    await captureStdoutAsync(async () => {
      await handleSnapshots(['restore', 'restore-snap'], {});
    });
    expect(readFileSync(target, 'utf8')).toBe('ORIGINAL-BYTES');
    exitSpy.mockRestore();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test('restore refuses to overwrite without --force', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'pd-snapshot-guard-'));
    const target = join(projectRoot, 'existing.ts');
    writeFileSync(target, 'CURRENT');
    writeSnapshot('sess-r', target, 'guard-snap', 'OLD');

    const { handleSnapshots } = await import('../../cli/commands/snapshots.js');
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => { throw new Error('EXIT:' + code); });
    let err;
    try {
      await captureStderrAsync(async () => {
        await handleSnapshots(['restore', 'guard-snap'], {});
      });
    } catch (e) { err = e; }
    expect(err?.message).toBe('EXIT:1');
    expect(readFileSync(target, 'utf8')).toBe('CURRENT');
    exitSpy.mockRestore();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test('restore --force overwrites and --target redirects', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'pd-snapshot-force-'));
    const original = join(projectRoot, 'orig.ts');
    const redirected = join(projectRoot, 'sub', 'redirected.ts');
    writeFileSync(original, 'CURRENT');
    writeSnapshot('sess-r', original, 'force-snap', 'PRIOR');

    const { handleSnapshots } = await import('../../cli/commands/snapshots.js');
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
    await captureStdoutAsync(async () => {
      await handleSnapshots(['restore', 'force-snap'], { target: redirected });
    });
    expect(readFileSync(redirected, 'utf8')).toBe('PRIOR');
    expect(readFileSync(original, 'utf8')).toBe('CURRENT');
    exitSpy.mockRestore();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test('prune --dry-run reports without deleting; real prune removes old files', async () => {
    const fresh = writeSnapshot('sess-p', 'src/fresh.ts', 'fresh-snap', 'fresh');
    const stale = writeSnapshot('sess-p', 'src/stale.ts', 'stale-snap', 'stale');
    const ancient = Date.now() / 1000 - 30 * 24 * 60 * 60;
    utimesSync(stale.snapshotPath, ancient, ancient);

    const { handleSnapshots } = await import('../../cli/commands/snapshots.js');
    const dry = JSON.parse(await captureStdoutAsync(async () => {
      await handleSnapshots(['prune'], { json: true, days: 7, 'dry-run': true });
    }));
    expect(dry.dryRun).toBe(true);
    expect(dry.pruned).toBe(1);
    expect(dry.kept).toBe(1);
    expect(existsSync(stale.snapshotPath)).toBe(true);

    const real = JSON.parse(await captureStdoutAsync(async () => {
      await handleSnapshots(['prune'], { json: true, days: 7 });
    }));
    expect(real.pruned).toBe(1);
    expect(existsSync(stale.snapshotPath)).toBe(false);
    expect(existsSync(fresh.snapshotPath)).toBe(true);
  });
});
