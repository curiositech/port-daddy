// ─── Port Daddy Fleet API client ──────────────────────────────────────────────

import type {
  FleetDaemonStatus,
  ProjectSummary,
  FleetConfig,
  TopologyValidation,
  BackendInfo,
  RegistryAgent,
  InboxMessage,
  InboxStats,
  SalvageAgent,
  SessionSummary,
  FileClaim,
  SpawnedAgent,
  OperatorActorEntry,
  SpawnPreflight,
  ActivityEntry,
  ChannelMessage,
  ChannelDiscoveryEnvelope,
  DeclaredChannel,
  EnsureChannelInput,
  EnsureChannelResult,
  FilePreview,
  CoordinationGuardAction,
  CoordinationGuardEnvelope,
  CoordinationGuardMode,
  StoryNote,
  TupleEntry,
  GraphEdge,
  GraphStats,
  Episode,
  MemoryStats,
  RoadmapFeedbackStatus,
  RoadmapProgress,
  ResourceOverview,
  SemanticResolutionDecision,
  SemanticResolutionEvent,
  SemanticResolutionStats,
  BackendSecretSaveResult,
  UsageTelemetrySummary,
  UsageTraceInput,
  MissionIntake,
  SetupActionId,
  SetupOverview,
  SetupRunResult,
  ActiveAgentRoster,
  DispatchProposal,
  GalaxyMapResponse,
  GalaxyParleyCallRequest,
  GalaxySessionDetailResponse,
} from './types';

const CANONICAL_PREFERRED_DAEMON_URL = 'http://127.0.0.1:9876';
const DAEMON_STORAGE_KEY = 'pd.fleet-ui.daemon-url';
const DAEMON_HISTORY_STORAGE_KEY = 'pd.fleet-ui.daemon-history';
export const CUSTOM_DAEMON_SENTINEL = '__custom__';

function canUseWindow(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function inferOriginDaemonUrl(): string | null {
  if (!canUseWindow()) return null;
  try {
    const { origin, protocol, hostname } = window.location;
    if (!/^https?:$/.test(protocol)) return null;
    if (!hostname) return null;
    return safeNormalize(origin);
  } catch {
    return null;
  }
}

function defaultDaemonChoices(): string[] {
  return uniqueDaemonUrls([
    inferOriginDaemonUrl(),
    CANONICAL_PREFERRED_DAEMON_URL,
  ]);
}

function fallbackDaemonUrl(): string {
  return defaultDaemonChoices()[0] ?? CANONICAL_PREFERRED_DAEMON_URL;
}

function normalizeDaemonUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallbackDaemonUrl();

  let candidate = trimmed;
  if (/^\d+$/.test(candidate)) {
    candidate = `http://127.0.0.1:${candidate}`;
  } else if (!/^https?:\/\//i.test(candidate)) {
    candidate = `http://${candidate}`;
  }

  const parsed = new URL(candidate);
  return `${parsed.protocol}//${parsed.host}`;
}

function safeNormalize(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return normalizeDaemonUrl(value);
  } catch {
    return null;
  }
}

