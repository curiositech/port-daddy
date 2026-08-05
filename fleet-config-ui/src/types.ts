// ─── Types mirroring fleet-engine.ts ──────────────────────────────────────────

export interface FleetLimits {
  maxConcurrentSpawns?: number;
  maxSpawnsPerHour?: number;
  budgetUsdPerDay?: number;
}

export type ResourceStatus = 'calm' | 'busy' | 'hot' | 'critical';
export type ResourceConfidence = 'measured' | 'estimated' | 'partial';

export interface ResourceSample {
  ts: number;
  memoryUsedRatio: number;
  diskUsedRatio: number | null;
  portDaddyRssBytes: number;
  activeAgents: number;
  activePorts: number;
  rendererRssBytes: number;
  localAiRssBytes: number;
  dailySpendUsd: number;
}

export interface ResourceProcessRow {
  pid: number;
  ppid: number;
  rssBytes: number;
  cpuPercent: number;
  command: string;
  args: string;
}

export interface ResourceBucket {
  id: 'memory' | 'disk' | 'port-daddy' | 'network' | 'rendering' | 'local-ai' | 'fleet';
  label: string;
  plainLabel: string;
  value: number;
  limit: number | null;
  unit: 'bytes' | 'percent' | 'count' | 'usd' | 'cpu';
  percent: number | null;
  status: ResourceStatus;
  confidence: ResourceConfidence;
  summary: string;
  includes: string[];
}

export interface ResourceOverview {
  success: true;
  generatedAt: number;
  windowMs: number;
  machine: {
    platform: string;
    arch: string;
    cpuCount: number;
    loadAverage1m: number | null;
    uptimeMs: number;
    memory: {
      totalBytes: number;
      freeBytes: number;
      usedBytes: number;
      usedRatio: number;
      status: ResourceStatus;
    };
    disk: {
      path: string;
      totalBytes: number;
      freeBytes: number;
      usedBytes: number;
      usedRatio: number;
      status: ResourceStatus;
    } | null;
  };
  portDaddy: {
    pid: number;
    uptimeMs: number;
    rssBytes: number;
    heapUsedBytes: number;
    externalBytes: number;
    cpuPercent: number | null;
  };
  processes: {
    portDaddy: ResourceProcessRow[];
    renderers: ResourceProcessRow[];
    localAi: ResourceProcessRow[];
    agentBackends: ResourceProcessRow[];
  };
  fleet: {
    activeAgents: number;
    totalAgents: number;
    launchableAgents: number;
    activePorts: number;
    runningProjects: number;
  };
  cost: {
    dailySpendUsd: number;
    dailySpawnCount: number;
    estimatedEvents: number;
  };
  buckets: ResourceBucket[];
  history: ResourceSample[];
  policy: {
    mode: 'observe';
    userCap: number | null;
    suggestedConcurrentSpawns: number;
    safeToAskForMore: boolean;
    escalation: {
      recommended: boolean;
      title: string;
      body: string;
      suggestedCap: number;
    };
  };
}

export interface FleetAgent {
  name: string;
  schedule?: string;
  trigger?: string;
  backend: string;
  model?: string;
  prompt: string;
  worktree?: boolean;
  singleton?: boolean;
  respawn?: boolean;
  maxRespawns?: number;
  onSuccess?: string;
  onFailure?: string;
  identity?: string;
  deadlineMs?: number;
  timeout?: number;
  allowedTools?: string;
}

export interface FleetWatcher {
  name: string;
  trigger: string;
  exec: string;
  condition?: string;
  confirm?: boolean;
}

export interface FleetConfig {
  name: string;
  harbor?: string;
  limits?: FleetLimits;
  agents: FleetAgent[];
  watchers: FleetWatcher[];
  channels: Record<string, { description: string; consumers?: string[] }>;
}

export type FleetAgentLifecycleType = 'manual' | 'triggered' | 'scheduled';
export type FleetAgentMailboxStatus = 'running' | 'queued' | 'paused' | 'scheduled' | 'armed' | 'idle';

export interface FleetAgentStatus {
  name: string;
  type: FleetAgentLifecycleType;
  status: FleetAgentMailboxStatus;
  running: boolean;
  paused: boolean;
  uptime: number;
  queueDepth: number;
}

