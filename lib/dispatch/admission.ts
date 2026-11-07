/**
 * Dispatch admission for synchronous SQLite mutations, not process confinement.
 *
 * The model deliberately overapproximates the production writers, including
 * recovery and settlement shortcuts. Configuration is a trusted constructor
 * input; a caller-supplied digest or a serialized result grants no authority.
 * Direct database access remains trusted: its triggers invalidate receipts but
 * cannot make an arbitrary SQL writer participate in the admission protocol.
 */
import type Database from 'better-sqlite3';
import type { DispatchState } from './queue.js';

export const DISPATCH_ADMISSION_STATES: readonly DispatchState[] = Object.freeze([
  'proposed', 'claimed', 'in_progress', 'produced', 'review_pending',
  'accepted', 'rejected', 'settled', 'failed', 'salvage',
]);

/** State abstraction includes every production state writer, not just forward edges. */
type Edge = readonly [DispatchState | null, DispatchState | null];
const liveStates = DISPATCH_ADMISSION_STATES.filter(s => !['settled', 'failed', 'salvage'].includes(s));
const creation: Edge[] = [[null, 'proposed'], [null, 'claimed']];
const claimEdges: Edge[] = [['proposed', 'claimed']];

/** Actual writer relation; initialization imports are explicit, never guessed forward edges. */
export const DISPATCH_MUTATION_TRANSITIONS: Readonly<Record<string, readonly Edge[]>> = Object.freeze(
  Object.fromEntries(Object.entries({
    propose: creation, materializeProjection: creation,
    migrateNightshiftIntents: DISPATCH_ADMISSION_STATES.map(s => [null, s] as Edge),
    claim: claimEdges, claimProposed: claimEdges, nextProposed: claimEdges,
    prepareForRun: [['claimed', 'proposed']], restorePreparedRun: [['proposed', 'claimed']],
    start: [['claimed', 'in_progress']], produce: [['in_progress', 'produced']],
    requestReview: [['produced', 'review_pending']],
    accept: [['review_pending', 'accepted']], reject: [['review_pending', 'rejected']],
    settle: liveStates.flatMap(from => (['settled', 'failed', 'salvage'] as DispatchState[])
      .filter(to => !(from === 'rejected' && to === 'settled')).map(to => [from, to])),
    cancel: liveStates.map(from => [from, 'salvage']),
    recoverStranded: [['claimed', 'proposed'], ['in_progress', 'proposed'], ['claimed', 'salvage'], ['in_progress', 'salvage']],
    bindExecution: [], recordSpawnedAgent: [],
    conflictRecovery: [['accepted', 'produced']],
  }).map(([operation, edges]) => [operation, Object.freeze(edges.map(edge => Object.freeze(edge as Edge)))])),
);

/** The future model is generated from the same explicit complete writer relation. */
export const DISPATCH_ADMISSION_MODEL = Object.freeze(Object.fromEntries(
  DISPATCH_ADMISSION_STATES.map(state => [state, Object.freeze([...new Set(
    Object.values(DISPATCH_MUTATION_TRANSITIONS).flat()
      .filter(([from, to]) => from === state && to !== null).map(([, to]) => to as DispatchState),
  )])]),
)) as Readonly<Record<DispatchState, readonly DispatchState[]>>;

/** A deliberately restricted, executable state-safety policy, not arbitrary R17. */
export interface DispatchAdmissionPolicy {
  forbiddenStates: readonly DispatchState[];
  /** Exhaustion is unknown, never permission. Default covers all ten states. */
  maxStates?: number;
}

export interface DispatchAdmissionReceipt {
  readonly decision: 'safe' | 'unsafe' | 'unknown';
  readonly complete: boolean;
  readonly exploredStates: number;
  readonly operation: string;
  readonly revision: number;
  readonly authorityEpoch: number;
}

interface Authority {
  revision: number;
  epoch: number;
  policy: string;
  model: string;
}

