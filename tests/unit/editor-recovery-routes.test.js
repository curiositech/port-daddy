import { describe, expect, it } from '@jest/globals';
import Fastify from 'fastify';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createEditorRecovery } from '../../lib/editor-recovery.js';
import { createRecoveryMagicLink } from '../../lib/recovery-magic-link.js';
import { createSessions } from '../../lib/sessions.js';
import { editorRecoveryPlugin } from '../../routes/editor-recovery.js';
import { recoveryPlugin } from '../../routes/recovery.js';
import { createTestActorSouls, mintTestActor } from '../helpers/actor-credentials.js';
import { createTestDb } from '../setup-unit.js';
import { parse as parseYaml } from 'yaml';

const PEER_ID = '424242';

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function operationDigest(operations) {
  const digest = createHash('sha256');
  for (const operation of operations) digest.update(`${operation.sequence}:${operation.operationHash}\n`);
  return digest.digest('hex');
}

function verifiedMetadata(souls, actor) {
  return {
    identity: {
      verified: true,
      actorId: actor.actorId,
      soulClass: souls.resolveActor(actor.actorId).soulClass,
    },
  };
}

function createManualProvenanceDrainScheduler() {
  const startup = [];
  const periodic = [];
  let disposed = 0;
  return {
    scheduleStartup(run) {
      startup.push(run);
    },
    schedulePeriodic(run, intervalMs) {
      const entry = { run, intervalMs, active: true };
      periodic.push(entry);
      return {
        dispose() {
          if (entry.active) disposed += 1;
          entry.active = false;
        },
      };
    },
    async runStartup() {
      for (const run of startup.splice(0)) await run();
    },
    async runPeriodic() {
      for (const entry of periodic) {
        if (entry.active) await entry.run();
      }
    },
    get startupCount() { return startup.length; },
    get periodicCount() { return periodic.filter(entry => entry.active).length; },
    get disposedCount() { return disposed; },
    get intervals() { return periodic.map(entry => entry.intervalMs); },
  };
}

