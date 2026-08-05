import type { TranscriptEntry, Transcripts } from './transcripts.js';

export type TranscriptBackendSupport = 'supported' | 'degraded' | 'missing';
export type TranscriptFlowState = 'supported' | 'degraded' | 'missing';
export type TranscriptCaptureMode =
  | 'live_stream'
  | 'structured_final'
  | 'final_only'
  | 'metadata_only'
  | 'none';

export interface TranscriptBackendProfile {
  backend: string;
  displayName: string;
  family: string;
  support: TranscriptBackendSupport;
  captureMode: TranscriptCaptureMode;
  liveHeartbeatExpected: boolean;
  finalTranscriptExpected: boolean;
  notes: string;
}

export interface TranscriptTrackedRun {
  agentId: string;
  backend: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'over_budget';
  startedAt: number;
  completedAt?: number | null;
}

export interface TranscriptRunIssue {
  code:
    | 'transcript_row_missing'
    | 'transcript_flow_stalled'
    | 'transcript_live_row_ended'
    | 'transcript_final_missing';
  state: TranscriptFlowState;
  severity: 'critical';
  requiresHitl: boolean;
  message: string;
}

export interface TranscriptRunAssessment {
  agentId: string;
  backend: string;
  status: TranscriptTrackedRun['status'];
  startedAt: number;
  completedAt: number | null;
  transcriptId: string | null;
  transcriptStatus: TranscriptEntry['status'] | null;
  profileSupport: TranscriptBackendSupport;
  captureMode: TranscriptCaptureMode;
  liveHeartbeatExpected: boolean;
  flowState: TranscriptFlowState;
  lastTranscriptActivityAt: number | null;
  messageCount: number;
  outputCount: number;
  issue: TranscriptRunIssue | null;
}

export interface TranscriptComplianceReport {
  matrix: TranscriptBackendProfile[];
  runs: TranscriptRunAssessment[];
  issues: Array<TranscriptRunIssue & { agentId: string; backend: string; transcriptId: string | null }>;
  state: 'nominal' | 'degraded';
  degraded: boolean;
  hitlEmergency: boolean;
  summary: {
    backendCoverage: Record<TranscriptBackendSupport, number>;
    flow: Record<TranscriptFlowState, number> & {
      running: number;
      terminal: number;
      issues: number;
      hitl: number;
    };
  };
  thresholds: {
    stallAfterMs: number;
  };
}

export interface TranscriptAssessmentOptions {
  now?: number;
  stallAfterMs?: number;
}

export const TRANSCRIPT_FLOW_STALL_AFTER_MS = 90_000;

