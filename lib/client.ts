/**
 * Port Daddy JavaScript SDK
 *
 * Programmatic client for the Port Daddy daemon.
 * Works in Node.js 18+ (uses native fetch).
 *
 * @example
 * import { PortDaddy } from 'port-daddy/client';
 *
 * const pd = new PortDaddy();
 * const { port } = await pd.claim('myapp:api');
 * console.log(`Server running on port ${port}`);
 *
 * // When done:
 * await pd.release('myapp:api');
 */

import http from 'node:http';
import { existsSync } from 'node:fs';
import type { PortDaddyClientOptions } from '../shared/types.js';

const DEFAULT_URL = 'http://localhost:9876';
const DEFAULT_SOCK = '/tmp/port-daddy.sock';

// =============================================================================
// Connection target types (internal)
// =============================================================================

interface SocketTarget {
  socketPath: string;
  host?: undefined;
  port?: undefined;
}

interface TcpTarget {
  socketPath?: undefined;
  host: string;
  port: number;
}

type ConnectionTarget = SocketTarget | TcpTarget;

// =============================================================================
// SDK option / result interfaces
// =============================================================================

interface ClaimOptions {
  port?: number;
  range?: [number, number];
  expires?: string | number;
  cmd?: string;
  cwd?: string;
  pair?: string;
  metadata?: Record<string, unknown>;
}

/** Matches the actual return shape of services.claim() */
interface ClaimResponse {
  success: boolean;
  id: string;
  port: number;
  status: string;
  existing: boolean;
  message: string;
}

/** Matches the actual return shape of services.release() */
interface ReleaseResponse {
  success: boolean;
  released: number;
  port?: number;
  message: string;
}

interface ListServicesOptions {
  pattern?: string;
  status?: string;
  port?: number;
}

/** A single service entry as returned by services.find() */
interface ServiceEntry {
  id: string;
  port: number;
  pid: number | null;
  status: string;
  cmd: string | null;
  createdAt: number;
  lastSeen: number;
  expiresAt: number | null;
  tunnelUrl: string | null;
  pairedWith: string | null;
  urls: Record<string, string>;
  metadata: Record<string, unknown> | null;
}

/** Matches the actual return shape of services.find() */
interface ListServicesResponse {
  success: boolean;
  services: ServiceEntry[];
  count: number;
}

/** A full service detail as returned by services.get() */
interface ServiceDetail {
  id: string;
  port: number;
  pid: number | null;
  status: string;
  cmd: string | null;
  cwd: string | null;
  createdAt: number;
  lastSeen: number;
  expiresAt: number | null;
  restartPolicy: string | null;
  healthUrl: string | null;
  tunnelProvider: string | null;
  tunnelUrl: string | null;
  pairedWith: string | null;
  urls: Record<string, string>;
  metadata: Record<string, unknown> | null;
}

/** Matches the actual return shape of services.get() */
interface GetServiceResponse {
  success: boolean;
  service: ServiceDetail;
}

/** Matches the actual return shape of services.setEndpoint() */
interface SetEndpointResponse {
  success: boolean;
  message: string;
}

interface PublishOptions {
  sender?: string;
  expires?: number;
}

/** Matches the actual return shape of messaging.publish() */
interface PublishResponse {
  success: boolean;
  id: number | bigint;
  message: string;
}

interface GetMessagesOptions {
  limit?: number;
  after?: number;
}

/** A single message entry as returned by the messaging module */
interface MessageEntry {
  id: number;
  payload: unknown;
  sender: string | null;
  createdAt: number;
}

/** Matches the actual return shape of messaging.getMessages() */
interface GetMessagesResponse {
  success: boolean;
  channel: string;
  messages: MessageEntry[];
  count: number;
}

interface PollOptions {
  after?: number;
  timeout?: number;
}

/** Matches the actual return shape of messaging.poll() */
interface PollResponse {
  success: boolean;
  channel: string;
  message: MessageEntry | null;
  lastId: number;
}

/** A single channel entry as returned by messaging.listChannels() */
interface ChannelEntry {
  channel: string;
  count: number;
  lastMessage: number;
}

/** Matches the actual return shape of messaging.listChannels() */
interface ListChannelsResponse {
  success: boolean;
  channels: ChannelEntry[];
}

/** Matches the actual return shape of messaging.clear() */
interface ClearChannelResponse {
  success: boolean;
  deleted: number;
  message: string;
}

interface LockOptions {
  owner?: string;
  ttl?: number;
  metadata?: Record<string, unknown>;
}

/** Matches the actual return shape of locks.acquire() */
interface LockResponse {
  success: boolean;
  name: string;
  owner: string;
  acquiredAt: number;
  expiresAt: number | null;
  message: string;
}

interface UnlockOptions {
  owner?: string;
  force?: boolean;
}

/** Matches the actual return shape of locks.release() */
interface UnlockResponse {
  success: boolean;
  released: boolean;
  name?: string;
  message: string;
}

/** Matches the actual return shape of locks.check() */
interface CheckLockResponse {
  success: boolean;
  held: boolean;
  name: string;
  owner?: string;
  pid?: number | null;
  acquiredAt?: number;
  expiresAt?: number | null;
  metadata?: Record<string, unknown> | null;
}

/** Matches the actual return shape of locks.extend() */
interface ExtendLockResponse {
  success: boolean;
  name: string;
  expiresAt: number;
  message: string;
}

interface ListLocksOptions {
  owner?: string;
}

/** A single lock entry as returned by locks.list() */
interface LockEntry {
  name: string;
  owner: string;
  pid: number | null;
  acquiredAt: number;
  expiresAt: number | null;
  metadata: Record<string, unknown> | null;
}

/** Matches the actual return shape of locks.list() */
interface ListLocksResponse {
  success: boolean;
  locks: LockEntry[];
  count: number;
}

interface RegisterOptions {
  name?: string;
  type?: string;
  maxServices?: number;
  maxLocks?: number;
  metadata?: Record<string, unknown>;
  /** Semantic identity in project:stack:context format */
  identity?: string;
  /** What the agent is working on */
  purpose?: string;
  /** Git worktree identifier */
  worktree?: string;
}

/** Matches the actual return shape of agents.register() */
interface RegisterAgentResponse {
  success: boolean;
  agentId: string;
  registered: boolean;
  message: string;
  /** Parsed identity components */
  identity?: {
    project: string | null;
    stack: string | null;
    context: string | null;
  };
  /** Auto-salvage notice if dead agents exist in same project */
  autoSalvageNotice?: {
    count: number;
    message: string;
    command: string;
  };
}

/** Matches the actual return shape of agents.heartbeat() */
interface HeartbeatResponse {
  success: boolean;
  agentId: string;
  lastHeartbeat: number;
  message: string;
}

/** Matches the actual return shape of agents.unregister() */
interface UnregisterAgentResponse {
  success: boolean;
  unregistered: boolean;
  agentId?: string;
  message: string;
}

