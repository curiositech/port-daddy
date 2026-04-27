import { execFileSync } from 'node:child_process';
import { statfsSync } from 'node:fs';
import os from 'node:os';

export type ResourceStatus = 'calm' | 'busy' | 'hot' | 'critical';
export type ResourceConfidence = 'measured' | 'estimated' | 'partial';

export interface ResourceProcessRow {
  pid: number;
  ppid: number;
  rssBytes: number;
  cpuPercent: number;
  command: string;
  args: string;
}

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

interface ResourceGovernanceOptions {
  repoRoot: string;
  startedAt?: number;
  historyLimit?: number;
  readProcessTable?: () => ResourceProcessRow[];
  statDisk?: (path: string) => ResourceOverview['machine']['disk'];
  now?: () => number;
}

interface OverviewInput {
  userCap?: number | null;
  fleetStatus?: {
    fleets?: Array<{ running?: boolean; agents?: unknown[] }>;
    totalAgents?: number;
    totalLaunchableAgents?: number;
    launchableAgents?: number;
  } | null;
  activeAgents?: number;
  activePorts?: number;
  dailySpendUsd?: number;
  dailySpawnCount?: number;
  estimatedCostEvents?: number;
}

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const DEFAULT_HISTORY_LIMIT = 96;
const REMOTE_AGENT_MEMORY_ESTIMATE_BYTES = 1.25 * GIB;
const LOCAL_AI_MEMORY_ESTIMATE_BYTES = 6 * GIB;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ratioStatus(ratio: number): ResourceStatus {
  if (ratio >= 0.95) return 'critical';
  if (ratio >= 0.85) return 'hot';
  if (ratio >= 0.7) return 'busy';
  return 'calm';
}

function countStatus(value: number, limit: number): ResourceStatus {
  if (limit <= 0) return 'calm';
  return ratioStatus(value / limit);
}

function bytesToProcessRss(kb: string): number {
  const parsed = Number(kb);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 1024) : 0;
}

export function readProcessTable(): ResourceProcessRow[] {
  try {
    const output = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,pcpu=,comm=,args='], {
      encoding: 'utf8',
      timeout: 1000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+([0-9.]+)\s+(\S+)\s*(.*)$/);
        if (!match) return null;
        return {
          pid: Number(match[1]),
          ppid: Number(match[2]),
          rssBytes: bytesToProcessRss(match[3]),
          cpuPercent: Number(match[4]) || 0,
          command: match[5],
          args: match[6] ?? '',
        } satisfies ResourceProcessRow;
      })
      .filter((row): row is ResourceProcessRow => !!row);
  } catch {
    return [];
  }
}

export function statDisk(path: string): ResourceOverview['machine']['disk'] {
  try {
    const stats = statfsSync(path);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    const usedRatio = totalBytes > 0 ? usedBytes / totalBytes : 0;
    return {
      path,
      totalBytes,
      freeBytes,
      usedBytes,
      usedRatio,
      status: ratioStatus(usedRatio),
    };
  } catch {
    return null;
  }
}

function rowText(row: ResourceProcessRow): string {
  return `${row.command} ${row.args}`.toLowerCase();
}

function isPortDaddyProcess(row: ResourceProcessRow): boolean {
  const text = rowText(row);
  return row.pid === process.pid ||
    text.includes('port-daddy') ||
    text.includes('/pd ') ||
    text.includes('server.ts');
}

function isRendererProcess(row: ResourceProcessRow): boolean {
  const text = rowText(row);
  return text.includes('fleetbar') ||
    text.includes('fleet-config-ui') ||
    text.includes('vite') ||
    text.includes('webkit') ||
    text.includes('electron');
}

function isLocalAiProcess(row: ResourceProcessRow): boolean {
  const text = rowText(row);
  return text.includes('ollama') ||
    text.includes('llama.cpp') ||
    text.includes('llamafile') ||
    text.includes('vllm') ||
    text.includes('mlx_lm') ||
    text.includes('stable-diffusion') ||
    text.includes('comfyui');
}

function isAgentBackendProcess(row: ResourceProcessRow): boolean {
  const text = rowText(row);
  return text.includes('codex') ||
    text.includes('claude') ||
    text.includes('gemini') ||
    text.includes('aider') ||
    text.includes('opencode');
}

