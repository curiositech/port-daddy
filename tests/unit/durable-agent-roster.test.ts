import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { closeDatabase, initDatabase } from '../../lib/db.js';
import type { DatabaseInstance } from '../../lib/sqlite-runtime.js';
import {
  createDurableAgentRoster,
  DURABLE_AGENT_SEARCH_CORPUS_ID,
  DurableAgentRosterError,
} from '../../lib/durable-agent-roster.js';
import { localTextCorpusPolicy } from '../../lib/retrieval-policy.js';

function vector(text: string): number[] {
  const normalized = text.toLowerCase();
  const values = [
    normalized.includes('typography') ? 1 : 0.05,
    normalized.includes('database') ? 1 : 0.05,
    normalized.includes('security') ? 1 : 0.05,
  ];
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / magnitude);
}

function input(slug = 'portdaddy-typography-expert') {
  return {
    slug,
    scope: { kind: 'system' as const },
    remit: 'Own typography systems and dense operator interface hierarchy.',
    instructions: 'Inspect existing visual language before changing interface typography.',
    skills: ['swiss-modern-website-design', 'web-layout-spacing'],
    tools: ['read', 'apply_patch'],
    backendPreferences: [{ backend: 'cli:codex', model: 'gpt-5' }],
    permissionPolicy: { filesystem: 'repo' as const, network: 'restricted' as const },
    triggers: [{ kind: 'manual' as const, label: 'Operator summons the specialist' }],
  };
}

