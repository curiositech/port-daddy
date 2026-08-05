import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from '../setup-unit.js';
import { createGraphEdges } from '../../lib/graph-edges.js';
import { createSemanticResolver, ensureOnnxRuntimeNativeLibFindable } from '../../lib/semantic-resolver.js';

function unitVector(components) {
  const magnitude = Math.sqrt(components.reduce((total, value) => total + (value * value), 0));
  return components.map((value) => value / magnitude);
}

/**
 * Build a mock embedder where the first axis controls similarity to the
 * canonical "site" term and the remaining axes keep cross-similarity low.
 */
function createMockEmbedder() {
  const vectors = new Map([
    ['css design-system port-daddy site', unitVector([1, 0, 0, 0])],
    ['css design-system port-daddy docs', unitVector([0.89, 0.456, 0, 0])],
    ['css design-system port-daddy api', unitVector([0.81, 0, 0.586, 0])],
    ['css design-system port-daddy cli', unitVector([0.5, 0, 0, 0.866])],
    ['port daddy css tokens', unitVector([1, 0, 0, 0])],
  ]);

  return {
    modelId: 'mock-mini-lm',
    async embed(texts) {
      return texts.map((text) => vectors.get(text) ?? unitVector([0.2, 0.2, 0.2, 0.2]));
    },
  };
}

function alias(raw, canonical, fingerprint) {
  return {
    raw,
    canonical,
    tokens: canonical.split(' '),
    fingerprint,
  };
}

