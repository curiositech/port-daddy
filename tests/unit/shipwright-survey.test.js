// Shipwright Survey — verifies deterministic project survey output (no LLM)
// and the LLM-augmented path with a stub client. Uses a temp dir per test,
// injects `runGit` to make commit history deterministic, and freezes `now()`.

import { jest } from '@jest/globals';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { surveyProject } = await import('../../lib/shipwright/survey.js');

let tmpRoot;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'pd-survey-test-'));
});

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

function fakeGit(map = {}) {
  return (args, _cwd) => {
    if (args[0] === 'log' && args.includes('--since=30 days ago') && args.includes('--oneline')) {
      return map.commits ?? '';
    }
    if (args[0] === 'log' && args.includes('--since=30 days ago') && args.includes('--name-only')) {
      return map.nameOnly ?? '';
    }
    if (args[0] === 'log' && args[1] === '-1') {
      const path = args[args.length - 1];
      return (map.lastTouched && map.lastTouched[path]) ?? '';
    }
    return '';
  };
}

function frozenNow(iso = '2026-05-01T12:00:00.000Z') {
  return () => new Date(iso);
}

test('throws on a nonexistent root', async () => {
  await expect(surveyProject(join(tmpRoot, 'does-not-exist'))).rejects.toThrow(/does not exist/);
});

test('classifies a fastify TS daemon as server-daemon with typescript', async () => {
  writeFileSync(join(tmpRoot, 'package.json'), JSON.stringify({
    name: 'demo-api',
    dependencies: { fastify: '^4.0.0' },
    devDependencies: { typescript: '^5.0.0' },
  }));
  writeFileSync(join(tmpRoot, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }));
  writeFileSync(join(tmpRoot, 'README.md'), '# Demo API\n\nA fastify server for demo purposes.\n');

  const survey = await surveyProject(tmpRoot, { runGit: fakeGit(), now: frozenNow() });
  expect(survey.classification.kind).toBe('server-daemon');
  expect(survey.classification.languages).toContain('typescript');
  expect(survey.classification.frameworks).toContain('fastify');
  expect(survey.intent).toBe('Demo API');
  expect(survey.purpose).toContain('fastify server');
});

test('classifies a Next.js app as web-app and detects react opportunity for playwright', async () => {
  writeFileSync(join(tmpRoot, 'package.json'), JSON.stringify({
    name: 'demo-site',
    dependencies: { next: '^14.0.0', react: '^18.0.0' },
    devDependencies: { typescript: '^5.0.0' },
  }));
  writeFileSync(join(tmpRoot, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: false } }));
  writeFileSync(join(tmpRoot, 'README.md'), '# Demo Site\n\nThe public marketing site.\n');

  const survey = await surveyProject(tmpRoot, { runGit: fakeGit(), now: frozenNow() });
  expect(survey.classification.kind).toBe('web-app');
  expect(survey.classification.frameworks).toContain('next');
  expect(survey.opportunities.some((o) => o.toLowerCase().includes('playwright'))).toBe(true);
  expect(survey.opportunities.some((o) => o.toLowerCase().includes('strict'))).toBe(true);
});

test('hot project without tests surfaces a coverage risk', async () => {
  writeFileSync(join(tmpRoot, 'package.json'), JSON.stringify({ name: 'busy', dependencies: { fastify: '^4.0.0' } }));
  writeFileSync(join(tmpRoot, 'README.md'), '# Busy\n');
  // 60 commits in last 30 days → hot
  const commitLines = Array.from({ length: 60 }, (_, i) => `abcdef${i} commit ${i}`).join('\n');

  const survey = await surveyProject(tmpRoot, { runGit: fakeGit({ commits: commitLines }), now: frozenNow() });
  expect(survey.status.activity).toBe('hot');
  expect(survey.status.commitsLast30d).toBe(60);
  expect(survey.risks.some((r) => r.toLowerCase().includes('coverage') || r.toLowerCase().includes('test'))).toBe(true);
});

test('activity buckets degrade as commit volume drops', async () => {
  writeFileSync(join(tmpRoot, 'package.json'), JSON.stringify({ name: 'lib', dependencies: {} }));

  const cold = await surveyProject(tmpRoot, { runGit: fakeGit({ commits: '' }), now: frozenNow() });
  expect(cold.status.activity).toBe('cold');

  const cool = await surveyProject(tmpRoot, { runGit: fakeGit({ commits: 'a\nb\nc\nd\ne' }), now: frozenNow() });
  expect(cool.status.activity).toBe('cool');

  const warm = await surveyProject(tmpRoot, { runGit: fakeGit({ commits: Array(20).fill('x').join('\n') }), now: frozenNow() });
  expect(warm.status.activity).toBe('warm');

  const hot = await surveyProject(tmpRoot, { runGit: fakeGit({ commits: Array(80).fill('x').join('\n') }), now: frozenNow() });
  expect(hot.status.activity).toBe('hot');
});

test('detects fleet config and surfaces cost hint', async () => {
  writeFileSync(join(tmpRoot, 'package.json'), JSON.stringify({ name: 'demo', dependencies: {} }));
  writeFileSync(join(tmpRoot, 'pd-fleet.yml'), `fleet:
  name: demo
  agents:
    gardener:
      backend: cloudflare
      budget_usd_per_day: 1.50
    qa:
      backend: cloudflare
      budget_usd_per_day: 2.00
`);

  const survey = await surveyProject(tmpRoot, { runGit: fakeGit(), now: frozenNow() });
  expect(survey.status.hasFleet).toBe(true);
  expect(survey.status.fleetSizeAgents).toBeGreaterThanOrEqual(2);
  expect(survey.costHintUsdPerDay).toBeGreaterThan(0);
});

