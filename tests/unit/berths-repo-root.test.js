import { describe, expect, test } from '@jest/globals';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  DEV_BERTH_STARTUP_TIMEOUT_MS,
  claimCodebasePort,
  codebasePortCoordinatorUrls,
  resolveRepoRoot,
  defaultFrom,
  smokeBerthHealth,
  shouldPurgeBerthState,
} from '../../cli/commands/berths.js';

// Regression for `pd dev up` crashing with
//   "build script missing in source tree: /scripts/build-daemon-binary.mjs"
// In the bun-compiled binary, __dirname points inside the bundle (not a real
// tree), so the old module-walk fell through to "/" and produced a bogus
// "/scripts/..." path. resolveRepoRoot must fall back to the cwd's checkout.
describe('resolveRepoRoot (pd dev up source-tree resolution)', () => {
  const repoTop = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim();

  test('module walk resolves the source tree in dev (real moduleDir)', () => {
    const root = resolveRepoRoot(import.meta.dirname, process.cwd());
    expect(existsSync(join(root, 'scripts', 'build-daemon-binary.mjs'))).toBe(true);
  });

  test('compiled-binary case: bogus moduleDir "/" falls back to the cwd checkout, never "/"', () => {
    const root = resolveRepoRoot('/', repoTop);
    expect(root).not.toBe('/');
    expect(existsSync(join(root, 'scripts', 'build-daemon-binary.mjs'))).toBe(true);
  });

  test('never yields a bogus /scripts path (the original bug)', () => {
    const root = resolveRepoRoot('/', repoTop);
    expect(join(root, 'scripts', 'build-daemon-binary.mjs')).not.toBe('/scripts/build-daemon-binary.mjs');
  });
});

describe('defaultFrom (the --label-without---from footgun fix)', () => {
  const ROOT = '/Users/me/coding/tmp/add-webhooks';

  test('explicit --from always wins (even empty string / main)', () => {
    expect(defaultFrom('main', 'some-branch', ROOT)).toBe('main');
    expect(defaultFrom('/other/worktree', 'feat-x', ROOT)).toBe('/other/worktree');
  });

  test('no --from on a feature branch → codebase berth for this worktree (root path)', () => {
    expect(defaultFrom(undefined, 'feat/add-webhooks', ROOT)).toBe(ROOT);
    expect(defaultFrom(undefined, 'fix/freshness', ROOT)).toBe(ROOT);
  });

  test('no --from on main/master/detached → shared dev-latest (unchanged behaviour)', () => {
    expect(defaultFrom(undefined, 'main', ROOT)).toBe('main');
    expect(defaultFrom(undefined, 'master', ROOT)).toBe('main');
    expect(defaultFrom(undefined, 'HEAD', ROOT)).toBe('main');
    expect(defaultFrom(undefined, null, ROOT)).toBe('main');
  });
});

