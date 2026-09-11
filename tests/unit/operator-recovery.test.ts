import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
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
import { createTestDb } from '../setup-unit.js';
import { createActorSouls } from '../../lib/actor-souls.js';
import { createSessions } from '../../lib/sessions.js';
import {
  createOperatorRecovery,
  installOperatorRecoveryContext,
  MAX_OPERATOR_RECOVERY_SIGNING_PAYLOAD_BYTES,
  operatorRecoveryContextDigest,
  OPERATOR_RECOVERY_EVENT_SCHEMA,
  type OperatorPresenceSignatureVerifier,
  type RecoveredContextCustodyReceipt,
} from '../../lib/operator-recovery.js';
import { InMemorySecretStore, type SecretStore } from '../../lib/macaroon/store.js';
import type { RunOperatorEnrollmentHelperOptions } from '../../lib/operator-presence-helper.js';
import { appendEvent } from '../../lib/agent-harbor/event-ledger.js';
import {
  __setContextSlotLockKernelForTests,
  acquireContextSlotLock,
} from '../../lib/context-slot-lock.js';

const WORKTREE = realpathSync.native(process.cwd());
const BRANCH = 'codex/operator-recovery-test';
const PROJECT = 'port-daddy';
const HARBOR = 'local';
const GENERATION = 'daemon-generation-test-1';
const INTENDED_AGENT_ID = 'port-daddy:test:restart';
const CONTEXT_SLOT = 'codex-test-thread';
const PUBLIC_KEY = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 0x31)]);
const PUBLIC_KEY_BASE64 = PUBLIC_KEY.toString('base64');
const PUBLIC_KEY_DIGEST = `sha256:${createHash('sha256').update(PUBLIC_KEY).digest('hex')}`;
const DEVICE_KEY_ID = `se-p256:${PUBLIC_KEY_DIGEST.slice('sha256:'.length)}`;

class SqliteSecretStore implements SecretStore {
  constructor(private readonly database: Database.Database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS operator_recovery_test_secrets (
        account TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  }

  put(account: string, value: string): boolean {
    this.database.prepare(`
      INSERT INTO operator_recovery_test_secrets (account, value)
      VALUES (?, ?)
      ON CONFLICT(account) DO UPDATE SET value = excluded.value
    `).run(account, value);
    return true;
  }

  get(account: string): string | null {
    const row = this.database.prepare(`
      SELECT value FROM operator_recovery_test_secrets WHERE account = ?
    `).get(account) as { value: string } | undefined;
    return row?.value ?? null;
  }

  del(account: string): boolean {
    return this.database.prepare(`
      DELETE FROM operator_recovery_test_secrets WHERE account = ?
    `).run(account).changes > 0;
  }
}

class RetryableSecretStore implements SecretStore {
  readonly values = new Map<string, string>();
  allowDelete = false;
  throwOnGet = false;

  put(account: string, value: string): boolean {
    this.values.set(account, value);
    return true;
  }

  get(account: string): string | null {
    if (this.throwOnGet) throw new Error('simulated external secret-store read outage');
    return this.values.get(account) ?? null;
  }

  del(account: string): boolean {
    if (!this.allowDelete) return false;
    return this.values.delete(account);
  }
}

describe('provenance-bound operator recovery', () => {
  let db: ReturnType<typeof createTestDb>;
  let actorSouls: ReturnType<typeof createActorSouls>;
  let sessions: ReturnType<typeof createSessions>;
  let clock: number;
  let verifier: OperatorPresenceSignatureVerifier;
  let verifiedBytes: string[];
  let installedContexts: Array<Record<string, unknown>>;
  let helperTimeline: string[];
  let secrets: SecretStore;

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
    db = createTestDb();
    actorSouls = createActorSouls(db, { now: () => clock });
    sessions = createSessions(db);
    clock = 1_900_000_000_000;
    verifiedBytes = [];
    installedContexts = [];
    helperTimeline = [];
    secrets = new InMemorySecretStore();
    verifier = {
      verify(input) {
        verifiedBytes.push(Buffer.from(input.canonicalPayload).toString('utf8'));
        return { ok: true };
      },
    };
  });

  afterEach(() => {
    __setContextSlotLockKernelForTests(null);
    db.close();
  });

  function predecessor(filePaths = ['lib/a.ts', 'lib/b.ts']) {
    const actor = actorSouls.mint({ alias: INTENDED_AGENT_ID });
    const started = sessions.start('Continue durable work after restart', {
      agentId: INTENDED_AGENT_ID,
      project: PROJECT,
      worktreeId: 'worktree-test-id',
      durable: true,
      metadata: {
        identity: { verified: true, actorId: actor.actorId, verifiedAt: clock - 1_000 },
        worktree: { id: 'worktree-test-id', root: WORKTREE, branch: BRANCH, isMain: false },
      },
    });
    expect(started.success).toBe(true);
    if (filePaths.length > 0) {
      expect(sessions.claimFiles(started.id as string, filePaths, { agentId: INTENDED_AGENT_ID }).success)
        .toBe(true);
    }
    const detail = sessions.get(started.id as string) as Record<string, any>;
    const claims = detail.files
      .filter((file: Record<string, unknown>) => file.releasedAt === null)
      .map((file: Record<string, unknown>, index: number) => ({
        nodeId: String(file.nodeId),
        disposition: index === 0 ? 'transfer' as const : 'release' as const,
      }));
    return { actor, sessionId: started.id as string, claims };
  }

