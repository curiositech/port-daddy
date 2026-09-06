import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import type { DatabaseInstance } from './sqlite-runtime.js';
import { appendEvent, ensureEventLedgerSchema } from './agent-harbor/event-ledger.js';
import { createContinuationStore, type ContinuationReceipt } from './continuation-runtime.js';
import {
  sanitizeHandoffText,
  type GitleaksRunner,
} from './handoff-capsule.js';
import type { SemanticResolver } from './semantic-resolver.js';
import { getWorktreeInfo } from './worktree.js';
import type { ForensicsSink } from './forensics-archive.js';
import { IDENTITY_RESURRECTED_RULE, IDENTITY_RETIRED_RULE } from './actor-souls.js';

export const DURABLE_AGENT_PROFILE_SCHEMA = 'pd.agent-harbor.durable-agent-profile.v0' as const;

const MAX_PROFILE_BYTES = 512 * 1024;
const MAX_LIST_ITEMS = 100;
const RRF_K = 60;
const PROFILE_SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
const FILESYSTEM_POLICIES = new Set(['inherit', 'repo', 'workspace', 'read-only']);
const NETWORK_POLICIES = new Set(['inherit', 'none', 'restricted', 'full']);

export type DurableAgentLifecycle = 'ready' | 'paused' | 'retired';
export type DurableAgentScopeKind = 'system' | 'repo';
export type DurableAgentOriginKind = 'wizard' | 'session-promotion';

export interface DurableAgentScope {
  kind: DurableAgentScopeKind;
  key: string;
  repoRoot: string | null;
  repoName: string | null;
}

export interface DurableAgentOrigin {
  kind: DurableAgentOriginKind;
  sourceSessionId: string | null;
  handoffEpisodeId: number | null;
  sourceAgentId: string | null;
  sourceAdapter: string | null;
  promotedAt: string | null;
}

export interface DurableAgentBackendPreference {
  backend: string;
  model: string | null;
}

export interface DurableAgentTriggerDeclaration {
  kind: 'manual' | 'schedule' | 'webhook' | 'email' | 'message' | 'task-state' | 'agent';
  label: string;
  configurationRef: string | null;
  status: 'declared';
}

export interface DurableAgentProfileV0 {
  schema: typeof DURABLE_AGENT_PROFILE_SCHEMA;
  revision: number;
  slug: string;
  displayName: string;
  scope: DurableAgentScope;
  lifecycle: DurableAgentLifecycle;
  remit: string;
  instructions: string;
  skills: string[];
  tools: string[];
  backendPreferences: DurableAgentBackendPreference[];
  permissionPolicy: {
    filesystem: 'inherit' | 'repo' | 'workspace' | 'read-only';
    network: 'inherit' | 'none' | 'restricted' | 'full';
    allowedTools: string[];
    deniedTools: string[];
    enforcement: 'declaration-only';
  };
  memory: {
    handoff: 'sanitized-only';
    archiveSearch: boolean;
    compaction: 'episodic';
    handoffEpisodeIds: number[];
    latestHandoffEpisodeId: number | null;
  };
  triggers: DurableAgentTriggerDeclaration[];
  origin: DurableAgentOrigin;
  createdAt: string;
  updatedAt: string;
}

export interface DurableAgentRecord {
  agentNodeId: string;
  identity: string;
  class: 'voyager';
  authority: 'local';
  status: 'active' | 'paused' | 'retired';
  complianceLevel: string;
  profile: DurableAgentProfileV0;
  ledgerSeq: number;
  continuation: {
    available: boolean;
    episodeId: number | null;
    endpoint: string | null;
    durableAgentId: string;
    receipts: ContinuationReceipt[];
  };
}

export interface DurableAgentSearchHit {
  agent: DurableAgentRecord;
  rank: number;
  evidence: {
    lexicalRank: number | null;
    semanticRank: number | null;
    sources: Array<'bm25' | 'semantic'>;
  };
}

export interface DurableAgentSearchResult {
  query: string;
  hits: DurableAgentSearchHit[];
  degraded: boolean;
  warnings: string[];
  embedder: string;
}

export interface CreateDurableAgentInput {
  slug: string;
  displayName?: string;
  scope: { kind: DurableAgentScopeKind; repoRoot?: string | null };
  remit: string;
  instructions: string;
  skills?: string[];
  tools?: string[];
  backendPreferences?: Array<{ backend: string; model?: string | null }>;
  permissionPolicy?: {
    filesystem?: DurableAgentProfileV0['permissionPolicy']['filesystem'];
    network?: DurableAgentProfileV0['permissionPolicy']['network'];
    allowedTools?: string[];
    deniedTools?: string[];
  };
  archiveSearch?: boolean;
  triggers?: Array<{
    kind: DurableAgentTriggerDeclaration['kind'];
    label: string;
    configurationRef?: string | null;
  }>;
  lifecycle?: DurableAgentLifecycle;
  origin?: Partial<DurableAgentOrigin> & { kind: DurableAgentOriginKind };
}

export interface UpdateDurableAgentInput {
  slug?: string;
  displayName?: string;
  remit?: string;
  instructions?: string;
  skills?: string[];
  tools?: string[];
  backendPreferences?: CreateDurableAgentInput['backendPreferences'];
  permissionPolicy?: CreateDurableAgentInput['permissionPolicy'];
  archiveSearch?: boolean;
  triggers?: CreateDurableAgentInput['triggers'];
  lifecycle?: DurableAgentLifecycle;
}