interface BoundAdmission {
  authority: Authority;
  operation: string;
  args: unknown[];
  consumed: boolean;
  states: Set<DispatchState>;
  targets: Set<string>;
}

export interface DispatchMutation {
  /** Freeze generated identifiers before assessment, never at effect time. */
  bind?: (args: unknown[]) => unknown[];
  /** All initial states whose possible futures the concrete operation can touch. */
  roots: (args: unknown[]) => DispatchState[];
  /** Exact allowed affected identifiers, captured with the assessed snapshot. */
  targets: (args: unknown[]) => string[];
  apply: (...args: never[]) => unknown;
}

export class DispatchAdmissionError extends Error {}

/**
 * Validate and copy the full executable specification. Design: canonical bytes
 * are compared directly, so there is no caller-selected hash to trust.
 * @param policy Trusted installation input.
 * @returns Canonical validated policy bytes.
 */
function canonicalPolicy(policy: DispatchAdmissionPolicy): string {
  if (!policy || !Array.isArray(policy.forbiddenStates)
      || policy.forbiddenStates.some(state => !DISPATCH_ADMISSION_STATES.includes(state))) {
    throw new DispatchAdmissionError('invalid dispatch admission policy');
  }
  const maxStates = policy.maxStates ?? DISPATCH_ADMISSION_STATES.length;
  if (!Number.isSafeInteger(maxStates) || maxStates < 0 || maxStates > 10) {
    throw new DispatchAdmissionError('invalid dispatch admission exploration bound');
  }
  return JSON.stringify({ forbiddenStates: [...new Set(policy.forbiddenStates)].sort(), maxStates });
}

/**
 * Construct compulsory wrappers for the supplied production mutation registry.
 * Design: one IMMEDIATE transaction contains freshness comparison and the whole
 * synchronous effect. A durable global revision invalidates even metadata-only
 * changes, ABA, and deletion followed by reinsertion of the same identifier.
 * @param db Trusted database connection; schema reset is outside this boundary.
 * @param mutations Closed production operation registry, never request data.
 * @param policy Optional trusted installation. Omission preserves installed policy.
 * @returns Opaque receipt issuance/consumption and compulsory immediate execution.
 */
