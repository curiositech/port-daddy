import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { once } from 'node:events';

// The transport is replaced before importing Guard: these tests may never
// discover the operator's daemon or consult a real roadmap/credential store.
const request = jest.fn();
jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  pdFetch: request,
  PORT_DADDY_URL: 'http://guard-receipt.invalid',
  isDaemonRunning: jest.fn(),
}));
jest.unstable_mockModule('../../cli/commands/roadmap.js', () => ({
  resolveRoadmapHarbor: jest.fn(() => 'fixture-harbor'),
}));
const { DEFAULT_GUARD_CONFIG, evaluateGuardFacts, loadRoadmapReceipts } =
  await import('../../cli/commands/guard.js');

const now = 1_788_375_176_813;
const linked = { roadmapLink: 'research-durable-agents-landscape', harbor: 'fixture-harbor' };
const receipt = (overrides = {}) => ({
  slug: linked.roadmapLink,
  harbor: linked.harbor,
  lastTouchedAt: now,
  promotedByAgentId: 'fixture-agent',
  notes: [{ at: now, by: 'fixture-agent', text: 'Exact own receipt' }],
  ...overrides,
});
const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: jest.fn(async () => body),
});
const evaluate = (lookup) => evaluateGuardFacts({
  config: { ...DEFAULT_GUARD_CONFIG, enabled: true, mode: 'enforce', requireClaims: false },
  active: true,
  atCommitTime: true,
  files: ['cli/commands/guard.ts'],
  agentId: 'fixture-agent',
  sessionId: 'fixture-session',
  nowMs: now,
  roadmapReceipts: lookup.receipts,
  roadmapReceiptLookupIssue: lookup.issue,
});

beforeEach(() => request.mockReset());

