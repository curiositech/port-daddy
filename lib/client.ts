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
import { resolveDaemonTcpTarget, resolvePublishedDaemonUrl } from '../shared/daemon-discovery.js';
import type { DaemonTarget as ConnectionTarget } from '../shared/daemon-discovery.js';
import { createIpcClient } from './ipc-client.js';
import { IpcAction, Performative } from './ipc-types.js';
import { generateBeginIdempotencyKey } from './begin-idempotency.js';
import { DEFAULT_SOCK, DEFAULT_IPC } from '../shared/paths.js';
import type { SalvageQueueStatus } from './resurrection.js';

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

interface DeclaredChannelEntry {
  logicalName: string;
  physicalName: string;
  description: string | null;
  aliases: string[];
  scope: 'branch' | 'worktree' | 'repo' | 'global';
  projectDir: string | null;
  repoAnchor: string | null;
  repoKey: string | null;
  worktreeId: string | null;
  branch: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
  activeCount: number;
  lastMessage: number | null;
  active: boolean;
  source: 'declared' | 'observed';
}

interface ChannelContextResponse {
  projectDir: string | null;
  repoAnchor: string | null;
  repoKey: string | null;
  worktreeId: string | null;
  branch: string | null;
  inGit: boolean;
}

/** Matches the actual return shape of messaging.listChannels() */
interface ListChannelsResponse {
  success: boolean;
  channels: ChannelEntry[];
}

interface DiscoverChannelsOptions {
  projectDir?: string;
  query?: string;
  includeObserved?: boolean;
}

interface DiscoverChannelsResponse {
  success: boolean;
  context: ChannelContextResponse;
  channels: DeclaredChannelEntry[];
}

interface EnsureChannelOptions {
  aliases?: string[];
  description?: string;
  scope?: 'branch' | 'worktree' | 'repo' | 'global';
  projectDir?: string;
  metadata?: Record<string, unknown>;
}

interface EnsureChannelResponse {
  success: boolean;
  created: boolean;
  channel: DeclaredChannelEntry;
}

interface ResolveChannelOptions {
  projectDir?: string;
}

interface ResolveChannelResponse {
  success: boolean;
  channel: DeclaredChannelEntry;
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
  status: SalvageQueueStatus;
  holdReason?: 'durable_session_active';
  replacementAlreadyAdmitted?: boolean;
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
  expiresAt?: number;
}

/** Response from stopping a tunnel */
interface TunnelStopResponse {
  success: boolean;
  serviceId: string;
}

interface BondRecord {
  id: number;
  project: string;
  agent_id: string;
  archetype?: string | null;
  bond_usd: number;
  state: 'escrowed' | 'running' | 'exiting' | 'refunded' | 'slashed';
  escrowed_at: string;
  resolved_at?: string | null;
  slash_reason?: string | null;
}

interface WalletRow {
  project: string;
  balance_usd: number;
  commons_pool_usd: number;
  created_at?: string;
  updated_at?: string;
}

interface PanicStatus {
  armed: boolean;
  reason?: string | null;
  armed_at?: string | null;
  armed_by?: string | null;
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
  expiresAt?: number;
  ageMs?: number;
  cleanupReason?: 'expired' | 'orphan-process' | 'stale-record';
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
  expiresAt?: number;
  ageMs?: number;
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

// ──────────────────────────────────────────────────────────────
// Briefing types
// ──────────────────────────────────────────────────────────────

/** Matches the actual POST /briefing response */
interface BriefingGenerateResponse {
  success: boolean;
  briefingPath?: string;
  files?: string[];
  archivedSessions?: number;
  archivedAgents?: number;
  error?: string;
}

/** Matches the actual GET /briefing/:project response */
interface BriefingReadResponse {
  success: boolean;
  briefing?: Record<string, unknown>;
  error?: string;
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
  worktreeId?: string | null;
  metadata?: Record<string, unknown> | null;
  files?: string[];
  releasedFiles?: string[];
  conflicts?: Array<{ filePath: string; sessionId: string; purpose: string; claimedAt: number }>;
  error?: string;
  code?: string;
  candidates?: Array<{
    sessionId: string;
    worktreeId: string | null;
    status?: string | null;
    lifecycle?: 'durable' | 'ephemeral';
  }>;
}

interface SessionTakeoverResponse {
  success: boolean;
  predecessorId?: string;
  successorId?: string;
  session?: Record<string, unknown>;
  predecessorStatus?: string;
  notesPreserved?: boolean;
  claimsTransferred?: boolean;
  releasedFiles?: string[];
  claimedFiles?: string[];
  conflicts?: Array<{ filePath: string; sessionId: string; purpose: string; claimedAt: number }>;
  warnings?: string[];
  error?: string;
  code?: string;
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
  worktreeId?: string | null;
  error?: string;
}

/** Matches the actual POST /sessions/:id/notes or POST /notes response */
interface NoteResponse {
  success: boolean;
  noteId: number;
  sessionId: string;
  error?: string;
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
    agentId?: string | null;
    identityProject?: string | null;
  }>;
  count: number;
}

type ActorLeaseState = 'attached' | 'recoverable' | 'detached' | 'dormant';

interface ActorMailboxStats {
  total: number;
  unread: number;
  max: number | null;
}

interface ActorSignal {
  id: string;
  identity?: string | null;
  purpose?: string | null;
  status?: string | null;
  agentId?: string | null;
  sessionId?: string | null;
  lastHeartbeat?: number | null;
  updatedAt?: number | null;
  liveness?: string | null;
}

interface ActorRecord {
  id: string;
  label: string;
  title: string;
  mission: string;
  owns: string[];
  aliases: string[];
  compatibilityFleetAgent: string | null;
  mailbox: string;
  address: string;
  inboxTarget: string;
  mailboxStats: ActorMailboxStats | null;
  leaseState: ActorLeaseState;
  liveBodies: ActorSignal[];
  recentSessions: ActorSignal[];
  salvage: ActorSignal[];
  lastActivityAt: number | null;
  evidence: string[];
}

interface ListActorsOptions {
  project?: string;
  limit?: number;
}

interface ListActorsResponse {
  success: boolean;
  count: number;
  actors: ActorRecord[];
}

interface GetActorOptions {
  project?: string;
}

interface GetActorResponse {
  success: boolean;
  actor: ActorRecord;
  resolvedId: string;
}

interface MessageActorOptions {
  from?: string;
  type?: string;
  wake?: boolean;
  project?: string;
}

interface MessageActorResponse {
  success: boolean;
  actorId: string;
  inboxTarget: string;
  messageId: number;
  delivered: boolean;
  woke: boolean;
  wake?: unknown;
}

interface ActorInboxListOptions {
  unreadOnly?: boolean;
  limit?: number;
  since?: number;
}

interface ActorInboxMessage {
  id: number;
  agentId: string;
  from: string | null;
  content: unknown;
  contentType: string;
  type: string;
  read: boolean;
  createdAt: number;
}

interface ActorInboxListResponse {
  success: boolean;
  actorId: string;
  inboxTarget: string;
  messages: ActorInboxMessage[];
  count: number;
}

interface ActorInboxStatsResponse extends ActorMailboxStats {
  success: boolean;
  actorId: string;
  inboxTarget: string;
}

/** Region-level file claim descriptor */
interface FileRegion {
  path: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
  symbolPath?: string;
}

/** Matches the actual POST /sessions/:id/files response */
interface FileClaimResponse {
  success: boolean;
  claimed: string[];
  conflicts: Array<{
    filePath: string;
    sessionId: string;
    purpose: string;
    claimedAt: number;
    startLine?: number | null;
    endLine?: number | null;
    symbol?: string | null;
    symbolPath?: string | null;
  }>;
}

/** Matches the actual DELETE /sessions/:id/files response */
interface FileReleaseResponse {
  success: boolean;
  released: string[];
}

// ──────────────────────────────────────────────────────────────
// Sugar types (begin/done/whoami)
// ──────────────────────────────────────────────────────────────

/** Matches the actual GET /sugar/whoami response — alias kept for compatibility */
interface WhoamiResponse {
  success: boolean;
  active: boolean;
  agentId?: string;
  agentName?: string | null;
  name?: string | null;
  sessionId?: string;
  sessionName?: string | null;
  purpose?: string;
  identity?: string | null;
  phase?: string;
  files?: string[];
  noteCount?: number;
  startedAt?: number;
  duration?: number;
  hint?: string;
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
  /**
   * ADR-0040 daemon-minted actor credential presented on every request as the
   * `x-actor-credential` header. Attributed writes (#8877 / ADR-0122) —
   * sessions, notes, file claims, locks, salvage, commitments — are rejected
   * 401 without it. Set via constructor option `credential`, the
   * PORT_DADDY_ACTOR_CREDENTIAL env var, or automatically captured from a
   * `begin()` that minted a fresh soul.
   */
  credential: string | undefined;
  pid: number;
  timeout: number;
  private _ipc: ReturnType<typeof createIpcClient> | null = null;
  private _ipcPath: string;
  private _explicitUrl: string | undefined;
  private _urlOption: string | undefined;

  /**
   * Create a new Port Daddy client.
   */
  constructor(options: PortDaddyClientOptions = {}) {
    this._urlOption = options.url;
    this._explicitUrl = options.url || process.env.PORT_DADDY_URL;
    try {
      this.url = resolvePublishedDaemonUrl(this._explicitUrl).replace(/\/$/, '');
    } catch {
      // Preserve lazy connection behavior without publishing a guessed target.
      // _resolveTarget() repeats strict discovery when the first request runs.
      this.url = '';
    }
    this.socketPath = options.socketPath || process.env.PORT_DADDY_SOCK || DEFAULT_SOCK;
    this.agentId = options.agentId || process.env.PORT_DADDY_AGENT;
    this.credential = options.credential || process.env.PORT_DADDY_ACTOR_CREDENTIAL;
    this.pid = options.pid || process.pid;
    this.timeout = options.timeout || 5000;
    this._ipcPath = process.env.PORT_DADDY_IPC || DEFAULT_IPC;
  }

  /**
   * Get or create the binary IPC client for fire-and-forget operations.
   * Lazily connects on first use. Returns null if IPC socket doesn't exist.
   */
  private _getIpc(): ReturnType<typeof createIpcClient> | null {
    if (this._ipc) return this._ipc;
    if (this._explicitUrl || process.env.PORT_DADDY_SOCK || this.socketPath !== DEFAULT_SOCK) return null;
    if (!this.agentId) return null;
    if (!existsSync(this._ipcPath)) return null;

    this._ipc = createIpcClient({
      socketPath: this._ipcPath,
      agentId: this.agentId,
      reconnect: true,
      requestTimeout: this.timeout,
    });
    this._ipc.connect().catch(() => {
      // Connection failed — fall back to HTTP silently
      this._ipc = null;
    });
    return this._ipc;
  }