describe('semantic resolver', () => {
  let db;
  let graphEdges;
  let tupleWrites;
  let counterBumps;
  let resolver;

  beforeEach(() => {
    db = createTestDb();
    graphEdges = createGraphEdges(db);
    tupleWrites = [];
    counterBumps = [];
    resolver = createSemanticResolver(db, {
      modelId: 'mock-mini-lm',
      autoThreshold: 0.88,
      reviewThreshold: 0.8,
      boundaryMargin: 0.02,
      graphEdges,
      tuples: {
        out(fields, options) {
          tupleWrites.push({ fields, options });
          return { id: tupleWrites.length, fields, harbor: options?.harbor ?? null };
        },
      },
      counters: {
        bump(name, dimensions) {
          counterBumps.push({ name, dimensions });
        },
      },
      embedder: createMockEmbedder(),
    });
  });

  afterEach(() => {
    db.close();
  });

  test('records seeded, auto, review, and reject decisions with threshold stats', async () => {
    resolver.observeAliases({
      projectDir: '/tmp/port-daddy',
      harbor: 'port-daddy:fleet',
      sourceType: 'memory',
      sourceId: 'session-css-1',
      agentId: 'designer',
      aliases: [
        alias('Writing the CSS for Port Daddy website design system', 'css design-system port-daddy site', 'site-1'),
        alias('Port Daddy docs design system css', 'css design-system port-daddy docs', 'docs-1'),
        alias('Port Daddy API design system css', 'css design-system port-daddy api', 'api-1'),
        alias('Port Daddy CLI design system css', 'css design-system port-daddy cli', 'cli-1'),
      ],
    });

    await resolver.flush();

    const allEvents = resolver.listResolutions({ projectDir: '/tmp/port-daddy', limit: 10 });
    expect(allEvents.map((event) => event.decision).sort()).toEqual(['auto', 'reject', 'review', 'seeded']);

    const autoEvent = allEvents.find((event) => event.decision === 'auto');
    const reviewEvent = allEvents.find((event) => event.decision === 'review');
    const rejectEvent = allEvents.find((event) => event.decision === 'reject');

    expect(autoEvent?.candidateTerm).toBe('css design-system port-daddy site');
    expect(autoEvent?.similarity).toBeCloseTo(0.89, 2);
    expect(reviewEvent?.candidateTerm).toBe('css design-system port-daddy site');
    expect(reviewEvent?.similarity).toBeCloseTo(0.81, 2);
    expect(rejectEvent?.candidateTerm).toBe('css design-system port-daddy site');
    expect(rejectEvent?.similarity).toBeCloseTo(0.5, 2);

    const stats = resolver.stats('/tmp/port-daddy');
    expect(stats.model).toBe('mock-mini-lm');
    expect(stats.totalTerms).toBe(4);
    expect(stats.totalEvents).toBe(4);
    expect(stats.reviewBacklog).toBe(1);
    expect(stats.decisions).toMatchObject({
      seeded: 1,
      auto: 1,
      review: 1,
      reject: 1,
      error: 0,
    });
    expect(stats.nearAutoBoundary).toBe(1);
    expect(stats.nearReviewBoundary).toBe(1);

    expect(tupleWrites.filter((entry) => entry.fields[0] === 'semantic:resolution')).toHaveLength(4);
    expect(tupleWrites.some((entry) => entry.fields[1] === 'review')).toBe(true);

    const embeddingMatchEdges = graphEdges.list({ edgeType: 'embedding_match' });
    const embeddingCandidateEdges = graphEdges.list({ edgeType: 'embedding_candidate' });
    expect(embeddingMatchEdges).toHaveLength(1);
    expect(embeddingCandidateEdges.length).toBeGreaterThanOrEqual(2);

    expect(counterBumps.some((entry) => entry.name === 'semantic.resolution.auto')).toBe(true);
    expect(counterBumps.some((entry) => entry.name === 'semantic.resolution.review')).toBe(true);
    expect(counterBumps.some((entry) => entry.name === 'semantic.resolution.boundary')).toBe(true);
  });

  test('supports semantic nearest-neighbor search over learned terms', async () => {
    resolver.observeAliases({
      projectDir: '/tmp/port-daddy',
      harbor: 'port-daddy:fleet',
      sourceType: 'merge',
      sourceId: 'entry:12',
      aliases: [
        alias('Writing the CSS for Port Daddy website design system', 'css design-system port-daddy site', 'site-1'),
        alias('Port Daddy docs design system css', 'css design-system port-daddy docs', 'docs-1'),
      ],
    });

    await resolver.flush();

    const matches = await resolver.search('port daddy css tokens', { limit: 2 });
    expect(matches).toHaveLength(2);
    expect(matches[0].term).toBe('css design-system port-daddy site');
    expect(matches[0].similarity).toBeGreaterThan(matches[1].similarity);
  });

  test('persists review overrides and applies them to future candidate pairs', async () => {
    resolver.observeAliases({
      projectDir: '/tmp/port-daddy',
      harbor: 'port-daddy:fleet',
      sourceType: 'memory',
      sourceId: 'session-css-1',
      aliases: [
        alias('Writing the CSS for Port Daddy website design system', 'css design-system port-daddy site', 'site-1'),
        alias('Port Daddy API design system css', 'css design-system port-daddy api', 'api-1'),
      ],
    });

    await resolver.flush();

    const reviewEvent = resolver
      .listResolutions({ projectDir: '/tmp/port-daddy', decision: 'review', limit: 1 })[0];
    expect(reviewEvent.candidateTerm).toBe('css design-system port-daddy site');

    const reviewed = resolver.review(reviewEvent.id, {
      action: 'reject',
      reviewer: 'operator',
      note: 'API styling is a separate workstream.',
    });

    expect(reviewed.decision).toBe('rejected');
    expect(reviewed.reviewAction).toBe('reject');
    expect(reviewed.reviewedBy).toBe('operator');

    resolver.observeAliases({
      projectDir: '/tmp/port-daddy',
      harbor: 'port-daddy:fleet',
      sourceType: 'merge',
      sourceId: 'entry:api-repeat',
      aliases: [
        alias('API styling again', 'css design-system port-daddy api', 'api-2'),
      ],
    });

    await resolver.flush();

    const latest = resolver.listResolutions({
      projectDir: '/tmp/port-daddy',
      query: 'API styling again',
      limit: 1,
    })[0];
    expect(latest.decision).toBe('rejected');
    expect(latest.metadata?.override).toEqual(expect.objectContaining({
      action: 'reject',
      reviewer: 'operator',
    }));

    const stats = resolver.stats('/tmp/port-daddy');
    expect(stats.reviewBacklog).toBe(0);
    expect(stats.rejectedOverrides).toBeGreaterThanOrEqual(2);
    expect(tupleWrites.some((entry) => entry.fields[0] === 'semantic:review')).toBe(true);
  });
});