test('hotFiles ranks by edit frequency and is bounded', async () => {
  writeFileSync(join(tmpRoot, 'package.json'), JSON.stringify({ name: 'demo' }));
  // Three files, with churn counts: a×5, b×3, c×1
  const nameOnly = [
    ...Array(5).fill('src/a.ts'),
    ...Array(3).fill('src/b.ts'),
    'src/c.ts',
  ].join('\n');

  const survey = await surveyProject(tmpRoot, { runGit: fakeGit({ nameOnly }), now: frozenNow() });
  expect(survey.hotFiles[0]).toBe('src/a.ts');
  expect(survey.hotFiles[1]).toBe('src/b.ts');
  expect(survey.hotFiles.length).toBeLessThanOrEqual(10);
});

test('counts test suites by walking the tree shallowly', async () => {
  writeFileSync(join(tmpRoot, 'package.json'), JSON.stringify({ name: 'demo' }));
  mkdirSync(join(tmpRoot, 'tests/unit'), { recursive: true });
  writeFileSync(join(tmpRoot, 'tests/unit/foo.test.js'), 'test("ok", () => {});');
  writeFileSync(join(tmpRoot, 'tests/unit/bar.test.ts'), 'test("ok", () => {});');
  writeFileSync(join(tmpRoot, 'tests/unit/not-a-test.js'), '');

  const survey = await surveyProject(tmpRoot, { runGit: fakeGit(), now: frozenNow() });
  expect(survey.status.testSuites).toBe(2);
});

test('confidence stays at heuristic baseline without LLM client', async () => {
  writeFileSync(join(tmpRoot, 'package.json'), JSON.stringify({ name: 'demo' }));
  const survey = await surveyProject(tmpRoot, { runGit: fakeGit(), now: frozenNow() });
  expect(survey.confidence).toBeCloseTo(0.55, 2);
});

test('LLM client overrides intent/purpose and bumps confidence', async () => {
  writeFileSync(join(tmpRoot, 'package.json'), JSON.stringify({ name: 'demo' }));
  writeFileSync(join(tmpRoot, 'README.md'), '# Heuristic Title\n\nHeuristic purpose paragraph.\n');

  const stubClient = {
    async complete(_req) {
      return {
        ok: true,
        text: JSON.stringify({
          intent: 'LLM-generated intent',
          purpose: 'LLM-generated purpose statement',
          risks: ['llm-risk-1', 'llm-risk-2'],
          opportunities: ['llm-opp-1'],
        }),
        cached: false,
        fellBack: false,
        model: 'mock/haiku',
        latencyMs: 10,
      };
    },
    stats() { return { cacheHits: 0, cacheMisses: 0, llmCalls: 1, llmFailures: 0, rateLimited: 0, timedOut: 0 }; },
    clearCache() {},
  };

  const survey = await surveyProject(tmpRoot, {
    runGit: fakeGit(),
    now: frozenNow(),
    client: stubClient,
    model: 'mock/haiku',
  });
  expect(survey.intent).toBe('LLM-generated intent');
  expect(survey.purpose).toBe('LLM-generated purpose statement');
  expect(survey.risks).toContain('llm-risk-1');
  expect(survey.opportunities).toContain('llm-opp-1');
  expect(survey.confidence).toBeCloseTo(0.82, 2);
});

test('LLM failure falls back to heuristic intent without throwing', async () => {
  writeFileSync(join(tmpRoot, 'package.json'), JSON.stringify({ name: 'demo' }));
  writeFileSync(join(tmpRoot, 'README.md'), '# Fallback Title\n\nFallback purpose.\n');

  const failingClient = {
    async complete(_req) { throw new Error('upstream 503'); },
    stats() { return { cacheHits: 0, cacheMisses: 0, llmCalls: 1, llmFailures: 1, rateLimited: 0, timedOut: 0 }; },
    clearCache() {},
  };

  const survey = await surveyProject(tmpRoot, {
    runGit: fakeGit(),
    now: frozenNow(),
    client: failingClient,
    model: 'mock/haiku',
  });
  expect(survey.intent).toBe('Fallback Title');
  expect(survey.confidence).toBeCloseTo(0.55, 2);
});

test('absent README and CLAUDE.md → docFreshness "absent"', async () => {
  writeFileSync(join(tmpRoot, 'package.json'), JSON.stringify({ name: 'demo' }));
  const survey = await surveyProject(tmpRoot, { runGit: fakeGit(), now: frozenNow() });
  expect(survey.status.docFreshness).toBe('absent');
});

test('surveyedAt is the injected now()', async () => {
  writeFileSync(join(tmpRoot, 'package.json'), JSON.stringify({ name: 'demo' }));
  const survey = await surveyProject(tmpRoot, {
    runGit: fakeGit(),
    now: frozenNow('2026-12-31T23:59:59.000Z'),
  });
  expect(survey.surveyedAt).toBe('2026-12-31T23:59:59.000Z');
});