function sumRss(rows: ResourceProcessRow[]): number {
  return rows.reduce((total, row) => total + row.rssBytes, 0);
}

function sumCpu(rows: ResourceProcessRow[]): number {
  return +rows.reduce((total, row) => total + row.cpuPercent, 0).toFixed(1);
}

function percent(value: number, limit: number | null): number | null {
  if (!limit || limit <= 0) return null;
  return clamp((value / limit) * 100, 0, 999);
}

function processBucketStatus(rows: ResourceProcessRow[], memoryTotal: number, warnBytes: number): ResourceStatus {
  const rss = sumRss(rows);
  const cpu = sumCpu(rows);
  if (rss > warnBytes * 2 || cpu > 250) return 'hot';
  if (rss > warnBytes || cpu > 120) return 'busy';
  if (memoryTotal > 0 && rss / memoryTotal > 0.25) return 'hot';
  return 'calm';
}

function estimateSuggestedConcurrentSpawns(input: {
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  localAiRssBytes: number;
  loadAverage1m: number | null;
  cpuCount: number;
}): number {
  const osReserve = Math.max(2 * GIB, input.totalMemoryBytes * 0.18);
  const localAiReserve = input.localAiRssBytes > 0 ? LOCAL_AI_MEMORY_ESTIMATE_BYTES : 0;
  const headroom = Math.max(0, input.freeMemoryBytes - osReserve - localAiReserve);
  const memoryBound = Math.floor(headroom / REMOTE_AGENT_MEMORY_ESTIMATE_BYTES);
  const loadRatio = input.loadAverage1m === null || input.cpuCount <= 0 ? 0 : input.loadAverage1m / input.cpuCount;
  const cpuBound = loadRatio > 0.9
    ? 1
    : loadRatio > 0.7
      ? Math.max(1, Math.floor(input.cpuCount / 3))
      : Math.max(2, Math.floor(input.cpuCount / 2));
  return clamp(Math.min(memoryBound, cpuBound), 1, 12);
}

function compactRows(rows: ResourceProcessRow[]): ResourceProcessRow[] {
  return rows
    .slice()
    .sort((a, b) => b.rssBytes - a.rssBytes)
    .slice(0, 8);
}