function createFixture(options = {}) {
  const db = createTestDb();
  const sessions = createSessions(db, undefined, { requireAgentForFileClaims: true });
  const souls = createTestActorSouls(db);
  const targetRoot = join(process.cwd(), 'target', 'editor-recovery-tests');
  mkdirSync(targetRoot, { recursive: true });
  const worktreeRoot = mkdtempSync(join(targetRoot, 'fixture-'));
  const srcDir = join(worktreeRoot, 'src');
  mkdirSync(srcDir, { recursive: true });
  const filePath = join(srcDir, 'parser.rs');
  writeFileSync(filePath, 'fn parse_header() {}\n');

  const deadActor = mintTestActor(souls, 'harbor-editor:dead');
  const requesterActor = mintTestActor(souls, 'harbor-editor:requester');
  const successorActor = mintTestActor(souls, 'harbor-editor:successor');
  const scopeRecords = new Map();
  const claimPathOverrides = new Map();
  const capableActors = new Set([requesterActor.actorId, successorActor.actorId]);
  let clock = Date.now();
  let replayValidationHook = null;
  let replayReceiptPersistenceHook = null;
  let finalizationMutationHook = null;
  let afterFinalDescriptorCheckHook = null;
  let pathVerificationHook = null;

  function startSession(purpose, agentId, actor, overrides = {}) {
    const project = overrides.project ?? 'project-a';
    const worktreeId = overrides.worktreeId ?? 'worktree-a';
    const authoritativeRoot = overrides.worktreeRoot ?? worktreeRoot;
    const rootIdentity = lstatSync(authoritativeRoot, { bigint: true });
    const started = sessions.start(purpose, {
      agentId,
      project,
      worktreeId,
      metadata: verifiedMetadata(souls, actor),
      durable: true,
    });
    expect(started.success).toBe(true);
    scopeRecords.set(started.id, {
      actorId: actor.actorId,
      project,
      harbor: overrides.harbor ?? 'harbor-a',
      worktreeId,
      worktreeRoot: authoritativeRoot,
      worktreeVerified: overrides.worktreeVerified ?? true,
      worktreeRootDevice: overrides.worktreeRootDevice ?? String(rootIdentity.dev),
      worktreeRootInode: overrides.worktreeRootInode ?? String(rootIdentity.ino),
    });
    return started.id;
  }

  const deadSessionId = startSession('Abandoned parser edit', 'harbor-editor:dead', deadActor);
  const requesterSessionId = startSession('Request parser salvage', 'harbor-editor:requester', requesterActor);
  const successorSessionId = startSession('Replay parser salvage', 'harbor-editor:successor', successorActor);

  expect(sessions.claimFiles(deadSessionId, [], {
    agentId: 'harbor-editor:dead',
    regions: [{
      path: filePath,
      startLine: 1,
      endLine: 1,
      symbol: 'parse_header',
      symbolPath: 'parse_header',
    }],
  }).success).toBe(true);

  const scopeAuthority = {
    resolveSession(sessionId) {
      const lookup = sessions.get(sessionId);
      const stored = scopeRecords.get(sessionId);
      if (!lookup.success || !stored) return null;
      return {
        sessionId,
        status: lookup.session.status,
        agentId: lookup.session.agentId,
        actorId: stored.actorId,
        project: stored.project,
        harbor: stored.harbor,
        worktreeId: stored.worktreeId,
        worktreeRoot: stored.worktreeRoot,
        worktreeVerified: stored.worktreeVerified,
        worktreeRootDevice: stored.worktreeRootDevice,
        worktreeRootInode: stored.worktreeRootInode,
        completedAt: lookup.session.completedAt,
        claims: lookup.files.map((claim, index) => ({
          ...claim,
          filePath: claimPathOverrides.get(sessionId) ?? claim.filePath,
          claimId: `claim:${index + 1}`,
        })),
      };
    },
    authorizeSalvage({ actorId }) {
      return capableActors.has(actorId)
        ? { allowed: true }
        : { allowed: false, reason: 'missing editor:salvage capability' };
    },
  };

  // This is intentionally test-only. Production has no default validator and
  // returns 503 until a real canonical Rust contract is injected.
  let sealedFinalStateHash = null;
  const canonicalLoro = {
    validateOperation(input) {
      const operationHash = hash(input.bytes);
      return {
        validatorId: 'TEST_ONLY_NOT_A_PRODUCTION_WITNESS',
        receipt: `test-op:${input.sequence}:${operationHash}`,
        peerId: PEER_ID,
        sequence: input.sequence,
        operationHash: options.rejectOperationBytes?.equals(input.bytes)
          ? hash('TEST_ONLY_CANONICAL_REJECTION')
          : operationHash,
        stateHash: hash(`${input.previousStateHash ?? 'root'}:${operationHash}`),
      };
    },
    validateAbandonment(input) {
      const highWater = input.operations.at(-1);
      sealedFinalStateHash = highWater.stateHash;
      return {
        validatorId: 'TEST_ONLY_NOT_A_PRODUCTION_WITNESS',
        receipt: `test-abandonment:${input.authorSessionId}`,
        peerId: PEER_ID,
        highWaterSequence: highWater.sequence + (options.terminalHighWaterOffset ?? 0),
        highWaterHash: highWater.operationHash,
        operationCount: input.operations.length + (options.terminalCountOffset ?? 0),
        finalStateHash: highWater.stateHash,
      };
    },
    validateReplay(input) {
      replayValidationHook?.(input);
      return {
        validatorId: 'TEST_ONLY_NOT_A_PRODUCTION_WITNESS',
        receipt: `test-replay:${input.preparationId}`,
        operationDigest: options.rejectReplay
          ? hash('TEST_ONLY_CANONICAL_REPLAY_REJECTION')
          : operationDigest(input.operations),
        finalStateHash: options.replayFinalStateMismatch
          ? hash('TEST_ONLY_TERMINAL_STATE_MISMATCH')
          : sealedFinalStateHash,
        highWaterSequence: input.highWaterSequence,
        operationCount: input.operations.length,
      };
    },
  };

  let symbols = [{
    symbolPath: 'parse_header',
    symbol: 'parse_header',
    startLine: 1,
    endLine: 1,
  }];
  let symbolParserGeneration = 1;
  let symbolAuthorityGeneration = 1;
  let symbolWitnessSequence = 0;
  let deferredSymbolResolution = null;
  let rejectedSymbolResolution = null;
  let symbolReleaseFailure = null;
  let activeSymbolLease = null;
  const symbolWitnesses = new Map();
  const symbolAuthority = {
    async resolveFresh(input) {
      const witness = Object.freeze({
        witnessId: `symbol-witness:${++symbolWitnessSequence}`,
        canonicalPath: input.canonicalPath,
        fileContentHash: input.fileContentHash,
        symbolPath: input.symbolPath,
        parserGeneration: `parser:${symbolParserGeneration}`,
        authorityGeneration: `authority:${symbolAuthorityGeneration}`,
      });
      symbolWitnesses.set(witness.witnessId, {
        witness,
        matches: Object.freeze(symbols.map(symbol => Object.freeze({ ...symbol }))),
        parserGeneration: symbolParserGeneration,
        authorityGeneration: symbolAuthorityGeneration,
      });
      const deferred = deferredSymbolResolution;
      deferredSymbolResolution = null;
      if (deferred) {
        deferred.markStarted();
        await deferred.wait;
      }
      const rejected = rejectedSymbolResolution;
      rejectedSymbolResolution = null;
      if (rejected) throw rejected;
      return witness;
    },
    acquireResolutionLease(transactionDb, witness) {
      const witnessed = symbolWitnesses.get(witness.witnessId);
      if (transactionDb !== db || !transactionDb.inTransaction) {
        return { success: false, error: 'symbol lease requires the active recovery transaction' };
      }
      if (
        !witnessed
        || witnessed.witness !== witness
        || witnessed.parserGeneration !== symbolParserGeneration
        || witnessed.authorityGeneration !== symbolAuthorityGeneration
      ) {
        return { success: false, error: 'the witnessed symbol authority generation drifted before lease acquisition' };
      }
      if (activeSymbolLease) return { success: false, error: 'another symbol resolution lease is active' };
      const lease = {
        witness,
        matches: witnessed.matches,
        validate(validationDb) {
          const valid = validationDb === db
            && validationDb.inTransaction
            && activeSymbolLease === lease
            && witnessed.parserGeneration === symbolParserGeneration
            && witnessed.authorityGeneration === symbolAuthorityGeneration;
          return { valid, ...(valid ? {} : { error: 'the held symbol authority generation drifted' }) };
        },
        release() {
          if (activeSymbolLease === lease) activeSymbolLease = null;
          const failure = symbolReleaseFailure;
          symbolReleaseFailure = null;
          if (failure) throw failure;
        },
      };
      activeSymbolLease = lease;
      return { success: true, lease };
    },
  };

  db.exec(`
    CREATE TABLE editor_file_mutation_lease_probe (
      stable_claim_id TEXT PRIMARY KEY,
      lease_id TEXT NOT NULL,
      generation TEXT NOT NULL,
      input_json TEXT NOT NULL
    )
  `);
  let fileMutationGeneration = 1;
  let fileMutationLeaseSequence = 0;
  let activeFileMutationLease = null;
  let fileMutationReleaseFailure = null;
  let deniedAuthorizedMutations = 0;
  const fileMutationAuthority = {
    acquireFinalizationLease(transactionDb, input) {
      if (transactionDb !== db || !transactionDb.inTransaction) {
        return { success: false, error: 'file mutation lease requires the active recovery transaction' };
      }
      if (activeFileMutationLease) return { success: false, error: 'another file mutation lease is active' };
      const generation = `mutation:${fileMutationGeneration}`;
      const lease = {
        leaseId: `mutation-lease:${++fileMutationLeaseSequence}`,
        generation,
        validate(validationDb) {
          const valid = validationDb === db
            && validationDb.inTransaction
            && activeFileMutationLease === lease
            && generation === `mutation:${fileMutationGeneration}`;
          return { valid, ...(valid ? {} : { error: 'the held file mutation generation drifted' }) };
        },
        consume(consumptionDb, consumed) {
          const validation = lease.validate(consumptionDb);
          if (!validation.valid) return { success: false, error: validation.error };
          consumptionDb.prepare(`
            INSERT INTO editor_file_mutation_lease_probe (
              stable_claim_id, lease_id, generation, input_json
            ) VALUES (?, ?, ?, ?)
          `).run(consumed.stableClaimId, lease.leaseId, generation, JSON.stringify({ ...input, ...consumed }));
          return { success: true };
        },
        release({ committed }) {
          if (activeFileMutationLease !== lease) return;
          activeFileMutationLease = null;
          if (committed) fileMutationGeneration += 1;
          const failure = fileMutationReleaseFailure;
          fileMutationReleaseFailure = null;
          if (failure) throw failure;
        },
      };
      activeFileMutationLease = lease;
      return { success: true, lease };
    },
  };

  db.exec(`
    CREATE TABLE editor_claim_transfer_callback_probe (
      abandonment_receipt_id INTEGER PRIMARY KEY,
      released_claim_id TEXT NOT NULL,
      input_json TEXT NOT NULL
    )
  `);
  const claimTransferAuthority = {
    transferReleasedClaim(transactionDb, input) {
      if (transactionDb !== db) {
        return { success: false, error: 'wrong database connection' };
      }
      if (!transactionDb.inTransaction) {
        throw new Error('P3 claim transfer must use the active P3.5 database transaction');
      }
      if (!Object.isFrozen(input) || !Object.isFrozen(input.resolvedSymbol)) {
        throw new Error('P3 claim transfer input must be immutable');
      }
      if (!activeSymbolLease || !activeFileMutationLease) {
        throw new Error('P3 claim transfer requires held symbol and file-mutation authority leases');
      }
      if (
        input.symbolParserGeneration !== activeSymbolLease.witness.parserGeneration
        || input.symbolAuthorityGeneration !== activeSymbolLease.witness.authorityGeneration
        || input.fileMutationLeaseId !== activeFileMutationLease.leaseId
        || input.fileMutationGeneration !== activeFileMutationLease.generation
      ) {
        throw new Error('P3 claim transfer did not receive the exact held authority generations');
      }
      transactionDb.prepare(`
        INSERT INTO editor_claim_transfer_callback_probe (
          abandonment_receipt_id, released_claim_id, input_json
        ) VALUES (?, ?, ?)
      `).run(input.abandonmentReceiptId, input.releasedClaimId, JSON.stringify(input));
      return {
        success: true,
        stableClaimId: input.releasedClaimId,
      };
    },
  };

  const provenanceDrainScheduler = options.provenanceDrainScheduler
    ?? createManualProvenanceDrainScheduler();
  const recoveryDeps = {
    scopeAuthority,
    canonicalLoro,
    symbolAuthority,
    claimTransferAuthority,
    fileMutationAuthority,
    provenancePublisher: options.provenancePublisher ?? null,
    provenanceDrainScheduler,
    provenanceAttemptPersistenceHook: options.provenanceAttemptPersistenceHook ?? null,
    provenancePublicationReceiptPersistenceHook: options.provenancePublicationReceiptPersistenceHook ?? null,
    pathVerificationHook(phase) {
      pathVerificationHook?.(phase);
    },
    replayReceiptPersistenceHook() {
      replayReceiptPersistenceHook?.();
    },
    finalizationMutationHook() {
      finalizationMutationHook?.();
    },
    afterFinalDescriptorCheckHook() {
      afterFinalDescriptorCheckHook?.();
    },
    now: () => clock,
  };
  const recoveries = [];
  const createRecoveryWith = (overrides = {}) => {
    const recovery = createEditorRecovery(db, {
      ...recoveryDeps,
      ...overrides,
    });
    recoveries.push(recovery);
    return recovery;
  };
  const editorRecovery = createRecoveryWith();

  const app = Fastify();
  app.register(editorRecoveryPlugin, {
    deps: {
      db,
      sessions,
      editorRecovery,
      actorSouls: souls,
      logger: { info() {}, error() {} },
    },
  });
  async function recordAndAbandon({ count = 2 } = {}) {
    for (let sequence = 0; sequence < count; sequence++) {
      const result = await editorRecovery.recordOperationReceipt({
        sessionId: deadSessionId,
        filePath,
        sequence,
        bytes: Buffer.from(`test-only-loro-envelope-${sequence}`),
      });
      expect(result.success).toBe(true);
    }
    expect(sessions.abandon(deadSessionId).success).toBe(true);
    const sealed = await editorRecovery.sealAbandonment({ sessionId: deadSessionId, filePath });
    expect(sealed.success).toBe(true);
    return sealed;
  }

  async function requestEditor(headers = requesterActor.headers, payload = {}) {
    return app.inject({
      method: 'POST',
      url: '/editor/recovery/request',
      headers,
      payload: {
        dead_session_id: deadSessionId,
        requester_session_id: requesterSessionId,
        file_path: filePath,
        ...payload,
      },
    });
  }

  async function prepare(token, payload = {}) {
    return app.inject({
      method: 'POST',
      url: '/editor/recovery/prepare',
      headers: successorActor.headers,
      payload: { token, successor_session_id: successorSessionId, ...payload },
    });
  }

  async function replay(preparationId, payload = {}) {
    return app.inject({
      method: 'POST',
      url: '/editor/recovery/replay',
      headers: successorActor.headers,
      payload: { preparation_id: preparationId, successor_session_id: successorSessionId, ...payload },
    });
  }

  async function finalize(token, preparationId, payload = {}) {
    return app.inject({
      method: 'POST',
      url: '/editor/recovery/finalize',
      headers: successorActor.headers,
      payload: {
        token,
        preparation_id: preparationId,
        successor_session_id: successorSessionId,
        ...payload,
      },
    });
  }

  async function close() {
    await app.close();
    for (const recovery of recoveries) await recovery.dispose();
    db.close();
    rmSync(worktreeRoot, { recursive: true, force: true });
  }

  return {
    app,
    db,
    sessions,
    souls,
    editorRecovery,
    canonicalLoro,
    symbolAuthority,
    scopeAuthority,
    claimTransferAuthority,
    fileMutationAuthority,
    provenanceDrainScheduler,
    get transferredClaims() {
      return db.prepare(`
        SELECT input_json FROM editor_claim_transfer_callback_probe
        ORDER BY abandonment_receipt_id
      `).all().map(row => JSON.parse(row.input_json));
    },
    createRecoveryWith,
    scopeRecords,
    capableActors,
    deadActor,
    requesterActor,
    successorActor,
    deadSessionId,
    requesterSessionId,
    successorSessionId,
    worktreeRoot,
    filePath,
    recordAndAbandon,
    requestEditor,
    prepare,
    replay,
    finalize,
    advanceClock(milliseconds) { clock += milliseconds; },
    setReplayValidationHook(hook) { replayValidationHook = hook; },
    setReplayReceiptPersistenceHook(hook) { replayReceiptPersistenceHook = hook; },
    setFinalizationMutationHook(hook) { finalizationMutationHook = hook; },
    setAfterFinalDescriptorCheckHook(hook) { afterFinalDescriptorCheckHook = hook; },
    setPathVerificationHook(hook) { pathVerificationHook = hook; },
    replaceRootDuringVerification() {
      const displacedRoot = `${worktreeRoot}-displaced`;
      renameSync(worktreeRoot, displacedRoot);
      mkdirSync(join(worktreeRoot, 'src'), { recursive: true });
      writeFileSync(filePath, 'fn parse_header() {}\n');
      return () => {
        rmSync(worktreeRoot, { recursive: true, force: true });
        renameSync(displacedRoot, worktreeRoot);
      };
    },
    setSymbols(next) {
      symbols = next;
      symbolParserGeneration += 1;
    },
    rejectNextSymbolResolution(error = new Error('injected symbol authority rejection')) {
      rejectedSymbolResolution = error;
    },
    failNextSymbolRelease(error = new Error('injected symbol lease release failure')) {
      symbolReleaseFailure = error;
    },
    failNextFileMutationRelease(error = new Error('injected file mutation lease release failure')) {
      fileMutationReleaseFailure = error;
    },
    advanceSymbolAuthorityGeneration() {
      if (activeSymbolLease) return false;
      symbolAuthorityGeneration += 1;
      return true;
    },
    attemptAuthorizedMutation(mutate) {
      if (activeFileMutationLease) {
        deniedAuthorizedMutations += 1;
        return false;
      }
      fileMutationGeneration += 1;
      mutate();
      return true;
    },
    get deniedAuthorizedMutations() { return deniedAuthorizedMutations; },
    get activeSymbolLease() { return activeSymbolLease; },
    get activeFileMutationLease() { return activeFileMutationLease; },
    get mutationLeaseConsumptions() {
      return db.prepare('SELECT * FROM editor_file_mutation_lease_probe ORDER BY stable_claim_id').all();
    },
    setClaimPath(sessionId, path) { claimPathOverrides.set(sessionId, path); },
    deferNextSymbolResolution() {
      let markStarted;
      let release;
      const started = new Promise(resolve => { markStarted = resolve; });
      const wait = new Promise(resolve => { release = resolve; });
      deferredSymbolResolution = { markStarted, wait };
      return { started, release };
    },
    close,
  };
}