/** A single agent entry as returned by agents.get() */
interface AgentDetail {
  id: string;
  name: string | null;
  pid: number;
  type: string;
  registeredAt: number;
  lastHeartbeat: number;
  isActive: boolean;
  timeSinceHeartbeat: number;
  maxServices: number;
  maxLocks: number;
  metadata: Record<string, unknown> | null;
}

/** Matches the actual return shape of agents.get() */
interface GetAgentResponse {
  success: boolean;
  agent: AgentDetail;
}

interface ListAgentsOptions {
  activeOnly?: boolean;
}

/** A single agent entry in a list */
interface AgentEntry {
  id: string;
  name: string | null;
  pid: number;
  type: string;
  registeredAt: number;
  lastHeartbeat: number;
  isActive: boolean;
  maxServices: number;
  maxLocks: number;
  metadata: Record<string, unknown> | null;
}

/** Matches the actual return shape of agents.list() */
interface ListAgentsResponse {
  success: boolean;
  agents: AgentEntry[];
  count: number;
}


/** Options for listing salvage queue entries */
interface SalvageListOptions {
  /** Filter to agents in this project */
  project?: string;
  /** Filter by stack (requires project) */
  stack?: string;
  /** Show ALL queue entries globally (use sparingly) */
  all?: boolean;
  /** Limit number of results */
  limit?: number;
}

/** A single stale agent in the salvage queue */
interface StaleAgent {
  id: string;
  name: string;
  purpose: string | null;
  sessionId: string | null;
  lastHeartbeat: number;
  staleSince: number;
  status: 'stale' | 'dead' | 'resurrecting';
  notes?: string[];
  identityProject: string | null;
  identityStack: string | null;
  identityContext: string | null;
}

/** Response from listing salvage queue */
interface SalvageListResponse {
  success: boolean;
  agents: StaleAgent[];
  count: number;
  filtered?: boolean;
}

/** Response from claiming an agent for resurrection */
interface SalvageClaimResponse {
  success: boolean;
  message: string;
  context?: {
    sessionId?: string;
    purpose?: string;
    notes?: string[];
  };
}

/** Response from completing resurrection */
interface SalvageCompleteResponse {
  success: boolean;
  message: string;
}

/** Response from abandoning/dismissing resurrection */
interface SalvageAbandonResponse {
  success: boolean;
  message: string;
}

// ──────────────────────────────────────────────────────────────
// Tunnel types
// ──────────────────────────────────────────────────────────────

/** Response from starting a tunnel */
interface TunnelStartResponse {
  success: boolean;
  serviceId: string;
  provider: 'ngrok' | 'cloudflared' | 'localtunnel';
  url: string;
}

/** Response from stopping a tunnel */
interface TunnelStopResponse {
  success: boolean;
  serviceId: string;
}

/** Response from getting tunnel status */
interface TunnelStatusResponse {
  success: boolean;
  serviceId: string;
  provider: 'ngrok' | 'cloudflared' | 'localtunnel';
  port: number;
  url: string | null;
  status: string;
  pid?: number;
  startedAt?: number;
}

/** A single tunnel entry in the list */
interface TunnelEntry {
  serviceId: string;
  provider: 'ngrok' | 'cloudflared' | 'localtunnel';
  port: number;
  url: string | null;
  status: string;
  pid?: number;
  startedAt?: number;
}

/** Response from listing tunnels */
interface TunnelListResponse {
  success: boolean;
  tunnels: TunnelEntry[];
  count: number;
}

/** Response from checking providers */
interface TunnelProvidersResponse {
  success: boolean;
  providers: Record<string, boolean>;
}

interface AddWebhookOptions {
  events?: string[];
  secret?: string;
  filterPattern?: string;
  metadata?: Record<string, unknown>;
}

/** Matches the actual return shape of webhooks.register() */
interface AddWebhookResponse {
  success: boolean;
  id: string;
  url: string;
  events: string[];
  message: string;
}

interface ListWebhooksOptions {
  activeOnly?: boolean;
}

/** A single webhook entry as returned by webhooks.list() / webhooks.get() */
interface WebhookEntry {
  id: string;
  url: string;
  hasSecret: boolean;
  events: string[];
  filterPattern: string | null;
  active: boolean;
  createdAt: number;
  lastTriggered: number | null;
  successCount: number;
  failureCount: number;
  metadata: Record<string, unknown> | null;
}

/** Matches the actual return shape of webhooks.list() */
interface ListWebhooksResponse {
  success: boolean;
  webhooks: WebhookEntry[];
  count: number;
}

/** Matches the actual return shape of webhooks.get() */
interface GetWebhookResponse {
  success: boolean;
  webhook: WebhookEntry;
}

/** Matches the actual return shape of webhooks.update() */
interface UpdateWebhookResponse {
  success: boolean;
  message: string;
}

/** Matches the actual return shape of webhooks.remove() */
interface RemoveWebhookResponse {
  success: boolean;
  deleted: boolean;
}

/** Matches the actual return shape of webhooks.test() */
interface TestWebhookResponse {
  success: boolean;
  status?: number;
  statusText?: string;
  body?: string;
  error?: string;
}

/** A single delivery entry as returned by webhooks.getDeliveries() */
interface DeliveryEntry {
  id: string;
  event: string;
  status: string;
  attempts: number;
  lastAttempt: number | null;
  responseStatus: number | null;
  createdAt: number;
}

/** Matches the actual return shape of webhooks.getDeliveries() */
interface GetWebhookDeliveriesResponse {
  success: boolean;
  deliveries: DeliveryEntry[];
  count: number;
}

/** Matches the actual /health endpoint response */
interface HealthResponse {
  status: string;
  version: string;
  uptime_seconds: number;
  active_ports: number;
  pid: number;
}

/** Matches the actual /version endpoint response */
interface VersionResponse {
  version: string;
  codeHash: string;
  startedAt: number;
  service: string;
  api: string;
  node_version: string;
  pid: number;
  uptime: number;
  installDir: string;
}

/** Matches the actual /metrics endpoint response */
interface MetricsResponse {
  errors: number;
  total_assignments: number;
  total_releases: number;
  uptime_start: number;
  messages_published?: number;
  validation_failures?: number;
  active_ports: number;
  uptime_seconds: number;
  uptime_formatted: string;
  [key: string]: unknown;
}

/** Matches the actual /config endpoint response */
interface GetConfigResponse {
  success: boolean;
  config: Record<string, unknown>;
  path: string;
}

interface ActivityOptions {
  limit?: number;
  type?: string;
  agent?: string;
}

/** A single activity log entry */
interface ActivityEntry {
  id: number;
  timestamp: number;
  type: string;
  agentId: string | null;
  targetId: string | null;
  details: string | null;
  metadata: Record<string, unknown> | null;
}

/** Matches the actual return shape of activityLog.getRecent() */
interface ActivityResponse {
  success: boolean;
  entries: ActivityEntry[];
  count: number;
}

