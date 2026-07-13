import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseInstance } from '../sqlite-runtime.js';
import type {
  Dispatch,
  DispatchQueue,
  DispatchBackend,
  MergePolicy,
} from '../dispatch/queue.js';
import {
  appendEvent,
  ensureEventLedgerSchema,
  type AppendResult,
  type HarborPayload,
} from './event-ledger.js';

const WORK_INTENT_SCHEMA = 'pd.agent-harbor.work-intent.v0';
const WORK_PLAN_SCHEMA = 'pd.agent-harbor.work-plan.v0';

export interface WorkIntentPayload extends HarborPayload {
  schema: typeof WORK_INTENT_SCHEMA;
  intentId: string;
  idempotencyKey: string;
  source: {
    kind: 'compat' | 'console' | 'fleetbar' | 'dashboard' | 'cli' | 'webhook' | 'schedule' | 'staff-agent' | 'import' | 'mobile' | 'api';
    legacyVerb?: 'spawn' | 'dispatch' | 'sortie' | 'conjure' | 'nightshift' | null;
    surface?: string;
    actorId?: string;
    worktree?: string;
    branch?: string;
  };
  goal: { text: string; contextRefs?: Array<Record<string, unknown>> };
  constraints?: Record<string, unknown>;
  startPolicy?: 'immediate' | 'queued' | 'scheduled' | 'attach-existing';
  attachExisting?: boolean;
  operator?: string;
  status?: 'draft' | 'captured' | 'planning' | 'planned' | 'canceled' | 'superseded';
  createdAt: string;
  compat?: {
    dispatchId?: string;
    legacyState?: string;
    projection?: 'dispatches';
    requestIdempotencyKey?: string;
    dispatchProjection?: {
      tags?: string[];
      backend?: DispatchBackend;
      budgetUsd?: number;
      timeoutMs?: number;
      baseBranch?: string;
      autoClaim?: boolean;
      targetActorId?: string;
      reviewerActorId?: string;
      mergePolicy?: MergePolicy;
      requestedBy?: string;
    };
  };
}

export interface CaptureWorkIntentInput {
  intentId?: string;
  idempotencyKey: string;
  source: WorkIntentPayload['source'];
  goalText: string;
  contextRefs?: Array<Record<string, unknown>>;
  constraints?: Record<string, unknown>;
  startPolicy?: WorkIntentPayload['startPolicy'];
  attachExisting?: boolean;
  operator?: string;
  status?: WorkIntentPayload['status'];
  createdAt?: string;
  compat?: WorkIntentPayload['compat'];
}

export interface WorkPlanPayload extends HarborPayload {
  schema: typeof WORK_PLAN_SCHEMA;
  planId: string;
  intentId: string;
  idempotencyKey: string;
  shape: 'unshaped';
  state: 'intent-captured';
  confidence: number;
  evidence: string;
  nodeSpecs: [];
  placeholders: Array<{
    placeholderId: string;
    role: string;
    uncertaintyReason: string;
    resolutionTrigger: string;
    evidenceNeeded: string[];
  }>;
  gates: Array<{
    kind: 'human-approval';
    reason: string;
    status: 'pending';
  }>;
  requiresApproval: true;
  createdAt: string;
}

export interface CaptureDispatchInput {
  goal: string;
  tags?: string[];
  backend?: DispatchBackend;
  budgetUsd?: number;
  timeoutMs?: number;
  baseBranch?: string;
  targetActorId?: string;
  reviewerActorId?: string;
  mergePolicy?: MergePolicy;
  requestedBy?: string;
  idempotencyKey?: string;
  autoClaim?: boolean;
}

export interface CaptureResult {
  intent: WorkIntentPayload;
  append: AppendResult;
}

export interface WorkIntentSnapshot {
  intent: WorkIntentPayload;
  plan: WorkPlanPayload | null;
}

export interface CaptureWithInitialPlanResult extends CaptureResult {
  plan: WorkPlanPayload;
  planAppend: AppendResult;
}

export interface CaptureDispatchResult extends CaptureResult {
  dispatch: Dispatch;
}

export interface EnsureDispatchIntentResult {
  intent: WorkIntentPayload;
  append: AppendResult | null;
  imported: boolean;
}