export interface TopologyValidation {
  valid: boolean;
  cycles: string[][];
  warnings: string[];
}

export interface FleetEvent {
  type: 'agent_started' | 'agent_completed' | 'agent_failed' | 'agent_paused' | 'agent_resumed' | 'watcher_started' | 'watcher_triggered' | 'fleet_started' | 'fleet_stopped';
  agent?: string;
  identity?: string;
  project?: string;
  timestamp: number;
  details?: Record<string, unknown>;
}

export interface ActivityEntry {
  id: number;
  timestamp: number;
  type: string;
  agentId: string | null;
  targetId: string | null;
  details: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ChannelMessage {
  id: number;
  channel: string;
  physicalChannel?: string;
  payload: unknown;
  sender: string | null;
  createdAt: number;
}

export type ChannelScope = 'branch' | 'worktree' | 'repo' | 'global';

export interface DeclaredChannel {
  logicalName: string;
  physicalName: string;
  description: string | null;
  aliases: string[];
  scope: ChannelScope;
  projectDir: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
  activeCount: number;
  lastMessage: number | null;
  active: boolean;
  source: 'declared' | 'observed';
}

export interface ChannelDiscoveryEnvelope {
  success: boolean;
  channels: DeclaredChannel[];
}

export interface EnsureChannelInput {
  name: string;
  description?: string | null;
  aliases?: string[];
  scope?: ChannelScope;
  projectDir?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface EnsureChannelResult {
  success: boolean;
  created?: boolean;
  channel: DeclaredChannel;
}

export type FilePreviewLineKind = 'meta' | 'hunk' | 'add' | 'remove' | 'context';

/**
 * One lightweight preview line returned for a touched file hover card.
 */
export interface FilePreviewLine {
  kind: FilePreviewLineKind;
  text: string;
}

/**
 * Preview payload used by FleetBar/control-plane mutation hover cards.
 */
export interface FilePreview {
  requestedPath: string;
  resolvedPath: string;
  displayPath: string;
  source: 'working-tree' | 'staged' | 'untracked' | 'snapshot';
  additions: number;
  deletions: number;
  truncated: boolean;
  lines: FilePreviewLine[];
}

export type CoordinationGuardMode = 'off' | 'warn' | 'enforce';
export type CoordinationGuardAction = 'status' | 'check' | 'enable' | 'install';

export type SetupActionId = 'status' | 'full' | 'mcp-skills' | 'fleetbar' | 'project-init';

export interface SetupOverview {
  success: boolean;
  version: string | null;
  codeHash: string | null;
  setupToken: string;
  platform: string;
  installDir: string;
  currentProcess: {
    execPath: string;
    argv: string[];
  };
  daemon: {
    mode: 'binary' | 'source' | 'unknown';
    launchAgentPath: string;
    launchAgentExists: boolean;
    programArguments: string[] | null;
    binaryCandidate: string;
    binaryCandidateExists: boolean;
    summary: string;
  };
  stableTree: {
    path: string;
    exists: boolean;
    cleanupPolicy: string;
  };
  setupCommand: {
    label: string;
    command: string;
    baseArgs: string[];
  };
  actions: Array<{
    id: SetupActionId;
    label: string;
    mutates: boolean;
  }>;
}

export interface SetupRunResult {
  success: boolean;
  action: SetupActionId;
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface CoordinationGuardOwner {
  sessionId?: string | null;
  agentId?: string | null;
  purpose?: string | null;
  phase?: string | null;
}

export interface CoordinationGuardViolation {
  code: string;
  severity: 'warning' | 'critical';
  message: string;
  file?: string;
  owners?: CoordinationGuardOwner[];
}

export interface CoordinationGuardStatus {
  success: boolean;
  name: string;
  enabled: boolean;
  mode: CoordinationGuardMode;
  requireSession: boolean;
  requireClaims: boolean;
  configPath: string;
  projectDir: string;
}

export interface CoordinationGuardCheck {
  success: boolean;
  passed: boolean;
  shouldBlock: boolean;
  mode: CoordinationGuardMode;
  enabled: boolean;
  files: string[];
  agentId?: string | null;
  sessionId?: string | null;
  violations: CoordinationGuardViolation[];
}

export interface CoordinationGuardEnvelope {
  success: boolean;
  action?: CoordinationGuardAction;
  project?: string | null;
  projectDir: string;
  status: CoordinationGuardStatus;
  check?: CoordinationGuardCheck;
  message?: string;
}

export interface ResolvedChannelTarget {
  logical: string;
  physical: string;
}

export interface StoryNote {
  id: number;
  sessionId: string;
  content: string;
  type: string;
  createdAt: number;
  sessionPurpose?: string;
  agentId?: string | null;
  identityProject?: string | null;
}

export interface TupleEntry {
  id: number;
  harbor: string | null;
  fields: unknown[];
  writtenBy: string | null;
  createdAt: number;
  expiresAt: number | null;
}

export interface GraphEdge {
  id: number;
  scope: string;
  projectDir: string | null;
  sourceType: string;
  sourceId: string;
  edgeType: string;
  targetType: string;
  targetId: string;
  weight: number;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export interface GraphStats {
  total: number;
  scopes: number;
  sources: number;
  targets: number;
  lastUpdated: number | null;
}

export interface Episode {
  id: number;
  projectDir: string | null;
  project: string | null;
  harbor: string | null;
  agentId: string | null;
  episodeType: string;
  title: string;
  summary: string;
  sourceType: string;
  sourceId: string;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryStats {
  total: number;
  sourceTypes: number;
  episodeTypes: number;
  lastUpdated: number | null;
}

export interface RoadmapNextCut {
  slug: string;
  summary: string;
}

export type RoadmapFeedbackStatus = 'now' | 'backlog' | 'parked' | 'merge' | 'unknown' | 'open' | 'harvested' | 'wontfix';
export type RoadmapFeedbackSeverity = 'low' | 'medium' | 'high' | 'critical';
export type RoadmapFeedbackSource = 'agent' | 'human' | 'mcp' | 'cli' | 'unknown';

export interface RoadmapFeedbackEntry {
  slug: string;
  status: RoadmapFeedbackStatus;
  surface: string | null;
  hook: string | null;
  summary?: string | null;
  feedbackId?: string;
  severity?: RoadmapFeedbackSeverity;
  source?: RoadmapFeedbackSource;
  suggested?: string | null;
  droppedBy?: string | null;
  project?: string | null;
  harbor?: string | null;
  at?: number | null;
  harvestedAt?: number | null;
  harvestedIntoSlug?: string | null;
  provenance?: 'markdown' | 'tuple';
}

export interface RoadmapFeedbackSummary {
  total: number;
  open: number;
  harvested: number;
  bySeverity: Record<RoadmapFeedbackSeverity, number>;
  bySurface: Record<string, number>;
}

export interface RoadmapProgress {
  generatedAt: number;
  sources: {
    roadmapPath: string;
    ideasTrovePath: string;
    dogfoodFeedbackPath: string;
    currentWorkPath: string;
    cartographerStatusPath: string;
    feedbackTupleHarbor?: string | null;
    feedbackTupleStatus?: RoadmapFeedbackStatus | 'all';
  };
  freshness: {
    latestUpdateMs: number | null;
    hoursSinceLastUpdate: number | null;
  };
  nextCuts: RoadmapNextCut[];
  ideasNow: RoadmapFeedbackEntry[];
  liveFeedback: RoadmapFeedbackEntry[];
  feedbackSummary: RoadmapFeedbackSummary | null;
  dogfoodFeedback: RoadmapFeedbackEntry[];
  currentWorkExcerpt: string | null;
  cartographerStatusExcerpt: string | null;
  warnings: string[];
}

/**
 * App-Native Development Cockpit — work-queue intake card. Mirrors
 * `lib/cockpit-missions.ts` on the daemon side; the type is duplicated at
 * the UI/API boundary so we don't import from `lib/`.
 */
/**
 * Cockpit mission status. Mirrors the daemon's RoadmapStatus 1:1 since
 * cockpit reads roadmap_items directly post-Slice-C. The previous 9-bucket
 * enum was derived by regex over markdown tags; that derivation was never
 * authoritative and is gone.
 */
export type MissionStatus = 'now' | 'backlog' | 'parked' | 'merge' | 'done';

export interface MissionCard {
  id: string;
  title: string;
  status: MissionStatus;
  source: string;
  sourceAnchor: string;
  summary: string;
  evidence: string[];
  files: string[];
  updatedAt: number;
}

export interface MissionIntake {
  projectDir: string;
  sources: string[];
  missing: string[];
  /**
   * Source files present on disk that produced zero mission cards.
   * Optional for back-compat with daemons that don't surface this field.
   */
  sourcesWithNoCards?: string[];
  missions: MissionCard[];
  generatedAt: number;
}

export type SemanticResolutionDecision = 'seeded' | 'auto' | 'review' | 'reject' | 'error';

/**
 * Recent semantic-resolution decision surfaced in the Fleet UI.
 */
export interface SemanticResolutionEvent {
  id: number;
  projectDir: string | null;
  harbor: string | null;
  sourceType: string;
  sourceId: string;
  rawTerm: string;
  canonicalTerm: string;
  candidateTerm: string | null;
  similarity: number | null;
  decision: SemanticResolutionDecision;
  thresholdAuto: number;
  thresholdReview: number;
  model: string;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

/**
 * Semantic threshold health report used to keep the embedding policy visible.
 */
export interface SemanticResolutionStats {
  model: string;
  autoThreshold: number;
  reviewThreshold: number;
  boundaryMargin: number;
  totalTerms: number;
  totalEvents: number;
  reviewBacklog: number;
  nearAutoBoundary: number;
  nearReviewBoundary: number;
  lastResolvedAt: number | null;
  decisions: Record<SemanticResolutionDecision, number>;
}

export interface FleetProjectStatus {
  project: string;
  projectDir: string;
  running: boolean;
  agents: FleetAgentStatus[];
  watchers: number;
  channels: number;
  startedAt: number;
}

export interface FleetDaemonStatus {
  running: boolean;
  startedAt: number | null;
  fleets: FleetProjectStatus[];
  totalAgents: number;
  totalWatchers: number;
}

export interface ProjectSummary {
  id: string;
  displayName?: string;
  root: string;
  type: string;
  serviceCount: number;
  lastScanned: string;
  createdAt: string;
  frameworks: string[];
  signals?: string[];
  sources?: string[];
  exists?: boolean;
  worktree?: ProjectWorktreeSummary | null;
  running?: boolean;
  configuredAgentCount?: number;
  configuredWatcherCount?: number;
  operatorState?: 'running' | 'ready' | 'blocked' | 'service_only' | 'context_only' | 'missing';
  operatorSummary?: string;
  operatorNextAction?: string;
  fleetConfigStatus?: 'ready' | 'missing_budget' | 'invalid' | 'missing';
  budgetUsdPerDay?: number | null;
  configError?: string | null;
  configWarnings?: string[];
  remediation?: {
    action: 'start_fleet' | 'set_budget' | 'fix_yaml' | 'create_fleet' | 'run_scan';
    title: string;
    detail: string;
    command?: string;
    suggestedBudgetUsdPerDay?: number;
  } | null;
}

export interface ProjectWorktreeSummary {
  id: string;
  name: string;
  branch: string | null;
  isMain: boolean;
  repoKey: string;
  repoRoot: string | null;
  siblingCount: number;
}

export interface BackendInfo {
  id: string;
  name: string;
  models: string[];
  modelTiers?: Partial<Record<'low' | 'mid' | 'high', string>>;
  supported?: boolean;
  launchable?: boolean;
  readinessStatus?: 'ready' | 'needs_setup' | 'manual_check' | 'unknown';
  readinessSummary?: string;
  readinessNextStep?: string;
  credentialKeys?: string[];
  credentialAlternates?: string[];
  setupLinks?: BackendSetupLink[];
  setupCommand?: string;
  setupFiles?: string[];
  restartRequired?: boolean;
}

export interface BackendSetupLink {
  label: string;
  url: string;
  description?: string;
  kind?: 'token_template' | 'docs';
}

export interface BackendSecretSaveResult {
  success: boolean;
  backend?: string;
  savedKeys?: string[];
  encryptedAtRest?: boolean;
  storage?: {
    available: boolean;
    storage?: string;
    encryptedAtRest?: boolean;
    location?: string;
  };
  error?: string;
}

export interface UsageTraceInput {
  timestamp?: number;
  surface: string;
  kind: string;
  name: string;
  category?: string | null;
  agentId?: string | null;
  agentType?: string | null;
  agentModel?: string | null;
  backend?: string | null;
  model?: string | null;
  project?: string | null;
  projectDir?: string | null;
  route?: string | null;
  method?: string | null;
  status?: string | number | null;
  durationMs?: number | null;
  workScope?: 'port_daddy_call' | 'agent_work' | 'other_work' | string | null;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  turns?: number | null;
  toolCalls?: number | null;
  costUsd?: number | null;
  costCurrency?: string | null;
  costIsEstimate?: boolean | null;
  context?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  version?: string | null;
  codeHash?: string | null;
  buildDate?: string | null;
  cwd?: string | null;
  userAgent?: string | null;
}

export interface UsageBuildMeta {
  version: string;
  codeHash: string;
  buildDate: string;
}

export interface UsageBreakdownRow {
  key: string;
  label: string;
  count: number;
  percentage: number;
}

export interface UsageNameRow {
  surface: string;
  kind: string;
  category: string;
  name: string;
  count: number;
  avgDurationMs: number | null;
  lastSeen: number;
}

export interface UsageAgentModelRow {
  agentType: string;
  agentModel: string;
  backend: string;
  model: string;
  surface: string;
  count: number;
  lastSeen: number;
}

export interface UsageCapabilityRow {
  category: string;
  count: number;
  surfaces: Record<string, number>;
  models: Array<{ label: string; count: number }>;
}

export interface UsageAgentCapabilityRow {
  agentType: string;
  agentModel: string;
  backend: string;
  model: string;
  category: string;
  count: number;
}

export interface UsageCostScopeRow {
  scope: string;
  events: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  turns: number;
  toolCalls: number;
  costUsd: number;
  estimatedCostEvents: number;
}

export interface UsageRecentEvent {
  id: number;
  timestamp: number;
  surface: string;
  kind: string;
  name: string;
  category: string;
  agentId: string | null;
  agentType: string | null;
  agentModel: string | null;
  backend: string | null;
  model: string | null;
  project: string | null;
  route: string | null;
  method: string | null;
  status: string | null;
  durationMs: number | null;
  workScope: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  turns: number | null;
  toolCalls: number | null;
  costUsd: number | null;
  costCurrency: string | null;
  costIsEstimate: boolean | null;
  version: string | null;
  codeHash: string | null;
  buildDate: string | null;
  context: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

export interface UsageTelemetrySummary {
  success: true;
  generatedAt: number;
  since: number;
  periodMs: number;
  build: UsageBuildMeta;
  totals: {
    events: number;
    uniqueAgents: number;
    uniqueProjects: number;
    uniqueModels: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    turns: number;
    toolCalls: number;
    costUsd: number;
  };
  costByScope: UsageCostScopeRow[];
  bySurface: UsageBreakdownRow[];
  byKind: UsageBreakdownRow[];
  byCategory: UsageBreakdownRow[];
  topNames: UsageNameRow[];
  agentModels: UsageAgentModelRow[];
  capabilities: UsageCapabilityRow[];
  agentCapabilityMatrix: UsageAgentCapabilityRow[];
  unusedCapabilities: string[];
  recent: UsageRecentEvent[];
}

export interface RegistryAgent {
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
  agentCard: Record<string, unknown> | null;
  skills: string[];
  worktreeId: string | null;
  identity: string | null;
  identityProject: string | null;
  identityStack: string | null;
  identityContext: string | null;
  purpose: string | null;
  status: string;
  readiness: Array<{ name: string; ok: boolean; reason?: string }> | null;
  isReady: boolean;
  progress: string | null;
  healthAssessment: {
    liveness: 'alive' | 'stale' | 'dead';
    graceRemaining: number;
  };
}

export interface InboxMessage {
  id: number;
  agentId: string;
  from: string | null;
  content: unknown;
  contentType?: 'text' | 'json' | 'binary' | string;
  type: string;
  read: boolean;
  readAt?: number | null;
  createdAt: number;
}

export interface InboxStats {
  total: number;
  unread: number;
}

export type VisualTaskKind = 'fix' | 'bug' | 'nit' | 'feedback' | 'question';
export type VisualTaskCaptureMode = 'image' | 'current-page';
export type VisualTaskRegionSpace = 'image' | 'viewport';

export interface VisualTaskRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateSpace: VisualTaskRegionSpace;
}

export interface VisualTaskImageAttachment {
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  width: number | null;
  height: number | null;
}

export interface VisualTaskDomElement {
  selector: string;
  xpath: string;
  tagName: string;
  role: string | null;
  text: string | null;
  bounds: VisualTaskRegion;
}

export interface VisualTaskDomContext {
  url: string;
  title: string | null;
  capturedAt: string;
  selectors: string[];
  elementsInRegion: VisualTaskDomElement[];
}

export interface VisualTaskSubmission {
  schemaVersion: 1;
  type: 'visual-task';
  id: string;
  source: 'fleet-ui';
  project: string | null;
  projectDir: string | null;
  targetAgent: string | null;
  kind: VisualTaskKind;
  title: string;
  description: string;
  pageUrl: string | null;
  captureMode: VisualTaskCaptureMode;
  image: VisualTaskImageAttachment | null;
  region: VisualTaskRegion | null;
  domContext: VisualTaskDomContext | null;
  viewport: {
    width: number;
    height: number;
    devicePixelRatio: number;
  };
  createdAt: string;
}

export interface DispatchProposal {
  id: string;
  slug?: string;
  goal: string;
  state?: string;
}

export interface SalvageAgent {
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

export interface SessionSummary {
  id: string;
  purpose: string;
  status: string;
  phase: string;
  agentId: string | null;
  worktreeId: string | null;
  identityProject: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  metadata: Record<string, unknown> | null;
  notes?: StoryNote[];
}

export interface FileClaim {
  filePath: string;
  sessionId: string;
  purpose: string;
  agentId: string | null;
  phase: string;
  claimedAt: number;
  startLine: number | null;
  endLine: number | null;
  symbol: string | null;
  symbolPath?: string | null;
}

export interface ActiveAgentHarness {
  id: string;
  label: string;
  backend: string | null;
  model: string | null;
  confidence: 'explicit' | 'inferred';
}

export interface ActiveAgentWorktree {
  id: string | null;
  root: string | null;
  branch: string | null;
  name: string | null;
  isMain: boolean | null;
}

export interface ActiveAgentRosterItem {
  id: string;
  label: string;
  purpose: string | null;
  identity: string | null;
  project: string | null;
  status: string | null;
  liveness: string;
  lastHeartbeat: number | null;
  harness: ActiveAgentHarness;
  worktree: ActiveAgentWorktree;
  activeSession: SessionSummary | null;
  sessions: SessionSummary[];
  touchedFiles: FileClaim[];
  control: {
    steeringChannel: string;
    streamUrl: string;
    interruptUrl: string;
    takeoverUrl: string | null;
    controlCenterUrl: string;
  };
}

export interface ActiveAgentRoster {
  success: true;
  generatedAt: number;
  project: string | null;
  count: number;
  agents: ActiveAgentRosterItem[];
}

export interface SpawnedAgent {
  agentId: string;
  backend: string;
  model: string;
  identity?: string | null;
  purpose?: string | null;
  startedAt: number;
  completedAt?: number | null;
  pid?: number;
  status: string;
  output?: string | null;
  error?: string | null;
}

export type OperatorActorState = 'running' | 'idle' | 'salvaged' | 'orphan_reconciled' | 'historical';
export type OperatorActorKind = 'scheduled' | 'triggered' | 'watcher' | 'ad_hoc';

/**
 * Daemon-backed actor lens shared by the control plane and FleetBar.
 *
 * Example:
 * - input: actor payload from `/operator/actors`
 * - output: one logical actor with fused registry/session/salvage/spawn state
 */
export interface OperatorActorEntry {
  id: string;
  label: string;
  purpose: string | null;
  identity: string | null;
  fleetAgentName: string | null;
  inboxTarget: string;
  isConfiguredFleetAgent: boolean;
  actorKind: OperatorActorKind;
  actorState: OperatorActorState;
  actorStateReason: string;
  runtimeStatus: string | null;
  liveness: 'alive' | 'stale' | 'dead' | null;
  lastActivityAt: number | null;
  lastSummary: string | null;
  recentFiles: string[];
  registry: RegistryAgent | null;
  spawned: SpawnedAgent | null;
  salvage: SalvageAgent | null;
  sessions: SessionSummary[];
}

export interface SpawnPreflight {
  launchReady: boolean;
  blockedReasons: string[];
  warnings: string[];
  attempts: Array<{
    attempt: number;
    backend: string | null;
    model: string | null;
    modelTier: string | null;
    readinessStatus: 'ready' | 'needs_setup' | 'manual_check' | 'unknown';
    readinessSummary: string;
    readinessNextStep?: string;
    credentialKeys?: string[];
    credentialAlternates?: string[];
    setupCommand?: string;
    setupFiles?: string[];
    restartRequired?: boolean;
  }>;
  projectName: string | null;
  budget: {
    project: string;
    budgetUsdPerDay: number;
    spentUsd: number;
    remainingUsd: number;
    percentUsed: number;
    overBudget: boolean;
  } | null;
  localExecutionLikely: boolean;
  localExecutionNote?: string;
}

// ─── Operator State (GET /operator/state) ─────────────────────────────────────

export type NeedsYouCode =
  | 'dispatch_review'
  | 'guard_violation'
  | 'budget_ceiling'
  | 'salvage'
  | 'stuck_agent'
  | 'roadmap_now'
  | 'inbox';

export interface NeedsYouItem {
  code: NeedsYouCode;
  label: string;
  action: string;
  priority: number;
  meta?: Record<string, unknown>;
}

export interface CostEvent {
  id: number;
  agentId: string | null;
  project: string | null;
  workScope: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  createdAt: number;
}

export interface BudgetStatus {
  project: string;
  budgetUsdPerDay: number;
  spentUsd: number;
  remainingUsd: number;
  percentUsed: number;
}

export interface CostTotals {
  totalUsd: number;
  spentTodayUsd: number;
  eventCount: number;
}

export interface BudgetSection {
  recentEvents: CostEvent[];
  status: BudgetStatus | null;
  total: CostTotals;
}

export interface DispatchItem {
  id: string | number;
  title: string;
  state: 'awaiting_review' | 'open' | string;
  agentId?: string | null;
  project?: string | null;
  createdAt?: number;
  meta?: Record<string, unknown>;
}

export interface DispatchSection {
  reviewPending: DispatchItem[];
  open: DispatchItem[];
}

export interface OperatorActorRecord {
  id: string;
  label: string;
  state: string;
  summary?: string | null;
  lastActivityAt?: number | null;
}

export interface FleetSignal {
  code: string;
  state: string;
  meaning: string;
}

export interface RoadmapItem {
  id: string | number;
  title: string;
  status: string;
  description?: string | null;
  priority?: number | null;
  phase?: string | null;
}

export interface OperatorState {
  success: true;
  project: string | null;
  projectDir: string | null;
  generatedAt: number;
  actors: {
    actors: OperatorActorRecord[];
    summary: Record<string, number>;
    count: number;
  };
  needsYou: NeedsYouItem[];
  guard: CoordinationGuardStatus & { available: boolean };
  fleetSignal: FleetSignal | null;
  dispatch?: DispatchSection;
  budget?: BudgetSection;
  cockpitMissions?: MissionIntake;
  roadmap?: RoadmapItem[];
}

// ─── Session galaxy ───────────────────────────────────────────────────────────
// Mirrors the daemon GALAXY API CONTRACT (routes/galaxy.ts). Plain interfaces,
// no runtime validation — consumers unwrap defensively (`data.points ?? []`)
// because contract drift against an older daemon fails silently.

export interface GalaxyPoint {
  id: string;                  // fleet_transcripts.id — pass to GET /galaxy/session/:id
  sessionId: string | null;    // fleet_transcripts.session_id (often null for fleet ships)
  agentId: string;             // fleet_transcripts.spawned_agent_id — THE parley party id
  ship: string | null;
  project: string | null;
  identity: string | null;
  purpose: string | null;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  endedAt: number | null;
  tailTokens: number;          // estimated tokens actually embedded (chars/4)
  x: number;                   // t-SNE coord min-max normalized to [0, 1]
  y: number;                   // [0, 1]
  clusterId: number;           // 0..k-1, reindexed by size desc (0 = biggest); always 0 when cluster=false
  snippet: string;             // first 140 chars of the embedded tail (secret-redacted)
  prNumber: number | null;
}

export interface GalaxyCluster {
  id: number;                  // matches GalaxyPoint.clusterId
  label: string;               // top 2-3 MI terms joined with ' · '
  terms: Array<{ term: string; mi: number }>;
  size: number;
  centroid: [number, number];  // in normalized [0,1] map space
}

export interface GalaxyMapResponse {
  success: true;
  computedAt: number;
  // `cluster` is optional/additive: daemon echoes the effective clustering mode
  // back in params; absent on older daemons, in which case treat as clustered.
  params: { windowHours: number; tailTokens: number; minTokens: number; limit: number; project: string | null; cluster?: boolean };
  points: GalaxyPoint[];
  // With cluster=false the daemon returns clusters: [] and every point carries
  // clusterId 0 — render defensively rather than assuming clusters.length > 0.
  clusters: GalaxyCluster[];
  stats: {
    sessionCount: number;
    embeddedNow: number;
    cacheHits: number;
    embeddingCacheHits?: number;
    responseCacheHits?: number;
    elapsedMs: number;
  };
}

export type GalaxyTranscriptRole = 'system' | 'user' | 'assistant' | 'tool' | 'thinking';

export interface GalaxyTranscriptMessage {
  role: GalaxyTranscriptRole;
  content: string;
  // Guaranteed epoch-ms by the daemon going forward, but parsed defensively
  // (older transcripts / partial replays may omit it).
  timestamp?: number | null;
  tool_calls?: Array<{ name: string; args: unknown; result?: unknown }>;
}

export interface GalaxyTranscriptOutput {
  type: string;                // 'pr-comment' | 'issue' | 'draft-pr' | 'commit' | 'noop' | 'message' | 'other'
  url?: string;
  summary: string;
}

// Full lib/transcripts.ts TranscriptEntry shape as serialized by the detail route.
export interface GalaxyTranscriptEntry {
  id: string;
  ship: string;
  session_id: string | null;
  spawned_agent_id: string;
  pr_number?: number | null;
  issue_number?: number | null;
  trigger: string;
  backend: string;
  model: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  started_at: number;
  ended_at?: number | null;
  cost_usd?: number | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  messages: GalaxyTranscriptMessage[];
  outputs: GalaxyTranscriptOutput[];
  error?: string | null;
  project?: string | null;
  identity?: string | null;
}

export interface GalaxySessionDetail {
  transcript: GalaxyTranscriptEntry;
  session: {
    id: string; purpose: string; status: string; phase: string | null;
    agentId: string | null; identityProject: string | null;
    createdAt: number; updatedAt: number; completedAt: number | null;
  } | null;
  // Additive: top-level session bounds guaranteed by the daemon lane going
  // forward. Fall back to transcript.started_at/ended_at when absent (older
  // daemons / partial data) — see resolveSessionTimes in SessionGalaxyPanel.
  startedAt?: number | null;
  endedAt?: number | null;
  notes: Array<{ id: string; content: string; type: string; createdAt: number }>;
  files: Array<{
    filePath: string; startLine: number | null; endLine: number | null;
    symbol: string | null; claimedAt: number; releasedAt: number | null;
    // Additive: absolute path on the machine that ran the session, when the
    // daemon can resolve one. Repo-relative filePath is always present and is
    // what gets copied to the clipboard; absolutePath (when present) upgrades
    // the entry to a vscode://file/ deep link.
    absolutePath?: string | null;
  }>;
  toolUses: Array<{ name: string; args: unknown; at: number }>;
  prs: Array<{ prNumber: number | null; url: string | null; type: string; summary: string }>;
}

export interface GalaxySessionDetailResponse {
  success: true;
  detail: GalaxySessionDetail;
}

export interface GalaxyParleyCallRequest {
  surface: string;      // `galaxy:${top selection-cluster terms, kebab-joined, <=64 chars}`
  reason: string;
  calledBy: 'operator';
  parties: string[];    // deduped GalaxyPoint.agentId values; MUST be >= 2 distinct ids
  trigger: 'operator';
}

// ─── Agent color palette ──────────────────────────────────────────────────────

export const AGENT_COLORS: Record<string, string> = {
  gardener:      '#4CAF50',
  qa:            '#2196F3',
  'test-hunter': '#FF9800',
  documentarian: '#00BCD4',
  simplifier:    '#9C27B0',
  cartographer:  '#FF5722',
  spark:         '#FFC107',
  spider:        '#E91E63',
};

export function agentColor(name: string): string {
  return AGENT_COLORS[name] ?? '#D4C5A9';
}