function readDaemonHistory(): string[] {
  if (!canUseWindow()) return [];
  try {
    const raw = window.localStorage.getItem(DAEMON_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(value => safeNormalize(typeof value === 'string' ? value : null))
      .filter((value): value is string => !!value);
  } catch {
    return [];
  }
}

function writeDaemonHistory(urls: string[]): void {
  if (!canUseWindow()) return;
  window.localStorage.setItem(DAEMON_HISTORY_STORAGE_KEY, JSON.stringify(urls.slice(0, 8)));
}

function uniqueDaemonUrls(urls: Array<string | null | undefined>): string[] {
  return [...new Set(urls.filter((u): u is string => !!u))];
}

function getQueryDaemonUrl(): string | null {
  if (!canUseWindow()) return null;
  const params = new URLSearchParams(window.location.search);
  return safeNormalize(params.get('daemon'));
}

function resolveInitialDaemonUrl(): string {
  return uniqueDaemonUrls([
    getQueryDaemonUrl(),
    inferOriginDaemonUrl(),
    safeNormalize(canUseWindow() ? window.localStorage.getItem(DAEMON_STORAGE_KEY) : null),
    fallbackDaemonUrl(),
  ])[0] ?? fallbackDaemonUrl();
}

let daemonUrl = resolveInitialDaemonUrl();

function rememberDaemonUrl(url: string): void {
  if (!canUseWindow()) return;
  window.localStorage.setItem(DAEMON_STORAGE_KEY, url);
  writeDaemonHistory(uniqueDaemonUrls([url, ...readDaemonHistory(), ...defaultDaemonChoices()]));
}

function syncDaemonQueryParam(url: string): void {
  if (!canUseWindow()) return;
  const next = new URL(window.location.href);
  next.searchParams.set('daemon', url);
  window.history.replaceState({}, '', next);
}

function daemonEndpoint(path: string): string {
  return `${daemonUrl}${path}`;
}

export function getDaemonUrl(): string {
  return daemonUrl;
}

export function setDaemonUrl(nextUrl: string): string {
  daemonUrl = normalizeDaemonUrl(nextUrl);
  rememberDaemonUrl(daemonUrl);
  syncDaemonQueryParam(daemonUrl);
  return daemonUrl;
}

export function getDaemonChoices(): string[] {
  return uniqueDaemonUrls([
    daemonUrl,
    ...defaultDaemonChoices(),
    ...readDaemonHistory(),
  ]);
}

export function formatDaemonLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || (parsed.protocol === 'https:' ? '443' : '80')}`;
  } catch {
    return url;
  }
}

export function fetchSetupOverview(): Promise<SetupOverview> {
  return get<SetupOverview>('/setup/overview');
}

export function runSetupAction(input: {
  action: SetupActionId;
  confirmed?: boolean;
  projectDir?: string | null;
  setupToken?: string | null;
}): Promise<SetupRunResult> {
  return post<SetupRunResult>('/setup/run', {
    action: input.action,
    confirmed: input.confirmed === true,
    ...(input.projectDir ? { projectDir: input.projectDir } : {}),
    ...(input.setupToken ? { setupToken: input.setupToken } : {}),
  });
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const startedAt = Date.now();
  const res = await fetch(daemonEndpoint(path), {
    method,
    ...(body !== undefined && {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
  if (!res.ok) {
    void recordUsageEvent({
      surface: 'ui',
      kind: 'api_call',
      name: `${method} ${path.split('?')[0]}`,
      route: path,
      method,
      status: res.status,
      durationMs: Date.now() - startedAt,
      workScope: 'port_daddy_call',
      toolCalls: 1,
      category: pathCategory(path),
      userAgent: canUseWindow() ? window.navigator.userAgent : null,
    });

    const contentType = res.headers.get('content-type') ?? '';
    let detail = '';

    if (contentType.includes('application/json')) {
      const payload = await res.json().catch(() => null) as
        | { error?: unknown; preflight?: { blockedReasons?: unknown } }
        | null;
      if (typeof payload?.error === 'string' && payload.error.trim()) {
        detail = payload.error.trim();
      } else if (Array.isArray(payload?.preflight?.blockedReasons)) {
        const firstReason = payload.preflight.blockedReasons.find((reason): reason is string => typeof reason === 'string' && reason.trim().length > 0);
        if (firstReason) detail = firstReason;
      }
    } else {
      detail = (await res.text().catch(() => '')).trim();
    }

    throw new Error(detail || `${method} ${path}: ${res.status} ${res.statusText}`);
  }
  void recordUsageEvent({
    surface: 'ui',
    kind: 'api_call',
    name: `${method} ${path.split('?')[0]}`,
    route: path,
    method,
    status: res.status,
    durationMs: Date.now() - startedAt,
    workScope: 'port_daddy_call',
    toolCalls: 1,
    category: pathCategory(path),
    userAgent: canUseWindow() ? window.navigator.userAgent : null,
  });
  return res.json();
}

const get = <T>(path: string) => api<T>('GET', path);
const post = <T>(path: string, body?: unknown) => api<T>('POST', path, body);
const put = <T>(path: string, body: unknown) => api<T>('PUT', path, body);
const del = <T>(path: string) => api<T>('DELETE', path);

function pathCategory(path: string): string {
  const p = path.toLowerCase();
  if (p.startsWith('/usage')) return 'usage';
  if (p.startsWith('/fleet')) return 'fleet';
  if (p.startsWith('/dispatches')) return 'dispatch';
  if (p.startsWith('/agents')) return 'agents';
  if (p.startsWith('/sessions')) return 'sessions';
  if (p.startsWith('/msg') || p.startsWith('/channels')) return 'channels';
  if (p.startsWith('/tuples')) return 'tuples';
  if (p.startsWith('/pheromone')) return 'pheromones';
  if (p.startsWith('/resources')) return 'resources';
  if (p.startsWith('/activity')) return 'activity';
  if (p.startsWith('/memory')) return 'memory';
  if (p.startsWith('/sorties')) return 'sorties';
  if (p.startsWith('/projects')) return 'projects';
  if (p.startsWith('/locks')) return 'locks';
  if (p.startsWith('/services') || p.startsWith('/claim') || p.startsWith('/release')) return 'ports';
  if (p.startsWith('/galaxy')) return 'galaxy';
  return 'other';
}

export async function recordUsageEvent(input: UsageTraceInput): Promise<void> {
  if (input.route === '/usage/trace') return;
  const payload: UsageTraceInput = {
    ...input,
    surface: input.surface || 'ui',
    userAgent: input.userAgent ?? (canUseWindow() ? window.navigator.userAgent : null),
  };

  try {
    await fetch(daemonEndpoint('/usage/trace'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Usage telemetry must never make the operator UI noisy or brittle.
  }
}

export async function fetchUsageSummary(opts: {
  window?: string;
  limit?: number;
} = {}): Promise<UsageTelemetrySummary> {
  const params = new URLSearchParams();
  if (opts.window) params.set('window', opts.window);
  if (typeof opts.limit === 'number') params.set('limit', String(opts.limit));
  return get(`/usage/summary${params.toString() ? `?${params}` : ''}`);
}

interface FilePreviewEnvelope {
  success?: boolean;
  preview?: FilePreview;
}

// ─── Fleet ────────────────────────────────────────────────────────────────────

export async function fetchFleetStatus(): Promise<FleetDaemonStatus> {
  return get('/fleet');
}

export async function fetchActiveAgentRoster(opts: {
  project?: string | null;
  limit?: number;
} = {}): Promise<ActiveAgentRoster> {
  const params = new URLSearchParams();
  if (opts.project) params.set('project', opts.project);
  if (typeof opts.limit === 'number' && opts.limit > 0) params.set('limit', String(opts.limit));
  return get(`/agent-roster${params.toString() ? `?${params}` : ''}`);
}

export async function fetchProjects(): Promise<ProjectSummary[]> {
  const payload = await get<{ success: boolean; projects: ProjectSummary[] }>('/projects');
  return payload.projects ?? [];
}

export async function fetchRoadmapProgress(projectDir?: string, options: {
  feedbackStatus?: RoadmapFeedbackStatus | 'all';
  feedbackHarbor?: string;
  feedbackLimit?: number;
} = {}): Promise<RoadmapProgress> {
  const params = new URLSearchParams();
  if (projectDir) params.set('root', projectDir);
  if (options.feedbackStatus) params.set('feedbackStatus', options.feedbackStatus);
  if (options.feedbackHarbor) params.set('feedbackHarbor', options.feedbackHarbor);
  if (options.feedbackLimit) params.set('feedbackLimit', String(options.feedbackLimit));
  return get(`/cartographer/roadmap-progress${params.toString() ? `?${params}` : ''}`);
}

export async function harvestRoadmapFeedback(input: {
  feedbackId: string;
  harvestedBy?: string;
  intoSlug?: string;
}): Promise<{ success: boolean; entry: RoadmapProgress['liveFeedback'][number] }> {
  return post(`/feedback/${encodeURIComponent(input.feedbackId)}/harvest`, {
    harvestedBy: input.harvestedBy ?? 'operator-control-plane',
    intoSlug: input.intoSlug,
  });
}

export async function fetchCockpitMissions(
  options: { projectDir?: string; status?: string[]; limit?: number } = {},
): Promise<MissionIntake> {
  const params = new URLSearchParams();
  if (options.projectDir) params.set('projectDir', options.projectDir);
  if (options.status && options.status.length > 0) params.set('status', options.status.join(','));
  if (typeof options.limit === 'number' && options.limit > 0) {
    params.set('limit', String(options.limit));
  }
  const qs = params.toString();
  const payload = await get<{ success: boolean; intake: MissionIntake; count: number }>(
    `/cockpit/missions${qs ? `?${qs}` : ''}`,
  );
  return payload.intake;
}

export async function fetchCoordinationGuard(projectDir: string): Promise<CoordinationGuardEnvelope> {
  const params = new URLSearchParams({ projectDir });
  return get(`/operator/coordination-guard?${params.toString()}`);
}

export async function runCoordinationGuardAction(input: {
  projectDir: string;
  action: CoordinationGuardAction;
  mode?: Exclude<CoordinationGuardMode, 'off'>;
}): Promise<CoordinationGuardEnvelope> {
  return post('/operator/coordination-guard', {
    projectDir: input.projectDir,
    action: input.action,
    mode: input.mode ?? 'enforce',
  });
}

export async function fetchFleetConfig(project: string): Promise<{
  yaml: string;
  path: string;
  projectDir: string;
  parsed: FleetConfig;
  topology: TopologyValidation;
  resolvedChannels: Record<string, string>;
}> {
  return get(`/fleet/config/${encodeURIComponent(project)}`);
}

export async function saveFleetConfig(project: string, yaml: string): Promise<{
  success: boolean;
  warnings: string[];
  cycles: string[][];
}> {
  return put(`/fleet/config/${encodeURIComponent(project)}`, { yaml });
}

export async function setFleetConfigBudget(project: string, usdPerDay: number): Promise<{
  success: boolean;
  budgetUsdPerDay: number;
}> {
  return post(`/fleet/config/${encodeURIComponent(project)}/budget`, { usdPerDay });
}

export async function setFleetConfigRuntime(project: string, input: {
  backend: string;
  model?: string;
  modelTier?: 'low' | 'mid' | 'high';
  agentNames?: string[];
  clearFallbacks?: boolean;
  skipCustomAgents?: boolean;
}): Promise<{
  success: boolean;
  backend: string;
  model: string | null;
  modelTier: string | null;
  updatedAgents: string[];
  skippedAgents: string[];
}> {
  return post(`/fleet/config/${encodeURIComponent(project)}/runtime`, input);
}

export async function fetchResourceOverview(opts: {
  projectDir?: string;
  maxConcurrentSpawns?: number;
} = {}): Promise<ResourceOverview> {
  const params = new URLSearchParams();
  if (opts.projectDir) params.set('projectDir', opts.projectDir);
  if (typeof opts.maxConcurrentSpawns === 'number' && Number.isFinite(opts.maxConcurrentSpawns) && opts.maxConcurrentSpawns > 0) {
    params.set('maxConcurrentSpawns', String(Math.floor(opts.maxConcurrentSpawns)));
  }
  return get(`/resources/overview${params.toString() ? `?${params}` : ''}`);
}

export async function startFleet(projectDir?: string, enabledAgents?: string[]): Promise<{ success: boolean }> {
  if (!projectDir && !enabledAgents) return post('/fleet/start');
  return post('/fleet/start', {
    ...(projectDir ? { projectDir } : {}),
    ...(enabledAgents ? { enabledAgents } : {}),
  });
}

export async function stopFleet(projectDir?: string): Promise<{ success: boolean }> {
  return post('/fleet/stop', projectDir ? { projectDir } : undefined);
}

export async function runFleetAgent(projectDir: string, agentName: string): Promise<{ success: boolean; error?: string }> {
  return post('/fleet/agent/run', { projectDir, agentName });
}

export async function pauseFleetAgent(projectDir: string, agentName: string): Promise<{ success: boolean; error?: string }> {
  return post('/fleet/agent/pause', { projectDir, agentName });
}

export async function resumeFleetAgent(projectDir: string, agentName: string): Promise<{ success: boolean; error?: string }> {
  return post('/fleet/agent/resume', { projectDir, agentName });
}

export async function fetchRegistryAgents(opts: {
  activeOnly?: boolean;
  identity?: string;
  purpose?: string;
} = {}): Promise<RegistryAgent[]> {
  const params = new URLSearchParams();
  if (opts.activeOnly) params.set('active', 'true');
  if (opts.identity) params.set('identity', opts.identity);
  if (opts.purpose) params.set('purpose', opts.purpose);
  const data = await get<{ agents?: RegistryAgent[] }>(`/agents${params.toString() ? `?${params}` : ''}`);
  return data.agents ?? [];
}

export async function fetchAgentInbox(agentId: string, opts: {
  unreadOnly?: boolean;
  limit?: number;
  since?: number;
} = {}): Promise<InboxMessage[]> {
  const params = new URLSearchParams();
  if (opts.unreadOnly) params.set('unread', 'true');
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.since) params.set('since', String(opts.since));
  const data = await get<{ messages?: InboxMessage[] }>(`/agents/${encodeURIComponent(agentId)}/inbox${params.toString() ? `?${params}` : ''}`);
  return data.messages ?? [];
}

export async function fetchAgentInboxStats(agentId: string): Promise<InboxStats> {
  const data = await get<{ total?: number; unread?: number }>(`/agents/${encodeURIComponent(agentId)}/inbox/stats`);
  return {
    total: data.total ?? 0,
    unread: data.unread ?? 0,
  };
}

export async function markAllAgentInboxRead(agentId: string): Promise<{ success: boolean; marked: number }> {
  return put(`/agents/${encodeURIComponent(agentId)}/inbox/read-all`, {});
}

export async function clearAgentInbox(agentId: string): Promise<{ success: boolean; deleted: number }> {
  return del(`/agents/${encodeURIComponent(agentId)}/inbox`);
}

export async function fetchSalvageAgents(opts: {
  project?: string;
  stack?: string;
  limit?: number;
  includeResolved?: boolean;
} = {}): Promise<SalvageAgent[]> {
  const params = new URLSearchParams();
  if (opts.project) params.set('project', opts.project);
  if (opts.stack) params.set('stack', opts.stack);
  if (opts.limit) params.set('limit', String(opts.limit));
  const endpoint = opts.includeResolved ? '/salvage' : '/salvage/pending';
  const data = await get<{ agents?: SalvageAgent[] }>(`${endpoint}${params.toString() ? `?${params}` : ''}`);
  return data.agents ?? [];
}

export async function dismissSalvageAgent(agentId: string): Promise<{ success: boolean }> {
  return del(`/salvage/${encodeURIComponent(agentId)}`);
}

export async function fetchSessions(opts: {
  status?: string;
  agent?: string;
  project?: string;
  purpose?: string;
  includeNotes?: boolean;
  allWorktrees?: boolean;
  limit?: number;
} = {}): Promise<SessionSummary[]> {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.agent) params.set('agent', opts.agent);
  if (opts.project) params.set('project', opts.project);
  if (opts.purpose) params.set('purpose', opts.purpose);
  if (opts.includeNotes) params.set('notes', 'true');
  if (opts.allWorktrees) params.set('all', 'true');
  if (opts.limit) params.set('limit', String(opts.limit));
  const data = await get<{ sessions?: SessionSummary[] }>(`/sessions${params.toString() ? `?${params}` : ''}`);
  return data.sessions ?? [];
}

export async function fetchFileClaims(opts: {
  agent?: string;
  purpose?: string;
  path?: string;
  symbol?: string;
} = {}): Promise<FileClaim[]> {
  const params = new URLSearchParams();
  if (opts.agent) params.set('agent', opts.agent);
  if (opts.purpose) params.set('purpose', opts.purpose);
  if (opts.path) params.set('path', opts.path);
  if (opts.symbol) params.set('symbol', opts.symbol);
  const data = await get<{ claims?: FileClaim[] }>(`/files${params.toString() ? `?${params}` : ''}`);
  return data.claims ?? [];
}

// ─── Models ───────────────────────────────────────────────────────────────────

export async function fetchModels(): Promise<BackendInfo[]> {
  const data = await get<{ backends: BackendInfo[] }>('/fleet/models');
  return data.backends;
}

export async function saveBackendSecrets(input: {
  backend: string;
  values: Record<string, string>;
}): Promise<BackendSecretSaveResult> {
  return post('/fleet/backend-secrets', input);
}

// ─── Messaging ────────────────────────────────────────────────────────────────

export async function publishMessage(channel: string, payload: unknown, sender = 'fleet-ui'): Promise<{ success?: boolean; id?: number; message?: string }> {
  return post(`/msg/${encodeURIComponent(channel)}`, { payload, sender });
}

export async function discoverChannels(opts: {
  projectDir?: string;
  query?: string;
  includeObserved?: boolean;
} = {}): Promise<DeclaredChannel[]> {
  const params = new URLSearchParams();
  if (opts.projectDir) params.set('projectDir', opts.projectDir);
  if (opts.query) params.set('q', opts.query);
  if (opts.includeObserved) params.set('observed', 'true');
  const data = await get<ChannelDiscoveryEnvelope>(`/channels/discover${params.toString() ? `?${params}` : ''}`);
  return data.channels ?? [];
}

export async function ensureChannel(input: EnsureChannelInput): Promise<EnsureChannelResult> {
  return post('/channels/ensure', input);
}

export async function resolveChannel(name: string, projectDir?: string): Promise<DeclaredChannel | null> {
  const params = new URLSearchParams();
  if (projectDir) params.set('projectDir', projectDir);
  try {
    const data = await get<{ success: boolean; channel?: DeclaredChannel }>(
      `/channels/resolve/${encodeURIComponent(name)}${params.toString() ? `?${params}` : ''}`,
    );
    return data.channel ?? null;
  } catch {
    return null;
  }
}

/**
 * Send a direct inbox message and optionally wake the target fleet agent.
 *
 * Example:
 * - input: `('spark', { content: 'What should I do next?', project: 'port-daddy', wake: true })`
 * - output: `{ delivered: true, woke: false, error: 'No running fleet agent matches spark' }`
 *
 * A 409 wake conflict is treated as partial success because the daemon has
 * already stored the inbox message even if it could not wake a live runtime.
 */
export async function sendAgentMessage(agentId: string, opts: {
  content: unknown;
  project?: string;
  from?: string;
  type?: string;
  contentType?: 'text' | 'json' | 'binary';
  messageContent?: string;
  wake?: boolean;
}): Promise<{
  success: boolean;
  delivered: boolean;
  woke: boolean;
  messageId?: number;
  wake?: { success: boolean; project?: string; agent?: string; error?: string };
  error?: string;
}> {
  const path = `/agents/${encodeURIComponent(agentId)}/inbox`;
  const res = await fetch(daemonEndpoint(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: opts.content,
      project: opts.project,
      from: opts.from ?? 'fleet-ui',
      type: opts.type,
      contentType: opts.contentType,
      messageContent: opts.messageContent,
      wake: opts.wake ?? true,
    }),
  });

  const contentType = res.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await res.json().catch(() => null) as Record<string, unknown> | null
    : null;

  if (!res.ok && res.status !== 409) {
    const detail = typeof payload?.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : `${path}: ${res.status} ${res.statusText}`;
    throw new Error(detail);
  }

  return (payload ?? {
    success: res.ok,
    delivered: res.ok,
    woke: false,
  }) as {
    success: boolean;
    delivered: boolean;
    woke: boolean;
    messageId?: number;
    wake?: { success: boolean; project?: string; agent?: string; error?: string };
    error?: string;
  };
}

export async function proposeDispatchGoal(input: {
  goal: string;
  requestedBy?: string;
  mergePolicy?: 'review' | 'auto' | string;
  baseBranch?: string;
  targetActorId?: string | null;
  reviewerActorId?: string | null;
}): Promise<DispatchProposal> {
  const data = await post<{ ok?: boolean; dispatch: DispatchProposal }>('/dispatches', {
    goal: input.goal,
    requestedBy: input.requestedBy ?? 'fleet-ui',
    mergePolicy: input.mergePolicy ?? 'review',
    ...(input.baseBranch ? { baseBranch: input.baseBranch } : {}),
    ...(input.targetActorId ? { targetActorId: input.targetActorId } : {}),
    ...(input.reviewerActorId ? { reviewerActorId: input.reviewerActorId } : {}),
  });
  return data.dispatch;
}

export async function runDispatchNow(id: string): Promise<{
  ok?: boolean;
  queued?: boolean;
  launchedThisTick?: number;
  dispatch?: DispatchProposal;
  message?: string;
}> {
  return post(`/dispatches/${encodeURIComponent(id)}/run`);
}

/**
 * Ask the daemon to open a resolved file in the system editor.
 *
 * Example:
 * - input: `('routes/operator.ts', '/Users/me/port-daddy')`
 * - output: `{ success: true, path: '/Users/me/port-daddy/routes/operator.ts' }`
 */
export async function openFileInEditor(path: string, projectDir?: string): Promise<{ success: boolean; path: string }> {
  return post('/operator/open-file', {
    path,
    projectDir,
    mode: 'editor',
  });
}

/**
 * Ask the daemon to reveal a resolved file in Finder/explorer.
 *
 * Example:
 * - input: `('routes/operator.ts', '/Users/me/port-daddy')`
 * - output: `{ success: true, path: '/Users/me/port-daddy/routes/operator.ts' }`
 */
export async function revealFileInFinder(path: string, projectDir?: string): Promise<{ success: boolean; path: string }> {
  return post('/operator/open-file', {
    path,
    projectDir,
    mode: 'finder',
  });
}

/**
 * Load the lightweight diff/snapshot preview used by FleetBar mutation chips.
 *
 * Example:
 * - input: `('fleet-config-ui/src/components/FileActionLinks.tsx', '/Users/me/project', 24)`
 * - output: `{ displayPath: 'fleet-config-ui/src/components/FileActionLinks.tsx', source: 'working-tree', ... }`
 *
 * The daemon currently returns `{ success, preview }`, but this helper also
 * accepts a raw preview payload so the UI stays compatible with older or
 * partially-upgraded runtimes.
 */
export async function fetchFilePreview(
  path: string,
  projectDir?: string,
  maxLines = 24,
): Promise<FilePreview> {
  const payload = await post<FilePreviewEnvelope | FilePreview>('/operator/file-preview', {
    path,
    projectDir,
    maxLines,
  });
  if ('preview' in payload && payload.preview) {
    return payload.preview;
  }
  return payload as FilePreview;
}

/**
 * Ask the daemon which of the given paths exist on disk, so mention chips can
 * suppress heuristic false positives (model ids, prose) before rendering.
 *
 * Example:
 * - input: `(['routes/operator.ts', 'ollama/qwen2.5-coder'], '/Users/me/port-daddy')`
 * - output: `{ 'routes/operator.ts': true, 'ollama/qwen2.5-coder': false }`
 *
 * Older daemons lack `/operator/files-exist`; on any failure every path is
 * reported as existing so chips keep their previous behavior instead of
 * silently disappearing.
 */
export async function fetchFilesExist(
  paths: string[],
  projectDir?: string,
): Promise<Record<string, boolean>> {
  if (paths.length === 0) return {};
  try {
    const payload = await post<{ success?: boolean; results?: Record<string, boolean> }>(
      '/operator/files-exist',
      { paths, projectDir },
    );
    return payload.results ?? {};
  } catch {
    return Object.fromEntries(paths.map((path) => [path, true]));
  }
}

/**
 * Load the daemon-backed actor lens for one project so UI surfaces can render
 * the same lifecycle truth instead of re-deriving it independently.
 *
 * Example:
 * - input: `{ projectDir: '/Users/me/port-daddy' }`
 * - output: `[{ id: 'spark', actorState: 'running', ... }]`
 */
export async function fetchOperatorState(opts: {
  project?: string;
  projectDir?: string;
  limit?: number;
} = {}): Promise<import('./types').OperatorState> {
  const params = new URLSearchParams();
  if (opts.project) params.set('project', opts.project);
  if (opts.projectDir) params.set('projectDir', opts.projectDir);
  if (opts.limit) params.set('limit', String(opts.limit));
  return get(`/operator/state${params.toString() ? `?${params}` : ''}`);
}

export async function fetchOperatorActors(opts: {
  project?: string;
  projectDir?: string;
  limit?: number;
} = {}): Promise<OperatorActorEntry[]> {
  const params = new URLSearchParams();
  if (opts.project) params.set('project', opts.project);
  if (opts.projectDir) params.set('projectDir', opts.projectDir);
  if (opts.limit) params.set('limit', String(opts.limit));
  const data = await get<{ actors?: OperatorActorEntry[] }>(`/operator/actors${params.toString() ? `?${params}` : ''}`);
  return data.actors ?? [];
}

export async function fetchActivity(limit = 200): Promise<ActivityEntry[]> {
  const data = await get<{ entries?: ActivityEntry[]; activity?: ActivityEntry[] }>(`/activity?limit=${limit}`);
  return data.entries ?? data.activity ?? [];
}

export async function fetchStories(limit = 40): Promise<StoryNote[]> {
  const data = await get<{ notes?: StoryNote[] }>(`/notes?limit=${limit}`);
  return data.notes ?? [];
}

export async function fetchChannelMessages(channel: string, limit = 30, after?: number): Promise<ChannelMessage[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (typeof after === 'number' && Number.isFinite(after)) params.set('after', String(after));
  const data = await get<{ messages?: Array<{ id: number; payload: unknown; sender: string | null; createdAt: number }> }>(
    `/msg/${encodeURIComponent(channel)}?${params.toString()}`
  );
  return (data.messages ?? []).map((message) => ({
    ...message,
    channel,
  }));
}

export async function fetchTupleEntries(opts: {
  harbor?: string;
  query?: string;
  limit?: number;
} = {}): Promise<TupleEntry[]> {
  const params = new URLSearchParams();
  if (opts.harbor) params.set('harbor', opts.harbor);
  if (opts.query) params.set('query', opts.query);
  if (opts.limit) params.set('limit', String(opts.limit));
  const data = await get<{ tuples?: TupleEntry[] }>(`/tuples/scan${params.toString() ? `?${params}` : ''}`);
  return data.tuples ?? [];
}

export async function fetchGraphEdges(opts: {
  projectDir?: string;
  query?: string;
  limit?: number;
} = {}): Promise<GraphEdge[]> {
  const params = new URLSearchParams();
  if (opts.projectDir) params.set('projectDir', opts.projectDir);
  if (opts.query) params.set('query', opts.query);
  if (opts.limit) params.set('limit', String(opts.limit));
  const data = await get<{ edges?: GraphEdge[] }>(`/graph/edges${params.toString() ? `?${params}` : ''}`);
  return data.edges ?? [];
}

export async function fetchGraphStats(projectDir?: string): Promise<GraphStats> {
  const params = new URLSearchParams();
  if (projectDir) params.set('projectDir', projectDir);
  return get<GraphStats>(`/graph/stats${params.toString() ? `?${params}` : ''}`);
}

export async function fetchEpisodes(opts: {
  projectDir?: string;
  project?: string;
  harbor?: string;
  query?: string;
  limit?: number;
} = {}): Promise<Episode[]> {
  const params = new URLSearchParams();
  if (opts.projectDir) params.set('projectDir', opts.projectDir);
  if (opts.project) params.set('project', opts.project);
  if (opts.harbor) params.set('harbor', opts.harbor);
  if (opts.query) params.set('query', opts.query);
  if (opts.limit) params.set('limit', String(opts.limit));
  const data = await get<{ episodes?: Episode[] }>(`/memory/episodes${params.toString() ? `?${params}` : ''}`);
  return data.episodes ?? [];
}

export async function fetchMemoryStats(projectDir?: string, project?: string): Promise<MemoryStats> {
  const params = new URLSearchParams();
  if (projectDir) params.set('projectDir', projectDir);
  if (project) params.set('project', project);
  return get<MemoryStats>(`/memory/stats${params.toString() ? `?${params}` : ''}`);
}

export async function fetchSemanticStats(projectDir?: string): Promise<SemanticResolutionStats> {
  const params = new URLSearchParams();
  if (projectDir) params.set('projectDir', projectDir);
  const data = await get<{ success?: boolean } & SemanticResolutionStats>(`/semantic/stats${params.toString() ? `?${params}` : ''}`);
  return data;
}

export async function fetchSemanticResolutions(opts: {
  projectDir?: string;
  decision?: SemanticResolutionDecision;
  query?: string;
  minSimilarity?: number;
  limit?: number;
} = {}): Promise<SemanticResolutionEvent[]> {
  const params = new URLSearchParams();
  if (opts.projectDir) params.set('projectDir', opts.projectDir);
  if (opts.decision) params.set('decision', opts.decision);
  if (opts.query) params.set('query', opts.query);
  if (typeof opts.minSimilarity === 'number') params.set('minSimilarity', String(opts.minSimilarity));
  if (opts.limit) params.set('limit', String(opts.limit));
  const data = await get<{ resolutions?: SemanticResolutionEvent[] }>(`/semantic/resolutions${params.toString() ? `?${params}` : ''}`);
  return data.resolutions ?? [];
}

// ─── Sorties (one-time spawns) ────────────────────────────────────────────────

export async function launchSortie(opts: {
  backend: string;
  model?: string;
  prompt: string;
  purpose?: string;
  identity?: string;
  cwd?: string;
  allowedTools?: string;
  budgetUsd: number;
  deadlineMs?: number;
  /** Legacy alias for `deadlineMs`; kept for compatibility with older callers. */
  timeout?: number;
}): Promise<SpawnedAgent> {
  return post('/spawn', {
    backend: opts.backend,
    model: opts.model,
    task: opts.prompt,
    purpose: opts.purpose,
    identity: opts.identity,
    cwd: opts.cwd,
    allowedTools: opts.allowedTools,
    budgetUsd: opts.budgetUsd,
    timeout: opts.timeout,
  });
}

export async function fetchSorties(): Promise<SpawnedAgent[]> {
  const data = await get<{ agents: SpawnedAgent[] }>('/spawn');
  return data.agents ?? [];
}

export async function cancelSortie(id: string): Promise<{ success: boolean }> {
  return del(`/spawn/${encodeURIComponent(id)}`);
}

export async function fetchSortiePreflight(opts: {
  backend: string;
  model?: string;
  identity?: string;
  budgetUsd?: number;
}): Promise<SpawnPreflight> {
  return post('/spawn/preflight', {
    backend: opts.backend,
    model: opts.model,
    identity: opts.identity,
    budgetUsd: opts.budgetUsd,
  });
}

// ─── Session galaxy ───────────────────────────────────────────────────────────

export async function fetchGalaxyMap(opts: {
  windowHours?: number;
  tailTokens?: number;
  minTokens?: number;
  limit?: number;
  project?: string;
  // Additive: omitted (or true) preserves default clustered behavior for
  // daemons that predate cluster=false support. Only send the param when
  // explicitly disabling clustering.
  cluster?: boolean;
} = {}): Promise<GalaxyMapResponse> {
  const params = new URLSearchParams();
  if (typeof opts.windowHours === 'number') params.set('windowHours', String(opts.windowHours));
  if (typeof opts.tailTokens === 'number') params.set('tailTokens', String(opts.tailTokens));
  if (typeof opts.minTokens === 'number') params.set('minTokens', String(opts.minTokens));
  if (typeof opts.limit === 'number') params.set('limit', String(opts.limit));
  if (opts.project) params.set('project', opts.project);
  if (opts.cluster === false) params.set('cluster', 'false');
  return get(`/galaxy/map${params.toString() ? `?${params}` : ''}`);
}

export async function fetchGalaxySessionDetail(id: string): Promise<GalaxySessionDetailResponse> {
  return get(`/galaxy/session/${encodeURIComponent(id)}`);
}

export async function callGalaxyParley(body: GalaxyParleyCallRequest): Promise<{ success: boolean; parley?: unknown; error?: string }> {
  return post('/parley/call', body);
}

// ─── SSE ──────────────────────────────────────────────────────────────────────

export function subscribeFleetEvents(onEvent: (event: unknown) => void): () => void {
  const es = new EventSource(daemonEndpoint('/fleet/events'));
  es.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data));
    } catch { /* malformed event */ }
  };
  es.onerror = () => {
    // EventSource auto-reconnects
  };
  return () => es.close();
}

export function subscribeActivity(onEvent: (event: ActivityEntry) => void): () => void {
  const es = new EventSource(daemonEndpoint('/activity/subscribe'));
  es.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as ActivityEntry);
    } catch {
      /* malformed event */
    }
  };
  es.onerror = () => {
    // EventSource auto-reconnects
  };
  return () => es.close();
}