export class DurableAgentRosterError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'DurableAgentRosterError';
  }
}

interface LatestNodeFact {
  ledgerSeq: number;
  payload: Record<string, unknown>;
  profile: DurableAgentProfileV0;
}

interface EmbeddingRow {
  profile_revision: number;
  model_id: string;
  document_hash: string;
  embedding: Buffer;
}

interface DurableAgentRosterDeps {
  resolver: Pick<SemanticResolver, 'embed' | 'modelId'>;
  gitleaksRunner?: GitleaksRunner;
  now?: () => Date;
  logger?: {
    info?(message: string, meta?: Record<string, unknown>): void;
    error?(message: string, meta?: Record<string, unknown>): void;
  };
  /**
   * Durable security-forensics journal (ADR-0089). Retirement and audited
   * resurrection of a durable agent identity are written here so a
   * retire-and-respawn whitewash leaves a trail outside the live DB.
   */
  forensicsSink?: ForensicsSink;
}

/** Audit stamp carried ONLY on the fact that resurrects a retired agent. */
export interface DurableAgentResurrection {
  receipt: string;
  at: string;
  by: string;
  reason: string;
  /** ledger_seq of the retired fact this resurrection supersedes. */
  fromLedgerSeq: number;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Crockford base32 ULID — same shape as an actor soul's receipt. */
function receiptUlid(nowMs: number): string {
  let ts = nowMs;
  const time = new Array<string>(10);
  for (let i = 9; i >= 0; i--) {
    time[i] = CROCKFORD[ts % 32];
    ts = Math.floor(ts / 32);
  }
  const rnd = randomBytes(10);
  const rand: string[] = [];
  let bitBuffer = 0;
  let bits = 0;
  for (let i = 0; i < rnd.length; i++) {
    bitBuffer = (bitBuffer << 8) | rnd[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      rand.push(CROCKFORD[(bitBuffer >> bits) & 31]);
    }
  }
  return time.join('') + rand.join('');
}

interface DurableAgentCreateOptions {
  verifiedPromotion?: boolean;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function identifier(value: unknown, field: string, maxBytes = 1_024): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DurableAgentRosterError(`${field} is required`, 'INVALID_PROFILE', 400);
  }
  const normalized = value.trim();
  if (Buffer.byteLength(normalized, 'utf8') > maxBytes || /[\0\r\n]/.test(normalized)) {
    throw new DurableAgentRosterError(`${field} exceeds its safe identifier boundary`, 'INVALID_PROFILE', 400);
  }
  return normalized;
}

function boundedArray(value: unknown, field: string, limit = MAX_LIST_ITEMS): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > limit) {
    throw new DurableAgentRosterError(`${field} must be an array with at most ${limit} items`, 'INVALID_PROFILE', 400);
  }
  return Array.from(new Set(value.map((item, index) => identifier(item, `${field}[${index}]`, 512))));
}

function booleanValue(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    throw new DurableAgentRosterError(`${field} must be a boolean`, 'INVALID_PROFILE', 400);
  }
  return value;
}

function normalizePermissionPolicy(
  value: unknown,
  fallback?: DurableAgentProfileV0['permissionPolicy'],
): Omit<DurableAgentProfileV0['permissionPolicy'], 'enforcement'> {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
    throw new DurableAgentRosterError('permissionPolicy must be an object', 'INVALID_PROFILE', 400);
  }
  const input = (value ?? {}) as Record<string, unknown>;
  const filesystem = input.filesystem ?? fallback?.filesystem ?? 'inherit';
  const network = input.network ?? fallback?.network ?? 'inherit';
  if (typeof filesystem !== 'string' || !FILESYSTEM_POLICIES.has(filesystem)) {
    throw new DurableAgentRosterError('permissionPolicy.filesystem is invalid', 'INVALID_PROFILE', 400);
  }
  if (typeof network !== 'string' || !NETWORK_POLICIES.has(network)) {
    throw new DurableAgentRosterError('permissionPolicy.network is invalid', 'INVALID_PROFILE', 400);
  }
  return {
    filesystem: filesystem as DurableAgentProfileV0['permissionPolicy']['filesystem'],
    network: network as DurableAgentProfileV0['permissionPolicy']['network'],
    allowedTools: input.allowedTools === undefined
      ? fallback?.allowedTools ?? []
      : boundedArray(input.allowedTools, 'permissionPolicy.allowedTools'),
    deniedTools: input.deniedTools === undefined
      ? fallback?.deniedTools ?? []
      : boundedArray(input.deniedTools, 'permissionPolicy.deniedTools'),
  };
}