export class WorkIntentMaterializationError extends Error {
  code = 'WORK_INTENT_MATERIALIZATION_FAILED' as const;
  intent: WorkIntentPayload;
  append: AppendResult;

  constructor(message: string, intent: WorkIntentPayload, append: AppendResult) {
    super(message);
    this.name = 'WorkIntentMaterializationError';
    this.intent = intent;
    this.append = append;
  }
}

export interface WorkIntentService {
  capture(input: CaptureWorkIntentInput): CaptureResult;
  captureWithInitialPlan(input: CaptureWorkIntentInput): CaptureWithInitialPlanResult;
  get(intentId: string): WorkIntentSnapshot | null;
  list(limit?: number): WorkIntentSnapshot[];
  captureDispatch(input: CaptureDispatchInput, queue: DispatchQueue): CaptureDispatchResult;
  ensureDispatchIntent(dispatch: Dispatch): EnsureDispatchIntentResult;
}

export interface WorkIntentServiceDeps {
  db: DatabaseInstance;
  now?: () => Date;
  uuid?: () => string;
}

function stableToken(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function idSafe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_:-]/g, '_');
}

export function dispatchIdForWorkIntent(intentId: string): string {
  return `dispatch_${idSafe(intentId.replace(/^work_intent_/, ''))}`;
}

export function planIdForWorkIntent(intentId: string): string {
  return `work_plan_${idSafe(intentId.replace(/^work_intent_/, ''))}`;
}

function legacyIntentIdForDispatch(dispatchId: string): string {
  return `work_intent_compat_dispatch_${idSafe(dispatchId)}`;
}

function isoFromMillis(value: number): string {
  return new Date(value).toISOString();
}

function millisFromIso(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dispatchConstraints(input: {
  budgetUsd?: number | null;
  timeoutMs?: number | null;
  mergePolicy?: MergePolicy;
  backend?: DispatchBackend | null;
}): Record<string, unknown> {
  const constraints: Record<string, unknown> = {
    placement: 'local-only',
    parallelism: 'planner-decides',
    destructiveActions: 'policy-default',
  };
  if (input.budgetUsd != null) constraints.maxCostUsd = input.budgetUsd;
  if (input.timeoutMs != null) constraints.deadlineMs = input.timeoutMs;
  if (input.mergePolicy) constraints.reviewRequired = input.mergePolicy === 'review';
  if (input.backend) constraints.bodyPreference = input.backend;
  return constraints;
}

function readIntentByEventId(db: DatabaseInstance, eventId: string): WorkIntentPayload {
  const row = db
    .prepare("SELECT payload_json FROM harbor_events WHERE stream_type = 'work-intent' AND event_id = ?")
    .get(eventId) as { payload_json: string } | undefined;
  if (!row) throw new Error(`work-intent ${eventId} was not persisted`);
  return JSON.parse(row.payload_json) as WorkIntentPayload;
}

function readIntentByEventIdIfExists(db: DatabaseInstance, eventId: string): WorkIntentPayload | null {
  const row = db
    .prepare("SELECT payload_json FROM harbor_events WHERE stream_type = 'work-intent' AND event_id = ?")
    .get(eventId) as { payload_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.payload_json) as WorkIntentPayload;
}

function readPlanForIntent(db: DatabaseInstance, intentId: string): WorkPlanPayload | null {
  const row = db
    .prepare("SELECT payload_json FROM harbor_events WHERE stream_type = 'work-plan' AND event_id = ?")
    .get(planIdForWorkIntent(intentId)) as { payload_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.payload_json) as WorkPlanPayload;
}

function initialPlanForIntent(intent: WorkIntentPayload): WorkPlanPayload {
  const planId = planIdForWorkIntent(intent.intentId);
  return {
    schema: WORK_PLAN_SCHEMA,
    planId,
    intentId: intent.intentId,
    idempotencyKey: `initial-plan:${intent.idempotencyKey}`,
    shape: 'unshaped',
    state: 'intent-captured',
    confidence: 0,
    evidence:
      'Intent is durable. The daemon has not shaped or materialized executable nodes yet; no provider or model has been selected.',
    nodeSpecs: [],
    placeholders: [
      {
        placeholderId: `placeholder_planner_${idSafe(intent.intentId)}`,
        role: 'daemon work planner',
        uncertaintyReason:
          'The governed WorkPlanner -> AgentNode -> AgentRun materialization path is not available.',
        resolutionTrigger: 'work-planner.available',
        evidenceNeeded: [
          'daemon-shaped WorkPlan',
          'governed AgentNode materialization',
          'Squid-managed Body attachment',
        ],
      },
    ],
    gates: [
      {
        kind: 'human-approval',
        reason: 'Execution is unavailable until the daemon can prove the complete governed launch chain.',
        status: 'pending',
      },
    ],
    requiresApproval: true,
    createdAt: intent.createdAt,
  };
}

function candidateIntentIdsForDispatchId(dispatchId: string): string[] {
  const ids = [legacyIntentIdForDispatch(dispatchId)];
  if (dispatchId.startsWith('dispatch_')) {
    ids.unshift(`work_intent_${dispatchId.replace(/^dispatch_/, '')}`);
  }
  return [...new Set(ids)];
}

function findIntentByDispatchId(db: DatabaseInstance, dispatchId: string): WorkIntentPayload | null {
  ensureEventLedgerSchema(db);
  for (const eventId of candidateIntentIdsForDispatchId(dispatchId)) {
    const payload = readIntentByEventIdIfExists(db, eventId);
    if (payload?.compat?.dispatchId === dispatchId) return payload;
  }
  const rows = db
    .prepare("SELECT payload_json FROM harbor_events WHERE stream_type = 'work-intent' ORDER BY ledger_seq ASC")
    .all() as Array<{ payload_json: string }>;
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload_json) as WorkIntentPayload;
      if (payload.compat?.dispatchId === dispatchId) return payload;
    } catch {
      // Tolerant reader: a malformed old payload should not block bounded import.
    }
  }
  return null;
}

