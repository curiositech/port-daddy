/**
 * Narrow repair helpers for pre-AgentNode sessions whose stored display label
 * was accidentally rebound to the synthetic soul created by the grandfather
 * migration. These helpers never authenticate a caller and never invent an
 * AgentNode. Authentication remains the route's credential check; the stamped
 * actor on the predecessor session is the only historical ownership witness.
 */

import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import type Database from 'better-sqlite3';

export type SyntheticAliasRepairResult =
  | { status: 'not-needed'; alias: string; actorId: string }
  | { status: 'repaired'; alias: string; actorId: string; replacedActorId: string };

export interface LegacyContinuationWorktreeWitness {
  id: string;
  root: string;
  name: string;
  branch: string;
  isMain: boolean;
  repoId: string;
  head: string;
  base: string;
  worktreeRealpath: string;
  worktreePhysicalId: string;
  gitDirRealpath: string;
  gitDirPhysicalId: string;
  repoCommonDir: string;
  remote: string;
}

export interface LegacyClaimSetWitness {
  count: number;
  sha256: string;
}

export class LegacyActorContinuityError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'LEGACY_ALIAS_CONFLICT'
      | 'LEGACY_ALIAS_TARGET_MISSING'
      | 'LEGACY_ALIAS_NOT_SYNTHETIC'
      | 'LEGACY_ALIAS_LIVE_ACTOR',
  ) {
    super(message);
    this.name = 'LegacyActorContinuityError';
  }
}

/**
 * Check a schema prerequisite without mutating it. The design fails closed
 * when an older registry lacks the tables required for guarded continuity.
 *
 * @param db - Registry connection owned by the caller's transaction.
 * @param table - Exact SQLite table name expected by the recovery path.
 * @returns Whether that table exists in the attached registry.
 */
function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
  ).get(table));
}

/**
 * Check one schema column before issuing a historical-state query. The intent
 * is to reject an incomplete migration rather than guess at legacy semantics.
 *
 * @param db - Registry connection owned by the caller's transaction.
 * @param table - Exact table whose schema is being checked.
 * @param column - Exact required column name.
 * @returns Whether the named table contains the named column.
 */
function columnExists(db: Database.Database, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false;
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .some(candidate => candidate.name === column);
}

/**
 * Narrow unknown JSON-like input to an object record. This design keeps every
 * recovery witness field explicit and prevents arrays from passing validation.
 *
 * @param value - Untrusted value at the route/service boundary.
 * @returns The object record, or null when the value is not a plain record.
 */
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Validate and normalize the complete daemon-probed worktree witness. The
 * purpose is to make physical checkout identity, repository, branch, and head
 * equality a server-side recovery condition rather than client testimony.
 *
 * @param value - Untrusted worktree witness read from metadata or a probe.
 * @returns A fully normalized witness, or null when any required field fails.
 */
export function normalizeLegacyContinuationWorktreeWitness(
  value: unknown,
): LegacyContinuationWorktreeWitness | null {
  const candidate = record(value);
  if (!candidate) return null;
  const requiredText = [
    'id',
    'root',
    'name',
    'branch',
    'repoId',
    'head',
    'base',
    'worktreeRealpath',
    'worktreePhysicalId',
    'gitDirRealpath',
    'gitDirPhysicalId',
    'repoCommonDir',
    'remote',
  ] as const;
  if (requiredText.some(key => (
    typeof candidate[key] !== 'string'
    || !(candidate[key] as string).trim()
    || (candidate[key] as string) !== (candidate[key] as string).trim()
  ))) {
    return null;
  }
  if (typeof candidate.isMain !== 'boolean') return null;
  if (!/^[0-9a-f]{40,64}$/.test(candidate.head as string)
    || !/^[0-9a-f]{40,64}$/.test(candidate.base as string)) return null;
  for (const key of [
    'root',
    'worktreeRealpath',
    'gitDirRealpath',
    'repoCommonDir',
  ] as const) {
    const path = candidate[key] as string;
    if (!isAbsolute(path) || resolve(path) !== path || path.includes('\0')) return null;
  }
  return {
    id: candidate.id as string,
    root: candidate.root as string,
    name: candidate.name as string,
    branch: candidate.branch as string,
    isMain: candidate.isMain,
    repoId: candidate.repoId as string,
    head: candidate.head as string,
    base: candidate.base as string,
    worktreeRealpath: candidate.worktreeRealpath as string,
    worktreePhysicalId: candidate.worktreePhysicalId as string,
    gitDirRealpath: candidate.gitDirRealpath as string,
    gitDirPhysicalId: candidate.gitDirPhysicalId as string,
    repoCommonDir: candidate.repoCommonDir as string,
    remote: candidate.remote as string,
  };
}