  async function helper(options: RunOperatorEnrollmentHelperOptions) {
    helperTimeline.push('helper-started');
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
      pid: 41001,
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
    helperTimeline.push('pin-committed-before-ack');
    const activationCommandDigest = `sha256:${'5'.repeat(64)}`;
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
      activationCommandDigest,
      keyState: 'active' as const,
    };
    await options.commitVerifiedActivation({
      receipt: activationReceipt,
      receiptDigest: `sha256:${'6'.repeat(64)}`,
      processTrust,
    });
    helperTimeline.push('activation-committed-after-receipt');
    return {
      response,
      responseDigest: `sha256:${'4'.repeat(64)}`,
      activationReceipt,
      activationReceiptDigest: `sha256:${'6'.repeat(64)}`,
      enrollmentProcessTrust: processTrust,
      activationProcessTrust: processTrust,
    };
  }

  function service(options: {
    signatureVerifier?: OperatorPresenceSignatureVerifier | null;
    verifyGrant?: NonNullable<Parameters<typeof createOperatorRecovery>[0]['verifyGrant']>;
    runEnrollmentHelper?: typeof helper | null;
    installContext?: ((input: Record<string, unknown>) => RecoveredContextCustodyReceipt) | null;
    secretStore?: SecretStore;
    daemonGeneration?: string;
  } = {}) {
    return createOperatorRecovery({
      db,
      actorSouls,
      sessions,
      daemonGeneration: options.daemonGeneration ?? GENERATION,
      signatureVerifier: options.signatureVerifier === undefined ? verifier : options.signatureVerifier,
      verifyGrant: options.verifyGrant,
      runEnrollmentHelper: options.runEnrollmentHelper === undefined ? helper : options.runEnrollmentHelper,
      fleetBarExecutablePath: '/Applications/FleetBar.app/Contents/MacOS/FleetBar',
      secrets: options.secretStore ?? secrets,
      now: () => clock,
      resolveGitBranch: () => BRANCH,
      installRecoveredContext: options.installContext === null
        ? undefined
        : (input) => (options.installContext ?? ((entry) => {
          installedContexts.push(entry);
          return {
            contextSlot: String(entry.contextSlot),
            contextPath: join(String(entry.canonicalWorktree), '.portdaddy', 'contexts', `${String(entry.contextSlot)}.json`),
            mode: 0o600 as const,
            contentDigest: String(entry.expectedContextDigest),
          };
        }))(input),
    });
  }

  async function challenge(api: ReturnType<typeof createOperatorRecovery>, fixture = predecessor()) {
    const created = await api.createChallenge({
      harbor: HARBOR,
      intendedAgentId: INTENDED_AGENT_ID,
      project: PROJECT,
      worktree: WORKTREE,
      branch: BRANCH,
      predecessorSessionId: fixture.sessionId,
      sessionIntent: 'Resume the exact durable task',
      actorId: fixture.actor.actorId,
      contextSlot: CONTEXT_SLOT,
      claims: fixture.claims,
      expiresAt: clock + 60_000,
    });
    return { fixture, created };
  }

  function approvalInput(created: any) {
    return {
      recoveryId: created.recoveryId,
      decision: 'approve' as const,
      deviceKeyId: DEVICE_KEY_ID,
      publicKeyX963Base64: PUBLIC_KEY_BASE64,
      signatureDerBase64: Buffer.from([0x30, 0x00]).toString('base64'),
      challengeDigest: created.signing.approve.challengeDigest,
    };
  }

  async function approve(api: ReturnType<typeof createOperatorRecovery>, created: any) {
    return api.decide(approvalInput(created));
  }

  it('records bounded intent before atomically pinning the helper enrollment', async () => {
    const api = service();
    const { created } = await challenge(api);
    expect(helperTimeline).toEqual([
      'helper-started',
      'pin-committed-before-ack',
      'activation-committed-after-receipt',
    ]);
    expect(created.events.map((event) => event.kind)).toEqual([
      'challenge-created',
      'enrollment-pinned',
      'enrollment-activated',
    ]);
    expect(created.events[0]).not.toHaveProperty('deviceKeyId');
    expect(created.events[0]).not.toHaveProperty('enrollmentEventId');
    expect(created.events[1]).toMatchObject({
      schema: OPERATOR_RECOVERY_EVENT_SCHEMA,
      deviceKeyId: DEVICE_KEY_ID,
      enrollmentEventId: expect.any(String),
      enrollmentActivationEventId: expect.any(String),
    });
    expect(created.signing.approve.challengeBytesBase64).toBeTruthy();
    expect(created.scope).toMatchObject({
      harbor: HARBOR,
      intendedAgentId: INTENDED_AGENT_ID,
      contextSlot: CONTEXT_SLOT,
      deviceKeyId: DEVICE_KEY_ID,
    });
    expect(created).not.toHaveProperty('grant');
  });

  it('rejects an oversized consent envelope before ledger, projection, secret, or helper mutation', async () => {
    const oversizedPath = `lib/${'x'.repeat(MAX_OPERATOR_RECOVERY_SIGNING_PAYLOAD_BYTES)}.ts`;
    const fixture = predecessor([oversizedPath]);
    const secretWrites: string[] = [];
    const api = service({
      secretStore: {
        put(account) { secretWrites.push(account); return true; },
        get: () => null,
        del: () => false,
      },
    });

    await expect(challenge(api, fixture)).rejects.toMatchObject({
      code: 'OPERATOR_RECOVERY_SIGNING_PAYLOAD_TOO_LARGE',
      httpStatus: 413,
    });

    expect(helperTimeline).toEqual([]);
    expect(secretWrites).toEqual([]);
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM harbor_events
      WHERE stream_type = 'operator-recovery-event'
    `).get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM operator_recovery_projection').get())
      .toEqual({ count: 0 });
  });

  it('accepts exactly 65,536 signing bytes and rejects 65,537 for every decision arm', () => {
    const api = service();
    const common: any = {
      recoveryId: `recovery-${'1'.repeat(24)}`,
      actionHash: `sha256:${'2'.repeat(64)}`,
      harbor: HARBOR,
      intendedAgentId: INTENDED_AGENT_ID,
      project: PROJECT,
      worktree: WORKTREE,
      branch: BRANCH,
      predecessorSessionId: 'session-predecessor',
      sessionIntent: '',
      actorId: '01M1366E7N8VWB417S3C45HEZP',
      daemonGeneration: GENERATION,
      nonce: 'fixed-recovery-nonce',
      expiresAt: 1_900_000_060_000,
      bodyExpiresAt: 1_900_604_800_000,
      jtiDigest: `sha256:${'3'.repeat(64)}`,
      contextSlot: CONTEXT_SLOT,
      priorContextDigest: null,
      claims: [],
      deviceKeyId: DEVICE_KEY_ID,
      enrollmentEventId: `operator-recovery:recovery-${'1'.repeat(24)}:enrollment-pinned:${'4'.repeat(16)}`,
      enrollmentActivationEventId: `operator-recovery:recovery-${'1'.repeat(24)}:enrollment-activated:${'5'.repeat(16)}`,
    };

    for (const decision of ['approve', 'deny', 'revoke'] as const) {
      const base = api.signingPayloadForTests(common, decision);
      const padding = MAX_OPERATOR_RECOVERY_SIGNING_PAYLOAD_BYTES - base.bytes.byteLength;
      expect(padding).toBeGreaterThan(0);
      const exact = api.signingPayloadForTests(
        { ...common, sessionIntent: 'x'.repeat(padding) },
        decision,
      );
      expect(exact.bytes.byteLength).toBe(MAX_OPERATOR_RECOVERY_SIGNING_PAYLOAD_BYTES);
      expect(() => api.signingPayloadForTests(
        { ...common, sessionIntent: 'x'.repeat(padding + 1) },
        decision,
      )).toThrow(expect.objectContaining({
        code: 'OPERATOR_RECOVERY_SIGNING_PAYLOAD_TOO_LARGE',
        httpStatus: 413,
      }));
    }
  });

  it('journals the challenge before external root custody and terminates a failed store', async () => {
    const timeline: string[] = [];
    const failingStore: SecretStore = {
      put(account) {
        if (account.endsWith('/root')) {
          const row = db.prepare(`
            SELECT COUNT(*) AS n FROM harbor_events
            WHERE stream_type = 'operator-recovery-event'
              AND json_extract(payload_json, '$.kind') = 'challenge-created'
          `).get() as { n: number };
          timeline.push(`challenge-count:${row.n}`);
        }
        return false;
      },
      get: () => null,
      del: () => false,
    };
    const api = service({ secretStore: failingStore });
    await expect(challenge(api)).rejects.toMatchObject({
      code: 'OPERATOR_RECOVERY_SECRET_STORE_UNAVAILABLE',
    });
    expect(timeline).toEqual(['challenge-count:1']);
    const listed = api.list() as any;
    expect(listed.recoveries).toHaveLength(1);
    expect(listed.recoveries[0]).toMatchObject({ status: 'expired', signing: null });
    expect(listed.recoveries[0].events.map((event: any) => event.kind))
      .toEqual(expect.arrayContaining(['challenge-created', 'expired']));
  });

  it('publishes the recovered body only to its canonical owner-only slot', () => {
    mkdirSync(join(process.cwd(), '.scratch'), { recursive: true });
    const scratch = mkdtempSync(join(process.cwd(), '.scratch', 'operator-recovery-custody-'));
    try {
      const canonicalScratch = realpathSync.native(scratch);
      const material = {
        recoveryId: 'recovery-context-custody',
        daemonGeneration: GENERATION,
        custodyDaemonGeneration: GENERATION,
        canonicalWorktree: canonicalScratch,
        contextSlot: CONTEXT_SLOT,
        intendedAgentId: INTENDED_AGENT_ID,
        successorSessionId: 'session-recovered-custody',
        sessionIntent: 'Resume exact work',
        project: PROJECT,
        actorId: 'actor-custody',
        credential: 'pdab1.actor-custody.body-custody.secret-custody',
        issuedAt: clock,
        expiresAt: clock + 60_000,
      };
      const receipt = installOperatorRecoveryContext({
        ...material,
        expectedContextDigest: operatorRecoveryContextDigest(material),
        expectedPriorContextDigest: null,
      });
      expect(receipt).toEqual({
        contextSlot: CONTEXT_SLOT,
        contextPath: join(canonicalScratch, '.portdaddy', 'contexts', `${CONTEXT_SLOT}.json`),
        mode: 0o600,
        contentDigest: operatorRecoveryContextDigest(material),
      });
      expect(statSync(receipt.contextPath).mode & 0o777).toBe(0o600);
      expect(existsSync(join(canonicalScratch, '.portdaddy', 'current.json'))).toBe(false);
      expect(JSON.parse(readFileSync(receipt.contextPath, 'utf8'))).toEqual({
        agentId: INTENDED_AGENT_ID,
        sessionId: 'session-recovered-custody',
        purpose: 'Resume exact work',
        identity: PROJECT,
        startedAt: clock,
        contextSlot: CONTEXT_SLOT,
        recoveryId: 'recovery-context-custody',
        credentialExpiresAt: clock + 60_000,
        credential: 'pdab1.actor-custody.body-custody.secret-custody',
      });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('refuses a changed slot occupant and recognizes an already-published crash readback', () => {
    mkdirSync(join(process.cwd(), '.scratch'), { recursive: true });
    const scratch = mkdtempSync(join(process.cwd(), '.scratch', 'operator-recovery-slot-'));
    try {
      const canonicalScratch = realpathSync.native(scratch);
      const material = {
        recoveryId: 'recovery-context-slot',
        daemonGeneration: GENERATION,
        custodyDaemonGeneration: GENERATION,
        canonicalWorktree: canonicalScratch,
        contextSlot: CONTEXT_SLOT,
        intendedAgentId: INTENDED_AGENT_ID,
        successorSessionId: 'session-slot-bound',
        sessionIntent: 'Resume exact slot',
        project: PROJECT,
        actorId: '01ACTORSLOTBOUND0000000000',
        credential: 'pdab1.actor-slot.body-slot.secret-slot',
        issuedAt: clock,
        expiresAt: clock + 60_000,
      };
      const contextDir = join(canonicalScratch, '.portdaddy', 'contexts');
      mkdirSync(contextDir, { recursive: true });
      const contextPath = join(contextDir, `${CONTEXT_SLOT}.json`);
      const prior = Buffer.from('{"sessionId":"predecessor"}', 'utf8');
      writeFileSync(contextPath, prior, { mode: 0o600 });
      const priorDigest = `sha256:${createHash('sha256').update(prior).digest('hex')}`;
      writeFileSync(contextPath, '{"sessionId":"intruder"}', { mode: 0o600 });
      expect(() => installOperatorRecoveryContext({
        ...material,
        expectedContextDigest: operatorRecoveryContextDigest(material),
        expectedPriorContextDigest: priorDigest,
      })).toThrow(expect.objectContaining({ code: 'OPERATOR_RECOVERY_CONTEXT_OCCUPANT_DRIFTED' }));

      rmSync(contextPath, { force: true });
      const installed = installOperatorRecoveryContext({
        ...material,
        expectedContextDigest: operatorRecoveryContextDigest(material),
        expectedPriorContextDigest: null,
      });
      const replayReadback = installOperatorRecoveryContext({
        ...material,
        expectedContextDigest: operatorRecoveryContextDigest(material),
        expectedPriorContextDigest: null,
      });
      expect(replayReadback).toEqual(installed);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('holds the persistent exact-slot kernel lease across publication', () => {
    mkdirSync(join(process.cwd(), '.scratch'), { recursive: true });
    const scratch = mkdtempSync(join(process.cwd(), '.scratch', 'operator-recovery-slot-lock-'));
    try {
      const canonicalScratch = realpathSync.native(scratch);
      const material = {
        recoveryId: 'recovery-context-slot-lock',
        daemonGeneration: GENERATION,
        custodyDaemonGeneration: GENERATION,
        canonicalWorktree: canonicalScratch,
        contextSlot: CONTEXT_SLOT,
        intendedAgentId: INTENDED_AGENT_ID,
        successorSessionId: 'session-slot-lock-bound',
        sessionIntent: 'Resume under the exact slot lock',
        project: PROJECT,
        actorId: '01ACTORSLOTLOCK00000000000',
        credential: 'pdab1.actor-slot.body-slot-lock.secret-slot-lock',
        issuedAt: clock,
        expiresAt: clock + 60_000,
      };
      const contextDir = join(canonicalScratch, '.portdaddy', 'contexts');
      mkdirSync(contextDir, { recursive: true });
      const contextPath = join(contextDir, `${CONTEXT_SLOT}.json`);
      const lockPath = join(contextDir, `.${CONTEXT_SLOT}.operator-recovery.lock`);
      const heldLease = acquireContextSlotLock(lockPath, {
        recoveryId: 'recovery-already-writing-this-slot',
      });
      try {
        expect(() => installOperatorRecoveryContext({
          ...material,
          expectedContextDigest: operatorRecoveryContextDigest(material),
          expectedPriorContextDigest: null,
        })).toThrow(expect.objectContaining({ code: 'OPERATOR_RECOVERY_CONTEXT_SLOT_BUSY' }));
        expect(existsSync(contextPath)).toBe(false);
      } finally {
        heldLease.release();
      }

      const orphanPath = join(
        contextDir,
        `.${CONTEXT_SLOT}.operator-recovery.${createHash('sha256').update('orphan-recovery').digest('hex')}.2147483647.${'a'.repeat(32)}.tmp`,
      );
      writeFileSync(orphanPath, 'credential-that-must-be-retired', { mode: 0o600 });
      const installed = installOperatorRecoveryContext({
        ...material,
        expectedContextDigest: operatorRecoveryContextDigest(material),
        expectedPriorContextDigest: null,
      });
      expect(installed.contentDigest).toBe(operatorRecoveryContextDigest(material));
      expect(existsSync(lockPath)).toBe(true);
      expect(JSON.parse(readFileSync(lockPath, 'utf8'))).toMatchObject({
        recoveryId: material.recoveryId,
        lease: 'pd-anchor-flock-v1',
      });
      expect(existsSync(orphanPath)).toBe(false);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('restarts the daemon services, recovers the same actor, then performs normal work', async () => {
    const fixture = predecessor(['lib/restart-owned.ts']);
    const restartedSouls = createActorSouls(db, { now: () => clock });
    const restartedSessions = createSessions(db);
    let installed: Record<string, unknown> | null = null;
    const restarted = createOperatorRecovery({
      db,
      actorSouls: restartedSouls,
      sessions: restartedSessions,
      daemonGeneration: 'daemon-generation-after-restart',
      signatureVerifier: verifier,
      runEnrollmentHelper: helper,
      fleetBarExecutablePath: '/Applications/FleetBar.app/Contents/MacOS/FleetBar',
      secrets,
      now: () => clock,
      resolveGitBranch: () => BRANCH,
      installRecoveredContext: (input) => {
        installed = input;
        return {
          contextSlot: input.contextSlot,
          contextPath: join(input.canonicalWorktree, '.portdaddy', 'contexts', `${input.contextSlot}.json`),
          mode: 0o600,
          contentDigest: input.expectedContextDigest,
        };
      },
    });
    const created = await restarted.createChallenge({
      harbor: HARBOR,
      intendedAgentId: INTENDED_AGENT_ID,
      project: PROJECT,
      worktree: WORKTREE,
      branch: BRANCH,
      predecessorSessionId: fixture.sessionId,
      sessionIntent: 'Resume after a real daemon restart',
      actorId: fixture.actor.actorId,
      contextSlot: CONTEXT_SLOT,
      claims: fixture.claims,
      expiresAt: clock + 60_000,
    }) as any;
    const approved = await approve(restarted, created);
    const consumed = restarted.consume(created.recoveryId, approved.grant!) as any;
    const credential = String((installed as Record<string, unknown>).credential);
    const resource = {
      sessionId: consumed.successorSessionId,
      intendedAgentId: INTENDED_AGENT_ID,
      project: PROJECT,
      canonicalWorktree: WORKTREE,
      branch: BRANCH,
      status: 'active' as const,
    };
    for (const action of ['session.note.write', 'session.plan.write', 'session.claim.add'] as const) {
      expect(restartedSouls.verifyCredentialUse(credential, {
        harbor: HARBOR,
        context: { action, resource },
      })).toMatchObject({ ok: true, actorId: fixture.actor.actorId, profile: 'session-body-v1' });
    }
    expect(restartedSessions.addNote(consumed.successorSessionId, 'Restart recovery note'))
      .toMatchObject({ success: true });
    expect(restartedSessions.addNote(consumed.successorSessionId, '- [ ] Restart recovery plan', {
      type: 'todo_list',
    })).toMatchObject({ success: true });
    expect(restartedSessions.claimFiles(consumed.successorSessionId, ['lib/restart-new.ts'], {
      agentId: INTENDED_AGENT_ID,
    })).toMatchObject({ success: true, claimed: ['lib/restart-new.ts'] });
    expect(db.prepare('SELECT COUNT(*) AS n FROM actor_souls').get()).toEqual({ n: 1 });
  });

  it('deduplicates a concurrent identical first-use request before enrollment', async () => {
    let releaseHelper!: () => void;
    let helperEntered!: () => void;
    const gate = new Promise<void>((resolve) => { releaseHelper = resolve; });
    const entered = new Promise<void>((resolve) => { helperEntered = resolve; });
    let entrants = 0;
    const parallelHelper: typeof helper = async (options) => {
      entrants += 1;
      helperEntered();
      await gate;
      return helper(options);
    };
    const api = service({ runEnrollmentHelper: parallelHelper });
    const fixture = predecessor();
    const firstPromise = challenge(api, fixture);
    await entered;
    const retry = await challenge(api, fixture);
    expect(entrants).toBe(1);
    expect(retry.created).toMatchObject({
      status: 'pending',
      signing: null,
    });
    releaseHelper();
    const first = await firstPromise;
    expect(retry.created.recoveryId).toBe(first.created.recoveryId);
    expect(api.get(first.created.recoveryId)).toMatchObject({
      status: 'pending',
      signing: expect.any(Object),
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM operator_recovery_enrollments').get())
      .toEqual({ n: 1 });
    await expect(approve(api, first.created)).resolves.toMatchObject({ status: 'approved' });
  });

  it('terminally expires failed first use and lets an exact retry enroll safely', async () => {
    const api = service({ runEnrollmentHelper: null });
    const fixture = predecessor();
    await expect(challenge(api, fixture)).rejects.toMatchObject({
      code: 'OPERATOR_RECOVERY_ENROLLMENT_HELPER_UNAVAILABLE',
    });
    const listed = api.list() as any;
    expect(listed.recoveries).toHaveLength(1);
    expect(listed.recoveries[0]).toMatchObject({ status: 'expired', signing: null });
    expect(listed.recoveries[0].events.find((event: any) => event.kind === 'expired')).toMatchObject({
      kind: 'expired',
      code: 'OPERATOR_RECOVERY_ENROLLMENT_HELPER_UNAVAILABLE',
    });
    expect(listed.recoveries[0].events.map((event: any) => event.kind)).toEqual([
      'challenge-created',
      'expired',
      'drift-refused',
      'drift-refused',
    ]);
    const recoveryId = listed.recoveries[0].recoveryId;
    expect(secrets.get(`macaroon/operator-recovery/${recoveryId}/root`)).toBeNull();

    const restarted = service();
    const retried = await challenge(restarted, fixture);
    expect(retried.created.recoveryId).not.toBe(recoveryId);
    expect(retried.created).toMatchObject({
      status: 'pending',
      signing: expect.any(Object),
    });
  });

  it('fails decisions closed when pd-anchor verification is unavailable', async () => {
    const api = service({ signatureVerifier: null });
    const { created } = await challenge(api);
    await expect(approve(api, created)).rejects.toMatchObject({
      code: 'OPERATOR_RECOVERY_SIGNATURE_VERIFIER_UNAVAILABLE',
    });
    expect(api.get(created.recoveryId).status).toBe('pending');
  });

  it('signs daemon canonical bytes and records only signature/key digests', async () => {
    const api = service();
    const { created } = await challenge(api);
    const approved = await approve(api, created);
    const supplied = Buffer.from(created.signing.approve.challengeBytesBase64, 'base64').toString('utf8');
    expect(verifiedBytes).toEqual([supplied]);
    const payloads = db.prepare(`
      SELECT payload_json FROM harbor_events WHERE stream_type = 'operator-recovery-event'
    `).all() as Array<{ payload_json: string }>;
    const serialized = payloads.map((row) => row.payload_json).join('\n');
    expect(serialized).not.toContain('signatureDerBase64');
    expect(serialized).not.toContain('macaroonIdentifier');
    expect(serialized).not.toContain(approved.grant!.identifier);
    expect(serialized).not.toContain(approved.grant!.signature);
    expect(payloads.some((row) => JSON.parse(row.payload_json).signatureDigest)).toBe(true);
    expect(payloads.some((row) => JSON.parse(row.payload_json).signedRequestDigest)).toBe(true);
  });

  it('digests native verifier diagnostics instead of echoing identifier material', async () => {
    const rawIdentifier = 'operator-recovery-jti-that-must-never-cross-http-or-ledger';
    const api = service({
      signatureVerifier: {
        verify() {
          return {
            ok: false,
            code: 'ANCHOR_SIGNATURE_MISMATCH',
            reason: `signature mismatch on "${rawIdentifier}"`,
          };
        },
      },
    });
    const { created } = await challenge(api);
    let refusal: unknown;
    try {
      await approve(api, created);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({
      code: 'OPERATOR_RECOVERY_SIGNATURE_INVALID',
      message: 'native operator-presence signature verification refused the decision',
    });
    expect(JSON.stringify(api.get(created.recoveryId))).not.toContain(rawIdentifier);
    expect((api.get(created.recoveryId) as any).events.at(-1)).toMatchObject({
      kind: 'drift-refused',
      code: 'OPERATOR_RECOVERY_SIGNATURE_INVALID',
      reason: expect.stringMatching(/^native signature verification refused; diagnosticDigest=sha256:/),
    });
  });

  it('wraps thrown native verifier diagnostics without exposing them', async () => {
    const rawDiagnostic = 'raw-native-signature-and-device-key-material';
    const api = service({
      signatureVerifier: {
        verify() {
          throw new Error(rawDiagnostic);
        },
      },
    });
    const { created } = await challenge(api);
    await expect(approve(api, created)).rejects.toMatchObject({
      code: 'OPERATOR_RECOVERY_SIGNATURE_INVALID',
      message: 'native operator-presence signature verification failed closed',
    });
    const readback = JSON.stringify(api.get(created.recoveryId));
    expect(readback).not.toContain(rawDiagnostic);
    expect((api.get(created.recoveryId) as any).events.at(-1)).toMatchObject({
      kind: 'drift-refused',
      code: 'OPERATOR_RECOVERY_SIGNATURE_INVALID',
      reason: expect.stringMatching(/^native signature verifier failed closed; diagnosticDigest=sha256:/),
    });
  });

  it('wraps thrown grant verifier diagnostics without exposing JTI material', async () => {
    const rawDiagnostic = 'raw-jti-and-macaroon-identifier-material';
    const api = service({
      verifyGrant() {
        throw new Error(rawDiagnostic);
      },
    });
    const { created } = await challenge(api);
    const approved = await approve(api, created);
    expect(() => api.consume(created.recoveryId, approved.grant!)).toThrow(
      expect.objectContaining({
        code: 'OPERATOR_RECOVERY_GRANT_INVALID',
        message: 'recovery grant verification failed closed',
      }),
    );
    const readback = JSON.stringify(api.get(created.recoveryId));
    expect(readback).not.toContain(rawDiagnostic);
    expect((api.get(created.recoveryId) as any).events.at(-1)).toMatchObject({
      kind: 'drift-refused',
      code: 'OPERATOR_RECOVERY_GRANT_INVALID',
      reason: expect.stringMatching(/^recovery consume refused; diagnosticDigest=sha256:/),
    });
  });

  it('allows signed deny and revoke after the grant root has already disappeared', async () => {
    const denySecrets = new RetryableSecretStore();
    const denyApi = service({ secretStore: denySecrets });
    const deniedChallenge = await challenge(denyApi);
    denySecrets.values.clear();
    const denyInput = {
      recoveryId: deniedChallenge.created.recoveryId,
      decision: 'deny' as const,
      deviceKeyId: DEVICE_KEY_ID,
      publicKeyX963Base64: PUBLIC_KEY_BASE64,
      signatureDerBase64: Buffer.from([0x30, 0x00]).toString('base64'),
      challengeDigest: deniedChallenge.created.signing.deny.challengeDigest,
    };
    const denied = await Promise.all([denyApi.decide(denyInput), denyApi.decide(denyInput)]);
    expect(denied).toEqual([
      expect.objectContaining({ status: 'denied' }),
      expect.objectContaining({ status: 'denied' }),
    ]);
    db.prepare('DELETE FROM operator_recovery_enrollments').run();
    await expect(denyApi.decide(denyInput)).resolves.toMatchObject({ status: 'denied' });
    for (const conflicting of [
      { signatureDerBase64: Buffer.from([0x30, 0x01]).toString('base64') },
      { deviceKeyId: `se-p256:${'9'.repeat(64)}` },
      { publicKeyX963Base64: Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 0x32)]).toString('base64') },
      { challengeDigest: `sha256:${'8'.repeat(64)}` },
    ]) {
      await expect(denyApi.decide({ ...denyInput, ...conflicting }))
        .rejects.toMatchObject({ code: 'OPERATOR_RECOVERY_DECISION_REPLAYED' });
    }
    expect((denyApi.get(denyInput.recoveryId) as any).events
      .filter((event: any) => event.kind === 'denied')).toHaveLength(1);

    const revokeSecrets = new RetryableSecretStore();
    const revokeApi = service({ secretStore: revokeSecrets });
    const revocationChallenge = await challenge(revokeApi);
    const approved = await approve(revokeApi, revocationChallenge.created);
    revokeSecrets.values.clear();
    const revokeInput = {
      recoveryId: revocationChallenge.created.recoveryId,
      decision: 'revoke' as const,
      deviceKeyId: DEVICE_KEY_ID,
      publicKeyX963Base64: PUBLIC_KEY_BASE64,
      signatureDerBase64: Buffer.from([0x30, 0x00]).toString('base64'),
      challengeDigest: approved.signing.revoke.challengeDigest,
    };
    const revoked = await Promise.all([
      revokeApi.decide(revokeInput),
      revokeApi.decide(revokeInput),
    ]);
    expect(revoked).toEqual([
      expect.objectContaining({ status: 'revoked' }),
      expect.objectContaining({ status: 'revoked' }),
    ]);
    expect((revokeApi.get(revokeInput.recoveryId) as any).events
      .filter((event: any) => event.kind === 'grant-revoked')).toHaveLength(1);
  });

  it('atomically binds the display owner and installs one scoped body into the exact slot', async () => {
    const api = service();
    const { fixture, created } = await challenge(api);
    const approved = await approve(api, created);
    const consumed = api.consume(created.recoveryId, approved.grant!) as any;
    expect(consumed.status).toBe('consumed');
    expect(consumed.bodyCredential).not.toHaveProperty('credential');
    expect(consumed.bodyCredential).toMatchObject({
      actorId: fixture.actor.actorId,
      intendedAgentId: INTENDED_AGENT_ID,
      scopeProfile: 'session-body-v1',
      scope: {
        harbor: HARBOR,
        sessionId: consumed.successorSessionId,
        project: PROJECT,
        canonicalWorktree: WORKTREE,
        branch: BRANCH,
      },
    });
    expect(installedContexts).toEqual([expect.objectContaining({
      canonicalWorktree: WORKTREE,
      contextSlot: CONTEXT_SLOT,
      intendedAgentId: INTENDED_AGENT_ID,
      successorSessionId: consumed.successorSessionId,
      actorId: fixture.actor.actorId,
      credential: expect.stringMatching(/^pdab1\./),
    })]);
    const successor = sessions.get(consumed.successorSessionId) as Record<string, any>;
    expect(successor.session.agentId).toBe(INTENDED_AGENT_ID);
    expect(successor.session.metadata.identity).toMatchObject({
      verified: true,
      actorId: fixture.actor.actorId,
      recoveredBy: 'operator-presence',
    });
    expect(successor.files.filter((file: Record<string, unknown>) => file.releasedAt === null))
      .toHaveLength(1);
    expect((sessions.get(fixture.sessionId) as Record<string, any>).session.status).toBe('abandoned');

    const credential = String(installedContexts[0].credential);
    const contextFor = (action: 'session.note.write' | 'session.plan.write' | 'session.claim.add') => ({
      harbor: HARBOR,
      context: {
        action,
        resource: {
          sessionId: consumed.successorSessionId,
          intendedAgentId: INTENDED_AGENT_ID,
          project: PROJECT,
          canonicalWorktree: WORKTREE,
          branch: BRANCH,
          status: 'active' as const,
        },
      },
    });
    expect(actorSouls.verifyCredentialUse(credential, contextFor('session.note.write')))
      .toMatchObject({ ok: true, actorId: fixture.actor.actorId, profile: 'session-body-v1' });
    expect(sessions.addNote(consumed.successorSessionId, 'Recovery continuity is live'))
      .toMatchObject({ success: true });
    expect(actorSouls.verifyCredentialUse(credential, contextFor('session.plan.write')))
      .toMatchObject({ ok: true, actorId: fixture.actor.actorId, profile: 'session-body-v1' });
    expect(sessions.addNote(consumed.successorSessionId, '- [ ] Continue exact work', {
      type: 'todo_list',
    })).toMatchObject({ success: true });
    expect(actorSouls.verifyCredentialUse(credential, contextFor('session.claim.add')))
      .toMatchObject({ ok: true, actorId: fixture.actor.actorId, profile: 'session-body-v1' });
    expect(sessions.claimFiles(consumed.successorSessionId, ['lib/recovery-proof.ts'], {
      agentId: INTENDED_AGENT_ID,
    })).toMatchObject({ success: true, claimed: ['lib/recovery-proof.ts'] });
  });

  it('does not expire the recovered body with a nearly-spent approval challenge', async () => {
    const api = service();
    const { fixture, created } = await challenge(api);
    const approved = await approve(api, created);
    clock = created.scope.expiresAt - 1;
    const consumed = api.consume(created.recoveryId, approved.grant!) as any;
    const credential = String(installedContexts[0].credential);
    const context = {
      action: 'session.note.write' as const,
      resource: {
        sessionId: consumed.successorSessionId,
        intendedAgentId: INTENDED_AGENT_ID,
        project: PROJECT,
        canonicalWorktree: WORKTREE,
        branch: BRANCH,
        status: 'active' as const,
      },
    };
    clock = created.scope.expiresAt;
    expect(actorSouls.verifyCredentialUse(credential, { harbor: HARBOR, context }))
      .toMatchObject({ ok: true, actorId: fixture.actor.actorId });
    expect(consumed.bodyCredential.expiresAt).toBe(created.scope.bodyExpiresAt);
    clock = created.scope.bodyExpiresAt;
    expect(actorSouls.verifyCredentialUse(credential, { harbor: HARBOR, context }))
      .toMatchObject({ ok: false, code: 'CREDENTIAL_EXPIRED' });
  });

  it('terminalizes a decision whose verification crosses the challenge expiry', async () => {
    let expiresDuringVerification = Number.MAX_SAFE_INTEGER;
    const api = service({
      signatureVerifier: {
        verify() {
          clock = expiresDuringVerification;
          return { ok: true };
        },
      },
    });
    const { created } = await challenge(api);
    expiresDuringVerification = created.scope.expiresAt;
    await expect(approve(api, created)).rejects.toMatchObject({
      code: 'OPERATOR_RECOVERY_GRANT_EXPIRED',
    });
    const expired = api.get(created.recoveryId) as any;
    expect(expired).toMatchObject({
      status: 'expired',
      receipt: { terminalAuthorityEventId: expect.any(String) },
    });
    expect(expired.events.find((event: any) => event.kind === 'expired')).toMatchObject({
      kind: 'expired',
      code: 'OPERATOR_RECOVERY_GRANT_EXPIRED',
    });
    expect(secrets.get(`macaroon/operator-recovery/${created.recoveryId}/root`)).toBeNull();
  });

  it('revokes sealed custody when a slow installer crosses the body expiry', async () => {
    const api = service({
      installContext(input) {
        clock = Number(input.expiresAt);
        return {
          contextSlot: String(input.contextSlot),
          contextPath: join(
            String(input.canonicalWorktree),
            '.portdaddy',
            'contexts',
            `${String(input.contextSlot)}.json`,
          ),
          mode: 0o600,
          contentDigest: String(input.expectedContextDigest),
        };
      },
    });
    const { created } = await challenge(api);
    const approved = await approve(api, created);
    expect(() => api.consume(created.recoveryId, approved.grant!)).toThrow(
      expect.objectContaining({ code: 'OPERATOR_RECOVERY_BODY_EXPIRED' }),
    );
    const expired = api.get(created.recoveryId) as any;
    expect(expired.status).toBe('expired');
    const bound = expired.events.find((event: any) => event.kind === 'session-bound');
    expect(db.prepare(`
      SELECT revoked_at AS revokedAt
      FROM actor_body_credentials WHERE body_credential_id = ?
    `).get(bound.bodyCredentialId)).toEqual({ revokedAt: clock });
    expect(secrets.get(`macaroon/operator-recovery/${created.recoveryId}/root`)).toBeNull();
    expect(secrets.get(`macaroon/operator-recovery/${created.recoveryId}/body-envelope`)).toBeNull();
  });

  it('commits one concurrent approval and redelivers the same grant to the identical request', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered = 0;
    const api = service({
      signatureVerifier: {
        async verify() {
          entered += 1;
          if (entered === 2) release();
          await gate;
          return { ok: true };
        },
      },
    });
    const { created } = await challenge(api);
    const decisions = await Promise.allSettled([approve(api, created), approve(api, created)]);
    expect(decisions.every((entry) => entry.status === 'fulfilled')).toBe(true);
    const fulfilled = decisions as Array<PromiseFulfilledResult<any>>;
    expect(fulfilled[0].value.grant).toEqual(fulfilled[1].value.grant);
    const consumed = api.consume(created.recoveryId, fulfilled[0].value.grant) as any;
    expect(consumed.status).toBe('consumed');
    const events = (api.get(created.recoveryId) as any).events;
    expect(events.filter((event: any) => event.kind === 'approved')).toHaveLength(1);
    expect(events.filter((event: any) => event.kind === 'grant-minted')).toHaveLength(1);
    expect(events.filter((event: any) => event.kind === 'replay-refused')).toHaveLength(0);
  });

  it('redelivers the same approved grant after a lost response without minting new authority', async () => {
    const api = service();
    const { created } = await challenge(api);
    const first = await approve(api, created);
    const redelivered = await approve(api, created);
    expect(redelivered.grant).toEqual(first.grant);
    const kinds = (api.get(created.recoveryId) as any).events.map((event: any) => event.kind);
    expect(kinds.filter((kind: string) => kind === 'approved')).toHaveLength(1);
    expect(kinds.filter((kind: string) => kind === 'grant-minted')).toHaveLength(1);
    expect((api.consume(created.recoveryId, redelivered.grant!) as any).status).toBe('consumed');
  });

  it('terminally expires unconsumed approval authority when the daemon generation changes', async () => {
    const api = service();
    const { fixture, created } = await challenge(api);
    await approve(api, created);

    const restarted = service({ daemonGeneration: 'daemon-generation-after-restart' });
    const expired = restarted.get(created.recoveryId) as any;
    expect(expired.status).toBe('expired');
    expect(expired.events.find((event: any) => event.kind === 'expired')).toMatchObject({
      kind: 'expired',
      code: 'OPERATOR_RECOVERY_GENERATION_DRIFTED',
      reason: 'daemon restart retired unconsumed authority from the prior generation',
    });
    expect((sessions.get(fixture.sessionId) as Record<string, any>).session.status).toBe('active');
    expect(secrets.get(`macaroon/operator-recovery/${created.recoveryId}/root`)).toBeNull();
    expect(expired.successorSessionId).toBeNull();
  });

  it('reconstructs the same credential-free terminal receipts after an approval response is lost', async () => {
    const api = service();
    const { created } = await challenge(api);
    const first = await api.decideAndConsume(approvalInput(created)) as any;
    const retried = await api.decideAndConsume(approvalInput(created)) as any;

    expect(first.status).toBe('consumed');
    expect(retried.status).toBe('consumed');
    expect(retried.binding).toEqual(first.binding);
    expect(retried.bodyCredential).toEqual(first.bodyCredential);
    expect(retried.custody).toEqual(first.custody);
    expect(retried.binding).toMatchObject({
      predecessorSessionId: expect.any(String),
      successorSessionId: first.successorSessionId,
      actorId: created.scope.actorId,
      intendedAgentId: INTENDED_AGENT_ID,
      transferredClaimNodeIds: expect.any(Array),
      releasedClaimNodeIds: expect.any(Array),
      boundAt: clock,
    });
    expect(retried.custody).toEqual({
      installed: true,
      contextSlot: CONTEXT_SLOT,
      canonicalWorktree: WORKTREE,
      mode: 0o600,
    });
    const refreshed = api.get(created.recoveryId) as any;
    expect(refreshed.binding).toEqual(first.binding);
    expect(refreshed.bodyCredential).toEqual(first.bodyCredential);
    expect(refreshed.custody).toEqual(first.custody);
    expect(JSON.stringify(retried)).not.toContain('pdab1.');
    expect(retried).not.toHaveProperty('grant');
  });

  it('records a replay after the authority terminal without changing that terminal receipt', async () => {
    const api = service();
    const { fixture, created } = await challenge(api);
    const approved = await approve(api, created);
    api.consume(created.recoveryId, approved.grant!);
    expect(() => api.consume(created.recoveryId, approved.grant!)).toThrow(
      expect.objectContaining({ code: 'OPERATOR_RECOVERY_GRANT_REPLAYED' }),
    );
    const state = api.get(created.recoveryId) as any;
    const rows = db.prepare(`
      SELECT ledger_seq, event_id, payload_json FROM harbor_events
      WHERE stream_type = 'operator-recovery-event'
        AND json_extract(payload_json, '$.recoveryId') = ?
      ORDER BY ledger_seq
    `).all(created.recoveryId) as Array<{ ledger_seq: number; event_id: string; payload_json: string }>;
    const installed = rows.find((row) => JSON.parse(row.payload_json).kind === 'context-custody-installed')!;
    expect(state.receipt.ledgerSequences).toEqual(rows.map((row) => row.ledger_seq));
    expect(state.receipt.ledgerSequences.every(Number.isSafeInteger)).toBe(true);
    expect(state.receipt.terminalAuthorityEventId).toBe(installed.event_id);
    expect(state.receipt.terminalEventId).not.toBe(installed.event_id);
    expect((sessions.get(fixture.sessionId) as Record<string, any>).session.status).toBe('abandoned');
  });

  it('rolls session, claims, body, and authority events back after body issuance failure', async () => {
    const baseApi = service();
    const fixture = predecessor();
    const { created } = await challenge(baseApi, fixture);
    const approved = await approve(baseApi, created);
    const realIssue = actorSouls.issueBodyCredential;
    const sabotagedSouls = new Proxy(actorSouls, {
      get(target, property, receiver) {
        if (property !== 'issueBodyCredential') return Reflect.get(target, property, receiver);
        return (...args: Parameters<typeof realIssue>) => {
          realIssue(...args);
          throw Object.assign(new Error('failure after body issuance'), { code: 'AFTER_BODY_ISSUANCE' });
        };
      },
    });
    const sabotaged = createOperatorRecovery({
      db,
      actorSouls: sabotagedSouls,
      sessions,
      daemonGeneration: GENERATION,
      signatureVerifier: verifier,
      runEnrollmentHelper: helper,
      fleetBarExecutablePath: '/Applications/FleetBar.app/Contents/MacOS/FleetBar',
      secrets,
      now: () => clock,
      resolveGitBranch: () => BRANCH,
      installRecoveredContext: (input) => {
        installedContexts.push(input);
        return {
          contextSlot: input.contextSlot,
          contextPath: join(input.canonicalWorktree, '.portdaddy', 'contexts', `${input.contextSlot}.json`),
          mode: 0o600,
          contentDigest: input.expectedContextDigest,
        };
      },
    });
    const bodyCount = (db.prepare('SELECT COUNT(*) AS n FROM actor_body_credentials').get() as { n: number }).n;
    expect(() => sabotaged.consume(created.recoveryId, approved.grant!)).toThrow(
      expect.objectContaining({ code: 'AFTER_BODY_ISSUANCE' }),
    );
    expect((db.prepare('SELECT COUNT(*) AS n FROM actor_body_credentials').get() as { n: number }).n)
      .toBe(bodyCount);
    expect((sessions.get(fixture.sessionId) as Record<string, any>).session.status).toBe('active');
    expect(sabotaged.get(created.recoveryId).events.map((event) => event.kind)).not.toContain('session-bound');
  });

  it('records and retries external envelope cleanup when a post-stage transaction rolls back', async () => {
    const retryableSecrets = new RetryableSecretStore();
    const api = service({ secretStore: retryableSecrets });
    const { created } = await challenge(api);
    const approved = await approve(api, created);
    const sabotagedSessions = new Proxy(sessions, {
      get(target, property, receiver) {
        if (property !== 'bindOperatorRecovery') return Reflect.get(target, property, receiver);
        return (input: any) => target.bindOperatorRecovery({
          ...input,
          beforeCommit(receipt: any) {
            input.beforeCommit(receipt);
            throw Object.assign(new Error('crash after external envelope staging'), {
              code: 'AFTER_ENVELOPE_STAGE',
            });
          },
        });
      },
    });
    const sabotaged = createOperatorRecovery({
      db,
      actorSouls,
      sessions: sabotagedSessions,
      daemonGeneration: GENERATION,
      signatureVerifier: verifier,
      runEnrollmentHelper: helper,
      fleetBarExecutablePath: '/Applications/FleetBar.app/Contents/MacOS/FleetBar',
      secrets: retryableSecrets,
      now: () => clock,
      resolveGitBranch: () => BRANCH,
      installRecoveredContext: (input) => ({
        contextSlot: input.contextSlot,
        contextPath: join(input.canonicalWorktree, '.portdaddy', 'contexts', `${input.contextSlot}.json`),
        mode: 0o600,
        contentDigest: input.expectedContextDigest,
      }),
    });
    expect(() => sabotaged.consume(created.recoveryId, approved.grant!)).toThrow(
      expect.objectContaining({ code: 'AFTER_ENVELOPE_STAGE' }),
    );
    expect(sabotaged.get(created.recoveryId)).toMatchObject({ status: 'approved' });
    expect(db.prepare(`
      SELECT envelope_retirement_pending AS pending
      FROM operator_recovery_projection WHERE recovery_id = ?
    `).get(created.recoveryId)).toEqual({ pending: 1 });
    expect(retryableSecrets.values.size).toBe(2);
    expect(() => api.consume(created.recoveryId, approved.grant!)).toThrow(
      expect.objectContaining({ code: 'OPERATOR_RECOVERY_ENVELOPE_RETIREMENT_PENDING' }),
    );
    expect(db.prepare(`
      SELECT COUNT(*) AS n FROM actor_body_credentials WHERE profile = 'session-body-v1'
    `).get()).toEqual({ n: 0 });

    retryableSecrets.allowDelete = true;
    const restarted = service({ secretStore: retryableSecrets });
    expect(db.prepare(`
      SELECT envelope_retirement_pending AS pending
      FROM operator_recovery_projection WHERE recovery_id = ?
    `).get(created.recoveryId)).toEqual({ pending: 0 });
    expect(retryableSecrets.values.size).toBe(1);
    const redelivered = await approve(restarted, created);
    expect((restarted.consume(created.recoveryId, redelivered.grant!) as any).status).toBe('consumed');
  });

  it('records durable cleanup truth when startup cannot read a possible orphan envelope', async () => {
    const retryableSecrets = new RetryableSecretStore();
    retryableSecrets.allowDelete = true;
    const api = service({ secretStore: retryableSecrets });
    const { created } = await challenge(api);
    await approve(api, created);
    const envelopeAccount = `macaroon/operator-recovery/${created.recoveryId}/body-envelope`;
    retryableSecrets.put(envelopeAccount, 'sealed-but-uncommitted-envelope');
    retryableSecrets.throwOnGet = true;

    service({ secretStore: retryableSecrets });
    expect(db.prepare(`
      SELECT envelope_retirement_pending AS pending
      FROM operator_recovery_projection WHERE recovery_id = ?
    `).get(created.recoveryId)).toEqual({ pending: 1 });
    expect((api.get(created.recoveryId) as any).events.at(-1)).toMatchObject({
      kind: 'drift-refused',
      code: 'OPERATOR_RECOVERY_ENVELOPE_RETIREMENT_PENDING',
      reason: expect.not.stringContaining('sealed-but-uncommitted-envelope'),
    });

    retryableSecrets.throwOnGet = false;
    service({ secretStore: retryableSecrets });
    expect(retryableSecrets.get(envelopeAccount)).toBeNull();
    expect(db.prepare(`
      SELECT envelope_retirement_pending AS pending
      FROM operator_recovery_projection WHERE recovery_id = ?
    `).get(created.recoveryId)).toEqual({ pending: 0 });
  });

  it('keeps the sealed body retryable and records no raw diagnostic when exact-slot custody fails', async () => {
    let bodyThatMustNotLeak = '';
    const api = service({
      installContext: (input) => {
        bodyThatMustNotLeak = String(input.credential);
        throw new Error(`disk full while writing ${bodyThatMustNotLeak}`);
      },
    });
    const { created } = await challenge(api);
    const approved = await approve(api, created);
    expect(() => api.consume(created.recoveryId, approved.grant!)).toThrow(
      expect.objectContaining({ code: 'OPERATOR_RECOVERY_CONTEXT_CUSTODY_FAILED' }),
    );
    const row = db.prepare(`
      SELECT revoked_at FROM actor_body_credentials WHERE profile = 'session-body-v1'
    `).get() as { revoked_at: number | null };
    expect(row.revoked_at).toBeNull();
    const state = api.get(created.recoveryId) as any;
    expect(state.events.at(-1)).toMatchObject({
      kind: 'drift-refused',
      code: 'OPERATOR_RECOVERY_CONTEXT_CUSTODY_FAILED',
    });
    expect(JSON.stringify(state)).not.toContain(bodyThatMustNotLeak);
    expect((db.prepare(`
      SELECT GROUP_CONCAT(payload_json, '\n') AS payloads
      FROM harbor_events WHERE stream_type = 'operator-recovery-event'
    `).get() as { payloads: string }).payloads).not.toContain(bodyThatMustNotLeak);
    expect(state.receipt.terminalAuthorityEventId).toBe(
      null,
    );
    expect(state.status).toBe('custody-pending');
    const restarted = service();
    expect((restarted.get(created.recoveryId) as any).status).toBe('consumed');
  });

  it('leaves a digest-only restart receipt when pending body custody is missing', async () => {
    const api = service({
      installContext: () => {
        throw new Error('first installer unavailable');
      },
    });
    const { created } = await challenge(api);
    const approved = await approve(api, created);
    expect(() => api.consume(created.recoveryId, approved.grant!)).toThrow(
      expect.objectContaining({ code: 'OPERATOR_RECOVERY_CONTEXT_CUSTODY_FAILED' }),
    );
    expect(secrets.del(`macaroon/operator-recovery/${created.recoveryId}/body-envelope`)).toBe(true);

    const restarted = service();
    const pending = restarted.get(created.recoveryId) as any;
    expect(pending.status).toBe('custody-pending');
    expect(pending.events.at(-1)).toMatchObject({
      kind: 'drift-refused',
      code: 'OPERATOR_RECOVERY_CONTEXT_CUSTODY_FAILED',
      reason: expect.stringMatching(/^exact-slot custody failed; diagnosticDigest=sha256:/),
    });
    expect(JSON.stringify(pending)).not.toContain('BODY_ENVELOPE_UNAVAILABLE');
  });

  it('persists failed grant-key retirement and completes it on daemon restart retry', async () => {
    const retryableSecrets = new RetryableSecretStore();
    const api = service({ secretStore: retryableSecrets });
    const { created } = await challenge(api);
    const approved = await approve(api, created);
    const consumed = api.consume(created.recoveryId, approved.grant!) as any;

    expect(consumed.events.at(-1)).toMatchObject({
      kind: 'drift-refused',
      code: 'OPERATOR_RECOVERY_SECRET_RETIREMENT_PENDING',
    });
    expect(db.prepare(`
      SELECT secret_retirement_pending AS rootPending,
             envelope_retirement_pending AS envelopePending
      FROM operator_recovery_projection WHERE recovery_id = ?
    `).get(created.recoveryId)).toEqual({ rootPending: 1, envelopePending: 1 });
    expect(retryableSecrets.values.size).toBe(2);

    retryableSecrets.allowDelete = true;
    service({ secretStore: retryableSecrets });
    const restarted = api.get(created.recoveryId) as any;
    expect(restarted.events.at(-1)).toMatchObject({
      kind: 'drift-refused',
      code: 'OPERATOR_RECOVERY_SECRET_RETIREMENT_COMPLETED',
    });
    expect(restarted.events.at(-1).predecessorEventIds).toEqual([
      restarted.events.at(-2).eventId,
    ]);
    expect(db.prepare(`
      SELECT secret_retirement_pending AS rootPending,
             envelope_retirement_pending AS envelopePending
      FROM operator_recovery_projection WHERE recovery_id = ?
    `).get(created.recoveryId)).toEqual({ rootPending: 0, envelopePending: 0 });
    expect(retryableSecrets.values.size).toBe(0);
  });

  it('commits terminal retirement intent before either external secret deletion starts', async () => {
    const inner = new InMemorySecretStore();
    const deletionSnapshots: Array<Record<string, unknown>> = [];
    const observedStore: SecretStore = {
      put: (account, value) => inner.put(account, value),
      get: (account) => inner.get(account),
      del(account) {
        deletionSnapshots.push({
          account,
          inTransaction: db.inTransaction,
          projection: db.prepare(`
            SELECT status,
                   secret_retirement_pending AS rootPending,
                   envelope_retirement_pending AS envelopePending,
                   terminal_authority_event_id AS terminalEventId
            FROM operator_recovery_projection
            WHERE recovery_id = ?
          `).get(account.split('/')[2]),
        });
        return inner.del(account);
      },
    };
    const api = service({ secretStore: observedStore });
    const { created } = await challenge(api);
    const approved = await approve(api, created);
    expect((api.consume(created.recoveryId, approved.grant!) as any).status).toBe('consumed');
    expect(deletionSnapshots).toHaveLength(2);
    for (const snapshot of deletionSnapshots) {
      expect(snapshot).toMatchObject({
        inTransaction: false,
        projection: {
          status: 'consumed',
          rootPending: 1,
          terminalEventId: expect.any(String),
        },
      });
    }
    expect(deletionSnapshots.find((snapshot) => String(snapshot.account).endsWith('/body-envelope')))
      .toMatchObject({ projection: { envelopePending: 1 } });
  });

  it('rebuilds disposable gates and enrollment pins from the append-only ledger', async () => {
    const api = service();
    const { created } = await challenge(api);
    const approved = await approve(api, created);

    db.exec(`
      DROP TABLE operator_recovery_projection;
      DROP TABLE operator_recovery_enrollments;
    `);

    const restarted = service();
    expect(restarted.get(created.recoveryId)).toMatchObject({
      status: 'approved',
      scope: {
        deviceKeyId: DEVICE_KEY_ID,
        enrollmentEventId: expect.any(String),
      },
      signing: { revoke: { challengeDigest: expect.any(String) } },
    });
    expect((restarted.consume(created.recoveryId, approved.grant!) as any).status).toBe('consumed');
  });

  it('records expiry and structural drift without mutating session authority', async () => {
    const api = service();
    const fixture = predecessor();
    const { created } = await challenge(api, fixture);
    expect(sessions.claimFiles(fixture.sessionId, ['lib/late.ts'], { agentId: INTENDED_AGENT_ID }).success)
      .toBe(true);
    await expect(approve(api, created)).rejects.toMatchObject({ code: 'OPERATOR_RECOVERY_DRIFTED' });
    const drifted = api.get(created.recoveryId) as any;
    expect(drifted.events.at(-1)).toMatchObject({ kind: 'drift-refused' });
    expect(drifted.events.at(-1).predecessorEventIds).toEqual([
      drifted.events.at(-2).eventId,
    ]);
    expect((sessions.get(fixture.sessionId) as Record<string, any>).session.status).toBe('active');

    const secondApi = service();
    const second = await challenge(secondApi);
    clock += 60_000;
    await expect(approve(secondApi, second.created)).rejects.toMatchObject({
      code: 'OPERATOR_RECOVERY_GRANT_EXPIRED',
    });
    const expired = secondApi.get(second.created.recoveryId) as any;
    expect(expired.status).toBe('expired');
    expect(expired.events.some((event: any) => (
      event.kind === 'expired' && event.code === 'OPERATOR_RECOVERY_GRANT_EXPIRED'
    ))).toBe(true);
    expect(secrets.get(`macaroon/operator-recovery/${second.created.recoveryId}/root`)).toBeNull();
    expect(db.prepare(`
      SELECT secret_retirement_pending AS rootPending,
             envelope_retirement_pending AS envelopePending
      FROM operator_recovery_projection WHERE recovery_id = ?
    `).get(second.created.recoveryId)).toEqual({ rootPending: 0, envelopePending: 0 });
  });

  it('rechecks every immutable claim descriptor inside the consume transaction', async () => {
    const api = service();
    const { fixture, created } = await challenge(api);
    const approved = await approve(api, created);
    const claim = created.scope.claims[0];
    db.prepare(`
      UPDATE claim_forest_claims SET confidence = ?
      WHERE node_id = ? AND session_id = ? AND released_at IS NULL
    `).run(Math.max(0, Number(claim.confidence) - 0.25), claim.nodeId, fixture.sessionId);
    expect(() => api.consume(created.recoveryId, approved.grant!)).toThrow(
      expect.objectContaining({ code: 'OPERATOR_RECOVERY_DRIFTED' }),
    );
    expect((sessions.get(fixture.sessionId) as Record<string, any>).session.status).toBe('active');
    expect(db.prepare(`
      SELECT COUNT(*) AS n FROM actor_body_credentials WHERE profile = 'session-body-v1'
    `).get()).toEqual({ n: 0 });
    expect((api.get(created.recoveryId) as any).events.at(-1)).toMatchObject({
      kind: 'drift-refused',
      code: 'OPERATOR_RECOVERY_DRIFTED',
    });
  });

  it('terminates expired sealed custody, revokes its body, and retires both secrets', async () => {
    const api = service({
      installContext: () => {
        throw new Error('simulated exact-slot outage');
      },
    });
    const { created } = await challenge(api);
    const approved = await approve(api, created);
    expect(() => api.consume(created.recoveryId, approved.grant!)).toThrow(
      expect.objectContaining({ code: 'OPERATOR_RECOVERY_CONTEXT_CUSTODY_FAILED' }),
    );
    const pending = api.get(created.recoveryId) as any;
    expect(pending.status).toBe('custody-pending');
    clock = pending.scope.bodyExpiresAt;
    const expired = api.get(created.recoveryId) as any;
    expect(expired).toMatchObject({
      status: 'expired',
      receipt: { terminalAuthorityEventId: expect.any(String) },
    });
    expect(expired.events.some((event: any) => (
      event.kind === 'expired' && event.code === 'OPERATOR_RECOVERY_BODY_EXPIRED'
    ))).toBe(true);
    expect(db.prepare(`
      SELECT revoked_at AS revokedAt
      FROM actor_body_credentials WHERE body_credential_id = ?
    `).get(pending.events.find((event: any) => event.kind === 'session-bound').bodyCredentialId))
      .toEqual({ revokedAt: clock });
    expect(secrets.get(`macaroon/operator-recovery/${created.recoveryId}/root`)).toBeNull();
    expect(secrets.get(`macaroon/operator-recovery/${created.recoveryId}/body-envelope`)).toBeNull();
  });

  it('finishes exact-slot custody after the consuming process dies after the authority commit', async () => {
    mkdirSync(join(process.cwd(), '.scratch'), { recursive: true });
    const scratch = mkdtempSync(join(process.cwd(), '.scratch', 'operator-recovery-crash-'));
    const dbPath = join(scratch, 'authority.sqlite');
    const payloadPath = join(scratch, 'consume.json');
    const fileDb = new Database(dbPath);
    fileDb.pragma('journal_mode = WAL');
    fileDb.pragma('foreign_keys = ON');
    fileDb.pragma('busy_timeout = 5000');
    try {
      const fileSouls = createActorSouls(fileDb, { now: () => clock });
      const fileSessions = createSessions(fileDb);
      const actor = fileSouls.mint({ alias: INTENDED_AGENT_ID });
      const started = fileSessions.start('Crash-boundary recovery', {
        agentId: INTENDED_AGENT_ID,
        project: PROJECT,
        worktreeId: 'crash-boundary-worktree',
        durable: true,
        metadata: {
          identity: { verified: true, actorId: actor.actorId, verifiedAt: clock - 1 },
          worktree: { root: WORKTREE, branch: BRANCH, isMain: false },
        },
      });
      expect(fileSessions.claimFiles(started.id as string, ['lib/crash-owned.ts'], {
        agentId: INTENDED_AGENT_ID,
      })).toMatchObject({ success: true });
      const detail = fileSessions.get(started.id as string) as Record<string, any>;
      const claims = detail.files.map((claim: Record<string, unknown>) => ({
        nodeId: String(claim.nodeId),
        disposition: 'transfer' as const,
      }));
      const fileSecrets = new SqliteSecretStore(fileDb);
      const api = createOperatorRecovery({
        db: fileDb,
        actorSouls: fileSouls,
        sessions: fileSessions,
        daemonGeneration: GENERATION,
        signatureVerifier: verifier,
        runEnrollmentHelper: helper,
        fleetBarExecutablePath: '/Applications/FleetBar.app/Contents/MacOS/FleetBar',
        secrets: fileSecrets,
        now: () => clock,
        resolveGitBranch: () => BRANCH,
        installRecoveredContext: (input) => ({
          contextSlot: input.contextSlot,
          contextPath: join(input.canonicalWorktree, '.portdaddy', 'contexts', `${input.contextSlot}.json`),
          mode: 0o600,
          contentDigest: input.expectedContextDigest,
        }),
      });
      const created = await api.createChallenge({
        harbor: HARBOR,
        intendedAgentId: INTENDED_AGENT_ID,
        project: PROJECT,
        worktree: WORKTREE,
        branch: BRANCH,
        predecessorSessionId: started.id as string,
        sessionIntent: 'Resume after abrupt process death',
        actorId: actor.actorId,
        contextSlot: CONTEXT_SLOT,
        claims,
        expiresAt: clock + 60_000,
      }) as any;
      const approved = await approve(api, created);
      writeFileSync(payloadPath, JSON.stringify({
        recoveryId: created.recoveryId,
        grant: approved.grant,
        now: clock,
        generation: GENERATION,
        branch: BRANCH,
      }), { mode: 0o600 });

      const actorSoulsUrl = pathToFileURL(join(process.cwd(), 'lib/actor-souls.ts')).href;
      const sessionsUrl = pathToFileURL(join(process.cwd(), 'lib/sessions.ts')).href;
      const recoveryUrl = pathToFileURL(join(process.cwd(), 'lib/operator-recovery.ts')).href;
      const workerSource = `
        import Database from 'better-sqlite3';
        import { readFileSync } from 'node:fs';
        const { createActorSouls } = await import(${JSON.stringify(actorSoulsUrl)});
        const { createSessions } = await import(${JSON.stringify(sessionsUrl)});
        const { createOperatorRecovery } = await import(${JSON.stringify(recoveryUrl)});
        const [dbPath, payloadPath] = process.argv.slice(1);
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
        const recovery = createOperatorRecovery({
          db, actorSouls, sessions, daemonGeneration: payload.generation,
          signatureVerifier: null, runEnrollmentHelper: null,
          fleetBarExecutablePath: null, secrets, now: () => payload.now,
          resolveGitBranch: () => payload.branch,
          installRecoveredContext: () => process.exit(91),
        });
        recovery.consume(payload.recoveryId, payload.grant);
        process.exit(92);
      `;
      const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
        const child = spawn(process.execPath, [
          '--import', 'tsx', '--input-type=module', '-e', workerSource,
          dbPath, payloadPath,
        ], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (chunk) => { stderr += String(chunk); });
        child.on('error', rejectExit);
        child.on('exit', (code) => {
          if (code !== 91) rejectExit(new Error(`crash worker exited ${code}: ${stderr}`));
          else resolveExit(code);
        });
      });
      expect(exitCode).toBe(91);
      expect(fileDb.prepare(`
        SELECT status, context_installed_at AS installedAt
        FROM operator_recovery_projection WHERE recovery_id = ?
      `).get(created.recoveryId)).toEqual({ status: 'custody-pending', installedAt: null });
      expect(fileDb.prepare(`
        SELECT COUNT(*) AS n FROM actor_body_credentials WHERE profile = 'session-body-v1'
      `).get()).toEqual({ n: 1 });

      let recoveredCredential = '';
      const restarted = createOperatorRecovery({
        db: fileDb,
        actorSouls: fileSouls,
        sessions: fileSessions,
        daemonGeneration: 'daemon-generation-after-crash-restart',
        signatureVerifier: null,
        runEnrollmentHelper: null,
        fleetBarExecutablePath: null,
        secrets: fileSecrets,
        now: () => clock,
        resolveGitBranch: () => BRANCH,
        installRecoveredContext: (input) => {
          recoveredCredential = input.credential;
          return {
            contextSlot: input.contextSlot,
            contextPath: join(input.canonicalWorktree, '.portdaddy', 'contexts', `${input.contextSlot}.json`),
            mode: 0o600,
            contentDigest: input.expectedContextDigest,
          };
        },
      });
      const recovered = restarted.get(created.recoveryId) as any;
      expect(recovered).toMatchObject({ status: 'consumed', successorSessionId: expect.any(String) });
      expect(recovered.events.filter((event: any) => event.kind === 'context-custody-installed'))
        .toHaveLength(1);
      const resource = {
        sessionId: recovered.successorSessionId,
        intendedAgentId: INTENDED_AGENT_ID,
        project: PROJECT,
        canonicalWorktree: WORKTREE,
        branch: BRANCH,
        status: 'active' as const,
      };
      for (const action of ['session.note.write', 'session.plan.write', 'session.claim.add'] as const) {
        expect(fileSouls.verifyCredentialUse(recoveredCredential, {
          harbor: HARBOR,
          context: { action, resource },
        })).toMatchObject({ ok: true, actorId: actor.actorId, profile: 'session-body-v1' });
      }
      expect(fileSessions.addNote(recovered.successorSessionId, 'Crash recovery note'))
        .toMatchObject({ success: true });
      expect(fileSessions.addNote(recovered.successorSessionId, '- [ ] Crash recovery plan', {
        type: 'todo_list',
      })).toMatchObject({ success: true });
      expect(fileSessions.claimFiles(recovered.successorSessionId, ['lib/crash-new.ts'], {
        agentId: INTENDED_AGENT_ID,
      })).toMatchObject({ success: true, claimed: ['lib/crash-new.ts'] });
      const serializedEvents = (fileDb.prepare(`
        SELECT payload_json FROM harbor_events WHERE stream_type = 'operator-recovery-event'
      `).all() as Array<{ payload_json: string }>).map((row) => row.payload_json).join('\n');
      expect(serializedEvents).not.toContain(recoveredCredential);
      expect(serializedEvents).not.toContain('pdab1.');
    } finally {
      fileDb.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 20_000);

  it('allows exactly one consume across two file-backed processes', async () => {
    mkdirSync(join(process.cwd(), '.scratch'), { recursive: true });
    const scratch = mkdtempSync(join(process.cwd(), '.scratch', 'operator-recovery-blue-'));
    const dbPath = join(scratch, 'authority.sqlite');
    const fileDb = new Database(dbPath);
    fileDb.pragma('journal_mode = WAL');
    fileDb.pragma('foreign_keys = ON');
    fileDb.pragma('busy_timeout = 5000');
    try {
      const fileSouls = createActorSouls(fileDb, { now: () => clock });
      const fileSessions = createSessions(fileDb);
      const actor = fileSouls.mint({ alias: INTENDED_AGENT_ID });
      const started = fileSessions.start('File-backed concurrent recovery', {
        agentId: INTENDED_AGENT_ID,
        project: PROJECT,
        worktreeId: 'file-backed-worktree',
        durable: true,
        metadata: {
          identity: { verified: true, actorId: actor.actorId, verifiedAt: clock - 1 },
          worktree: { root: WORKTREE, branch: BRANCH, isMain: false },
        },
      });
      expect(fileSessions.claimFiles(started.id as string, ['lib/concurrent.ts'], {
        agentId: INTENDED_AGENT_ID,
      }).success).toBe(true);
      const details = fileSessions.get(started.id as string) as Record<string, any>;
      const claims = details.files.map((claim: Record<string, unknown>) => ({
        nodeId: String(claim.nodeId),
        disposition: 'transfer' as const,
      }));
      const fileSecrets = new SqliteSecretStore(fileDb);
      const api = createOperatorRecovery({
        db: fileDb,
        actorSouls: fileSouls,
        sessions: fileSessions,
        daemonGeneration: GENERATION,
        signatureVerifier: verifier,
        runEnrollmentHelper: helper,
        fleetBarExecutablePath: '/Applications/FleetBar.app/Contents/MacOS/FleetBar',
        secrets: fileSecrets,
        now: () => clock,
        resolveGitBranch: () => BRANCH,
        installRecoveredContext: (input) => ({
          contextSlot: input.contextSlot,
          contextPath: join(input.canonicalWorktree, '.portdaddy', 'contexts', `${input.contextSlot}.json`),
          mode: 0o600,
          contentDigest: input.expectedContextDigest,
        }),
      });
      const created = await api.createChallenge({
        harbor: HARBOR,
        intendedAgentId: INTENDED_AGENT_ID,
        project: PROJECT,
        worktree: WORKTREE,
        branch: BRANCH,
        predecessorSessionId: started.id as string,
        sessionIntent: 'File-backed concurrent recovery',
        actorId: actor.actorId,
        contextSlot: CONTEXT_SLOT,
        claims,
        expiresAt: clock + 60_000,
      }) as any;
      const approved = await approve(api, created);
      const payloadPath = join(scratch, 'consume.json');
      const gatePath = join(scratch, 'go');
      const readyA = join(scratch, 'ready-a');
      const readyB = join(scratch, 'ready-b');
      writeFileSync(payloadPath, JSON.stringify({
        recoveryId: created.recoveryId,
        grant: approved.grant,
        now: clock,
        generation: GENERATION,
        branch: BRANCH,
      }), { mode: 0o600 });

      const actorSoulsUrl = pathToFileURL(join(process.cwd(), 'lib/actor-souls.ts')).href;
      const sessionsUrl = pathToFileURL(join(process.cwd(), 'lib/sessions.ts')).href;
      const recoveryUrl = pathToFileURL(join(process.cwd(), 'lib/operator-recovery.ts')).href;
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
          installRecoveredContext: (input) => ({
            contextSlot: input.contextSlot,
            contextPath: input.canonicalWorktree + '/.portdaddy/contexts/' + input.contextSlot + '.json',
            mode: 384,
            contentDigest: input.expectedContextDigest,
          }),
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
      const runWorker = (readyPath: string) => new Promise<any>((resolveWorker, rejectWorker) => {
        const child = spawn(process.execPath, [
          '--import', 'tsx', '--input-type=module', '-e', workerSource,
          dbPath, payloadPath, gatePath, readyPath,
        ], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += String(chunk); });
        child.stderr.on('data', (chunk) => { stderr += String(chunk); });
        child.on('error', rejectWorker);
        child.on('exit', (code) => {
          const line = stdout.split('\n').find((entry) => entry.startsWith('RESULT:'));
          if (code !== 0 || !line) {
            rejectWorker(new Error(`worker failed (${code}): ${stderr || stdout}`));
            return;
          }
          resolveWorker(JSON.parse(line.slice('RESULT:'.length)));
        });
      });
      const workerA = runWorker(readyA);
      const workerB = runWorker(readyB);
      const deadline = Date.now() + 5_000;
      while ((!existsSync(readyA) || !existsSync(readyB)) && Date.now() < deadline) await delay(10);
      expect(existsSync(readyA) && existsSync(readyB)).toBe(true);
      writeFileSync(gatePath, 'go');
      const results = await Promise.all([workerA, workerB]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([
        expect.objectContaining({ code: 'OPERATOR_RECOVERY_GRANT_REPLAYED' }),
      ]);
      expect(fileDb.prepare(`
        SELECT COUNT(*) AS n FROM actor_body_credentials WHERE profile = 'session-body-v1'
      `).get()).toEqual({ n: 1 });
      const kinds = (fileDb.prepare(`
        SELECT payload_json FROM harbor_events
        WHERE stream_type = 'operator-recovery-event'
          AND json_extract(payload_json, '$.recoveryId') = ?
      `).all(created.recoveryId) as Array<{ payload_json: string }>)
        .map((row) => JSON.parse(row.payload_json).kind);
      expect(kinds.filter((kind) => kind === 'grant-consumed')).toHaveLength(1);
      expect(kinds.filter((kind) => kind === 'session-bound')).toHaveLength(1);
      expect(kinds.filter((kind) => kind === 'replay-refused')).toHaveLength(1);
    } finally {
      fileDb.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 20_000);

  it('keeps harbor_events append-only', async () => {
    const api = service();
    await challenge(api);
    expect(() => db.prepare("UPDATE harbor_events SET kind = 'forged' WHERE stream_type = 'operator-recovery-event'").run())
      .toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM harbor_events WHERE stream_type = 'operator-recovery-event'").run())
      .toThrow(/append-only/);
  });

  it('rejects a structurally valid forged authority transition during live read and restart', async () => {
    const api = service();
    const { created } = await challenge(api);
    const last = (api.get(created.recoveryId) as any).events.at(-1);
    appendEvent(db, {
      streamType: 'operator-recovery-event',
      payload: {
        ...last,
        ledgerSeq: undefined,
        eventId: `operator-recovery:${created.recoveryId}:forged-session-bound`,
        kind: 'session-bound',
        predecessorEventIds: [last.eventId],
        successorSessionId: 'session-forged',
        bodyCredentialId: 'body-forged',
        bodyEnvelopeDigest: `sha256:${'f'.repeat(64)}`,
      },
    });
    expect(() => api.get(created.recoveryId)).toThrow(
      expect.objectContaining({ code: 'OPERATOR_RECOVERY_LEDGER_INVALID' }),
    );
    expect(() => service()).toThrow(
      expect.objectContaining({ code: 'OPERATOR_RECOVERY_LEDGER_INVALID' }),
    );
  });
});