/** Matches the actual return shape of activityLog.getByTimeRange() */
interface ActivityRangeResponse {
  success: boolean;
  entries: ActivityEntry[];
  count: number;
  timeRange: { start: number; end: number };
}

/** Matches the actual return shape of activityLog.getSummary() */
interface ActivitySummaryResponse {
  success: boolean;
  summary: Record<string, number>;
  total: number;
  since: number;
}

/** Matches the actual return shape of activityLog.getStats() */
interface ActivityStatsResponse {
  success: boolean;
  stats: {
    totalEntries: number;
    oldestEntry: number | null;
    newestEntry: number | null;
    retentionMs: number;
    maxEntries: number;
  };
}

/** Matches the actual /services/health/:id endpoint response */
interface ServiceHealthResponse {
  success: boolean;
  serviceId: string;
  healthy: boolean;
  reason?: string;
  statusCode?: number;
  error?: string;
  latency?: number;
  checkedAt: number;
  url?: string;
}

/** A cached health entry as returned by health.listStatus() */
interface CachedHealthEntry {
  serviceId: string;
  url: string;
  healthy: boolean;
  statusCode?: number;
  error?: string;
  latency?: number;
  checkedAt: number;
}

/** Matches the actual /services/health endpoint response */
interface ListServiceHealthResponse {
  success: boolean;
  statuses: CachedHealthEntry[];
}

/** A single active port entry as returned by /ports/active */
interface ActivePortEntry {
  port: number;
  project: string;
  pid: number | null;
  started: number;
  last_seen: number;
  alive: boolean;
  age_minutes: number;
}

/** Matches the actual /ports/active endpoint response */
interface ListActivePortsResponse {
  ports: ActivePortEntry[];
  count: number;
}

/** A single system port entry as returned by /ports/system */
interface SystemPortEntry {
  port: number;
  managed_by_port_daddy: boolean;
  project: string | null;
  [key: string]: unknown;
}

/** Matches the actual /ports/system endpoint response */
interface GetSystemPortsResponse {
  ports: SystemPortEntry[];
  count: number;
  total_system_ports: number;
}

/** Matches the actual /ports/cleanup endpoint response */
interface CleanupResponse {
  freed: unknown[];
  count: number;
}

/** Matches the actual /scan endpoint response */
interface ScanResponse {
  success: boolean;
  project: string;
  root: string;
  type: string;
  serviceCount: number;
  services: Record<string, {
    dir: string;
    framework: string;
    dev: unknown;
    health: unknown;
    preferredPort: unknown;
  }>;
  suggestions: unknown;
  config: Record<string, unknown>;
  saved: boolean;
  savedPath: string | null;
  dryRun: boolean;
  guidance: unknown;
  existingConfig: { path: string; serviceCount: number } | null;
}

/** A single project summary entry as returned by /projects */
interface ProjectSummary {
  id: string;
  root: string;
  type: string;
  serviceCount: number;
  lastScanned: string;
  createdAt: string;
  frameworks: string[];
}

/** Matches the actual /projects endpoint response */
interface ListProjectsResponse {
  success: boolean;
  count: number;
  projects: ProjectSummary[];
}

/** Matches the actual /projects/:id endpoint response */
interface GetProjectResponse {
  success: boolean;
  project: {
    id: string;
    root: string;
    type: string;
    config: unknown;
    services: Record<string, unknown> | null;
    lastScanned: string;
    createdAt: string;
    metadata: Record<string, unknown> | null;
  };
}

/** Matches the actual DELETE /projects/:id endpoint response */
interface DeleteProjectResponse {
  success: boolean;
  message: string;
}

/** Matches the actual POST /sessions response */
interface SessionResponse {
  success: boolean;
  id: string;
  purpose: string;
  status: string;
  agentId?: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
  metadata?: Record<string, unknown> | null;
  files?: Array<{ path: string; claimedAt: number; releasedAt?: number | null }>;
  conflicts?: Array<{ path: string; sessionId: string; purpose: string; claimedAt: number }>;
}

/** Matches the actual GET /sessions/:id response */
interface SessionDetailResponse {
  success: boolean;
  session: {
    id: string;
    purpose: string;
    status: string;
    agentId: string | null;
    createdAt: number;
    updatedAt: number;
    completedAt: number | null;
    metadata: Record<string, unknown> | null;
  };
  notes: Array<{
    id: number;
    sessionId: string;
    content: string;
    type: string;
    createdAt: number;
  }>;
  files: Array<{
    path: string;
    claimedAt: number;
    releasedAt: number | null;
  }>;
}

/** Matches the actual GET /sessions response */
interface SessionListResponse {
  success: boolean;
  sessions: Array<{
    id: string;
    purpose: string;
    status: string;
    agentId: string | null;
    createdAt: number;
    updatedAt: number;
    completedAt: number | null;
    metadata: Record<string, unknown> | null;
    noteCount?: number;
    fileCount?: number;
  }>;
  count: number;
}

/** Matches the actual POST /sessions/:id/notes or POST /notes response */
interface NoteResponse {
  success: boolean;
  noteId: number;
  sessionId: string;
}

/** Matches the actual GET /notes or GET /sessions/:id/notes response */
interface NotesResponse {
  success: boolean;
  notes: Array<{
    id: number;
    sessionId: string;
    content: string;
    type: string;
    createdAt: number;
    sessionPurpose?: string;
  }>;
  count: number;
}

/** Matches the actual POST /sessions/:id/files response */
interface FileClaimResponse {
  success: boolean;
  claimed: string[];
  conflicts: Array<{ path: string; sessionId: string; purpose: string; claimedAt: number }>;
}

/** Matches the actual DELETE /sessions/:id/files response */
interface FileReleaseResponse {
  success: boolean;
  released: string[];
}

type SubscriptionEventType = 'message' | 'error' | 'connected';
type SubscriptionHandler = (data: unknown) => void;

interface Subscription {
  on(event: SubscriptionEventType, fn: SubscriptionHandler): Subscription;
  unsubscribe(): void;
}

interface HeartbeatHandle {
  stop: () => void;
}

/** Response from waitForService / waitForServices */
interface WaitResponse {
  success: boolean;
  services: ServiceEntry[];
  resolved: number;
  requested: number;
  timedOut: boolean;
}

/** Options for lockWithRetry */
interface LockWithRetryOptions extends LockOptions {
  /** Max time to keep retrying in ms (default: 10000) */
  timeout?: number;
  /** Interval between retry attempts in ms (default: 500) */
  interval?: number;
}

/** Options for withLock with auto-extend */
interface WithLockOptions extends LockOptions {
  /** Interval in ms to auto-extend the lock TTL (default: ttl/2 or 30000) */
  extendInterval?: number;
}

/** Options for subscribe with auto-reconnect */
interface SubscribeOptions {
  /** Whether to auto-reconnect on disconnect (default: true) */
  reconnect?: boolean;
  /** Maximum number of reconnect attempts (default: 10) */
  maxRetries?: number;
  /** Base delay between reconnect attempts in ms (default: 1000) */
  reconnectDelay?: number;
}

