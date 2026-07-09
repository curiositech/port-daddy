import type { CloudAppTelemetryEvent } from './cloud-app-telemetry.js';
import { TRANSCRIPT_EMERGENCY_EVENT } from './transcript-emergency-constants.js';
import {
  assessTranscriptRun,
  buildTranscriptComplianceReport,
  findLatestTranscriptForAgent,
  type TranscriptComplianceReport,
  type TranscriptTrackedRun,
} from './transcript-compliance.js';
import type { Transcripts } from './transcripts.js';
export {
  TRANSCRIPT_EMERGENCY_EVENT,
  TRANSCRIPT_EMERGENCY_EVENTS,
  type TranscriptEmergencyEvent,
} from './transcript-emergency-constants.js';

export const TRANSCRIPT_EMERGENCY_KIND = {
  LOCAL_SPAWNER: 'local_spawner',
  CLOUD_FLEET_D1: 'cloud_fleet_d1',
} as const;
export type TranscriptEmergencyKind = typeof TRANSCRIPT_EMERGENCY_KIND[keyof typeof TRANSCRIPT_EMERGENCY_KIND];
export const TRANSCRIPT_EMERGENCY_KINDS = Object.values(TRANSCRIPT_EMERGENCY_KIND) as readonly TranscriptEmergencyKind[];

export const TRANSCRIPT_EMERGENCY_SCOPE = {
  LOCAL: 'local',
  CLOUD: 'cloud',
  MIXED: 'mixed',
} as const;
export type TranscriptEmergencyScope = typeof TRANSCRIPT_EMERGENCY_SCOPE[keyof typeof TRANSCRIPT_EMERGENCY_SCOPE];
export const TRANSCRIPT_EMERGENCY_SCOPES = Object.values(TRANSCRIPT_EMERGENCY_SCOPE) as readonly TranscriptEmergencyScope[];

export const TRANSCRIPT_EMERGENCY_STATE = {
  NOMINAL: 'nominal',
  DEGRADED: 'degraded',
  EMERGENCY: 'emergency',
} as const;
export type TranscriptEmergencyState = typeof TRANSCRIPT_EMERGENCY_STATE[keyof typeof TRANSCRIPT_EMERGENCY_STATE];
export const TRANSCRIPT_EMERGENCY_STATES = Object.values(TRANSCRIPT_EMERGENCY_STATE) as readonly TranscriptEmergencyState[];

export const TRANSCRIPT_EMERGENCY_ISSUE_CODE = {
  ROW_MISSING: 'transcript_row_missing',
  FLOW_STALLED: 'transcript_flow_stalled',
  LIVE_ROW_ENDED: 'transcript_live_row_ended',
  FINAL_MISSING: 'transcript_final_missing',
  WRITE_FAILED: 'transcript_write_failed',
} as const;
export type TranscriptEmergencyIssueCode = typeof TRANSCRIPT_EMERGENCY_ISSUE_CODE[keyof typeof TRANSCRIPT_EMERGENCY_ISSUE_CODE];
export const TRANSCRIPT_EMERGENCY_ISSUE_CODES = Object.values(TRANSCRIPT_EMERGENCY_ISSUE_CODE) as readonly TranscriptEmergencyIssueCode[];

