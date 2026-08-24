/**
 * Tests for routes/galaxy.ts + lib/galaxy.ts against real transcripts and
 * sessions modules on an in-memory DB.
 *
 * The embedder is a deterministic FAKE (bag-of-hashed-token vectors, 384-dim,
 * normalized) so CI never downloads MiniLM. It is topical: texts sharing
 * vocabulary embed near each other, so clustering behaves like the real thing.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import path from 'node:path';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createTranscripts } from '../../lib/transcripts.js';
import { createSessions } from '../../lib/sessions.js';
import { createGalaxy } from '../../lib/galaxy.js';
import { galaxyPlugin } from '../../routes/galaxy.js';
import { mulberry32 } from '../../lib/galaxy-math.js';

const NOW = 1_750_000_000_000;
const HOUR = 3_600_000;

// ---------------------------------------------------------------------------
// Deterministic fake embedder — 384-dim bag-of-hashed-token vectors
// ---------------------------------------------------------------------------

function tokenSeed(token) {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function deterministicHashVector384(text) {
  const out = new Array(384).fill(0);
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    const rand = mulberry32(tokenSeed(tok));
    for (let d = 0; d < 384; d++) out[d] += rand() - 0.5;
  }
  const mag = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
  return out.map((v) => v / mag);
}

function makeFakeEmbedder() {
  const embedder = {
    modelId: 'fake-hash-384',
    embedCalls: 0,
    textsEmbedded: 0,
    async embed(texts) {
      embedder.embedCalls += 1;
      embedder.textsEmbedded += texts.length;
      return texts.map(deterministicHashVector384);
    },
  };
  return embedder;
}

// ---------------------------------------------------------------------------
// Transcript seeding
// ---------------------------------------------------------------------------

const TOPIC_SQLITE =
  'sqlite migration wal checkpoint journal rollback schema versioning pragma synchronous durable writes vacuum analyze index rebuild ';
const TOPIC_CSS =
  'css theming oklch palette contrast tokens dark mode rollout typography spacing accent color audit stylesheet variables ';

/** ~700-char message content on a topic (comfortably over the token floor). */
function topicContent(topic, salt) {
  return `${salt} ${topic.repeat(6)}`;
}