  private async _requestViaIpc<T>(
    action: string,
    payload: Record<string, unknown>,
    options: {
      agentId?: string;
      performative?: number;
    } = {},
  ): Promise<T | null> {
    if (this._explicitUrl || process.env.PORT_DADDY_SOCK || this.socketPath !== DEFAULT_SOCK) return null;

    const effectiveAgentId = options.agentId || this.agentId;
    if (!effectiveAgentId || !existsSync(this._ipcPath)) return null;

    const ipc = createIpcClient({
      socketPath: this._ipcPath,
      agentId: effectiveAgentId,
      reconnect: false,
      requestTimeout: this.timeout,
    });

    try {
      if (ipc.state !== 'ready') {
        await ipc.connect();
      }

      const frame = await ipc.request(
        (options.performative ?? Performative.REQUEST) as typeof Performative.REQUEST,
        { action, ...payload },
        this.timeout,
      );

      if (frame.type !== Performative.INFORM_DONE) {
        return null;
      }

      return (frame.payload.result ?? null) as T | null;
    } catch {
      return null;
    } finally {
      ipc.destroy();
    }
  }

  private _throwIpcParityError(
    result: { error?: unknown } | null | undefined,
    fallbackMessage: string,
    status: number,
  ): never {
    const message = typeof result?.error === 'string' ? result.error : fallbackMessage;
    throw new PortDaddyError(message, status, result ?? null);
  }

  // ===========================================================================
  // Internal helpers
  // ===========================================================================

  /** @private */
  _headers(
    hasBody: boolean = false,
    identity?: { agentId?: string | null },
  ): Record<string, string> {
    const h: Record<string, string> = {};
    if (hasBody) h['Content-Type'] = 'application/json';
    const requestAgentId = identity && Object.prototype.hasOwnProperty.call(identity, 'agentId')
      ? identity.agentId
      : this.agentId;
    if (requestAgentId) h['X-Agent-Id'] = requestAgentId;
    if (this.credential) h['X-Actor-Credential'] = this.credential;
    if (this.pid) h['X-Pid'] = String(this.pid);
    return h;
  }

  /** @private - Resolve connection target: prefer socket, fallback to TCP */
  _resolveTarget(): ConnectionTarget {
    if (process.env.PORT_DADDY_FORCE_TCP === '1') {
      return resolveDaemonTcpTarget(this._explicitUrl);
    }
    // A constructor URL is an unambiguous per-instance selection and must
    // override any stale/default socket that happens to exist on this machine.
    if (this._urlOption) {
      return resolveDaemonTcpTarget(this._explicitUrl);
    }
    // Preserve canonical environment precedence: SOCK before URL.
    if (process.env.PORT_DADDY_SOCK) return { socketPath: this.socketPath };
    if (process.env.PORT_DADDY_URL) return resolveDaemonTcpTarget(this._explicitUrl);
    // Use socket if it exists
    if (existsSync(this.socketPath)) {
      return { socketPath: this.socketPath };
    }
    // Fallback to TCP
    return resolveDaemonTcpTarget();
  }

  /** @private */
  _shouldFallbackFromSocket(error: NodeJS.ErrnoException): boolean {
    return error.code === 'ENOENT' ||
      error.code === 'ECONNREFUSED' ||
      error.code === 'ECONNRESET';
  }