export function createDispatchAdmission(
  db: Database.Database,
  mutations: Record<string, DispatchMutation>,
  policy?: DispatchAdmissionPolicy,
) {
  const registered = Object.freeze(Object.fromEntries(Object.entries(mutations)
    .map(([name, mutation]) => [name, Object.freeze({ ...mutation })])));
  const model = JSON.stringify({ version: 1, states: DISPATCH_ADMISSION_MODEL, operations: DISPATCH_MUTATION_TRANSITIONS });
  const install = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS dispatch_admission_authority (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        revision INTEGER NOT NULL CHECK(typeof(revision) = 'integer' AND revision BETWEEN 0 AND 9007199254740991),
        epoch INTEGER NOT NULL CHECK(typeof(epoch) = 'integer' AND epoch BETWEEN 1 AND 9007199254740991),
        policy TEXT NOT NULL,
        model TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS dispatch_admission_events (
        revision INTEGER PRIMARY KEY,
        dispatch_id TEXT NOT NULL,
        before_state TEXT,
        after_state TEXT
      );
    `);
    const previous = db.prepare('SELECT * FROM dispatch_admission_authority WHERE singleton = 1').get() as Authority | undefined;
    const installedPolicy = policy === undefined
      ? previous?.policy ?? canonicalPolicy({ forbiddenStates: [] })
      : canonicalPolicy(policy);
    // Revalidate durable bytes. Corruption is a refusal, not an implicit reset.
    if (canonicalPolicy(JSON.parse(installedPolicy)) !== installedPolicy) {
      throw new DispatchAdmissionError('noncanonical installed dispatch policy');
    }
    if (!previous) {
      db.prepare('INSERT INTO dispatch_admission_authority VALUES (1, 0, 1, ?, ?)').run(installedPolicy, model);
    } else if (previous.policy !== installedPolicy || previous.model !== model) {
      db.prepare('UPDATE dispatch_admission_authority SET epoch = epoch + 1, policy = ?, model = ? WHERE singleton = 1')
        .run(installedPolicy, model);
    }
    // Install before legacy import. No recursive row update is needed.
    for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
      const name = `dispatch_admission_${event.toLowerCase()}`;
      const expected = `CREATE TRIGGER ${name}
        AFTER ${event} ON dispatches BEGIN
          UPDATE dispatch_admission_authority SET revision = revision + 1 WHERE singleton = 1;
          INSERT INTO dispatch_admission_events(revision, dispatch_id, before_state, after_state)
            SELECT revision, ${event === 'DELETE' ? 'OLD' : 'NEW'}.id,
              ${event === 'INSERT' ? 'NULL' : 'OLD.state'}, ${event === 'DELETE' ? 'NULL' : 'NEW.state'}
            FROM dispatch_admission_authority WHERE singleton = 1;
        END`;
      const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name) as { sql: string } | undefined;
      /**
       * Compare SQLite's retained schema text without formatting differences.
       * @param sql Trigger definition; purpose: detect a replaced clock writer.
       * @returns Normalized schema text.
       */
      const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if ((existing && normalize(existing.sql) !== normalize(expected)) || (!existing && previous)) {
        throw new DispatchAdmissionError('dispatch admission clock trigger missing or changed');
      }
      if (!existing) db.exec(expected);
    }
  });
  install.immediate();

  const selectAuthority = db.prepare('SELECT revision, epoch, policy, model FROM dispatch_admission_authority WHERE singleton = 1');
  const receipts = new WeakMap<object, BoundAdmission>();

  /**
   * Read current trusted configuration; purpose: refuse unknown model or corruption.
   * @returns Current durable authority tuple.
   */
  function authority(): Authority {
    const current = selectAuthority.get() as Authority | undefined;
    if (!current || current.model !== model || !Number.isSafeInteger(current.revision)
        || !Number.isSafeInteger(current.epoch)) {
      throw new DispatchAdmissionError('dispatch admission authority unavailable or model changed');
    }
    return current;
  }

  /**
   * Issue an immutable result for exact copied arguments and a coherent snapshot.
   * Design: callers cannot substitute another effect after future assessment.
   * @param operation Registered production operation name.
   * @param args Serializable operation arguments; copied before any await.
   * @returns Result whose object identity is retained privately as its authority.
   */
  function prepare(operation: string, args: unknown[] = []): DispatchAdmissionReceipt {
    const issue = db.transaction(() => {
      if (!Object.hasOwn(registered, operation) || !Object.hasOwn(DISPATCH_MUTATION_TRANSITIONS, operation)) {
        throw new DispatchAdmissionError('unknown dispatch mutation');
      }
      const mutation = registered[operation];
      if (typeof mutation.targets !== 'function') throw new DispatchAdmissionError('dispatch mutation has no target binding');
      const copied = structuredClone(mutation.bind ? mutation.bind(structuredClone(args)) : args);
      const current = authority();
      const configured = JSON.parse(current.policy) as Required<DispatchAdmissionPolicy>;
      if (canonicalPolicy(configured) !== current.policy) throw new DispatchAdmissionError('invalid installed dispatch policy');
      const pending = [...mutation.roots(copied)];
      const targets = new Set(mutation.targets(copied));
      if ([...targets].some(id => typeof id !== 'string' || !id)) throw new DispatchAdmissionError('invalid dispatch target binding');
      const seen = new Set<DispatchState>();
      let decision: DispatchAdmissionReceipt['decision'] = 'safe';
      while (pending.length) {
        const state = pending.shift()!;
        if (!DISPATCH_ADMISSION_STATES.includes(state)) throw new DispatchAdmissionError('unmodeled dispatch state');
        if (seen.has(state)) continue;
        if (seen.size >= configured.maxStates) { decision = 'unknown'; break; }
        seen.add(state);
        if (configured.forbiddenStates.includes(state)) { decision = 'unsafe'; break; }
        pending.push(...DISPATCH_ADMISSION_MODEL[state]);
      }
      const receipt = Object.freeze({
        decision, complete: decision === 'safe', exploredStates: seen.size,
        operation, revision: current.revision, authorityEpoch: current.epoch,
      });
      receipts.set(receipt, { authority: current, operation, args: copied, consumed: false, states: seen, targets });
      return receipt;
    });
    return issue.immediate();
  }

  /**
   * Consume a receipt once with its exact synchronous effect. Design: comparison
   * and writes share the SQLite lock. Registered handlers must be synchronous;
   * thenable rejection detects a contract violation, not arbitrary callback confinement.
   * @param receipt Original object issued by this controller.
   * @returns The production mutation's result after commit.
   */
  function commit(receipt: DispatchAdmissionReceipt): unknown {
    const bound = receipt && receipts.get(receipt);
    if (!bound || bound.consumed || receipt.decision !== 'safe' || !receipt.complete) {
      throw new DispatchAdmissionError('dispatch admission refused: forged, consumed, unsafe, or incomplete result');
    }
    // Burn before execution, including failures: a rolled-back attempt is never reusable.
    bound.consumed = true;
    return db.transaction(() => {
      const current = authority();
      if (current.revision !== bound.authority.revision || current.epoch !== bound.authority.epoch
          || current.policy !== bound.authority.policy || current.model !== bound.authority.model) {
        throw new DispatchAdmissionError('stale dispatch admission');
      }
      const result = registered[bound.operation].apply(...bound.args as never[]);
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        throw new DispatchAdmissionError('dispatch admission effects must be synchronous');
      }
      const observations = db.prepare('SELECT dispatch_id, before_state, after_state FROM dispatch_admission_events WHERE revision > ? ORDER BY revision')
        .all(current.revision) as Array<{ dispatch_id: string; before_state: DispatchState | null; after_state: DispatchState | null }>;
      const after = authority();
      if (after.epoch !== current.epoch || after.policy !== current.policy || after.model !== current.model
          || after.revision - current.revision !== observations.length) {
        throw new DispatchAdmissionError('dispatch authority or observation coverage changed during effect');
      }
      for (const { dispatch_id: id, before_state: from, after_state: to } of observations) {
        if (!bound.targets.has(id)) throw new DispatchAdmissionError('dispatch effect escaped bound target identity');
        if ((from !== null && !bound.states.has(from)) || (to !== null && !bound.states.has(to))) {
          throw new DispatchAdmissionError('dispatch effect escaped assessed states');
        }
        const stutter = from !== null && from === to && DISPATCH_ADMISSION_STATES.includes(from);
        if (!stutter && !DISPATCH_MUTATION_TRANSITIONS[bound.operation].some(([source, target]) => source === from && target === to)) {
          throw new DispatchAdmissionError(`unmodeled dispatch effect: ${bound.operation} ${from} -> ${to}`);
        }
      }
      // Receipts keep only the clock. Completed observations need not grow forever.
      db.prepare('DELETE FROM dispatch_admission_events WHERE revision <= ?').run(after.revision);
      return result;
    }).immediate();
  }

  /**
   * Compulsory path for ordinary API calls; purpose: avoid an opt-in legacy path.
   * @param operation Closed registry key.
   * @param args Concrete production operation arguments.
   * @returns Committed production result, or a refusal without any effect.
   */
  function run(operation: string, args: unknown[]): unknown {
    return db.transaction(() => commit(prepare(operation, args))).immediate();
  }

  return { prepare, commit, run };
}