/**
 * Serialize every authority-relevant worktree field in a fixed order. The
 * design gives exact equality semantics without tolerating omitted properties.
 *
 * @param value - Validated complete worktree witness.
 * @returns Stable comparison key containing every witness field.
 */
function worktreeWitnessKey(value: LegacyContinuationWorktreeWitness): string {
  return JSON.stringify([
    value.id,
    value.root,
    value.name,
    value.branch,
    value.isMain,
    value.repoId,
    value.head,
    value.base,
    value.worktreeRealpath,
    value.worktreePhysicalId,
    value.gitDirRealpath,
    value.gitDirPhysicalId,
    value.repoCommonDir,
    value.remote,
  ]);
}

/**
 * Hash the complete active claim-forest snapshot used by actor-only recovery.
 * This witness includes the canonical address (repo/world/git OID/selector),
 * historical claim content, actual claim actor, and claim intent metadata. The
 * current node content hash is deliberately recorded too but is never written
 * by continuation, so a newer observation cannot be rolled backward. The
 * design turns the full claim set into a pre-write concurrency witness.
 *
 * @param db - Registry connection used to read the predecessor claims.
 * @param sessionId - Exact predecessor session whose live claims are hashed.
 * @returns Count and SHA-256 digest of the complete ordered claim snapshot.
 */
export function captureLegacyClaimSetWitness(
  db: Database.Database,
  sessionId: string,
): LegacyClaimSetWitness {
  const rows = db.prepare(`
    SELECT c.id, c.node_id, c.agent_id, c.agent_node_id, c.mode, c.intent,
           c.claimed_at, c.observed_by, c.confidence,
           c.legacy_session_file_id, c.claim_content_hash,
           c.metadata AS claim_metadata,
           n.repo_id, n.world_kind, n.world_id, n.parent_id,
           n.selector_kind, n.path, n.symbol, n.symbol_path,
           n.start_line, n.end_line, n.git_oid, n.content_hash,
           n.created_at, n.last_observed_at, n.metadata AS node_metadata
    FROM claim_forest_claims c
    JOIN claim_forest_nodes n ON n.id = c.node_id
    WHERE c.session_id = ? AND c.released_at IS NULL
    ORDER BY c.id
  `).all(sessionId) as Array<Record<string, unknown>>;
  return {
    count: rows.length,
    sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
  };
}

/**
 * CAS-rebind one exact split alias. The only repairable source is the
 * grandfather migration's unmistakable self-mapped artifact: alias -> itself,
 * a migrated/operator-trusted soul with the same display alias, and no verified
 * session stamp or AgentNode-bound session naming that synthetic actor.
 *
 * The synthetic soul remains as immutable identity history, while its verifier
 * hash is copied into the append-only retirement receipt and the live hash,
 * salt, and trusted bit are CAS-cleared. The design requires the caller to run
 * this inside the same IMMEDIATE transaction as the session/claim continuation
 * it accompanies.
 *
 * @param db - Registry connection already inside the continuation transaction.
 * @param input - Exact alias, actor, session, worktree, and claim-set witnesses.
 * @returns Whether no repair was needed or the exact synthetic actor was retired.
 */