export function createResourceGovernance(options: ResourceGovernanceOptions) {
  const now = options.now ?? Date.now;
  const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  const readProcesses = options.readProcessTable ?? readProcessTable;
  const readDisk = options.statDisk ?? statDisk;
  const startedAt = options.startedAt ?? now();
  const history: ResourceSample[] = [];

  function remember(sample: ResourceSample): ResourceSample[] {
    history.push(sample);
    while (history.length > historyLimit) history.shift();
    return history.slice();
  }

  function overview(input: OverviewInput = {}): ResourceOverview {
    const generatedAt = now();
    const memoryTotal = os.totalmem();
    const memoryFree = os.freemem();
    const memoryUsed = Math.max(0, memoryTotal - memoryFree);
    const memoryUsedRatio = memoryTotal > 0 ? memoryUsed / memoryTotal : 0;
    const disk = readDisk(options.repoRoot);
    const loadAverage1m = os.loadavg()[0] ?? null;
    const cpuCount = os.cpus().length;
    const processRows = readProcesses();
    const portDaddyRows = processRows.filter(isPortDaddyProcess);
    const rendererRows = processRows.filter((row) => isRendererProcess(row) && !isPortDaddyProcess(row));
    const localAiRows = processRows.filter(isLocalAiProcess);
    const backendRows = processRows.filter((row) => isAgentBackendProcess(row) && !isPortDaddyProcess(row));
    const processMemory = process.memoryUsage();
    const selfRow = portDaddyRows.find((row) => row.pid === process.pid);
    const portDaddyRss = sumRss(portDaddyRows) || processMemory.rss;
    const rendererRss = sumRss(rendererRows);
    const localAiRss = sumRss(localAiRows);
    const activeAgents = input.activeAgents ?? input.fleetStatus?.totalAgents ?? 0;
    const totalAgents = input.fleetStatus?.totalAgents ?? activeAgents;
    const launchableAgents = input.fleetStatus?.totalLaunchableAgents ?? input.fleetStatus?.launchableAgents ?? 0;
    const activePorts = input.activePorts ?? 0;
    const runningProjects = input.fleetStatus?.fleets?.filter((fleet) => fleet.running).length ?? 0;
    const dailySpendUsd = input.dailySpendUsd ?? 0;
    const dailySpawnCount = input.dailySpawnCount ?? 0;
    const estimatedEvents = input.estimatedCostEvents ?? 0;
    const suggestedConcurrentSpawns = estimateSuggestedConcurrentSpawns({
      totalMemoryBytes: memoryTotal,
      freeMemoryBytes: memoryFree,
      localAiRssBytes: localAiRss,
      loadAverage1m,
      cpuCount,
    });
    const userCap = typeof input.userCap === 'number' && Number.isFinite(input.userCap) && input.userCap > 0
      ? Math.floor(input.userCap)
      : null;
    const safeToAskForMore =
      userCap !== null &&
      suggestedConcurrentSpawns > userCap &&
      memoryUsedRatio < 0.72 &&
      (disk?.usedRatio ?? 0) < 0.85 &&
      (loadAverage1m === null || loadAverage1m / Math.max(1, cpuCount) < 0.75);

    const buckets: ResourceBucket[] = [
      {
        id: 'memory',
        label: 'System Memory',
        plainLabel: 'room for apps and agents',
        value: memoryUsed,
        limit: memoryTotal,
        unit: 'bytes',
        percent: percent(memoryUsed, memoryTotal),
        status: ratioStatus(memoryUsedRatio),
        confidence: 'measured',
        summary: memoryUsedRatio < 0.7 ? 'Comfortable memory headroom.' : 'Memory is getting tight.',
        includes: ['macOS/app memory', 'agent processes', 'local AI runtimes', 'Port Daddy daemon'],
      },
      {
        id: 'disk',
        label: 'Disk Space',
        plainLabel: 'workspace and logs',
        value: disk?.usedBytes ?? 0,
        limit: disk?.totalBytes ?? null,
        unit: 'bytes',
        percent: disk ? percent(disk.usedBytes, disk.totalBytes) : null,
        status: disk?.status ?? 'busy',
        confidence: disk ? 'measured' : 'partial',
        summary: disk ? 'Measured filesystem capacity for this repo.' : 'Disk capacity was not available.',
        includes: ['repos', 'SQLite state', 'logs', 'generated UI/build artifacts'],
      },
      {
        id: 'port-daddy',
        label: 'Port Daddy',
        plainLabel: 'the control plane itself',
        value: portDaddyRss,
        limit: Math.max(768 * MIB, memoryTotal * 0.08),
        unit: 'bytes',
        percent: percent(portDaddyRss, Math.max(768 * MIB, memoryTotal * 0.08)),
        status: processBucketStatus(portDaddyRows, memoryTotal, 512 * MIB),
        confidence: portDaddyRows.length > 0 ? 'measured' : 'estimated',
        summary: 'Daemon, CLI helpers, IPC, fleet bookkeeping, and route serving.',
        includes: ['daemon process', 'IPC/socket handling', 'fleet state', 'dashboard SSE'],
      },
      {
        id: 'network',
        label: 'Networking',
        plainLabel: 'local ports and streams',
        value: activePorts,
        limit: 64,
        unit: 'count',
        percent: percent(activePorts, 64),
        status: countStatus(activePorts, 64),
        confidence: 'partial',
        summary: 'Tracks local service/daemon port pressure; byte-level network cost is not enforced yet.',
        includes: ['claimed ports', 'daemon TCP/socket traffic', 'SSE/webview streams'],
      },
      {
        id: 'rendering',
        label: 'Tool Rendering',
        plainLabel: 'Fleet UI and webviews',
        value: rendererRss,
        limit: Math.max(512 * MIB, memoryTotal * 0.06),
        unit: 'bytes',
        percent: percent(rendererRss, Math.max(512 * MIB, memoryTotal * 0.06)),
        status: processBucketStatus(rendererRows, memoryTotal, 384 * MIB),
        confidence: rendererRows.length > 0 ? 'measured' : 'partial',
        summary: 'Visible tool surfaces, Vite/WebView renderers, and embedded control-plane views.',
        includes: ['FleetBar', 'fleet-config-ui', 'browser/WebKit/Electron renderers'],
      },
      {
        id: 'local-ai',
        label: 'Local AI Compute',
        plainLabel: 'models running on this computer',
        value: localAiRss,
        limit: localAiRows.length > 0 ? Math.max(LOCAL_AI_MEMORY_ESTIMATE_BYTES, memoryTotal * 0.35) : Math.max(2 * GIB, memoryTotal * 0.12),
        unit: 'bytes',
        percent: percent(localAiRss, localAiRows.length > 0 ? Math.max(LOCAL_AI_MEMORY_ESTIMATE_BYTES, memoryTotal * 0.35) : Math.max(2 * GIB, memoryTotal * 0.12)),
        status: processBucketStatus(localAiRows, memoryTotal, 2 * GIB),
        confidence: localAiRows.length > 0 ? 'measured' : 'partial',
        summary: localAiRows.length > 0 ? 'Local model runtimes are active.' : 'No obvious local model runtime is active.',
        includes: ['Ollama', 'llama.cpp/llamafile', 'vLLM/MLX/ComfyUI when detected'],
      },
      {
        id: 'fleet',
        label: 'Fleet Pressure',
        plainLabel: 'agent launch concurrency',
        value: activeAgents,
        limit: userCap ?? Math.max(suggestedConcurrentSpawns, activeAgents, 1),
        unit: 'count',
        percent: percent(activeAgents, userCap ?? Math.max(suggestedConcurrentSpawns, activeAgents, 1)),
        status: countStatus(activeAgents, userCap ?? Math.max(suggestedConcurrentSpawns, activeAgents, 1)),
        confidence: 'measured',
        summary: userCap ? `Current project cap is ${userCap}.` : 'No project concurrency cap was supplied to this view.',
        includes: ['configured agents', 'active fleet runners', 'spawn backpressure'],
      },
    ];

    const sample = {
      ts: generatedAt,
      memoryUsedRatio,
      diskUsedRatio: disk?.usedRatio ?? null,
      portDaddyRssBytes: portDaddyRss,
      activeAgents,
      activePorts,
      rendererRssBytes: rendererRss,
      localAiRssBytes: localAiRss,
      dailySpendUsd,
    };

    const escalation = safeToAskForMore
      ? {
          recommended: true,
          title: 'This computer looks comfortable enough to ask for more.',
          body: `Measured headroom supports asking before raising the fleet cap from ${userCap} to ${suggestedConcurrentSpawns}.`,
          suggestedCap: suggestedConcurrentSpawns,
        }
      : {
          recommended: false,
          title: 'Stay within the current cap.',
          body: userCap
            ? 'Measured activity does not justify asking for a higher cap right now.'
            : 'Add a project cap before Port Daddy can recommend an escalation.',
          suggestedCap: suggestedConcurrentSpawns,
        };

    return {
      success: true,
      generatedAt,
      windowMs: 86_400_000,
      machine: {
        platform: os.platform(),
        arch: os.arch(),
        cpuCount,
        loadAverage1m,
        uptimeMs: Math.round(os.uptime() * 1000),
        memory: {
          totalBytes: memoryTotal,
          freeBytes: memoryFree,
          usedBytes: memoryUsed,
          usedRatio: memoryUsedRatio,
          status: ratioStatus(memoryUsedRatio),
        },
        disk,
      },
      portDaddy: {
        pid: process.pid,
        uptimeMs: Math.max(0, generatedAt - startedAt),
        rssBytes: portDaddyRss,
        heapUsedBytes: processMemory.heapUsed,
        externalBytes: processMemory.external,
        cpuPercent: selfRow?.cpuPercent ?? null,
      },
      processes: {
        portDaddy: compactRows(portDaddyRows),
        renderers: compactRows(rendererRows),
        localAi: compactRows(localAiRows),
        agentBackends: compactRows(backendRows),
      },
      fleet: {
        activeAgents,
        totalAgents,
        launchableAgents,
        activePorts,
        runningProjects,
      },
      cost: {
        dailySpendUsd,
        dailySpawnCount,
        estimatedEvents,
      },
      buckets,
      history: remember(sample),
      policy: {
        mode: 'observe',
        userCap,
        suggestedConcurrentSpawns,
        safeToAskForMore,
        escalation,
      },
    };
  }

  return { overview };
}

export type ResourceGovernance = ReturnType<typeof createResourceGovernance>;