function normalizeOrigin(
  value: unknown,
  createdAt: string,
  verifiedPromotion: boolean,
): DurableAgentOrigin {
  if (value === undefined) {
    return {
      kind: 'wizard',
      sourceSessionId: null,
      handoffEpisodeId: null,
      sourceAgentId: null,
      sourceAdapter: null,
      promotedAt: null,
    };
  }
  if (!verifiedPromotion) {
    throw new DurableAgentRosterError(
      'origin is server-derived; use the verified session-promotion route',
      'UNVERIFIED_PROMOTION_ORIGIN',
      400,
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DurableAgentRosterError('origin must be an object', 'INVALID_PROFILE', 400);
  }
  const input = value as Record<string, unknown>;
  if (input.kind !== 'session-promotion') {
    throw new DurableAgentRosterError('verified origin must be session-promotion', 'INVALID_PROFILE', 400);
  }
  const handoffEpisodeId = Number(input.handoffEpisodeId);
  if (!Number.isInteger(handoffEpisodeId) || handoffEpisodeId < 1) {
    throw new DurableAgentRosterError('origin.handoffEpisodeId must be a positive integer', 'INVALID_PROFILE', 400);
  }
  return {
    kind: 'session-promotion',
    sourceSessionId: identifier(input.sourceSessionId, 'origin.sourceSessionId'),
    handoffEpisodeId,
    sourceAgentId: input.sourceAgentId == null ? null : identifier(input.sourceAgentId, 'origin.sourceAgentId'),
    sourceAdapter: input.sourceAdapter == null ? null : identifier(input.sourceAdapter, 'origin.sourceAdapter'),
    promotedAt: createdAt,
  };
}

function sanitizeProfileText<T extends Record<string, unknown>>(
  input: T,
  gitleaksRunner?: GitleaksRunner,
): T {
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PROFILE_BYTES) {
    throw new DurableAgentRosterError('durable agent profile exceeds 512 KiB', 'INVALID_PROFILE', 413);
  }
  const sanitized = sanitizeHandoffText(serialized, { gitleaksRunner, maxBytes: MAX_PROFILE_BYTES });
  try {
    return JSON.parse(sanitized) as T;
  } catch {
    throw new DurableAgentRosterError('sanitized profile could not be decoded', 'INVALID_PROFILE', 400);
  }
}

function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function normalizeSlug(value: unknown): string {
  const slug = identifier(value, 'slug', 128).toLowerCase();
  if (!PROFILE_SLUG.test(slug) || slug.length > 96) {
    throw new DurableAgentRosterError(
      'slug must be a meaningful lowercase hyphenated name such as portdaddy-typography-expert',
      'INVALID_AGENT_SLUG',
      400,
    );
  }
  if (slug.split('-').some((part) => /^\d+$/.test(part) || /^[a-f0-9]{12,}$/i.test(part))) {
    throw new DurableAgentRosterError('slug cannot use opaque numeric or hash segments', 'INVALID_AGENT_SLUG', 400);
  }
  return slug;
}

function realpathOrResolve(path: string): string {
  const absolute = isAbsolute(path) ? path : resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

export function normalizeDurableAgentScope(input: CreateDurableAgentInput['scope']): DurableAgentScope {
  if (!input || (input.kind !== 'system' && input.kind !== 'repo')) {
    throw new DurableAgentRosterError('scope.kind must be system or repo', 'INVALID_SCOPE', 400);
  }
  if (input.kind === 'system') {
    return { kind: 'system', key: 'system', repoRoot: null, repoName: null };
  }
  const requestedRoot = identifier(input.repoRoot, 'scope.repoRoot', 32 * 1024);
  const info = getWorktreeInfo(requestedRoot);
  if (!info) {
    throw new DurableAgentRosterError('repo-scoped agents require a Git repository root', 'INVALID_SCOPE', 400);
  }
  const commonDir = realpathOrResolve(resolve(info.root, info.commonDir));
  const canonicalRoot = basename(commonDir) === '.git' ? dirname(commonDir) : realpathOrResolve(info.root);
  return {
    kind: 'repo',
    key: `repo:${sha256(commonDir).slice(0, 24)}`,
    repoRoot: canonicalRoot,
    repoName: basename(canonicalRoot),
  };
}

function nodeStatus(lifecycle: DurableAgentLifecycle): DurableAgentRecord['status'] {
  if (lifecycle === 'ready') return 'active';
  return lifecycle;
}

function vectorToBlob(vector: number[]): Buffer {
  const float = new Float32Array(vector);
  return Buffer.from(float.buffer, float.byteOffset, float.byteLength);
}

function blobToVector(blob: Buffer): Float32Array {
  const copy = Buffer.from(blob);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const length = Math.min(a.length, b.length);
  let total = 0;
  for (let index = 0; index < length; index += 1) total += Number(a[index]) * Number(b[index]);
  return total;
}

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/i).filter((token) => token.length > 1);
}

function searchDocument(profile: DurableAgentProfileV0): string {
  return [
    profile.slug,
    profile.displayName,
    profile.remit,
    profile.instructions,
    ...profile.skills,
    ...profile.tools,
    ...profile.backendPreferences.flatMap((item) => [item.backend, item.model ?? '']),
  ].filter(Boolean).join('\n');
}

function bm25(query: string, documents: Array<{ id: string; text: string }>): Map<string, number> {
  const queryTokens = tokenize(query);
  const tokenized = documents.map((document) => ({ ...document, tokens: tokenize(document.text) }));
  const averageLength = tokenized.reduce((sum, document) => sum + document.tokens.length, 0) / Math.max(tokenized.length, 1);
  const frequency = new Map<string, number>();
  for (const term of new Set(queryTokens)) {
    frequency.set(term, tokenized.filter((document) => document.tokens.includes(term)).length);
  }
  const scores = new Map<string, number>();
  for (const document of tokenized) {
    let score = 0;
    for (const term of queryTokens) {
      const documentFrequency = frequency.get(term) ?? 0;
      if (documentFrequency === 0) continue;
      const termFrequency = document.tokens.filter((token) => token === term).length;
      if (termFrequency === 0) continue;
      const inverse = Math.log(1 + (documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5));
      const denominator = termFrequency + 1.2 * (1 - 0.75 + 0.75 * (document.tokens.length / Math.max(averageLength, 1)));
      score += inverse * ((termFrequency * 2.2) / denominator);
    }
    if (score > 0) scores.set(document.id, score);
  }
  return scores;
}

