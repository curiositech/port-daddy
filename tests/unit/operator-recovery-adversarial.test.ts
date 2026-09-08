import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createActorSouls } from '../../lib/actor-souls.js';
import { canonicalJson } from '../../lib/agent-harbor/event-ledger.js';
import {
  createOperatorRecovery,
  installOperatorRecoveryContext,
  operatorRecoveryContextDigest,
  type OperatorPresenceSignatureVerifier,
  type RecoveredContextCustodyReceipt,
} from '../../lib/operator-recovery.js';
import type { SecretStore } from '../../lib/macaroon/store.js';
import type { RunOperatorEnrollmentHelperOptions } from '../../lib/operator-presence-helper.js';
import { createSessions } from '../../lib/sessions.js';
import { getWorktreeInfo } from '../../lib/worktree.js';
import { operatorRecoveryPlugin } from '../../routes/operator-recovery.js';
import { sessionsPlugin } from '../../routes/sessions.js';
import { __setContextSlotLockKernelForTests } from '../../lib/context-slot-lock.js';

const HARBOR = 'local';
const PROJECT = 'port-daddy';
const GENERATION = 'daemon-generation-red-team-1';
const INTENDED_AGENT_ID = 'port-daddy:red-team:restart-continuity';
const CONTEXT_SLOT = 'codex-red-team-recovery';
const PUBLIC_KEY = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 0x41)]);
const PUBLIC_KEY_BASE64 = PUBLIC_KEY.toString('base64');
const PUBLIC_KEY_DIGEST = `sha256:${createHash('sha256').update(PUBLIC_KEY).digest('hex')}`;
const DEVICE_KEY_ID = `se-p256:${PUBLIC_KEY_DIGEST.slice('sha256:'.length)}`;
const WORKTREE = realpathSync.native(process.cwd());
const BRANCH = getWorktreeInfo(WORKTREE)?.branch;
if (!BRANCH) throw new Error('operator-recovery adversarial test requires a live git branch');
const SCRATCH_PARENT = join(process.cwd(), '.scratch');

type Db = Database.Database;
type Souls = ReturnType<typeof createActorSouls>;
type Sessions = ReturnType<typeof createSessions>;
type Recovery = ReturnType<typeof createOperatorRecovery>;

const openDbs = new Set<Db>();
const scratchDirs = new Set<string>();

beforeEach(() => {
  const held = new Set<string>();
  __setContextSlotLockKernelForTests({
    tryLock(descriptor) {
      const stat = fstatSync(descriptor);
      const key = `${stat.dev}:${stat.ino}`;
      if (held.has(key)) return 'busy';
      held.add(key);
      return 'acquired';
    },
    unlock(descriptor) {
      const stat = fstatSync(descriptor);
      return held.delete(`${stat.dev}:${stat.ino}`);
    },
  });
});

afterEach(() => {
  __setContextSlotLockKernelForTests(null);
  for (const db of openDbs) {
    try { db.close(); } catch { /* already closed by the test */ }
  }
  openDbs.clear();
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
  scratchDirs.clear();
});

function scratchDir(): string {
  mkdirSync(SCRATCH_PARENT, { recursive: true });
  const dir = mkdtempSync(join(SCRATCH_PARENT, 'operator-recovery-red-'));
  scratchDirs.add(dir);
  return dir;
}

function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  openDbs.add(db);
  return db;
}

class SqliteTestSecretStore implements SecretStore {
  constructor(private readonly db: Db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS operator_recovery_test_secrets (
        account TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  }

  put(account: string, value: string): boolean {
    this.db.prepare(`
      INSERT INTO operator_recovery_test_secrets (account, value)
      VALUES (?, ?)
      ON CONFLICT(account) DO UPDATE SET value = excluded.value
    `).run(account, value);
    return true;
  }

  get(account: string): string | null {
    const row = this.db.prepare(
      'SELECT value FROM operator_recovery_test_secrets WHERE account = ?',
    ).get(account) as { value: string } | undefined;
    return row?.value ?? null;
  }

  del(account: string): boolean {
    return this.db.prepare(
      'DELETE FROM operator_recovery_test_secrets WHERE account = ?',
    ).run(account).changes > 0;
  }
}

class FaultInjectingSecretStore extends SqliteTestSecretStore {
  throwOnGet = false;
  readonly diagnostic = 'native secret-store read exploded with pdab1.actor.body.secret-red-team';

