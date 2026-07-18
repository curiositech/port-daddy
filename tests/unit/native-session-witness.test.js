import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  captureNativeSessionWitness,
  verifyNativeSessionWitness,
} from '../../lib/native-session-witness.js';

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

function capsule(overrides = {}) {
  const source = {
    adapter: 'claude-code',
    sessionId: '11111111-1111-4111-8111-111111111111',
    agentId: 'portdaddy-native-resume-expert',
    workflowId: null,
    transcriptRef: null,
    ...(overrides.source ?? {}),
  };
  const workspace = {
    cwd: overrides.cwd,
    repoRoot: overrides.cwd,
    branch: 'feature/native-resume',
    worktreeId: null,
    gitHead: null,
    dirtyFiles: [],
  };
  return {
    schema: 'pd.agent-harbor.handoff-capsule.v0',
    capsuleId: 'capsule-native-witness',
    capturedAt: '2026-07-15T20:00:00.000Z',
    source,
    target: null,
    identity: { project: 'port-daddy', projectDir: overrides.cwd, harbor: null },
    workspace,
    telos: 'Continue the exact native session.',
    operatorTurns: [{ id: 'op-1', at: null, text: 'Continue.' }],
    decisions: [],
    coordination: [],
    artifacts: [],
    tail: [],
  };
}