function rankedIds(scores: Map<string, number>): string[] {
  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([id]) => id);
}

function readLatestFacts(db: DatabaseInstance): LatestNodeFact[] {
  ensureEventLedgerSchema(db);
  const rows = db.prepare(`
    SELECT ledger_seq, payload_json
    FROM (
      SELECT ledger_seq, payload_json,
             ROW_NUMBER() OVER (PARTITION BY agent_node_id ORDER BY ledger_seq DESC) AS row_rank
      FROM harbor_events
      WHERE stream_type = 'agent-node' AND agent_node_id IS NOT NULL
    )
    WHERE row_rank = 1
    ORDER BY ledger_seq DESC
  `).all() as Array<{ ledger_seq: number; payload_json: string }>;
  const facts: LatestNodeFact[] = [];
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      const profile = payload.profile as DurableAgentProfileV0 | undefined;
      if (profile?.schema !== DURABLE_AGENT_PROFILE_SCHEMA) continue;
      facts.push({ ledgerSeq: row.ledger_seq, payload, profile });
    } catch {
      continue;
    }
  }
  return facts;
}

function normalizeBackendPreferences(value: CreateDurableAgentInput['backendPreferences']): DurableAgentBackendPreference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 25) {
    throw new DurableAgentRosterError('backendPreferences must contain at most 25 entries', 'INVALID_PROFILE', 400);
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new DurableAgentRosterError(`backendPreferences[${index}] must be an object`, 'INVALID_PROFILE', 400);
    }
    const backend = identifier(item.backend, `backendPreferences[${index}].backend`, 128);
    if (seen.has(backend)) {
      throw new DurableAgentRosterError(`backendPreferences repeats ${backend}`, 'INVALID_PROFILE', 400);
    }
    seen.add(backend);
    return {
      backend,
      model: item.model == null ? null : identifier(item.model, `backendPreferences[${index}].model`, 512),
    };
  });
}

function normalizeTriggers(value: CreateDurableAgentInput['triggers']): DurableAgentTriggerDeclaration[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) {
    throw new DurableAgentRosterError('triggers must contain at most 50 entries', 'INVALID_PROFILE', 400);
  }
  const kinds = new Set<DurableAgentTriggerDeclaration['kind']>([
    'manual', 'schedule', 'webhook', 'email', 'message', 'task-state', 'agent',
  ]);
  return value.map((item, index) => {
    if (!item || !kinds.has(item.kind)) {
      throw new DurableAgentRosterError(`triggers[${index}].kind is invalid`, 'INVALID_PROFILE', 400);
    }
    return {
      kind: item.kind,
      label: identifier(item.label, `triggers[${index}].label`, 512),
      configurationRef: item.configurationRef == null
        ? null
        : identifier(item.configurationRef, `triggers[${index}].configurationRef`, 1_024),
      status: 'declared',
    };
  });
}

function validateLifecycle(value: unknown): DurableAgentLifecycle {
  if (value === undefined) return 'paused';
  if (value !== 'ready' && value !== 'paused' && value !== 'retired') {
    throw new DurableAgentRosterError('lifecycle must be ready, paused, or retired', 'INVALID_PROFILE', 400);
  }
  return value;
}