  override get(account: string): string | null {
    if (this.throwOnGet) throw new Error(this.diagnostic);
    return super.get(account);
  }
}

function trustedVerifier(): OperatorPresenceSignatureVerifier {
  return {
    verify() { return { ok: true }; },
  };
}

async function enrollmentHelper(options: RunOperatorEnrollmentHelperOptions) {
  const response = {
    protocolVersion: 2 as const,
    operation: 'enrollment-response' as const,
    requestId: options.request.requestId,
    nonce: options.request.nonce,
    daemonGeneration: options.request.daemonGeneration,
    bootstrapId: options.request.bootstrapId,
    expiresAtMs: options.request.expiresAtMs,
    challengeDigest: options.request.challengeDigest,
    deviceKeyId: DEVICE_KEY_ID,
    keyDigest: PUBLIC_KEY_DIGEST,
    publicKeyX963Base64: PUBLIC_KEY_BASE64,
    signatureDerBase64: Buffer.from([0x30, 0x00]).toString('base64'),
    keyState: 'pending' as const,
  };
  const processTrust = {
    pid: 51_003,
    identity: 'anchor apple generic and identifier "ai.portdaddy.FleetBar"',
    notarized: true,
    hardened_runtime: true,
    debug_privileges: false,
    unsafe_dyld_environment: false,
  };
  const pinReceipt = await options.commitVerifiedEnrollment({
    response,
    responseDigest: `sha256:${'4'.repeat(64)}`,
    processTrust,
    challenge: Buffer.from(options.request.challengeBytesBase64, 'base64'),
  });
  const activationReceipt = {
    protocolVersion: 2 as const,
    operation: 'enrollment-activated' as const,
    requestId: options.request.requestId,
    nonce: options.request.nonce,
    daemonGeneration: options.request.daemonGeneration,
    bootstrapId: options.request.bootstrapId,
    expiresAtMs: options.request.expiresAtMs,
    challengeDigest: options.request.challengeDigest,
    deviceKeyId: response.deviceKeyId,
    keyDigest: response.keyDigest,
    responseDigest: `sha256:${'4'.repeat(64)}`,
    enrollmentEventId: pinReceipt.enrollmentEventId,
    activationEventId: pinReceipt.activationEventId,
    activationNonce: pinReceipt.activationNonce,
    activationCommandDigest: `sha256:${'5'.repeat(64)}`,
    keyState: 'active' as const,
  };
  await options.commitVerifiedActivation({
    receipt: activationReceipt,
    receiptDigest: `sha256:${'6'.repeat(64)}`,
    processTrust,
  });
  return {
    response,
    responseDigest: `sha256:${'4'.repeat(64)}`,
    activationReceipt,
    activationReceiptDigest: `sha256:${'6'.repeat(64)}`,
    enrollmentProcessTrust: processTrust,
    activationProcessTrust: processTrust,
  };
}

function runtime(
  db: Db,
  clock: { now: number },
  options: {
    secrets?: SecretStore;
    signatureVerifier?: OperatorPresenceSignatureVerifier | null;
    installContext?: ((input: Record<string, any>) => RecoveredContextCustodyReceipt) | null;
    installedContexts?: Array<Record<string, any>>;
  } = {},
) {
  const secrets = options.secrets ?? new SqliteTestSecretStore(db);
  const installedContexts = options.installedContexts ?? [];
  const actorSouls = createActorSouls(db, { now: () => clock.now });
  const sessions = createSessions(db);
  const operatorRecovery = createOperatorRecovery({
    db,
    actorSouls,
    sessions,
    daemonGeneration: GENERATION,
    signatureVerifier: options.signatureVerifier === undefined
      ? trustedVerifier()
      : options.signatureVerifier,
    runEnrollmentHelper: enrollmentHelper,
    fleetBarExecutablePath: '/Applications/FleetBar.app/Contents/MacOS/FleetBar',
    secrets,
    now: () => clock.now,
    resolveGitBranch: () => BRANCH,
    installRecoveredContext: options.installContext === null
      ? undefined
      : (input) => (options.installContext ?? ((entry) => {
        installedContexts.push(entry);
        return {
          contextSlot: String(entry.contextSlot),
          contextPath: join(
            String(entry.canonicalWorktree),
            '.portdaddy',
            'contexts',
            `${String(entry.contextSlot)}.json`,
          ),
          mode: 0o600 as const,
          contentDigest: String(entry.expectedContextDigest),
        };
      }))(input),
  });
  return { actorSouls, sessions, operatorRecovery, secrets, installedContexts };
}

function predecessor(actorSouls: Souls, sessions: Sessions, clock: number) {
  const actor = actorSouls.mint({ alias: INTENDED_AGENT_ID });
  const started = sessions.start('Resume exact operator-recovery task', {
    agentId: INTENDED_AGENT_ID,
    project: PROJECT,
    worktreeId: 'operator-recovery-red-worktree',
    durable: true,
    metadata: {
      identity: { verified: true, actorId: actor.actorId, verifiedAt: clock - 1 },
      worktree: {
        id: 'operator-recovery-red-worktree',
        root: WORKTREE,
        branch: BRANCH,
        isMain: false,
      },
    },
  });
  expect(started.success).toBe(true);
  expect(sessions.claimFiles(started.id as string, [
    'lib/operator-recovery-red-a.ts',
    'lib/operator-recovery-red-b.ts',
  ], { agentId: INTENDED_AGENT_ID }).success).toBe(true);
  const detail = sessions.get(started.id as string) as Record<string, any>;
  const activeClaims = detail.files.filter((file: Record<string, unknown>) => file.releasedAt === null);
  const claimChanges = activeClaims.map((file: Record<string, unknown>, index: number) => ({
    nodeId: String(file.nodeId),
    disposition: index === 0 ? 'transfer' as const : 'release' as const,
  }));
  return {
    actor,
    sessionId: started.id as string,
    activeClaims,
    claimChanges,
  };
}

async function createChallenge(api: Recovery, fixture: ReturnType<typeof predecessor>, expiresAt: number) {
  return api.createChallenge({
    harbor: HARBOR,
    intendedAgentId: INTENDED_AGENT_ID,
    project: PROJECT,
    worktree: WORKTREE,
    branch: BRANCH,
    predecessorSessionId: fixture.sessionId,
    sessionIntent: 'Resume exact operator-recovery task',
    actorId: fixture.actor.actorId,
    contextSlot: CONTEXT_SLOT,
    claims: fixture.claimChanges,
    expiresAt,
  }) as Promise<any>;
}

async function approve(api: Recovery, created: any) {
  const signed = created.signing.approve;
  return api.decide({
    recoveryId: created.recoveryId,
    decision: 'approve',
    deviceKeyId: DEVICE_KEY_ID,
    publicKeyX963Base64: PUBLIC_KEY_BASE64,
    signatureDerBase64: Buffer.from([0x30, 0x00]).toString('base64'),
    challengeDigest: signed.challengeDigest,
  }) as Promise<any>;
}

async function recoveredFixture(db: Db, clock: { now: number }) {
  const setup = runtime(db, clock);
  const fixture = predecessor(setup.actorSouls, setup.sessions, clock.now);
  const created = await createChallenge(setup.operatorRecovery, fixture, clock.now + 120_000);
  const approved = await approve(setup.operatorRecovery, created);
  const consumed = setup.operatorRecovery.consume(created.recoveryId, approved.grant) as any;
  return { ...setup, fixture, created, approved, consumed };
}

function bodyUseContext(sessionId: string, intendedAgentId = INTENDED_AGENT_ID, action = 'session.note.write') {
  return {
    action,
    resource: {
      sessionId,
      intendedAgentId,
      project: PROJECT,
      canonicalWorktree: WORKTREE,
      branch: BRANCH,
      status: 'active',
    },
  } as any;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function eventRows(db: Db, recoveryId: string) {
  return db.prepare(`
    SELECT ledger_seq, event_id, payload_json
      FROM harbor_events
     WHERE stream_type = 'operator-recovery-event'
       AND json_extract(payload_json, '$.recoveryId') = ?
     ORDER BY ledger_seq ASC
  `).all(recoveryId) as Array<{ ledger_seq: number; event_id: string; payload_json: string }>;
}

function expectExactBodyContract(body: any, expected: {
  actorId: string;
  sessionId: string;
  expiresAt: number;
}) {
  expect(Object.keys(body).sort()).toEqual([
    'actorId',
    'bodyId',
    'expiresAt',
    'intendedAgentId',
    'issuedAt',
    'scope',
    'scopeProfile',
  ]);
  expect(body).not.toHaveProperty('credential');
  expect(body).toEqual({
    bodyId: expect.any(String),
    actorId: expected.actorId,
    intendedAgentId: INTENDED_AGENT_ID,
    scopeProfile: 'session-body-v1',
    scope: {
      harbor: HARBOR,
      sessionId: expected.sessionId,
      project: PROJECT,
      canonicalWorktree: WORKTREE,
      branch: BRANCH,
    },
    issuedAt: expect.any(Number),
    expiresAt: expected.expiresAt,
  });
}

describe('operator recovery adversarial invariants', () => {
  it('keeps two disposable same-actor bodies valid across a daemon restart without minting another actor', () => {
    const dir = scratchDir();
    const dbPath = join(dir, 'continuity.sqlite');
    const clock = { now: 1_900_000_000_000 };
    const firstDb = openDb(dbPath);
    const firstSouls = createActorSouls(firstDb, { now: () => clock.now });
    const actor = firstSouls.mint({ alias: INTENDED_AGENT_ID });
    const scope = {
      intendedAgentId: INTENDED_AGENT_ID,
      successorSessionId: 'session-recovered-body-a',
      project: PROJECT,
      canonicalWorktree: WORKTREE,
      branch: BRANCH,
      recoveryId: 'recovery-red-continuity',
      contextSlot: 'red-team',
      issuedDaemonGeneration: GENERATION,
    };
    const bodyA = firstSouls.issueBodyCredential({
      actorId: actor.actorId,
      profile: 'session-body-v1',
      scope,
      expiresAt: clock.now + 60_000,
    });
    const bodyB = firstSouls.issueBodyCredential({
      actorId: actor.actorId,
      profile: 'session-body-v1',
      scope,
      expiresAt: clock.now + 60_000,
    });
    firstDb.close();
    openDbs.delete(firstDb);

    const restartedDb = openDb(dbPath);
    const restartedSouls = createActorSouls(restartedDb, { now: () => clock.now });
    expect(restartedSouls.verifyCredential(actor.credential)).toBe(actor.actorId);
    expect(restartedSouls.verifyCredentialUse(bodyA.credential, {
      context: bodyUseContext(scope.successorSessionId),
    })).toMatchObject({ ok: true, actorId: actor.actorId, bodyCredentialId: bodyA.bodyCredentialId });
    expect(restartedSouls.verifyCredentialUse(bodyB.credential, {
      context: bodyUseContext(scope.successorSessionId),
    })).toMatchObject({ ok: true, actorId: actor.actorId, bodyCredentialId: bodyB.bodyCredentialId });
    expect(restartedDb.prepare('SELECT COUNT(*) AS n FROM actor_souls').get()).toEqual({ n: 1 });
    expect(restartedDb.prepare('SELECT COUNT(*) AS n FROM actor_body_credentials').get()).toEqual({ n: 3 });
  });

  it('enforces exact session/action/display scope and exact expiry/revocation boundaries', () => {
    const db = openDb(join(scratchDir(), 'body-scope.sqlite'));
    const clock = { now: 1_900_000_000_000 };
    const souls = createActorSouls(db, { now: () => clock.now });
    const actor = souls.mint({ alias: INTENDED_AGENT_ID });
    const scope = {
      intendedAgentId: INTENDED_AGENT_ID,
      successorSessionId: 'session-exact-scope',
      project: PROJECT,
      canonicalWorktree: WORKTREE,
      branch: BRANCH,
      recoveryId: 'recovery-exact-scope',
      contextSlot: null,
      issuedDaemonGeneration: GENERATION,
    };
    const expiring = souls.issueBodyCredential({
      actorId: actor.actorId,
      profile: 'session-body-v1',
      scope,
      expiresAt: clock.now + 100,
    });

    expect(souls.verifyCredential(expiring.credential)).toBeNull();
    expect(souls.verifyCredentialUse(expiring.credential, {
      context: bodyUseContext('session-other'),
    })).toEqual(expect.objectContaining({ ok: false, code: 'CREDENTIAL_SCOPE_MISMATCH' }));
    expect(souls.verifyCredentialUse(expiring.credential, {
      context: bodyUseContext(scope.successorSessionId, 'port-daddy:wrong:display'),
    })).toEqual(expect.objectContaining({ ok: false, code: 'CREDENTIAL_SCOPE_MISMATCH' }));
    expect(souls.verifyCredentialUse(expiring.credential, {
      context: bodyUseContext(scope.successorSessionId, INTENDED_AGENT_ID, 'session.start'),
    })).toEqual(expect.objectContaining({ ok: false, code: 'CREDENTIAL_SCOPE_MISMATCH' }));

    clock.now = expiring.expiresAt!;
    expect(souls.verifyCredentialUse(expiring.credential, {
      context: bodyUseContext(scope.successorSessionId),
    })).toEqual(expect.objectContaining({ ok: false, code: 'CREDENTIAL_EXPIRED' }));

    const revoked = souls.issueBodyCredential({
      actorId: actor.actorId,
      profile: 'session-body-v1',
      scope,
      expiresAt: clock.now + 100,
    });
    expect(souls.revokeBodyCredential({
      actorId: actor.actorId,
      bodyCredentialId: revoked.bodyCredentialId,
      revokedAt: clock.now,
    })).toBe(true);
    expect(souls.verifyCredentialUse(revoked.credential, {
      context: bodyUseContext(scope.successorSessionId),
    })).toEqual(expect.objectContaining({ ok: false, code: 'CREDENTIAL_REVOKED' }));
    expect(souls.revokeBodyCredential({
      actorId: actor.actorId,
      bodyCredentialId: revoked.bodyCredentialId,
      revokedAt: clock.now,
    })).toBe(false);
  });

  it('binds every authority coordinate and immutable claim descriptor into the action hash', async () => {
    const db = openDb(join(scratchDir(), 'action-hash.sqlite'));
    const clock = { now: 1_900_000_000_000 };
    const { actorSouls, sessions, operatorRecovery } = runtime(db, clock);
    const fixture = predecessor(actorSouls, sessions, clock.now);
    const created = await createChallenge(operatorRecovery, fixture, clock.now + 60_000);
    const envelope = JSON.parse(Buffer.from(
      created.signing.approve.challengeBytesBase64,
      'base64',
    ).toString('utf8')) as Record<string, any>;

    expect(envelope).toEqual(expect.objectContaining({
      recoveryId: created.recoveryId,
      actorId: fixture.actor.actorId,
      intendedAgentId: INTENDED_AGENT_ID,
      harbor: HARBOR,
      project: PROJECT,
      worktree: WORKTREE,
      branch: BRANCH,
      predecessorSessionId: fixture.sessionId,
      sessionIntent: 'Resume exact operator-recovery task',
      daemonGeneration: GENERATION,
      nonce: expect.any(String),
      expiresAt: clock.now + 60_000,
      jtiDigest: expect.stringMatching(/^sha256:/),
      claims: expect.any(Array),
    }));
    expect(envelope.claims).toHaveLength(fixture.activeClaims.length);
    expect(envelope.claims).toEqual(fixture.activeClaims.map((claim: Record<string, any>, index: number) => (
      expect.objectContaining({
        ...claim,
        disposition: index === 0 ? 'transfer' : 'release',
        startLine: claim.startLine ?? null,
        endLine: claim.endLine ?? null,
        symbol: claim.symbol ?? null,
        symbolPath: claim.symbolPath ?? null,
      })
    )).sort((a: any, b: any) => String(a.sample.nodeId).localeCompare(String(b.sample.nodeId))));

    const { schema: _schema, decision: _decision, actionHash, ...boundAction } = envelope;
    expect(actionHash).toBe(sha256(canonicalJson({ kind: 'rebind-session', ...boundAction })));
    expect(created.scope).toEqual(expect.objectContaining({
      actionHash,
      intendedAgentId: INTENDED_AGENT_ID,
      harbor: HARBOR,
      actorId: fixture.actor.actorId,
      daemonGeneration: GENERATION,
      nonce: envelope.nonce,
      expiresAt: envelope.expiresAt,
      claims: envelope.claims,
    }));
  });

  it('retires a killed publication temporary before installing one owner-only exact-slot body', () => {
    const worktree = scratchDir();
    const contextDir = join(worktree, '.portdaddy', 'contexts');
    mkdirSync(contextDir, { recursive: true });
    const orphanPath = join(
      contextDir,
      `.${CONTEXT_SLOT}.operator-recovery.${'a'.repeat(64)}.2147483647.${'b'.repeat(32)}.tmp`,
    );
    writeFileSync(orphanPath, 'pdab1.orphaned.publication.secret', { mode: 0o600 });
    const material = {
      recoveryId: 'recovery-red-killed-publication',
      daemonGeneration: GENERATION,
      custodyDaemonGeneration: GENERATION,
      canonicalWorktree: realpathSync.native(worktree),
      contextSlot: CONTEXT_SLOT,
      intendedAgentId: INTENDED_AGENT_ID,
      successorSessionId: 'session-red-killed-publication',
      sessionIntent: 'Resume after killed context publication',
      project: PROJECT,
      actorId: '01REDKILLEDPUBLICATION00000',
      credential: 'pdab1.actor-red.body-red.secret-red',
      issuedAt: 1_900_000_000_000,
      expiresAt: 1_900_000_060_000,
    };
    const receipt = installOperatorRecoveryContext({
      ...material,
      expectedContextDigest: operatorRecoveryContextDigest(material),
      expectedPriorContextDigest: null,
      assertPublicationAuthorized() {},
    });

    expect(existsSync(orphanPath)).toBe(false);
    expect(statSync(receipt.contextPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(receipt.contextPath, 'utf8'))).toMatchObject({
      agentId: INTENDED_AGENT_ID,
      sessionId: 'session-red-killed-publication',
      contextSlot: CONTEXT_SLOT,
      credential: material.credential,
    });
    expect(existsSync(join(worktree, '.portdaddy', 'current.json'))).toBe(false);
  });

  it('redacts a thrown native verifier diagnostic from the error and append-only ledger', async () => {
    const db = openDb(join(scratchDir(), 'verifier-redaction.sqlite'));
    const clock = { now: 1_900_000_000_000 };
    const poison = 'kernel verifier leaked pdab1.actor.body.native-secret and DER signature bytes';
    const setup = runtime(db, clock, {
      signatureVerifier: {
        verify() { throw new Error(poison); },
      },
    });
    const fixture = predecessor(setup.actorSouls, setup.sessions, clock.now);
    const created = await createChallenge(setup.operatorRecovery, fixture, clock.now + 60_000);

    let refusal: unknown;
    try {
      await approve(setup.operatorRecovery, created);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({
      code: 'OPERATOR_RECOVERY_SIGNATURE_INVALID',
      message: 'native operator-presence signature verification failed closed',
      diagnosticDigest: expect.stringMatching(/^sha256:/),
    });
    expect(JSON.stringify(refusal)).not.toContain(poison);
    const state = setup.operatorRecovery.get(created.recoveryId) as any;
    expect(state.events.at(-1)).toMatchObject({
      kind: 'drift-refused',
      code: 'OPERATOR_RECOVERY_SIGNATURE_INVALID',
      reason: expect.stringMatching(/^native signature verifier failed closed; diagnosticDigest=sha256:/),
    });
    expect(eventRows(db, created.recoveryId).map((row) => row.payload_json).join('\n'))
      .not.toContain(poison);
  });

  it('terminalizes when native verification crosses the signed challenge expiry', async () => {
    const db = openDb(join(scratchDir(), 'verifier-expiry.sqlite'));
    const clock = { now: 1_900_000_000_000 };
    let verifierFinish = Number.MAX_SAFE_INTEGER;
    const setup = runtime(db, clock, {
      signatureVerifier: {
        verify() {
          clock.now = verifierFinish;
          return { ok: true };
        },
      },
    });
    const fixture = predecessor(setup.actorSouls, setup.sessions, clock.now);
    const created = await createChallenge(setup.operatorRecovery, fixture, clock.now + 60_000);
    verifierFinish = created.scope.expiresAt;

    await expect(approve(setup.operatorRecovery, created)).rejects.toMatchObject({
      code: 'OPERATOR_RECOVERY_GRANT_EXPIRED',
    });
    expect(setup.operatorRecovery.get(created.recoveryId)).toMatchObject({
      status: 'expired',
      receipt: { terminalAuthorityEventId: expect.any(String) },
    });
  });

  it('revokes sealed custody when a slow installer crosses the body expiry', async () => {
    const db = openDb(join(scratchDir(), 'installer-expiry.sqlite'));
    const clock = { now: 1_900_000_000_000 };
    const setup = runtime(db, clock, {
      installContext(input) {
        clock.now = Number(input.expiresAt);
        input.assertPublicationAuthorized();
        throw new Error('publication authorization unexpectedly survived body expiry');
      },
    });
    const fixture = predecessor(setup.actorSouls, setup.sessions, clock.now);
    const created = await createChallenge(setup.operatorRecovery, fixture, clock.now + 60_000);
    const approved = await approve(setup.operatorRecovery, created);

    expect(() => setup.operatorRecovery.consume(created.recoveryId, approved.grant)).toThrow(
      expect.objectContaining({ code: 'OPERATOR_RECOVERY_BODY_EXPIRED' }),
    );
    const expired = setup.operatorRecovery.get(created.recoveryId) as any;
    const bound = expired.events.find((event: any) => event.kind === 'session-bound');
    expect(expired.status).toBe('expired');
    expect(db.prepare(`
      SELECT revoked_at AS revokedAt
      FROM actor_body_credentials WHERE body_credential_id = ?
    `).get(bound.bodyCredentialId)).toEqual({ revokedAt: clock.now });
  });

  it('narrates a startup secret-store read outage without treating it as missing authority or leaking diagnostics', async () => {
    const db = openDb(join(scratchDir(), 'startup-store-outage.sqlite'));
    const clock = { now: 1_900_000_000_000 };
    const secrets = new FaultInjectingSecretStore(db);
    const setup = runtime(db, clock, { secrets });
    const fixture = predecessor(setup.actorSouls, setup.sessions, clock.now);
    const created = await createChallenge(setup.operatorRecovery, fixture, clock.now + 60_000);
    await approve(setup.operatorRecovery, created);
    secrets.throwOnGet = true;

    const restarted = runtime(db, clock, { secrets });
    const state = restarted.operatorRecovery.get(created.recoveryId) as any;
    expect(state.status).toBe('approved');
    expect(state.events.at(-1)).toMatchObject({
      kind: 'drift-refused',
      code: 'OPERATOR_RECOVERY_ENVELOPE_RETIREMENT_PENDING',
    });
    expect(JSON.stringify(state)).not.toContain(secrets.diagnostic);
    expect(eventRows(db, created.recoveryId).map((row) => row.payload_json).join('\n'))
      .not.toContain(secrets.diagnostic);
  });

  it('keeps the internal grant and plaintext body out of the canonical decision projection', async () => {
    const db = openDb(join(scratchDir(), 'http-redaction.sqlite'));
    const clock = { now: 1_900_000_000_000 };
    const installedContexts: Array<Record<string, any>> = [];
    const setup = runtime(db, clock, { installedContexts });
    const fixture = predecessor(setup.actorSouls, setup.sessions, clock.now);
    const created = await createChallenge(setup.operatorRecovery, fixture, clock.now + 60_000);
    const app = Fastify();
    app.register(operatorRecoveryPlugin, {
      deps: {
        operatorRecovery: setup.operatorRecovery,
        logger: { info() {}, error() {} },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/operator-recovery/${created.recoveryId}/decision`,
      payload: {
        decision: 'approve',
        deviceKeyId: DEVICE_KEY_ID,
        publicKeyX963Base64: PUBLIC_KEY_BASE64,
        signatureDerBase64: Buffer.from([0x30, 0x00]).toString('base64'),
        challengeDigest: created.signing.approve.challengeDigest,
      },
    });
    const credential = String(installedContexts[0].credential);
    expect(response.statusCode).toBe(200);
    expect(credential).toMatch(/^pdab1\./);
    expect(response.json()).not.toHaveProperty('credential');
    expect(response.json()).not.toHaveProperty('grant');
    expect(response.json().bodyCredential).not.toHaveProperty('credential');
    expect(JSON.stringify(response.json())).not.toContain(credential);
    expect(JSON.stringify(response.json())).not.toContain('pdab1.');
    await app.close();
  });

  it('returns only body metadata and never puts JTI, signature, or credential material in harbor events', async () => {
    const db = openDb(join(scratchDir(), 'secret-redaction.sqlite'));
    const clock = { now: 1_900_000_000_000 };
    const recovered = await recoveredFixture(db, clock);
    const body = recovered.consumed.bodyCredential;
    const credential = String(recovered.installedContexts[0].credential);
    expect(credential).toMatch(/^pdab1\./);
    expectExactBodyContract(body, {
      actorId: recovered.fixture.actor.actorId,
      sessionId: recovered.consumed.successorSessionId,
      expiresAt: recovered.created.scope.bodyExpiresAt,
    });

    const rows = eventRows(db, recovered.created.recoveryId);
    const raw = rows.map((row) => JSON.parse(row.payload_json));
    const serialized = JSON.stringify(raw);
    expect(serialized).not.toContain(recovered.approved.grant.identifier);
    expect(serialized).not.toContain(recovered.approved.grant.signature);
    expect(serialized).not.toContain(credential);
    expect(serialized).not.toContain(credential.split('.').at(-1));
    for (const event of raw) {
      expect(Object.hasOwn(event, 'jti')).toBe(false);
      expect(Object.hasOwn(event, 'signature')).toBe(false);
      expect(Object.hasOwn(event, 'credential')).toBe(false);
    }
    const readback = recovered.operatorRecovery.get(recovered.created.recoveryId) as any;
    expect(readback.bodyCredential).toMatchObject({
      actorId: recovered.fixture.actor.actorId,
      intendedAgentId: INTENDED_AGENT_ID,
      scopeProfile: 'session-body-v1',
      bodyId: expect.any(String),
      issuedAt: expect.any(Number),
      expiresAt: expect.any(Number),
      scope: {
        harbor: HARBOR,
        project: PROJECT,
        branch: BRANCH,
        canonicalWorktree: WORKTREE,
        sessionId: readback.successorSessionId,
      },
    });
    expect(JSON.stringify(readback)).not.toContain(credential);
    expect(JSON.stringify(recovered.operatorRecovery.list())).not.toContain(credential);
  });

  it('rolls back body, successor, claims, and authority events when failure is injected after issuance', async () => {
    const db = openDb(join(scratchDir(), 'rollback.sqlite'));
    const clock = { now: 1_900_000_000_000 };
    const setup = runtime(db, clock);
    const fixture = predecessor(setup.actorSouls, setup.sessions, clock.now);
    const created = await createChallenge(setup.operatorRecovery, fixture, clock.now + 60_000);
    const approved = await approve(setup.operatorRecovery, created);
    const bodyCountBefore = (db.prepare('SELECT COUNT(*) AS n FROM actor_body_credentials').get() as { n: number }).n;
    const authorityEventsBefore = eventRows(db, created.recoveryId)
      .filter((row) => ['grant-consumed', 'session-bound'].includes(JSON.parse(row.payload_json).kind)).length;
    const realIssue = setup.actorSouls.issueBodyCredential;
    const sabotagedSouls = new Proxy(setup.actorSouls, {
      get(target, property, receiver) {
        if (property !== 'issueBodyCredential') return Reflect.get(target, property, receiver);
        return (...args: Parameters<typeof realIssue>) => {
          realIssue(...args);
          throw Object.assign(new Error('red-team failure after body issuance'), {
            code: 'RED_TEAM_AFTER_BODY_ISSUANCE',
          });
        };
      },
    });
    const sabotagedApi = createOperatorRecovery({
      db,
      actorSouls: sabotagedSouls,
      sessions: setup.sessions,
      daemonGeneration: GENERATION,
      signatureVerifier: trustedVerifier(),
      runEnrollmentHelper: null,
      fleetBarExecutablePath: null,
      secrets: setup.secrets,
      now: () => clock.now,
      resolveGitBranch: () => BRANCH,
      installRecoveredContext: (input) => ({
        contextSlot: input.contextSlot,
        contextPath: join(input.canonicalWorktree, '.portdaddy', 'contexts', `${input.contextSlot}.json`),
        mode: 0o600,
        contentDigest: input.expectedContextDigest,
      }),
    });

    expect(() => sabotagedApi.consume(created.recoveryId, approved.grant)).toThrow(
      expect.objectContaining({ code: 'RED_TEAM_AFTER_BODY_ISSUANCE' }),
    );
    expect((db.prepare('SELECT COUNT(*) AS n FROM actor_body_credentials').get() as { n: number }).n)
      .toBe(bodyCountBefore);
    expect((setup.sessions.get(fixture.sessionId) as Record<string, any>).session.status).toBe('active');
    expect((setup.sessions.get(fixture.sessionId) as Record<string, any>).files
      .filter((claim: Record<string, unknown>) => claim.releasedAt === null)).toHaveLength(2);
    const successors = (setup.sessions.list({ allWorktrees: true, limit: 100 }) as Record<string, any>).sessions
      .filter((session: Record<string, any>) => session.metadata?.operatorRecovery?.recoveryId === created.recoveryId);
    expect(successors).toHaveLength(0);
    const authorityEventsAfter = eventRows(db, created.recoveryId)
      .filter((row) => ['grant-consumed', 'session-bound'].includes(JSON.parse(row.payload_json).kind)).length;
    expect(authorityEventsAfter).toBe(authorityEventsBefore);
    expect((sabotagedApi.get(created.recoveryId) as any).events.at(-1).kind).toBe('drift-refused');
  });

  it('allows exactly one consume across two file-backed SQLite connections and records the losing replay', async () => {
    const dir = scratchDir();
    const dbPath = join(dir, 'concurrent.sqlite');
    const clock = { now: 1_900_000_000_000 };
    const db = openDb(dbPath);
    const setup = runtime(db, clock);
    const fixture = predecessor(setup.actorSouls, setup.sessions, clock.now);
    const created = await createChallenge(setup.operatorRecovery, fixture, clock.now + 60_000);
    const approved = await approve(setup.operatorRecovery, created);
    const payloadPath = join(dir, 'consume.json');
    const gatePath = join(dir, 'start');
    const readyA = join(dir, 'ready-a');
    const readyB = join(dir, 'ready-b');
    writeFileSync(payloadPath, JSON.stringify({
      recoveryId: created.recoveryId,
      grant: approved.grant,
      now: clock.now,
      generation: GENERATION,
      branch: BRANCH,
    }), { mode: 0o600 });

    const repo = process.cwd();
    const actorSoulsUrl = pathToFileURL(join(repo, 'lib/actor-souls.ts')).href;
    const sessionsUrl = pathToFileURL(join(repo, 'lib/sessions.ts')).href;
    const recoveryUrl = pathToFileURL(join(repo, 'lib/operator-recovery.ts')).href;
    const workerSource = `
      import Database from 'better-sqlite3';
      import { existsSync, readFileSync, writeFileSync } from 'node:fs';
      const { createActorSouls } = await import(${JSON.stringify(actorSoulsUrl)});
      const { createSessions } = await import(${JSON.stringify(sessionsUrl)});
      const { createOperatorRecovery } = await import(${JSON.stringify(recoveryUrl)});
      const [dbPath, payloadPath, gatePath, readyPath] = process.argv.slice(1);
      const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));
      const db = new Database(dbPath);
      db.pragma('foreign_keys = ON');
      db.pragma('busy_timeout = 5000');
      const secrets = {
        put(account, value) {
          db.prepare('INSERT INTO operator_recovery_test_secrets (account, value) VALUES (?, ?) ON CONFLICT(account) DO UPDATE SET value = excluded.value').run(account, value);
          return true;
        },
        get(account) {
          return db.prepare('SELECT value FROM operator_recovery_test_secrets WHERE account = ?').get(account)?.value ?? null;
        },
        del(account) {
          return db.prepare('DELETE FROM operator_recovery_test_secrets WHERE account = ?').run(account).changes > 0;
        },
      };
      const actorSouls = createActorSouls(db, { now: () => payload.now });
      const sessions = createSessions(db);
      const api = createOperatorRecovery({
        db, actorSouls, sessions, daemonGeneration: payload.generation,
        signatureVerifier: null, runEnrollmentHelper: null,
        fleetBarExecutablePath: null, secrets, now: () => payload.now,
        resolveGitBranch: () => payload.branch,
        installRecoveredContext(input) {
          return {
            contextSlot: input.contextSlot,
            contextPath: input.canonicalWorktree + '/.portdaddy/contexts/' + input.contextSlot + '.json',
            mode: 384,
            contentDigest: input.expectedContextDigest,
          };
        },
      });
      writeFileSync(readyPath, 'ready');
      const waiter = new Int32Array(new SharedArrayBuffer(4));
      while (!existsSync(gatePath)) Atomics.wait(waiter, 0, 0, 5);
      try {
        const result = api.consume(payload.recoveryId, payload.grant);
        process.stdout.write('RESULT:' + JSON.stringify({ ok: true, result }) + '\\n');
      } catch (error) {
        process.stdout.write('RESULT:' + JSON.stringify({
          ok: false,
          code: typeof error?.code === 'string' ? error.code : 'UNKNOWN',
          message: error instanceof Error ? error.message : String(error),
        }) + '\\n');
      } finally {
        db.close();
      }
    `;

    const runWorker = (readyPath: string) => new Promise<any>((resolve, reject) => {
      const child = spawn(process.execPath, [
        '--import', 'tsx', '--input-type=module', '-e', workerSource,
        dbPath, payloadPath, gatePath, readyPath,
      ], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.on('error', reject);
      child.on('exit', (code) => {
        const line = stdout.split('\n').find((entry) => entry.startsWith('RESULT:'));
        if (code !== 0 || !line) {
          reject(new Error(`consume worker failed (${code}): ${stderr || stdout}`));
          return;
        }
        resolve(JSON.parse(line.slice('RESULT:'.length)));
      });
    });
    const workerA = runWorker(readyA);
    const workerB = runWorker(readyB);
    const waitDeadline = Date.now() + 5_000;
    while ((!existsSync(readyA) || !existsSync(readyB)) && Date.now() < waitDeadline) await delay(10);
    expect(existsSync(readyA) && existsSync(readyB)).toBe(true);
    writeFileSync(gatePath, 'go');
    const results = await Promise.all([workerA, workerB]);

    const winners = results.filter((result) => result.ok === true);
    const losers = results.filter((result) => result.ok === false);
    expect(winners).toHaveLength(1);
    expect(losers).toEqual([expect.objectContaining({ code: 'OPERATOR_RECOVERY_GRANT_REPLAYED' })]);
    expectExactBodyContract(winners[0].result.bodyCredential, {
      actorId: fixture.actor.actorId,
      sessionId: winners[0].result.successorSessionId,
      expiresAt: created.scope.bodyExpiresAt,
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM actor_body_credentials WHERE profile = 'session-body-v1'").get())
      .toEqual({ n: 1 });
    const kinds = eventRows(db, created.recoveryId).map((row) => JSON.parse(row.payload_json).kind);
    expect(kinds.filter((kind) => kind === 'grant-consumed')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'session-bound')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'replay-refused')).toHaveLength(1);
    const successors = (setup.sessions.list({ allWorktrees: true, limit: 100 }) as Record<string, any>).sessions
      .filter((session: Record<string, any>) => session.metadata?.operatorRecovery?.recoveryId === created.recoveryId);
    expect(successors).toHaveLength(1);
  }, 15_000);

  it('keeps integer ledger receipts and the authority terminal distinct from a later refusal', async () => {
    const db = openDb(join(scratchDir(), 'receipt.sqlite'));
    const clock = { now: 1_900_000_000_000 };
    const recovered = await recoveredFixture(db, clock);
    expect(() => recovered.operatorRecovery.consume(
      recovered.created.recoveryId,
      recovered.approved.grant,
    )).toThrow(expect.objectContaining({ code: 'OPERATOR_RECOVERY_GRANT_REPLAYED' }));

    const state = recovered.operatorRecovery.get(recovered.created.recoveryId) as any;
    const rows = eventRows(db, recovered.created.recoveryId);
    const custodyInstalled = rows.find((row) => JSON.parse(row.payload_json).kind === 'context-custody-installed')!;
    const replayRefused = rows.find((row) => JSON.parse(row.payload_json).kind === 'replay-refused')!;
    expect(state.receipt.ledgerSequences).toEqual(rows.map((row) => row.ledger_seq));
    expect(state.receipt.ledgerSequences.every(Number.isSafeInteger)).toBe(true);
    expect(state.receipt.eventIds).toEqual(rows.map((row) => row.event_id));
    expect(state.receipt.terminalAuthorityEventId).toBe(custodyInstalled.event_id);
    expect(state.receipt.terminalEventId).toBe(replayRefused.event_id);
    expect(state.events.at(-1)).toEqual(expect.objectContaining({ kind: 'replay-refused' }));
  });

  it('permits first normal note/plan/claim writes only on the recovered session, then revocation stops all three', async () => {
    const db = openDb(join(scratchDir(), 'normal-writes.sqlite'));
    const clock = { now: 1_900_000_000_000 };
    const recovered = await recoveredFixture(db, clock);
    const body = recovered.consumed.bodyCredential;
    const credential = String(recovered.installedContexts[0].credential);
    expect(body).not.toHaveProperty('credential');
    expect(credential).toMatch(/^pdab1\./);
    const successorId = recovered.consumed.successorSessionId as string;
    const app = Fastify();
    app.register(sessionsPlugin, {
      deps: {
        sessions: recovered.sessions,
        metrics: { errors: 0 },
        logger: { info() {}, error() {} },
        activityLog: { log() {} },
        actorSouls: recovered.actorSouls,
      },
    });

    const mutate = (payload: Record<string, unknown>, url = '/notes') => app.inject({
      method: 'POST',
      url,
      payload: {
        agentId: INTENDED_AGENT_ID,
        credential,
        ...payload,
      },
    });
    const note = await mutate({ sessionId: successorId, content: 'Recovered body narrates its first note.' });
    const plan = await mutate({
      sessionId: successorId,
      content: '- [ ] Prove recovered body scope',
      type: 'todo_list',
    });
    const claim = await mutate({ files: ['tests/recovered-body-proof.ts'] }, `/sessions/${successorId}/files`);
    expect([note.statusCode, plan.statusCode, claim.statusCode]).toEqual([200, 200, 200]);
    expect((recovered.sessions.getNotes(successorId) as Record<string, any>).notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: 'Recovered body narrates its first note.' }),
      expect.objectContaining({ type: 'todo_list', content: '- [ ] Prove recovered body scope' }),
    ]));
    expect((recovered.sessions.get(successorId) as Record<string, any>).files).toEqual(expect.arrayContaining([
      expect.objectContaining({ filePath: 'tests/recovered-body-proof.ts', releasedAt: null }),
    ]));

    const startAnother = await mutate({ purpose: 'body must not start a new session' }, '/sessions');
    expect(startAnother.statusCode).toBe(403);
    expect(startAnother.json().code).toBe('IDENTITY_CREDENTIAL_SCOPE_MISMATCH');
    const other = recovered.sessions.start('same actor, wrong session', {
      agentId: INTENDED_AGENT_ID,
      project: PROJECT,
      worktreeId: 'operator-recovery-red-worktree',
      metadata: {
        identity: { verified: true, actorId: recovered.fixture.actor.actorId, verifiedAt: clock.now },
        worktree: { root: WORKTREE, branch: BRANCH },
      },
    });
    const crossSession = await mutate({
      sessionId: other.id,
      content: 'body must not write the other session',
    });
    expect(crossSession.statusCode).toBe(403);
    expect(crossSession.json().code).toBe('IDENTITY_CREDENTIAL_SCOPE_MISMATCH');

    expect(recovered.actorSouls.revokeBodyCredential({
      actorId: body.actorId,
      bodyCredentialId: body.bodyId,
      revokedAt: clock.now,
    })).toBe(true);
    const noteCount = (recovered.sessions.getNotes(successorId) as Record<string, any>).notes.length;
    const fileCount = (recovered.sessions.get(successorId) as Record<string, any>).files.length;
    const revokedNote = await mutate({ sessionId: successorId, content: 'revoked note' });
    const revokedPlan = await mutate({ sessionId: successorId, content: '- [ ] revoked plan', type: 'todo_list' });
    const revokedClaim = await mutate({ files: ['tests/revoked-body-must-not-claim.ts'] }, `/sessions/${successorId}/files`);
    for (const response of [revokedNote, revokedPlan, revokedClaim]) {
      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe('IDENTITY_CREDENTIAL_INVALID');
    }
    expect((recovered.sessions.getNotes(successorId) as Record<string, any>).notes).toHaveLength(noteCount);
    expect((recovered.sessions.get(successorId) as Record<string, any>).files).toHaveLength(fileCount);
    await app.close();
  });
});
