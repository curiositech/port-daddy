import { createHash } from 'node:crypto';
import type { DatabaseInstance } from '../sqlite-runtime.js';
import type { EpisodicMemory } from '../episodic-memory.js';
import {
  sanitizeHandoffCapsule,
  type GitleaksRunner,
  type HandoffCapsuleV0,
} from '../handoff-capsule.js';
import {
  assessContextEnvelope,
  buildContextEnvelope,
  type ContextEnvelope,
  type EnvelopeAssessment,
} from './context-pressure.js';
import {
  buildCompactionPacket,
  resumeFromPacket,
  type CompactionPacket,
  type SuccessorBootstrap,
} from './compaction.js';
import { appendEvent, readEvents, type HarborPayload } from './event-ledger.js';

export const CONTEXT_CONTINUITY_SCHEMA = 'pd.agent-harbor.context-continuity.v0' as const;

export interface ContextContinuitySample {
  agentNodeId: string;
  sessionId: string;
  runId?: string | null;
  transcriptId: string;
  sourceAdapter: string;
  model: string;
  windowTokens: number;
  daemonUsedTokensEstimate: number;
  adapterUsedTokensEstimate?: number | null;
  estimateMode: 'exact' | 'estimated';
  project?: string | null;
  projectDir?: string | null;
  workdir?: string | null;
  worktreeId?: string | null;
  branch?: string | null;
  measuredAt?: string;
}

export interface ContextContinuityResult {
  schema: typeof CONTEXT_CONTINUITY_SCHEMA;
  envelope: ContextEnvelope;
  assessment: EnvelopeAssessment;
  packet: CompactionPacket | null;
  bootstrap: SuccessorBootstrap | null;
  handoffEpisodeId: number | null;
  replayed: boolean;
}

export interface ContextContinuityCoordinatorDeps {
  episodicMemory?: Pick<EpisodicMemory, 'remember'>;
  gitleaksRunner?: GitleaksRunner;
  logger?: {
    error(message: string, meta?: Record<string, unknown>): void;
  };
}

export interface ContextContinuityProjection {
  schemaVersion: 1;
  capturedAt: string;
  counts: {
    observed: number;
    packetReady: number;
    successorRequired: number;
    continuing: number;
    completed: number;
    verificationFailed: number;
  };
  items: ContextContinuityItem[];
  failures: ContextContinuityFailure[];
}

export interface ContextContinuityFailure {
  eventId: string;
  sessionId: string;
  agentNodeId: string;
  reason: string;
}

export interface ContextContinuityItem {
  agentNodeId: string;
  sessionId: string;
  runId: string | null;
  transcriptId: string | null;
  model: string | null;
  sourceAdapter: string | null;
  project: string | null;
  projectDir: string | null;
  envelopeId: string;
  measuredAt: string;
  pressure: {
    band: EnvelopeAssessment['band'];
    ratio: number;
    action: EnvelopeAssessment['action'];
    windowTokens: number;
    usedTokensEstimate: number;
    estimateMode: string;
    strategy: string;
    selfReportDrift: string[];
  };
  packet: null | {
    packetId: string;
    createdAt: string;
    validatorPassed: boolean;
    sourceHeadEventId: string;
    sourceHeadHash: string;
    transcriptEventId: string | null;
  };
  handoffEpisodeId: number | null;
  continuation: null | {
    id: string;
    status: string;
    targetAdapter: string;
    successorRunId: string | null;
    successorSessionId: string | null;
    updatedAt: number;
  };
  readiness: 'observed' | 'packet-ready' | 'successor-required' | 'continuing' | 'completed' | 'failed';
}

function stableSuffix(...parts: Array<string | null | undefined>): string {
  return createHash('sha256').update(parts.map((part) => part ?? '').join('\0')).digest('hex').slice(0, 24);
}

function finiteNonNegative(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function transcriptRows(db: DatabaseInstance, sessionId: string) {
  return readEvents(db, { streamType: 'transcript-event', sessionId, limit: 10_000 });
}

function estimatePersistedTranscriptTokens(db: DatabaseInstance, transcriptId: string): number {
  const hasTable = db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'fleet_transcript_messages'",
  ).get() as { present: number } | undefined;
  if (!hasTable) return 0;
  const row = db.prepare(`
    SELECT COALESCE(SUM(LENGTH(content)), 0) AS characters
    FROM fleet_transcript_messages
    WHERE transcript_id = ?
  `).get(transcriptId) as { characters: number };
  return Math.ceil(row.characters / 4);
}