export interface TranscriptEmergencyIssue {
  code: TranscriptEmergencyIssueCode;
  message: string;
  severity: 'warning' | 'critical';
  requiresHitl: boolean;
  sourceId?: string | null;
  backend?: string | null;
  transcriptId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface TranscriptEmergencyInput {
  kind: TranscriptEmergencyKind;
  label?: string;
  scope?: TranscriptEmergencyScope;
  checkedAt?: number;
  total?: number;
  healthy?: number;
  degraded?: number;
  missing?: number;
  issues?: TranscriptEmergencyIssue[];
  metadata?: Record<string, unknown> | null;
}

export interface TranscriptEmergencyRecord {
  kind: TranscriptEmergencyKind;
  label: string;
  scope: TranscriptEmergencyScope;
  state: TranscriptEmergencyState;
  requiresHitl: boolean;
  checkedAt: number;
  total: number;
  healthy: number;
  degraded: number;
  missing: number;
  issues: TranscriptEmergencyIssue[];
  metadata: Record<string, unknown> | null;
}

export interface TranscriptEmergencyReport {
  generatedAt: number;
  state: TranscriptEmergencyState;
  hitlEmergency: boolean;
  records: TranscriptEmergencyRecord[];
  summary: {
    issues: number;
    hitl: number;
    missing: number;
    degraded: number;
    kinds: {
      total: number;
      nominal: number;
      degraded: number;
      emergency: number;
    };
  };
}

export interface TranscriptEmergencyOptions {
  now?: number;
  stallAfterMs?: number;
  cloudSinceMs?: number;
  cloudLimit?: number;
}

export interface TranscriptEmergencySourceDeps {
  transcripts?: Pick<Transcripts, 'listTranscripts' | 'getTranscript'>;
  spawner?: {
    list(): TranscriptTrackedRun[];
  };
  cloudAppTelemetry?: {
    recent(limit?: number, since?: number): CloudAppTelemetryEvent[];
  };
}

function nonNegativeInt(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

export function parseTranscriptEmergencyPositiveIntQuery(value: unknown): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw > 0 ? raw : undefined;
  }
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeIssue(issue: TranscriptEmergencyIssue): TranscriptEmergencyIssue {
  const requiresHitl = issue.requiresHitl === true || issue.severity === 'critical';
  return {
    ...issue,
    severity: issue.severity === 'critical' ? 'critical' : 'warning',
    requiresHitl,
    sourceId: issue.sourceId ?? null,
    backend: issue.backend ?? null,
    transcriptId: issue.transcriptId ?? null,
    metadata: issue.metadata ?? null,
  };
}

function stateFor(input: { missing: number; degraded: number; issues: TranscriptEmergencyIssue[] }): TranscriptEmergencyState {
  if (
    input.missing > 0 ||
    input.issues.some((issue) => issue.requiresHitl || issue.severity === 'critical')
  ) {
    return TRANSCRIPT_EMERGENCY_STATE.EMERGENCY;
  }
  if (input.degraded > 0 || input.issues.length > 0) return TRANSCRIPT_EMERGENCY_STATE.DEGRADED;
  return TRANSCRIPT_EMERGENCY_STATE.NOMINAL;
}

export function buildTranscriptEmergencyReport(
  inputs: TranscriptEmergencyInput[],
  options: { now?: number } = {},
): TranscriptEmergencyReport {
  const generatedAt = options.now ?? Date.now();
  const records = inputs.map((input): TranscriptEmergencyRecord => {
    const issues = (input.issues ?? []).map(normalizeIssue);
    const total = nonNegativeInt(input.total);
    const degraded = nonNegativeInt(input.degraded);
    const missing = nonNegativeInt(input.missing);
    const healthy = nonNegativeInt(input.healthy ?? Math.max(0, total - degraded - missing));
    const state = stateFor({ missing, degraded, issues });
    return {
      kind: input.kind,
      label: input.label ?? input.kind,
      scope: input.scope ?? TRANSCRIPT_EMERGENCY_SCOPE.MIXED,
      state,
      requiresHitl: state === TRANSCRIPT_EMERGENCY_STATE.EMERGENCY && issues.some((issue) => issue.requiresHitl),
      checkedAt: input.checkedAt ?? generatedAt,
      total,
      healthy,
      degraded,
      missing,
      issues,
      metadata: input.metadata ?? null,
    };
  });

  const kinds = {
    total: records.length,
    nominal: records.filter((record) => record.state === TRANSCRIPT_EMERGENCY_STATE.NOMINAL).length,
    degraded: records.filter((record) => record.state === TRANSCRIPT_EMERGENCY_STATE.DEGRADED).length,
    emergency: records.filter((record) => record.state === TRANSCRIPT_EMERGENCY_STATE.EMERGENCY).length,
  };
  const hitl = records.reduce(
    (count, record) => count + record.issues.filter((issue) => issue.requiresHitl).length,
    0,
  );
  const state: TranscriptEmergencyState = kinds.emergency > 0
    ? TRANSCRIPT_EMERGENCY_STATE.EMERGENCY
    : kinds.degraded > 0
      ? TRANSCRIPT_EMERGENCY_STATE.DEGRADED
      : TRANSCRIPT_EMERGENCY_STATE.NOMINAL;

  return {
    generatedAt,
    state,
    hitlEmergency: hitl > 0,
    records,
    summary: {
      issues: records.reduce((count, record) => count + record.issues.length, 0),
      hitl,
      missing: records.reduce((count, record) => count + record.missing, 0),
      degraded: records.reduce((count, record) => count + record.degraded, 0),
      kinds,
    },
  };
}

export function transcriptEmergencyInputFromCompliance(
  report: Pick<TranscriptComplianceReport, 'issues' | 'summary' | 'degraded' | 'hitlEmergency'>,
  options: { checkedAt?: number } = {},
): TranscriptEmergencyInput {
  const flow = report.summary?.flow ?? {
    supported: 0,
    degraded: 0,
    missing: 0,
    running: 0,
    terminal: 0,
    issues: 0,
    hitl: 0,
  };
  const total = nonNegativeInt(flow.running) + nonNegativeInt(flow.terminal);
  return {
    kind: TRANSCRIPT_EMERGENCY_KIND.LOCAL_SPAWNER,
    label: 'Local spawner transcript flow',
    scope: TRANSCRIPT_EMERGENCY_SCOPE.LOCAL,
    checkedAt: options.checkedAt,
    total,
    healthy: nonNegativeInt(flow.supported),
    degraded: nonNegativeInt(flow.degraded),
    missing: nonNegativeInt(flow.missing),
    issues: (report.issues ?? []).map((issue) => ({
      code: issue.code,
      message: issue.message,
      severity: issue.severity,
      requiresHitl: issue.requiresHitl,
      sourceId: issue.agentId ?? issue.transcriptId ?? null,
      backend: issue.backend ?? null,
      transcriptId: issue.transcriptId ?? null,
      metadata: { state: issue.state },
    })),
  };
}

function isTranscriptWriteFailure(event: CloudAppTelemetryEvent): boolean {
  const metadata = event.metadata ?? {};
  return event.event === TRANSCRIPT_EMERGENCY_EVENT.WRITE_FAILED ||
    event.event === TRANSCRIPT_EMERGENCY_EVENT.WRITE_FAILED_LEGACY ||
    metadata.transcriptWriteFailure === true;
}

export function transcriptEmergencyInputFromCloudTelemetry(
  events: CloudAppTelemetryEvent[],
  options: { checkedAt?: number } = {},
): TranscriptEmergencyInput {
  const failures = events.filter(isTranscriptWriteFailure);
  return {
    kind: TRANSCRIPT_EMERGENCY_KIND.CLOUD_FLEET_D1,
    label: 'Cloud fleet D1 transcript writes',
    scope: TRANSCRIPT_EMERGENCY_SCOPE.CLOUD,
    checkedAt: options.checkedAt,
    total: failures.length,
    healthy: 0,
    degraded: 0,
    missing: failures.length,
    issues: failures.map((event) => ({
      code: TRANSCRIPT_EMERGENCY_ISSUE_CODE.WRITE_FAILED,
      message: `Cloud fleet transcript write failed for ${event.ship ?? 'unknown ship'}${event.deliveryId ? ` (${event.deliveryId})` : ''}.`,
      severity: 'critical',
      requiresHitl: true,
      sourceId: event.deliveryId ?? event.id,
      backend: event.backend ?? null,
      transcriptId: null,
      metadata: {
        eventId: event.id,
        runId: event.metadata?.runId ?? null,
        seq: event.metadata?.seq ?? null,
        kind: event.metadata?.kind ?? null,
        ship: event.ship ?? null,
        owner: event.owner ?? null,
        repo: event.repo ?? null,
        prNumber: event.prNumber ?? null,
        error: event.metadata?.error ?? null,
      },
    })),
  };
}

export function buildTranscriptEmergencyFromSources(
  deps: TranscriptEmergencySourceDeps,
  options: TranscriptEmergencyOptions = {},
): TranscriptEmergencyReport {
  const now = options.now ?? Date.now();
  const inputs: TranscriptEmergencyInput[] = [];

  if (deps.transcripts) {
    const runs = (deps.spawner?.list() || []).map((run) =>
      assessTranscriptRun(
        run,
        findLatestTranscriptForAgent(deps.transcripts as Pick<Transcripts, 'listTranscripts' | 'getTranscript'>, run.agentId),
        { now, stallAfterMs: options.stallAfterMs },
      ),
    );
    inputs.push(transcriptEmergencyInputFromCompliance(
      buildTranscriptComplianceReport(runs, { stallAfterMs: options.stallAfterMs }),
      { checkedAt: now },
    ));
  }

  if (deps.cloudAppTelemetry) {
    const since = options.cloudSinceMs ?? now - 86_400_000;
    const events = deps.cloudAppTelemetry.recent(options.cloudLimit ?? 100, since);
    inputs.push(transcriptEmergencyInputFromCloudTelemetry(events, { checkedAt: now }));
  }

  return buildTranscriptEmergencyReport(inputs, { now });
}
