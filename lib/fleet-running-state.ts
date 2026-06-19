/**
 * Fleet Running State Resolver
 *
 * Two parallel models for "is this fleet running?" live in the codebase:
 *
 *   1. **Standalone fork**: `pd fleet up` spawns a child process and writes
 *      `.portdaddy/fleet-state.json` with the PID. The CLI checks the file
 *      and verifies the PID is alive.
 *
 *   2. **Daemon-supervised**: the always-on daemon's fleet supervisor
 *      registers the project. The truth lives at `GET /fleet`.
 *
 * `pd fleet status` historically only checked (1) and reported "not running"
 * whenever the daemon owned the fleet — a flat-out lie when 8 agents were
 * armed and waiting on triggers. This resolver consults both sources and
 * returns a single state with the source attribution so the CLI / FleetBar
 * can render an honest label like
 *   "running (daemon-supervised) · 7 armed · 1 idle"
 *
 * Kept pure so unit tests can pass in synthetic state-file readers and
 * fleet-status payloads without touching the filesystem or the network.
 */

export type FleetRunningSource = 'standalone-fork' | 'daemon-supervised' | 'none';

export interface FleetAgentCounts {
  total: number;
  armed: number;
  running: number;
  paused: number;
  failed: number;
  idle: number;
}

export interface FleetRunningState {
  running: boolean;
  source: FleetRunningSource;
  /** Standalone-fork PID, when applicable. */
  pid: number | null;
  /** Fleet name (from state file or daemon record). */
  name: string | null;
  /** Project directory the daemon associates with this fleet, when applicable. */
  projectDir: string | null;
  /** Per-status agent counts (daemon-supervised only). */
  agentCounts: FleetAgentCounts | null;
}

/**
 * Shape of the `GET /fleet` payload that this resolver cares about. Mirrored
 * loosely from lib/fleet-daemon.ts; deliberately tolerant so unit tests can
 * inject simplified fixtures.
 */
export interface FleetStatusPayload {
  running?: boolean;
  fleets?: Array<{
    project?: string;
    projectDir?: string;
    running?: boolean;
    agents?: Array<{
      status?: string;
      running?: boolean;
      paused?: boolean;
    }>;
  }>;
}

export interface StandaloneStateReader {
  readState(cwd: string): { pid: number; name?: string } | null;
  /** Returns true if the PID is alive. */
  isPidAlive(pid: number): boolean;
}

export interface ResolveFleetRunningStateOptions {
  cwd: string;
  /** Synchronous standalone-fork state-file reader. */
  standalone: StandaloneStateReader;
  /** `/fleet` payload from the daemon. Pass null when the daemon is unreachable. */
  daemonFleetStatus: FleetStatusPayload | null;
}

function countAgents(agents: Array<{ status?: string; running?: boolean; paused?: boolean }> = []): FleetAgentCounts {
  const counts: FleetAgentCounts = { total: 0, armed: 0, running: 0, paused: 0, failed: 0, idle: 0 };
  for (const agent of agents) {
    counts.total += 1;
    const s = (agent.status || '').toLowerCase();
    if (s === 'armed') counts.armed += 1;
    else if (s === 'running' || agent.running) counts.running += 1;
    else if (s === 'paused' || agent.paused) counts.paused += 1;
    else if (s === 'failed') counts.failed += 1;
    else counts.idle += 1;
  }
  return counts;
}

/**
 * Resolve the authoritative fleet-running state for the current working
 * directory. Daemon-supervised wins when both sources claim ownership; in
 * practice that case only happens during a brief migration window.
 */
export function resolveFleetRunningState(opts: ResolveFleetRunningStateOptions): FleetRunningState {
  const standaloneRecord = opts.standalone.readState(opts.cwd);
  const standaloneRunning =
    standaloneRecord !== null && opts.standalone.isPidAlive(standaloneRecord.pid);

  // Find a daemon-supervised fleet whose projectDir matches cwd.
  const daemonFleet = opts.daemonFleetStatus?.fleets?.find(
    (f) => f.projectDir === opts.cwd && f.running !== false,
  );

  if (daemonFleet) {
    return {
      running: true,
      source: 'daemon-supervised',
      pid: null,
      name: daemonFleet.project ?? null,
      projectDir: daemonFleet.projectDir ?? null,
      agentCounts: countAgents(daemonFleet.agents),
    };
  }

  if (standaloneRunning && standaloneRecord) {
    return {
      running: true,
      source: 'standalone-fork',
      pid: standaloneRecord.pid,
      name: standaloneRecord.name ?? null,
      projectDir: opts.cwd,
      agentCounts: null,
    };
  }

  return {
    running: false,
    source: 'none',
    pid: null,
    name: null,
    projectDir: null,
    agentCounts: null,
  };
}

/**
 * Human-readable one-liner for the resolved state. Format chosen so it
 * reads correctly at terminal widths and inside the FleetBar popover.
 */
export function describeFleetRunningState(state: FleetRunningState): string {
  if (!state.running) return 'not running';
  if (state.source === 'standalone-fork') {
    return `running (standalone, PID ${state.pid})`;
  }
  const c = state.agentCounts;
  if (!c) return 'running (daemon-supervised)';
  const parts: string[] = [];
  if (c.running > 0) parts.push(`${c.running} running`);
  if (c.armed > 0) parts.push(`${c.armed} armed`);
  if (c.paused > 0) parts.push(`${c.paused} paused`);
  if (c.failed > 0) parts.push(`${c.failed} failed`);
  if (c.idle > 0) parts.push(`${c.idle} idle`);
  const detail = parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
  return `running (daemon-supervised)${detail}`;
}