describe('durable agent roster', () => {
  let db: DatabaseInstance;
  let embed: jest.Mock<(text: string) => Promise<number[]>>;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
    embed = jest.fn(async (text: string) => vector(text));
  });

  afterEach(() => closeDatabase(db));

  function roster() {
    return createDurableAgentRoster(db, {
      resolver: {
        modelId: 'test-roster-model',
        spaceId: 'test:roster-3d',
        corpusPolicy: localTextCorpusPolicy(DURABLE_AGENT_SEARCH_CORPUS_ID),
        embed,
      },
      gitleaksRunner: () => ({ findings: [] }),
      now: () => new Date('2026-07-15T20:00:00.000Z'),
    });
  }

  test('mints an opaque AgentNode while preserving a meaningful unique alias', async () => {
    const service = roster();
    const created = await service.create(input());

    expect(created.agent.agentNodeId).toMatch(/^agent_node_[0-9a-f-]{36}$/);
    expect(created.agent.identity).toBe('system:roster:portdaddy-typography-expert');
    expect(created.agent.profile.permissionPolicy.enforcement).toBe('declaration-only');
    expect(created.agent.profile.triggers[0].status).toBe('declared');
    expect(created.agent.continuation.available).toBe(false);
    expect(created.warnings).toEqual([]);
    expect(embed).toHaveBeenCalled();

    await expect(service.create(input())).rejects.toMatchObject({
      code: 'DURABLE_AGENT_ALIAS_CONFLICT',
      statusCode: 409,
    });
  });

  test('rejects opaque generated aliases instead of presenting them as durable names', async () => {
    await expect(roster().create(input('pd-agent-3395495959'))).rejects.toBeInstanceOf(DurableAgentRosterError);
    await expect(roster().create(input('agent-deadbeefdeadbeef'))).rejects.toMatchObject({ code: 'INVALID_AGENT_SLUG' });
  });

  test('rejects forged promotion lineage and invalid declaration values', async () => {
    const service = roster();
    await expect(service.create({
      ...input(),
      origin: {
        kind: 'session-promotion',
        sourceSessionId: 'forged-session',
        handoffEpisodeId: 41,
      },
    })).rejects.toMatchObject({ code: 'UNVERIFIED_PROMOTION_ORIGIN' });
    await expect(service.create({
      ...input('portdaddy-invalid-permissions-expert'),
      permissionPolicy: { filesystem: 'root' },
    } as any)).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
    await expect(service.create({
      ...input('portdaddy-invalid-memory-expert'),
      archiveSearch: 'yes',
    } as any)).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
  });

  test('stores profile revisions as append-only AgentNode facts', async () => {
    const service = roster();
    const created = await service.create(input());
    const updated = await service.update(created.agent.agentNodeId, {
      remit: 'Own typography, spacing, and accessible density across operator surfaces.',
      lifecycle: 'ready',
    });

    expect(updated.agent.profile.revision).toBe(2);
    expect(updated.agent.status).toBe('active');
    expect(service.history(created.agent.agentNodeId).map((entry) => entry.profile.revision)).toEqual([2, 1]);
    expect(() => db.prepare("UPDATE harbor_events SET payload_json = '{}' WHERE stream_type = 'agent-node'").run())
      .toThrow(/append-only/);
  });

  test('attaches sanitized handoff episodes without replaying provider transcripts', async () => {
    const service = roster();
    const created = await service.create(input());
    const agent = await service.attachHandoffEpisode(created.agent.agentNodeId, 41);

    expect(agent.profile.memory.handoffEpisodeIds).toEqual([41]);
    expect(agent.continuation).toMatchObject({
      available: true,
      episodeId: 41,
      endpoint: '/memory/handoffs/41/continue',
      durableAgentId: created.agent.agentNodeId,
    });
  });

  test('uses BM25 plus the shared semantic embedder and exposes rank evidence without reputation scores', async () => {
    const service = roster();
    await service.create(input());
    await service.create({
      ...input('portdaddy-database-specialist'),
      remit: 'Own SQLite durability, schema verification, and migration recovery.',
      instructions: 'Inspect the canonical database and prove migrations against live table shape.',
      skills: ['sqlite-durable-agent-state'],
    });

    const result = await service.search('dense typography hierarchy', { scopeKey: 'system' });
    expect(result.degraded).toBe(false);
    expect(result.embedder).toBe('test-roster-model');
    expect(result.spaceId).toBe('test:roster-3d');
    expect(result.corpusId).toBe(DURABLE_AGENT_SEARCH_CORPUS_ID);
    expect(result.hits[0].agent.profile.slug).toBe('portdaddy-typography-expert');
    expect(result.hits[0].evidence.sources).toEqual(expect.arrayContaining(['bm25', 'semantic']));
    expect(result.hits[0]).not.toHaveProperty('score');
  });

  test('persists admitted derivatives under the exact corpus policy and vector space', async () => {
    const service = roster();
    const created = await service.create(input());
    const row = db.prepare(`
      SELECT * FROM durable_agent_profile_embeddings WHERE agent_node_id = ?
    `).get(created.agent.agentNodeId) as Record<string, unknown>;

    expect(row.corpus_id).toBe(DURABLE_AGENT_SEARCH_CORPUS_ID);
    expect(row.space_id).toBe('test:roster-3d');
    expect(row.model_id).toBe('test-roster-model');
    expect(row.policy_digest).toBe(localTextCorpusPolicy(DURABLE_AGENT_SEARCH_CORPUS_ID).policyDigest);
    expect(JSON.parse(String(row.admission_receipt)).state).toBe('clean');
  });

  test('rejects unscoped and secret-bearing queries before either ranking leg', async () => {
    const service = roster();
    await service.create(input());
    const callsAfterIndex = embed.mock.calls.length;

    await expect(service.search('typography')).rejects.toMatchObject({
      code: 'DURABLE_AGENT_SCOPE_REQUIRED',
    });
    await expect(service.search('token ghp_abcdefghijklmnopqrstuvwxyz1234567890', { scopeKey: 'system' }))
      .rejects.toMatchObject({ code: 'QUERY_REDACTED' });
    expect(embed).toHaveBeenCalledTimes(callsAfterIndex);
  });

  test('rebuilds a legacy model-only embedding projection', () => {
    db.exec(`
      CREATE TABLE durable_agent_profile_embeddings (
        agent_node_id TEXT PRIMARY KEY, profile_revision INTEGER NOT NULL,
        model_id TEXT NOT NULL, document_hash TEXT NOT NULL,
        embedding BLOB NOT NULL, updated_at INTEGER NOT NULL
      );
      INSERT INTO durable_agent_profile_embeddings VALUES ('legacy', 1, 'legacy', 'old', X'0000', 1);
    `);

    roster();
    expect((db.prepare('SELECT COUNT(*) AS count FROM durable_agent_profile_embeddings').get() as { count: number }).count).toBe(0);
    const columns = (db.prepare('PRAGMA table_info(durable_agent_profile_embeddings)').all() as Array<{ name: string }>).map((row) => row.name);
    expect(columns).toEqual(expect.arrayContaining(['corpus_id', 'policy_digest', 'space_id', 'admission_receipt']));
  });

  test('labels lexical fallback when the shared semantic model is unavailable', async () => {
    const service = roster();
    const created = await service.create(input());
    expect(created.agent.profile.slug).toBe('portdaddy-typography-expert');
    embed.mockRejectedValue(new Error('model cache missing'));

    const result = await service.search('typography', { scopeKey: 'system' });
    expect(result.degraded).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/pd doctor/);
    expect(result.hits[0].agent.profile.slug).toBe('portdaddy-typography-expert');
  });
});