const TRANSCRIPT_BACKEND_PROFILES: readonly TranscriptBackendProfile[] = [
  {
    backend: 'cloudflare',
    displayName: 'Cloudflare Workers AI',
    family: 'cloud',
    support: 'supported',
    captureMode: 'structured_final',
    liveHeartbeatExpected: false,
    finalTranscriptExpected: true,
    notes: 'Parses reasoning and tool-call structure from the final Workers AI result.',
  },
  {
    backend: 'claude',
    displayName: 'Claude SDK',
    family: 'anthropic',
    support: 'degraded',
    captureMode: 'final_only',
    liveHeartbeatExpected: false,
    finalTranscriptExpected: true,
    notes: 'Records the final assistant answer only; no live delta stream or structured tool/reasoning capture.',
  },
  {
    backend: 'claude-cli',
    displayName: 'Claude CLI',
    family: 'anthropic',
    support: 'degraded',
    captureMode: 'final_only',
    liveHeartbeatExpected: false,
    finalTranscriptExpected: true,
    notes: 'JSON result carries exact usage, but transcript capture is still final-answer-only.',
  },
  {
    backend: 'cli:claude-code',
    displayName: 'Claude Code (CLI)',
    family: 'anthropic',
    support: 'supported',
    captureMode: 'live_stream',
    liveHeartbeatExpected: true,
    finalTranscriptExpected: true,
    notes: 'Streams JSONL transcript deltas live and finalizes a structured transcript at run end.',
  },
  {
    backend: 'cli:codex',
    displayName: 'Codex (CLI)',
    family: 'openai',
    support: 'supported',
    captureMode: 'live_stream',
    liveHeartbeatExpected: true,
    finalTranscriptExpected: true,
    notes: 'Streams Codex JSON events live and records structured turns plus final transcript.',
  },
  {
    backend: 'cli:agy',
    displayName: 'Antigravity (agy CLI)',
    family: 'cli-tube',
    support: 'degraded',
    captureMode: 'final_only',
    liveHeartbeatExpected: false,
    finalTranscriptExpected: true,
    notes: 'CLI-tube wiring records the user prompt plus final stdout/stderr only; no structured agy stream is documented yet.',
  },
  {
    backend: 'cli:gemini',
    displayName: 'Gemini CLI',
    family: 'google',
    support: 'degraded',
    captureMode: 'final_only',
    liveHeartbeatExpected: false,
    finalTranscriptExpected: true,
    notes: 'CLI-tube wiring exists, but Port Daddy does not yet parse a structured Gemini CLI transcript stream.',
  },
  {
    backend: 'cli:groq',
    displayName: 'Groq CLI',
    family: 'openai-compatible',
    support: 'degraded',
    captureMode: 'final_only',
    liveHeartbeatExpected: false,
    finalTranscriptExpected: true,
    notes: 'CLI-tube wiring exists, but transcript capture is limited to the final output blob.',
  },
  {
    backend: 'cli:grok',
    displayName: 'Grok CLI',
    family: 'openai-compatible',
    support: 'degraded',
    captureMode: 'final_only',
    liveHeartbeatExpected: false,
    finalTranscriptExpected: true,
    notes: 'CLI-tube wiring exists, but transcript capture is limited to the final output blob.',
  },
  {
    backend: 'codex',
    displayName: 'Codex (legacy CLI mode)',
    family: 'openai',
    support: 'supported',
    captureMode: 'structured_final',
    liveHeartbeatExpected: false,
    finalTranscriptExpected: true,
    notes: 'Parses the final Codex JSON event log into thinking, tool, and assistant turns.',
  },
  {
    backend: 'gemini',
    displayName: 'Gemini API',
    family: 'google',
    support: 'supported',
    captureMode: 'structured_final',
    liveHeartbeatExpected: false,
    finalTranscriptExpected: true,
    notes: 'Parses Gemini generateContent parts into structured thinking/tool/assistant turns.',
  },
  {
    backend: 'groq',
    displayName: 'Groq API',
    family: 'openai-compatible',
    support: 'degraded',
    captureMode: 'final_only',
    liveHeartbeatExpected: false,
    finalTranscriptExpected: true,
    notes: 'OpenAI-compatible adapter records the final assistant answer only.',
  },
  {
    backend: 'deepseek',
    displayName: 'DeepSeek API',
    family: 'openai-compatible',
    support: 'degraded',
    captureMode: 'final_only',
    liveHeartbeatExpected: false,
    finalTranscriptExpected: true,
    notes: 'OpenAI-compatible adapter records the final assistant answer only.',
  },
  {
    backend: 'lmstudio',
    displayName: 'LM Studio',
    family: 'local-model-server',
    support: 'degraded',
    captureMode: 'final_only',
    liveHeartbeatExpected: false,
    finalTranscriptExpected: true,
    notes: 'Local model server wiring records the final assistant answer only.',
  },
  {
    backend: 'ollama',
    displayName: 'Ollama',
    family: 'local-model-server',
    support: 'degraded',
    captureMode: 'final_only',
    liveHeartbeatExpected: false,
    finalTranscriptExpected: true,
    notes: 'Local model server wiring records the final assistant answer only.',
  },
  {
    backend: 'openai',
    displayName: 'OpenAI API',
    family: 'openai-compatible',
    support: 'degraded',
    captureMode: 'final_only',
    liveHeartbeatExpected: false,
    finalTranscriptExpected: true,
    notes: 'Records the final assistant answer only from the Chat Completions response.',
  },
  {
    backend: 'xai',
    displayName: 'xAI API',
    family: 'openai-compatible',
    support: 'degraded',
    captureMode: 'final_only',
    liveHeartbeatExpected: false,
    finalTranscriptExpected: true,
    notes: 'OpenAI-compatible adapter records the final assistant answer only.',
  },
  {
    backend: 'aider',
    displayName: 'Aider',
    family: 'custom-cli',
    support: 'degraded',
    captureMode: 'final_only',
    liveHeartbeatExpected: false,
    finalTranscriptExpected: true,
    notes: 'Records final CLI output only; no structured transcript parser is wired.',
  },
  {
    backend: 'custom',
    displayName: 'Custom command',
    family: 'custom-cli',
    support: 'degraded',
    captureMode: 'final_only',
    liveHeartbeatExpected: false,
    finalTranscriptExpected: true,
    notes: 'Records final shell stdout/stderr only; no structured transcript parser is wired.',
  },
];