function firstOperatorTask(db: DatabaseInstance, sessionId: string): string {
  for (const row of transcriptRows(db, sessionId)) {
    if (row.kind !== 'operator_message') continue;
    try {
      const outer = JSON.parse(row.payload_json) as { payloadJson?: Record<string, unknown> };
      const content = outer.payloadJson?.content;
      if (typeof content === 'string' && content.trim()) return content.trim();
    } catch {
      // A malformed foreign event remains cited evidence, but cannot become telos.
    }
  }
  return `Continue witnessed session ${sessionId}`;
}

function eventPayload(db: DatabaseInstance, eventId: string): HarborPayload | null {
  const row = db.prepare(
    'SELECT payload_json FROM harbor_events WHERE stream_type = ? AND event_id = ? LIMIT 1',
  ).get('transcript-event', eventId) as { payload_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json) as HarborPayload;
  } catch {
    return null;
  }
}

function packetForEnvelope(
  db: DatabaseInstance,
  sessionId: string,
  envelopeId: string,
): CompactionPacket | null {
  for (const row of transcriptRows(db, sessionId)) {
    if (row.kind !== 'compaction_packet') continue;
    try {
      const outer = JSON.parse(row.payload_json) as { payloadJson?: CompactionPacket };
      const packet = outer.payloadJson;
      if (packet?.trigger?.contextEnvelopeRef === envelopeId) return packet;
    } catch {
      // Tolerant read: ignore foreign or malformed packet events.
    }
  }
  return null;
}

function handoffEpisodeId(db: DatabaseInstance, packetId: string): number | null {
  const hasTable = db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'episodic_memory'",
  ).get() as { present: number } | undefined;
  if (!hasTable) return null;
  const row = db.prepare(`
    SELECT id FROM episodic_memory
    WHERE source_type = 'handoff-capsule'
      AND source_id = ?
      AND episode_type = 'handoff'
    LIMIT 1
  `).get(`context-continuity:${packetId}`) as { id: number } | undefined;
  return row?.id ?? null;
}

function capsuleFromPacket(
  packet: CompactionPacket,
  sample: ContextContinuitySample,
  gitleaksRunner?: GitleaksRunner,
): HandoffCapsuleV0 {
  const raw = {
    capsuleId: packet.packetId,
    capturedAt: packet.createdAt,
    source: {
      adapter: sample.sourceAdapter,
      sessionId: packet.sessionId,
      agentId: packet.agentNodeId,
      workflowId: packet.runId ?? null,
      transcriptRef: `agent-harbor:${packet.packetId}`,
    },
    target: null,
    identity: {
      project: sample.project ?? null,
      projectDir: sample.projectDir ?? null,
      harbor: null,
    },
    workspace: {
      cwd: sample.workdir ?? null,
      repoRoot: sample.projectDir ?? sample.workdir ?? null,
      branch: sample.branch ?? null,
      worktreeId: sample.worktreeId ?? null,
      gitHead: null,
      dirtyFiles: packet.workspace?.files ?? [],
    },
    telos: packet.identity.task,
    operatorTurns: [],
    decisions: (packet.decisions ?? []).map((decision, index) => ({
      id: `packet-decision-${index + 1}`,
      at: packet.createdAt,
      text: decision.rationale ? `${decision.text}\nRationale: ${decision.rationale}` : decision.text,
      source: 'agent',
    })),
    coordination: [
      ...packet.obligations.map((obligation, index) => ({
        id: obligation.obligationId ?? `packet-obligation-${index + 1}`,
        at: packet.createdAt,
        text: `${obligation.status}: ${obligation.text}`,
        kind: obligation.status === 'blocked' ? 'blocker' : 'scope',
      })),
      ...(packet.blockers ?? []).map((blocker, index) => ({
        id: `packet-blocker-${index + 1}`,
        at: packet.createdAt,
        text: blocker,
        kind: 'blocker',
      })),
      {
        id: `packet-proof-${packet.packetId}`,
        at: packet.createdAt,
        text: `Verified compaction packet ${packet.packetId}; source head ${packet.sourceTranscript.headEventId}.`,
        kind: 'result',
      },
    ],
    artifacts: (packet.workspace?.files ?? []).map((path) => ({
      path,
      kind: 'workspace-file',
      summary: null,
      sourceBlockId: null,
    })),
    tail: (packet.transcriptExcerpts ?? []).map((excerpt, index) => ({
      id: excerpt.citation.transcriptEventId ?? `packet-tail-${index + 1}`,
      at: packet.createdAt,
      text: excerpt.excerpt || `Transcript event ${excerpt.citation.transcriptEventId ?? index + 1}`,
      role: 'system',
    })),
  };
  return sanitizeHandoffCapsule(raw, { gitleaksRunner });
}

