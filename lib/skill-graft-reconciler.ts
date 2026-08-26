/**
 * Checkpointed Tool2Vec catalog reconciliation.
 *
 * The centroid row is the checkpoint: each skill is content-hash keyed and
 * committed immediately. A short SQLite lease prevents setup, the daemon,
 * and a manual CLI warm-up from becoming competing builders. If a process is
 * killed, the lease expires and the next caller resumes at the first missing
 * row; completed centroids are reused and never duplicated.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseInstance } from './sqlite-runtime.js';
import {
  createLocalEmbedder,
  defaultTransformersCacheDir,
  isEmbeddingModelCached,
  type LocalEmbedder,
} from './semantic-resolver.js';
import { defaultSkillCatalogRoots } from './skill-sync.js';
import type { SkillGraftRoot } from './skill-graft.js';
import { loadSkillCatalog, type SkillEmbedder, type SkillEntry } from './shipwright/skill-index.js';
import {
  createLLMClientSyntheticQueryGenerator,
  createTool2VecStore,
  getOrBuildCentroid,
  type SyntheticQueryGenerator,
  type Tool2VecStore,
} from './skill-graft-tool2vec.js';
import { resolveSkillGraftRuntime, type SkillGraftRuntime } from './skill-graft-runtime.js';

export type Tool2VecReconcileState =
  | 'current'
  | 'cold'
  | 'reconciling'
  | 'embedder-down'
  | 'generator-down';

export interface Tool2VecReconcileStatus {
  state: Tool2VecReconcileState;
  configured: boolean;
  backend: string | null;
  generatorModel: string | null;
  embedderModel: string;
  catalogHash: string;
  total: number;
  current: number;
  missing: number;
  stale: number;
  coveragePct: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  lastTrigger: string | null;
  lastStartedAt: number | null;
  lastCompletedAt: number | null;
  lastErrorKind: 'embedder-down' | 'generator-down' | null;
  lastError: string | null;
}

export interface Tool2VecReconcileResult extends Tool2VecReconcileStatus {
  trigger: string;
  acquired: boolean;
  embedded: number;
  reused: number;
  removed: number;
  stoppedEarly: boolean;
}

interface ReconcileRow {
  lease_owner: string | null;
  lease_expires_at: number | null;
  generator_id: string | null;
  embedder_model_id: string | null;
  catalog_hash: string | null;
  last_trigger: string | null;
  last_started_at: number | null;
  last_completed_at: number | null;
  last_error_kind: 'embedder-down' | 'generator-down' | null;
  last_error: string | null;
}

export interface Tool2VecReconcilerOptions {
  projectRoot: string;
  roots?: SkillGraftRoot[];
  runtime?: SkillGraftRuntime | null;
  embedder?: SkillEmbedder & Partial<Pick<LocalEmbedder, 'modelId'>>;
  store?: Tool2VecStore;
  db?: DatabaseInstance;
  dbDir?: string;
  ownerId?: string;
  leaseMs?: number;
  now?: () => number;
  isEmbedderAvailable?: () => boolean;
  onWarning?: (message: string) => void;
}

export interface Tool2VecReconciler {
  status(): Tool2VecReconcileStatus;
  reconcile(options: {
    trigger: string;
    maxSkills?: number;
    signal?: AbortSignal;
  }): Promise<Tool2VecReconcileResult>;
}

const STATE_TABLE = 'skill_graft_tool2vec_reconcile_state';
const DEFAULT_BATCH = 16;
const DEFAULT_LEASE_MS = 120_000;

/**
 * Creates the single-row reconciliation ledger if it is absent. The design
 * keeps lease and checkpoint metadata beside the centroid store so every
 * caller observes one durable authority after crashes or upgrades.
 *
 * @param db SQLite connection shared with the Tool2Vec store.
 */