describe('Guard exact linked roadmap receipt lookup', () => {
  test('finds the linked receipt beyond 200 unrelated status-ranked rows without listing them', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => receipt({ slug: `unrelated-${i}` }));
    rows.push(receipt());
    request.mockImplementation(async (url) => {
      const parsed = new URL(url);
      expect(parsed.pathname).toBe(`/roadmap/items/${linked.roadmapLink}`);
      expect(parsed.searchParams.get('harbor')).toBe(linked.harbor);
      return response({ success: true, item: rows.find((row) => row.slug === linked.roadmapLink) });
    });
    const lookup = await loadRoadmapReceipts(linked);
    expect(lookup.issue).toBeUndefined();
    expect(lookup.receipts).toHaveLength(1);
    expect(evaluate(lookup).passed).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toMatchObject({ timeout: 2000, retry: false });
  });

  test('escapes exact slug and harbor components instead of interpolating query parameters', async () => {
    const input = { roadmapLink: 'slash/and?query', harbor: 'team&other=bad' };
    request.mockResolvedValue(response({ success: true, item: receipt({ slug: input.roadmapLink, harbor: input.harbor }) }));
    await loadRoadmapReceipts(input);
    expect(request.mock.calls[0][0]).toBe('http://guard-receipt.invalid/roadmap/items/slash%2Fand%3Fquery?harbor=team%26other%3Dbad');
  });

  test('an exact 404 means missing, with no broader harbor or unrelated-receipt fallback', async () => {
    request.mockResolvedValue(response({ success: false, error: 'not found' }, 404));
    const lookup = await loadRoadmapReceipts(linked);
    expect(lookup).toEqual({ receipts: [] });
    expect(evaluate(lookup).violations.map((v) => v.code)).toEqual(['roadmap-receipt-missing']);
    expect(request).toHaveBeenCalledTimes(1);
  });

  test.each([
    { slug: 'different-item' },
    { harbor: 'different-harbor' },
    { harbor: undefined },
  ])('a mismatched response cannot satisfy another linked item or harbor: %p', async (changed) => {
    request.mockResolvedValue(response({ success: true, item: receipt(changed) }));
    const lookup = await loadRoadmapReceipts(linked);
    expect(lookup.receipts).toEqual([]);
    expect(lookup.issue).toBe('unavailable');
    expect(evaluate(lookup).shouldBlock).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  test.each([401, 403, 429, 500, 503])('HTTP %s is unavailable, not fabricated missing truth', async (status) => {
    request.mockResolvedValue(response({ success: true, item: receipt() }, status));
    const lookup = await loadRoadmapReceipts(linked);
    expect(lookup).toEqual({ receipts: [], issue: 'unavailable' });
    expect(evaluate(lookup).violations.map((v) => v.code)).toEqual(['roadmap-receipt-unverifiable']);
    expect(request).toHaveBeenCalledTimes(1);
  });

  test.each([null, {}, { success: false }, { success: true }, { success: true, item: [] }])('malformed exact payload is unavailable: %p', async (body) => {
    request.mockResolvedValue(response(body));
    expect(await loadRoadmapReceipts(linked)).toEqual({ receipts: [], issue: 'unavailable' });
  });

  test('transport and JSON errors become bounded diagnostics without leaking raw errors', async () => {
    request.mockRejectedValueOnce(new Error('secret transport context'));
    const lookup = await loadRoadmapReceipts(linked);
    expect(lookup).toEqual({ receipts: [], issue: 'unavailable' });
    expect(JSON.stringify(evaluate(lookup))).not.toContain('secret transport context');
    request.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('secret JSON'); } });
    expect(await loadRoadmapReceipts(linked)).toEqual({ receipts: [], issue: 'unavailable' });
  });

  test('a stalled request is aborted by the total deadline, without retries or leaked errors', async () => {
    request.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      expect(options.signal).toBeInstanceOf(AbortSignal);
      options.signal.addEventListener('abort', () => reject(new Error('private transport detail')), { once: true });
    }));
    const lookup = await loadRoadmapReceipts(linked);
    expect(lookup).toEqual({ receipts: [], issue: 'unavailable' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1].signal.aborted).toBe(true);
    expect(JSON.stringify(evaluate(lookup))).not.toContain('private transport detail');
  });

  test.each([
    { notes: [] },
    { notes: [{ at: now - 86_400_001, by: 'fixture-agent' }] },
    { notes: [{ at: Number.POSITIVE_INFINITY, by: 'fixture-agent' }] },
    { promotedByAgentId: 'different-agent', notes: [{ by: 'different-agent', at: now }] },
  ])('a genuine but stale or differently attributed receipt still fails: %p', async (changed) => {
    request.mockResolvedValue(response({ success: true, item: receipt(changed) }));
    const lookup = await loadRoadmapReceipts(linked);
    expect(lookup.issue).toBeUndefined();
    expect(evaluate(lookup).violations.map((v) => v.code)).toEqual(['roadmap-receipt-missing']);
  });

  test('keeps same-agent fresh note receipts when the promoter is another agent', async () => {
    request.mockResolvedValue(response({ success: true, item: receipt({
      promotedByAgentId: 'other-promoter', lastTouchedAt: now - 86_400_001,
      notes: [null, { by: 'fixture-agent', at: now, text: 'append-only review evidence' }],
    }) }));
    expect(evaluate(await loadRoadmapReceipts(linked)).passed).toBe(true);
  });
});

