import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { closeDatabase, initDatabase } from '../../lib/db.js';
import { createDurableAgentRoster } from '../../lib/durable-agent-roster.js';
import { createAgentRunAdmissionService } from '../../lib/agent-run-admission.js';
import { ensureDurableOwnershipSchema } from '../../lib/durable-ownership.js';
import { createEpisodicMemory } from '../../lib/episodic-memory.js';
import { getWorktreeInfo } from '../../lib/worktree.js';
import { durableAgentRosterPlugin } from '../../routes/durable-agent-roster.js';

const SOURCE_SESSION_ID = 'session-source-typography';
const SOURCE_AGENT_ID = 'claude-session-agent';
const SOURCE_ACTOR_ID = '01TYPOGRAPHYACTOR000000000';
const SOURCE_CREDENTIAL = 'test-typography-credential';
const fixtureRoots = new Set<string>();

/**
 * Run Git only inside a disposable fixture. The purpose is to isolate fixture
 * setup from the invoking checkout's branch, identity, hooks and Git selectors.
 * @param cwd - Fixture directory created by this suite.
 * @param args - Explicit Git arguments, never shell text.
 * @returns Trimmed command output for assertions.
 */
function fixtureGit(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Durable roster fixture',
      GIT_AUTHOR_EMAIL: 'roster-fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Durable roster fixture',
      GIT_COMMITTER_EMAIL: 'roster-fixture@example.invalid',
    },
  }).trim();
}

/**
 * Create a real linked workspace without borrowing the runner's checkout.
 * The design leaves production Git probing intact, including detached-HEAD
 * rejection; only test-owned directories are ever created or removed.
 * @returns A physically probed, attached linked worktree.
 */
function linkedWorkspaceFixture() {
  const scratchParent = join(homedir(), 'coding', 'tmp');
  mkdirSync(scratchParent, { recursive: true });
  const root = mkdtempSync(join(scratchParent, 'pd-roster-routes-'));
  fixtureRoots.add(root);
  const repository = join(root, 'repository');
  const workspace = join(root, 'workspace');
  mkdirSync(repository);
  fixtureGit(repository, 'init', '--quiet', '--initial-branch=main', '--template=');
  fixtureGit(repository, 'commit', '--quiet', '--allow-empty', '-m', 'Create roster test fixture');
  fixtureGit(repository, 'remote', 'add', 'origin', 'https://example.invalid/fixtures/durable-roster.git');
  fixtureGit(repository, 'worktree', 'add', '--quiet', '-b', 'test/durable-roster', workspace, 'HEAD');
  const worktree = getWorktreeInfo(workspace);
  if (!worktree?.branch || worktree.isMain) throw new Error('fixture must be a real attached linked worktree');
  return worktree;
}

function profile() {
  return {
    slug: 'portdaddy-typography-expert',
    scope: { kind: 'system' },
    remit: 'Own typography systems and information density.',
    instructions: 'Inspect the established paper-like visual language before editing.',
    skills: ['swiss-modern-website-design'],
    tools: ['read', 'apply_patch'],
  };
}

async function buildApp() {
  const db = initDatabase({ inMemory: true });
  ensureDurableOwnershipSchema(db);
  const worktree = linkedWorkspaceFixture();
  db.prepare(`
    INSERT INTO sessions (
      id, purpose, status, phase, agent_id, agent_node_id, worktree_id,
      identity_project, created_at, updated_at, completed_at, metadata, is_durable
    ) VALUES (?, 'Typography promotion', 'active', 'in_progress', ?, NULL, ?,
              'port-daddy', ?, ?, NULL, ?, 1)
  `).run(
    SOURCE_SESSION_ID,
    SOURCE_AGENT_ID,
    worktree.id,
    Date.now() - 10_000,
    Date.now() - 10_000,
    JSON.stringify({
      identity: { verified: true, actorId: SOURCE_ACTOR_ID, soulClass: 'graduated' },
      worktree: { id: worktree.id, root: worktree.root, branch: worktree.branch, isMain: worktree.isMain },
    }),
  );
  const episodicMemory = createEpisodicMemory(db);
  const durableAgentRoster = createDurableAgentRoster(db, {
    resolver: {
      modelId: 'Xenova/all-MiniLM-L6-v2',
      embed: async (text: string) => [text.toLowerCase().includes('typography') ? 1 : 0.1, 0.1],
    },
    gitleaksRunner: () => ({ findings: [] }),
  });
  const metrics = { errors: 0 };
  const logger = { info: jest.fn(), error: jest.fn() };
  const actorSouls = {
    constants: { defaultHarbor: 'port-daddy' },
    verifyCredential: (credential: string) => credential === SOURCE_CREDENTIAL ? SOURCE_ACTOR_ID : null,
    resolveActor: (handle: string) => handle === SOURCE_AGENT_ID || handle === SOURCE_ACTOR_ID
      ? { actorId: SOURCE_ACTOR_ID, soulClass: 'graduated' as const }
      : { actorId: handle, soulClass: 'unknown' as const },
  };
  const agentRunAdmission = createAgentRunAdmissionService(db, {
    getAgentNode: (agentNodeId) => durableAgentRoster.get(agentNodeId),
  });
  const app = Fastify();
  await app.register(durableAgentRosterPlugin, {
    deps: { durableAgentRoster, agentRunAdmission, actorSouls, episodicMemory, metrics, logger },
  });
  await app.ready();
  return { app, db, episodicMemory, durableAgentRoster, metrics, logger, worktree };
}

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