function ensureStateSchema(db: DatabaseInstance): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
      id                  INTEGER PRIMARY KEY CHECK (id = 1),
      lease_owner         TEXT,
      lease_expires_at    INTEGER,
      generator_id        TEXT,
      embedder_model_id   TEXT,
      catalog_hash        TEXT,
      last_trigger        TEXT,
      last_started_at     INTEGER,
      last_completed_at   INTEGER,
      last_error_kind     TEXT,
      last_error          TEXT
    );
    INSERT OR IGNORE INTO ${STATE_TABLE} (id) VALUES (1);
  `);
}

/**
 * Derives a stable catalog identity from sorted skill ids and content hashes.
 * The intent is to distinguish a fully reconciled catalog from a cache whose
 * row count happens to match while individual skill content has changed.
 *
 * @param skills Catalog entries whose ids and hashes define the snapshot.
 * @returns A prefixed SHA-256 fingerprint for status and checkpoint receipts.
 */
function catalogFingerprint(skills: readonly Pick<SkillEntry, 'id' | 'contentHash'>[]): string {
  const hash = createHash('sha256');
  for (const skill of [...skills].sort((a, b) => a.id.localeCompare(b.id))) {
    hash.update(skill.id).update('\0').update(skill.contentHash).update('\n');
  }
  return `sha256:${hash.digest('hex')}`;
}

class Tool2VecDependencyFailure extends Error {
  constructor(
    readonly kind: 'embedder-down' | 'generator-down',
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'Tool2VecDependencyFailure';
  }
}

/**
 * Maps a dependency failure to the operator-facing outage class. The design
 * defaults unknown generation-path errors to generator-down so status never
 * invents an embedder diagnosis without a witnessed embedder failure.
 *
 * @param error Failure raised while building a centroid.
 * @returns The bounded status category persisted in the reconcile ledger.
 */
function errorKind(error: unknown): 'embedder-down' | 'generator-down' {
  return error instanceof Tool2VecDependencyFailure
    ? error.kind
    : 'generator-down';
}

/**
 * Bounds persisted dependency messages. The purpose is to keep Doctor useful
 * without letting arbitrary backend errors inflate the single-row state ledger.
 *
 * @param error Failure whose message will be exposed in status.
 * @returns At most one thousand characters of human-readable error detail.
 */
function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1_000);
}

/**
 * Builds the one resumable Tool2Vec catalog reconciler shared by setup, daemon,
 * CLI, Doctor, and routes. Its design treats each current-hash centroid row as
 * a checkpoint and uses a short lease to prevent duplicate concurrent builders.
 *
 * @param options Catalog roots, runtime policy, store, lease, and test seams.
 * @returns A read-only status surface plus bounded resumable reconciliation.
 */
export function createTool2VecReconciler(
  options: Tool2VecReconcilerOptions,
): Tool2VecReconciler {
  const now = options.now ?? Date.now;
  const runtime = options.runtime === undefined
    ? resolveSkillGraftRuntime()
    : options.runtime;
  const cacheDir = defaultTransformersCacheDir();
  const embedder = options.embedder ?? createLocalEmbedder({ cacheDir });
  const embedderModelId = embedder.modelId ?? 'Xenova/all-MiniLM-L6-v2';
  const configuredGeneratorId = runtime?.model ?? 'unconfigured';
  const store = options.store ?? createTool2VecStore({
    db: options.db,
    dbDir: options.dbDir,
    embedderModelId,
    generatorId: configuredGeneratorId,
  });
  const roots = options.roots ?? defaultSkillCatalogRoots(options.projectRoot)
    .map((root) => ({ label: root.label, path: root.path }));
  const ownerId = options.ownerId ?? `${process.pid}:${randomUUID()}`;
  const leaseMs = Math.max(30_000, options.leaseMs ?? DEFAULT_LEASE_MS);
  const generator: SyntheticQueryGenerator | null = runtime
    ? createLLMClientSyntheticQueryGenerator(runtime.client, runtime.model)
    : null;
  const guardedGenerator: SyntheticQueryGenerator | null = generator
    ? async (skill, count) => {
        try {
          return await generator(skill, count);
        } catch (error) {
          throw new Tool2VecDependencyFailure('generator-down', error);
        }
      }
    : null;
  const guardedEmbedder: SkillEmbedder = {
    modelId: embedderModelId,
    /**
     * Tags local embedding failures before they cross the dependency boundary.
     * The intent is for Doctor to distinguish model-loader failure from an LLM
     * generator outage without parsing vendor error strings.
     *
     * @param texts Synthetic trigger queries to embed with the shared model.
     * @returns L2-normalized vectors from the configured local embedder.
     */
    async embed(texts) {
      try {
        return await embedder.embed(texts);
      } catch (error) {
        throw new Tool2VecDependencyFailure('embedder-down', error);
      }
    },
  };
  const embedderAvailable = options.isEmbedderAvailable
    ?? (() => isEmbeddingModelCached(cacheDir, embedderModelId));

  ensureStateSchema(store.db);

  const readState = store.db.prepare(`SELECT * FROM ${STATE_TABLE} WHERE id = 1`);
  const acquireLease = store.db.prepare(`
    UPDATE ${STATE_TABLE}
    SET lease_owner = ?, lease_expires_at = ?, last_trigger = ?, last_started_at = ?,
        last_error_kind = NULL, last_error = NULL
    WHERE id = 1 AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)
  `);
  const renewLease = store.db.prepare(`
    UPDATE ${STATE_TABLE} SET lease_expires_at = ? WHERE id = 1 AND lease_owner = ?
  `);
  const finishLease = store.db.prepare(`
    UPDATE ${STATE_TABLE}
    SET lease_owner = NULL, lease_expires_at = NULL, generator_id = ?, embedder_model_id = ?,
        catalog_hash = ?, last_completed_at = ?, last_error_kind = ?, last_error = ?
    WHERE id = 1 AND lease_owner = ?
  `);

  /**
   * Loads the full configured skill catalog for a status or reconcile pass.
   * The purpose is to make every caller compare the same catalog boundaries.
   *
   * @returns Current catalog entries with stable ids and content hashes.
   */
  function scan(): SkillEntry[] {
    return loadSkillCatalog(roots.map((root) => root.path), { onWarning: options.onWarning });
  }

  /**
   * Projects durable rows and the current catalog into operator-facing state.
   * The design performs no generation, so Doctor, MCP, and GET status remain
   * safe even when the cache is cold or dependencies are unavailable.
   *
   * @param skills Optional already-scanned catalog to avoid duplicate I/O.
   * @returns Current coverage, lease, dependency, and checkpoint metadata.
   */
  function buildStatus(skills: SkillEntry[] = scan()): Tool2VecReconcileStatus {
    const row = readState.get() as ReconcileRow;
    const catalogHash = catalogFingerprint(skills);
    const expectedGeneratorId = runtime?.model ?? row.generator_id ?? configuredGeneratorId;
    const expectedEmbedderModelId = embedderModelId;
    const coverage = store.coverage(skills, {
      generatorId: expectedGeneratorId,
      embedderModelId: expectedEmbedderModelId,
    });
    const currentTime = now();
    const leaseActive = !!row.lease_owner && (row.lease_expires_at ?? 0) > currentTime;
    const fullyCurrent = coverage.current === coverage.total;
    let state: Tool2VecReconcileState;
    if (leaseActive) state = 'reconciling';
    else if (fullyCurrent) state = 'current';
    else if (row.last_error_kind === 'embedder-down' || !embedderAvailable()) state = 'embedder-down';
    else if (row.last_error_kind === 'generator-down') state = 'generator-down';
    else state = 'cold';

    return {
      state,
      configured: runtime !== null,
      backend: runtime?.backend ?? null,
      generatorModel: runtime?.model ?? row.generator_id ?? null,
      embedderModel: expectedEmbedderModelId,
      catalogHash,
      total: coverage.total,
      current: coverage.current,
      missing: coverage.missing,
      stale: coverage.stale,
      coveragePct: coverage.total === 0 ? 100 : Number(((coverage.current / coverage.total) * 100).toFixed(1)),
      leaseOwner: leaseActive ? row.lease_owner : null,
      leaseExpiresAt: leaseActive ? row.lease_expires_at : null,
      lastTrigger: row.last_trigger,
      lastStartedAt: row.last_started_at,
      lastCompletedAt: row.last_completed_at,
      lastErrorKind: row.last_error_kind,
      lastError: row.last_error,
    };
  }

  return {
    /**
     * Reads current-hash coverage without invoking an embedder or generator.
     * The purpose is a side-effect-free status contract for Doctor and MCP.
     *
     * @returns The latest catalog coverage and reconciliation state.
     */
    status() {
      return buildStatus();
    },

    /**
     * Reconciles a bounded number of missing current-hash centroids under the
     * shared lease. The design commits each row immediately so interruption
     * resumes at the next miss instead of replaying completed model work.
     *
     * @param options Trigger provenance, optional batch limit, and abort signal.
     * @returns Coverage plus lease acquisition and checkpoint progress counts.
     */
    async reconcile({ trigger, maxSkills = DEFAULT_BATCH, signal }) {
      const skills = scan();
      const before = buildStatus(skills);
      if (!runtime || !guardedGenerator) {
        return {
          ...before,
          trigger,
          acquired: false,
          embedded: 0,
          reused: before.current,
          removed: 0,
          stoppedEarly: before.current < before.total,
        };
      }

      const startedAt = now();
      const acquired = acquireLease.run(
        ownerId,
        startedAt + leaseMs,
        trigger,
        startedAt,
        startedAt,
      ).changes > 0;
      if (!acquired) {
        return {
          ...buildStatus(skills),
          trigger,
          acquired: false,
          embedded: 0,
          reused: before.current,
          removed: 0,
          stoppedEarly: true,
        };
      }

      const limit = Number.isFinite(maxSkills)
        ? Math.max(1, Math.floor(maxSkills))
        : Number.MAX_SAFE_INTEGER;
      let embedded = 0;
      let reused = 0;
      let removed = 0;
      let failureKind: 'embedder-down' | 'generator-down' | null = null;
      let failureMessage: string | null = null;

      try {
        for (const skill of skills) {
          if (signal?.aborted || embedded >= limit) break;
          const cached = store.get(skill.id, skill.contentHash);
          if (cached) {
            reused++;
            continue;
          }
          renewLease.run(now() + leaseMs, ownerId);
          try {
            const built = await getOrBuildCentroid(skill, store, guardedEmbedder, guardedGenerator);
            if (!built) {
              throw new Error(`synthetic query generator returned no usable queries for ${skill.id}`);
            }
            embedded++;
          } catch (error) {
            failureKind = errorKind(error);
            failureMessage = boundedError(error);
            options.onWarning?.(`skill-graft reconciler stopped at ${skill.id}: ${failureMessage}`);
            break;
          }
        }
        removed = store.prune(skills.map((skill) => skill.id));
      } finally {
        finishLease.run(
          runtime.model,
          embedderModelId,
          catalogFingerprint(skills),
          now(),
          failureKind,
          failureMessage,
          ownerId,
        );
      }

      const after = buildStatus(skills);
      return {
        ...after,
        trigger,
        acquired: true,
        embedded,
        reused,
        removed,
        stoppedEarly: after.current < after.total,
      };
    },
  };
}