export function createDurableAgentRoster(db: DatabaseInstance, deps: DurableAgentRosterDeps) {
  const now = deps.now ?? (() => new Date());
  const continuationStore = createContinuationStore(db, { recoverExpired: false });

  db.exec(`
    CREATE TABLE IF NOT EXISTS durable_agent_profile_embeddings (
      agent_node_id    TEXT PRIMARY KEY,
      profile_revision INTEGER NOT NULL,
      model_id         TEXT NOT NULL,
      document_hash    TEXT NOT NULL,
      embedding        BLOB NOT NULL,
      updated_at       INTEGER NOT NULL
    );
  `);
  const embeddingColumns = new Set(
    (db.prepare('PRAGMA table_info(durable_agent_profile_embeddings)').all() as Array<{ name: string }>).map((column) => column.name),
  );
  for (const required of ['agent_node_id', 'profile_revision', 'model_id', 'document_hash', 'embedding', 'updated_at']) {
    if (!embeddingColumns.has(required)) {
      throw new Error(`durable_agent_profile_embeddings migration verification failed: missing ${required}`);
    }
  }

  // ─── Retired is final unless resurrected (identity keystone) ─────────────────
  // A durable agent's lifecycle lives in an append-only fact stream, so the
  // "row" is the newest agent-node fact. Any writer that appends a fact with a
  // non-retired lifecycle on top of a retired one has reactivated the identity
  // — PATCH /durable-agents/:id used to do exactly that with no audit. The
  // ledger now refuses such a fact unless it carries a resurrection receipt
  // that the previous fact did not already carry (a replayed receipt is not a
  // fresh audit). This is the ledger-shaped twin of the actor_souls trigger:
  // enforcement at the DB, the app layer merely explains it.
  ensureEventLedgerSchema(db);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS harbor_events_agent_node_no_silent_resurrection
    BEFORE INSERT ON harbor_events
    WHEN NEW.stream_type = 'agent-node'
     AND NEW.agent_node_id IS NOT NULL
     AND json_extract(NEW.payload_json, '$.profile.lifecycle') IS NOT 'retired'
     AND (SELECT json_extract(payload_json, '$.profile.lifecycle')
            FROM harbor_events
           WHERE stream_type = 'agent-node' AND agent_node_id = NEW.agent_node_id
           ORDER BY ledger_seq DESC LIMIT 1) = 'retired'
     AND (json_extract(NEW.payload_json, '$.resurrection.receipt') IS NULL
       OR json_extract(NEW.payload_json, '$.resurrection.receipt') IS
          (SELECT json_extract(payload_json, '$.resurrection.receipt')
             FROM harbor_events
            WHERE stream_type = 'agent-node' AND agent_node_id = NEW.agent_node_id
            ORDER BY ledger_seq DESC LIMIT 1))
    BEGIN
      SELECT RAISE(ABORT, 'DURABLE_AGENT_RETIRED: a retired durable agent can only be reactivated by an audited resurrection carrying a fresh receipt');
    END;
  `);
  const ledgerTriggers = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'harbor_events'").all() as Array<{ name: string }>)
      .map((row) => row.name),
  );
  if (!ledgerTriggers.has('harbor_events_agent_node_no_silent_resurrection')) {
    throw new Error('harbor_events migration verification failed: agent-node no-silent-resurrection trigger missing.');
  }

  function journal(rule: string, agentNodeId: string, metadata: Record<string, unknown>, details: string): void {
    deps.forensicsSink?.record({
      timestamp: now().getTime(),
      rule,
      severity: 'warning',
      details,
      agentId: agentNodeId,
      metadata: { surface: 'durable_agent_roster', ...metadata },
    });
  }

  const getEmbedding = db.prepare(`
    SELECT profile_revision, model_id, document_hash, embedding
    FROM durable_agent_profile_embeddings WHERE agent_node_id = ?
  `);
  const putEmbedding = db.prepare(`
    INSERT INTO durable_agent_profile_embeddings
      (agent_node_id, profile_revision, model_id, document_hash, embedding, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_node_id) DO UPDATE SET
      profile_revision = excluded.profile_revision,
      model_id = excluded.model_id,
      document_hash = excluded.document_hash,
      embedding = excluded.embedding,
      updated_at = excluded.updated_at
  `);

  function findFact(agentNodeId: string): LatestNodeFact {
    const fact = readLatestFacts(db).find((candidate) => candidate.payload.agentNodeId === agentNodeId);
    if (!fact) throw new DurableAgentRosterError(`durable agent ${agentNodeId} not found`, 'DURABLE_AGENT_NOT_FOUND', 404);
    return fact;
  }

  function assertUniqueAlias(scopeKey: string, slug: string, exceptAgentNodeId?: string): void {
    const collision = readLatestFacts(db).find((fact) =>
      fact.profile.scope.key === scopeKey
      && fact.profile.slug === slug
      && fact.payload.agentNodeId !== exceptAgentNodeId,
    );
    if (collision) {
      throw new DurableAgentRosterError(
        `durable agent alias ${slug} already exists in ${scopeKey}`,
        'DURABLE_AGENT_ALIAS_CONFLICT',
        409,
      );
    }
  }

  function toRecord(fact: LatestNodeFact, includeReceipts = false): DurableAgentRecord {
    const agentNodeId = String(fact.payload.agentNodeId);
    const episodeId = fact.profile.memory.latestHandoffEpisodeId;
    return {
      agentNodeId,
      identity: String(fact.payload.identity),
      class: 'voyager',
      authority: 'local',
      status: nodeStatus(fact.profile.lifecycle),
      complianceLevel: String(fact.payload.complianceLevel ?? 'C0'),
      profile: fact.profile,
      ledgerSeq: fact.ledgerSeq,
      continuation: {
        available: episodeId !== null && fact.profile.lifecycle !== 'retired',
        episodeId,
        endpoint: episodeId === null ? null : `/memory/handoffs/${episodeId}/continue`,
        durableAgentId: agentNodeId,
        receipts: includeReceipts ? continuationStore.list({ durableAgentId: agentNodeId, limit: 100 }) : [],
      },
    };
  }

  function buildProfile(input: CreateDurableAgentInput, verifiedPromotion: boolean): DurableAgentProfileV0 {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new DurableAgentRosterError('durable agent profile must be an object', 'INVALID_PROFILE', 400);
    }
    const slug = normalizeSlug(input.slug);
    const scope = normalizeDurableAgentScope(input.scope);
    const lifecycle = validateLifecycle(input.lifecycle);
    const createdAt = now().toISOString();
    const origin = normalizeOrigin(input.origin, createdAt, verifiedPromotion);

    const raw = {
      displayName: input.displayName == null ? titleFromSlug(slug) : identifier(input.displayName, 'displayName', 512),
      remit: identifier(input.remit, 'remit', 32 * 1024),
      instructions: identifier(input.instructions, 'instructions', 256 * 1024),
      skills: boundedArray(input.skills, 'skills'),
      tools: boundedArray(input.tools, 'tools'),
      backendPreferences: normalizeBackendPreferences(input.backendPreferences),
      permissionPolicy: normalizePermissionPolicy(input.permissionPolicy),
      triggers: normalizeTriggers(input.triggers),
    };
    const clean = sanitizeProfileText(raw, deps.gitleaksRunner);
    const episodeIds = origin.handoffEpisodeId === null ? [] : [origin.handoffEpisodeId];
    return {
      schema: DURABLE_AGENT_PROFILE_SCHEMA,
      revision: 1,
      slug,
      displayName: clean.displayName,
      scope,
      lifecycle,
      remit: clean.remit,
      instructions: clean.instructions,
      skills: clean.skills,
      tools: clean.tools,
      backendPreferences: clean.backendPreferences,
      permissionPolicy: {
        ...clean.permissionPolicy,
        enforcement: 'declaration-only',
      },
      memory: {
        handoff: 'sanitized-only',
        archiveSearch: booleanValue(input.archiveSearch, 'archiveSearch', true),
        compaction: 'episodic',
        handoffEpisodeIds: episodeIds,
        latestHandoffEpisodeId: origin.handoffEpisodeId,
      },
      triggers: clean.triggers,
      origin,
      createdAt,
      updatedAt: createdAt,
    };
  }

  function nodePayload(
    agentNodeId: string,
    profile: DurableAgentProfileV0,
    previous?: Record<string, unknown>,
    resurrection?: DurableAgentResurrection,
  ): Record<string, unknown> {
    const repoIdentity = profile.scope.repoName ?? 'system';
    // The resurrection stamp is evidence for ONE fact. It must not ride the
    // `previous` spread onto every later fact, or the ledger trigger's
    // "carries a fresh receipt" test would be satisfied forever after.
    const { resurrection: _carried, ...carried } = previous ?? {};
    return {
      ...carried,
      ...(resurrection ? { resurrection } : {}),
      schema: 'pd.agent-harbor.agent-node.v0',
      agentNodeId,
      identity: `${repoIdentity}:roster:${profile.slug}`,
      displayName: profile.displayName,
      class: 'voyager',
      role: profile.remit,
      authority: 'local',
      complianceLevel: previous?.complianceLevel ?? 'C0',
      status: nodeStatus(profile.lifecycle),
      memoryScopeId: previous?.memoryScopeId ?? `memory_scope_${agentNodeId}`,
      workspace: profile.scope.repoRoot ? { repo: profile.scope.repoRoot } : undefined,
      createdAt: previous?.createdAt ?? profile.createdAt,
      lastEventAt: profile.updatedAt,
      profile,
    };
  }

  async function refreshEmbedding(record: DurableAgentRecord): Promise<void> {
    const document = searchDocument(record.profile);
    const documentHash = sha256(document);
    const existing = getEmbedding.get(record.agentNodeId) as EmbeddingRow | undefined;
    if (
      existing
      && existing.profile_revision === record.profile.revision
      && existing.model_id === deps.resolver.modelId
      && existing.document_hash === documentHash
    ) return;
    const vector = await deps.resolver.embed(document);
    if (!Array.isArray(vector) || vector.length === 0) throw new Error('shared embedder returned no vector');
    putEmbedding.run(
      record.agentNodeId,
      record.profile.revision,
      deps.resolver.modelId,
      documentHash,
      vectorToBlob(vector),
      now().getTime(),
    );
  }

  async function create(
    input: CreateDurableAgentInput,
    options: DurableAgentCreateOptions = {},
  ): Promise<{ agent: DurableAgentRecord; warnings: string[] }> {
    const profile = buildProfile(input, options.verifiedPromotion === true);
    assertUniqueAlias(profile.scope.key, profile.slug);
    const agentNodeId = `agent_node_${randomUUID()}`;
    appendEvent(db, { streamType: 'agent-node', payload: nodePayload(agentNodeId, profile) });
    const agent = toRecord(findFact(agentNodeId), true);
    const warnings: string[] = [];
    try {
      await refreshEmbedding(agent);
    } catch (error) {
      warnings.push('semantic profile indexing is pending; run pd doctor if the shared embedder is unavailable');
      deps.logger?.error?.('durable_agent_embedding_failed', {
        agentNodeId,
        errorType: error instanceof Error ? error.name : 'unknown',
      });
    }
    return { agent, warnings };
  }

  function list(options: {
    scopeKey?: string;
    repoRoot?: string;
    includeRetired?: boolean;
    limit?: number;
  } = {}): DurableAgentRecord[] {
    let scopeKey = options.scopeKey;
    if (!scopeKey && options.repoRoot) scopeKey = normalizeDurableAgentScope({ kind: 'repo', repoRoot: options.repoRoot }).key;
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
    return readLatestFacts(db)
      .filter((fact) => !scopeKey || fact.profile.scope.key === scopeKey)
      .filter((fact) => options.includeRetired || fact.profile.lifecycle !== 'retired')
      .slice(0, limit)
      .map((fact) => toRecord(fact));
  }

  function get(agentNodeId: string): DurableAgentRecord {
    return toRecord(findFact(identifier(agentNodeId, 'agentNodeId')), true);
  }

  async function update(agentNodeId: string, input: UpdateDurableAgentInput): Promise<{ agent: DurableAgentRecord; warnings: string[] }> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new DurableAgentRosterError('durable agent update must be an object', 'INVALID_PROFILE', 400);
    }
    const current = findFact(identifier(agentNodeId, 'agentNodeId'));
    const profile = current.profile;
    const slug = input.slug === undefined ? profile.slug : normalizeSlug(input.slug);
    const lifecycle = input.lifecycle === undefined ? profile.lifecycle : validateLifecycle(input.lifecycle);
    // Retired is final on this path. The ledger trigger would abort the
    // append anyway; refusing here names the door the caller must use.
    if (profile.lifecycle === 'retired' && lifecycle !== 'retired') {
      throw new DurableAgentRosterError(
        `durable agent ${agentNodeId} is retired; reactivation requires an audited resurrection (POST /durable-agents/:id/resurrect)`,
        'DURABLE_AGENT_RETIRED',
        409,
      );
    }
    const raw = {
      displayName: input.displayName === undefined ? profile.displayName : identifier(input.displayName, 'displayName', 512),
      remit: input.remit === undefined ? profile.remit : identifier(input.remit, 'remit', 32 * 1024),
      instructions: input.instructions === undefined ? profile.instructions : identifier(input.instructions, 'instructions', 256 * 1024),
      skills: input.skills === undefined ? profile.skills : boundedArray(input.skills, 'skills'),
      tools: input.tools === undefined ? profile.tools : boundedArray(input.tools, 'tools'),
      backendPreferences: input.backendPreferences === undefined ? profile.backendPreferences : normalizeBackendPreferences(input.backendPreferences),
      permissionPolicy: normalizePermissionPolicy(input.permissionPolicy, profile.permissionPolicy),
      triggers: input.triggers === undefined ? profile.triggers : normalizeTriggers(input.triggers),
    };
    const clean = sanitizeProfileText(raw, deps.gitleaksRunner);
    assertUniqueAlias(profile.scope.key, slug, agentNodeId);
    const next: DurableAgentProfileV0 = {
      ...profile,
      revision: profile.revision + 1,
      slug,
      displayName: clean.displayName,
      lifecycle,
      remit: clean.remit,
      instructions: clean.instructions,
      skills: clean.skills,
      tools: clean.tools,
      backendPreferences: clean.backendPreferences,
      permissionPolicy: { ...clean.permissionPolicy, enforcement: 'declaration-only' },
      memory: {
        ...profile.memory,
        archiveSearch: booleanValue(input.archiveSearch, 'archiveSearch', profile.memory.archiveSearch),
      },
      triggers: clean.triggers,
      updatedAt: now().toISOString(),
    };
    appendEvent(db, { streamType: 'agent-node', payload: nodePayload(agentNodeId, next, current.payload) });
    const agent = get(agentNodeId);
    const warnings: string[] = [];
    try {
      await refreshEmbedding(agent);
    } catch (error) {
      warnings.push('semantic profile indexing is pending; run pd doctor if the shared embedder is unavailable');
      deps.logger?.error?.('durable_agent_embedding_failed', {
        agentNodeId,
        errorType: error instanceof Error ? error.name : 'unknown',
      });
    }
    return { agent, warnings };
  }

  async function attachHandoffEpisode(agentNodeId: string, episodeId: number): Promise<DurableAgentRecord> {
    if (!Number.isInteger(episodeId) || episodeId < 1) {
      throw new DurableAgentRosterError('episodeId must be a positive integer', 'INVALID_EPISODE_ID', 400);
    }
    const current = findFact(identifier(agentNodeId, 'agentNodeId'));
    const ids = Array.from(new Set([...current.profile.memory.handoffEpisodeIds, episodeId]));
    const profile: DurableAgentProfileV0 = {
      ...current.profile,
      revision: current.profile.revision + 1,
      memory: {
        ...current.profile.memory,
        handoffEpisodeIds: ids,
        latestHandoffEpisodeId: episodeId,
      },
      updatedAt: now().toISOString(),
    };
    appendEvent(db, { streamType: 'agent-node', payload: nodePayload(agentNodeId, profile, current.payload) });
    return get(agentNodeId);
  }

  function history(agentNodeId: string): Array<{ ledgerSeq: number; profile: DurableAgentProfileV0 }> {
    identifier(agentNodeId, 'agentNodeId');
    ensureEventLedgerSchema(db);
    const rows = db.prepare(`
      SELECT ledger_seq, payload_json FROM harbor_events
      WHERE stream_type = 'agent-node' AND agent_node_id = ?
      ORDER BY ledger_seq DESC
    `).all(agentNodeId) as Array<{ ledger_seq: number; payload_json: string }>;
    return rows.flatMap((row) => {
      try {
        const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
        const profile = payload.profile as DurableAgentProfileV0 | undefined;
        return profile?.schema === DURABLE_AGENT_PROFILE_SCHEMA
          ? [{ ledgerSeq: row.ledger_seq, profile }]
          : [];
      } catch {
        return [];
      }
    });
  }

  async function search(queryValue: string, options: {
    scopeKey?: string;
    repoRoot?: string;
    includeRetired?: boolean;
    limit?: number;
  } = {}): Promise<DurableAgentSearchResult> {
    const query = identifier(queryValue, 'query', 4_096);
    const agents = list({ ...options, limit: 500 });
    const lexicalScores = bm25(query, agents.map((agent) => ({ id: agent.agentNodeId, text: searchDocument(agent.profile) })));
    const lexical = rankedIds(lexicalScores);
    const semanticScores = new Map<string, number>();
    const warnings: string[] = [];
    let semanticAvailable = true;
    try {
      const queryVector = await deps.resolver.embed(query);
      if (!Array.isArray(queryVector) || queryVector.length === 0) throw new Error('shared embedder returned no query vector');
      for (const agent of agents) {
        try {
          await refreshEmbedding(agent);
          const row = getEmbedding.get(agent.agentNodeId) as EmbeddingRow | undefined;
          if (row) semanticScores.set(agent.agentNodeId, dot(queryVector, blobToVector(row.embedding)));
        } catch {
          semanticAvailable = false;
        }
      }
    } catch {
      semanticAvailable = false;
    }
    if (!semanticAvailable || semanticScores.size === 0) {
      warnings.push('semantic retrieval is unavailable or incomplete; lexical fallback is labeled degraded. Run pd doctor to repair the shared MiniLM embedder.');
    }
    const semantic = rankedIds(semanticScores);
    const fused = new Map<string, number>();
    lexical.forEach((id, index) => fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + index + 1)));
    semantic.forEach((id, index) => fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + index + 1)));
    const byId = new Map(agents.map((agent) => [agent.agentNodeId, agent]));
    const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
    const hits = [...fused.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, limit)
      .map(([id], index): DurableAgentSearchHit => {
        const lexicalIndex = lexical.indexOf(id);
        const semanticIndex = semantic.indexOf(id);
        return {
          agent: byId.get(id) as DurableAgentRecord,
          rank: index + 1,
          evidence: {
            lexicalRank: lexicalIndex < 0 ? null : lexicalIndex + 1,
            semanticRank: semanticIndex < 0 ? null : semanticIndex + 1,
            sources: [
              ...(lexicalIndex < 0 ? [] : ['bm25'] as const),
              ...(semanticIndex < 0 ? [] : ['semantic'] as const),
            ],
          },
        };
      });
    return {
      query,
      hits,
      degraded: !semanticAvailable || semanticScores.size === 0,
      warnings,
      embedder: deps.resolver.modelId,
    };
  }

  async function retire(agentNodeId: string, opts: { by?: string; reason?: string } = {}) {
    const result = await update(agentNodeId, { lifecycle: 'retired' });
    journal(IDENTITY_RETIRED_RULE, result.agent.agentNodeId,
      { by: opts.by ?? 'operator', reason: opts.reason ?? 'retired', ledgerSeq: result.agent.ledgerSeq, identity: result.agent.identity },
      `durable agent ${result.agent.identity} retired`);
    return result;
  }

  /**
   * The ONLY legitimate way back from `lifecycle: 'retired'`. Appends a fact
   * that carries a fresh receipt (the shape the ledger trigger admits) and
   * journals it. The agent comes back PAUSED, never straight to ready — an
   * operator re-arms it with an ordinary update once it is resurrected.
   */
  async function resurrect(
    agentNodeId: string,
    opts: { by: string; reason: string },
  ): Promise<{ agent: DurableAgentRecord; receipt: string; warnings: string[] }> {
    const by = identifier(opts?.by, 'by', 512);
    const reason = identifier(opts?.reason, 'reason', 4_096);
    const current = findFact(identifier(agentNodeId, 'agentNodeId'));
    if (current.profile.lifecycle !== 'retired') {
      throw new DurableAgentRosterError(
        `durable agent ${agentNodeId} is not retired`,
        'DURABLE_AGENT_NOT_RETIRED',
        409,
      );
    }
    const at = now();
    const resurrection: DurableAgentResurrection = {
      receipt: receiptUlid(at.getTime()),
      at: at.toISOString(),
      by,
      reason,
      fromLedgerSeq: current.ledgerSeq,
    };
    const next: DurableAgentProfileV0 = {
      ...current.profile,
      revision: current.profile.revision + 1,
      lifecycle: 'paused',
      updatedAt: at.toISOString(),
    };
    appendEvent(db, { streamType: 'agent-node', payload: nodePayload(agentNodeId, next, current.payload, resurrection) });
    const agent = get(agentNodeId);
    journal(IDENTITY_RESURRECTED_RULE, agentNodeId,
      { receipt: resurrection.receipt, by, reason, fromLedgerSeq: current.ledgerSeq, ledgerSeq: agent.ledgerSeq, identity: agent.identity },
      `durable agent ${agent.identity} resurrected by ${by} (receipt ${resurrection.receipt}): ${reason}`);
    const warnings: string[] = [];
    try {
      await refreshEmbedding(agent);
    } catch (error) {
      warnings.push('semantic profile indexing is pending; run pd doctor if the shared embedder is unavailable');
      deps.logger?.error?.('durable_agent_embedding_failed', {
        agentNodeId,
        errorType: error instanceof Error ? error.name : 'unknown',
      });
    }
    return { agent, receipt: resurrection.receipt, warnings };
  }

  return {
    create,
    list,
    get,
    update,
    retire,
    resurrect,
    attachHandoffEpisode,
    history,
    search,
  };
}

export type DurableAgentRoster = ReturnType<typeof createDurableAgentRoster>;