function seedTranscript(transcripts, { id, ship, agentId, sessionId = null, project = null, startedAt, topic, salt, prNumber = null }) {
  const txId = transcripts.start({
    id,
    ship,
    spawned_agent_id: agentId,
    session_id: sessionId,
    pr_number: prNumber,
    trigger: 'manual',
    backend: 'claude',
    model: 'test-model',
    started_at: startedAt,
    project,
  });
  transcripts.appendMessage(txId, {
    role: 'user',
    content: topicContent(topic, `${salt} request`),
    timestamp: startedAt + 1,
  });
  transcripts.appendMessage(txId, {
    role: 'assistant',
    content: topicContent(topic, `${salt} response`),
    timestamp: startedAt + 2,
  });
  transcripts.finalize(txId, { status: 'completed', ended_at: startedAt + 60_000 });
  return txId;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('galaxy routes', () => {
  let db;
  let transcripts;
  let sessions;
  let embedder;
  let galaxy;
  let app;
  let sessionId;

  async function buildApp(galaxyModule) {
    const fastify = Fastify();
    await fastify.register(galaxyPlugin, { deps: { galaxy: galaxyModule } });
    await fastify.ready();
    return fastify;
  }

  beforeEach(async () => {
    db = createTestDb();
    transcripts = createTranscripts(db, { now: () => NOW });
    sessions = createSessions(db);
    embedder = makeFakeEmbedder();
    galaxy = createGalaxy({
      db,
      transcripts,
      sessions,
      embedder,
      now: () => NOW,
      seed: 42,
    });
    app = await buildApp(galaxy);

    // One transcript is session-linked with claims + a note.
    const started = sessions.start('Fix sqlite migration ordering', {
      agentId: 'agent-sqlite-1',
      files: ['lib/db.ts'],
    });
    expect(started.success).toBe(true);
    sessionId = started.id;
    sessions.addNote(sessionId, 'Scope: lib/db.ts. Assumptions: WAL stays on.');

    // Three sqlite-topic transcripts (one session-linked, one carrying a PR number)
    seedTranscript(transcripts, {
      id: 'tx_sql_1', ship: 'migrator', agentId: 'agent-sqlite-1', sessionId,
      project: 'port-daddy', startedAt: NOW - 1 * HOUR, topic: TOPIC_SQLITE, salt: 'one', prNumber: 123,
    });
    seedTranscript(transcripts, {
      id: 'tx_sql_2', ship: 'migrator', agentId: 'agent-sqlite-2',
      project: 'port-daddy', startedAt: NOW - 2 * HOUR, topic: TOPIC_SQLITE, salt: 'two',
    });
    seedTranscript(transcripts, {
      id: 'tx_sql_3', ship: 'migrator', agentId: 'agent-sqlite-3',
      project: 'port-daddy', startedAt: NOW - 3 * HOUR, topic: TOPIC_SQLITE, salt: 'three',
    });

    // Two css-topic transcripts under a different project
    seedTranscript(transcripts, {
      id: 'tx_css_1', ship: 'themer', agentId: 'agent-css-1',
      project: 'website', startedAt: NOW - 4 * HOUR, topic: TOPIC_CSS, salt: 'four',
    });
    seedTranscript(transcripts, {
      id: 'tx_css_2', ship: 'themer', agentId: 'agent-css-2',
      project: 'website', startedAt: NOW - 5 * HOUR, topic: TOPIC_CSS, salt: 'five',
    });

    // Below the significance floor (tiny tail) — excluded at default minTokens
    const tiny = transcripts.start({
      id: 'tx_tiny', ship: 'noop', spawned_agent_id: 'agent-tiny',
      trigger: 'manual', backend: 'claude', model: 'test-model', started_at: NOW - 1 * HOUR,
    });
    transcripts.appendMessage(tiny, { role: 'assistant', content: 'ok done', timestamp: NOW - HOUR + 1 });
    transcripts.finalize(tiny, { status: 'completed' });

    // Outside the 24h window — excluded regardless of size
    seedTranscript(transcripts, {
      id: 'tx_old', ship: 'migrator', agentId: 'agent-old',
      project: 'port-daddy', startedAt: NOW - 48 * HOUR, topic: TOPIC_SQLITE, salt: 'ancient',
    });
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  // -------------------------------------------------------------------------
  // GET /galaxy/map
  // -------------------------------------------------------------------------

  it('GET /galaxy/map returns an empty universe when there are no transcripts', async () => {
    const emptyDb = createTestDb();
    const emptyTranscripts = createTranscripts(emptyDb, { now: () => NOW });
    const emptySessions = createSessions(emptyDb);
    const emptyGalaxy = createGalaxy({
      db: emptyDb, transcripts: emptyTranscripts, sessions: emptySessions,
      embedder: makeFakeEmbedder(), now: () => NOW, seed: 42,
    });
    const emptyApp = await buildApp(emptyGalaxy);
    const res = await emptyApp.inject({ method: 'GET', url: '/galaxy/map' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.points).toEqual([]);
    expect(body.clusters).toEqual([]);
    expect(body.stats.sessionCount).toBe(0);
    await emptyApp.close();
    emptyDb.close();
  });

  it('GET /galaxy/map filters window + significance and returns valid points/clusters', async () => {
    const res = await app.inject({ method: 'GET', url: '/galaxy/map' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.computedAt).toBe(NOW);
    expect(body.params).toEqual({
      windowHours: 24, tailTokens: 4000, minTokens: 256, limit: 500, project: null, cluster: true,
    });

    const ids = body.points.map((p) => p.id).sort();
    expect(ids).toEqual(['tx_css_1', 'tx_css_2', 'tx_sql_1', 'tx_sql_2', 'tx_sql_3']);
    expect(body.stats.sessionCount).toBe(5);
    expect(body.stats.embeddedNow).toBe(5);
    expect(body.stats.cacheHits).toBe(0);
    expect(body.stats.embeddingCacheHits).toBe(0);
    expect(body.stats.responseCacheHits).toBe(0);

    for (const point of body.points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
      expect(point.clusterId).toBeGreaterThanOrEqual(0);
      expect(point.snippet.length).toBeLessThanOrEqual(140);
      expect(point.tailTokens).toBeGreaterThanOrEqual(256);
      expect(typeof point.agentId).toBe('string');
    }

    // Session-linked point picks up the session purpose; the PR number rides along
    const linked = body.points.find((p) => p.id === 'tx_sql_1');
    expect(linked.sessionId).toBe(sessionId);
    expect(linked.purpose).toBe('Fix sqlite migration ordering');
    expect(linked.prNumber).toBe(123);
    const unlinked = body.points.find((p) => p.id === 'tx_sql_2');
    expect(unlinked.sessionId).toBeNull();
    expect(unlinked.purpose).toBeNull();

    // Clusters: ids are 0..k-1 reindexed by size desc, sizes sum to point count,
    // centroids live on the normalized map, labels come from actual tail terms.
    expect(body.clusters.length).toBeGreaterThanOrEqual(1);
    const sizes = body.clusters.map((c) => c.size);
    expect(sizes.reduce((s, v) => s + v, 0)).toBe(5);
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
    body.clusters.forEach((cluster, i) => {
      expect(cluster.id).toBe(i);
      expect(cluster.centroid[0]).toBeGreaterThanOrEqual(0);
      expect(cluster.centroid[0]).toBeLessThanOrEqual(1);
      expect(cluster.centroid[1]).toBeGreaterThanOrEqual(0);
      expect(cluster.centroid[1]).toBeLessThanOrEqual(1);
      expect(typeof cluster.label).toBe('string');
      expect(cluster.label.length).toBeGreaterThan(0);
      for (const { term, mi } of cluster.terms) {
        expect(typeof term).toBe('string');
        expect(typeof mi).toBe('number');
      }
    });

    // Every point's clusterId maps to a returned cluster
    const clusterIds = new Set(body.clusters.map((c) => c.id));
    for (const point of body.points) {
      expect(clusterIds.has(point.clusterId)).toBe(true);
    }
  });

  it('separates the two planted topics into different clusters', async () => {
    const res = await app.inject({ method: 'GET', url: '/galaxy/map' });
    const body = JSON.parse(res.body);
    const clusterOf = (id) => body.points.find((p) => p.id === id).clusterId;
    // All sqlite transcripts share a cluster, all css transcripts share a
    // cluster, and the two topics are separated.
    expect(clusterOf('tx_sql_2')).toBe(clusterOf('tx_sql_3'));
    expect(clusterOf('tx_css_1')).toBe(clusterOf('tx_css_2'));
    expect(clusterOf('tx_sql_2')).not.toBe(clusterOf('tx_css_1'));
  });

  it('serves the second identical call from cache without re-embedding', async () => {
    const first = await app.inject({ method: 'GET', url: '/galaxy/map' });
    const callsAfterFirst = embedder.embedCalls;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = await app.inject({ method: 'GET', url: '/galaxy/map' });
    expect(embedder.embedCalls).toBe(callsAfterFirst); // no new embed work
    const firstBody = JSON.parse(first.body);
    const secondBody = JSON.parse(second.body);
    expect(secondBody.stats.cacheHits).toBe(firstBody.stats.cacheHits);
    expect(secondBody.stats.embeddingCacheHits).toBe(firstBody.stats.embeddingCacheHits);
    expect(secondBody.stats.responseCacheHits).toBe(1);
    expect(secondBody.computedAt).toBe(firstBody.computedAt);
    expect(secondBody.points).toEqual(firstBody.points);
    expect(secondBody.clusters).toEqual(firstBody.clusters);
  });

  it('produces a bitwise-identical map from a fresh instance over the same data (seed 42)', async () => {
    const first = JSON.parse((await app.inject({ method: 'GET', url: '/galaxy/map' })).body);

    // New galaxy instance, same db: embeddings come from the sqlite cache,
    // clustering + t-SNE re-run from seed 42.
    const galaxy2 = createGalaxy({
      db, transcripts, sessions, embedder: makeFakeEmbedder(), now: () => NOW, seed: 42,
    });
    const app2 = await buildApp(galaxy2);
    const second = JSON.parse((await app2.inject({ method: 'GET', url: '/galaxy/map' })).body);

    expect(second.stats.cacheHits).toBe(5);
    expect(second.stats.embeddingCacheHits).toBe(5);
    expect(second.stats.responseCacheHits).toBe(0);
    expect(second.stats.embeddedNow).toBe(0);
    expect(second.points).toEqual(first.points);
    expect(second.clusters).toEqual(first.clusters);
    await app2.close();
  });

  it('honors minTokens override (includes the tiny transcript)', async () => {
    const res = await app.inject({ method: 'GET', url: '/galaxy/map?minTokens=1' });
    const body = JSON.parse(res.body);
    const ids = body.points.map((p) => p.id);
    expect(ids).toContain('tx_tiny');
    expect(body.stats.sessionCount).toBe(6);
    expect(body.params.minTokens).toBe(1);
  });

  it('honors the project filter and degrades gracefully at P = 2', async () => {
    const res = await app.inject({ method: 'GET', url: '/galaxy/map?project=website' });
    const body = JSON.parse(res.body);
    expect(body.params.project).toBe('website');
    const ids = body.points.map((p) => p.id).sort();
    expect(ids).toEqual(['tx_css_1', 'tx_css_2']);
    // P < 4 → single cluster; P < 3 → t-SNE skipped, diagonal spread
    expect(body.clusters).toHaveLength(1);
    expect(body.clusters[0].id).toBe(0);
    expect(body.points.every((p) => p.clusterId === 0)).toBe(true);
  });

  it('honors windowHours override (wide window pulls in the old transcript)', async () => {
    const res = await app.inject({ method: 'GET', url: '/galaxy/map?windowHours=72' });
    const body = JSON.parse(res.body);
    expect(body.points.map((p) => p.id)).toContain('tx_old');
  });

  it('clamps tailTokens into [256, 16000]', async () => {
    const low = JSON.parse((await app.inject({ method: 'GET', url: '/galaxy/map?tailTokens=1' })).body);
    expect(low.params.tailTokens).toBe(256);
    const high = JSON.parse((await app.inject({ method: 'GET', url: '/galaxy/map?tailTokens=999999' })).body);
    expect(high.params.tailTokens).toBe(16000);
  });

  it('rejects malformed numeric params with 400', async () => {
    for (const url of [
      '/galaxy/map?windowHours=abc',
      '/galaxy/map?limit=-3',
      '/galaxy/map?tailTokens=0',
      '/galaxy/map?minTokens=nope',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(typeof body.error).toBe('string');
    }
  });

  it('rejects a malformed cluster param with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/galaxy/map?cluster=nope' });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe('string');
  });

  it('cluster=false skips k-means/MI labeling — empty clusters, every clusterId 0 — and gets its own cache entry', async () => {
    // First call: default clustering. Full embed work, own cache entry.
    const a = JSON.parse((await app.inject({ method: 'GET', url: '/galaxy/map' })).body);
    expect(a.params.cluster).toBe(true);
    expect(a.stats.cacheHits).toBe(0);
    expect(a.stats.embeddingCacheHits).toBe(0);
    expect(a.stats.responseCacheHits).toBe(0);
    expect(a.stats.embeddedNow).toBe(5);
    expect(a.clusters.length).toBeGreaterThan(0);

    // Second call, cluster=false: a DIFFERENT param tuple, so this is not a
    // whole-response cache hit against `a` — it recomputes, but reuses the
    // already-embedded vectors from the sqlite embedding cache.
    const b = JSON.parse((await app.inject({ method: 'GET', url: '/galaxy/map?cluster=false' })).body);
    expect(b.params.cluster).toBe(false);
    expect(b.clusters).toEqual([]);
    expect(b.points.length).toBe(a.points.length);
    expect(b.points.every((p) => p.clusterId === 0)).toBe(true);
    expect(b.stats.embeddedNow).toBe(0);
    expect(b.stats.cacheHits).toBe(5);
    expect(b.stats.embeddingCacheHits).toBe(5);
    expect(b.stats.responseCacheHits).toBe(0);
    // Positions are still computed — only clustering/labeling is skipped.
    for (const point of b.points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
    }

    // Repeating cluster=false hits ITS OWN response cache entry without
    // pretending that an embedding cache hit happened.
    const c = JSON.parse((await app.inject({ method: 'GET', url: '/galaxy/map?cluster=false' })).body);
    expect(c.stats.cacheHits).toBe(b.stats.cacheHits);
    expect(c.stats.embeddingCacheHits).toBe(b.stats.embeddingCacheHits);
    expect(c.stats.responseCacheHits).toBe(1);
    expect(c.clusters).toEqual([]);

    // Repeating the default (cluster=true) call hits A's cache entry, not
    // B/C's — proving the two param tuples own distinct cache slots.
    const d = JSON.parse((await app.inject({ method: 'GET', url: '/galaxy/map' })).body);
    expect(d.stats.cacheHits).toBe(a.stats.cacheHits);
    expect(d.stats.embeddingCacheHits).toBe(a.stats.embeddingCacheHits);
    expect(d.stats.responseCacheHits).toBe(1);
    expect(d.clusters.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // GET /galaxy/session/:id
  // -------------------------------------------------------------------------

  it('GET /galaxy/session/:id returns 404 for an unknown transcript', async () => {
    const res = await app.inject({ method: 'GET', url: '/galaxy/session/tx_missing' });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
  });

  it('GET /galaxy/session/:id returns full detail for a session-linked transcript', async () => {
    // Build the detail fixture in lifecycle order; terminal transcripts are
    // immutable because their archive receipt binds the complete snapshot.
    const detailId = transcripts.start({
      id: 'tx_sql_detail',
      ship: 'migrator',
      spawned_agent_id: 'agent-sqlite-1',
      session_id: sessionId,
      pr_number: 123,
      trigger: 'manual',
      backend: 'claude',
      model: 'test-model',
      started_at: NOW - HOUR,
      project: 'port-daddy',
    });
    transcripts.appendMessage(detailId, {
      role: 'user',
      content: topicContent(TOPIC_SQLITE, 'detail request'),
      timestamp: NOW - HOUR + 1,
    });
    transcripts.appendMessage(detailId, {
      role: 'assistant',
      content: topicContent(TOPIC_SQLITE, 'detail response'),
      timestamp: NOW - HOUR + 2,
    });
    transcripts.appendMessage(detailId, {
      role: 'assistant',
      content: 'Editing the migration file now.',
      timestamp: NOW - HOUR + 30,
      tool_calls: [{ name: 'Edit', args: { file_path: 'lib/db.ts' } }],
    });
    transcripts.appendOutput(detailId, {
      type: 'pr-comment',
      summary: 'Posted migration review',
      url: 'https://github.com/x/y/pull/123#issuecomment-1',
    });
    transcripts.finalize(detailId, {
      status: 'completed',
      ended_at: NOW - HOUR + 60_000,
    });

    const res = await app.inject({ method: 'GET', url: `/galaxy/session/${detailId}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    const { detail } = body;

    // Full transcript (messages + outputs, not just headers)
    expect(detail.transcript.id).toBe(detailId);
    expect(detail.transcript.messages.length).toBeGreaterThanOrEqual(3);
    expect(detail.transcript.outputs).toHaveLength(1);

    // Top-level epoch-ms timestamps, additive alongside the nested transcript.
    expect(detail.startedAt).toBe(NOW - 1 * HOUR);
    expect(detail.endedAt).toBe(NOW - 1 * HOUR + 60_000);

    // Every message carries an epoch-ms timestamp sourced from
    // fleet_transcript_messages.timestamp (not a synthesized/derived value).
    for (const message of detail.transcript.messages) {
      expect(typeof message.timestamp).toBe('number');
      expect(message.timestamp).toBeGreaterThan(0);
    }

    // Session join
    expect(detail.session).not.toBeNull();
    expect(detail.session.id).toBe(sessionId);
    expect(detail.session.purpose).toBe('Fix sqlite migration ordering');
    expect(detail.session.agentId).toBe('agent-sqlite-1');

    // Notes + files-touched from the claim forest
    expect(detail.notes).toHaveLength(1);
    expect(detail.notes[0].content).toContain('Scope: lib/db.ts');
    expect(detail.files).toHaveLength(1);
    expect(detail.files[0].filePath).toBe('lib/db.ts');
    expect(detail.files[0].releasedAt).toBeNull();

    // Tool uses flattened from messages[].tool_calls
    expect(detail.toolUses).toHaveLength(1);
    expect(detail.toolUses[0].name).toBe('Edit');
    expect(detail.toolUses[0].args).toEqual({ file_path: 'lib/db.ts' });

    // PR provenance: transcript.pr_number + the pr-comment output
    expect(detail.prs).toHaveLength(2);
    const prNumbers = detail.prs.map((p) => p.prNumber);
    expect(prNumbers).toContain(123);
    const output = detail.prs.find((p) => p.type === 'pr-comment');
    expect(output.url).toContain('pull/123');
  });

  it('GET /galaxy/session/:id handles a transcript with no session gracefully', async () => {
    const res = await app.inject({ method: 'GET', url: '/galaxy/session/tx_css_1' });
    expect(res.statusCode).toBe(200);
    const { detail } = JSON.parse(res.body);
    expect(detail.session).toBeNull();
    expect(detail.notes).toEqual([]);
    expect(detail.files).toEqual([]);
    expect(detail.prs).toEqual([]);
  });

  it('normalizes absolute file claims under the repo root to repo-relative, leaving paths outside it untouched', async () => {
    const underRepoRoot = path.join(process.cwd(), 'lib', 'galaxy-path-example.ts');
    const outsideRepoRoot = '/definitely/outside/the/repo/example.ts';

    const started2 = sessions.start('Touch files with absolute paths', {
      agentId: 'agent-pathtest-1',
      files: [underRepoRoot, outsideRepoRoot, 'already/relative.ts'],
    });
    expect(started2.success).toBe(true);

    seedTranscript(transcripts, {
      id: 'tx_pathtest', ship: 'migrator', agentId: 'agent-pathtest-1', sessionId: started2.id,
      project: 'port-daddy', startedAt: NOW - 1 * HOUR, topic: TOPIC_SQLITE, salt: 'pathtest',
    });

    const res = await app.inject({ method: 'GET', url: '/galaxy/session/tx_pathtest' });
    expect(res.statusCode).toBe(200);
    const { detail } = JSON.parse(res.body);
    const paths = detail.files.map((f) => f.filePath).sort();
    expect(paths).toEqual(['already/relative.ts', 'lib/galaxy-path-example.ts', outsideRepoRoot].sort());

    // absolutePath rides along ONLY for originally-absolute claims — the UI's
    // vscode://file deep link needs it; relative claims must not grow one.
    const byPath = Object.fromEntries(detail.files.map((f) => [f.filePath, f]));
    expect(byPath['lib/galaxy-path-example.ts'].absolutePath).toBe(underRepoRoot);
    expect(byPath[outsideRepoRoot].absolutePath).toBe(outsideRepoRoot);
    expect(byPath['already/relative.ts'].absolutePath).toBeUndefined();
  });
});