const PROFILE_BY_BACKEND = new Map(
  TRANSCRIPT_BACKEND_PROFILES.map((profile) => [profile.backend, profile]),
);

const UNKNOWN_BACKEND_PROFILE: TranscriptBackendProfile = {
  backend: 'unknown',
  displayName: 'Unknown backend',
  family: 'unknown',
  support: 'missing',
  captureMode: 'none',
  liveHeartbeatExpected: false,
  finalTranscriptExpected: false,
  notes: 'No transcript compliance profile is registered for this backend.',
};

export function listTranscriptBackendProfiles(): TranscriptBackendProfile[] {
  return TRANSCRIPT_BACKEND_PROFILES.map((profile) => ({ ...profile }));
}

export function getTranscriptBackendProfile(backend: string): TranscriptBackendProfile {
  const profile = PROFILE_BY_BACKEND.get(backend);
  if (profile) return profile;
  return {
    ...UNKNOWN_BACKEND_PROFILE,
    backend,
    displayName: backend || UNKNOWN_BACKEND_PROFILE.displayName,
  };
}

export function findLatestTranscriptForAgent(
  transcripts: Pick<Transcripts, 'listTranscripts' | 'getTranscript'>,
  agentId: string,
): TranscriptEntry | null {
  const [header] = transcripts.listTranscripts({ agentId, limit: 1 }) || [];
  if (!header) return null;
  return transcripts.getTranscript(header.id) || header;
}

export function transcriptLastActivityAt(entry: TranscriptEntry | null): number | null {
  if (!entry) return null;
  let last = entry.started_at;
  for (const message of entry.messages || []) {
    if (typeof message.timestamp === 'number') {
      last = Math.max(last, message.timestamp);
    }
  }
  if (typeof entry.ended_at === 'number') {
    last = Math.max(last, entry.ended_at);
  }
  return Number.isFinite(last) ? last : null;
}

function hasRecordedOutcome(entry: TranscriptEntry): boolean {
  return (entry.messages || []).some((message) => message.role !== 'system' && message.role !== 'user')
    || (entry.outputs || []).length > 0
    || Boolean(entry.error);
}

function criticalIssue(
  code: TranscriptRunIssue['code'],
  state: TranscriptFlowState,
  message: string,
): TranscriptRunIssue {
  return {
    code,
    state,
    severity: 'critical',
    requiresHitl: true,
    message,
  };
}

export function assessTranscriptEntry(
  entry: TranscriptEntry,
  options: TranscriptAssessmentOptions = {},
): TranscriptRunAssessment {
  return assessTranscriptRun({
    agentId: entry.spawned_agent_id,
    backend: entry.backend,
    status: entry.status,
    startedAt: entry.started_at,
    completedAt: entry.ended_at ?? null,
  }, entry, options);
}

