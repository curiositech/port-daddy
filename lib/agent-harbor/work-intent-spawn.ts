import { randomUUID } from 'node:crypto';
import type { DatabaseInstance } from '../sqlite-runtime.js';
import type { SpawnSpec, SpawnResult, SpawnStartedReceipt } from '../spawner.js';
import type { Conductor } from '../fleet/conductor.js';
import { createAgentRunReceiptStore, type AgentRunReceipt } from '../agent-run-receipts.js';
import { appendEvent, type HarborPayload } from './event-ledger.js';
import { planIdForWorkIntent, type WorkIntentService } from './work-intent-service.js';

export interface WorkIntentSpawnResult {
  result: SpawnResult | null;
  runReceipt: AgentRunReceipt;
  duplicate: boolean;
}

/** One-body materialization of canonical WorkIntent; Conductor alone actuates.
 * Construct once per daemon generation. Restart recovery records unknown and
 * never grants permission to replay a launch. Environment values stay in memory.
 */
export function createWorkIntentSpawn(deps: {
  db: DatabaseInstance;
  workIntentService: WorkIntentService;
  conductor: Pick<Conductor, 'launch'>;
}) {
  const { db, workIntentService, conductor } = deps;
  const receipts = createAgentRunReceiptStore(db);
  const inFlight = new Map<string, Promise<WorkIntentSpawnResult>>();

  async function run(spec: SpawnSpec, options: { idempotencyKey?: string; request?: unknown } = {}): Promise<WorkIntentSpawnResult> {
    // Freeze the launch configuration before an await can let a caller alter it.
    const resolved = JSON.parse(JSON.stringify(spec)) as SpawnSpec;
    const accepted = db.transaction(() => {
      const admission = receipts.accept({
        idempotencyKey: `work-intent:single-body:${options.idempotencyKey ?? randomUUID()}`,
        kind: 'spawn', request: options.request ?? resolved, budgetUsd: resolved.budgetUsd,
      });
      if (admission.replayed) return admission;
      const intentId = `work_intent_${admission.receipt.id}`;
      const planId = planIdForWorkIntent(intentId);
      const createdAt = new Date(admission.receipt.createdAt).toISOString();
      workIntentService.capture({
        intentId, idempotencyKey: `single-body:${admission.receipt.id}`,
        source: { kind: 'compat', legacyVerb: 'spawn', surface: '/spawn', worktree: resolved.workdir },
        goalText: resolved.task, startPolicy: 'immediate',
        constraints: { executionKind: 'single-body', runReceiptId: admission.receipt.id,
          requestHash: admission.receipt.requestHash, bodyPreference: resolved.backend,
          maxCostUsd: resolved.budgetUsd, deadlineMs: resolved.timeout, workdir: resolved.workdir },
        createdAt,
      });
      appendEvent(db, { streamType: 'work-plan', payload: {
        schema: 'pd.agent-harbor.work-plan.v0', planId, intentId,
        idempotencyKey: `single-body-plan:${admission.receipt.id}`, shape: 'single-node',
        state: 'materializing', confidence: 1,
        evidence: 'Explicit one-body request; Conductor admission is required before execution.',
        nodeSpecs: [{ nodeSpecId: `node_spec_${admission.receipt.id}`, role: resolved.purpose ?? 'Execute the captured goal',
          kind: 'agent-node', bodyPreference: { adapter: resolved.backend },
          scope: { files: resolved.files ?? [] },
          contracts: { maxSpendUsd: resolved.budgetUsd, stopConditions: ['operator stop', 'backend failure', 'transcript failure'] } }],
        placeholders: [], gates: [], requiresApproval: false, createdAt,
      } });
      return { ...admission, receipt: receipts.bindExecution(admission.receipt.id, { intentId, planId }) };
    })();
    const { receipt } = accepted;
    if (accepted.replayed) {
      const pending = inFlight.get(receipt.id);
      if (pending) return { ...await pending, duplicate: true };
      return { result: null, runReceipt: receipt, duplicate: true };
    }

    // Register the promise before invoking any effect, including synchronous
    // admission callbacks, so reentrant/concurrent retries share one execution.
    const pending = Promise.resolve().then(() => execute(resolved, receipt));
    inFlight.set(receipt.id, pending);
    try { return await pending; }
    finally { inFlight.delete(receipt.id); }
  }

  async function execute(spec: SpawnSpec, receipt: AgentRunReceipt): Promise<WorkIntentSpawnResult> {
    let observed: SpawnStartedReceipt | null = null;
    let runFact: HarborPayload | null = null;
    let result: SpawnResult | null = null;
    let failure: string | null = null;
    let halted = false;
    try {
      const launched = await conductor.launch({
        source: 'operator', goal: spec.task, task: spec.task, canonicalRunId: receipt.id,
        backend: spec.backend, model: spec.model, modelTier: spec.modelTier,
        name: spec.name, files: spec.files, identity: spec.identity, purpose: spec.purpose,
        requestedBackend: spec.requestedBackend, requestedModel: spec.requestedModel,
        backendOverrideSource: spec.backendOverrideSource, permissionMode: spec.permissionMode,
        injectSquidHooks: spec.injectSquidHooks, workdir: spec.workdir, env: spec.env,
        allowedTools: spec.allowedTools, maxTokens: spec.maxTokens, tubeChannel: spec.tubeChannel,
        timeoutMs: spec.timeout, budgetUsd: spec.budgetUsd, worktree: 'inherit', mergePolicy: 'never',
        onAdmitted: launch => { receipts.bindExecution(receipt.id, {
          intentId: receipt.intentId!, planId: receipt.planId!, launchId: launch.id,
        }); },
        onAgentStarted: started => { observed = started as SpawnStartedReceipt; },
        onAgentReady: ready => {
          if (!ready.transcriptId || !ready.sessionId) throw new Error('Exact session/transcript binding is required');
          const candidate: HarborPayload = {
            schema: 'pd.agent-harbor.agent-run.v0', runId: receipt.id,
            agentNodeId: ready.agentId, sessionId: ready.sessionId,
            intentId: receipt.intentId, planId: receipt.planId,
            launchId: receipts.get(receipt.id)!.launchId, transcriptId: ready.transcriptId,
            body: { kind: 'spawner-child', provider: ready.backend, modelTier: 'custom',
              modelName: ready.model, launchMode: 'native' },
            status: 'running', startedAt: new Date(ready.startedAt).toISOString(), receiptId: receipt.id,
          };
          db.transaction(() => {
            appendEvent(db, { streamType: 'agent-node', payload: {
              schema: 'pd.agent-harbor.agent-node.v0', agentNodeId: ready.agentId,
              identity: spec.identity ?? `spawner:${ready.agentId}`, class: 'voyager', authority: 'local',
              complianceLevel: 'C0', status: 'active', intentId: receipt.intentId, planId: receipt.planId,
              currentSessionId: ready.sessionId, currentRunId: receipt.id,
              createdAt: candidate.startedAt,
            } });
            appendEvent(db, { streamType: 'agent-run', payload: candidate });
            receipts.markStarting(receipt.id, { successorAgentId: ready.agentId,
              successorSessionId: ready.sessionId, transcriptId: ready.transcriptId! });
          })();
          runFact = candidate;
        },
      });
      result = launched.spawn as SpawnResult | null;
      failure = launched.refusedReason ?? launched.launch.errorMessage ?? result?.error ?? null;
      halted = launched.launch.state === 'halted';
      if (result?.status === 'completed' && !runFact) failure = 'Backend completion lacks canonical run binding';
      if (result?.managedSession && result.managedSession.outcome !== 'succeeded') {
        failure = result.managedSession.error ?? 'Managed session terminal transition was not confirmed';
      }
    } catch (error) { failure = error instanceof Error ? error.message : String(error); }

    // A stop request is not proof of termination. Only the backend's killed
    // outcome establishes cancellation; a halted launch with late success stays
    // unknown. Receipt persistence failures propagate, never return green.
    const status = result?.status === 'killed' ? 'cancelled'
      : halted ? 'unknown'
      : result?.status === 'over_budget' ? 'over_budget'
      : failure || !result || result.status === 'failed' ? 'failed'
      : result.status === 'completed' ? 'completed' : 'unknown';
    if (result && status !== 'completed' && result.status === 'completed') {
      result = { ...result, status: 'failed', error: failure ?? 'Termination is not confirmed' };
    }
    const runReceipt = db.transaction(() => {
      if (runFact) appendEvent(db, { streamType: 'agent-run', payload: {
        ...runFact, status: status === 'cancelled' ? 'canceled' : status === 'unknown' ? 'orphaned'
          : status === 'over_budget' ? 'failed' : status,
        stoppedAt: status === 'unknown' ? null : new Date().toISOString(), stopReason: failure,
      } });
      // Admission can fail after opening a transcript but before a session is
      // bound. Preserve the observed body/transcript without inventing a run.
      const start = observed as SpawnStartedReceipt | null;
      if (receipts.get(receipt.id)!.status === 'accepted' && start?.transcriptId) {
        receipts.markStarting(receipt.id, { successorAgentId: start.agentId, transcriptId: start.transcriptId });
      }
      return receipts.markStatus(receipt.id, status, { error: failure, telemetry: result?.telemetry });
    })();
    return { result, runReceipt, duplicate: false };
  }

  async function replay(idempotencyKey: string, request: unknown): Promise<WorkIntentSpawnResult | null> {
    const receipt = receipts.findRequest({ kind: 'spawn', request, idempotencyKey: `work-intent:single-body:${idempotencyKey}` });
    if (!receipt) return null;
    const pending = inFlight.get(receipt.id);
    return pending ? { ...await pending, duplicate: true } : { result: null, runReceipt: receipt, duplicate: true };
  }
  return { run, replay, get: receipts.get };
}
export type WorkIntentSpawn = ReturnType<typeof createWorkIntentSpawn>;