describe('Guard unlinked receipt diagnostic fallback', () => {
  test('does not query any harbor when the selected scope is unavailable', async () => {
    expect(await loadRoadmapReceipts({ roadmapLink: linked.roadmapLink })).toEqual({ receipts: [], issue: 'scope-unavailable' });
    expect(request).not.toHaveBeenCalled();
  });

  test('only reads one bounded page in the selected harbor for an unlinked session', async () => {
    request.mockResolvedValue(response({ success: true, items: [receipt()], count: 1 }));
    const lookup = await loadRoadmapReceipts({ harbor: linked.harbor });
    expect(evaluate(lookup).passed).toBe(true);
    const url = new URL(request.mock.calls[0][0]);
    expect(url.pathname).toBe('/roadmap/items');
    expect(Object.fromEntries(url.searchParams)).toEqual({ status: 'all', limit: '200', harbor: linked.harbor });
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('a full page cannot prove absence; return incomplete, not missing', async () => {
    const items = Array.from({ length: 200 }, (_, i) => receipt({ slug: `row-${i}`, promotedByAgentId: 'other-agent', notes: [] }));
    request.mockResolvedValue(response({ success: true, items, count: 200 }));
    const lookup = await loadRoadmapReceipts({ harbor: linked.harbor });
    expect(lookup.issue).toBe('incomplete');
    expect(evaluate(lookup).violations.map((v) => v.code)).toEqual(['roadmap-receipt-unverifiable']);
  });

  test('positive same-agent evidence remains useful even in a full scoped page', async () => {
    const items = Array.from({ length: 200 }, (_, i) => receipt({ slug: `row-${i}` }));
    request.mockResolvedValue(response({ success: true, items, count: 200 }));
    expect(evaluate(await loadRoadmapReceipts({ harbor: linked.harbor })).passed).toBe(true);
  });

  test.each([
    { success: true, items: [], count: 1 },
    { success: true, items: [receipt({ harbor: 'other-harbor' })], count: 1 },
    { success: true, items: [], count: undefined },
    { success: false, items: [receipt()], count: 1 },
  ])('malformed or wrongly scoped collection fails closed: %p', async (body) => {
    request.mockResolvedValue(response(body));
    expect(await loadRoadmapReceipts({ harbor: linked.harbor })).toEqual({ receipts: [], issue: 'unavailable' });
  });
});

describe('Guard command receipt plumbing — actual handler in an isolated Git fixture', () => {
  const require = createRequire(import.meta.url);
  const loader = require.resolve('tsx/esm');
  const handler = new URL('../../cli/commands/guard.ts', import.meta.url).href;
  let fixture;
  let server;
  let daemonUrl;
  let sessionLink;
  let expectedHarbor;
  let item;
  let itemStatus;
  const seen = [];

  beforeEach(async () => {
    fixture = mkdtempSync(join(homedir(), 'coding', 'tmp', 'guard-receipt-fixture-'));
    // Only this fixture gets empty hooks/config. The contributor worktree's
    // real Guard policy is never changed by these test Git commands.
    const fixtureEnv = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
    for (const args of [['init', '-b', 'main'], ['config', 'core.hooksPath', join(fixture, 'empty-hooks')]]) {
      expect(spawnSync('git', args, { cwd: fixture, env: fixtureEnv }).status).toBe(0);
    }
    mkdirSync(join(fixture, 'cli', 'commands'), { recursive: true });
    writeFileSync(join(fixture, 'cli', 'commands', 'guard.ts'), '// staged fixture\n');
    expect(spawnSync('git', ['add', 'cli/commands/guard.ts'], { cwd: fixture, env: fixtureEnv }).status).toBe(0);
    mkdirSync(join(fixture, '.portdaddy'));
    writeFileSync(join(fixture, '.portdaddy', 'coordination-guard.json'), JSON.stringify({
      ...DEFAULT_GUARD_CONFIG, enabled: true, mode: 'enforce', requireNotePerCommit: false,
    }));
    sessionLink = linked.roadmapLink;
    expectedHarbor = linked.harbor;
    const fixtureNow = Date.now();
    item = receipt({
      lastTouchedAt: fixtureNow,
      notes: [{ at: fixtureNow, by: 'fixture-agent', text: 'Exact own receipt' }],
    });
    itemStatus = 200;
    seen.length = 0;
    server = createServer((req, res) => {
      seen.push({ method: req.method, url: req.url });
      res.setHeader('Content-Type', 'application/json');
      const url = new URL(req.url, 'http://fixture.invalid');
      if (url.pathname === '/sugar/whoami') {
        res.end(JSON.stringify({ success: true, active: true, sessionId: 'fixture-session', agentId: 'fixture-agent', roadmapLink: sessionLink }));
      } else if (url.pathname === '/files/who-owns') {
        res.end(JSON.stringify({ owners: [{ sessionId: 'fixture-session', agentId: 'fixture-agent' }] }));
      } else if (url.pathname === `/roadmap/items/${linked.roadmapLink}` && url.searchParams.get('harbor') === expectedHarbor) {
        res.statusCode = itemStatus;
        res.end(JSON.stringify(itemStatus === 200 ? { success: true, item } : { success: false, error: 'fixture unavailable' }));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ success: false, error: 'unexpected fixture request' }));
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    daemonUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    if (fixture) rmSync(fixture, { recursive: true, force: true });
  });

  async function command(options = {}, envOverrides = {}, callerDir = fixture) {
    const child = spawn(process.execPath, ['--import', loader, '--input-type=module', '-e',
      `import { handleGuard } from ${JSON.stringify(handler)}; await handleGuard(['check'], ${JSON.stringify({ staged: true, json: true, ...options })});`,
    ], {
      cwd: callerDir,
      env: {
        PATH: process.env.PATH,
        PORT_DADDY_URL: daemonUrl,
        PORT_DADDY_FORCE_TCP: '1',
        PORT_DADDY_NO_RETRY: '1',
        PORT_DADDY_PREFIX: join(fixture, 'state'),
        PORT_DADDY_CONTEXT_DIR: join(fixture, 'context'),
        PORT_DADDY_CONTEXT_SLOT: 'fixture',
        PORT_DADDY_DISABLE_KEYCHAIN: '1',
        // tsx probes an optional parent IPC pipe under os.tmpdir(). Keep even
        // that missing probe inside owned scratch, never a global /tmp socket.
        TMPDIR: fixture,
        TSX_DISABLE_CACHE: '1',
        PD_AGENT_ID: 'fixture-agent', PD_SESSION_ID: 'fixture-session', PD_TEST: '1',
        GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
        NO_COLOR: '1', ...envOverrides,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 8000);
    try {
      const [code, signal] = await once(child, 'close');
      expect(signal).toBeNull();
      expect(stderr).not.toContain('ERR_MODULE_NOT_FOUND');
      return { code, report: JSON.parse(stdout) };
    } finally {
      clearTimeout(timeout);
    }
  }

  test('uses the daemon session link and explicit write-side harbor ahead of environment', async () => {
    const result = await command({ harbor: expectedHarbor }, { PD_HARBOR: 'wrong-environment-harbor' });
    expect(result).toMatchObject({ code: 0, report: { passed: true } });
    expect(seen.filter((r) => r.url.startsWith('/roadmap/'))).toEqual([
      { method: 'GET', url: `/roadmap/items/${linked.roadmapLink}?harbor=${expectedHarbor}` },
    ]);
    expect(seen.every((r) => r.method === 'GET')).toBe(true);
  });

  test('uses the existing environment harbor selection when no explicit option is supplied', async () => {
    expect(await command({}, { PD_HARBOR: expectedHarbor })).toMatchObject({ code: 0, report: { passed: true } });
  });

  test('uses the canonical Git project harbor when no override is supplied', async () => {
    expectedHarbor = basename(fixture);
    item.harbor = expectedHarbor;
    expect(await command()).toMatchObject({ code: 0, report: { passed: true } });
  });

  test.each(['project', 'environment', 'explicit'])('cross-repository --dir preserves %s harbor selection', async (selection) => {
    const callerDir = join(fixture, 'different-caller-repository');
    mkdirSync(callerDir);
    expect(spawnSync('git', ['init', '-b', 'main'], {
      cwd: callerDir,
      env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    }).status).toBe(0);
    expectedHarbor = selection === 'project' ? basename(fixture) : `${selection}-harbor`;
    item.harbor = expectedHarbor;
    const options = { dir: fixture, ...(selection === 'explicit' ? { harbor: expectedHarbor } : {}) };
    const env = selection === 'project' ? {} : { PD_HARBOR: selection === 'environment' ? expectedHarbor : 'wrong-environment-harbor' };
    expect(await command(options, env, callerDir)).toMatchObject({ code: 0, report: { passed: true } });
    expect(seen.filter((r) => r.url.startsWith('/roadmap/'))).toEqual([
      { method: 'GET', url: `/roadmap/items/${linked.roadmapLink}?harbor=${expectedHarbor}` },
    ]);
  });

  test.each([404, 503])('keeps missing and unavailable distinct through the actual command: HTTP %s', async (status) => {
    itemStatus = status;
    const result = await command({ harbor: expectedHarbor });
    expect(result.code).toBe(1);
    expect(result.report.violations.map((v) => v.code)).toEqual([
      status === 404 ? 'roadmap-receipt-missing' : 'roadmap-receipt-unverifiable',
    ]);
    expect(seen.filter((r) => r.url.startsWith('/roadmap/'))).toHaveLength(1);
  });
});