afterEach(async () => {
  while (openApps.length > 0) {
    const state = openApps.pop();
    if (!state) continue;
    await state.app.close();
    closeDatabase(state.db);
  }
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
  fixtureRoots.clear();
});

describe('durable agent roster routes', () => {
  test('creates, lists, reads, searches, updates, and retires daemon-minted agents', async () => {
    const state = await buildApp();
    openApps.push(state);
    const created = await state.app.inject({ method: 'POST', url: '/durable-agents', payload: profile() });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    const id = body.agent.agentNodeId as string;

    expect((await state.app.inject({ method: 'GET', url: '/durable-agents' })).json().count).toBe(1);
    expect((await state.app.inject({ method: 'GET', url: `/durable-agents/${id}` })).json().revisions).toHaveLength(1);
    expect((await state.app.inject({ method: 'GET', url: '/durable-agents/search?q=typography' })).json().hits[0].agent.agentNodeId).toBe(id);

    const updated = await state.app.inject({
      method: 'PATCH',
      url: `/durable-agents/${id}`,
      payload: { lifecycle: 'ready', remit: 'Own typography systems, density, and accessibility.' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().agent.profile.revision).toBe(2);

    const retired = await state.app.inject({ method: 'POST', url: `/durable-agents/${id}/retire` });
    expect(retired.statusCode).toBe(200);
    expect(retired.json().agent.profile.lifecycle).toBe('retired');
  });

  test('promotes a native harness session when sanitized capsule lineage agrees', async () => {
    const state = await buildApp();
    openApps.push(state);
    const episode = state.episodicMemory.remember({
      episodeType: 'handoff',
      title: 'Typography handoff',
      summary: 'Sanitized operator context and typography decisions.',
      sourceType: 'handoff-capsule',
      sourceId: `claude:${SOURCE_SESSION_ID}`,
      metadata: {
        capsule: {
          schema: 'pd.agent-harbor.handoff-capsule.v0',
          source: { sessionId: SOURCE_SESSION_ID, agentId: SOURCE_AGENT_ID, adapter: 'claude-code' },
          target: { agentId: null, adapter: null },
        },
      },
    });

    const promoted = await state.app.inject({
      method: 'POST',
      url: '/durable-agents/promote',
      headers: { 'x-agent-id': SOURCE_AGENT_ID, 'x-actor-credential': SOURCE_CREDENTIAL },
      payload: { ...profile(), sourceSessionId: SOURCE_SESSION_ID, handoffEpisodeId: episode.id },
    });
    expect(promoted.statusCode).toBe(201);
    expect(promoted.json().agent.profile.origin).toMatchObject({
      kind: 'session-promotion',
      sourceSessionId: SOURCE_SESSION_ID,
      handoffEpisodeId: episode.id,
      sourceAdapter: 'claude-code',
    });
    expect(promoted.json().agent.continuation.endpoint).toBe(`/memory/handoffs/${episode.id}/continue`);
    expect(promoted.json().agentRun).toMatchObject({
      agentNodeId: promoted.json().agent.agentNodeId,
      sourceSessionId: SOURCE_SESSION_ID,
      sourceAgentId: SOURCE_AGENT_ID,
      worktreeId: state.worktree.id,
      worktreeRoot: state.worktree.root,
      branch: 'test/durable-roster',
      replayed: false,
    });
    expect(state.worktree.isMain).toBe(false);

    const mismatch = await state.app.inject({
      method: 'POST',
      url: '/durable-agents/promote',
      headers: { 'x-agent-id': SOURCE_AGENT_ID, 'x-actor-credential': SOURCE_CREDENTIAL },
      payload: { ...profile(), slug: 'portdaddy-spacing-expert', sourceSessionId: 'session-other', handoffEpisodeId: episode.id },
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().code).toBe('PROMOTION_LINEAGE_MISMATCH');

    const repoScopedWithoutProvenance = await state.app.inject({
      method: 'POST',
      url: '/durable-agents/promote',
      headers: { 'x-agent-id': SOURCE_AGENT_ID, 'x-actor-credential': SOURCE_CREDENTIAL },
      payload: {
        ...profile(),
        slug: 'portdaddy-repo-typography-expert',
        scope: { kind: 'repo', repoRoot: state.worktree.root },
        sourceSessionId: SOURCE_SESSION_ID,
        handoffEpisodeId: episode.id,
      },
    });
    expect(repoScopedWithoutProvenance.statusCode).toBe(409);
    expect(repoScopedWithoutProvenance.json().code).toBe('PROMOTION_SCOPE_MISMATCH');
  });

  test('allows repo-scoped promotion only when handoff repository provenance matches', async () => {
    const state = await buildApp();
    openApps.push(state);
    const episode = state.episodicMemory.remember({
      episodeType: 'handoff',
      title: 'Repository typography handoff',
      summary: 'Sanitized repository-specific expertise.',
      sourceType: 'handoff-capsule',
      sourceId: `claude:${SOURCE_SESSION_ID}`,
      metadata: {
        capsule: {
          schema: 'pd.agent-harbor.handoff-capsule.v0',
          source: { sessionId: SOURCE_SESSION_ID, agentId: SOURCE_AGENT_ID, adapter: 'claude-code' },
          target: { agentId: null, adapter: null },
          workspace: { repoRoot: state.worktree.root },
        },
      },
    });

    const promoted = await state.app.inject({
      method: 'POST',
      url: '/durable-agents/promote',
      headers: { 'x-agent-id': SOURCE_AGENT_ID, 'x-actor-credential': SOURCE_CREDENTIAL },
      payload: {
        ...profile(),
        slug: 'portdaddy-repository-typography-expert',
        scope: { kind: 'repo', repoRoot: state.worktree.root },
        sourceSessionId: SOURCE_SESSION_ID,
        handoffEpisodeId: episode.id,
      },
    });

    expect(promoted.statusCode).toBe(201);
    expect(promoted.json().agent.profile.scope).toMatchObject({ kind: 'repo' });
  });

  test('does not let direct creation forge session-promotion lineage', async () => {
    const state = await buildApp();
    openApps.push(state);
    const response = await state.app.inject({
      method: 'POST',
      url: '/durable-agents',
      payload: {
        ...profile(),
        origin: {
          kind: 'session-promotion',
          sourceSessionId: SOURCE_SESSION_ID,
          handoffEpisodeId: 41,
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'UNVERIFIED_PROMOTION_ORIGIN' });
    expect(state.durableAgentRoster.list()).toHaveLength(0);
  });

  test('promotes a real linked fixture even when the invoking checkout is detached', async () => {
    const caller = linkedWorkspaceFixture();
    fixtureGit(caller.root, 'checkout', '--quiet', '--detach', 'HEAD');
    const previousCwd = process.cwd();
    try {
      process.chdir(caller.root);
      expect(getWorktreeInfo(process.cwd())?.branch).toBeNull();
      const state = await buildApp();
      openApps.push(state);
      const episode = state.episodicMemory.remember({
        episodeType: 'handoff',
        title: 'Detached caller, attached source',
        summary: 'The invoking checkout is not the admitted workspace.',
        sourceType: 'handoff-capsule',
        sourceId: `claude:${SOURCE_SESSION_ID}`,
        metadata: {
          capsule: {
            schema: 'pd.agent-harbor.handoff-capsule.v0',
            source: { sessionId: SOURCE_SESSION_ID, agentId: SOURCE_AGENT_ID, adapter: 'claude-code' },
            target: { agentId: null, adapter: null },
          },
        },
      });
      const result = await state.app.inject({
        method: 'POST', url: '/durable-agents/promote',
        headers: { 'x-agent-id': SOURCE_AGENT_ID, 'x-actor-credential': SOURCE_CREDENTIAL },
        payload: { ...profile(), sourceSessionId: SOURCE_SESSION_ID, handoffEpisodeId: episode.id },
      });
      expect(result.statusCode).toBe(201);
      expect(result.json().agentRun).toMatchObject({
        worktreeId: state.worktree.id,
        worktreeRoot: state.worktree.root,
        branch: 'test/durable-roster',
      });
      expect(state.worktree.root).not.toBe(caller.root);
    } finally {
      process.chdir(previousCwd);
    }
  });

  test('still denies promotion when the admitted source workspace becomes detached', async () => {
    const state = await buildApp();
    openApps.push(state);
    const episode = state.episodicMemory.remember({
      episodeType: 'handoff',
      title: 'Detached source workspace',
      summary: 'A real detached source is not an attached admission target.',
      sourceType: 'handoff-capsule',
      sourceId: `claude:${SOURCE_SESSION_ID}`,
      metadata: {
        capsule: {
          schema: 'pd.agent-harbor.handoff-capsule.v0',
          source: { sessionId: SOURCE_SESSION_ID, agentId: SOURCE_AGENT_ID, adapter: 'claude-code' },
          target: { agentId: null, adapter: null },
        },
      },
    });
    fixtureGit(state.worktree.root, 'checkout', '--quiet', '--detach', 'HEAD');
    expect(getWorktreeInfo(state.worktree.root)?.branch).toBeNull();
    const result = await state.app.inject({
      method: 'POST', url: '/durable-agents/promote',
      headers: { 'x-agent-id': SOURCE_AGENT_ID, 'x-actor-credential': SOURCE_CREDENTIAL },
      payload: { ...profile(), sourceSessionId: SOURCE_SESSION_ID, handoffEpisodeId: episode.id },
    });
    expect(result.statusCode).toBe(409);
    expect(result.json().code).toBe('ADMISSION_WORKTREE_MISMATCH');
    expect(state.durableAgentRoster.list()).toEqual([]);
    expect(state.db.prepare("SELECT COUNT(*) AS count FROM harbor_events WHERE stream_type = 'agent-run'").get())
      .toEqual({ count: 0 });
  });

  test('rejects partially numeric episode identifiers', async () => {
    const state = await buildApp();
    openApps.push(state);
    const response = await state.app.inject({
      method: 'POST',
      url: '/durable-agents/promote',
      headers: { 'x-agent-id': SOURCE_AGENT_ID, 'x-actor-credential': SOURCE_CREDENTIAL },
      payload: {
        ...profile(),
        sourceSessionId: SOURCE_SESSION_ID,
        handoffEpisodeId: '41junk',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(state.durableAgentRoster.list()).toHaveLength(0);
  });

  test('requires the source session credential and rejects caller-selected identity fields without minting', async () => {
    const state = await buildApp();
    openApps.push(state);
    const episode = state.episodicMemory.remember({
      episodeType: 'handoff',
      title: 'Credential-bound promotion',
      summary: 'Sanitized promotion context.',
      sourceType: 'handoff-capsule',
      sourceId: `claude:${SOURCE_SESSION_ID}`,
      metadata: {
        capsule: {
          schema: 'pd.agent-harbor.handoff-capsule.v0',
          source: { sessionId: SOURCE_SESSION_ID, agentId: SOURCE_AGENT_ID, adapter: 'claude-code' },
          target: { agentId: null, adapter: null },
        },
      },
    });

    const unauthenticated = await state.app.inject({
      method: 'POST',
      url: '/durable-agents/promote',
      payload: { ...profile(), sourceSessionId: SOURCE_SESSION_ID, handoffEpisodeId: episode.id },
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');

    const injected = await state.app.inject({
      method: 'POST',
      url: '/durable-agents/promote',
      headers: { 'x-agent-id': SOURCE_AGENT_ID, 'x-actor-credential': SOURCE_CREDENTIAL },
      payload: {
        ...profile(),
        sourceSessionId: SOURCE_SESSION_ID,
        handoffEpisodeId: episode.id,
        agentNodeId: 'agent_node_attacker_selected',
      },
    });
    expect(injected.statusCode).toBe(400);
    expect(injected.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(state.durableAgentRoster.list()).toEqual([]);
    expect(state.db.prepare("SELECT COUNT(*) AS count FROM harbor_events WHERE stream_type = 'agent-run'").get())
      .toEqual({ count: 0 });
  });

  test('rejects non-loopback mutations while leaving roster reads available', async () => {
    const state = await buildApp();
    openApps.push(state);
    const blocked = await state.app.inject({
      method: 'POST',
      url: '/durable-agents',
      remoteAddress: '203.0.113.9',
      payload: profile(),
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('LOOPBACK_ONLY');

    const read = await state.app.inject({ method: 'GET', url: '/durable-agents', remoteAddress: '203.0.113.9' });
    expect(read.statusCode).toBe(200);
  });
});