  /** @private */
  async _request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    identity?: { agentId?: string | null },
  ): Promise<unknown> {
    const target = this._resolveTarget();
    const jsonBody = body !== undefined ? JSON.stringify(body) : null;
    const headers = this._headers(jsonBody !== null, identity);

    if (jsonBody) {
      headers['Content-Length'] = String(Buffer.byteLength(jsonBody));
    }

    const makeRequest = (requestTarget: ConnectionTarget) => new Promise((resolve, reject) => {
      const reqOpts: http.RequestOptions = {
        method,
        path,
        headers,
        timeout: this.timeout,
        ...(requestTarget.socketPath ? { socketPath: requestTarget.socketPath } : { host: requestTarget.host, port: requestTarget.port })
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
            if (process.env.DEBUG_TESTS) console.error(`[DEBUG] SDK Request failed: ${method} ${path} -> HTTP ${res.statusCode}`, data);
            reject(new PortDaddyError(msg, res.statusCode!, data));
            return;
          }

          resolve(data);
        });
      });

      req.on('error', (err: NodeJS.ErrnoException) => {
        if (requestTarget.socketPath && this._shouldFallbackFromSocket(err)) {
          try {
            resolve(makeRequest(resolveDaemonTcpTarget(this._explicitUrl)));
          } catch (targetError) {
            reject(targetError);
          }
          return;
        }
        if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
          reject(new ConnectionError(requestTarget.socketPath || this.url));
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

    return makeRequest(target);
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
    // Fast path: binary IPC fire-and-forget
    const ipc = this._getIpc();
    if (ipc && ipc.state === 'ready') {
      ipc.publish(channel, typeof payload === 'string' ? payload : JSON.stringify(payload));
      return { success: true, id: 0, message: 'ipc' };
    }

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
   * Discover declared channels for the current repo/worktree context.
   */
  async discoverChannels(options: DiscoverChannelsOptions = {}): Promise<DiscoverChannelsResponse> {
    const params = new URLSearchParams();
    if (options.projectDir) params.set('projectDir', options.projectDir);
    if (options.query) params.set('q', options.query);
    if (options.includeObserved) params.set('observed', 'true');
    const qs = params.toString();
    return this._request('GET', `/channels/discover${qs ? '?' + qs : ''}`) as Promise<DiscoverChannelsResponse>;
  }

  /**
   * Resolve a logical channel name to its git-sensitive physical channel.
   */
  async resolveChannel(name: string, options: ResolveChannelOptions = {}): Promise<ResolveChannelResponse> {
    const params = new URLSearchParams();
    if (options.projectDir) params.set('projectDir', options.projectDir);
    const qs = params.toString();
    return this._request('GET', `/channels/resolve/${encodeURIComponent(name)}${qs ? '?' + qs : ''}`) as Promise<ResolveChannelResponse>;
  }

  /**
   * Declare or update a canonical channel for the current repo/worktree context.
   */
  async ensureChannel(name: string, options: EnsureChannelOptions = {}): Promise<EnsureChannelResponse> {
    return this._request('POST', '/channels/ensure', { name, ...options }) as Promise<EnsureChannelResponse>;
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
    const handlers: Record<SubscriptionEventType, SubscriptionHandler[]> = {
      message: [],
      error: [],
      connected: []
    };

    let active = true;
    let retryCount = 0;
    let currentReq: http.ClientRequest | undefined;
    let currentES: any | undefined;

    const connect = () => {
      if (!active) return;

      // Use native EventSource if available (browser), otherwise fall back
      const EventSourceImpl = typeof EventSource !== 'undefined' ? EventSource : null;

      if (!EventSourceImpl) {
        // Node.js fallback using http.request to support Unix sockets
        const target = this._resolveTarget();
        const path = `/msg/${encodeURIComponent(channel)}/subscribe`;
        const headers = { ...this._headers(), 'Accept': 'text/event-stream' };

        currentReq = http.request({
          method: 'GET',
          path,
          headers,
          ...(target.socketPath ? { socketPath: target.socketPath } : { host: target.host, port: target.port })
        }, (res) => {
          retryCount = 0; // Reset on successful connection
          
          let buffer = '';
          let currentEvent = 'message';

          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop()!; // Keep incomplete line in buffer

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                try {
                  const data: unknown = JSON.parse(line.slice(6));
                  if (currentEvent === 'message') {
                    handlers.message.forEach(fn => fn(data));
                  } else if (currentEvent === 'connected') {
                    handlers.connected.forEach(fn => fn(data));
                  }
                  // Reset to default for next block
                  currentEvent = 'message';
                } catch {
                  // Non-JSON data line, skip
                }
              } else if (line.trim() === '') {
                // End of block, reset event
                currentEvent = 'message';
              }
            }
          });

          res.on('end', () => {
            currentReq = undefined;
            // Stream ended — reconnect if enabled
            if (active && reconnect && retryCount < maxRetries) {
              retryCount++;
              const timer = setTimeout(connect, reconnectDelay * retryCount);
              if (typeof timer.unref === 'function') timer.unref();
            }
          });
        });

        currentReq.on('error', (err) => {
          currentReq = undefined;
          if (active) {
            handlers.error.forEach(fn => fn(err));
            // Reconnect on error if enabled
            if (reconnect && retryCount < maxRetries) {
              retryCount++;
              const timer = setTimeout(connect, reconnectDelay * retryCount);
              if (typeof timer.unref === 'function') timer.unref();
            }
          }
        });

        currentReq.end();
      } else {
        // Browser EventSource path
        const url = `${this.url}/msg/${encodeURIComponent(channel)}/subscribe`;
        currentES = new EventSourceImpl(url);
        currentES.onmessage = (e: MessageEvent) => {
          try {
            const data: unknown = JSON.parse(e.data);
            handlers.message.forEach(fn => fn(data));
          } catch { /* ignore non-JSON */ }
        };
        currentES.onerror = (e: Event) => {
          if (active) {
            handlers.error.forEach(fn => fn(e));
            if (reconnect && retryCount < maxRetries) {
              retryCount++;
              currentES.close();
              currentES = undefined;
              const timer = setTimeout(connect, reconnectDelay * retryCount);
              if (typeof timer.unref === 'function') timer.unref();
            }
          }
        };
        currentES.addEventListener('connected', () => {
          retryCount = 0;
          handlers.connected.forEach(fn => fn(undefined));
        });
      }
    };

    connect();

    return {
      on(event: SubscriptionEventType, fn: SubscriptionHandler): Subscription { (handlers[event] || []).push(fn); return this; },
      unsubscribe(): void {
        active = false;
        if (currentReq) {
          currentReq.destroy();
          currentReq = undefined;
        }
        if (currentES) {
          currentES.close();
          currentES = undefined;
        }
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
    const ipcResult = await this._requestViaIpc<CheckLockResponse & { error?: string }>(
      IpcAction.LOCK_CHECK,
      { name },
      { performative: Performative.QUERY_REF },
    );
    if (ipcResult) {
      if (ipcResult.success === false) {
        this._throwIpcParityError(ipcResult, 'Failed to check lock', 400);
      }
      return ipcResult;
    }

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
    const ipcResult = await this._requestViaIpc<ListLocksResponse & { error?: string }>(
      IpcAction.LOCK_LIST,
      { owner: options.owner },
      { performative: Performative.QUERY_REF },
    );
    if (ipcResult) {
      if (ipcResult.success === false) {
        this._throwIpcParityError(ipcResult, 'Failed to list locks', 400);
      }
      return ipcResult;
    }

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
        if (typeof extendTimer.unref === 'function') extendTimer.unref();
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

    // Fast path: binary IPC fire-and-forget (~3us vs ~200us HTTP)
    const ipc = this._getIpc();
    if (ipc && ipc.state === 'ready') {
      ipc.heartbeat();
      return { success: true, agentId: this.agentId, lastHeartbeat: Date.now(), message: 'ipc' };
    }

    // Fallback: HTTP POST
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
    if (typeof timer.unref === 'function') timer.unref();

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
    lifecycle?: 'durable' | 'ephemeral';
    agentId?: string;
    files?: string[];
    force?: boolean;
    metadata?: Record<string, unknown>;
    worktree?: Record<string, unknown>;
    requireLinkedWorktree?: boolean;
    allowMainWorktree?: boolean;
  }): Promise<SessionResponse> {
    if (options.lifecycle !== undefined && options.lifecycle !== 'durable' && options.lifecycle !== 'ephemeral') {
      throw new Error('startSession lifecycle must be "durable" or "ephemeral" when provided');
    }
    return this._request('POST', '/sessions', options) as Promise<SessionResponse>;
  }

  /**
   * End a session (complete it).
   */
  async endSession(sessionIdOrNote?: string, options?: {
    status?: string;
    note?: string;
    /** Explicit owner paired by a preceding daemon resolution, never ambient. */
    agentId?: string;
  }): Promise<SessionResponse> {
    // If first arg looks like a session ID, use it directly
    // Otherwise treat it as a note and find active session
    const isSessionId = sessionIdOrNote?.startsWith('session-');
    const sessionId = isSessionId ? sessionIdOrNote : undefined;
    const note = isSessionId ? options?.note : sessionIdOrNote;
    const status = options?.status || 'completed';

    if (sessionId) {
      if (status === 'completed') {
        const result = await this.done(note, { sessionId, status: 'completed', agentId: options?.agentId });
        return {
          ...result,
          id: result.sessionId || sessionId,
          purpose: '',
          status: result.sessionStatus || 'completed',
          createdAt: 0,
          updatedAt: Date.now(),
        } as SessionResponse;
      }
      return this._request('PUT', `/sessions/${sessionId}`, {
        status,
        note,
        agentId: options?.agentId,
      }, { agentId: options?.agentId ?? null }) as Promise<SessionResponse>;
    }

    // Find active session
    const list = await this.sessions({
      status: 'active',
      agentId: this.agentId,
      allWorktrees: true,
      limit: 50,
    });
    if (!list.sessions.length) {
      return {
        success: false,
        id: '',
        purpose: '',
        status: '',
        createdAt: 0,
        updatedAt: 0,
        code: 'NO_ACTIVE_SESSION',
        error: 'No active session found',
      } as SessionResponse;
    }
    if (list.sessions.length > 1) {
      return {
        success: false,
        id: '',
        purpose: '',
        status: '',
        createdAt: 0,
        updatedAt: 0,
        code: 'AMBIGUOUS_ACTIVE_SESSION',
        error: 'Multiple active sessions match this actor; pass an exact sessionId.',
        candidates: list.sessions.map((session) => {
          const row = session as unknown as Record<string, unknown>;
          return {
            sessionId: session.id,
            worktreeId: typeof row.worktreeId === 'string' ? row.worktreeId : null,
          };
        }),
      } as SessionResponse;
    }

    return this.endSession(list.sessions[0].id, { status, note, agentId: list.sessions[0].agentId ?? undefined });
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
  async removeSession(
    sessionId: string,
    options?: { agentId?: string | null },
  ): Promise<{ success: boolean }> {
    return this._request(
      'DELETE',
      `/sessions/${sessionId}`,
      undefined,
      { agentId: options?.agentId ?? null },
    ) as Promise<{ success: boolean }>;
  }

  /**
   * Start a successor session from an existing one without deleting its notes.
   */
  async takeoverSession(sessionId: string, options?: {
    agentId?: string;
    purpose?: string;
    note?: string;
    project?: string;
    worktreeId?: string;
    metadata?: Record<string, unknown>;
    worktree?: Record<string, unknown>;
    requireLinkedWorktree?: boolean;
    allowMainWorktree?: boolean;
    lifecycle?: 'durable' | 'ephemeral';
    claimFiles?: boolean;
  }): Promise<SessionTakeoverResponse> {
    const body: Record<string, unknown> = { ...(options || {}) };
    if (options?.lifecycle) {
      body.durable = options.lifecycle === 'durable';
      delete body.lifecycle;
    }

    return this._request(
      'POST',
      `/sessions/${sessionId}/takeover`,
      body,
      { agentId: options?.agentId ?? null },
    ) as Promise<SessionTakeoverResponse>;
  }

  /** Add an attributed note to one exact session. */
  async note(content: string, options?: {
    type?: string;
    agentId?: string;
    sessionId?: string;
  }): Promise<NoteResponse> {
    return this._request('POST', '/notes', {
      content,
      sessionId: options?.sessionId,
      agentId: options?.agentId,
      type: options?.type,
    }, {
      agentId: options?.sessionId ? (options.agentId ?? null) : options?.agentId,
    }) as Promise<NoteResponse>;
  }

  /**
   * Get notes.
   */
  async notes(sessionIdOrOptions?: string | {
    limit?: number;
    type?: string;
    since?: number;
    project?: string;
  }): Promise<NotesResponse> {
    if (typeof sessionIdOrOptions === 'string') {
      return this._request('GET', `/sessions/${sessionIdOrOptions}/notes`) as Promise<NotesResponse>;
    }
    const params = new URLSearchParams();
    if (sessionIdOrOptions?.limit) params.set('limit', String(sessionIdOrOptions.limit));
    if (sessionIdOrOptions?.type) params.set('type', sessionIdOrOptions.type);
    if (sessionIdOrOptions?.since) params.set('since', String(sessionIdOrOptions.since));
    if (sessionIdOrOptions?.project) params.set('project', sessionIdOrOptions.project);
    const qs = params.toString();
    return this._request('GET', `/notes${qs ? `?${qs}` : ''}`) as Promise<NotesResponse>;
  }

  /**
   * List sessions.
   */
  async sessions(options?: {
    status?: string;
    agentId?: string;
    project?: string;
    purpose?: string;
    worktreeId?: string;
    allWorktrees?: boolean;
    includeNotes?: boolean;
    limit?: number;
  }): Promise<SessionListResponse> {
    const ipcPayload = {
      status: options?.status,
      agentId: options?.agentId,
      project: options?.project,
      purpose: options?.purpose,
      worktreeId: options?.worktreeId,
      allWorktrees: options?.allWorktrees,
      includeNotes: options?.includeNotes,
      limit: options?.limit,
    };
    const ipcResult = await this._requestViaIpc<SessionListResponse>(
      IpcAction.SESSION_LIST,
      ipcPayload,
      { performative: Performative.QUERY_REF },
    );
    if (ipcResult) {
      if (ipcResult.success === false) {
        this._throwIpcParityError(ipcResult, 'Failed to list sessions', 400);
      }
      return ipcResult;
    }

    const params = new URLSearchParams();
    if (options?.status) params.set('status', options.status);
    if (options?.agentId) params.set('agent', options.agentId);
    if (options?.project) params.set('project', options.project);
    if (options?.purpose) params.set('purpose', options.purpose);
    if (options?.worktreeId) params.set('worktree', options.worktreeId);
    if (options?.allWorktrees) params.set('allWorktrees', 'true');
    if (options?.includeNotes) params.set('notes', 'true');
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
   * Claim files for a session. Supports whole-file and region-level claims.
   */
  async claimFiles(
    sessionId: string,
    files: string[],
    options?: { regions?: FileRegion[]; force?: boolean; agentId?: string | null } | boolean
  ): Promise<FileClaimResponse> {
    // Backward compat: third arg used to be just `force: boolean`
    let force: boolean | undefined;
    let regions: FileRegion[] | undefined;
    let agentId: string | null | undefined;
    if (typeof options === 'boolean') {
      force = options;
    } else if (options) {
      force = options.force;
      regions = options.regions;
      agentId = options.agentId;
    }
    // An exact session id is already the target. Never graft the client's
    // ambient display alias onto it; only an explicitly paired agentId may
    // travel with the session tuple.
    const callerAgentId = agentId ?? undefined;
    return this._request(
      'POST',
      `/sessions/${sessionId}/files`,
      { files, regions, force, agentId: callerAgentId },
      { agentId: callerAgentId ?? null },
    ) as Promise<FileClaimResponse>;
  }

  /**
   * Release files from a session. Supports whole-file and region-level releases.
   */
  async releaseFiles(
    sessionId: string,
    files: string[],
    options?: { regions?: FileRegion[]; agentId?: string | null }
  ): Promise<FileReleaseResponse> {
    const callerAgentId = options?.agentId ?? undefined;
    return this._request(
      'DELETE',
      `/sessions/${sessionId}/files`,
      { files, regions: options?.regions, agentId: callerAgentId },
      { agentId: callerAgentId ?? null },
    ) as Promise<FileReleaseResponse>;
  }

  // ──────────────────────────────────────────────────────────────
  // Session Phases
  // ──────────────────────────────────────────────────────────────

  /**
   * Set the phase of a session.
   * Valid phases: planning, in_progress, testing, reviewing, completed, abandoned
   */
  async setSessionPhase(
    sessionId: string,
    phase: string,
    options?: { agentId?: string | null },
  ): Promise<Record<string, unknown>> {
    return this._request(
      'PUT',
      `/sessions/${sessionId}/phase`,
      { phase, agentId: options?.agentId },
      { agentId: options?.agentId ?? null },
    ) as Promise<Record<string, unknown>>;
  }

  // ──────────────────────────────────────────────────────────────
  // Global File Claims
  // ──────────────────────────────────────────────────────────────

  /**
   * List all active file claims across all sessions.
   */
  async listFileClaims(): Promise<Record<string, unknown>> {
    return this._request('GET', '/files') as Promise<Record<string, unknown>>;
  }

  /**
   * Check who owns a specific file path.
   * Use before editing files to avoid conflicts.
   */
  async whoOwnsFile(filePath: string): Promise<Record<string, unknown>> {
    return this._request('GET', `/files/who-owns?path=${encodeURIComponent(filePath)}`) as Promise<Record<string, unknown>>;
  }

  // ──────────────────────────────────────────────────────────────
  // Integration Signals
  // ──────────────────────────────────────────────────────────────

  /**
   * Signal that work is ready for integration.
   * Publishes to integration:<project>:ready channel.
   */
  async integrationReady(identity: string, description: string): Promise<Record<string, unknown>> {
    const project = identity.split(':')[0];
    const channel = `integration:${project}:ready`;
    return this._request('POST', `/msg/${encodeURIComponent(channel)}`, {
      payload: { type: 'ready', identity, description, timestamp: Date.now() },
      sender: identity,
    }) as Promise<Record<string, unknown>>;
  }

  /**
   * Signal that work needs something from another agent.
   * Publishes to integration:<project>:needs channel.
   */
  async integrationNeeds(identity: string, description: string): Promise<Record<string, unknown>> {
    const project = identity.split(':')[0];
    const channel = `integration:${project}:needs`;
    return this._request('POST', `/msg/${encodeURIComponent(channel)}`, {
      payload: { type: 'needs', identity, description, timestamp: Date.now() },
      sender: identity,
    }) as Promise<Record<string, unknown>>;
  }

  // ──────────────────────────────────────────────────────────────
  // Briefing — Project-local agent intelligence
  // ──────────────────────────────────────────────────────────────

  /**
   * Generate `.portdaddy/` briefing for a project root.
   * Writes briefing.md and briefing.json to disk.
   */
  async generateBriefing(projectRoot: string, options?: {
    project?: string;
    full?: boolean;
  }): Promise<BriefingGenerateResponse> {
    const body: Record<string, unknown> = { projectRoot };
    if (options?.project) body.project = options.project;
    if (options?.full) body.full = true;
    return this._request('POST', '/briefing', body) as Promise<BriefingGenerateResponse>;
  }

  /**
   * Get briefing data as JSON (no disk write).
   */
  async getBriefing(project: string, projectRoot?: string): Promise<BriefingReadResponse> {
    const params = new URLSearchParams();
    if (projectRoot) params.set('projectRoot', projectRoot);
    const qs = params.toString();
    return this._request('GET', `/briefing/${encodeURIComponent(project)}${qs ? '?' + qs : ''}`) as Promise<BriefingReadResponse>;
  }

  // ===========================================================================
  // Sugar -- Compound commands for common workflows
  // ===========================================================================

  /**
   * Begin a work session: register agent + start session atomically.
   * Auto-generates an agent ID if `agentId` is not set on the client.
   *
   * @example
   * const pd = new PortDaddy({ agentId: 'my-agent' });
   * const { sessionId } = await pd.begin('Building auth system', {
   *   lifecycle: 'durable',
   *   identity: 'myapp:api:auth',
   *   files: ['src/auth.ts', 'src/middleware.ts'],
   * });
   */
  /**
   * Register this client's actor identity with the daemon's ADR-0040 mint
   * (`POST /actors/register`) and hold the returned credential.
   *
   * Why this exists: #8877 / ADR-0122 made every attributed write boundary
   * (sessions, notes, file claims, locks, salvage, commitments) REQUIRE a
   * daemon-minted credential — a bare self-asserted agentId is rejected 401.
   * `begin()` obtains one automatically through the sugar mint door, but
   * flows that never call begin (e.g. `startSession` directly) need this
   * explicit registration step. The plaintext credential is returned by the
   * daemon exactly once; this method captures it onto the client so every
   * subsequent request presents it.
   *
   * @param options.alias - Display alias to bind to the minted soul
   *        (typically the agentId this client asserts on writes).
   * @returns The mint outcome ({ actorId, credential? }) from the daemon.
   */
  async registerActor(options: { alias?: string } = {}): Promise<{
    success: boolean;
    status: 'minted' | 'resolved';
    actorId: string;
    soulClass: string;
    credential?: string;
  }> {
    const body: Record<string, unknown> = {};
    if (options.alias) body.alias = options.alias;
    if (this.credential) body.credential = this.credential;
    const result = await this._request('POST', '/actors/register', body) as {
      success: boolean;
      status: 'minted' | 'resolved';
      actorId: string;
      soulClass: string;
      credential?: string;
    };
    if (result.credential) {
      this.credential = result.credential;
    }
    return result;
  }

  /**
   * Ensure this client holds an actor credential, minting one if needed.
   *
   * Purpose: convenience wrapper for CLI/SDK flows that are about to perform
   * an attributed write without having gone through `begin()`. When the
   * client already holds a credential this is a no-op; otherwise it registers
   * through {@link registerActor} (binding `alias` when given) and captures
   * the minted credential.
   *
   * @param alias - Display alias to bind when a fresh soul is minted.
   * @returns The credential now held by the client.
   */
  async ensureActorCredential(alias?: string): Promise<string> {
    if (this.credential) return this.credential;
    await this.registerActor(alias ? { alias } : {});
    if (!this.credential) {
      throw new PortDaddyError('actor registration returned no credential', 0, null);
    }
    return this.credential;
  }

  async begin(purpose: string, options: BeginSugarOptions): Promise<BeginSugarResponse> {
    if (!options || (options.lifecycle !== 'durable' && options.lifecycle !== 'ephemeral')) {
      throw new Error('PortDaddy.begin requires options.lifecycle to be "durable" or "ephemeral"');
    }
    const body: Record<string, unknown> = { purpose };
    if (this.agentId) body.agentId = this.agentId;
    if (options.agentId) body.agentId = options.agentId;
    if (options.name) body.name = options.name;
    if (options.identity) body.identity = options.identity;
    if (options.type) body.type = options.type;
    if (options.files) body.files = options.files;
    if (options.force) body.force = options.force;
    if (options.metadata) body.metadata = options.metadata;
    if (options.worktree) body.worktree = options.worktree;
    if (options.requireLinkedWorktree) body.requireLinkedWorktree = true;
    if (options.allowMainWorktree) body.allowMainWorktree = true;
    body.lifecycle = options.lifecycle;
    // One key per logical begin: `_request` re-sends the same body on a
    // socket reset, and the daemon replays the original session for a known
    // key instead of minting a second one. Callers retrying across processes
    // pass their own key so those retries replay too.
    body.idempotencyKey = options.idempotencyKey ?? generateBeginIdempotencyKey();

    const result = await this._request('POST', '/sugar/begin', body) as BeginSugarResponse;

    // Update client's agentId from server response for subsequent calls
    if (result.agentId && !this.agentId) {
      this.agentId = result.agentId;
    }

    // #8877 / ADR-0122: an uncredentialed begin MINTS a fresh ADR-0040 soul
    // and returns its credential exactly once. Capture it so every subsequent
    // attributed write from this client (done, notes, claims, locks, ...)
    // presents it — without this, those writes are rejected 401.
    if (result.credential && !this.credential) {
      this.credential = result.credential;
    }

    return result;
  }

  /**
   * End a work session: end session + unregister agent atomically.
   *
   * @example
   * await pd.done('Completed auth implementation');
   */
  async done(note?: string, options: DoneSugarOptions = {}): Promise<DoneSugarResponse> {
    const body: Record<string, unknown> = {};
    if (this.agentId && !options.sessionId) body.agentId = this.agentId;
    if (options.agentId) body.agentId = options.agentId;
    if (options.sessionId) body.sessionId = options.sessionId;
    if (note) body.note = note;
    if (options.status) body.status = options.status;
    if (options.skipOriginCheck) body.skipOriginCheck = true;
    if (options.skipOriginCheckReason) body.skipOriginCheckReason = options.skipOriginCheckReason;
    if (options.noPr) body.noPr = true;
    if (options.subtask) body.subtask = true;
    if (options.forceIncomplete) body.forceIncomplete = true;
    if (options.forceIncompleteReason) body.forceIncompleteReason = options.forceIncompleteReason;

    const result = await this._request(
      'POST',
      '/sugar/done',
      body,
      { agentId: options.sessionId ? (options.agentId ?? null) : options.agentId },
    ) as DoneSugarResponse;

    // Clear agentId since we just unregistered
    if (result.agentUnregistered && (!result.agentId || result.agentId === this.agentId)) {
      this.agentId = undefined;
    }

    return result;
  }

  /**
   * Show current agent/session context.
   *
   * @example
   * const ctx = await pd.whoami();
   * if (ctx.active) console.log(`Working on: ${ctx.purpose}`);
   */
  async whoami(agentIdOrOptions?: string | { agentId?: string; sessionId?: string }): Promise<WhoamiSugarResponse> {
    const whoamiOptions = typeof agentIdOrOptions === 'string'
      ? { agentId: agentIdOrOptions }
      : (agentIdOrOptions || {});
    const sessionId = whoamiOptions.sessionId;
    const resolvedAgentId = whoamiOptions.agentId
      || (sessionId ? undefined : this.agentId);

    if (resolvedAgentId) {
      const payload: Record<string, unknown> = { agentId: resolvedAgentId };
      if (sessionId) payload.sessionId = sessionId;
      const ipcResult = await this._requestViaIpc<WhoamiSugarResponse>(
        IpcAction.WHOAMI,
        payload,
        { agentId: resolvedAgentId, performative: Performative.QUERY_REF },
      );
      if (ipcResult) return ipcResult;
    }

    const params = new URLSearchParams();
    if (resolvedAgentId) params.set('agentId', resolvedAgentId);
    if (sessionId) params.set('sessionId', sessionId);
    const qs = params.toString();
    return this._request('GET', `/sugar/whoami${qs ? `?${qs}` : ''}`) as Promise<WhoamiSugarResponse>;
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
      newAgentId: this.agentId,
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

  // ──────────────────────────────────────────────────────────────
  // Actors (durable actor souls + optional live bodies)
  // ──────────────────────────────────────────────────────────────

  /**
   * List durable actors projected from live agents, sessions, and salvage state.
   */
  async listActors(options: ListActorsOptions = {}): Promise<ListActorsResponse> {
    const params = new URLSearchParams();
    if (options.project) params.append('project', options.project);
    if (options.limit) params.append('limit', String(options.limit));
    const qs = params.toString();
    return this._request('GET', `/actors${qs ? '?' + qs : ''}`) as Promise<ListActorsResponse>;
  }

  /**
   * Get a durable actor by canonical ID or alias.
   */
  async getActor(actorId: string, options: GetActorOptions = {}): Promise<GetActorResponse> {
    const params = new URLSearchParams();
    if (options.project) params.append('project', options.project);
    const qs = params.toString();
    return this._request('GET', `/actors/${encodeURIComponent(actorId)}${qs ? '?' + qs : ''}`) as Promise<GetActorResponse>;
  }

  /**
   * Send a message to a durable actor mailbox.
   *
   * Use `wake: true` only when the operator also wants to hail a compatible live fleet body.
   */
  async messageActor(actorId: string, content: unknown, options: MessageActorOptions = {}): Promise<MessageActorResponse> {
    return this._request('POST', `/actors/${encodeURIComponent(actorId)}/message`, {
      content,
      ...options,
    }) as Promise<MessageActorResponse>;
  }

  /**
   * Read recent messages from a durable actor mailbox.
   */
  async actorInboxList(actorId: string, options: ActorInboxListOptions = {}): Promise<ActorInboxListResponse> {
    const params = new URLSearchParams();
    if (options.unreadOnly) params.append('unread', 'true');
    if (options.limit) params.append('limit', String(options.limit));
    if (options.since) params.append('since', String(options.since));
    const qs = params.toString();
    return this._request('GET', `/actors/${encodeURIComponent(actorId)}/inbox${qs ? '?' + qs : ''}`) as Promise<ActorInboxListResponse>;
  }

  /**
   * Read mailbox depth for a durable actor.
   */
  async actorInboxStats(actorId: string): Promise<ActorInboxStatsResponse> {
    return this._request('GET', `/actors/${encodeURIComponent(actorId)}/inbox/stats`) as Promise<ActorInboxStatsResponse>;
  }

  // ──────────────────────────────────────────────────────────────
  // Inbox (direct agent-to-agent messaging)
  // ──────────────────────────────────────────────────────────────

  /**
   * Send a message to an agent's inbox.
   */
  async inboxSend(agentId: string, content: string, options: { from?: string; type?: string } = {}): Promise<InboxSendResponse> {
    return this._request('POST', `/agents/${encodeURIComponent(agentId)}/inbox`, { content, ...options }) as Promise<InboxSendResponse>;
  }

  /**
   * List messages in an agent's inbox.
   */
  async inboxList(agentId: string, options: InboxListOptions = {}): Promise<InboxListResponse> {
    const params = new URLSearchParams();
    if (options.unreadOnly) params.append('unread', 'true');
    if (options.limit) params.append('limit', String(options.limit));
    if (options.since) params.append('since', String(options.since));
    const qs = params.toString() ? '?' + params.toString() : '';
    return this._request('GET', `/agents/${encodeURIComponent(agentId)}/inbox${qs}`) as Promise<InboxListResponse>;
  }

  /**
   * Get inbox statistics (total and unread counts).
   */
  async inboxStats(agentId: string): Promise<InboxStatsResponse> {
    return this._request('GET', `/agents/${encodeURIComponent(agentId)}/inbox/stats`) as Promise<InboxStatsResponse>;
  }

  /**
   * Mark a specific message as read.
   */
  async inboxMarkRead(agentId: string, messageId: number): Promise<InboxMarkReadResponse> {
    return this._request('PUT', `/agents/${encodeURIComponent(agentId)}/inbox/${messageId}/read`) as Promise<InboxMarkReadResponse>;
  }

  /**
   * Mark all messages in an agent's inbox as read.
   */
  async inboxMarkAllRead(agentId: string): Promise<InboxMarkReadResponse> {
    return this._request('PUT', `/agents/${encodeURIComponent(agentId)}/inbox/read-all`, {}) as Promise<InboxMarkReadResponse>;
  }

  /**
   * Clear all messages from an agent's inbox.
   */
  async inboxClear(agentId: string): Promise<InboxClearResponse> {
    return this._request('DELETE', `/agents/${encodeURIComponent(agentId)}/inbox`) as Promise<InboxClearResponse>;
  }

  /**
   * Subscribe to an agent's inbox via pub/sub (SSE).
   * 
   * @param agentId - The agent ID to subscribe to
   * @param options - Subscription options (reconnect, maxRetries, etc.)
   * @returns A Subscription object with .on('message', callback)
   */
  inboxSubscribe(agentId: string, options: SubscribeOptions = {}): Subscription {
    const sub = this.subscribe(`inbox:${agentId}`, options);
    const originalOn = sub.on.bind(sub);

    // Overwrite .on to automatically unwrap the pub/sub envelope for messages
    sub.on = (event: SubscriptionEventType, fn: SubscriptionHandler): Subscription => {
      if (event === 'message') {
        const unwrapper = (data: any) => {
          if (data && typeof data === 'object' && 'payload' in data) {
            fn(data.payload);
          } else {
            fn(data);
          }
        };
        return originalOn(event, unwrapper);
      }
      return originalOn(event, fn);
    };

    return sub;
  }

  // ===========================================================================
  // Orchestrator -- Service orchestration (up/down)
  // ===========================================================================

  /**
   * Bring services UP (optionally filtered by harbor).
   */
  async up(harbor?: string): Promise<Record<string, unknown>> {
    return this._request('POST', '/orchestrator/up', { harbor }) as Promise<Record<string, unknown>>;
  }

  /**
   * Bring services DOWN (optionally filtered by harbor).
   */
  async down(harbor?: string): Promise<Record<string, unknown>> {
    return this._request('POST', '/orchestrator/down', { harbor }) as Promise<Record<string, unknown>>;
  }

  // ──────────────────────────────────────────────────────────────
  // Changelog (hierarchical change tracking by identity)
  // ──────────────────────────────────────────────────────────────

  /**
   * Add a changelog entry for an identity.
   */
  async addChangelog(options: AddChangelogOptions): Promise<AddChangelogResponse> {
    return this._request('POST', '/changelog', options as unknown as Record<string, unknown>) as Promise<AddChangelogResponse>;
  }

  /**
   * List changelog entries.
   */
  async listChangelog(options: ListChangelogOptions = {}): Promise<ListChangelogResponse> {
    const params = new URLSearchParams();
    if (options.limit) params.append('limit', String(options.limit));
    if (options.since) params.append('since', String(options.since));
    const qs = params.toString() ? '?' + params.toString() : '';
    return this._request('GET', `/changelog${qs}`) as Promise<ListChangelogResponse>;
  }

  /**
   * Get a specific changelog entry by numeric ID.
   */
  async getChangelog(id: number): Promise<{ success: boolean; entry: ChangelogEntry }> {
    return this._request('GET', `/changelog/${id}`) as Promise<{ success: boolean; entry: ChangelogEntry }>;
  }

  /**
   * List changelog entries for a specific identity.
   */
  async listChangelogByIdentity(identity: string, options: { limit?: number } = {}): Promise<ListChangelogResponse> {
    const params = new URLSearchParams();
    if (options.limit) params.append('limit', String(options.limit));
    const qs = params.toString() ? '?' + params.toString() : '';
    return this._request('GET', `/changelog/${encodeURIComponent(identity)}${qs}`) as Promise<ListChangelogResponse>;
  }

  /**
   * List changelog entries for an identity including ancestor entries (tree view).
   */
  async listChangelogTree(identity: string, options: { limit?: number } = {}): Promise<ListChangelogResponse> {
    const params = new URLSearchParams();
    params.append('tree', 'true');
    if (options.limit) params.append('limit', String(options.limit));
    const qs = '?' + params.toString();
    return this._request('GET', `/changelog/${encodeURIComponent(identity)}${qs}`) as Promise<ListChangelogResponse>;
  }

  /**
   * List changelog entries for a specific session.
   */
  async listChangelogBySession(sessionId: string): Promise<ListChangelogResponse> {
    return this._request('GET', `/changelog/session/${encodeURIComponent(sessionId)}`) as Promise<ListChangelogResponse>;
  }

  /**
   * List changelog entries created by a specific agent.
   */
  async listChangelogByAgent(agentId: string, options: { limit?: number } = {}): Promise<{ success: boolean; agentId: string; entries: ChangelogEntry[]; count: number }> {
    const params = new URLSearchParams();
    if (options.limit) params.append('limit', String(options.limit));
    const qs = params.toString() ? '?' + params.toString() : '';
    return this._request('GET', `/changelog/agent/${encodeURIComponent(agentId)}${qs}`) as Promise<{ success: boolean; agentId: string; entries: ChangelogEntry[]; count: number }>;
  }

  /**
   * List all identities that have changelog entries.
   */
  async changelogIdentities(): Promise<ChangelogIdentitiesResponse> {
    return this._request('GET', '/changelog/identities') as Promise<ChangelogIdentitiesResponse>;
  }

  // ===========================================================================
  // DNS
  // ===========================================================================

  /**
   * Register a DNS record for a service identity.
   * Maps a semantic identity to a .local hostname.
   */
  async dnsRegister(identity: string, options: DnsRegisterOptions): Promise<DnsRegisterResponse> {
    return this._request('POST', `/dns/${encodeURIComponent(identity)}`, options as unknown as Record<string, unknown>) as Promise<DnsRegisterResponse>;
  }

  /**
   * Unregister a DNS record by identity.
   */
  async dnsUnregister(identity: string): Promise<DnsUnregisterResponse> {
    return this._request('DELETE', `/dns/${encodeURIComponent(identity)}`) as Promise<DnsUnregisterResponse>;
  }

  /**
   * List DNS records, optionally filtered by pattern.
   */
  async dnsList(options: DnsListOptions = {}): Promise<DnsListResponse> {
    const params = new URLSearchParams();
    if (options.pattern) params.set('pattern', options.pattern);
    if (options.limit) params.set('limit', String(options.limit));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this._request('GET', `/dns${qs}`) as Promise<DnsListResponse>;
  }

  /**
   * Get a DNS record by identity.
   */
  async dnsGet(identity: string): Promise<DnsGetResponse> {
    return this._request('GET', `/dns/${encodeURIComponent(identity)}`) as Promise<DnsGetResponse>;
  }

  /**
   * Remove stale DNS records (for identities with no active service).
   */
  async dnsCleanup(): Promise<DnsCleanupResponse> {
    return this._request('POST', '/dns/cleanup') as Promise<DnsCleanupResponse>;
  }

  /**
   * Get DNS system status (record count, bonjour availability).
   */
  async dnsStatus(): Promise<DnsStatusResponse> {
    return this._request('GET', '/dns/status') as Promise<DnsStatusResponse>;
  }

  /**
   * Initialize the /etc/hosts managed section for DNS resolution.
   */
  async dnsSetup(): Promise<DnsSetupResponse> {
    return this._request('POST', '/dns/setup') as Promise<DnsSetupResponse>;
  }

  /**
   * Remove the /etc/hosts managed section.
   */
  async dnsTeardown(): Promise<DnsTeardownResponse> {
    return this._request('POST', '/dns/teardown') as Promise<DnsTeardownResponse>;
  }

  /**
   * Rebuild /etc/hosts from the DNS registry.
   */
  async dnsSync(): Promise<DnsSyncResponse> {
    return this._request('POST', '/dns/sync') as Promise<DnsSyncResponse>;
  }

  /**
   * Get DNS resolver status (hosts file setup, entry count).
   */
  async dnsResolverStatus(): Promise<DnsResolverStatusResponse> {
    return this._request('GET', '/dns/resolver') as Promise<DnsResolverStatusResponse>;
  }

  /** Alias for dnsUnregister (remove a DNS record). */
  async dnsRemove(identity: string): Promise<DnsUnregisterResponse> {
    return this.dnsUnregister(identity);
  }

  /** Alias for dnsResolverStatus (get resolver config). */
  async dnsResolver(): Promise<DnsResolverStatusResponse> {
    return this.dnsResolverStatus();
  }

  // ===========================================================================
  // Spawn -- AI Agent Launcher
  // ===========================================================================

  /**
   * Launch an AI agent with the given spec.
   * Requires a backend that passes readiness and exact-telemetry preflight.
   * Auto-wires PD coordination (agent registration, session, heartbeat, done).
   *
   * @example
   * const result = await pd.spawn({
   *   backend: 'cloudflare',
   *   model: '@cf/qwen/qwen3-30b-a3b-fp8',
   *   identity: 'myapp:coder',
   *   budgetUsd: 2.5,
   *   task: 'Write a hello world in TypeScript',
   * });
   * console.log(result.output);
   */
  async spawn(spec: SpawnSpec): Promise<SpawnResult> {
    return this._request('POST', '/spawn', spec as unknown as Record<string, unknown>) as Promise<SpawnResult>;
  }

  /**
   * List all active (and recently completed) spawned agents.
   */
  async listSpawned(): Promise<ListSpawnedResponse> {
    return this._request('GET', '/spawn') as Promise<ListSpawnedResponse>;
  }

  /**
   * Kill a running spawned agent by ID.
   */
  async killSpawned(agentId: string): Promise<KillSpawnedResponse> {
    return this._request('DELETE', `/spawn/${encodeURIComponent(agentId)}`) as Promise<KillSpawnedResponse>;
  }

  /**
   * App-Native Development Cockpit — read the project's roadmap markdown
   * into typed mission cards (work-queue intake). The list does not mutate
   * any state. Use cockpitMissionDetail / cockpitMissionPlan for the rest
   * of the cockpit's read surface.
   */
  async cockpitMissions(options: {
    projectDir?: string;
    status?: CockpitMissionStatus[];
    limit?: number;
  } = {}): Promise<CockpitMissionsResponse> {
    const params = new URLSearchParams();
    if (options.projectDir) params.set('projectDir', options.projectDir);
    if (options.status && options.status.length > 0) {
      params.set('status', options.status.join(','));
    }
    if (typeof options.limit === 'number' && options.limit > 0) {
      params.set('limit', String(options.limit));
    }
    const suffix = params.toString();
    return this._request(
      'GET',
      suffix ? `/cockpit/missions?${suffix}` : '/cockpit/missions',
    ) as Promise<CockpitMissionsResponse>;
  }

  // Harbors -- Named Permission Namespaces

  async createHarbor(name: string, options: CreateHarborOptions = {}): Promise<HarborResponse> {
    return this._request('POST', '/harbors', { name, ...options }) as Promise<HarborResponse>;
  }

  async listHarbors(): Promise<ListHarborsResponse> {
    return this._request('GET', '/harbors') as Promise<ListHarborsResponse>;
  }

  async getHarbor(name: string): Promise<HarborResponse> {
    return this._request('GET', `/harbors/${encodeURIComponent(name)}`) as Promise<HarborResponse>;
  }

  async destroyHarbor(name: string): Promise<DestroyHarborResponse> {
    return this._request('DELETE', `/harbors/${encodeURIComponent(name)}`) as Promise<DestroyHarborResponse>;
  }

  async enterHarbor(name: string, agentId: string, options: EnterHarborOptions = {}): Promise<HarborResponse> {
    return this._request('POST', `/harbors/${encodeURIComponent(name)}/enter`, { agentId, ...options }) as Promise<HarborResponse>;
  }

  async leaveHarbor(name: string, agentId: string): Promise<LeaveHarborResponse> {
    return this._request('POST', `/harbors/${encodeURIComponent(name)}/leave`, { agentId }) as Promise<LeaveHarborResponse>;
  }

  async harborMemberships(agentId: string): Promise<ListHarborsResponse> {
    return this._request('GET', `/harbors/agent/${encodeURIComponent(agentId)}`) as Promise<ListHarborsResponse>;
  }

  // ===========================================================================
  // Bonds / Wallets / Fleet Panic — FleetControl hardening (Track 1b)
  // ===========================================================================

  async listBonds(filter?: { project?: string; state?: string; limit?: number }): Promise<BondRecord[]> {
    const params = new URLSearchParams();
    if (filter?.project) params.set('project', filter.project);
    if (filter?.state) params.set('state', filter.state);
    if (filter?.limit != null) params.set('limit', String(filter.limit));
    const qs = params.toString() ? `?${params}` : '';
    const data = (await this._request('GET', `/bonds${qs}`)) as { bonds?: BondRecord[] } | BondRecord[];
    if (Array.isArray(data)) return data;
    return data.bonds || [];
  }

  async getBond(id: number): Promise<BondRecord | null> {
    try {
      const data = (await this._request('GET', `/bonds/${id}`)) as { bond?: BondRecord } | BondRecord;
      return (data as { bond?: BondRecord }).bond || (data as BondRecord) || null;
    } catch (err) {
      if (err instanceof PortDaddyError && err.status === 404) return null;
      throw err;
    }
  }

  async slashBond(id: number, portion: number, reason: string): Promise<{ ok: boolean; bond: BondRecord }> {
    return this._request('POST', `/bonds/${id}/slash`, { portion, reason }) as Promise<{ ok: boolean; bond: BondRecord }>;
  }

  async listWallets(): Promise<WalletRow[]> {
    const data = (await this._request('GET', '/wallets')) as { wallets?: WalletRow[] } | WalletRow[];
    if (Array.isArray(data)) return data;
    return data.wallets || [];
  }

  async getWallet(project: string): Promise<WalletRow | null> {
    try {
      const data = (await this._request('GET', `/wallets/${encodeURIComponent(project)}`)) as
        | { wallet?: WalletRow }
        | WalletRow;
      return (data as { wallet?: WalletRow }).wallet || (data as WalletRow) || null;
    } catch (err) {
      if (err instanceof PortDaddyError && err.status === 404) return null;
      throw err;
    }
  }

  async topUpWallet(project: string, usd: number): Promise<WalletRow> {
    const data = (await this._request(
      'POST',
      `/wallets/${encodeURIComponent(project)}/top-up`,
      { usd },
    )) as { wallet?: WalletRow } | WalletRow;
    return (data as { wallet?: WalletRow }).wallet || (data as WalletRow);
  }

  async getPanicStatus(): Promise<PanicStatus> {
    return this._request('GET', '/fleet/panic') as Promise<PanicStatus>;
  }

  async armPanic(reason: string, confirm?: boolean): Promise<PanicStatus & { pendingConfirmation?: boolean }> {
    return this._request('POST', '/fleet/panic', { reason, confirm: !!confirm }) as Promise<
      PanicStatus & { pendingConfirmation?: boolean }
    >;
  }

  async disarmPanic(reason: string): Promise<PanicStatus> {
    return this._request('POST', '/fleet/unpanic', { reason }) as Promise<PanicStatus>;
  }

  // ===========================================================================
  // Pheromone -- Stigmergic ambient signals
  // ===========================================================================

  /**
   * Spray a pheromone signal onto an entity.
   * Signals are numeric (0-1) and decay over time on read.
   *
   * @example
   * await pd.pheromoneSpray('services', 'myapp:api', 'urgency', 0.8);
   */
  async pheromoneSpray(table: string, id: string, key: string, strength: number): Promise<PheromoneSprayResponse> {
    // Fast path: binary IPC fire-and-forget
    const ipc = this._getIpc();
    if (ipc && ipc.state === 'ready') {
      ipc.spray(table, id, key, strength);
      return { success: true, table, id, key, strength, pheromones: { [key]: strength } };
    }

    return this._request('POST', '/pheromone/spray', { table, id, key, strength }) as Promise<PheromoneSprayResponse>;
  }

  /**
   * Sniff (read) pheromone values for an entity.
   * Applies read-time decay — values decrease each time you read them.
   *
   * @example
   * const { pheromones } = await pd.pheromoneSniff('services', 'myapp:api');
   * console.log(pheromones); // { urgency: 0.72, staleness: 0.15 }
   */
  async pheromoneSniff(table: string, id: string): Promise<PheromoneSniffResponse> {
    return this._request('GET', `/pheromone/${encodeURIComponent(table)}/${encodeURIComponent(id)}`) as Promise<PheromoneSniffResponse>;
  }

  /**
   * List all non-zero pheromone trails across all tracked entities.
   */
  async pheromoneList(): Promise<PheromoneListResponse> {
    return this._request('GET', '/pheromone') as Promise<PheromoneListResponse>;
  }

  /**
   * Get file heat map — aggregates session file claims into per-file
   * contention scores with recency-weighted decay.
   *
   * @example
   * const { files, directories, summary } = await pd.fileHeatMap('src/');
   * console.log(summary.hottestFile); // "src/auth.ts"
   */
  async fileHeatMap(pathPrefix?: string, depth?: number): Promise<FileHeatMapResponse> {
    const params = new URLSearchParams();
    if (pathPrefix) params.set('path', pathPrefix);
    if (depth !== undefined) params.set('depth', String(depth));
    const qs = params.toString() ? '?' + params.toString() : '';
    return this._request('GET', `/pheromone/files${qs}`) as Promise<FileHeatMapResponse>;
  }

  // ===========================================================================
  // Arbiter -- Runtime invariant enforcement
  // ===========================================================================

  /**
   * Get Arbiter status: active rules, violation count, uptime.
   *
   * @example
   * const status = await pd.arbiterStatus();
   * console.log(status.rules); // ['PID_SQUATTING', 'CAP_ESCALATION', ...]
   */
  async arbiterStatus(): Promise<ArbiterStatusResponse> {
    return this._request('GET', '/arbiter/status') as Promise<ArbiterStatusResponse>;
  }

  /**
   * List recorded invariant violations.
   */
  async arbiterViolations(options: { limit?: number; offset?: number } = {}): Promise<ArbiterViolationsResponse> {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    const qs = params.toString() ? '?' + params.toString() : '';
    return this._request('GET', `/arbiter/violations${qs}`) as Promise<ArbiterViolationsResponse>;
  }

  /**
   * Inject a test violation (for demos and paper verification).
   * Valid names: PID_SQUATTING, CAP_ESCALATION, NOTE_MONOTONICITY,
   *              ESCROW_POSITIVE, LOCK_OWNER_VALID, HEARTBEAT_FRESHNESS
   */
  async arbiterTestInvariant(name: string): Promise<ArbiterTestResponse> {
    return this._request('POST', `/arbiter/test-invariant/${encodeURIComponent(name)}`) as Promise<ArbiterTestResponse>;
  }

  // ===========================================================================
  // Tuple Space -- Linda-style coordination primitives
  // ===========================================================================

  /**
   * Write a tuple into the tuple space (Linda `out`).
   *
   * @example
   * await pd.tupleOut(['task', 'build', { priority: 1 }], { harbor: 'myapp', writtenBy: 'agent-1' });
   */
  async tupleOut(
    fields: unknown[],
    options: { harbor?: string; writtenBy?: string; ttlMs?: number } = {}
  ): Promise<TupleOutResponse> {
    const ipcResult = await this._requestViaIpc<TupleOutResponse & { error?: string; code?: string }>(
      IpcAction.TUPLE_OUT,
      {
        fields,
        harbor: options.harbor,
        writtenBy: options.writtenBy,
        ttlMs: options.ttlMs,
      },
    );
    if (ipcResult) {
      if (ipcResult.success === false) {
        this._throwIpcParityError(ipcResult, 'Failed to write tuple', 400);
      }
      return ipcResult;
    }

    return this._request('POST', '/tuples', {
      fields,
      harbor: options.harbor,
      writtenBy: options.writtenBy,
      ttlMs: options.ttlMs,
    }) as Promise<TupleOutResponse>;
  }

  /**
   * Read (non-destructive) tuples matching a pattern (Linda `rd`).
   * Use `null` in pattern positions as wildcards.
   *
   * @example
   * const { tuples } = await pd.tupleRd(['task', null], { harbor: 'myapp', limit: 10 });
   */
  async tupleRd(
    pattern: unknown[],
    options: { harbor?: string; limit?: number } = {}
  ): Promise<TupleRdResponse> {
    const ipcResult = await this._requestViaIpc<TupleRdResponse & { error?: string }>(
      IpcAction.TUPLE_RD,
      {
        pattern,
        harbor: options.harbor,
        limit: options.limit,
      },
      { performative: Performative.QUERY_REF },
    );
    if (ipcResult) {
      if (ipcResult.success === false) {
        this._throwIpcParityError(ipcResult, 'Failed to read tuples', 400);
      }
      return ipcResult;
    }

    const params = new URLSearchParams();
    params.set('pattern', JSON.stringify(pattern));
    if (options.harbor) params.set('harbor', options.harbor);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    return this._request('GET', `/tuples?${params.toString()}`) as Promise<TupleRdResponse>;
  }

  /**
   * Take (destructive read) tuples matching a pattern (Linda `in`).
   * Matched tuples are removed from the space.
   *
   * @example
   * const { taken } = await pd.tupleIn(['task', null], { harbor: 'myapp', limit: 1 });
   */
  async tupleIn(
    pattern: unknown[],
    options: { harbor?: string; limit?: number } = {}
  ): Promise<TupleInResponse> {
    const ipcResult = await this._requestViaIpc<TupleInResponse & { error?: string }>(
      IpcAction.TUPLE_IN,
      {
        pattern,
        harbor: options.harbor,
        limit: options.limit,
      },
    );
    if (ipcResult) {
      if (ipcResult.success === false) {
        this._throwIpcParityError(ipcResult, 'Failed to take tuples', 400);
      }
      return ipcResult;
    }

    return this._request('DELETE', '/tuples', {
      pattern,
      harbor: options.harbor,
      limit: options.limit,
    }) as Promise<TupleInResponse>;
  }

  /**
   * Poll for the next matching tuple after a cursor.
   * This is the tuple-space equivalent of message long-polling.
   */
  async tuplePoll(
    pattern: unknown[],
    options: { harbor?: string; afterId?: number; limit?: number } = {}
  ): Promise<{ success: boolean; tuple: TupleEntry | null; lastId: number }> {
    const ipcResult = await this._requestViaIpc<{ success: boolean; tuple: TupleEntry | null; lastId: number; error?: string }>(
      IpcAction.TUPLE_POLL,
      {
        pattern,
        harbor: options.harbor,
        afterId: options.afterId,
        limit: options.limit,
      },
      { performative: Performative.QUERY_REF },
    );
    if (ipcResult) {
      if (ipcResult.success === false) {
        this._throwIpcParityError(ipcResult, 'Failed to poll tuples', 400);
      }
      return ipcResult;
    }

    const params = new URLSearchParams();
    params.set('pattern', JSON.stringify(pattern));
    if (options.harbor) params.set('harbor', options.harbor);
    if (options.afterId !== undefined) params.set('after', String(options.afterId));
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    return this._request('GET', `/tuples/poll?${params.toString()}`) as Promise<{ success: boolean; tuple: TupleEntry | null; lastId: number }>;
  }

  /**
   * Scan all tuples in the space, optionally filtered by harbor.
   *
   * @example
   * const { tuples, count } = await pd.tupleScan('myapp');
   */
  async tupleScan(harbor?: string): Promise<TupleScanResponse> {
    const ipcResult = await this._requestViaIpc<TupleScanResponse & { error?: string }>(
      IpcAction.TUPLE_SCAN,
      { harbor },
      { performative: Performative.QUERY_REF },
    );
    if (ipcResult) {
      if (ipcResult.success === false) {
        this._throwIpcParityError(ipcResult, 'Failed to scan tuples', 400);
      }
      return ipcResult;
    }

    const params = new URLSearchParams();
    if (harbor) params.set('harbor', harbor);
    const qs = params.toString() ? '?' + params.toString() : '';
    return this._request('GET', `/tuples/scan${qs}`) as Promise<TupleScanResponse>;
  }

  /**
   * Count tuples in the space, optionally filtered by harbor.
   *
   * @example
   * const { count } = await pd.tupleCount('myapp');
   */
  async tupleCount(harbor?: string): Promise<TupleCountResponse> {
    const ipcResult = await this._requestViaIpc<TupleCountResponse & { error?: string }>(
      IpcAction.TUPLE_COUNT,
      { harbor },
      { performative: Performative.QUERY_REF },
    );
    if (ipcResult) {
      if (ipcResult.success === false) {
        this._throwIpcParityError(ipcResult, 'Failed to count tuples', 400);
      }
      return ipcResult;
    }

    const params = new URLSearchParams();
    if (harbor) params.set('harbor', harbor);
    const qs = params.toString() ? '?' + params.toString() : '';
    return this._request('GET', `/tuples/count${qs}`) as Promise<TupleCountResponse>;
  }

  /**
   * Destroy the IPC connection (if active). Call on process exit.
   */
  destroyIpc(): void {
    if (this._ipc) {
      this._ipc.destroy();
      this._ipc = null;
    }
  }
}

// =============================================================================
// DNS types
// =============================================================================

interface DnsRecord {
  identity: string;
  hostname: string;
  port: number;
  createdAt: number;
  updatedAt: number;
}

interface DnsRegisterOptions {
  port: number;
  hostname?: string;
}

interface DnsRegisterResponse {
  success: boolean;
  identity: string;
  hostname: string;
  port: number;
  updated: boolean;
  bonjourAdvertised: boolean;
}

interface DnsUnregisterResponse {
  success: boolean;
  identity: string;
  hostname: string;
}

interface DnsListOptions {
  pattern?: string;
  limit?: number;
}

interface DnsListResponse {
  success: boolean;
  records: DnsRecord[];
  count: number;
}

interface DnsGetResponse {
  success: boolean;
  record: DnsRecord;
}

interface DnsCleanupResponse {
  success: boolean;
  cleaned: number;
}

interface DnsStatusResponse {
  success: boolean;
  bonjourAvailable: boolean;
  recordCount: number;
}

interface DnsSetupResponse {
  success: boolean;
  alreadySetUp?: boolean;
}

interface DnsTeardownResponse {
  success: boolean;
  wasSetUp: boolean;
}

interface DnsSyncResponse {
  success: boolean;
  entries: number;
}

interface DnsResolverStatusResponse {
  configured: boolean;
  isSetUp?: boolean;
  hostsFilePath?: string;
  entries?: number;
  fileExists?: boolean;
}

// =============================================================================
// Sugar types
// =============================================================================

interface BeginSugarOptions {
  lifecycle: 'durable' | 'ephemeral';
  agentId?: string;
  name?: string;
  identity?: string;
  type?: string;
  files?: string[];
  force?: boolean;
  metadata?: Record<string, unknown>;
  worktree?: Record<string, unknown>;
  requireLinkedWorktree?: boolean;
  allowMainWorktree?: boolean;
  /**
   * Idempotency key for this logical begin (UUID v4 / ULID, 16..128 URL-safe
   * chars). Send the same key on every retry of the same begin; the daemon
   * replays the original session for a known key. Auto-generated when omitted.
   */
  idempotencyKey?: string;
}

interface BeginSugarResponse {
  success: boolean;
  /** True when this response replays a begin the daemon had already committed. */
  replayed?: boolean;
  agentId: string;
  agentName?: string;
  name?: string;
  sessionId: string;
  identity: string | null;
  purpose: string;
  lifecycle: 'durable' | 'ephemeral';
  agentRegistered: boolean;
  sessionStarted: boolean;
  fileClaims?: string[];
  fileConflicts?: Array<{ filePath: string; sessionId: string }>;
  salvageHint?: string;
  /** The minted ADR-0040 principal this begin verified or minted (#8877). */
  actorId?: string;
  /** Plaintext soul credential, returned ONCE when this begin minted. */
  credential?: string;
  /** The daemon's identity verdict stamped on the session record. */
  actorIdentity?: { verified: true; actorId: string; soulClass: string };
}

interface DoneSugarOptions {
  agentId?: string;
  sessionId?: string;
  status?: string;
  /** Deprecated public flag; the daemon now rejects it without an internal action-scoped capability. */
  skipOriginCheck?: boolean;
  skipOriginCheckReason?: string;
  noPr?: boolean;
  subtask?: boolean;
  forceIncomplete?: boolean;
  forceIncompleteReason?: string;
}

interface DoneSugarResponse {
  success: boolean;
  agentId: string | null;
  sessionId: string;
  sessionStatus: string;
  agentUnregistered: boolean;
  notesCount: number;
  finalNote: boolean;
  releasedFiles?: string[];
  error?: string;
  code?: string;
  hint?: string;
  remainingActiveSessions?: number;
  candidates?: Array<{
    sessionId: string;
    worktreeId: string | null;
    status?: string | null;
    lifecycle?: 'durable' | 'ephemeral';
  }>;
}

interface WhoamiSugarResponse {
  success: boolean;
  active: boolean;
  agentId?: string;
  agentName?: string | null;
  name?: string | null;
  sessionId?: string;
  sessionName?: string | null;
  purpose?: string;
  identity?: string | null;
  phase?: string;
  files?: string[];
  noteCount?: number;
  startedAt?: number;
  duration?: number;
  // Rent-at-claim (S3): roadmap link / sidequest opt-out on the session record.
  roadmapLink?: string | null;
  sidequestReason?: string | null;
  hint?: string;
  error?: string;
  code?: string;
  dormant?: boolean;
  resumable?: boolean;
  state?: string;
  lifecycle?: 'durable' | 'ephemeral';
  status?: string;
  worktreeId?: string | null;
  candidates?: Array<{
    sessionId: string;
    worktreeId: string | null;
    status?: string | null;
    lifecycle?: 'durable' | 'ephemeral';
  }>;
  localContext?: {
    agentId: string;
    sessionId: string;
    agentName?: string | null;
    sessionName?: string | null;
    startedAt?: number;
    purpose?: string;
    identity?: string | null;
    contextSlot?: string;
  };
}

// ──────────────────────────────────────────────────────────────
// Inbox interfaces
// ──────────────────────────────────────────────────────────────

interface InboxMessage {
  id: number;
  agentId: string;
  from: string | null;
  content: string;
  type: string;
  read: boolean;
  createdAt: number;
}

interface InboxListOptions {
  unreadOnly?: boolean;
  limit?: number;
  since?: number;
}

interface InboxSendResponse {
  success: boolean;
  messageId: number;
  agentId: string;
}

interface InboxListResponse {
  success: boolean;
  messages: InboxMessage[];
  count: number;
}

interface InboxStatsResponse {
  success: boolean;
  total: number;
  unread: number;
}

interface InboxMarkReadResponse {
  success: boolean;
  marked?: number;
}

interface InboxClearResponse {
  success: boolean;
  deleted: number;
}

// ──────────────────────────────────────────────────────────────
// Changelog interfaces
// ──────────────────────────────────────────────────────────────

interface ChangelogEntry {
  id: number;
  identity: string;
  sessionId: string | null;
  agentId: string | null;
  type: string;
  summary: string;
  description: string | null;
  createdAt: number;
}

interface AddChangelogOptions {
  identity: string;
  summary: string;
  type?: 'feature' | 'fix' | 'refactor' | 'docs' | 'chore' | 'breaking';
  description?: string;
  sessionId?: string;
  agentId?: string;
}

interface AddChangelogResponse {
  success: boolean;
  id: number;
  identity: string;
  ancestors: string[];
}

interface ListChangelogOptions {
  limit?: number;
  since?: number;
}

interface ListChangelogResponse {
  success: boolean;
  entries: ChangelogEntry[];
  count: number;
}

interface ChangelogIdentitiesResponse {
  success: boolean;
  identities: string[];
  count: number;
}

// =============================================================================
// Spawn types
// =============================================================================

export type BackendOverrideSource = 'none' | 'env' | 'persisted' | 'preflight';

interface SpawnSpec {
  backend: 'ollama' | 'lmstudio' | 'claude' | 'claude-cli' | 'gemini' | 'cloudflare' | 'openai' | 'groq' | 'deepseek' | 'xai' | 'codex' | 'aider' | 'custom' | 'cli:claude-code' | 'cli:codex' | 'cli:agy' | 'cli:gemini' | 'cli:groq' | 'cli:grok';
  name?: string;
  model?: string;
  requestedBackend?: SpawnSpec['backend'];
  requestedModel?: string;
  backendOverrideSource?: BackendOverrideSource;
  modelTier?: 'low' | 'mid' | 'high';
  identity: string;
  budgetUsd: number;
  purpose?: string;
  task: string;
  files?: string[];
  /** Existing absolute directory; required for local agents. API-only projectless runs may omit it. No daemon-cwd default. */
  workdir?: string;
  env?: Record<string, string>;
  timeout?: number;
  allowedTools?: string;
  maxTokens?: number;
}

interface SpawnResult {
  success: boolean;
  agentId: string;
  name?: string;
  backend: SpawnSpec['backend'];
  model: string;
  requestedBackend?: SpawnSpec['backend'];
  effectiveBackend?: SpawnSpec['backend'];
  requestedModel?: string;
  effectiveModel?: string;
  backendOverrideSource?: BackendOverrideSource;
  status: 'running' | 'completed' | 'failed' | 'killed' | 'over_budget';
  output: string | null;
  error: string | null;
  telemetry: {
    inputTokens: number;
    cachedInputTokens?: number;
    outputTokens: number;
    costUsd: number;
    rateMode: 'exact';
  } | null;
  startedAt: number;
  completedAt: number | null;
}

interface SpawnedAgent {
  agentId: string;
  name?: string;
  backend: SpawnSpec['backend'];
  model: string;
  requestedBackend?: SpawnSpec['backend'];
  effectiveBackend?: SpawnSpec['backend'];
  requestedModel?: string;
  effectiveModel?: string;
  backendOverrideSource?: BackendOverrideSource;
  status: 'running' | 'completed' | 'failed' | 'killed' | 'over_budget';
  identity: string | null;
  purpose: string | null;
  startedAt: number;
  completedAt: number | null;
}

interface ListSpawnedResponse {
  success: boolean;
  agents: SpawnedAgent[];
  count: number;
}

interface KillSpawnedResponse {
  success: boolean;
  agentId: string;
  message: string;
}

// =============================================================================
// Cockpit types
// =============================================================================

/**
 * Cockpit mission status. Mirrors the daemon's `RoadmapStatus` 1:1 since
 * cockpit reads roadmap_items directly post-Slice-C. The previous 9-bucket
 * enum (closed/blocked/drifting/stalled/mostly-resolved/mostly-committed/
 * uncommitted/in-flight/unknown) was derived by regex over markdown tags;
 * that derivation was never authoritative and is gone.
 */
export type CockpitMissionStatus = 'now' | 'backlog' | 'parked' | 'merge' | 'done';

export interface CockpitMissionCard {
  id: string;
  title: string;
  status: CockpitMissionStatus;
  source: string;
  sourceAnchor: string;
  summary: string;
  evidence: string[];
  files: string[];
  updatedAt: number;
}

export interface CockpitMissionIntake {
  projectDir: string;
  sources: string[];
  missing: string[];
  /**
   * Source files present on disk that produced zero mission cards.
   * Optional for back-compat with daemons that don't surface this field.
   */
  sourcesWithNoCards?: string[];
  missions: CockpitMissionCard[];
  generatedAt: number;
}

export interface CockpitMissionsResponse {
  success: boolean;
  /**
   * Present on 2xx success responses. Absent when the route returns an
   * error (4xx/5xx); in that case `success` is false and `error` carries
   * the reason. Callers must guard before destructuring.
   */
  intake?: CockpitMissionIntake;
  count?: number;
  error?: string;
}

// =============================================================================
// Harbor types
// =============================================================================

interface HarborMemberEntry {
  agentId: string;
  identity: string | null;
  capabilities: string[];
  joinedAt: number;
}

interface HarborEntry {
  name: string;
  capabilities: string[];
  channels: string[];
  agentPatterns: string[];
  members: HarborMemberEntry[];
  createdAt: number;
  expiresAt: number | null;
  metadata: Record<string, unknown> | null;
}

interface CreateHarborOptions {
  capabilities?: string[];
  channels?: string[];
  agentPatterns?: string[];
  expiresIn?: number;
  metadata?: Record<string, unknown>;
}

interface EnterHarborOptions {
  identity?: string;
  capabilities?: string[];
}

interface HarborResponse {
  success: boolean;
  harbor?: HarborEntry;
  harborCard?: string;
  error?: string;
}

interface ListHarborsResponse {
  success: boolean;
  harbors: HarborEntry[];
  count: number;
}

interface DestroyHarborResponse {
  success: boolean;
  error?: string;
}

interface LeaveHarborResponse {
  success: boolean;
  error?: string;
}

// =============================================================================
// Pheromone types
// =============================================================================

interface PheromoneSprayResponse {
  success: boolean;
  table: string;
  id: string;
  key: string;
  strength: number;
  pheromones: Record<string, number>;
}

interface PheromoneSniffResponse {
  success: boolean;
  table: string;
  id: string;
  pheromones: Record<string, number>;
}

interface PheromoneTrail {
  table: string;
  id: string;
  pheromones: Record<string, number>;
}

interface PheromoneListResponse {
  success: boolean;
  count: number;
  pheromones: PheromoneTrail[];
}

interface FileHeatEntry {
  path: string;
  heat: number;
  activeClaims: number;
  totalClaims: number;
  lastActivity: string | null;
  agents: string[];
  conflict: boolean;
}

interface DirHeatEntry {
  path: string;
  heat: number;
  fileCount: number;
  conflictCount: number;
}

interface FileHeatMapResponse {
  success: boolean;
  files: FileHeatEntry[];
  directories: DirHeatEntry[];
  summary: {
    totalFiles: number;
    activeConflicts: number;
    hottestFile: string | null;
    hottestDir: string | null;
  };
}

// =============================================================================
// Arbiter types
// =============================================================================

interface ArbiterViolation {
  rule: string;
  severity: string;
  message: string;
  timestamp: number;
  details?: Record<string, unknown>;
}

interface ArbiterStatusResponse {
  success: boolean;
  active: boolean;
  rules: string[];
  ruleCount: number;
  violationCount: number;
  uptime: number;
  strictMode: boolean;
}

interface ArbiterViolationsResponse {
  success: boolean;
  violations: ArbiterViolation[];
  count: number;
  total: number;
}

interface ArbiterTestResponse {
  success: boolean;
  violation: ArbiterViolation;
}

// =============================================================================
// Tuple Space types
// =============================================================================

interface TupleEntry {
  id: number;
  harbor: string | null;
  fields: unknown[];
  writtenBy: string | null;
  createdAt: number;
  expiresAt: number | null;
}

interface TupleOutResponse {
  success: boolean;
  tuple: TupleEntry;
}

interface TupleRdResponse {
  success: boolean;
  tuples: TupleEntry[];
  count: number;
}

interface TupleInResponse {
  success: boolean;
  taken: TupleEntry[];
  count: number;
}

interface TupleScanResponse {
  success: boolean;
  tuples: TupleEntry[];
  count: number;
}

interface TupleCountResponse {
  success: boolean;
  count: number;
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
  DnsRegisterOptions,
  DnsRegisterResponse,
  DnsUnregisterResponse,
  DnsListOptions,
  DnsListResponse,
  DnsGetResponse,
  DnsCleanupResponse,
  DnsStatusResponse,
  DnsSetupResponse,
  DnsTeardownResponse,
  DnsSyncResponse,
  DnsResolverStatusResponse,
  DnsRecord,
  BeginSugarOptions,
  BeginSugarResponse,
  DoneSugarOptions,
  DoneSugarResponse,
  WhoamiSugarResponse,
  InboxMessage,
  InboxListOptions,
  InboxSendResponse,
  InboxListResponse,
  InboxStatsResponse,
  InboxMarkReadResponse,
  InboxClearResponse,
  ChangelogEntry,
  AddChangelogOptions,
  AddChangelogResponse,
  ListChangelogOptions,
  ListChangelogResponse,
  ChangelogIdentitiesResponse,
  SpawnSpec,
  SpawnResult,
  SpawnedAgent,
  ListSpawnedResponse,
  KillSpawnedResponse,
  HarborMemberEntry,
  HarborEntry,
  CreateHarborOptions,
  EnterHarborOptions,
  HarborResponse,
  ListHarborsResponse,
  DestroyHarborResponse,
  LeaveHarborResponse,
  PheromoneSprayResponse,
  PheromoneSniffResponse,
  PheromoneTrail,
  PheromoneListResponse,
  FileHeatEntry,
  DirHeatEntry,
  FileHeatMapResponse,
  ArbiterViolation,
  ArbiterStatusResponse,
  ArbiterViolationsResponse,
  ArbiterTestResponse,
  TupleEntry,
  TupleOutResponse,
  TupleRdResponse,
  TupleInResponse,
  TupleScanResponse,
  TupleCountResponse,
};
export default PortDaddy;