function rememberHandoff(
  memory: Pick<EpisodicMemory, 'remember'>,
  packet: CompactionPacket,
  sample: ContextContinuitySample,
  capsule: HandoffCapsuleV0,
): number {
  return memory.remember({
    projectDir: sample.projectDir ?? sample.workdir ?? null,
    project: sample.project ?? null,
    harbor: null,
    agentId: packet.agentNodeId,
    episodeType: 'handoff',
    title: `Context continuation: ${packet.identity.task}`.slice(0, 200),
    summary: [
      packet.identity.task,
      `Verified packet ${packet.packetId}`,
      `Pressure ${Math.round((packet.trigger.pressure ?? 0) * 100)}%`,
      packet.nextAction.recommendation,
    ].join('\n'),
    sourceType: 'handoff-capsule',
    sourceId: `context-continuity:${packet.packetId}`,
    worktreeId: sample.worktreeId ?? null,
    branchName: sample.branch ?? null,
    metadata: {
      capsule,
      projectionOf: {
        stream: 'harbor_events',
        packetId: packet.packetId,
        transcriptEventId: packet.transcriptEventId ?? null,
        sourceHeadEventId: packet.sourceTranscript.headEventId,
        sourceHeadHash: packet.sourceTranscript.headHash,
      },
    },
  }).id;
}

