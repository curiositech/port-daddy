import { afterAll, afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pdFetch = jest.fn();
const exit = jest.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit(${code})`);
});
let logSpy;
let errorSpy;

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  PORT_DADDY_URL: 'http://127.0.0.1:9876',
  pdFetch,
}));

const { handleRoadmap, resolveRoadmapHarbor, renderChompTree, buildChompPrBody } =
  await import('../../cli/commands/roadmap.js');

const fixture = {
  generatedAt: 1,
  sources: {
    roadmapPath: '/repo/docs/ROADMAP.md',
    ideasTrovePath: '/repo/docs/recovery/IDEAS-TROVE.md',
    dogfoodFeedbackPath: '/repo/docs/recovery/DOGFOOD-FEEDBACK.md',
    currentWorkPath: '/repo/docs/recovery/CURRENT-WORK.md',
    cartographerStatusPath: '/repo/.cartographer/status.md',
  },
  freshness: { latestUpdateMs: 1, hoursSinceLastUpdate: 0.2 },
  nextCuts: [{ slug: 'cartographer-roadmap-progress-screen', summary: 'Surface roadmap state.' }],
  ideasNow: [{ slug: 'cartographer-roadmap-progress-screen', status: 'now', surface: 'Fleet UI', hook: 'one glance' }],
  liveFeedback: [{
    slug: 'cartographer-live-body-salvage-friction',
    status: 'open',
    surface: 'CLI',
    hook: 'operator asks whether Cartographer can listen',
    feedbackId: 'fb-1',
    severity: 'high',
    droppedBy: 'agent-dfdc92f3',
    provenance: 'tuple',
  }],
  feedbackSummary: {
    total: 1,
    open: 1,
    harvested: 0,
    bySeverity: { low: 0, medium: 0, high: 1, critical: 0 },
    bySurface: { CLI: 1 },
  },
  dogfoodFeedback: [{ slug: 'coordination-ticker-as-high-signal-feed', status: 'backlog', surface: 'Fleet UI', hook: null }],
  currentWorkExcerpt: '# Current\nActive slice.',
  cartographerStatusExcerpt: '# Status\nNominal.',
  warnings: [],
};

beforeEach(() => {
  pdFetch.mockReset();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy?.mockRestore();
  errorSpy?.mockRestore();
});

afterAll(() => {
  exit.mockRestore();
});

// ADR-0033: the roadmap_items SQL table is the source of truth. `pd roadmap`
// reads from GET /roadmap/items, NOT by re-parsing markdown via
// /cartographer/roadmap-progress (that was the markdown-as-DB bug).
const itemsFixture = {
  success: true,
  count: 2,
  items: [
    {
      id: 'r1',
      slug: 'cartographer-roadmap-progress-screen',
      summaryMd: 'Surface roadmap state in one glance.',
      status: 'now',
      promotedFromFeedbackId: null,
      promotedByAgentId: 'agent-cartographer',
      promotedAt: null,
      lastTouchedAt: 1,
      dependencies: [],
      notes: [],
      harbor: 'port-daddy:fleet',
    },
    {
      id: 'r2',
      slug: 'daemon-introspection-api',
      summaryMd: 'Unified daemon health view.',
      status: 'now',
      promotedFromFeedbackId: null,
      promotedByAgentId: null,
      promotedAt: null,
      lastTouchedAt: 2,
      dependencies: [],
      notes: [],
      harbor: 'port-daddy:fleet',
    },
  ],
};

describe('pd roadmap', () => {
  test('lists from the roadmap_items SQL table, not the markdown piles', async () => {
    pdFetch.mockResolvedValue({
      ok: true,
      json: async () => itemsFixture,
    });

    await handleRoadmap({ json: true });

    const url = pdFetch.mock.calls[0][0];
    expect(url).toContain('/roadmap/items');
    expect(url).not.toContain('/cartographer/roadmap-progress');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('cartographer-roadmap-progress-screen'));
  });

  test('quiet output prints one slug per line from the table', async () => {
    pdFetch.mockResolvedValue({
      ok: true,
      json: async () => itemsFixture,
    });

    await handleRoadmap({ quiet: true });

    expect(console.log).toHaveBeenCalledWith([
      'cartographer-roadmap-progress-screen',
      'daemon-introspection-api',
    ].join('\n'));
  });

  test('import-markdown backfills the table from the curated piles', async () => {
    pdFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        candidates: [{ slug: 'a', summaryMd: 'A', status: 'now', source: 'next-cut' }],
        inserted: ['a'],
        updated: [],
        parsed: { nextCuts: 1, ideasNow: 0, dogfood: 0 },
        missingFiles: [],
        dryRun: false,
      }),
    });

    await handleRoadmap(['import-markdown'], { dir: '/Users/test/port-daddy', json: true });

    const url = pdFetch.mock.calls[0][0];
    expect(url).toContain('/roadmap/import-markdown');
    const opts = pdFetch.mock.calls[0][1];
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toMatchObject({ rootDir: '/Users/test/port-daddy' });
  });

  test('upsert writes a roadmap item receipt into the table', async () => {
    pdFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        success: true,
        item: {
          id: 'r3',
          slug: 'swarm-coordination',
          summaryMd: 'Make swarm coordination governed and enforceable.',
          status: 'now',
          promotedFromFeedbackId: null,
          promotedByAgentId: 'agent-1',
          promotedAt: 1,
          lastTouchedAt: 2,
          dependencies: [],
          notes: [],
          harbor: 'fleet',
        },
      }),
    });

    await handleRoadmap(['upsert', 'swarm-coordination'], {
      summary: 'Make swarm coordination governed and enforceable.',
      status: 'now',
      as: 'agent-1',
      note: 'phase 0 implementation',
      json: true,
    });

    expect(pdFetch).toHaveBeenCalledWith(
      '/roadmap/items',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    const body = JSON.parse(pdFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      slug: 'swarm-coordination',
      summaryMd: 'Make swarm coordination governed and enforceable.',
      status: 'now',
      promotedByAgentId: 'agent-1',
    });
    expect(body.notes[0]).toMatchObject({ by: 'agent-1', text: 'phase 0 implementation' });
  });

  test('harbor resolution falls back to cwd basename outside a git repository', () => {
    const previousCwd = process.cwd();
    const previousHarbor = process.env.PD_HARBOR;
    const root = mkdtempSync(join(tmpdir(), 'pd-roadmap-harbor-'));
    const projectDir = join(root, 'standalone-project');
    mkdirSync(projectDir);
    delete process.env.PD_HARBOR;

    try {
      process.chdir(projectDir);
      expect(resolveRoadmapHarbor({})).toBe('standalone-project');
    } finally {
      process.chdir(previousCwd);
      if (previousHarbor === undefined) {
        delete process.env.PD_HARBOR;
      } else {
        process.env.PD_HARBOR = previousHarbor;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('harbor resolution uses the canonical project name inside a linked worktree', () => {
    const previousCwd = process.cwd();
    const previousHarbor = process.env.PD_HARBOR;
    const root = mkdtempSync(join(tmpdir(), 'pd-roadmap-linked-harbor-'));
    const projectDir = join(root, 'canonical-harbor');
    const linkedWorktree = join(root, 'linked-feature');
    mkdirSync(projectDir);
    delete process.env.PD_HARBOR;

    try {
      execFileSync('git', ['init'], { cwd: projectDir, stdio: 'ignore' });
      execFileSync('git', [
        '-c', 'user.name=Port Daddy Test',
        '-c', 'user.email=port-daddy-test@example.invalid',
        'commit', '--allow-empty', '-m', 'initial',
      ], { cwd: projectDir, stdio: 'ignore' });
      execFileSync('git', ['worktree', 'add', '-b', 'feature-roadmap', linkedWorktree], {
        cwd: projectDir,
        stdio: 'ignore',
      });

      process.chdir(linkedWorktree);
      expect(resolveRoadmapHarbor({})).toBe('canonical-harbor');
    } finally {
      process.chdir(previousCwd);
      if (previousHarbor === undefined) {
        delete process.env.PD_HARBOR;
      } else {
        process.env.PD_HARBOR = previousHarbor;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('touch posts one receipt, never a fetched item or historical notes', async () => {
    const { writeCurrentContext } = await import('../../cli/utils/current-context.js');
    const keys = ['PORT_DADDY_CONTEXT_DIR', 'PORT_DADDY_CONTEXT_SLOT', 'PD_AGENT_ID', 'PD_SESSION_ID', 'PD_ACTOR_CREDENTIAL', 'PORT_DADDY_ACTOR_CREDENTIAL'];
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    const directory = mkdtempSync(join(process.env.HOME, 'coding', 'tmp', 'roadmap-touch-contract-'));
    try {
      for (const key of keys) delete process.env[key];
      process.env.PORT_DADDY_CONTEXT_DIR = directory;
      process.env.PORT_DADDY_CONTEXT_SLOT = 'synthetic-touch';
      writeCurrentContext({ sessionId: 'session-one', agentId: 'agent-1', credential: 'actor-one.synthetic-only' });
      pdFetch.mockImplementation(async (_url, init) => {
        const body = JSON.parse(init.body);
        const note = { ...body.note, by: 'agent-1' };
        return { ok: true, status: 200, json: async () => ({ success: true,
          item: { slug: 'swarm-coordination', harbor: 'fleet', notes: [note] },
          receipt: { sessionId: body.sessionId, actorId: 'actor-one', note } }) };
      });
      await handleRoadmap(['touch', 'swarm-coordination'], { harbor: 'fleet', note: 'guard receipt', json: true });
      expect(pdFetch).toHaveBeenCalledTimes(1);
      expect(pdFetch.mock.calls[0][0]).toBe('http://127.0.0.1:9876/roadmap/items/swarm-coordination/touch?harbor=fleet');
      expect(JSON.parse(pdFetch.mock.calls[0][1].body)).toEqual({ sessionId: 'session-one', note: { at: expect.any(Number), text: 'guard receipt' } });
    } finally {
      for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
      rmSync(directory, { recursive: true });
    }
  });

  test('ack harvests live feedback from the roadmap surface', async () => {
    pdFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, entry: { feedbackId: 'fb-1', status: 'harvested' } }),
    });

    await handleRoadmap(['ack', 'fb-1'], { as: 'cartographer', into: 'cartographer-live-body-salvage-friction' });

    expect(pdFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/feedback/fb-1/harvest',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          harvestedBy: 'cartographer',
          intoSlug: 'cartographer-live-body-salvage-friction',
        }),
      }),
    );
  });
});

// Operator mandate 2026-08-22: `pd roadmap chomp` is the general planning-doc
// ingestion verb — parse ANY markdown planning doc into roadmap items via the
// daemon, preview with --dry-run, and emit the doc-removal PR artifacts.
describe('pd roadmap chomp', () => {
  const chompFixture = {
    success: true,
    docs: [{ path: 'PLAN.md', format: 'planning-doc', parsed: 3, missing: false }],
    items: [
      {
        slug: 'v4-plan', kind: 'project', status: 'backlog', summaryMd: 'V4 Plan',
        descriptionMd: 'Body.', parent: null, dependsOn: [], tags: ['plan'],
        sourcePath: 'PLAN.md', depth: 0, action: 'inserted', protected: false,
      },
      {
        slug: 'phase-1', kind: 'epic', status: 'now', summaryMd: 'Phase 1',
        descriptionMd: null, parent: 'v4-plan', dependsOn: ['anchor'], tags: ['plan'],
        sourcePath: 'PLAN.md', depth: 1, action: 'inserted', protected: false,
      },
      {
        slug: 'old-row', kind: 'task', status: 'now', summaryMd: 'Existing row',
        descriptionMd: null, parent: 'v4-plan', dependsOn: [], tags: ['plan'],
        sourcePath: 'PLAN.md', depth: 1, action: 'updated', protected: true,
      },
    ],
    inserted: ['v4-plan', 'phase-1'],
    updated: ['old-row'],
    parentEdges: [
      { parent: 'v4-plan', child: 'phase-1' },
      { parent: 'v4-plan', child: 'old-row' },
    ],
    parentEdgesWritten: 2,
    dangling: [],
    warnings: [],
    enrichment: null,
    missingFiles: [],
    sourceCommit: null,
    dryRun: false,
  };

  test('posts the docs to /roadmap/chomp with root, harbor, and dry-run flags', async () => {
    pdFetch.mockResolvedValue({ ok: true, json: async () => ({ ...chompFixture, dryRun: true }) });

    await handleRoadmap(['chomp', 'PLAN.md', 'docs/V4.md'], {
      dir: '/repo',
      harbor: 'port-daddy',
      as: 'agent-1',
      'dry-run': true,
      json: true,
    });

    expect(pdFetch.mock.calls[0][0]).toContain('/roadmap/chomp');
    const body = JSON.parse(pdFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      rootDir: '/repo',
      paths: ['PLAN.md', 'docs/V4.md'],
      harbor: 'port-daddy',
      by: 'agent-1',
      dryRun: true,
    });
  });

  test('bare chomp (no --emit-pr-plan) is a PREVIEW — the daemon is asked for a dry run', async () => {
    // Single-writer doctrine: roadmap writes land through a reviewed PR, so
    // without the PR-plan flag the CLI must never request a real write.
    pdFetch.mockResolvedValue({ ok: true, json: async () => ({ ...chompFixture, dryRun: true }) });

    await handleRoadmap(['chomp', 'PLAN.md'], { dir: '/repo', harbor: 'port-daddy', json: true });

    const body = JSON.parse(pdFetch.mock.calls[0][1].body);
    expect(body.dryRun).toBe(true);
  });

  test('--emit-pr-plan performs the real write and emits snapshot + receipt + git-rm list + PR body', async () => {
    const { mkdtempSync, readFileSync, rmSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const planDir = mkdtempSync(join(tmpdir(), 'pd-chomp-plan-'));
    const rootDir = mkdtempSync(join(tmpdir(), 'pd-chomp-root-'));

    pdFetch.mockImplementation(async (url) => {
      if (String(url).includes('/roadmap/chomp')) {
        return { ok: true, json: async () => ({ ...chompFixture, sourceCommit: 'abc1234' }) };
      }
      // buildRoadmapSnapshot's GET /roadmap/items read.
      return {
        ok: true,
        json: async () => ({
          success: true,
          items: [{ slug: 'v4-plan', status: 'backlog', summaryMd: 'V4 Plan' }],
        }),
      };
    });

    try {
      await handleRoadmap(['chomp', 'PLAN.md'], {
        dir: rootDir,
        harbor: 'port-daddy',
        'emit-pr-plan': planDir,
        json: true,
      });

      // The daemon was asked for a REAL write (no dryRun flag in the body).
      const body = JSON.parse(pdFetch.mock.calls[0][1].body);
      expect(body.dryRun).toBeUndefined();

      expect(existsSync(join(planDir, 'roadmap.snapshot.json'))).toBe(true);
      expect(existsSync(join(planDir, 'remove-docs.txt'))).toBe(true);
      expect(readFileSync(join(planDir, 'remove-docs.txt'), 'utf8')).toBe('PLAN.md\n');

      const receipt = JSON.parse(readFileSync(join(planDir, 'chomp-receipt.json'), 'utf8'));
      expect(receipt.receipt).toBe('roadmap-chomp');
      expect(receipt.sourceCommit).toBe('abc1234');
      expect(receipt.inserted).toEqual(['v4-plan', 'phase-1']);
      expect(receipt.items.find((i) => i.slug === 'old-row').protected).toBe(true);
      expect(receipt.skipped).toBeDefined();

      const prBody = readFileSync(join(planDir, 'pr-body.md'), 'utf8');
      expect(prBody).toContain('## Summary');
      expect(prBody).toContain('chomp-receipt.json');
    } finally {
      rmSync(planDir, { recursive: true, force: true });
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('requires at least one doc path', async () => {
    await expect(handleRoadmap(['chomp'], {})).rejects.toThrow('process.exit(1)');
    expect(pdFetch).not.toHaveBeenCalled();
  });

  test('refuses --emit-pr-plan combined with --dry-run (the plan snapshots real writes)', async () => {
    await expect(
      handleRoadmap(['chomp', 'PLAN.md'], { 'dry-run': true, 'emit-pr-plan': '/tmp/x' }),
    ).rejects.toThrow('process.exit(1)');
    expect(pdFetch).not.toHaveBeenCalled();
  });

  test('renderChompTree indents children under parents and marks protected rows', () => {
    const lines = renderChompTree(chompFixture.items);
    expect(lines[0]).toBe('- v4-plan [project/backlog]');
    expect(lines).toContain('  - phase-1 [epic/now]  deps: anchor');
    expect(lines.some((l) => l.includes('old-row [task/now/protected]'))).toBe(true);
  });

  test('buildChompPrBody fills the gated PR template with tree, git-rm list, and trailers', () => {
    const body = buildChompPrBody({
      result: chompFixture,
      docPaths: ['PLAN.md'],
      harbor: 'port-daddy',
      snapshotRelPath: 'docs/roadmap/roadmap.snapshot.json',
    });
    expect(body).toContain('## Summary');
    expect(body).toContain('## Test Plan');
    expect(body).toContain('- `PLAN.md`');
    expect(body).toContain('- v4-plan [project/backlog]');
    expect(body).toContain('visual-exempt:');
    expect(body).toContain('Roadmap-Item: none —');
    expect(body).toContain('Roadmap-Spawns: v4-plan, phase-1');
  });
});

describe('pd roadmap search', () => {
  test('builds the query, harbor, and limit params and requests GET /roadmap/search', async () => {
    pdFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, hits: [] }),
    });

    await handleRoadmap(['search', 'fix', 'the', 'login', 'bug'], { harbor: 'port-daddy', limit: 3, json: true });

    expect(pdFetch).toHaveBeenCalledTimes(1);
    const url = new URL(pdFetch.mock.calls[0][0], 'http://x');
    expect(url.pathname).toBe('/roadmap/search');
    expect(url.searchParams.get('q')).toBe('fix the login bug');
    expect(url.searchParams.get('harbor')).toBe('port-daddy');
    expect(url.searchParams.get('limit')).toBe('3');
  });

  test('--json prints the hits as structured JSON', async () => {
    const hits = [{ slug: 'fix-login-bug', status: 'now', summaryMd: 'Fix the login bug', stage: 'bm25', score: 0.9 }];
    pdFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, hits }),
    });

    await handleRoadmap(['search', 'login', 'bug'], { json: true });

    const printed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(printed).toEqual({ success: true, hits, count: 1 });
  });

  test('requires a query — usage error and no request when neither positional nor --q is given', async () => {
    await expect(handleRoadmap(['search'], {})).rejects.toThrow('process.exit(1)');
    expect(pdFetch).not.toHaveBeenCalled();
  });

  test('a non-ok response exits 1 rather than printing partial results', async () => {
    pdFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'search index unavailable' }),
    });

    await expect(handleRoadmap(['search', 'anything'], {})).rejects.toThrow('process.exit(1)');
  });
});