describe('ensureOnnxRuntimeNativeLibFindable', () => {
  const fallbackVar = process.platform === 'darwin' ? 'DYLD_FALLBACK_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
  let scratchDir;
  let originalCwd;
  let savedResourceDir;
  let savedFallbackVar;

  beforeEach(() => {
    scratchDir = mkdtempSync(join(tmpdir(), 'pd-onnx-resource-dir-'));
    // The real repo checkout has node_modules/onnxruntime-node on disk, which
    // would satisfy the cwd-relative dev-install candidate and mask what
    // these tests actually verify (PORT_DADDY_RESOURCE_DIR resolution).
    // Run from an empty cwd so only the explicit candidate under test exists.
    originalCwd = process.cwd();
    process.chdir(scratchDir);
    savedResourceDir = process.env.PORT_DADDY_RESOURCE_DIR;
    savedFallbackVar = process.env[fallbackVar];
    delete process.env[fallbackVar];
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(scratchDir, { recursive: true, force: true });
    if (savedResourceDir === undefined) delete process.env.PORT_DADDY_RESOURCE_DIR;
    else process.env.PORT_DADDY_RESOURCE_DIR = savedResourceDir;
    if (savedFallbackVar === undefined) delete process.env[fallbackVar];
    else process.env[fallbackVar] = savedFallbackVar;
  });

  test('is a no-op when no packaged native dir exists anywhere', () => {
    process.env.PORT_DADDY_RESOURCE_DIR = scratchDir;
    ensureOnnxRuntimeNativeLibFindable();
    expect(process.env[fallbackVar]).toBeUndefined();
  });

  test('fails loudly when a packaged runtime was not configured before process start', () => {
    const platformArch = `${process.platform}-${process.arch}`;
    const nativeDir = join(scratchDir, 'dist', 'native', 'onnxruntime-node', platformArch);
    mkdirSync(nativeDir, { recursive: true });
    writeFileSync(join(nativeDir, 'libonnxruntime.fake.dylib'), 'not a real binary, just proving path resolution');
    process.env.PORT_DADDY_RESOURCE_DIR = scratchDir;

    expect(() => ensureOnnxRuntimeNativeLibFindable()).toThrow(
      new RegExp(`launched without ${fallbackVar}`),
    );
    expect(process.env[fallbackVar]).toBeUndefined();
  });

  test('accepts a packaged runtime already present in the launch environment', () => {
    const platformArch = `${process.platform}-${process.arch}`;
    const nativeDir = join(scratchDir, 'dist', 'native', 'onnxruntime-node', platformArch);
    const alternateDir = join(scratchDir, 'named-profile', 'native', 'onnxruntime-node', platformArch);
    mkdirSync(nativeDir, { recursive: true });
    mkdirSync(alternateDir, { recursive: true });
    writeFileSync(
      join(alternateDir, process.platform === 'darwin' ? 'libonnxruntime.1.dylib' : 'libonnxruntime.so.1'),
      'alternate packaged runtime',
    );
    process.env.PORT_DADDY_RESOURCE_DIR = scratchDir;
    process.env[fallbackVar] = `${alternateDir}:/some/pre-existing/path`;

    ensureOnnxRuntimeNativeLibFindable();

    expect(process.env[fallbackVar]).toBe(`${alternateDir}:/some/pre-existing/path`);
  });
});
