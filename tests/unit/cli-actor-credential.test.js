/**
 * cli/utils/actor-credential.ts — CLI-side resolution and persistence of the
 * ADR-0040 daemon-minted actor credential (#8877 / ADR-0122).
 *
 * Pins the precedence contract resolveCliActorCredential documents:
 *   1. PD_ACTOR_CREDENTIAL, then PORT_DADDY_ACTOR_CREDENTIAL env vars;
 *   2. the per-worktree context store (only when the asserted agentId
 *      matches — a mismatched credential is WITHHELD so the daemon returns
 *      the clearer 401 IDENTITY_CREDENTIAL_REQUIRED, never a laundering 403);
 *   3. the per-slot actor file persistCliActorCredential writes
 *      (.portdaddy/actors/<slot>.json), so `pd lock`/`pd unlock` pairs in a
 *      shell that never ran `pd begin` keep ONE soul.
 * And the fail-closed floor: nothing resolvable → undefined (daemon 401s).
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { chmodSync, linkSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  persistCliActorCredential,
  resolveCliActorCredential,
} from '../../cli/utils/actor-credential.js';
import { writeCurrentContext } from '../../cli/utils/current-context.js';

// Every env var the resolver (directly or via current-context) consults.
// Cleared per-test so an ambient harness (Claude Code sets
// CLAUDE_CODE_SESSION_ID; a `pd begin` shell exports PD_ACTOR_CREDENTIAL)
// can't leak into the precedence assertions.
const ENV_VARS = [
  'PD_ACTOR_CREDENTIAL',
  'PORT_DADDY_ACTOR_CREDENTIAL',
  'PD_AGENT_ID',
  'PD_SESSION_ID',
  'PORT_DADDY_CONTEXT_SLOT',
  'PORT_DADDY_CONTEXT_DIR',
  'CODEX_THREAD_ID',
  'CLAUDE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ID',
  'CURSOR_SESSION_ID',
  'AIDER_SESSION_ID',
  'COPILOT_SESSION_ID',
  'TERM_SESSION_ID',
];

describe('cli/utils/actor-credential', () => {
  let contextDir;
  let originalEnv;

  beforeEach(() => {
    contextDir = mkdtempSync(join(tmpdir(), 'pd-actor-credential-'));
    originalEnv = {};
    for (const key of ENV_VARS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    // Pin the store location and the slot so the test controls exactly which
    // actor file the resolver reads back.
    process.env.PORT_DADDY_CONTEXT_DIR = contextDir;
    process.env.PORT_DADDY_CONTEXT_SLOT = 'test-slot';
  });

  afterEach(() => {
    for (const key of ENV_VARS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    rmSync(contextDir, { recursive: true, force: true });
  });

  const actorFile = () => join(contextDir, 'actors', 'test-slot.json');

  test('persist → resolve round-trip: a later invocation in the same slot presents the SAME soul', () => {
    persistCliActorCredential('ACTOR01.secret-hex', 'lock-shell');
    // No env, no session context — the per-slot actor file is the source.
    expect(resolveCliActorCredential()).toBe('ACTOR01.secret-hex');
    // Asserting the agentId it was minted for still resolves it.
    expect(resolveCliActorCredential('lock-shell')).toBe('ACTOR01.secret-hex');
    // The file itself is the documented location and shape.
    const stored = JSON.parse(readFileSync(actorFile(), 'utf8'));
    expect(stored).toEqual({ agentId: 'lock-shell', credential: 'ACTOR01.secret-hex' });
  });

  test('the persisted credential directory is 0700 and its atomically replaced file is 0600', () => {
    persistCliActorCredential('ACTOR01.secret-hex', null);
    expect(statSync(contextDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(contextDir, 'actors')).mode & 0o777).toBe(0o700);
    expect(statSync(actorFile()).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(contextDir, 'actors'))).toEqual(['test-slot.json']);
  });

  test('persist CLAMPS a pre-existing loose file back to 0o600 — mode:0o600 alone only applies at creation', () => {
    // A file left by an older CLI version or loosened by hand: without the
    // explicit chmod, writeFileSync would overwrite the CONTENT (fresh
    // plaintext credential) while keeping the old 0o644 mode — exactly the
    // world-readable-bearer state the ADR-0040 custody bar forbids.
    mkdirSync(join(contextDir, 'actors'), { recursive: true });
    writeFileSync(actorFile(), JSON.stringify({ agentId: null, credential: 'OLD.secret' }), { mode: 0o644 });
    expect(statSync(actorFile()).mode & 0o777).toBe(0o644);
    persistCliActorCredential('ACTOR06.fresh-secret', null);
    expect(statSync(actorFile()).mode & 0o777).toBe(0o600);
    expect(resolveCliActorCredential()).toBe('ACTOR06.fresh-secret');
  });

  test('read repairs loose context, actor-directory, and credential-file modes', () => {
    persistCliActorCredential('ACTOR07.read-repair', 'repair-agent');
    chmodSync(contextDir, 0o755);
    chmodSync(join(contextDir, 'actors'), 0o755);
    chmodSync(actorFile(), 0o644);

    expect(resolveCliActorCredential('repair-agent')).toBe('ACTOR07.read-repair');
    expect(statSync(contextDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(contextDir, 'actors')).mode & 0o777).toBe(0o700);
    expect(statSync(actorFile()).mode & 0o777).toBe(0o600);
  });

  test('a persisted credential is WITHHELD when the command asserts a DIFFERENT agentId', () => {
    persistCliActorCredential('ACTOR01.secret-hex', 'soul-a');
    // Presenting soul A's credential while asserting agent B is the
    // laundering the daemon 403s; withholding yields the clearer 401.
    expect(resolveCliActorCredential('soul-b')).toBeUndefined();
  });

  test('PD_ACTOR_CREDENTIAL env wins over both the context store and the slot file', () => {
    persistCliActorCredential('STORED.slot-secret', null);
    writeCurrentContext({
      agentId: 'ctx-agent',
      sessionId: 'sess-1',
      credential: 'CONTEXT.ctx-secret',
    });
    process.env.PD_ACTOR_CREDENTIAL = 'ENV0001.env-secret';
    expect(resolveCliActorCredential()).toBe('ENV0001.env-secret');
    // Env wins even when the asserted agentId matches the context's.
    expect(resolveCliActorCredential('ctx-agent')).toBe('ENV0001.env-secret');
    // And even when it does NOT: the env override is unconditional — it is
    // the operator's explicit word, checked before any agentId matching.
    expect(resolveCliActorCredential('someone-else')).toBe('ENV0001.env-secret');
  });

  test('PORT_DADDY_ACTOR_CREDENTIAL is the fallback env spelling; PD_ACTOR_CREDENTIAL beats it', () => {
    process.env.PORT_DADDY_ACTOR_CREDENTIAL = 'LONGVAR.secret';
    expect(resolveCliActorCredential()).toBe('LONGVAR.secret');
    process.env.PD_ACTOR_CREDENTIAL = 'SHORTV1.secret';
    expect(resolveCliActorCredential()).toBe('SHORTV1.secret');
  });

  test('an env credential is withheld when its paired PD_AGENT_ID conflicts with the asserted agent', () => {
    process.env.PD_AGENT_ID = 'env-agent-a';
    process.env.PD_ACTOR_CREDENTIAL = 'ENV0002.agent-a-secret';

    expect(resolveCliActorCredential('env-agent-b')).toBeUndefined();
    expect(resolveCliActorCredential('env-agent-a')).toBe('ENV0002.agent-a-secret');
  });

  test('a contradictory complete env context never releases the slot credential by accident', () => {
    writeCurrentContext({
      agentId: 'slot-agent',
      sessionId: 'slot-session',
      credential: 'CONTEXT.slot-secret',
    });
    process.env.PD_AGENT_ID = 'env-agent';
    process.env.PD_SESSION_ID = 'env-session';

    expect(resolveCliActorCredential('slot-agent')).toBeUndefined();
  });

  test('the `pd begin` context credential outranks the per-slot actor file', () => {
    persistCliActorCredential('STORED.slot-secret', null);
    writeCurrentContext({
      agentId: 'ctx-agent',
      sessionId: 'sess-1',
      credential: 'CONTEXT.ctx-secret',
    });
    expect(resolveCliActorCredential()).toBe('CONTEXT.ctx-secret');
    expect(resolveCliActorCredential('ctx-agent')).toBe('CONTEXT.ctx-secret');
    // Context credential is withheld on an agentId mismatch — the resolver
    // then falls through to the slot file (whose null agentId matches any).
    expect(resolveCliActorCredential('someone-else')).toBe('STORED.slot-secret');
  });

  test('a malformed per-slot actor file is treated as absent (fail-closed → re-mint path)', () => {
    mkdirSync(join(contextDir, 'actors'), { recursive: true });
    for (const garbage of [
      'not json at all',
      JSON.stringify(null),
      JSON.stringify(['array']),
      JSON.stringify({ agentId: 'x' }), // no credential key
      JSON.stringify({ credential: 42 }), // non-string credential
      JSON.stringify({ credential: '   ' }), // blank credential
    ]) {
      writeFileSync(actorFile(), garbage);
      expect(resolveCliActorCredential()).toBeUndefined();
    }
  });

  test('nothing resolvable → undefined, so the daemon 401s the attributed write (fail-closed)', () => {
    expect(resolveCliActorCredential()).toBeUndefined();
    expect(resolveCliActorCredential('any-agent')).toBeUndefined();
  });

  test('a symlinked actor directory cannot exfiltrate a persisted credential', () => {
    const target = mkdtempSync(join(tmpdir(), 'pd-actor-symlink-target-'));
    chmodSync(target, 0o755);
    symlinkSync(target, join(contextDir, 'actors'));

    persistCliActorCredential('SECRET.must-not-escape', 'safe-agent');

    expect(readdirSync(target)).toEqual([]);
    expect(statSync(target).mode & 0o777).toBe(0o755);
    expect(resolveCliActorCredential('safe-agent')).toBeUndefined();
    rmSync(target, { recursive: true, force: true });
  });

  test('a symlinked actor file is neither read nor chmodded', () => {
    mkdirSync(join(contextDir, 'actors'), { mode: 0o700 });
    const target = join(contextDir, 'outside-credential.json');
    writeFileSync(target, JSON.stringify({ agentId: 'safe-agent', credential: 'STOLEN.secret' }), { mode: 0o644 });
    symlinkSync(target, actorFile());

    expect(resolveCliActorCredential('safe-agent')).toBeUndefined();
    expect(statSync(target).mode & 0o777).toBe(0o644);
  });

  test('a hardlinked actor file is neither read nor chmodded', () => {
    mkdirSync(join(contextDir, 'actors'), { mode: 0o700 });
    const target = join(contextDir, 'outside-credential.json');
    const original = JSON.stringify({ agentId: 'safe-agent', credential: 'FIXTURE.secret' });
    writeFileSync(target, original, { mode: 0o644 });
    linkSync(target, actorFile());

    expect(statSync(target).nlink).toBe(2);
    expect(resolveCliActorCredential('safe-agent')).toBeUndefined();
    expect(statSync(target).mode & 0o777).toBe(0o644);
    expect(readFileSync(target, 'utf8')).toBe(original);
  });

  test('another user cannot trigger credential-directory repair or replacement', () => {
    persistCliActorCredential('OWNER.secret', 'owner');
    chmodSync(contextDir, 0o755);
    const uid = jest.spyOn(process, 'getuid').mockReturnValue(statSync(contextDir).uid + 1);
    try {
      expect(resolveCliActorCredential()).toBeUndefined();
      persistCliActorCredential('OTHER.secret', 'other');
      expect(statSync(contextDir).mode & 0o777).toBe(0o755);
      expect(JSON.parse(readFileSync(actorFile(), 'utf8')).credential).toBe('OWNER.secret');
    } finally {
      uid.mockRestore();
    }
  });
});