export function assessTranscriptRun(
  run: TranscriptTrackedRun,
  transcript: TranscriptEntry | null,
  options: TranscriptAssessmentOptions = {},
): TranscriptRunAssessment {
  const now = options.now ?? Date.now();
  const stallAfterMs = options.stallAfterMs ?? TRANSCRIPT_FLOW_STALL_AFTER_MS;
  const profile = getTranscriptBackendProfile(run.backend);
  const lastActivityAt = transcriptLastActivityAt(transcript);
  const messageCount = transcript?.messages?.length ?? 0;
  const outputCount = transcript?.outputs?.length ?? 0;

  let issue: TranscriptRunIssue | null = null;

  if (!transcript) {
    issue = criticalIssue(
      'transcript_row_missing',
      'missing',
      `Run ${run.agentId} (${run.backend}) is ${run.status} but has no transcript row.`,
    );
  } else if (run.status === 'running') {
    if (transcript.status !== 'running') {
      issue = criticalIssue(
        'transcript_live_row_ended',
        'degraded',
        `Run ${run.agentId} (${run.backend}) still claims to be live, but transcript ${transcript.id} is already ${transcript.status}.`,
      );
    } else if (
      profile.liveHeartbeatExpected
      && lastActivityAt !== null
      && now - lastActivityAt > stallAfterMs
    ) {
      issue = criticalIssue(
        'transcript_flow_stalled',
        'degraded',
        `Run ${run.agentId} (${run.backend}) is live but transcript ${transcript.id} has been idle for ${now - lastActivityAt} ms.`,
      );
    }
  } else if (
    transcript.status === 'running'
    || transcript.ended_at == null
    || !hasRecordedOutcome(transcript)
  ) {
    issue = criticalIssue(
      'transcript_final_missing',
      'missing',
      `Run ${run.agentId} (${run.backend}) finished as ${run.status}, but transcript ${transcript.id} has no terminal transcript outcome yet.`,
    );
  }

  return {
    agentId: run.agentId,
    backend: run.backend,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt ?? null,
    transcriptId: transcript?.id ?? null,
    transcriptStatus: transcript?.status ?? null,
    profileSupport: profile.support,
    captureMode: profile.captureMode,
    liveHeartbeatExpected: profile.liveHeartbeatExpected,
    flowState: issue?.state ?? 'supported',
    lastTranscriptActivityAt: lastActivityAt,
    messageCount,
    outputCount,
    issue,
  };
}

export function buildTranscriptComplianceReport(
  runs: TranscriptRunAssessment[],
  options: TranscriptAssessmentOptions = {},
): TranscriptComplianceReport {
  const stallAfterMs = options.stallAfterMs ?? TRANSCRIPT_FLOW_STALL_AFTER_MS;
  const matrix = listTranscriptBackendProfiles();
  const issues = runs
    .filter((run) => run.issue)
    .map((run) => ({
      ...(run.issue as TranscriptRunIssue),
      agentId: run.agentId,
      backend: run.backend,
      transcriptId: run.transcriptId,
    }));

  const backendCoverage: Record<TranscriptBackendSupport, number> = {
    supported: 0,
    degraded: 0,
    missing: 0,
  };
  for (const profile of matrix) {
    backendCoverage[profile.support] += 1;
  }

  const flow = {
    supported: 0,
    degraded: 0,
    missing: 0,
    running: 0,
    terminal: 0,
    issues: issues.length,
    hitl: issues.filter((issue) => issue.requiresHitl).length,
  };
  for (const run of runs) {
    flow[run.flowState] += 1;
    if (run.status === 'running') flow.running += 1;
    else flow.terminal += 1;
  }

  return {
    matrix,
    runs,
    issues,
    state: issues.length > 0 ? 'degraded' : 'nominal',
    degraded: issues.length > 0,
    hitlEmergency: issues.some((issue) => issue.requiresHitl),
    summary: {
      backendCoverage,
      flow,
    },
    thresholds: {
      stallAfterMs,
    },
  };
}