describe('named berth state lifecycle', () => {
  test('falls back to an explicitly selected loopback berth when stable is down', async () => {
    const requested = [];
    const port = await claimCodebasePort('squid-3-28-final', {
      coordinatorUrls: ['http://127.0.0.1:9876', 'http://127.0.0.1:3174'],
      fetchImpl: async (url) => {
        requested.push(url);
        if (url.startsWith('http://127.0.0.1:9876')) throw new Error('stable refused');
        return new Response(JSON.stringify({ port: 3175 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
      isOccupied: async () => false,
    });

    expect(port).toBe(3175);
    expect(requested).toEqual([
      'http://127.0.0.1:9876/ports/request',
      'http://127.0.0.1:3174/ports/request',
    ]);
    expect(codebasePortCoordinatorUrls({
      PORT_DADDY_URL: 'https://remote.example.test',
      PORT_DADDY_PORT: '3210',
    })).toEqual(['http://127.0.0.1:3210']);
  });

  test('escapes a responsive old stable daemon that repeats an occupied renewal', async () => {
    const requested = [];
    const port = await claimCodebasePort('squid-3-28-final', {
      coordinatorUrls: ['http://127.0.0.1:9876', 'http://127.0.0.1:3174'],
      fetchImpl: async (url, init) => {
        requested.push(`${init.method} ${url}`);
        if (init.method === 'DELETE') return new Response('{}', { status: 200 });
        const port = url.startsWith('http://127.0.0.1:9876') ? 3173 : 3175;
        return new Response(JSON.stringify({ port }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
      isOccupied: async (candidate) => candidate === 3173,
    });

    expect(port).toBe(3175);
    expect(requested).toEqual([
      'POST http://127.0.0.1:9876/ports/request',
      'DELETE http://127.0.0.1:9876/ports/release',
      'POST http://127.0.0.1:3174/ports/request',
    ]);
  });

  test('a new CLI rejects a stale port renewal from an older stable daemon', async () => {
    const requests = [];
    const fetchImpl = async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ method: init.method, body });
      if (init.method === 'DELETE') return new Response('{}', { status: 200 });
      const port = body.preferred ?? 3173;
      return new Response(JSON.stringify({ port }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const port = await claimCodebasePort('squid-3-28-feature', {
      fetchImpl,
      isOccupied: async (candidate) => candidate === 3173,
    });

    expect(port).toBe(3174);
    expect(requests).toEqual([
      expect.objectContaining({ method: 'POST', body: { project: 'pd-dev-squid-3-28-feature', requireFree: true } }),
      expect.objectContaining({ method: 'DELETE', body: { project: 'pd-dev-squid-3-28-feature' } }),
      expect.objectContaining({ method: 'POST', body: { project: 'pd-dev-squid-3-28-feature', requireFree: true, preferred: 3174 } }),
    ]);
  });

  test('uses the legacy preferred shape when old stable ignores preferred with requireFree', async () => {
    const requests = [];
    const fetchImpl = async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ method: init.method, body });
      if (init.method === 'DELETE') return new Response('{}', { status: 200 });
      const port = body.requireFree ? 3173 : body.preferred;
      return new Response(JSON.stringify({ port }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const port = await claimCodebasePort('squid-legacy-preferred', {
      coordinatorUrls: ['http://127.0.0.1:3210'],
      fetchImpl,
      isOccupied: async (candidate) => candidate === 3173 || candidate === 3174,
      maxAttempts: 4,
    });

    expect(port).toBe(3175);
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'POST', body: { project: 'pd-dev-squid-legacy-preferred', requireFree: true, preferred: 3174 } }),
      expect.objectContaining({ method: 'POST', body: { project: 'pd-dev-squid-legacy-preferred', preferred: 3174 } }),
      expect.objectContaining({ method: 'POST', body: { project: 'pd-dev-squid-legacy-preferred', preferred: 3175 } }),
    ]));
  });

  test('waits through a slow compiled-daemon boot instead of killing it at 15 seconds', async () => {
    let clock = 0;
    let attempts = 0;
    const health = await smokeBerthHealth(3173, {
      now: () => clock,
      sleep: async () => { clock += 30_000; },
      fetchImpl: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('still running the seeded DB integrity gate');
        return new Response(JSON.stringify({ status: 'ok', version: '3.28.0' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    expect(DEV_BERTH_STARTUP_TIMEOUT_MS).toBe(120_000);
    expect(attempts).toBe(3);
    expect(health).toMatchObject({ status: 'ok', version: '3.28.0' });
  });

  test('ordinary stop preserves the isolated durable ledger', () => {
    expect(shouldPurgeBerthState({})).toBe(false);
    expect(shouldPurgeBerthState({ all: true })).toBe(false);
  });

  test('state destruction requires an explicit purge or reset flag', () => {
    expect(shouldPurgeBerthState({ purge: true })).toBe(true);
    expect(shouldPurgeBerthState({ reset: true })).toBe(true);
  });
});