// =============================================================================
// Error classes
// =============================================================================

class PortDaddyError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'PortDaddyError';
    this.status = status;
    this.body = body;
  }
}

class ConnectionError extends PortDaddyError {
  constructor(url: string) {
    super(
      `Port Daddy daemon is not running at ${url}. Start it with: port-daddy start`,
      0,
      null
    );
    this.name = 'ConnectionError';
  }
}

/**
 * Port Daddy client SDK.
 *
 * @example
 * const pd = new PortDaddy();
 * const { port } = await pd.claim('myapp:api');
 */
class PortDaddy {
  url: string;
  socketPath: string;
  agentId: string | undefined;
  pid: number;
  timeout: number;

  /**
   * Create a new Port Daddy client.
   */
  constructor(options: PortDaddyClientOptions = {}) {
    this.url = (options.url || process.env.PORT_DADDY_URL || DEFAULT_URL).replace(/\/$/, '');
    this.socketPath = options.socketPath || process.env.PORT_DADDY_SOCK || DEFAULT_SOCK;
    this.agentId = options.agentId || process.env.PORT_DADDY_AGENT;
    this.pid = options.pid || process.pid;
    this.timeout = options.timeout || 5000;
  }

  // ===========================================================================
  // Internal helpers
  // ===========================================================================