describe('native session witnesses', () => {
  let root;
  let home;
  let cwd;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pd-native-witness-'));
    home = join(root, 'home');
    cwd = join(root, 'worktree');
    mkdirSync(home, { recursive: true });
    mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('witnesses and reverifies a Claude JSONL session owned by the local harness', () => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const transcriptRef = write(
      join(home, '.claude', 'projects', '-private-tmp-project', `${sessionId}.jsonl`),
      `${JSON.stringify({ type: 'user', sessionId, cwd, message: { role: 'user' } })}\n`,
    );
    const handoff = capsule({ cwd, source: { sessionId, transcriptRef } });

    const captured = captureNativeSessionWitness(handoff, 'claude-code', { home, now: () => 42 });

    expect(captured).toEqual(expect.objectContaining({ verified: true, reason: null }));
    expect(captured.witness).toEqual(expect.objectContaining({
      method: 'claude-jsonl-session-id',
      witnessedAt: 42,
    }));
    expect(captured.canonicalWorkspace).toBe(realpathSync(cwd));
    expect(verifyNativeSessionWitness(handoff, 'claude-code', captured.witness, { home }).verified).toBe(true);
  });

  test('requires an explicit transcript reference instead of scanning harness stores', () => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    write(
      join(home, '.claude', 'projects', '-private-tmp-project', `${sessionId}.jsonl`),
      `${JSON.stringify({ type: 'user', sessionId, cwd })}\n`,
    );
    const handoff = capsule({ cwd, source: { sessionId, transcriptRef: null } });

    expect(captureNativeSessionWitness(handoff, 'claude-code', { home })).toEqual(expect.objectContaining({
      verified: false,
      canonicalWorkspace: null,
    }));
  });

  test('rejects caller-supplied Claude evidence outside harness storage', () => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const outside = write(
      join(root, `${sessionId}.jsonl`),
      `${JSON.stringify({ sessionId, cwd })}\n`,
    );
    const handoff = capsule({ cwd, source: { sessionId, transcriptRef: outside } });

    expect(captureNativeSessionWitness(handoff, 'claude-code', { home })).toEqual(expect.objectContaining({
      verified: false,
      witness: null,
    }));
  });

  test('rejects symlinked evidence even when its target is inside harness storage', () => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const target = write(
      join(home, '.claude', 'projects', '-private-tmp-project', `${sessionId}.jsonl`),
      `${JSON.stringify({ sessionId, cwd })}\n`,
    );
    const link = join(home, '.claude', 'projects', '-private-tmp-other', `${sessionId}.jsonl`);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link);
    const handoff = capsule({ cwd, source: { sessionId, transcriptRef: link } });

    expect(captureNativeSessionWitness(handoff, 'claude-code', { home }).verified).toBe(false);
  });

  test('witnesses a Codex rollout only when session_meta agrees with the filename', () => {
    const sessionId = '22222222-2222-4222-8222-222222222222';
    const transcriptRef = write(
      join(home, '.codex', 'sessions', '2026', '07', '15', `rollout-2026-07-15T20-00-00-${sessionId}.jsonl`),
      `${JSON.stringify({ type: 'session_meta', payload: { id: sessionId, cwd } })}\n`,
    );
    const handoff = capsule({ cwd, source: { adapter: 'codex-cli', sessionId, transcriptRef } });

    const captured = captureNativeSessionWitness(handoff, 'codex-cli', { home });

    expect(captured.witness).toEqual(expect.objectContaining({ method: 'codex-session-meta' }));
    const mismatched = capsule({
      cwd,
      source: {
        adapter: 'codex-cli',
        sessionId: '33333333-3333-4333-8333-333333333333',
        transcriptRef,
      },
    });
    expect(captureNativeSessionWitness(mismatched, 'codex-cli', { home }).verified).toBe(false);
  });

  test('witnesses an Antigravity conversation through its session-keyed brain transcript', () => {
    const sessionId = '44444444-4444-4444-8444-444444444444';
    write(
      join(home, '.gemini', 'antigravity-cli', 'cache', 'last_conversations.json'),
      JSON.stringify({ [cwd]: sessionId }),
    );
    const transcriptRef = write(
      join(home, '.gemini', 'antigravity-cli', 'brain', sessionId, '.system_generated', 'logs', 'transcript.jsonl'),
      `${JSON.stringify({ step_index: 1, type: 'USER_INPUT', status: 'DONE' })}\n`,
    );
    const handoff = capsule({ cwd, source: { adapter: 'agy-cli', sessionId, transcriptRef } });

    expect(captureNativeSessionWitness(handoff, 'agy-cli', { home }).witness).toEqual(expect.objectContaining({
      method: 'agy-brain-transcript',
    }));
  });

  test('fails agy closed when its latest-conversation cache does not bind the session to the workspace', () => {
    const sessionId = '44444444-4444-4444-8444-444444444444';
    const otherSessionId = '44444444-4444-4444-8444-555555555555';
    write(
      join(home, '.gemini', 'antigravity-cli', 'cache', 'last_conversations.json'),
      JSON.stringify({ [cwd]: otherSessionId }),
    );
    const transcriptRef = write(
      join(home, '.gemini', 'antigravity-cli', 'brain', sessionId, '.system_generated', 'logs', 'transcript.jsonl'),
      `${JSON.stringify({ step_index: 1, type: 'USER_INPUT', status: 'DONE' })}\n`,
    );
    const handoff = capsule({ cwd, source: { adapter: 'agy-cli', sessionId, transcriptRef } });

    expect(captureNativeSessionWitness(handoff, 'agy-cli', { home })).toEqual(expect.objectContaining({
      verified: false,
      witness: null,
    }));
  });

  test('witnesses a Gemini UUID only inside its registered project chat store', () => {
    const sessionId = '55555555-5555-4555-8555-555555555555';
    const projectId = 'port-daddy-test';
    write(
      join(home, '.gemini', 'projects.json'),
      JSON.stringify({ projects: { [cwd]: projectId } }),
    );
    const transcriptRef = write(
      join(home, '.gemini', 'tmp', projectId, 'chats', 'session-2026-07-15T20-00-55555555.json'),
      JSON.stringify({
        sessionId,
        projectHash: createHash('sha256').update(cwd).digest('hex'),
        startTime: '2026-07-15T20:00:00.000Z',
        lastUpdated: '2026-07-15T20:01:00.000Z',
        messages: [{ type: 'user', content: [{ text: 'Continue.' }] }],
        kind: 'main',
      }),
    );
    const handoff = capsule({ cwd, source: { adapter: 'gemini-cli', sessionId, transcriptRef } });

    const captured = captureNativeSessionWitness(handoff, 'gemini-cli', { home });

    expect(captured.witness).toEqual(expect.objectContaining({ method: 'gemini-project-chat' }));
    expect(verifyNativeSessionWitness(handoff, 'gemini-cli', captured.witness, { home }).verified).toBe(true);

    const moved = capsule({ cwd: join(root, 'different-project'), source: { adapter: 'gemini-cli', sessionId, transcriptRef } });
    expect(captureNativeSessionWitness(moved, 'gemini-cli', { home }).verified).toBe(false);
  });

  test.each(['claude-code', 'codex-cli', 'agy-cli', 'gemini-cli'])(
    'rejects option-shaped %s session identifiers before touching harness storage',
    (adapter) => {
      const handoff = capsule({ cwd, source: { adapter, sessionId: '--last', transcriptRef: null } });
      const result = captureNativeSessionWitness(handoff, adapter, { home });

      expect(result.verified).toBe(false);
      expect(result.reason).toMatch(/canonical UUID/);
    },
  );

  test('canonicalizes a symlinked workspace and binds the witness to the target inode', () => {
    const sessionId = '66666666-6666-4666-8666-666666666666';
    const workspaceLink = join(root, 'worktree-link');
    symlinkSync(cwd, workspaceLink);
    const transcriptRef = write(
      join(home, '.claude', 'projects', '-private-tmp-project', `${sessionId}.jsonl`),
      `${JSON.stringify({ type: 'user', sessionId, cwd })}\n`,
    );
    const handoff = capsule({ cwd: workspaceLink, source: { sessionId, transcriptRef } });

    const captured = captureNativeSessionWitness(handoff, 'claude-code', { home });

    expect(captured.verified).toBe(true);
    expect(captured.canonicalWorkspace).toBe(realpathSync(cwd));
  });
});