export function repairSyntheticMigratedAlias(
  db: Database.Database,
  input: {
    harbor: string;
    alias: string;
    actorId: string;
    repairedAt: number;
    predecessorSessionId: string;
    successorSessionId: string;
    worktree: LegacyContinuationWorktreeWitness;
    claimSet: LegacyClaimSetWitness;
  },
): SyntheticAliasRepairResult {
  if (!db.inTransaction) {
    throw new LegacyActorContinuityError(
      'synthetic alias repair requires the caller-owned transaction',
      'LEGACY_ALIAS_CONFLICT',
    );
  }
  const raw = input && typeof input === 'object'
    ? input as Partial<typeof input>
    : {};
  const harbor = typeof raw.harbor === 'string' ? raw.harbor.trim() : '';
  const alias = typeof raw.alias === 'string' ? raw.alias.trim() : '';
  const actorId = typeof raw.actorId === 'string' ? raw.actorId.trim() : '';
  const predecessorSessionId = typeof raw.predecessorSessionId === 'string'
    ? raw.predecessorSessionId.trim()
    : '';
  const successorSessionId = typeof raw.successorSessionId === 'string'
    ? raw.successorSessionId.trim()
    : '';
  const worktree = normalizeLegacyContinuationWorktreeWitness(raw.worktree);
  const claimSet = record(raw.claimSet);
  const claimSetCount = typeof claimSet?.count === 'number' && Number.isSafeInteger(claimSet.count)
    ? claimSet.count
    : -1;
  const claimSetHash = typeof claimSet?.sha256 === 'string' && /^[0-9a-f]{64}$/.test(claimSet.sha256)
    ? claimSet.sha256
    : '';
  if (
    !harbor
    || !alias
    || !actorId
    || !predecessorSessionId
    || !successorSessionId
    || predecessorSessionId === successorSessionId
    || !worktree
    || claimSetCount < 0
    || !claimSetHash
    || !Number.isSafeInteger(raw.repairedAt)
    || (raw.repairedAt as number) < 0
  ) {
    throw new LegacyActorContinuityError('synthetic alias repair input is invalid', 'LEGACY_ALIAS_CONFLICT');
  }
  if (alias === actorId) return { status: 'not-needed', alias, actorId };
  if (
    !tableExists(db, 'actor_alias')
    || !tableExists(db, 'actor_souls')
    || !tableExists(db, 'legacy_actor_alias_retirements')
  ) {
    throw new LegacyActorContinuityError('actor identity store is unavailable', 'LEGACY_ALIAS_TARGET_MISSING');
  }

  const continuationWitness = db.prepare(`
    SELECT p.agent_id AS predecessor_agent_id,
           p.agent_node_id AS predecessor_agent_node_id,
           p.worktree_id AS predecessor_worktree_id,
           p.metadata AS predecessor_metadata,
           s.status AS successor_status,
           s.agent_id AS successor_agent_id,
           s.agent_node_id AS successor_agent_node_id,
           s.worktree_id AS successor_worktree_id,
           s.metadata AS successor_metadata
    FROM sessions p
    JOIN sessions s ON s.id = ?
    WHERE p.id = ?
  `).get(successorSessionId, predecessorSessionId) as {
    predecessor_agent_id: string | null;
    predecessor_agent_node_id: string | null;
    predecessor_worktree_id: string | null;
    predecessor_metadata: string | null;
    successor_status: string;
    successor_agent_id: string | null;
    successor_agent_node_id: string | null;
    successor_worktree_id: string | null;
    successor_metadata: string | null;
  } | undefined;
  const predecessorMetadata = (() => {
    try { return record(continuationWitness?.predecessor_metadata ? JSON.parse(continuationWitness.predecessor_metadata) : null); }
    catch { return null; }
  })();
  const successorMetadata = (() => {
    try { return record(continuationWitness?.successor_metadata ? JSON.parse(continuationWitness.successor_metadata) : null); }
    catch { return null; }
  })();
  const predecessorIdentity = record(predecessorMetadata?.identity);
  const predecessorContinuation = record(predecessorMetadata?.actorOnlyContinuation);
  const successorIdentity = record(successorMetadata?.identity);
  const predecessorRecordedWorktree = normalizeLegacyContinuationWorktreeWitness(predecessorContinuation?.worktree);
  const successorRecordedWorktree = normalizeLegacyContinuationWorktreeWitness(successorMetadata?.actorOnlyWorktreeWitness);
  const predecessorClaimSet = record(predecessorContinuation?.claimSet);
  const successorClaimSet = record(successorMetadata?.actorOnlyClaimSetWitness);
  const currentClaimSet = captureLegacyClaimSetWitness(db, predecessorSessionId);
  if (
    !continuationWitness
    || continuationWitness.predecessor_agent_id !== alias
    || continuationWitness.predecessor_agent_node_id !== null
    || continuationWitness.predecessor_worktree_id !== worktree.id
    || predecessorIdentity?.verified !== true
    || predecessorIdentity.actorId !== actorId
    || predecessorContinuation?.successorSessionId !== successorSessionId
    || predecessorContinuation.actorId !== actorId
    || !predecessorRecordedWorktree
    || worktreeWitnessKey(predecessorRecordedWorktree) !== worktreeWitnessKey(worktree)
    || predecessorClaimSet?.count !== claimSetCount
    || predecessorClaimSet.sha256 !== claimSetHash
    || continuationWitness.successor_status !== 'active'
    || continuationWitness.successor_agent_id !== alias
    || continuationWitness.successor_agent_node_id !== null
    || continuationWitness.successor_worktree_id !== worktree.id
    || successorMetadata?.predecessorSessionId !== predecessorSessionId
    || successorMetadata.actorOnlyContinuation !== true
    || successorMetadata.durableOwnershipTransferred !== false
    || successorMetadata.agentNodeUpgradeRequired !== true
    || successorIdentity?.verified !== true
    || successorIdentity.actorId !== actorId
    || !successorRecordedWorktree
    || worktreeWitnessKey(successorRecordedWorktree) !== worktreeWitnessKey(worktree)
    || successorClaimSet?.count !== claimSetCount
    || successorClaimSet.sha256 !== claimSetHash
    || currentClaimSet.count !== claimSetCount
    || currentClaimSet.sha256 !== claimSetHash
  ) {
    throw new LegacyActorContinuityError(
      'synthetic alias repair lacks the exact actor-only continuation witness',
      'LEGACY_ALIAS_CONFLICT',
    );
  }

  const target = db.prepare(
    'SELECT actor_id FROM actor_souls WHERE harbor = ? AND actor_id = ?',
  ).get(harbor, actorId) as { actor_id: string } | undefined;
  if (!target) {
    throw new LegacyActorContinuityError(
      'verified predecessor actor is missing from the identity store',
      'LEGACY_ALIAS_TARGET_MISSING',
    );
  }

  const binding = db.prepare(
    'SELECT actor_id FROM actor_alias WHERE harbor = ? AND alias = ?',
  ).get(harbor, alias) as { actor_id: string } | undefined;

  const directAliasSoul = db.prepare(`
    SELECT credential_kind, display_alias
    FROM actor_souls
    WHERE harbor = ? AND actor_id = ?
  `).get(harbor, alias) as {
    credential_kind: string;
    display_alias: string | null;
  } | undefined;

  const synthetic = db.prepare(`
    SELECT actor_id, credential_hash, credential_salt, operator_trusted
    FROM actor_souls
    WHERE harbor = ? AND actor_id = ? AND credential_kind = 'migrated'
      AND display_alias = ?
  `).get(harbor, alias, alias) as {
    actor_id: string;
    credential_hash: string | null;
    credential_salt: string | null;
    operator_trusted: number;
  } | undefined;
  if (!synthetic) {
    const retirement = db.prepare(`
      SELECT 1 FROM legacy_actor_alias_retirements
      WHERE harbor = ? AND alias = ?
    `).get(harbor, alias);
    if (!directAliasSoul && binding?.actor_id === actorId && !retirement) {
      return { status: 'not-needed', alias, actorId };
    }
    throw new LegacyActorContinuityError(
      'legacy label lacks the exact grandfather-migration synthetic actor',
      'LEGACY_ALIAS_NOT_SYNTHETIC',
    );
  }

  const stampedSynthetic = tableExists(db, 'sessions')
    ? Number((db.prepare(`
        SELECT COUNT(*) AS count
        FROM sessions
        WHERE json_valid(metadata)
          AND json_extract(metadata, '$.identity.verified') = 1
          AND json_extract(metadata, '$.identity.actorId') = ?
      `).get(alias) as { count: number }).count)
    : 0;
  const nodeBoundSynthetic = columnExists(db, 'sessions', 'agent_node_id')
    ? Number((db.prepare(`
        SELECT COUNT(*) AS count
        FROM sessions
        WHERE agent_node_id IS NOT NULL
          AND agent_node_id <> ''
          AND agent_id = ?
      `).get(alias) as { count: number }).count)
    : 0;
  if (stampedSynthetic !== 0 || nodeBoundSynthetic !== 0) {
    throw new LegacyActorContinuityError(
      'synthetic migrated actor has independent durable use and cannot be rebound automatically',
      'LEGACY_ALIAS_LIVE_ACTOR',
    );
  }

  const existingRetirement = db.prepare(`
    SELECT synthetic_actor_id, successor_actor_id, retired_credential_hash,
           retired_at, reason
    FROM legacy_actor_alias_retirements
    WHERE harbor = ? AND alias = ?
  `).get(harbor, alias) as {
    synthetic_actor_id: string;
    successor_actor_id: string;
    retired_credential_hash: string;
    retired_at: number;
    reason: string;
  } | undefined;

  // Exhaustive pre-write state table. LIVE_ABSENT and LIVE_SELF are the only
  // mutable states. RETIRED is the only idempotent state. An already rebound
  // alias without a receipt, any receipt paired with a live verifier, and every
  // partial verifier tuple fail before the first write.
  const aliasState = !binding
    ? 'absent'
    : binding.actor_id === alias
      ? 'self'
      : binding.actor_id === actorId ? 'successor' : 'other';
  const verifierState = synthetic.operator_trusted === 1
    && typeof synthetic.credential_hash === 'string'
    && /^[0-9a-f]{64}$/.test(synthetic.credential_hash)
    && typeof synthetic.credential_salt === 'string'
    && synthetic.credential_salt.length > 0
    ? 'live'
    : synthetic.operator_trusted === 0
      && synthetic.credential_hash === null
      && synthetic.credential_salt === null
      ? 'retired'
      : 'partial';
  const retirementState = !existingRetirement
    ? 'absent'
    : existingRetirement.synthetic_actor_id === alias
      && existingRetirement.successor_actor_id === actorId
      && /^[0-9a-f]{64}$/.test(existingRetirement.retired_credential_hash)
      && existingRetirement.reason === 'grandfather-migration-split-alias'
      ? 'exact'
      : 'conflict';
  const liveState = retirementState === 'absent'
    && verifierState === 'live'
    && (aliasState === 'absent' || aliasState === 'self');
  const retiredState = retirementState === 'exact'
    && verifierState === 'retired'
    && aliasState === 'successor';
  if (retiredState) return { status: 'not-needed', alias, actorId };
  if (!liveState) {
    throw new LegacyActorContinuityError(
      `legacy alias state is not repairable (${aliasState}/${verifierState}/${retirementState})`,
      'LEGACY_ALIAS_CONFLICT',
    );
  }

  const changed = binding
    ? db.prepare(`
          UPDATE actor_alias
          SET actor_id = ?, bound_at = ?
          WHERE harbor = ? AND alias = ? AND actor_id = ?
        `).run(actorId, raw.repairedAt, harbor, alias, alias).changes
    : db.prepare(`
        INSERT INTO actor_alias (harbor, alias, actor_id, bound_at)
        SELECT ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM actor_alias WHERE harbor = ? AND alias = ?
        )
      `).run(harbor, alias, actorId, raw.repairedAt, harbor, alias).changes;
  if (changed !== 1) {
    throw new LegacyActorContinuityError(
      'legacy alias changed during repair; no continuation was accepted',
      'LEGACY_ALIAS_CONFLICT',
    );
  }
  const recorded = db.prepare(`
    INSERT INTO legacy_actor_alias_retirements (
      harbor, alias, synthetic_actor_id, successor_actor_id,
      retired_credential_hash, retired_at, reason
    ) VALUES (?, ?, ?, ?, ?, ?, 'grandfather-migration-split-alias')
  `).run(
    harbor,
    alias,
    alias,
    actorId,
    synthetic.credential_hash,
    raw.repairedAt,
  ).changes;
  const verifierRetired = db.prepare(`
    UPDATE actor_souls
    SET credential_hash = NULL, credential_salt = NULL, operator_trusted = 0
    WHERE harbor = ? AND actor_id = ? AND credential_kind = 'migrated'
      AND display_alias = ? AND operator_trusted = 1
      AND credential_hash = ? AND credential_salt = ?
  `).run(
    harbor,
    alias,
    alias,
    synthetic.credential_hash,
    synthetic.credential_salt,
  ).changes;
  const readback = db.prepare(`
    SELECT synthetic_actor_id, successor_actor_id, retired_credential_hash,
           retired_at, reason
    FROM legacy_actor_alias_retirements
    WHERE harbor = ? AND alias = ?
  `).get(harbor, alias) as {
    synthetic_actor_id: string;
    successor_actor_id: string;
    retired_credential_hash: string;
    retired_at: number;
    reason: string;
  } | undefined;
  if (
    recorded !== 1
    || verifierRetired !== 1
    || !readback
    || readback.synthetic_actor_id !== alias
    || readback.successor_actor_id !== actorId
    || readback.retired_credential_hash !== synthetic.credential_hash
    || readback.retired_at !== raw.repairedAt
    || readback.reason !== 'grandfather-migration-split-alias'
  ) {
    throw new LegacyActorContinuityError(
      'legacy alias retirement authority was not recorded exactly',
      'LEGACY_ALIAS_CONFLICT',
    );
  }
  const aliasReadback = db.prepare(`
    SELECT actor_id, bound_at FROM actor_alias WHERE harbor = ? AND alias = ?
  `).get(harbor, alias) as { actor_id: string; bound_at: number } | undefined;
  const retiredVerifier = db.prepare(`
    SELECT credential_hash, credential_salt, operator_trusted
    FROM actor_souls WHERE harbor = ? AND actor_id = ?
  `).get(harbor, alias) as {
    credential_hash: string | null;
    credential_salt: string | null;
    operator_trusted: number;
  } | undefined;
  if (
    !aliasReadback
    || aliasReadback.actor_id !== actorId
    || aliasReadback.bound_at !== raw.repairedAt
    || !retiredVerifier
    || retiredVerifier.credential_hash !== null
    || retiredVerifier.credential_salt !== null
    || retiredVerifier.operator_trusted !== 0
  ) {
    throw new LegacyActorContinuityError(
      'synthetic credential verifier retirement did not read back exactly',
      'LEGACY_ALIAS_CONFLICT',
    );
  }
  return { status: 'repaired', alias, actorId, replacedActorId: alias };
}