  /** @private */
  _headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.agentId) h['X-Agent-Id'] = this.agentId;
    if (this.pid) h['X-Pid'] = String(this.pid);
    return h;
  }

  /** @private - Resolve connection target: prefer socket, fallback to TCP */
  _resolveTarget(): ConnectionTarget {
    // Explicit TCP URL overrides socket
    if (process.env.PORT_DADDY_URL) {
      const url = new URL(this.url);
      return { host: url.hostname, port: parseInt(url.port, 10) || 9876 };
    }
    // Use socket if it exists
    if (existsSync(this.socketPath)) {
      return { socketPath: this.socketPath };
    }
    // Fallback to TCP
    const url = new URL(this.url);
    return { host: url.hostname, port: parseInt(url.port, 10) || 9876 };
  }

  /** @private */
  async _request(method: string, path: string, body?: Record<string, unknown>): Promise<unknown> {
    const target = this._resolveTarget();
    const headers = this._headers();
    const jsonBody = body !== undefined ? JSON.stringify(body) : null;

    if (jsonBody) {
      headers['Content-Length'] = String(Buffer.byteLength(jsonBody));
    }

    return new Promise((resolve, reject) => {
      const reqOpts: http.RequestOptions = {
        method,
        path,
        headers,
        timeout: this.timeout,
        ...(target.socketPath ? { socketPath: target.socketPath } : { host: target.host, port: target.port })
      };

      const req = http.request(reqOpts, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          let data: unknown;
          try { data = JSON.parse(text); } catch { data = null; }

          if (res.statusCode! < 200 || res.statusCode! >= 300) {
            const msg = (data as Record<string, string> | null)?.error || `HTTP ${res.statusCode}`;
            reject(new PortDaddyError(msg, res.statusCode!, data));
            return;
          }

          resolve(data);
        });
      });

      req.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
          reject(new ConnectionError(target.socketPath || this.url));
        } else {
          reject(new PortDaddyError(`Request failed: ${err.message}`, 0, null));
        }
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new PortDaddyError('Request timed out', 0, null));
      });

      if (jsonBody) req.write(jsonBody);
      req.end();
    });
  }

  // ===========================================================================
  // Services -- Port claiming and management
  // ===========================================================================

  /**
   * Claim a port for a service.
   */
  async claim(id: string, options: ClaimOptions = {}): Promise<ClaimResponse> {
    return this._request('POST', '/claim', { id, pid: this.pid, ...options }) as Promise<ClaimResponse>;
  }

  /**
   * Release a service and free its port.
   */
  async release(id: string): Promise<ReleaseResponse> {
    return this._request('DELETE', '/release', { id }) as Promise<ReleaseResponse>;
  }

  /**
   * Get a single service by ID.
   */
  async getService(id: string): Promise<GetServiceResponse> {
    return this._request('GET', `/services/${encodeURIComponent(id)}`) as Promise<GetServiceResponse>;
  }

  /**
   * Find services matching a pattern.
   */
  async listServices(options: ListServicesOptions = {}): Promise<ListServicesResponse> {
    const params = new URLSearchParams();
    if (options.pattern) params.set('pattern', options.pattern);
    if (options.status) params.set('status', options.status);
    if (options.port) params.set('port', String(options.port));
    const qs = params.toString();
    return this._request('GET', `/services${qs ? '?' + qs : ''}`) as Promise<ListServicesResponse>;
  }

  /**
   * Set an endpoint URL for a service.
   */
  async setEndpoint(id: string, env: string, url: string): Promise<SetEndpointResponse> {
    return this._request('PUT', `/services/${encodeURIComponent(id)}/endpoints/${encodeURIComponent(env)}`, { url }) as Promise<SetEndpointResponse>;
  }

  // ===========================================================================
  // Waiting -- Block until services are available
  // ===========================================================================

  /**
   * Wait for a service to exist, blocking until found or timeout.
   *
   * @param id - Service identity to wait for
   * @param timeout - Max wait time in ms (default: 30000)
   */
  async waitForService(id: string, timeout: number = 30000): Promise<WaitResponse> {
    const prevTimeout = this.timeout;
    this.timeout = Math.max(this.timeout, timeout + 5000);
    try {
      const params = new URLSearchParams();
      params.set('timeout', String(timeout));
      return await (this._request('GET', `/wait/${encodeURIComponent(id)}?${params}`) as Promise<WaitResponse>);
    } finally {
      this.timeout = prevTimeout;
    }
  }

  /**
   * Wait for multiple services to exist, blocking until all are found or timeout.
   *
   * @param ids - Array of service identities to wait for
   * @param timeout - Max wait time in ms (default: 30000)
   */
  async waitForServices(ids: string[], timeout: number = 30000): Promise<WaitResponse> {
    const prevTimeout = this.timeout;
    this.timeout = Math.max(this.timeout, timeout + 5000);
    try {
      return await (this._request('POST', '/wait', { ids, timeout }) as Promise<WaitResponse>);
    } finally {
      this.timeout = prevTimeout;
    }
  }

  // ===========================================================================
  // Messaging -- Pub/sub for agent coordination
  // ===========================================================================

  /**
   * Publish a message to a channel.
   */
  async publish(channel: string, payload: unknown, options: PublishOptions = {}): Promise<PublishResponse> {
    return this._request('POST', `/msg/${encodeURIComponent(channel)}`, {
      payload: payload as Record<string, unknown>,
      ...options,
    }) as Promise<PublishResponse>;
  }

  /**
   * Get messages from a channel.
   */
  async getMessages(channel: string, options: GetMessagesOptions = {}): Promise<GetMessagesResponse> {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.after) params.set('after', String(options.after));
    const qs = params.toString();
    return this._request('GET', `/msg/${encodeURIComponent(channel)}${qs ? '?' + qs : ''}`) as Promise<GetMessagesResponse>;
  }

  /**
   * List all active channels.
   */
  async listChannels(): Promise<ListChannelsResponse> {
    return this._request('GET', '/channels') as Promise<ListChannelsResponse>;
  }

  /**
   * Long-poll for the next message on a channel.
   */
  async poll(channel: string, options: PollOptions = {}): Promise<PollResponse> {
    const params = new URLSearchParams();
    if (options.after) params.set('after', String(options.after));
    if (options.timeout) params.set('timeout', String(options.timeout));
    const qs = params.toString();
    const prevTimeout = this.timeout;
    this.timeout = Math.max(this.timeout, (options.timeout || 30000) + 5000);
    try {
      return await (this._request('GET', `/msg/${encodeURIComponent(channel)}/poll${qs ? '?' + qs : ''}`) as Promise<PollResponse>);
    } finally {
      this.timeout = prevTimeout;
    }
  }

  /**
   * Subscribe to a channel via Server-Sent Events.
   *
   * Returns an object with an `on()` method and an `unsubscribe()` cleanup function.
   * Supports auto-reconnect on disconnect with configurable retries.
   *
   * @param channel - Channel name to subscribe to
   * @param options - Subscribe options (reconnect, maxRetries, reconnectDelay)
   */
  subscribe(channel: string, options: SubscribeOptions = {}): Subscription {
    const { reconnect = true, maxRetries = 10, reconnectDelay = 1000 } = options;
    const url = `${this.url}/msg/${encodeURIComponent(channel)}/subscribe`;
    const headers = this._headers();
    const handlers: Record<SubscriptionEventType, SubscriptionHandler[]> = {
      message: [],
      error: [],
      connected: []
    };

    let active = true;
    let retryCount = 0;
    let controller = new AbortController();

    const connect = () => {
      if (!active) return;
      controller = new AbortController();

      // Use native EventSource if available (browser), otherwise fall back
      const EventSourceImpl = typeof EventSource !== 'undefined' ? EventSource : null;

      if (!EventSourceImpl) {
        // Node.js fallback using native fetch with streaming
        (async () => {
          try {
            const res = await fetch(url, {
              headers,
              signal: controller.signal,
            });

            retryCount = 0; // Reset on successful connection
            const reader = res.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (active) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop()!; // Keep incomplete line in buffer

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const data: unknown = JSON.parse(line.slice(6));
                    handlers.message.forEach(fn => fn(data));
                  } catch {
                    // Non-JSON data line, skip
                  }
                } else if (line.startsWith('event: connected')) {
                  handlers.connected.forEach(fn => fn(undefined));
                }
              }
            }

            // Stream ended — reconnect if enabled
            if (active && reconnect && retryCount < maxRetries) {
              retryCount++;
              setTimeout(connect, reconnectDelay * retryCount);
            }
          } catch (err) {
            if (active) {
              handlers.error.forEach(fn => fn(err));
              // Reconnect on error if enabled
              if (reconnect && retryCount < maxRetries) {
                retryCount++;
                setTimeout(connect, reconnectDelay * retryCount);
              }
            }
          }
        })();
      } else {
        // Browser EventSource path
        const es = new EventSourceImpl(url);
        es.onmessage = (e: MessageEvent) => {
          try {
            const data: unknown = JSON.parse(e.data);
            handlers.message.forEach(fn => fn(data));
          } catch { /* ignore non-JSON */ }
        };
        es.onerror = (e: Event) => {
          handlers.error.forEach(fn => fn(e));
          if (active && reconnect && retryCount < maxRetries) {
            retryCount++;
            es.close();
            setTimeout(connect, reconnectDelay * retryCount);
          }
        };
        es.addEventListener('connected', () => {
          retryCount = 0;
          handlers.connected.forEach(fn => fn(undefined));
        });

        // Store close fn for unsubscribe
        const origUnsubscribe = () => es.close();
        (controller as unknown as Record<string, unknown>)._esClose = origUnsubscribe;
      }
    };

    connect();

    return {
      on(event: SubscriptionEventType, fn: SubscriptionHandler): Subscription { (handlers[event] || []).push(fn); return this; },
      unsubscribe(): void {
        active = false;
        controller.abort();
        const esClose = (controller as unknown as Record<string, (() => void) | undefined>)._esClose;
        if (esClose) esClose();
      },
    };
  }

  /**
   * Clear all messages from a channel.
   */
  async clearChannel(channel: string): Promise<ClearChannelResponse> {
    return this._request('DELETE', `/msg/${encodeURIComponent(channel)}`) as Promise<ClearChannelResponse>;
  }

  // ===========================================================================
  // Locks -- Distributed locking
  // ===========================================================================

  /**
   * Acquire a distributed lock.
   */
  async lock(name: string, options: LockOptions = {}): Promise<LockResponse> {
    return this._request('POST', `/locks/${encodeURIComponent(name)}`, {
      owner: options.owner || this.agentId,
      ttl: options.ttl,
      metadata: options.metadata,
    }) as Promise<LockResponse>;
  }

  /**
   * Release a distributed lock.
   */
  async unlock(name: string, options: UnlockOptions = {}): Promise<UnlockResponse> {
    return this._request('DELETE', `/locks/${encodeURIComponent(name)}`, {
      owner: options.owner || this.agentId,
      force: options.force,
    }) as Promise<UnlockResponse>;
  }

  /**
   * Check if a lock is held.
   */
  async checkLock(name: string): Promise<CheckLockResponse> {
    return this._request('GET', `/locks/${encodeURIComponent(name)}`) as Promise<CheckLockResponse>;
  }

  /**
   * Extend a lock's TTL.
   */
  async extendLock(name: string, options: LockOptions = {}): Promise<ExtendLockResponse> {
    return this._request('PUT', `/locks/${encodeURIComponent(name)}`, {
      owner: options.owner || this.agentId,
      ttl: options.ttl,
    }) as Promise<ExtendLockResponse>;
  }

  /**
   * List all locks.
   */
  async listLocks(options: ListLocksOptions = {}): Promise<ListLocksResponse> {
    const params = new URLSearchParams();
    if (options.owner) params.set('owner', options.owner);
    const qs = params.toString();
    return this._request('GET', `/locks${qs ? '?' + qs : ''}`) as Promise<ListLocksResponse>;
  }

  /**
   * Acquire a lock with automatic retry on contention.
   *
   * Repeatedly attempts to acquire a lock until success or timeout.
   *
   * @param name - Lock name
   * @param options - Lock options plus timeout and interval for retry
   * @returns Lock response on success
   * @throws PortDaddyError if lock cannot be acquired within timeout
   */
  async lockWithRetry(name: string, options: LockWithRetryOptions = {}): Promise<LockResponse> {
    const { timeout = 10000, interval = 500, ...lockOpts } = options;
    const deadline = Date.now() + timeout;

    while (true) {
      try {
        const result = await this.lock(name, lockOpts);
        return result;
      } catch (err) {
        const isConflict = err instanceof PortDaddyError && err.status === 409;
        const hasTime = Date.now() + interval < deadline;

        if (isConflict && hasTime) {
          // Lock is held by someone else — wait and retry
          await new Promise(resolve => setTimeout(resolve, interval));
          continue;
        }

        // If it was a 409 but we ran out of time, throw timeout error
        if (isConflict) {
          throw new PortDaddyError(
            `Failed to acquire lock "${name}" within ${timeout}ms`,
            408,
            { code: 'TIMEOUT', name }
          );
        }

        // Non-409 errors are thrown immediately
        throw err;
      }
    }
  }

  /**
   * Execute a function while holding a lock. The lock is automatically
   * released when the function completes (or throws).
   *
   * If the function takes longer than `extendInterval`, the lock TTL is
   * automatically extended to prevent expiration during execution.
   *
   * @param name - Lock name
   * @param fn - Async function to execute while holding the lock
   * @param options - Lock options plus extendInterval for auto-extension
   */
  async withLock<T>(name: string, fn: () => Promise<T>, options: WithLockOptions = {}): Promise<T> {
    const { extendInterval, ...lockOpts } = options;
    const ttl = lockOpts.ttl || 300000;
    const autoExtendMs = extendInterval || Math.min(ttl / 2, 30000);

    await this.lock(name, lockOpts);

    let extendTimer: ReturnType<typeof setInterval> | undefined;

    try {
      // Start auto-extend timer
      if (autoExtendMs > 0) {
        extendTimer = setInterval(() => {
          this.extendLock(name, { owner: lockOpts.owner, ttl }).catch(() => {
            // Best-effort extend — if it fails, the lock may expire
          });
        }, autoExtendMs);
      }

      return await fn();
    } finally {
      if (extendTimer) clearInterval(extendTimer);
      await this.unlock(name).catch(() => {}); // Best-effort release
    }
  }

  // ===========================================================================
  // Agents -- Registry and heartbeats
  // ===========================================================================

  /**
   * Register this client as an agent.
   */
  async register(options: RegisterOptions = {}): Promise<RegisterAgentResponse> {
    if (!this.agentId) {
      throw new PortDaddyError('agentId required for registration. Set it in constructor options.', 0, null);
    }
    return this._request('POST', '/agents', {
      id: this.agentId,
      name: options.name || this.agentId,
      type: options.type || 'sdk',
      metadata: options.metadata,
      maxServices: options.maxServices,
      maxLocks: options.maxLocks,
      identity: options.identity,
      purpose: options.purpose,
      worktree: options.worktree,
    }) as Promise<RegisterAgentResponse>;
  }

  /**
   * Send a heartbeat to keep the agent registration alive.
   */
  async heartbeat(): Promise<HeartbeatResponse> {
    if (!this.agentId) {
      throw new PortDaddyError('agentId required for heartbeat', 0, null);
    }
    return this._request('POST', `/agents/${encodeURIComponent(this.agentId)}/heartbeat`) as Promise<HeartbeatResponse>;
  }

  /**
   * Start automatic heartbeats at a regular interval.
   */
  startHeartbeat(intervalMs: number = 60000, onError?: (err: Error) => void): HeartbeatHandle {
    const handleError = onError || (() => {}); // Default: silently swallow

    const timer = setInterval(() => {
      this.heartbeat().catch(handleError);
    }, intervalMs);

    // Send one immediately
    this.heartbeat().catch(handleError);

    return {
      stop: () => clearInterval(timer),
    };
  }

  /**
   * Unregister this agent.
   */
  async unregister(): Promise<UnregisterAgentResponse> {
    if (!this.agentId) {
      throw new PortDaddyError('agentId required for unregister', 0, null);
    }
    return this._request('DELETE', `/agents/${encodeURIComponent(this.agentId)}`) as Promise<UnregisterAgentResponse>;
  }

  /**
   * Get info about an agent.
   */
  async getAgent(id?: string): Promise<GetAgentResponse> {
    const agentId = id || this.agentId;
    if (!agentId) throw new PortDaddyError('agent id required', 0, null);
    return this._request('GET', `/agents/${encodeURIComponent(agentId)}`) as Promise<GetAgentResponse>;
  }

  /**
   * List all registered agents.
   */
  async listAgents(options: ListAgentsOptions = {}): Promise<ListAgentsResponse> {
    const params = new URLSearchParams();
    if (options.activeOnly) params.set('active', 'true');
    const qs = params.toString();
    return this._request('GET', `/agents${qs ? '?' + qs : ''}`) as Promise<ListAgentsResponse>;
  }

  // ===========================================================================
  // Webhooks
  // ===========================================================================

  /**
   * Register a webhook.
   */
  async addWebhook(url: string, options: AddWebhookOptions = {}): Promise<AddWebhookResponse> {
    return this._request('POST', '/webhooks', { url, ...options }) as Promise<AddWebhookResponse>;
  }

  /**
   * List registered webhooks.
   */
  async listWebhooks(options: ListWebhooksOptions = {}): Promise<ListWebhooksResponse> {
    const params = new URLSearchParams();
    if (options.activeOnly) params.set('active', 'true');
    const qs = params.toString();
    return this._request('GET', `/webhooks${qs ? '?' + qs : ''}`) as Promise<ListWebhooksResponse>;
  }

  /**
   * Get a single webhook by ID.
   */
  async getWebhook(id: string): Promise<GetWebhookResponse> {
    return this._request('GET', `/webhooks/${encodeURIComponent(id)}`) as Promise<GetWebhookResponse>;
  }

  /**
   * Update a webhook.
   */
  async updateWebhook(id: string, options: Partial<AddWebhookOptions> & { url?: string; active?: boolean }): Promise<UpdateWebhookResponse> {
    return this._request('PUT', `/webhooks/${encodeURIComponent(id)}`, options as Record<string, unknown>) as Promise<UpdateWebhookResponse>;
  }

  /**
   * Delete a webhook.
   */
  async removeWebhook(id: string): Promise<RemoveWebhookResponse> {
    return this._request('DELETE', `/webhooks/${encodeURIComponent(id)}`) as Promise<RemoveWebhookResponse>;
  }

  /**
   * Send a test event to a webhook.
   */
  async testWebhook(id: string): Promise<TestWebhookResponse> {
    return this._request('POST', `/webhooks/${encodeURIComponent(id)}/test`) as Promise<TestWebhookResponse>;
  }

  /**
   * Get delivery history for a webhook.
   */
  async getWebhookDeliveries(id: string): Promise<GetWebhookDeliveriesResponse> {
    return this._request('GET', `/webhooks/${encodeURIComponent(id)}/deliveries`) as Promise<GetWebhookDeliveriesResponse>;
  }

  /**
   * Get available webhook event types.
   */
  async getWebhookEvents(): Promise<{ events: string[] }> {
    return this._request('GET', '/webhooks/events') as Promise<{ events: string[] }>;
  }

  // ===========================================================================
  // System -- Health, version, activity
  // ===========================================================================

  /**
   * Check if the daemon is healthy.
   */
  async health(): Promise<HealthResponse> {
    return this._request('GET', '/health') as Promise<HealthResponse>;
  }

  /**
   * Get daemon version and info.
   */
  async version(): Promise<VersionResponse> {
    return this._request('GET', '/version') as Promise<VersionResponse>;
  }

  /**
   * Get daemon metrics.
   */
  async metrics(): Promise<MetricsResponse> {
    return this._request('GET', '/metrics') as Promise<MetricsResponse>;
  }

  /**
   * Get config for a directory.
   */
  async getConfig(dir?: string): Promise<GetConfigResponse> {
    const params = new URLSearchParams();
    if (dir) params.set('dir', dir);
    const qs = params.toString();
    return this._request('GET', `/config${qs ? '?' + qs : ''}`) as Promise<GetConfigResponse>;
  }

  /**
   * Get recent activity log entries.
   */
  async getActivity(options: ActivityOptions = {}): Promise<ActivityResponse> {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.type) params.set('type', options.type);
    if (options.agent) params.set('agent', options.agent);
    const qs = params.toString();
    return this._request('GET', `/activity${qs ? '?' + qs : ''}`) as Promise<ActivityResponse>;
  }

  /**
   * Get activity entries within a time range.
   */
  async getActivityRange(from: string, to: string): Promise<ActivityRangeResponse> {
    const params = new URLSearchParams({ from, to });
    return this._request('GET', `/activity/range?${params}`) as Promise<ActivityRangeResponse>;
  }

  /**
   * Get activity summary grouped by type.
   */
  async getActivitySummary(since?: string): Promise<ActivitySummaryResponse> {
    const params = new URLSearchParams();
    if (since) params.set('since', since);
    const qs = params.toString();
    return this._request('GET', `/activity/summary${qs ? '?' + qs : ''}`) as Promise<ActivitySummaryResponse>;
  }

  /**
   * Get activity statistics.
   */
  async getActivityStats(): Promise<ActivityStatsResponse> {
    return this._request('GET', '/activity/stats') as Promise<ActivityStatsResponse>;
  }

  // ===========================================================================
  // Health -- Service health checks
  // ===========================================================================

  /**
   * Check health of a specific service.
   */
  async checkServiceHealth(id: string): Promise<ServiceHealthResponse> {
    return this._request('GET', `/services/health/${encodeURIComponent(id)}`) as Promise<ServiceHealthResponse>;
  }

  /**
   * List health status for all services.
   */
  async listServiceHealth(): Promise<ListServiceHealthResponse> {
    return this._request('GET', '/services/health') as Promise<ListServiceHealthResponse>;
  }

  // ===========================================================================
  // Ports -- Active port management
  // ===========================================================================

  /**
   * List all active port assignments.
   */
  async listActivePorts(): Promise<ListActivePortsResponse> {
    return this._request('GET', '/ports/active') as Promise<ListActivePortsResponse>;
  }

  /**
   * Get system port usage (ports in use by OS processes).
   */
  async getSystemPorts(): Promise<GetSystemPortsResponse> {
    return this._request('GET', '/ports/system') as Promise<GetSystemPortsResponse>;
  }

  /**
   * Trigger cleanup of stale services.
   */
  async cleanup(): Promise<CleanupResponse> {
    return this._request('POST', '/ports/cleanup') as Promise<CleanupResponse>;
  }

  // ===========================================================================
  // Projects -- Scanning and registry
  // ===========================================================================

  /**
   * Deep scan a directory for services.
   */
  async scan(dir: string, options: { save?: boolean; useBranch?: boolean; dryRun?: boolean } = {}): Promise<ScanResponse> {
    return this._request('POST', '/scan', { dir, ...options }) as Promise<ScanResponse>;
  }

  /**
   * List all registered projects.
   */
  async listProjects(): Promise<ListProjectsResponse> {
    return this._request('GET', '/projects') as Promise<ListProjectsResponse>;
  }

  /**
   * Get a project by ID.
   */
  async getProject(id: string): Promise<GetProjectResponse> {
    return this._request('GET', `/projects/${encodeURIComponent(id)}`) as Promise<GetProjectResponse>;
  }

  /**
   * Delete a project.
   */
  async deleteProject(id: string): Promise<DeleteProjectResponse> {
    return this._request('DELETE', `/projects/${encodeURIComponent(id)}`) as Promise<DeleteProjectResponse>;
  }

  // ===========================================================================
  // Sessions -- Agent work sessions and file coordination
  // ===========================================================================

  /**
   * Start a new session.
   */
  async startSession(options: {
    purpose: string;
    agentId?: string;
    files?: string[];
    force?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<SessionResponse> {
    return this._request('POST', '/sessions', options) as Promise<SessionResponse>;
  }

  /**
   * End a session (complete it).
   */
  async endSession(sessionIdOrNote?: string, options?: {
    status?: string;
    note?: string;
  }): Promise<SessionResponse> {
    // If first arg looks like a session ID, use it directly
    // Otherwise treat it as a note and find active session
    const isSessionId = sessionIdOrNote?.startsWith('session-');
    const sessionId = isSessionId ? sessionIdOrNote : undefined;
    const note = isSessionId ? options?.note : sessionIdOrNote;

    if (sessionId) {
      return this._request('PUT', `/sessions/${sessionId}`, {
        status: options?.status || 'completed',
        note,
      }) as Promise<SessionResponse>;
    }

    // Find active session
    const list = await this.sessions({ status: 'active', limit: 1 });
    if (!list.sessions.length) {
      return { success: false, id: '', purpose: '', status: '', createdAt: 0, updatedAt: 0 } as SessionResponse;
    }

    return this._request('PUT', `/sessions/${list.sessions[0].id}`, {
      status: options?.status || 'completed',
      note,
    }) as Promise<SessionResponse>;
  }

  /**
   * Abandon a session.
   */
  async abandonSession(sessionIdOrNote?: string): Promise<SessionResponse> {
    return this.endSession(sessionIdOrNote, { status: 'abandoned' });
  }

  /**
   * Delete a session entirely.
   */
  async removeSession(sessionId: string): Promise<{ success: boolean }> {
    return this._request('DELETE', `/sessions/${sessionId}`) as Promise<{ success: boolean }>;
  }

  /**
   * Add a quick note (auto-creates session if needed).
   */
  async note(content: string, options?: {
    type?: string;
    agentId?: string;
    sessionId?: string;
  }): Promise<NoteResponse> {
    if (options?.sessionId) {
      return this._request('POST', `/sessions/${options.sessionId}/notes`, {
        content,
        type: options?.type,
      }) as Promise<NoteResponse>;
    }
    return this._request('POST', '/notes', {
      content,
      agentId: options?.agentId,
      type: options?.type,
    }) as Promise<NoteResponse>;
  }

  /**
   * Get notes.
   */
  async notes(sessionIdOrOptions?: string | {
    limit?: number;
    type?: string;
    since?: number;
  }): Promise<NotesResponse> {
    if (typeof sessionIdOrOptions === 'string') {
      return this._request('GET', `/sessions/${sessionIdOrOptions}/notes`) as Promise<NotesResponse>;
    }
    const params = new URLSearchParams();
    if (sessionIdOrOptions?.limit) params.set('limit', String(sessionIdOrOptions.limit));
    if (sessionIdOrOptions?.type) params.set('type', sessionIdOrOptions.type);
    if (sessionIdOrOptions?.since) params.set('since', String(sessionIdOrOptions.since));
    const qs = params.toString();
    return this._request('GET', `/notes${qs ? `?${qs}` : ''}`) as Promise<NotesResponse>;
  }

  /**
   * List sessions.
   */
  async sessions(options?: {
    status?: string;
    agentId?: string;
    all?: boolean;
    limit?: number;
  }): Promise<SessionListResponse> {
    const params = new URLSearchParams();
    if (options?.status) params.set('status', options.status);
    if (options?.agentId) params.set('agent', options.agentId);
    if (options?.limit) params.set('limit', String(options.limit));
    const qs = params.toString();
    return this._request('GET', `/sessions${qs ? `?${qs}` : ''}`) as Promise<SessionListResponse>;
  }

  /**
   * Get session details.
   */
  async sessionDetails(id: string): Promise<SessionDetailResponse> {
    return this._request('GET', `/sessions/${id}`) as Promise<SessionDetailResponse>;
  }

  /**
   * Claim files for a session.
   */
  async claimFiles(sessionId: string, files: string[], force?: boolean): Promise<FileClaimResponse> {
    return this._request('POST', `/sessions/${sessionId}/files`, { files, force }) as Promise<FileClaimResponse>;
  }

  /**
   * Release files from a session.
   */
  async releaseFiles(sessionId: string, files: string[]): Promise<FileReleaseResponse> {
    return this._request('DELETE', `/sessions/${sessionId}/files`, { files }) as Promise<FileReleaseResponse>;
  }

  /**
   * Ping the daemon. Returns true if reachable, false otherwise.
   */
  async ping(): Promise<boolean> {
    try {
      await this.health();
      return true;
    } catch {
      return false;
    }
  }


  // ──────────────────────────────────────────────────────────────
  // Salvage (resurrection queue)
  // ──────────────────────────────────────────────────────────────

  /**
   * List agents in the resurrection queue (dead/stale agents pending salvage).
   * By default filters to agents in the same project as the current agent's identity.
   * Use `all: true` to see the global queue (use sparingly).
   */
  async salvage(options: SalvageListOptions = {}): Promise<SalvageListResponse> {
    const endpoint = options.all ? '/resurrection' : '/resurrection/pending';
    const params = new URLSearchParams();
    if (options.limit) params.append('limit', String(options.limit));
    if (options.project) params.append('project', options.project);
    if (options.stack) params.append('stack', options.stack);
    const query = params.toString();
    return this._request('GET', query ? `${endpoint}?${query}` : endpoint) as Promise<SalvageListResponse>;
  }

  /**
   * Claim a dead/stale agent's work for resurrection.
   * Returns context including session, purpose, and notes.
   */
  async salvageClaim(agentId: string): Promise<SalvageClaimResponse> {
    return this._request('POST', `/resurrection/claim/${encodeURIComponent(agentId)}`, {
      newAgentId: this.agentId || `sdk-${this.pid}`,
    }) as Promise<SalvageClaimResponse>;
  }

  /**
   * Mark resurrection complete (old agent's work has been taken over).
   */
  async salvageComplete(oldAgentId: string, newAgentId?: string): Promise<SalvageCompleteResponse> {
    return this._request('POST', `/resurrection/complete/${encodeURIComponent(oldAgentId)}`, {
      newAgentId: newAgentId || this.agentId || `sdk-${this.pid}`,
    }) as Promise<SalvageCompleteResponse>;
  }

  /**
   * Return an agent to the resurrection queue (couldn't complete salvage).
   */
  async salvageAbandon(agentId: string): Promise<SalvageAbandonResponse> {
    return this._request('POST', `/resurrection/abandon/${encodeURIComponent(agentId)}`) as Promise<SalvageAbandonResponse>;
  }

  /**
   * Dismiss an agent from the resurrection queue (reviewed, nothing to salvage).
   */
  async salvageDismiss(agentId: string): Promise<SalvageAbandonResponse> {
    return this._request('DELETE', `/resurrection/${encodeURIComponent(agentId)}`) as Promise<SalvageAbandonResponse>;
  }

  // ──────────────────────────────────────────────────────────────
  // Tunnels (expose local services via ngrok, cloudflared, localtunnel)
  // ──────────────────────────────────────────────────────────────

  /**
   * Start a tunnel for a service.
   * @param serviceId - Service identity (must already be claimed)
   * @param provider - Tunnel provider: 'ngrok' | 'cloudflared' | 'localtunnel'
   */
  async tunnelStart(serviceId: string, provider: 'ngrok' | 'cloudflared' | 'localtunnel' = 'ngrok'): Promise<TunnelStartResponse> {
    return this._request('POST', `/tunnel/${encodeURIComponent(serviceId)}`, { provider }) as Promise<TunnelStartResponse>;
  }

  /**
   * Stop a tunnel for a service.
   */
  async tunnelStop(serviceId: string): Promise<TunnelStopResponse> {
    return this._request('DELETE', `/tunnel/${encodeURIComponent(serviceId)}`) as Promise<TunnelStopResponse>;
  }

  /**
   * Get tunnel status for a service.
   */
  async tunnelStatus(serviceId: string): Promise<TunnelStatusResponse> {
    return this._request('GET', `/tunnel/${encodeURIComponent(serviceId)}`) as Promise<TunnelStatusResponse>;
  }

  /**
   * List all active tunnels.
   */
  async tunnelList(): Promise<TunnelListResponse> {
    return this._request('GET', '/tunnels') as Promise<TunnelListResponse>;
  }

  /**
   * Check which tunnel providers are installed.
   */
  async tunnelProviders(): Promise<TunnelProvidersResponse> {
    return this._request('GET', '/tunnel/providers') as Promise<TunnelProvidersResponse>;
  }
}

export { PortDaddy, PortDaddyError, ConnectionError };
export type {
  WaitResponse,
  LockWithRetryOptions,
  WithLockOptions,
  SubscribeOptions,
  ClaimOptions,
  LockOptions,
  LockResponse,
  Subscription,
};
export default PortDaddy;
