// ─── Port Daddy Fleet API client ──────────────────────────────────────────────

import type {
  FleetDaemonStatus,
  FleetConfig,
  TopologyValidation,
  BackendInfo,
  SpawnedAgent,
  SpawnPreflight,
  ActivityEntry,
  ChannelMessage,
  StoryNote,
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

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(daemonEndpoint(path), {
    method,
    ...(body !== undefined && {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
  if (!res.ok) {
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
  return res.json();
}

const get = <T>(path: string) => api<T>('GET', path);
const post = <T>(path: string, body?: unknown) => api<T>('POST', path, body);
const put = <T>(path: string, body: unknown) => api<T>('PUT', path, body);
const del = <T>(path: string) => api<T>('DELETE', path);

// ─── Fleet ────────────────────────────────────────────────────────────────────

export async function fetchFleetStatus(): Promise<FleetDaemonStatus> {
  return get('/fleet');
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

export async function startFleet(projectDir?: string): Promise<{ success: boolean }> {
  return post('/fleet/start', projectDir ? { projectDir } : undefined);
}

export async function stopFleet(projectDir?: string): Promise<{ success: boolean }> {
  return post('/fleet/stop', projectDir ? { projectDir } : undefined);
}

// ─── Models ───────────────────────────────────────────────────────────────────

export async function fetchModels(): Promise<BackendInfo[]> {
  const data = await get<{ backends: BackendInfo[] }>('/fleet/models');
  return data.backends;
}

// ─── Messaging ────────────────────────────────────────────────────────────────

export async function publishMessage(channel: string, content: string, sender = 'fleet-ui'): Promise<unknown> {
  return post(`/msg/${encodeURIComponent(channel)}`, { payload: content, sender });
}

export async function sendAgentMessage(agentId: string, opts: {
  content: string;
  project?: string;
  from?: string;
  wake?: boolean;
}): Promise<{
  success: boolean;
  delivered: boolean;
  woke: boolean;
  messageId?: number;
  wake?: { success: boolean; project?: string; agent?: string; error?: string };
}> {
  return post(`/agents/${encodeURIComponent(agentId)}/inbox`, {
    content: opts.content,
    project: opts.project,
    from: opts.from ?? 'fleet-ui',
    wake: opts.wake ?? true,
  });
}

export async function fetchActivity(limit = 200): Promise<ActivityEntry[]> {
  const data = await get<{ entries?: ActivityEntry[]; activity?: ActivityEntry[] }>(`/activity?limit=${limit}`);
  return data.entries ?? data.activity ?? [];
}

export async function fetchStories(limit = 40): Promise<StoryNote[]> {
  const data = await get<{ notes?: StoryNote[] }>(`/notes?limit=${limit}`);
  return data.notes ?? [];
}

export async function fetchChannelMessages(channel: string, limit = 30): Promise<ChannelMessage[]> {
  const data = await get<{ messages?: Array<{ id: number; payload: unknown; sender: string | null; createdAt: number }> }>(
    `/msg/${encodeURIComponent(channel)}?limit=${limit}`
  );
  return (data.messages ?? []).map((message) => ({
    ...message,
    channel,
  }));
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

export async function killSortie(id: string): Promise<{ success: boolean }> {
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