describe('Harbor Editor recovery trust boundary', () => {
  it.each([
    '/editor/recovery/request',
    '/editor/recovery/prepare',
    '/editor/recovery/replay',
    '/editor/recovery/finalize',
  ])('rejects unauthenticated callers before mutating %s', async (url) => {
    const db = createTestDb();
    const sessions = createSessions(db);
    const souls = createTestActorSouls(db);
    const app = Fastify();
    app.register(editorRecoveryPlugin, { deps: { db, sessions, actorSouls: souls } });
    const response = await app.inject({ method: 'POST', url, payload: {} });
    expect(response.statusCode).toBe(401);
    expect(db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_tokens').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_preparations').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM editor_replay_validation_receipts').get().count).toBe(0);
    await app.close();
    db.close();
  });

  it('fails closed in the production shape when Rust and scope authorities are unavailable', async () => {
    const db = createTestDb();
    const sessions = createSessions(db);
    const souls = createTestActorSouls(db);
    const actor = mintTestActor(souls, 'harbor-editor:unwired');
    const app = Fastify();
    app.register(editorRecoveryPlugin, { deps: { db, sessions, actorSouls: souls } });

    const response = await app.inject({
      method: 'POST',
      url: '/editor/recovery/request',
      headers: actor.headers,
      payload: { dead_session_id: 'dead', requester_session_id: 'requester', file_path: '/repo/file.rs' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('EDITOR_SCOPE_AUTHORITY_UNAVAILABLE');
    expect(db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_tokens').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM editor_operation_receipts').get().count).toBe(0);
    await app.close();
    db.close();
  });

  it('uses daemon-owned typed receipts and ignores forgeable session notes', async () => {
    const fixture = createFixture();
    const forged = fixture.sessions.addNote(fixture.deadSessionId, JSON.stringify({
      kind: 'loro.oplog',
      peer: '999',
      seq: 99,
      ops: Buffer.from('forged').toString('base64'),
    }), { type: 'editor-oplog' });
    expect(forged.success).toBe(true);
    await fixture.recordAndAbandon();

    const operationRows = fixture.db.prepare(`
      SELECT author_actor_id, author_session_id, project, harbor, worktree_id,
             canonical_path, peer_id, sequence, operation_hash, validator_id
      FROM editor_operation_receipts ORDER BY sequence
    `).all();
    expect(operationRows).toHaveLength(2);
    expect(operationRows.map(row => row.sequence)).toEqual([0, 1]);
    expect(operationRows.every(row => row.author_actor_id === fixture.deadActor.actorId)).toBe(true);
    expect(operationRows.every(row => row.peer_id === PEER_ID)).toBe(true);
    expect(operationRows.every(row => row.validator_id === 'TEST_ONLY_NOT_A_PRODUCTION_WITNESS')).toBe(true);
    const abandonment = fixture.db.prepare('SELECT * FROM editor_abandonment_receipts').get();
    expect(abandonment.high_water_sequence).toBe(1);
    expect(abandonment.operation_count).toBe(2);
    await fixture.close();
  });

  it('enforces DB sequence uniqueness and rejects a colliding receipt', async () => {
    const fixture = createFixture();
    const first = await fixture.editorRecovery.recordOperationReceipt({
      sessionId: fixture.deadSessionId,
      filePath: fixture.filePath,
      sequence: 0,
      bytes: Buffer.from('operation-zero'),
    });
    expect(first.success).toBe(true);
    const duplicate = await fixture.editorRecovery.recordOperationReceipt({
      sessionId: fixture.deadSessionId,
      filePath: fixture.filePath,
      sequence: 0,
      bytes: Buffer.from('operation-zero'),
    });
    expect(duplicate).toEqual(expect.objectContaining({ success: true, duplicate: true }));
    const collision = await fixture.editorRecovery.recordOperationReceipt({
      sessionId: fixture.deadSessionId,
      filePath: fixture.filePath,
      sequence: 0,
      bytes: Buffer.from('different-operation-zero'),
    });
    expect(collision).toEqual(expect.objectContaining({
      success: false,
      code: 'EDITOR_OPERATION_SEQUENCE_COLLISION',
    }));
    writeFileSync(fixture.filePath, 'fn parse_header_changed() {}\n');
    const driftedRetry = await fixture.editorRecovery.recordOperationReceipt({
      sessionId: fixture.deadSessionId,
      filePath: fixture.filePath,
      sequence: 0,
      bytes: Buffer.from('operation-zero'),
    });
    expect(driftedRetry).toEqual(expect.objectContaining({
      success: false,
      code: 'EDITOR_OPERATION_SCOPE_DRIFT',
    }));
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_operation_receipts').get().count).toBe(1);
    await fixture.close();
  });

  it('persists no operation receipt when canonical Rust rejects garbage bytes', async () => {
    const garbage = Buffer.from('not-a-loro-operation');
    const fixture = createFixture({ rejectOperationBytes: garbage });
    const result = await fixture.editorRecovery.recordOperationReceipt({
      sessionId: fixture.deadSessionId,
      filePath: fixture.filePath,
      sequence: 0,
      bytes: garbage,
    });
    expect(result).toEqual(expect.objectContaining({
      success: false,
      code: 'CANONICAL_LORO_OPERATION_REJECTED',
    }));
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_operation_receipts').get().count).toBe(0);
    await fixture.close();
  });

  it('rejects a missing operation tail against the canonical terminal high-water receipt', async () => {
    const fixture = createFixture({ terminalHighWaterOffset: 1 });
    for (let sequence = 0; sequence < 2; sequence++) {
      expect((await fixture.editorRecovery.recordOperationReceipt({
        sessionId: fixture.deadSessionId,
        filePath: fixture.filePath,
        sequence,
        bytes: Buffer.from(`terminal-stream-${sequence}`),
      })).success).toBe(true);
    }
    expect(fixture.sessions.abandon(fixture.deadSessionId).success).toBe(true);
    const sealed = await fixture.editorRecovery.sealAbandonment({
      sessionId: fixture.deadSessionId,
      filePath: fixture.filePath,
    });
    expect(sealed).toEqual(expect.objectContaining({
      success: false,
      code: 'CANONICAL_LORO_ABANDONMENT_REJECTED',
    }));
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_abandonment_receipts').get().count).toBe(0);
    await fixture.close();
  });

  it('rejects a caller whose verified actor does not own the requester session', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const response = await fixture.requestEditor(fixture.successorActor.headers);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('EDITOR_SESSION_ACTOR_MISMATCH');
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_tokens').get().count).toBe(0);
    await fixture.close();
  });

  it('does not finalize before replay, then commits canonical provenance with a pending outbox when no publisher is wired', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const requested = await fixture.requestEditor();
    expect(requested.statusCode).toBe(201);
    const { token } = requested.json();
    const prepared = await fixture.prepare(token);
    expect(prepared.statusCode).toBe(200);
    const preparationId = prepared.json().preparation_id;

    const premature = await fixture.finalize(token, preparationId);
    expect(premature.statusCode).toBe(409);
    expect(premature.json().code).toBe('EDITOR_REPLAY_RECEIPT_REQUIRED');
    expect(fixture.db.prepare('SELECT consumed_at FROM editor_recovery_tokens WHERE token = ?').get(token).consumed_at).toBeNull();
    expect(fixture.transferredClaims).toHaveLength(0);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance').get().count).toBe(0);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_outbox').get().count).toBe(0);

    const replayed = await fixture.replay(preparationId);
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json().replay_validation).toEqual(expect.objectContaining({
      operation_count: 2,
      high_water_sequence: 1,
      validator_id: 'TEST_ONLY_NOT_A_PRODUCTION_WITNESS',
    }));
    const finalized = await fixture.finalize(token, preparationId);
    expect(finalized.statusCode).toBe(200);
    expect(fixture.transferredClaims).toEqual([
      expect.objectContaining({
        releasedClaimId: expect.stringMatching(/^claim:/),
        deadSessionId: fixture.deadSessionId,
        deadAgentId: 'harbor-editor:dead',
        deadActorId: fixture.deadActor.actorId,
        successorSessionId: fixture.successorSessionId,
        successorAgentId: 'harbor-editor:successor',
        successorActorId: fixture.successorActor.actorId,
        project: 'project-a',
        harbor: 'harbor-a',
        worktreeId: 'worktree-a',
        worktreeRoot: fixture.worktreeRoot,
        worktreeRootDevice: expect.any(String),
        worktreeRootInode: expect.any(String),
        canonicalPath: fixture.filePath,
        canonicalDevice: expect.any(String),
        canonicalInode: expect.any(String),
        canonicalContentHash: hash('fn parse_header() {}\n'),
        symbolParserGeneration: expect.stringMatching(/^parser:/),
        symbolAuthorityGeneration: expect.stringMatching(/^authority:/),
        fileMutationLeaseId: expect.stringMatching(/^mutation-lease:/),
        fileMutationGeneration: expect.stringMatching(/^mutation:/),
        resolvedSymbol: expect.objectContaining({ symbolPath: 'parse_header' }),
      }),
    ]);
    expect(finalized.json()).toEqual(expect.objectContaining({
      provenance_record_id: expect.any(Number),
      provenance_outbox: expect.objectContaining({ status: 'pending' }),
    }));
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance').get().count).toBe(1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_outbox').get().count).toBe(1);
    const provenancePayload = JSON.parse(fixture.db.prepare(`
      SELECT payload_json FROM editor_recovery_provenance
    `).get().payload_json);
    expect(provenancePayload.scope.canonical_content_hash).toBe(hash('fn parse_header() {}\n'));
    const outboxPayload = JSON.parse(fixture.db.prepare(`
      SELECT payload_json FROM editor_recovery_provenance_outbox
    `).get().payload_json);
    expect(outboxPayload.scope.canonical_content_hash).toBe(provenancePayload.scope.canonical_content_hash);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_publications').get().count).toBe(0);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_attempts').get().count).toBe(0);
    expect(fixture.provenanceDrainScheduler.startupCount).toBe(0);
    expect(fixture.provenanceDrainScheduler.periodicCount).toBe(0);
    expect(fixture.editorRecovery.getProvenanceDrainStatus()).toEqual(expect.objectContaining({
      publisher_available: false,
      scheduled: false,
    }));
    expect(() => fixture.db.prepare('UPDATE editor_recovery_provenance SET payload_json = ?').run('{}')).toThrow(/append-only/);
    expect(() => fixture.db.prepare('DELETE FROM editor_recovery_provenance').run()).toThrow(/append-only/);
    expect(() => fixture.db.prepare('UPDATE editor_recovery_provenance_outbox SET payload_json = ?').run('{}')).toThrow(/append-only/);
    expect(() => fixture.db.prepare('DELETE FROM editor_recovery_provenance_outbox').run()).toThrow(/append-only/);
    expect(fixture.sessions.get(fixture.successorSessionId).notes.filter(note => note.type === 'editor-recovery')).toHaveLength(0);

    const second = await fixture.finalize(token, preparationId);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('EDITOR_RECOVERY_ALREADY_FINALIZED');
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance').get().count).toBe(1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_outbox').get().count).toBe(1);
    await fixture.close();
  });

  it('leaves every finalization effect untouched when canonical replay fails', async () => {
    const fixture = createFixture({ rejectReplay: true });
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    const replayed = await fixture.replay(preparationId);
    expect(replayed.statusCode).toBe(422);
    expect(replayed.json().code).toBe('CANONICAL_LORO_REPLAY_REJECTED');
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_replay_validation_receipts').get().count).toBe(0);

    const finalized = await fixture.finalize(token, preparationId);
    expect(finalized.statusCode).toBe(409);
    expect(finalized.json().code).toBe('EDITOR_REPLAY_RECEIPT_REQUIRED');
    expect(fixture.db.prepare('SELECT consumed_at FROM editor_recovery_tokens WHERE token = ?').get(token).consumed_at).toBeNull();
    expect(fixture.transferredClaims).toHaveLength(0);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance').get().count).toBe(0);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_outbox').get().count).toBe(0);
    await fixture.close();
  });

  it('keeps a committed preparation successful when symbol-lease cleanup throws', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    fixture.failNextSymbolRelease();

    const prepared = await fixture.prepare(token);
    expect(prepared.statusCode).toBe(200);
    expect(prepared.json().cleanup_diagnostics).toEqual([
      expect.objectContaining({
        phase: 'prepare_symbol_release',
        error: 'injected symbol lease release failure',
      }),
    ]);
    const preparationId = prepared.json().preparation_id;
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_preparations').get().count).toBe(1);
    const retried = await fixture.prepare(token);
    expect(retried.statusCode).toBe(200);
    expect(retried.json().preparation_id).toBe(preparationId);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_preparations').get().count).toBe(1);
    await fixture.close();
  });

  it('keeps a committed finalization successful when mutation-lease cleanup throws and retry creates no duplicate', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    expect((await fixture.replay(preparationId)).statusCode).toBe(200);
    fixture.failNextFileMutationRelease();

    const finalized = await fixture.finalize(token, preparationId);
    expect(finalized.statusCode).toBe(200);
    expect(finalized.json().cleanup_diagnostics).toEqual([
      expect.objectContaining({
        phase: 'finalize_mutation_release',
        error: 'injected file mutation lease release failure',
      }),
    ]);
    expect(fixture.transferredClaims).toHaveLength(1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance').get().count).toBe(1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_outbox').get().count).toBe(1);
    expect((await fixture.finalize(token, preparationId)).statusCode).toBe(409);
    expect(fixture.transferredClaims).toHaveLength(1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance').get().count).toBe(1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_outbox').get().count).toBe(1);
    await fixture.close();
  });

  it('rejects a replay receipt whose terminal state differs from the sealed abandonment', async () => {
    const fixture = createFixture({ replayFinalStateMismatch: true });
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    const replayed = await fixture.replay(preparationId);
    expect(replayed.statusCode).toBe(422);
    expect(replayed.json().code).toBe('CANONICAL_LORO_REPLAY_REJECTED');
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_replay_validation_receipts').get().count).toBe(0);
    expect(fixture.db.prepare('SELECT consumed_at FROM editor_recovery_tokens WHERE token = ?').get(token).consumed_at).toBeNull();
    await fixture.close();
  });

  it('makes operation, abandonment, and replay receipts append-only in SQLite', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    expect(() => fixture.db.prepare('UPDATE editor_operation_receipts SET validator_receipt = ?').run('tampered')).toThrow(/append-only/);
    expect(() => fixture.db.prepare('DELETE FROM editor_operation_receipts').run()).toThrow(/append-only/);
    expect(() => fixture.db.prepare('UPDATE editor_abandonment_receipts SET validator_receipt = ?').run('tampered')).toThrow(/append-only/);
    expect(() => fixture.db.prepare('DELETE FROM editor_abandonment_receipts').run()).toThrow(/append-only/);

    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    expect((await fixture.replay(preparationId)).statusCode).toBe(200);
    expect(() => fixture.db.prepare('UPDATE editor_replay_validation_receipts SET validator_receipt = ?').run('tampered')).toThrow(/append-only/);
    expect(() => fixture.db.prepare('DELETE FROM editor_replay_validation_receipts').run()).toThrow(/append-only/);
    await fixture.close();
  });

  it('fully revalidates an existing abandonment receipt before idempotent seal success', async () => {
    const fixture = createFixture();
    const sealed = await fixture.recordAndAbandon();
    const retry = await fixture.editorRecovery.sealAbandonment({
      sessionId: fixture.deadSessionId,
      filePath: fixture.filePath,
    });
    expect(retry).toEqual(sealed);

    fixture.db.exec('DROP TRIGGER editor_abandonment_receipts_no_update');
    fixture.db.prepare('UPDATE editor_abandonment_receipts SET operation_digest = ?')
      .run(hash('tampered-idempotent-seal'));
    const stale = await fixture.editorRecovery.sealAbandonment({
      sessionId: fixture.deadSessionId,
      filePath: fixture.filePath,
    });
    expect(stale).toEqual(expect.objectContaining({
      success: false,
      code: 'EDITOR_OPERATION_LEDGER_INVALID',
    }));
    await fixture.close();
  });

  it.each([
    ['zero start line', claim => ({ ...claim, startLine: 0 })],
    ['reversed range', claim => ({ ...claim, startLine: 2, endLine: 1 })],
    ['unsafe claimed timestamp', claim => ({ ...claim, claimedAt: Number.MAX_SAFE_INTEGER + 1 })],
    ['negative released timestamp', claim => ({ ...claim, releasedAt: -1 })],
    ['empty canonical inode', claim => ({ ...claim, canonicalInode: '' })],
    ['blank canonical device', claim => ({ ...claim, canonicalDevice: '   ' })],
  ])('rejects corrupt sealed claim JSON on idempotent seal: %s', async (_label, mutateClaim) => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    fixture.db.exec('DROP TRIGGER editor_abandonment_receipts_no_update');
    const row = fixture.db.prepare('SELECT id, claim_json FROM editor_abandonment_receipts').get();
    const claim = mutateClaim(JSON.parse(row.claim_json));
    fixture.db.prepare('UPDATE editor_abandonment_receipts SET claim_json = ? WHERE id = ?')
      .run(JSON.stringify(claim), row.id);
    const result = await fixture.editorRecovery.sealAbandonment({
      sessionId: fixture.deadSessionId,
      filePath: fixture.filePath,
    });
    expect(result).toEqual(expect.objectContaining({
      success: false,
      code: 'EDITOR_RECOVERY_CLAIM_STALE',
    }));
    await fixture.close();
  });

  it.each([
    ['missing operation tail', 'editor_operation_receipts_no_delete',
      'DELETE FROM editor_operation_receipts WHERE sequence = 1', 'EDITOR_OPERATION_LEDGER_INVALID'],
    ['corrupt operation tail', 'editor_operation_receipts_no_update',
      "UPDATE editor_operation_receipts SET operation_bytes = X'00' WHERE sequence = 1", 'EDITOR_OPERATION_LEDGER_INVALID'],
    ['stale replay receipt', 'editor_replay_validation_receipts_no_update',
      `UPDATE editor_replay_validation_receipts SET operation_digest = '${hash('stale-replay')}'`, 'EDITOR_REPLAY_RECEIPT_STALE'],
  ])('rejects %s after replay even if a privileged tamper bypasses the DB trigger', async (_label, trigger, mutation, code) => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    expect((await fixture.replay(preparationId)).statusCode).toBe(200);

    fixture.db.exec(`DROP TRIGGER ${trigger}`);
    fixture.db.exec(mutation);
    const finalized = await fixture.finalize(token, preparationId);
    expect(finalized.statusCode).toBe(409);
    expect(finalized.json().code).toBe(code);
    expect(fixture.db.prepare('SELECT consumed_at FROM editor_recovery_tokens WHERE token = ?').get(token).consumed_at).toBeNull();
    expect(fixture.transferredClaims).toHaveLength(0);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance').get().count).toBe(0);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_outbox').get().count).toBe(0);
    await fixture.close();
  });

  it('atomically rotates an expired unconsumed editor token with only one live generation', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const first = await fixture.requestEditor();
    expect(first.statusCode).toBe(201);
    const firstToken = first.json().token;
    fixture.advanceClock(15 * 60 * 1_000 + 1);
    const second = await fixture.requestEditor();
    expect(second.statusCode).toBe(201);
    const secondToken = second.json().token;
    expect(secondToken).not.toBe(firstToken);
    expect(fixture.db.prepare(`
      SELECT COUNT(*) AS count FROM editor_recovery_tokens
      WHERE consumed_at IS NULL AND superseded_at IS NULL
    `).get().count).toBe(1);
    expect(fixture.db.prepare('SELECT superseded_at FROM editor_recovery_tokens WHERE token = ?').get(firstToken).superseded_at).not.toBeNull();
    expect((await fixture.prepare(firstToken)).statusCode).toBe(410);
    expect((await fixture.prepare(secondToken)).statusCode).toBe(200);
    await fixture.close();
  });

  it('coalesces simultaneous recovery requests onto one live token generation', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const responses = await Promise.all([fixture.requestEditor(), fixture.requestEditor()]);
    expect(responses.map(response => response.statusCode)).toEqual([201, 201]);
    expect(new Set(responses.map(response => response.json().token))).toHaveProperty('size', 1);
    expect(fixture.db.prepare(`
      SELECT COUNT(*) AS count FROM editor_recovery_tokens
      WHERE consumed_at IS NULL AND superseded_at IS NULL
    `).get().count).toBe(1);
    await fixture.close();
  });

  it('finalizes simultaneous retries exactly once after canonical replay', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    expect((await fixture.replay(preparationId)).statusCode).toBe(200);
    const responses = await Promise.all([
      fixture.finalize(token, preparationId),
      fixture.finalize(token, preparationId),
    ]);
    expect(responses.map(response => response.statusCode).sort()).toEqual([200, 409]);
    expect(fixture.transferredClaims).toHaveLength(1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance').get().count).toBe(1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_outbox').get().count).toBe(1);
    expect(fixture.db.prepare('SELECT consumed_at FROM editor_recovery_tokens WHERE token = ?').get(token).consumed_at).not.toBeNull();
    await fixture.close();
  });

  it('rolls back claim, token, preparation, provenance, and outbox after a real post-provenance failure', async () => {
    const sinkCalls = [];
    const fixture = createFixture({
      provenancePublisher: {
        publish(input) {
          sinkCalls.push(input);
          return { success: true, publicationId: 'must-not-publish' };
        },
      },
    });
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    expect((await fixture.replay(preparationId)).statusCode).toBe(200);
    fixture.db.exec(`
      CREATE TRIGGER editor_recovery_injected_finalize_failure
      BEFORE UPDATE OF finalized_at ON editor_recovery_preparations
      BEGIN SELECT RAISE(ABORT, 'injected failure after provenance insertion'); END;
    `);
    const finalized = await fixture.finalize(token, preparationId);
    expect(finalized.statusCode).toBe(500);
    expect(fixture.transferredClaims).toHaveLength(0);
    expect(fixture.db.prepare('SELECT * FROM editor_claim_transfer_callback_probe').all()).toHaveLength(0);
    expect(fixture.db.prepare('SELECT consumed_at FROM editor_recovery_tokens WHERE token = ?').get(token).consumed_at).toBeNull();
    expect(fixture.db.prepare('SELECT finalized_at, provenance_record_id FROM editor_recovery_preparations WHERE id = ?').get(preparationId)).toEqual(expect.objectContaining({
      finalized_at: null,
      provenance_record_id: null,
    }));
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance').get().count).toBe(0);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_outbox').get().count).toBe(0);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_publications').get().count).toBe(0);
    expect(sinkCalls).toHaveLength(0);
    await fixture.close();
  });

  it('retains root and file descriptors through finalization and rolls back every effect on a last-moment replacement', async () => {
    const sinkCalls = [];
    const fixture = createFixture({
      provenancePublisher: {
        publish(input) {
          sinkCalls.push(input);
          return { success: true, publicationId: 'must-not-publish' };
        },
      },
    });
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    expect((await fixture.replay(preparationId)).statusCode).toBe(200);
    const displacedFile = `${fixture.filePath}.retained-fd-original`;
    fixture.setFinalizationMutationHook(() => {
      fixture.setFinalizationMutationHook(null);
      renameSync(fixture.filePath, displacedFile);
      writeFileSync(fixture.filePath, 'fn parse_header() {}\n');
    });

    const finalized = await fixture.finalize(token, preparationId);
    expect(finalized.statusCode).toBe(409);
    expect(finalized.json().code).toBe('EDITOR_RECOVERY_FILE_IDENTITY_DRIFT');
    rmSync(fixture.filePath, { force: true });
    renameSync(displacedFile, fixture.filePath);
    expect(fixture.transferredClaims).toHaveLength(0);
    expect(fixture.db.prepare('SELECT consumed_at FROM editor_recovery_tokens WHERE token = ?').get(token).consumed_at).toBeNull();
    expect(fixture.db.prepare('SELECT finalized_at, provenance_record_id FROM editor_recovery_preparations WHERE id = ?').get(preparationId)).toEqual(expect.objectContaining({
      finalized_at: null,
      provenance_record_id: null,
    }));
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance').get().count).toBe(0);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_outbox').get().count).toBe(0);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_publications').get().count).toBe(0);
    expect(fixture.mutationLeaseConsumptions).toHaveLength(0);
    expect(fixture.activeSymbolLease).toBeNull();
    expect(fixture.activeFileMutationLease).toBeNull();
    expect(sinkCalls).toHaveLength(0);
    await fixture.close();
  });

  it('holds the daemon mutation generation after the final descriptor check and blocks an authorized writer through commit', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    expect((await fixture.replay(preparationId)).statusCode).toBe(200);
    let mutationAccepted = null;
    fixture.setAfterFinalDescriptorCheckHook(() => {
      mutationAccepted = fixture.attemptAuthorizedMutation(() => {
        writeFileSync(fixture.filePath, 'fn invalidated_after_check() {}\n');
      });
    });

    const finalized = await fixture.finalize(token, preparationId);
    expect(finalized.statusCode).toBe(200);
    expect(mutationAccepted).toBe(false);
    expect(fixture.deniedAuthorizedMutations).toBe(1);
    expect(readFileSync(fixture.filePath, 'utf8')).toBe('fn parse_header() {}\n');
    expect(fixture.mutationLeaseConsumptions).toHaveLength(1);
    expect(fixture.activeSymbolLease).toBeNull();
    expect(fixture.activeFileMutationLease).toBeNull();
    await fixture.close();
  });

  it('seals the pre-commit inode into the successor tuple when an uncooperative process replaces the path after the final descriptor check', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    expect((await fixture.replay(preparationId)).statusCode).toBe(200);
    const originalInode = String(lstatSync(fixture.filePath, { bigint: true }).ino);
    fixture.setAfterFinalDescriptorCheckHook(() => {
      renameSync(fixture.filePath, `${fixture.filePath}.external-original`);
      writeFileSync(fixture.filePath, 'fn parse_header() {}\n');
    });

    const finalized = await fixture.finalize(token, preparationId);
    expect(finalized.statusCode).toBe(200);
    const replacementInode = String(lstatSync(fixture.filePath, { bigint: true }).ino);
    expect(replacementInode).not.toBe(originalInode);
    expect(fixture.transferredClaims).toEqual([
      expect.objectContaining({ canonicalInode: originalInode }),
    ]);
    expect(fixture.mutationLeaseConsumptions[0]).toEqual(expect.objectContaining({
      input_json: expect.stringContaining(`\"canonicalInode\":\"${originalInode}\"`),
    }));
    await fixture.close();
  });

  it('reconstructs the current schema on the same DB and startup-drains a pre-publish crash without overlapping the periodic drain', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    expect((await fixture.replay(preparationId)).statusCode).toBe(200);
    const finalized = await fixture.finalize(token, preparationId);
    expect(finalized.statusCode).toBe(200);
    expect(finalized.json().provenance_outbox.status).toBe('pending');

    const scheduler = createManualProvenanceDrainScheduler();
    const observedKeys = [];
    let markPublishStarted;
    let releasePublish;
    const publishStarted = new Promise(resolve => { markPublishStarted = resolve; });
    const publishWait = new Promise(resolve => { releasePublish = resolve; });
    const restarted = fixture.createRecoveryWith({
      provenancePublisher: {
        async publish(input) {
          observedKeys.push(input.idempotencyKey);
          markPublishStarted();
          await publishWait;
          return { success: true, publicationId: `sink:${input.idempotencyKey}` };
        },
      },
      provenanceDrainScheduler: scheduler,
      provenanceDrainBatchSize: 1,
      provenanceDrainIntervalMs: 1_000,
    });
    expect(fixture.db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'editor_replica_recovery'
    `).get()).toBeUndefined();
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_outbox').get().count).toBe(1);
    expect(scheduler.startupCount).toBe(1);
    expect(scheduler.periodicCount).toBe(1);
    expect(restarted.getProvenanceDrainStatus()).toEqual(expect.objectContaining({
      scheduled: true,
      batch_size: 1,
      interval_ms: 1_000,
    }));
    const startupDrain = scheduler.runStartup();
    await publishStarted;
    const overlappingPeriodicDrain = scheduler.runPeriodic();
    releasePublish();
    await Promise.all([startupDrain, overlappingPeriodicDrain]);

    expect(observedKeys).toHaveLength(1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_publications').get().count).toBe(1);
    await restarted.dispose();
    expect(scheduler.disposedCount).toBe(1);
    await fixture.close();
  });

  it('periodically drains a committed row created after same-DB service reconstruction', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    expect((await fixture.replay(preparationId)).statusCode).toBe(200);
    const scheduler = createManualProvenanceDrainScheduler();
    const observedKeys = [];
    const restarted = fixture.createRecoveryWith({
      provenancePublisher: {
        publish(input) {
          observedKeys.push(input.idempotencyKey);
          return { success: true, publicationId: `sink:${input.idempotencyKey}` };
        },
      },
      provenanceDrainScheduler: scheduler,
    });
    await scheduler.runStartup();
    expect(observedKeys).toHaveLength(0);

    const finalized = await fixture.finalize(token, preparationId);
    expect(finalized.statusCode).toBe(200);
    expect(finalized.json().provenance_outbox.status).toBe('pending');
    await scheduler.runPeriodic();
    expect(observedKeys).toHaveLength(1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_publications').get().count).toBe(1);
    expect((await restarted.publishPendingProvenance()).attempted).toBe(0);
    await fixture.close();
  });

  it('reconstructs after a post-sink crash with one idempotency key, one sink record, and one publication receipt', async () => {
    const sinkByKey = new Map();
    const observedKeys = [];
    let crashAfterSinkWrite = true;
    const provenancePublisher = {
      publish(input) {
        observedKeys.push(input.idempotencyKey);
        const publicationId = sinkByKey.get(input.idempotencyKey) ?? `sink:${input.idempotencyKey}`;
        sinkByKey.set(input.idempotencyKey, publicationId);
        if (crashAfterSinkWrite) {
          crashAfterSinkWrite = false;
          throw new Error('injected crash after idempotent sink write');
        }
        return { success: true, publicationId };
      },
    };
    const fixture = createFixture({
      provenancePublisher,
    });
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    expect((await fixture.replay(preparationId)).statusCode).toBe(200);

    const finalized = await fixture.finalize(token, preparationId);
    expect(finalized.statusCode).toBe(200);
    expect(finalized.json().provenance_outbox).toEqual(expect.objectContaining({
      status: 'pending',
      reason: 'injected crash after idempotent sink write',
    }));
    expect(sinkByKey).toHaveProperty('size', 1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_publications').get().count).toBe(0);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_attempts').get().count).toBe(1);

    await fixture.editorRecovery.dispose();
    const scheduler = createManualProvenanceDrainScheduler();
    const restarted = fixture.createRecoveryWith({
      provenancePublisher,
      provenanceDrainScheduler: scheduler,
    });
    expect(scheduler.startupCount).toBe(1);
    await scheduler.runStartup();
    const quiescent = await restarted.publishPendingProvenance();
    expect(quiescent).toEqual(expect.objectContaining({ attempted: 0, published: 0, pending: 0 }));
    expect(new Set(observedKeys)).toHaveProperty('size', 1);
    expect(observedKeys).toHaveLength(2);
    expect(sinkByKey).toHaveProperty('size', 1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_publications').get().count).toBe(1);
    expect(() => fixture.db.prepare('UPDATE editor_recovery_provenance_publications SET publication_id = ?').run('tampered')).toThrow(/append-only/);
    expect(() => fixture.db.prepare('DELETE FROM editor_recovery_provenance_publications').run()).toThrow(/append-only/);
    await fixture.close();
  });

  it('keeps canonical finalize successful when sink success precedes local receipt failure, then restart converges on the same key', async () => {
    const sinkByKey = new Map();
    const observedKeys = [];
    const provenancePublisher = {
      publish(input) {
        observedKeys.push(input.idempotencyKey);
        const publicationId = sinkByKey.get(input.idempotencyKey) ?? `sink:${input.idempotencyKey}`;
        sinkByKey.set(input.idempotencyKey, publicationId);
        return { success: true, publicationId };
      },
    };
    let failReceiptPersistence = true;
    const fixture = createFixture({
      provenancePublisher,
      provenancePublicationReceiptPersistenceHook() {
        if (!failReceiptPersistence) return;
        failReceiptPersistence = false;
        throw new Error('injected local publication receipt persistence failure');
      },
    });
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    expect((await fixture.replay(preparationId)).statusCode).toBe(200);

    const finalized = await fixture.finalize(token, preparationId);
    expect(finalized.statusCode).toBe(200);
    expect(finalized.json().provenance_outbox).toEqual(expect.objectContaining({
      id: expect.any(Number),
      status: 'pending',
      reason: expect.stringContaining('local publication receipt persistence failed'),
      sink_publication_id: expect.stringMatching(/^sink:harbor\.editor\.recovery\.provenance:/),
    }));
    expect(fixture.transferredClaims).toHaveLength(1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance').get().count).toBe(1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_outbox').get().count).toBe(1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_publications').get().count).toBe(0);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_attempts').get().count).toBe(1);
    expect(fixture.db.prepare('SELECT consumed_at FROM editor_recovery_tokens WHERE token = ?').get(token).consumed_at).not.toBeNull();

    await fixture.editorRecovery.dispose();
    const scheduler = createManualProvenanceDrainScheduler();
    const restarted = fixture.createRecoveryWith({
      provenancePublisher,
      provenanceDrainScheduler: scheduler,
      provenancePublicationReceiptPersistenceHook: null,
    });
    await scheduler.runStartup();
    expect(new Set(observedKeys)).toHaveProperty('size', 1);
    expect(observedKeys).toHaveLength(2);
    expect(sinkByKey).toHaveProperty('size', 1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_publications').get().count).toBe(1);
    expect((await restarted.publishPendingProvenance()).attempted).toBe(0);
    await fixture.close();
  });

  it('keeps canonical finalize successful when sink failure attempt evidence cannot be appended', async () => {
    const fixture = createFixture({
      provenancePublisher: {
        publish() {
          return { success: false, error: 'injected sink rejection' };
        },
      },
      provenanceAttemptPersistenceHook() {
        throw new Error('injected provenance attempt persistence failure');
      },
    });
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    expect((await fixture.replay(preparationId)).statusCode).toBe(200);

    const finalized = await fixture.finalize(token, preparationId);
    expect(finalized.statusCode).toBe(200);
    expect(finalized.json().provenance_outbox).toEqual(expect.objectContaining({
      id: expect.any(Number),
      status: 'pending',
      reason: expect.stringContaining('append-only attempt evidence persistence failed'),
    }));
    expect(fixture.transferredClaims).toHaveLength(1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance').get().count).toBe(1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_outbox').get().count).toBe(1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_publications').get().count).toBe(0);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_attempts').get().count).toBe(0);
    await fixture.close();
  });

  it('revalidates token expiry after canonical Rust validation and before replay receipt insertion', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    fixture.setReplayValidationHook(() => fixture.advanceClock(15 * 60 * 1_000 + 1));
    const replayed = await fixture.replay(preparationId);
    expect(replayed.statusCode).toBe(410);
    expect(replayed.json().code).toBe('EDITOR_RECOVERY_TOKEN_EXPIRED');
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_replay_validation_receipts').get().count).toBe(0);
    await fixture.close();
  });

  it('revalidates token rotation after canonical Rust validation and before replay receipt insertion', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    fixture.setReplayValidationHook(() => {
      fixture.db.prepare('UPDATE editor_recovery_tokens SET superseded_at = ? WHERE token = ?').run(1, token);
    });
    const replayed = await fixture.replay(preparationId);
    expect(replayed.statusCode).toBe(410);
    expect(replayed.json().code).toBe('EDITOR_RECOVERY_TOKEN_EXPIRED');
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_replay_validation_receipts').get().count).toBe(0);
    await fixture.close();
  });

  it('revalidates preparation ownership after canonical Rust validation and before replay receipt insertion', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    fixture.setReplayValidationHook(() => {
      fixture.db.prepare('UPDATE editor_recovery_preparations SET successor_session_id = ? WHERE id = ?')
        .run(fixture.requesterSessionId, preparationId);
    });
    const replayed = await fixture.replay(preparationId);
    expect(replayed.statusCode).toBe(403);
    expect(replayed.json().code).toBe('EDITOR_REPLAY_PREPARATION_ACTOR_MISMATCH');
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_replay_validation_receipts').get().count).toBe(0);
    await fixture.close();
  });

  it('revalidates successor session status after canonical Rust validation and before replay receipt insertion', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    fixture.setReplayValidationHook(() => {
      expect(fixture.sessions.abandon(fixture.successorSessionId).success).toBe(true);
    });
    const replayed = await fixture.replay(preparationId);
    expect(replayed.statusCode).toBe(409);
    expect(replayed.json().code).toBe('EDITOR_SESSION_NOT_ACTIVE');
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_replay_validation_receipts').get().count).toBe(0);
    await fixture.close();
  });

  it('revalidates salvage capability after canonical Rust validation and before replay receipt insertion', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    fixture.setReplayValidationHook(() => fixture.capableActors.delete(fixture.successorActor.actorId));
    const replayed = await fixture.replay(preparationId);
    expect(replayed.statusCode).toBe(403);
    expect(replayed.json().code).toBe('EDITOR_SALVAGE_CAPABILITY_REQUIRED');
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_replay_validation_receipts').get().count).toBe(0);
    await fixture.close();
  });

  it('revalidates descriptor-bound file bytes after canonical Rust validation and before replay receipt insertion', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    fixture.setReplayValidationHook(() => writeFileSync(fixture.filePath, 'fn parse_header_changed_after_rust() {}\n'));
    const replayed = await fixture.replay(preparationId);
    expect(replayed.statusCode).toBe(409);
    expect(replayed.json().code).toBe('EDITOR_RECOVERY_FILE_DRIFT');
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_replay_validation_receipts').get().count).toBe(0);
    await fixture.close();
  });

  it('returns one verified winner when a replay receipt wins the unique race before insertion', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    fixture.setReplayReceiptPersistenceHook(() => {
      fixture.setReplayReceiptPersistenceHook(null);
      const abandonment = fixture.db.prepare(`
        SELECT abandonment.* FROM editor_abandonment_receipts abandonment
        JOIN editor_recovery_preparations preparation ON preparation.abandonment_id = abandonment.id
        WHERE preparation.id = ?
      `).get(preparationId);
      fixture.db.prepare(`
        INSERT INTO editor_replay_validation_receipts (
          preparation_id, validator_id, validator_receipt, operation_digest,
          final_state_hash, high_water_sequence, operation_count, validated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        preparationId,
        'TEST_CONCURRENT_RUST_WINNER',
        'test-concurrent-receipt',
        abandonment.operation_digest,
        abandonment.final_state_hash,
        abandonment.high_water_sequence,
        abandonment.operation_count,
        1,
      );
    });
    const replayed = await fixture.replay(preparationId);
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json().replay_validation.validator_id).toBe('TEST_CONCURRENT_RUST_WINNER');
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_replay_validation_receipts').get().count).toBe(1);
    expect((await fixture.replay(preparationId)).statusCode).toBe(200);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_replay_validation_receipts').get().count).toBe(1);
    await fixture.close();
  });

  it('revalidates token rotation inside the post-await prepare transaction', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const gate = fixture.deferNextSymbolResolution();
    const pending = fixture.editorRecovery.prepareForReplay({
      token,
      successorSessionId: fixture.successorSessionId,
      preparedByActorId: fixture.successorActor.actorId,
    });
    await gate.started;
    fixture.advanceClock(15 * 60 * 1_000 + 1);
    const rotated = await fixture.requestEditor();
    expect(rotated.statusCode).toBe(201);
    expect(rotated.json().token).not.toBe(token);
    gate.release();
    await expect(pending).resolves.toEqual(expect.objectContaining({
      success: false,
      code: 'EDITOR_RECOVERY_TOKEN_EXPIRED',
    }));
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_preparations').get().count).toBe(0);
    await fixture.close();
  });

  it('revalidates salvage capability inside the post-await prepare transaction', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const gate = fixture.deferNextSymbolResolution();
    const pending = fixture.editorRecovery.prepareForReplay({
      token,
      successorSessionId: fixture.successorSessionId,
      preparedByActorId: fixture.successorActor.actorId,
    });
    await gate.started;
    fixture.capableActors.delete(fixture.successorActor.actorId);
    gate.release();
    await expect(pending).resolves.toEqual(expect.objectContaining({
      success: false,
      code: 'EDITOR_SALVAGE_CAPABILITY_REQUIRED',
    }));
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_preparations').get().count).toBe(0);
    await fixture.close();
  });

  it('revalidates canonical file identity inside the post-await prepare transaction', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const gate = fixture.deferNextSymbolResolution();
    const pending = fixture.editorRecovery.prepareForReplay({
      token,
      successorSessionId: fixture.successorSessionId,
      preparedByActorId: fixture.successorActor.actorId,
    });
    await gate.started;
    writeFileSync(fixture.filePath, 'fn parse_header_drifted() {}\n');
    gate.release();
    await expect(pending).resolves.toEqual(expect.objectContaining({
      success: false,
      code: 'EDITOR_RECOVERY_FILE_DRIFT',
    }));
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_preparations').get().count).toBe(0);
    await fixture.close();
  });

  it('revalidates successor status inside the post-await finalize transaction', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    expect((await fixture.replay(preparationId)).statusCode).toBe(200);
    const gate = fixture.deferNextSymbolResolution();
    const pending = fixture.editorRecovery.finalizeRecovery({
      token,
      preparationId,
      successorSessionId: fixture.successorSessionId,
      finalizedByActorId: fixture.successorActor.actorId,
    });
    await gate.started;
    expect(fixture.sessions.abandon(fixture.successorSessionId).success).toBe(true);
    gate.release();
    await expect(pending).resolves.toEqual(expect.objectContaining({
      success: false,
      code: 'EDITOR_SESSION_NOT_ACTIVE',
    }));
    expect(fixture.transferredClaims).toHaveLength(0);
    expect(fixture.db.prepare('SELECT consumed_at FROM editor_recovery_tokens WHERE token = ?').get(token).consumed_at).toBeNull();
    await fixture.close();
  });

  it('revalidates scope and worktree identity inside the post-await finalize transaction', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    expect((await fixture.replay(preparationId)).statusCode).toBe(200);
    const gate = fixture.deferNextSymbolResolution();
    const pending = fixture.editorRecovery.finalizeRecovery({
      token,
      preparationId,
      successorSessionId: fixture.successorSessionId,
      finalizedByActorId: fixture.successorActor.actorId,
    });
    await gate.started;
    Object.assign(fixture.scopeRecords.get(fixture.successorSessionId), {
      project: 'project-b',
      worktreeId: 'worktree-b',
      worktreeRoot: join(fixture.worktreeRoot, 'src', '..'),
    });
    gate.release();
    await expect(pending).resolves.toEqual(expect.objectContaining({
      success: false,
      code: 'EDITOR_RECOVERY_SCOPE_MISMATCH',
    }));
    expect(fixture.transferredClaims).toHaveLength(0);
    expect(fixture.db.prepare('SELECT consumed_at FROM editor_recovery_tokens WHERE token = ?').get(token).consumed_at).toBeNull();
    await fixture.close();
  });

  it('revalidates sealed operation evidence inside the post-await finalize transaction', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    expect((await fixture.replay(preparationId)).statusCode).toBe(200);
    const gate = fixture.deferNextSymbolResolution();
    const pending = fixture.editorRecovery.finalizeRecovery({
      token,
      preparationId,
      successorSessionId: fixture.successorSessionId,
      finalizedByActorId: fixture.successorActor.actorId,
    });
    await gate.started;
    fixture.db.exec('DROP TRIGGER editor_operation_receipts_no_delete');
    fixture.db.prepare('DELETE FROM editor_operation_receipts WHERE sequence = 1').run();
    gate.release();
    await expect(pending).resolves.toEqual(expect.objectContaining({
      success: false,
      code: 'EDITOR_OPERATION_LEDGER_INVALID',
    }));
    expect(fixture.transferredClaims).toHaveLength(0);
    expect(fixture.db.prepare('SELECT consumed_at FROM editor_recovery_tokens WHERE token = ?').get(token).consumed_at).toBeNull();
    await fixture.close();
  });

  it('fails closed when symbol authority generation drifts after resolution but before the finalization transaction', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    expect((await fixture.replay(preparationId)).statusCode).toBe(200);
    const gate = fixture.deferNextSymbolResolution();
    const pending = fixture.editorRecovery.finalizeRecovery({
      token,
      preparationId,
      successorSessionId: fixture.successorSessionId,
      finalizedByActorId: fixture.successorActor.actorId,
    });
    await gate.started;
    expect(fixture.advanceSymbolAuthorityGeneration()).toBe(true);
    gate.release();

    await expect(pending).resolves.toEqual(expect.objectContaining({
      success: false,
      code: 'EDITOR_SYMBOL_AUTHORITY_DRIFT',
    }));
    expect(fixture.transferredClaims).toHaveLength(0);
    expect(fixture.db.prepare('SELECT consumed_at FROM editor_recovery_tokens WHERE token = ?').get(token).consumed_at).toBeNull();
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance').get().count).toBe(0);
    expect(fixture.activeSymbolLease).toBeNull();
    expect(fixture.activeFileMutationLease).toBeNull();
    await fixture.close();
  });

  it('converts a rejected resolveFresh promise into an explicit fail-closed symbol authority result', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    fixture.rejectNextSymbolResolution();

    const prepared = await fixture.prepare(token);
    expect(prepared.statusCode).toBe(503);
    expect(prepared.json()).toEqual(expect.objectContaining({
      code: 'EDITOR_SYMBOL_AUTHORITY_UNAVAILABLE',
      error: 'injected symbol authority rejection',
    }));
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_preparations').get().count).toBe(0);
    await fixture.close();
  });

  it.each([
    ['scopeAuthority', 'EDITOR_SCOPE_AUTHORITY_UNAVAILABLE'],
    ['canonicalLoro', 'CANONICAL_LORO_AUTHORITY_UNAVAILABLE'],
    ['symbolAuthority', 'EDITOR_SYMBOL_AUTHORITY_UNAVAILABLE'],
    ['claimTransferAuthority', 'EDITOR_CLAIM_AUTHORITY_UNAVAILABLE'],
    ['fileMutationAuthority', 'EDITOR_FILE_MUTATION_AUTHORITY_UNAVAILABLE'],
  ])('preflights missing %s before every public phase and every public write', async (authority, code) => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const unavailable = fixture.createRecoveryWith({ [authority]: null });

    const deniedRequest = await unavailable.requestEvidence({
      deadSessionId: fixture.deadSessionId,
      requesterSessionId: fixture.requesterSessionId,
      filePath: fixture.filePath,
      requestedByActorId: fixture.requesterActor.actorId,
    });
    expect(deniedRequest).toEqual(expect.objectContaining({ success: false, httpStatus: 503, code }));
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_tokens').get().count).toBe(0);

    const issued = await fixture.editorRecovery.requestEvidence({
      deadSessionId: fixture.deadSessionId,
      requesterSessionId: fixture.requesterSessionId,
      filePath: fixture.filePath,
      requestedByActorId: fixture.requesterActor.actorId,
    });
    const token = issued.token;
    const deniedPrepare = await unavailable.prepareForReplay({
      token,
      successorSessionId: fixture.successorSessionId,
      preparedByActorId: fixture.successorActor.actorId,
    });
    expect(deniedPrepare).toEqual(expect.objectContaining({ success: false, httpStatus: 503, code }));
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_preparations').get().count).toBe(0);

    const prepared = await fixture.editorRecovery.prepareForReplay({
      token,
      successorSessionId: fixture.successorSessionId,
      preparedByActorId: fixture.successorActor.actorId,
    });
    const preparationId = prepared.preparation_id;
    const deniedReplay = await unavailable.validatePreparedReplay({
      preparationId,
      successorSessionId: fixture.successorSessionId,
      validatedByActorId: fixture.successorActor.actorId,
    });
    expect(deniedReplay).toEqual(expect.objectContaining({ success: false, httpStatus: 503, code }));
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_replay_validation_receipts').get().count).toBe(0);

    expect((await fixture.editorRecovery.validatePreparedReplay({
      preparationId,
      successorSessionId: fixture.successorSessionId,
      validatedByActorId: fixture.successorActor.actorId,
    })).success).toBe(true);
    const deniedFinalize = await unavailable.finalizeRecovery({
      token,
      preparationId,
      successorSessionId: fixture.successorSessionId,
      finalizedByActorId: fixture.successorActor.actorId,
    });
    expect(deniedFinalize).toEqual(expect.objectContaining({ success: false, httpStatus: 503, code }));
    expect(fixture.db.prepare('SELECT consumed_at FROM editor_recovery_tokens WHERE token = ?').get(token).consumed_at).toBeNull();
    expect(fixture.transferredClaims).toHaveLength(0);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance').get().count).toBe(0);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_provenance_outbox').get().count).toBe(0);
    await fixture.close();
  });

  it.each([
    ['project', { project: 'project-b' }],
    ['harbor', { harbor: 'harbor-b' }],
    ['worktree', { worktreeId: 'worktree-b' }],
  ])('rejects cross-%s canonical replay', async (_label, patch) => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    Object.assign(fixture.scopeRecords.get(fixture.successorSessionId), patch);
    const response = await fixture.replay(preparationId);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('EDITOR_RECOVERY_SCOPE_MISMATCH');
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_replay_validation_receipts').get().count).toBe(0);
    await fixture.close();
  });

  it('requires the explicit editor salvage capability', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    fixture.capableActors.delete(fixture.requesterActor.actorId);
    const response = await fixture.requestEditor();
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('EDITOR_SALVAGE_CAPABILITY_REQUIRED');
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_tokens').get().count).toBe(0);
    await fixture.close();
  });

  it('rejects traversal, outside-worktree paths, and symlink aliases', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const traversal = await fixture.requestEditor(undefined, {
      file_path: `${fixture.worktreeRoot}/src/../src/parser.rs`,
    });
    expect(traversal.statusCode).toBe(422);
    expect(traversal.json().code).toBe('EDITOR_RECOVERY_PATH_INVALID');

    const outside = `${fixture.worktreeRoot}-outside.rs`;
    writeFileSync(outside, 'outside\n');
    const outsideResponse = await fixture.requestEditor(undefined, { file_path: outside });
    expect(outsideResponse.statusCode).toBe(403);
    expect(outsideResponse.json().code).toBe('EDITOR_RECOVERY_PATH_OUTSIDE_WORKTREE');

    const alias = join(fixture.worktreeRoot, 'src', 'parser-alias.rs');
    symlinkSync(fixture.filePath, alias);
    const symlink = await fixture.requestEditor(undefined, { file_path: alias });
    expect(symlink.statusCode).toBe(422);
    expect(symlink.json().code).toBe('EDITOR_RECOVERY_SYMLINK_REJECTED');
    rmSync(outside, { force: true });
    await fixture.close();
  });

  it('rejects a noncanonical traversal alias for the authoritative worktree root', async () => {
    const fixture = createFixture();
    Object.assign(fixture.scopeRecords.get(fixture.deadSessionId), {
      worktreeRoot: `${fixture.worktreeRoot}/src/..`,
    });
    const result = await fixture.editorRecovery.recordOperationReceipt({
      sessionId: fixture.deadSessionId,
      filePath: fixture.filePath,
      sequence: 0,
      bytes: Buffer.from('noncanonical-root'),
    });
    expect(result).toEqual(expect.objectContaining({
      success: false,
      code: 'EDITOR_RECOVERY_PATH_INVALID',
    }));
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_operation_receipts').get().count).toBe(0);
    await fixture.close();
  });

  it.each([
    'worktreeRootDevice',
    'worktreeRootInode',
  ])('never downgrades a scope that omits its daemon-witnessed %s', async (field) => {
    const fixture = createFixture();
    fixture.scopeRecords.get(fixture.deadSessionId)[field] = '';
    const result = await fixture.editorRecovery.recordOperationReceipt({
      sessionId: fixture.deadSessionId,
      filePath: fixture.filePath,
      sequence: 0,
      bytes: Buffer.from('missing-root-witness'),
    });
    expect(result).toEqual(expect.objectContaining({
      success: false,
      code: 'EDITOR_RECOVERY_PATH_INVALID',
    }));
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_operation_receipts').get().count).toBe(0);
    await fixture.close();
  });

  it('persists the exact stable root device/inode witness for an adjacent valid descriptor-bound file', async () => {
    const fixture = createFixture();
    const expected = fixture.scopeRecords.get(fixture.deadSessionId);
    const result = await fixture.editorRecovery.recordOperationReceipt({
      sessionId: fixture.deadSessionId,
      filePath: fixture.filePath,
      sequence: 0,
      bytes: Buffer.from('stable-root-and-file'),
    });
    expect(result.success).toBe(true);
    const row = fixture.db.prepare(`
      SELECT worktree_root, worktree_root_device, worktree_root_inode,
             canonical_path, file_device, file_inode
      FROM editor_operation_receipts
    `).get();
    expect(row).toEqual(expect.objectContaining({
      worktree_root: fixture.worktreeRoot,
      worktree_root_device: expected.worktreeRootDevice,
      worktree_root_inode: expected.worktreeRootInode,
      canonical_path: fixture.filePath,
      file_device: expect.any(String),
      file_inode: expect.any(String),
    }));
    await fixture.close();
  });

  it('rejects an ordinary-directory worktree root rename/replacement after opening the root descriptor', async () => {
    const fixture = createFixture();
    let restoreRoot = null;
    fixture.setPathVerificationHook((phase) => {
      if (phase !== 'after-root-open' || restoreRoot) return;
      fixture.setPathVerificationHook(null);
      restoreRoot = fixture.replaceRootDuringVerification();
    });
    let result;
    try {
      result = await fixture.editorRecovery.recordOperationReceipt({
        sessionId: fixture.deadSessionId,
        filePath: fixture.filePath,
        sequence: 0,
        bytes: Buffer.from('root-replacement-race'),
      });
    } finally {
      restoreRoot?.();
    }
    expect(result).toEqual(expect.objectContaining({
      success: false,
      code: 'EDITOR_RECOVERY_ROOT_IDENTITY_DRIFT',
    }));
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_operation_receipts').get().count).toBe(0);
    await fixture.close();
  });

  it.each([
    ['after file descriptor open', 'after-file-open'],
    ['after bytes are read through the file descriptor', 'after-file-read'],
  ])('rejects same-content file rename/replacement %s', async (_label, phaseToReplace) => {
    const fixture = createFixture();
    const displacedFile = `${fixture.filePath}.${phaseToReplace}.original`;
    let replaced = false;
    fixture.setPathVerificationHook((phase) => {
      if (phase !== phaseToReplace || replaced) return;
      replaced = true;
      fixture.setPathVerificationHook(null);
      renameSync(fixture.filePath, displacedFile);
      writeFileSync(fixture.filePath, 'fn parse_header() {}\n');
    });
    let result;
    try {
      result = await fixture.editorRecovery.recordOperationReceipt({
        sessionId: fixture.deadSessionId,
        filePath: fixture.filePath,
        sequence: 0,
        bytes: Buffer.from(`file-replacement-${phaseToReplace}`),
      });
    } finally {
      if (replaced) {
        rmSync(fixture.filePath, { force: true });
        renameSync(displacedFile, fixture.filePath);
      }
    }
    expect(result).toEqual(expect.objectContaining({
      success: false,
      code: 'EDITOR_RECOVERY_FILE_IDENTITY_DRIFT',
    }));
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_operation_receipts').get().count).toBe(0);
    await fixture.close();
  });

  it('rejects a traversal alias in the released claim path before sealing authority', async () => {
    const fixture = createFixture();
    for (let sequence = 0; sequence < 2; sequence++) {
      expect((await fixture.editorRecovery.recordOperationReceipt({
        sessionId: fixture.deadSessionId,
        filePath: fixture.filePath,
        sequence,
        bytes: Buffer.from(`claim-alias-${sequence}`),
      })).success).toBe(true);
    }
    fixture.setClaimPath(fixture.deadSessionId, `${fixture.worktreeRoot}/src/../src/parser.rs`);
    expect(fixture.sessions.abandon(fixture.deadSessionId).success).toBe(true);
    const sealed = await fixture.editorRecovery.sealAbandonment({
      sessionId: fixture.deadSessionId,
      filePath: fixture.filePath,
    });
    expect(sealed).toEqual(expect.objectContaining({
      success: false,
      code: 'EDITOR_RECOVERY_CLAIM_PATH_INVALID',
    }));
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM editor_abandonment_receipts').get().count).toBe(0);
    await fixture.close();
  });

  it('requires exactly one released abandonment-tied symbol claim', async () => {
    const fixture = createFixture();
    expect(fixture.sessions.claimFiles(fixture.deadSessionId, [], {
      agentId: 'harbor-editor:dead',
      regions: [{
        path: fixture.filePath,
        startLine: 2,
        endLine: 2,
        symbol: 'parse_body',
        symbolPath: 'parse_body',
      }],
    }).success).toBe(true);
    for (let sequence = 0; sequence < 2; sequence++) {
      expect((await fixture.editorRecovery.recordOperationReceipt({
        sessionId: fixture.deadSessionId,
        filePath: fixture.filePath,
        sequence,
        bytes: Buffer.from(`operation-${sequence}`),
      })).success).toBe(true);
    }
    expect(fixture.sessions.abandon(fixture.deadSessionId).success).toBe(true);
    const sealed = await fixture.editorRecovery.sealAbandonment({
      sessionId: fixture.deadSessionId,
      filePath: fixture.filePath,
    });
    expect(sealed).toEqual(expect.objectContaining({
      success: false,
      code: 'EDITOR_RECOVERY_RELEASED_CLAIM_COUNT',
    }));
    await fixture.close();
  });

  it.each([
    ['deletion', []],
    ['ambiguity', [
      { symbolPath: 'parse_header', symbol: 'parse_header', startLine: 1, endLine: 1 },
      { symbolPath: 'parse_header', symbol: 'parse_header', startLine: 1, endLine: 1 },
    ]],
    ['drift', [{ symbolPath: 'parse_header', symbol: 'parse_header', startLine: 2, endLine: 2 }]],
  ])('rejects symbol %s before replay preparation', async (_label, symbols) => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    fixture.setSymbols(symbols);
    const response = await fixture.prepare(token);
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toMatch(/^EDITOR_RECOVERY_SYMBOL_/);
    await fixture.close();
  });

  it('re-resolves symbolPath at finalize and rejects post-replay drift without effects', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const token = (await fixture.requestEditor()).json().token;
    const preparationId = (await fixture.prepare(token)).json().preparation_id;
    expect((await fixture.replay(preparationId)).statusCode).toBe(200);
    fixture.setSymbols([{ symbolPath: 'parse_header', symbol: 'parse_header', startLine: 2, endLine: 2 }]);
    const response = await fixture.finalize(token, preparationId);
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('EDITOR_RECOVERY_SYMBOL_DRIFT');
    expect(fixture.db.prepare('SELECT consumed_at FROM editor_recovery_tokens WHERE token = ?').get(token).consumed_at).toBeNull();
    expect(fixture.transferredClaims).toHaveLength(0);
    await fixture.close();
  });

  it('domain-separates editor tokens from account recovery in both directions', async () => {
    const fixture = createFixture();
    await fixture.recordAndAbandon();
    const editorToken = (await fixture.requestEditor()).json().token;
    expect(editorToken).toMatch(/^edrec_/);
    const accountRecovery = createRecoveryMagicLink(fixture.db);
    accountRecovery.initRecoveryTokens();
    const accountToken = accountRecovery.issueToken('account-a').token;
    expect(accountToken).not.toMatch(/^edrec_/);

    const accountIntoEditor = await fixture.prepare(accountToken);
    expect(accountIntoEditor.statusCode).toBe(404);
    expect(accountIntoEditor.json().code).toBe('EDITOR_RECOVERY_TOKEN_INVALID');
    expect(accountRecovery.consumeToken(editorToken)).toBeNull();
    expect(accountRecovery.getToken(accountToken).consumed_at).toBeNull();
    expect(fixture.db.prepare('SELECT consumed_at FROM editor_recovery_tokens WHERE token = ?').get(editorToken).consumed_at).toBeNull();
    await fixture.close();
  });

  it('keeps account-recovery bodies out of the verified editor recovery boundary', async () => {
    const db = createTestDb();
    const sessions = createSessions(db);
    const souls = createTestActorSouls(db);
    const actor = mintTestActor(souls, 'harbor-editor:domain-check');
    const accountRecovery = createRecoveryMagicLink(db);
    accountRecovery.initRecoveryTokens();
    const app = Fastify();
    app.register(recoveryPlugin, { deps: { recovery: accountRecovery } });
    app.register(editorRecoveryPlugin, { deps: { db, sessions, actorSouls: souls } });

    const account = await app.inject({ method: 'POST', url: '/recovery/request', payload: { account_id: 'account-a' } });
    expect(account.statusCode).toBe(201);
    const anonymousEditor = await app.inject({ method: 'POST', url: '/editor/recovery/request', payload: { account_id: 'account-a' } });
    expect(anonymousEditor.statusCode).toBe(401);
    const verifiedEditor = await app.inject({
      method: 'POST',
      url: '/editor/recovery/request',
      headers: actor.headers,
      payload: { account_id: 'account-a' },
    });
    expect(verifiedEditor.statusCode).toBe(503);
    expect(db.prepare('SELECT COUNT(*) AS count FROM editor_recovery_tokens').get().count).toBe(0);
    expect(accountRecovery.consumeToken(account.json().token)).toEqual(expect.objectContaining({ account_id: 'account-a' }));
    await app.close();
    db.close();
  });

  it('states every unimplemented recovery gate and that registered 503 routes are not a usable pipeline', () => {
    const truthSurfaces = [
      readFileSync(join(process.cwd(), 'README.md'), 'utf8'),
      readFileSync(join(process.cwd(), 'docs', 'strategy', 'harbor-editor-battle-plan.md'), 'utf8'),
      readFileSync(join(process.cwd(), 'skills', 'build-coop-ide-gpui', 'SKILL.md'), 'utf8'),
      readFileSync(join(process.cwd(), 'skills', 'build-coop-ide-gpui', 'references', '03-collaboration-coordination-salvage.md'), 'utf8'),
      readFileSync(join(process.cwd(), 'skills', 'build-coop-ide-gpui', 'references', '04-build-order-and-composing-the-skills.md'), 'utf8'),
    ];
    for (const surface of truthSurfaces) {
      expect(surface).toContain('P1 Rust operation-receipt producer');
      expect(surface).toContain('P1B');
      expect(surface).toContain('canonical Rust Loro recovery');
      expect(surface).toContain('P3 same-database released-claim');
      expect(surface).toMatch(/not(?:\*\*)? (?:make )?a usable (?:Harbor )?recovery pipeline/);
      expect(surface).toContain('503');
    }
    const exactProvenanceContracts = [truthSurfaces[1], truthSurfaces[2], truthSurfaces[4]];
    for (const surface of exactProvenanceContracts) {
      expect(surface).toContain('scope.canonical_content_hash');
      expect(surface).toContain('local publication-receipt failure');
      expect(surface).toContain('canonical 200');
      expect(surface).toMatch(/stable (?:pending )?outbox ID/);
    }
  });

  it('documents editor recovery as a 503-only scaffold and publishes no SDK-style success contract', () => {
    const openapiText = readFileSync(join(process.cwd(), 'docs', 'openapi.yaml'), 'utf8');
    const openapi = parseYaml(openapiText);
    const paths = [
      '/editor/recovery/request',
      '/editor/recovery/prepare',
      '/editor/recovery/replay',
      '/editor/recovery/finalize',
    ];
    for (const path of paths) {
      const operation = openapi.paths[path].post;
      expect(operation.summary).toMatch(/^Unavailable scaffold/);
      expect(operation.responses['503']).toBeDefined();
      expect(operation.responses['200']).toBeUndefined();
      expect(operation.responses['201']).toBeUndefined();
      expect(operation.responses['202']).toBeUndefined();
    }

    const cliSource = readFileSync(join(process.cwd(), 'bin', 'port-daddy-cli.ts'), 'utf8');
    const mcpSource = readFileSync(join(process.cwd(), 'mcp', 'server.ts'), 'utf8');
    expect(cliSource).not.toMatch(/editor[-_ ]recovery/i);
    expect(mcpSource).not.toMatch(/editor[-_ ]recovery/i);
  });

  it('keeps P2 checkpoint reconstruction separate from unimplemented P3.5 recovery authority', () => {
    const currentState = readFileSync(join(process.cwd(), 'docs', 'strategy', 'harbor-editor-current-state.md'), 'utf8');
    const p1Record = readFileSync(join(process.cwd(), 'docs', 'strategy', 'harbor-editor-P1-implementation.md'), 'utf8');
    const battlePlan = readFileSync(join(process.cwd(), 'docs', 'strategy', 'harbor-editor-battle-plan.md'), 'utf8');
    const bufferSource = readFileSync(join(process.cwd(), 'core', 'pd-console', 'src', 'buffer.rs'), 'utf8');
    const syncSource = readFileSync(join(process.cwd(), 'core', 'pd-console', 'src', 'editor_sync.rs'), 'utf8');

    expect(currentState).toContain('These are checkpoint/reconnect primitives only.');
    expect(currentState).toContain('P2 snapshots, `/blob`, notes, and in-process replay do not satisfy this phase.');
    expect(p1Record).toContain('they do not verify abandonment');
    expect(battlePlan).toContain('P2 snapshots, notes, generic salvage, and `apply_remote_ops` do not provide it');
    expect(bufferSource).toContain('`/blob` is P2 checkpoint transport, not authoritative editor');
    expect(syncSource).toContain('notes nor `/blob` are P3.5 operation evidence');
    expect(syncSource).toContain('This is not the authoritative P3.5');
  });

  it('keeps bonded account recovery and authenticated editor salvage as separate route domains', () => {
    const routesIndex = readFileSync(join(process.cwd(), 'routes', 'index.ts'), 'utf8');
    const accountRoutes = readFileSync(join(process.cwd(), 'routes', 'recovery.ts'), 'utf8');
    const editorRoutes = readFileSync(join(process.cwd(), 'routes', 'editor-recovery.ts'), 'utf8');
    const editorRecovery = readFileSync(join(process.cwd(), 'lib', 'editor-recovery.ts'), 'utf8');
    const openapi = readFileSync(join(process.cwd(), 'docs', 'openapi.yaml'), 'utf8');
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'features.manifest.json'), 'utf8'));
    expect(existsSync(join(process.cwd(), 'routes', 'recovery.ts'))).toBe(true);
    expect(routesIndex).not.toContain('await fastify.register(recoveryPlugin');
    expect(routesIndex).toContain('await fastify.register(editorRecoveryPlugin');
    expect(routesIndex).not.toContain('createRecoveryMagicLink');
    expect(accountRoutes).toContain("fastify.post('/recovery/request'");
    expect(accountRoutes).toContain("fastify.post('/recovery/consume'");
    expect(editorRoutes).toContain("fastify.post('/editor/recovery/request'");
    expect(editorRoutes).toContain("fastify.post('/editor/recovery/prepare'");
    expect(editorRoutes).toContain("fastify.post('/editor/recovery/replay'");
    expect(editorRoutes).toContain("fastify.post('/editor/recovery/finalize'");
    expect(editorRoutes).not.toContain("fastify.post('/editor/recovery/consume'");
    expect(editorRoutes).not.toContain('sessions.addNote');
    expect(editorRecovery).not.toContain('sessions.addNote');
    expect(editorRecovery).toContain('openCanonicalFileHandle');
    expect(editorRecovery).toContain('verifyCanonicalFileHandle');
    expect(openapi).not.toContain('\n  /recovery/request:');
    expect(openapi).not.toContain('\n  /recovery/consume:');
    expect(manifest.features.recovery.routes).toEqual([
      'POST /recovery/request',
      'POST /recovery/consume',
    ]);
    expect(manifest.features.editor_recovery.routes).toEqual([
      'POST /editor/recovery/request',
      'POST /editor/recovery/prepare',
      'POST /editor/recovery/replay',
      'POST /editor/recovery/finalize',
    ]);
  });

  it('keeps README OpenAPI inventory counts derived from the contract', () => {
    const root = process.cwd();
    const contract = parseYaml(readFileSync(join(root, 'docs', 'openapi.yaml'), 'utf8'));
    const pathCount = Object.keys(contract.paths ?? {}).length;
    const methods = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
    const operationCount = Object.values(contract.paths ?? {}).reduce(
      (count, pathItem) => count + Object.keys(pathItem ?? {}).filter(key => methods.has(key)).length,
      0,
    );
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    expect(readme).toContain(`**${pathCount} paths, ${operationCount} operations**`);
  });
});