export function createContextContinuityCoordinator(
  db: DatabaseInstance,
  deps: ContextContinuityCoordinatorDeps = {},
) {
  function record(sample: ContextContinuitySample): ContextContinuityResult {
    const suffix = stableSuffix(sample.sessionId, sample.runId ?? sample.transcriptId);
    const eventId = `evt_ctx_${suffix}`;
    const envelopeId = `ctx_${suffix}`;
    const existing = eventPayload(db, eventId);
    let replayed = existing !== null;
    let envelope: ContextEnvelope;

    const existingPayload = existing?.payloadJson as Record<string, unknown> | undefined;
    if (existingPayload?.contextEnvelope) {
      envelope = existingPayload.contextEnvelope as ContextEnvelope;
    } else {
      const daemonEstimate = Math.max(
        finiteNonNegative(sample.daemonUsedTokensEstimate),
        estimatePersistedTranscriptTokens(db, sample.transcriptId),
      );
      const adapterEstimate = finiteNonNegative(sample.adapterUsedTokensEstimate);
      const usedTokensEstimate = Math.max(daemonEstimate, adapterEstimate);
      envelope = buildContextEnvelope({
        envelopeId,
        agentNodeId: sample.agentNodeId,
        sessionId: sample.sessionId,
        runId: sample.runId ?? sample.transcriptId,
        windowTokens: sample.windowTokens,
        usedTokensEstimate,
        sourceEventId: eventId,
        measuredAt: sample.measuredAt,
        contextRefs: [{ kind: 'attachment', ref: `fleet-transcript:${sample.transcriptId}`, droppable: false }],
      });
      envelope.transcriptId = sample.transcriptId;
      envelope.model = sample.model;
      envelope.sourceAdapter = sample.sourceAdapter;
      envelope.project = sample.project ?? null;
      envelope.projectDir = sample.projectDir ?? sample.workdir ?? null;
      envelope.estimator = {
        strategy: 'max-daemon-and-adapter',
        daemonUsedTokensEstimate: daemonEstimate,
        adapterUsedTokensEstimate: adapterEstimate,
        estimateMode: sample.estimateMode,
        confidence: sample.estimateMode === 'exact' ? 'backend-reported' : 'conservative-estimate',
      };
      const rows = transcriptRows(db, sample.sessionId);
      const sequence = Math.max(-1, ...rows.map((row) => row.sequence ?? -1)) + 1;
      appendEvent(db, {
        streamType: 'transcript-event',
        payload: {
          eventId,
          sessionId: sample.sessionId,
          agentNodeId: sample.agentNodeId,
          sequence,
          occurredAt: envelope.measuredAt,
          schemaVersion: 1,
          kind: 'context_pressure',
          visibility: 'operator',
          source: {
            adapter: sample.sourceAdapter,
            idempotencyKey: `context-continuity:${suffix}`,
          },
          payloadJson: { contextEnvelope: envelope },
        },
      });
    }

    const assessment = assessContextEnvelope(envelope);
    let packet = packetForEnvelope(db, sample.sessionId, envelope.envelopeId);
    let bootstrap: SuccessorBootstrap | null = null;
    let episodeId = packet ? handoffEpisodeId(db, packet.packetId) : null;

    if (assessment.compactionNeeded && !packet) {
      const built = buildCompactionPacket(db, {
        agentNodeId: sample.agentNodeId,
        sessionId: sample.sessionId,
        runId: sample.runId ?? sample.transcriptId,
        createdBy: { kind: 'daemon' },
        contextEnvelope: envelope,
        identity: { task: firstOperatorTask(db, sample.sessionId) },
        obligations: [],
        factualClaims: [],
        nextAction: {
          recommendation: assessment.successorRequired
            ? 'Start exactly one successor from this verified packet before broad new work.'
            : 'Prepare an operator-approved successor from this verified packet if the run continues.',
          safetyConstraints: [
            'Revalidate the packet against the append-only transcript before spawning.',
            'Use the existing idempotent continuation receipt; never spawn a second successor for the same key.',
          ],
        },
      });
      packet = built.packet;
      replayed = false;
    }

    if (packet) {
      bootstrap = resumeFromPacket(db, packet);
      if (deps.episodicMemory && episodeId === null) {
        try {
          const capsule = capsuleFromPacket(packet, sample, deps.gitleaksRunner);
          episodeId = rememberHandoff(deps.episodicMemory, packet, sample, capsule);
        } catch (error) {
          deps.logger?.error('context_continuity_handoff_projection_failed', {
            agentNodeId: sample.agentNodeId,
            sessionId: sample.sessionId,
            packetId: packet.packetId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return {
      schema: CONTEXT_CONTINUITY_SCHEMA,
      envelope,
      assessment,
      packet,
      bootstrap,
      handoffEpisodeId: episodeId,
      replayed,
    };
  }

  return { record };
}

function continuationForPacket(db: DatabaseInstance, packetId: string): ContextContinuityItem['continuation'] {
  const hasTable = db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'agent_continuations'",
  ).get() as { present: number } | undefined;
  if (!hasTable) return null;
  const row = db.prepare(`
    SELECT id, status, target_adapter, successor_run_id, successor_session_id, updated_at
    FROM agent_continuations
    WHERE source_capsule_id = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get(packetId) as {
    id: string;
    status: string;
    target_adapter: string;
    successor_run_id: string | null;
    successor_session_id: string | null;
    updated_at: number;
  } | undefined;
  return row ? {
    id: row.id,
    status: row.status,
    targetAdapter: row.target_adapter,
    successorRunId: row.successor_run_id,
    successorSessionId: row.successor_session_id,
    updatedAt: row.updated_at,
  } : null;
}

function readiness(
  assessment: EnvelopeAssessment,
  packet: CompactionPacket | null,
  continuation: ContextContinuityItem['continuation'],
): ContextContinuityItem['readiness'] {
  if (continuation?.status === 'completed') return 'completed';
  if (continuation && ['failed', 'unsupported', 'orphaned'].includes(continuation.status)) return 'failed';
  if (continuation) return 'continuing';
  if (packet && assessment.successorRequired) return 'successor-required';
  if (packet) return 'packet-ready';
  return 'observed';
}

export function listContextContinuity(
  db: DatabaseInstance,
  options: { limit?: number; projectDir?: string | null } = {},
): ContextContinuityProjection {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const rows = db.prepare(`
    SELECT * FROM harbor_events
    WHERE stream_type = 'transcript-event' AND kind = 'context_pressure'
    ORDER BY ledger_seq DESC
    LIMIT ?
  `).all(options.projectDir ? 1_000 : limit) as Array<{
    event_id: string;
    session_id: string;
    agent_node_id: string;
    payload_json: string;
  }>;

  const items: ContextContinuityItem[] = [];
  const failures: ContextContinuityFailure[] = [];
  for (const row of rows) {
    let rowProjectDir: string | null = null;
    try {
      const outer = JSON.parse(row.payload_json) as HarborPayload;
      const payloadJson = outer.payloadJson as Record<string, unknown> | undefined;
      const envelope = payloadJson?.contextEnvelope as ContextEnvelope | undefined;
      if (!envelope || envelope.schema !== 'pd.agent-harbor.context-envelope.v0') {
        throw new Error('context envelope is missing or uses an unsupported schema');
      }
      rowProjectDir = typeof envelope.projectDir === 'string' ? envelope.projectDir : null;
      if (options.projectDir && rowProjectDir !== options.projectDir) continue;
      const assessment = assessContextEnvelope(envelope);
      const packet = packetForEnvelope(db, row.session_id, envelope.envelopeId);
      if (packet) resumeFromPacket(db, packet);
      const continuation = packet ? continuationForPacket(db, packet.packetId) : null;
      const estimator = (envelope.estimator ?? {}) as Record<string, unknown>;
      items.push({
        agentNodeId: row.agent_node_id,
        sessionId: row.session_id,
        runId: envelope.runId ?? null,
        transcriptId: typeof envelope.transcriptId === 'string' ? envelope.transcriptId : null,
        model: typeof envelope.model === 'string' ? envelope.model : null,
        sourceAdapter: typeof envelope.sourceAdapter === 'string' ? envelope.sourceAdapter : null,
        project: typeof envelope.project === 'string' ? envelope.project : null,
        projectDir: rowProjectDir,
        envelopeId: envelope.envelopeId,
        measuredAt: envelope.measuredAt,
        pressure: {
          band: assessment.band,
          ratio: assessment.ratio,
          action: assessment.action,
          windowTokens: envelope.windowTokens,
          usedTokensEstimate: envelope.usedTokensEstimate,
          estimateMode: typeof estimator.estimateMode === 'string' ? estimator.estimateMode : 'unknown',
          strategy: typeof estimator.strategy === 'string' ? estimator.strategy : 'unknown',
          selfReportDrift: assessment.selfReportDrift,
        },
        packet: packet ? {
          packetId: packet.packetId,
          createdAt: packet.createdAt,
          validatorPassed: packet.validator.passed,
          sourceHeadEventId: packet.sourceTranscript.headEventId,
          sourceHeadHash: packet.sourceTranscript.headHash,
          transcriptEventId: packet.transcriptEventId ?? null,
        } : null,
        handoffEpisodeId: packet ? handoffEpisodeId(db, packet.packetId) : null,
        continuation,
        readiness: readiness(assessment, packet, continuation),
      });
      if (items.length >= limit) break;
    } catch (error) {
      // Do not show a false green receipt, but do preserve the existence of a
      // failed proof. Project-scoped reads omit failures that cannot safely be
      // attributed to the requested project.
      if (!options.projectDir || rowProjectDir === options.projectDir) {
        failures.push({
          eventId: row.event_id,
          sessionId: row.session_id,
          agentNodeId: row.agent_node_id,
          reason: (error instanceof Error ? error.message : String(error)).slice(0, 240),
        });
      }
    }
  }

  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    counts: {
      observed: items.length,
      packetReady: items.filter((item) => item.packet !== null).length,
      successorRequired: items.filter((item) => item.readiness === 'successor-required').length,
      continuing: items.filter((item) => item.readiness === 'continuing').length,
      completed: items.filter((item) => item.readiness === 'completed').length,
      verificationFailed: failures.length,
    },
    items,
    failures,
  };
}