function materializeDispatchProjectionFromIntent(
  intent: WorkIntentPayload,
  queue: DispatchQueue,
): Dispatch {
  const projection = intent.compat?.dispatchProjection;
  return queue.materializeProjection({
    id: intent.compat?.dispatchId ?? dispatchIdForWorkIntent(intent.intentId),
    goal: intent.goal.text,
    tags: projection?.tags,
    backend: projection?.backend,
    budgetUsd: projection?.budgetUsd,
    timeoutMs: projection?.timeoutMs,
    baseBranch: projection?.baseBranch,
    autoClaim: projection?.autoClaim,
    targetActorId: projection?.targetActorId,
    reviewerActorId: projection?.reviewerActorId,
    mergePolicy: projection?.mergePolicy,
    requestedBy: projection?.requestedBy ?? intent.operator,
    createdAt: millisFromIso(intent.createdAt),
  });
}

export function createWorkIntentService(deps: WorkIntentServiceDeps): WorkIntentService {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const uuid = deps.uuid ?? randomUUID;

  function capture(input: CaptureWorkIntentInput): CaptureResult {
    const intent: WorkIntentPayload = {
      schema: WORK_INTENT_SCHEMA,
      intentId: input.intentId ?? `work_intent_${idSafe(uuid())}`,
      idempotencyKey: input.idempotencyKey,
      source: input.source,
      goal: {
        text: input.goalText,
        ...(input.contextRefs?.length ? { contextRefs: input.contextRefs } : {}),
      },
      constraints: input.constraints,
      startPolicy: input.startPolicy,
      attachExisting: input.attachExisting ?? false,
      operator: input.operator,
      status: input.status ?? 'captured',
      createdAt: input.createdAt ?? now().toISOString(),
      compat: input.compat,
    };
    const append = appendEvent(db, { streamType: 'work-intent', payload: intent });
    return { intent: readIntentByEventId(db, append.eventId), append };
  }

  function captureWithInitialPlan(input: CaptureWorkIntentInput): CaptureWithInitialPlanResult {
    const txn = db.transaction((): CaptureWithInitialPlanResult => {
      const captured = capture(input);
      const candidatePlan = initialPlanForIntent(captured.intent);
      const planAppend = appendEvent(db, { streamType: 'work-plan', payload: candidatePlan });
      const plan = readPlanForIntent(db, captured.intent.intentId);
      if (!plan) {
        throw new Error(`initial WorkPlan ${candidatePlan.planId} was not persisted`);
      }
      return { ...captured, plan, planAppend };
    });
    return txn();
  }

  function get(intentId: string): WorkIntentSnapshot | null {
    ensureEventLedgerSchema(db);
    const intent = readIntentByEventIdIfExists(db, intentId);
    return intent ? { intent, plan: readPlanForIntent(db, intent.intentId) } : null;
  }

  function list(limit = 100): WorkIntentSnapshot[] {
    ensureEventLedgerSchema(db);
    const boundedLimit = Math.min(Math.max(Math.trunc(limit) || 100, 1), 500);
    const rows = db
      .prepare(
        "SELECT payload_json FROM harbor_events WHERE stream_type = 'work-intent' ORDER BY ledger_seq DESC LIMIT ?",
      )
      .all(boundedLimit) as Array<{ payload_json: string }>;
    return rows.map((row) => {
      const intent = JSON.parse(row.payload_json) as WorkIntentPayload;
      return { intent, plan: readPlanForIntent(db, intent.intentId) };
    });
  }

  function captureDispatch(input: CaptureDispatchInput, queue: DispatchQueue): CaptureDispatchResult {
    const token = input.idempotencyKey ? stableToken(input.idempotencyKey) : idSafe(uuid());
    const intentId = `work_intent_dispatch_${token}`;
    const dispatchId = dispatchIdForWorkIntent(intentId);
    const idempotencyKey = input.idempotencyKey ?? `compat:dispatch:${dispatchId}`;
    const captured = capture({
      intentId,
      idempotencyKey,
      source: {
        kind: 'compat',
        legacyVerb: 'dispatch',
        surface: 'pd dispatch',
        actorId: input.requestedBy ?? 'operator',
      },
      goalText: input.goal,
      constraints: dispatchConstraints(input),
      startPolicy: 'queued',
      attachExisting: false,
      operator: input.requestedBy ?? 'operator',
      compat: {
        dispatchId,
        projection: 'dispatches',
        requestIdempotencyKey: input.idempotencyKey,
        dispatchProjection: {
          tags: input.tags,
          backend: input.backend,
          budgetUsd: input.budgetUsd,
          timeoutMs: input.timeoutMs,
          baseBranch: input.baseBranch,
          autoClaim: input.autoClaim,
          targetActorId: input.targetActorId,
          reviewerActorId: input.reviewerActorId,
          mergePolicy: input.mergePolicy,
          requestedBy: input.requestedBy,
        },
      },
    });
    let dispatch: Dispatch;
    try {
      dispatch = materializeDispatchProjectionFromIntent(captured.intent, queue);
    } catch (err) {
      throw new WorkIntentMaterializationError(
        err instanceof Error ? err.message : String(err),
        captured.intent,
        captured.append,
      );
    }
    return { ...captured, dispatch };
  }

  function ensureDispatchIntent(dispatch: Dispatch): EnsureDispatchIntentResult {
    const existing = findIntentByDispatchId(db, dispatch.id);
    if (existing) return { intent: existing, append: null, imported: false };
    const captured = capture({
      intentId: legacyIntentIdForDispatch(dispatch.id),
      idempotencyKey: `compat:dispatch:${dispatch.id}`,
      source: {
        kind: 'compat',
        legacyVerb: 'dispatch',
        surface: 'pd dispatch',
        actorId: dispatch.requestedBy,
        worktree: dispatch.worktreePath ?? undefined,
        branch: dispatch.branch ?? undefined,
      },
      goalText: dispatch.goal,
      constraints: dispatchConstraints({
        budgetUsd: dispatch.budgetUsd,
        timeoutMs: dispatch.timeoutMs,
        mergePolicy: dispatch.mergePolicy,
        backend: dispatch.backend,
      }),
      startPolicy: 'queued',
      attachExisting: true,
      operator: dispatch.requestedBy,
      createdAt: isoFromMillis(dispatch.createdAt),
      compat: {
        dispatchId: dispatch.id,
        legacyState: dispatch.state,
        projection: 'dispatches',
      },
    });
    return { ...captured, imported: true };
  }

  return {
    capture,
    captureWithInitialPlan,
    get,
    list,
    captureDispatch,
    ensureDispatchIntent,
  };
}
