import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import type { ChildProcess } from 'node:child_process';

export interface CliChildWaitResult {
  code: number;
  timedOut: boolean;
  spawnErr: string | null;
}

interface ProcessTreeSnapshot {
  pids: number[];
  warning: string | null;
}

interface StdioPeerSnapshot {
  peerIds: Set<string>;
  warning: string | null;
}

interface WaitForCliChildOptions {
  /** Explicit execution deadline. Omit to observe until exit or operator cancellation. */
  timeoutMs?: number;
  killGraceMs: number;
  killCloseDeadlineMs: number;
}

const PROCESS_TREE_POLL_MS = 100;
const PROCESS_TREE_MAX_BUFFER = 1024 * 1024;
const LSOF_MAX_BUFFER = 4 * 1024 * 1024;
const LSOF_SEARCH_DIRS = ['/usr/sbin', '/sbin', '/usr/bin', '/bin'];
const LSOF_SEARCH_PATHS = LSOF_SEARCH_DIRS.map((dir) => `${dir}/lsof`);

let cachedLsofPath: string | null = null;

export function waitForCliChildProcess(
  child: ChildProcess,
  opts: WaitForCliChildOptions,
): Promise<CliChildWaitResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let knownTreePids: number[] = [];
    let processTreeWarning: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let processTreePollTimer: ReturnType<typeof setInterval> | null = null;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    let killCloseDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
    const knownStdioProcTargets = collectChildStdioProcTargets(child);
    const knownStdioPeerIds = new Set<string>();

    const rememberProcessTreeWarning = (warning: string | null): void => {
      if (!processTreeWarning && warning) processTreeWarning = warning;
    };
    const rememberStdioIdentities = (): void => {
      for (const target of collectChildStdioProcTargets(child)) knownStdioProcTargets.add(target);
      if (!needsLsofStdioDiscovery(knownStdioProcTargets)) return;
      const peerSnapshot = collectChildStdioPeerIds(child);
      for (const peerId of peerSnapshot.peerIds) knownStdioPeerIds.add(peerId);
      rememberProcessTreeWarning(peerSnapshot.warning);
    };
    const rememberProcessTree = (includeStdioHolders = false): void => {
      const snapshots = [collectProcessTreePids(child.pid)];
      if (includeStdioHolders) {
        rememberStdioIdentities();
        const stdioHolders = collectStdioHolderPids(child, knownStdioProcTargets, knownStdioPeerIds);
        snapshots.push(stdioHolders);
        for (const holderPid of stdioHolders.pids) {
          snapshots.push(collectProcessTreePids(holderPid));
        }
      }
      const tree = mergeProcessSnapshots(...snapshots);
      rememberProcessTreeWarning(tree.warning);
      knownTreePids = dedupePids([...knownTreePids, ...tree.pids]);
    };

    const settle = (code: number, spawnErr: string | null = null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (processTreePollTimer) clearInterval(processTreePollTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (killCloseDeadlineTimer) clearTimeout(killCloseDeadlineTimer);
      resolve({ code, timedOut, spawnErr });
    };

    child.on('exit', () => {
      rememberProcessTree(timedOut);
    });
    child.on('close', (code) => {
      settle(typeof code === 'number' ? code : -1);
    });
    child.on('error', (err) => {
      settle(-1, err.message);
    });

    rememberStdioIdentities();
    rememberProcessTree();
    processTreePollTimer = setInterval(rememberProcessTree, PROCESS_TREE_POLL_MS);
    processTreePollTimer.unref?.();

    if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        rememberProcessTree(true);
        signalCliProcessTree(child, 'SIGTERM', knownTreePids);
        forceKillTimer = setTimeout(() => {
          rememberProcessTree(true);
          signalCliProcessTree(child, 'SIGKILL', knownTreePids);
          killCloseDeadlineTimer = setTimeout(() => {
            const warningSuffix = processTreeWarning ? ` (${processTreeWarning})` : '';
            settle(-1, `process tree did not close after SIGKILL; transcript may be incomplete${warningSuffix}`);
          }, opts.killCloseDeadlineMs);
          killCloseDeadlineTimer.unref?.();
        }, opts.killGraceMs);
        forceKillTimer.unref?.();
      }, opts.timeoutMs);
      timer.unref?.();
    }
  });
}

function signalCliProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals,
  knownTreePids: readonly number[],
): void {
  const pid = child.pid;
  if (typeof pid === 'number') {
    try {
      process.kill(-pid, signal);
    } catch {
      // Fall back for non-detached, platform-limited, or mocked processes.
    }
  }
  for (const targetPid of knownTreePids) {
    try {
      // Detached survivors may have become process-group leaders by the time
      // timeout cleanup runs. Signal their groups as well as the individual PIDs.
      process.kill(-targetPid, signal);
    } catch {
      // Non-group-leaders and already-exited processes are covered below/best effort.
    }
    try {
      process.kill(targetPid, signal);
    } catch {
      // Best effort; another signal path may already have reaped it.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Best effort; close/error owns the final result.
  }
}

function collectProcessTreePids(rootPid: number | undefined): ProcessTreeSnapshot {
  if (typeof rootPid !== 'number' || rootPid <= 0) return { pids: [], warning: null };
  const descendants = new Map<number, number[]>();
  try {
    const output = childProcess.execFileSync('ps', ['-axo', 'pid=,ppid='], {
      encoding: 'utf8',
      timeout: 1_000,
      maxBuffer: PROCESS_TREE_MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of output.split('\n')) {
      const [pidText, ppidText] = line.trim().split(/\s+/);
      const pid = Number(pidText);
      const ppid = Number(ppidText);
      if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
      const children = descendants.get(ppid) ?? [];
      children.push(pid);
      descendants.set(ppid, children);
    }
  } catch (err) {
    return {
      pids: [rootPid],
      warning: `process tree collection unavailable: ${formatProcessTreeError(err)}`,
    };
  }

  const tree = [rootPid];
  for (let index = 0; index < tree.length; index += 1) {
    for (const childPid of descendants.get(tree[index]) ?? []) {
      if (!tree.includes(childPid)) tree.push(childPid);
    }
  }
  return { pids: tree, warning: null };
}

function collectStdioHolderPids(
  child: ChildProcess,
  knownProcTargets = new Set<string>(),
  knownPeerIds = new Set<string>(),
): ProcessTreeSnapshot {
  const procSnapshot = collectProcFdHolderPids(child, knownProcTargets);
  if (!needsLsofStdioDiscovery(knownProcTargets)) return procSnapshot;
  return mergeProcessSnapshots(procSnapshot, collectLsofStdioHolderPids(child, knownPeerIds));
}

function collectProcFdHolderPids(child: ChildProcess, knownProcTargets = new Set<string>()): ProcessTreeSnapshot {
  if (!fs.existsSync('/proc')) return { pids: [], warning: null };
  const targets = new Set([...knownProcTargets, ...collectChildStdioProcTargets(child)]);
  if (targets.size === 0) return { pids: [], warning: null };
  const pids: number[] = [];
  for (const entry of safeReadDir('/proc')) {
    const pid = Number(entry);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || pid === child.pid) continue;
    for (const fdName of safeReadDir(`/proc/${pid}/fd`)) {
      const fdTarget = safeReadLink(`/proc/${pid}/fd/${fdName}`);
      if (fdTarget && targets.has(fdTarget)) {
        pids.push(pid);
        break;
      }
    }
  }
  return { pids: dedupePids(pids), warning: null };
}

function collectChildStdioProcTargets(child: ChildProcess): Set<string> {
  const targets = new Set<string>();
  if (typeof child.pid === 'number' && child.pid > 0) {
    for (const fd of [1, 2]) {
      const target = safeReadLink(`/proc/${child.pid}/fd/${fd}`);
      if (target) targets.add(target);
    }
  }
  return targets;
}

function needsLsofStdioDiscovery(knownProcTargets: ReadonlySet<string>): boolean {
  return knownProcTargets.size === 0 || !fs.existsSync('/proc');
}

function collectLsofStdioHolderPids(child: ChildProcess, knownPeerIds = new Set<string>()): ProcessTreeSnapshot {
  const peerSnapshot = collectChildStdioPeerIds(child);
  const peerIds = new Set([...knownPeerIds, ...peerSnapshot.peerIds]);
  if (peerIds.size === 0) return { pids: [], warning: peerSnapshot.warning };
  try {
    const output = execLsof(['-nP', '-U'], {
      encoding: 'utf8',
      timeout: 1_000,
      maxBuffer: LSOF_MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pids: number[] = [];
    for (const line of output.split('\n')) {
      const entry = parseLsofUnixTableLine(line);
      if (!entry) continue;
      if (
        entry.pid !== process.pid
        && entry.pid !== child.pid
        && peerIds.has(entry.localEndpoint)
      ) {
        pids.push(entry.pid);
      }
    }
    return { pids: dedupePids(pids), warning: null };
  } catch (err) {
    return {
      pids: [],
      warning: `stdio holder collection unavailable: ${formatProcessTreeError(err)}`,
    };
  }
}

function execLsof(
  args: string[],
  options: childProcess.ExecFileSyncOptionsWithStringEncoding,
): string {
  const candidates = cachedLsofPath
    ? [cachedLsofPath, ...LSOF_SEARCH_PATHS.filter((candidate) => candidate !== cachedLsofPath)]
    : LSOF_SEARCH_PATHS;
  let lastErr: unknown = null;
  for (const candidate of candidates) {
    try {
      const output = childProcess.execFileSync(candidate, args, options);
      cachedLsofPath = candidate;
      return output;
    } catch (err) {
      lastErr = err;
      if (!isExecutableLookupFailure(err)) throw err;
    }
  }
  cachedLsofPath = null;
  throw lastErr ?? new Error(`lsof unavailable in ${LSOF_SEARCH_PATHS.join(':')}`);
}

function isExecutableLookupFailure(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'EACCES' || code === 'ENOTDIR';
}

function safeReadDir(path: string): string[] {
  try {
    return fs.readdirSync(path);
  } catch {
    return [];
  }
}

function safeReadLink(path: string): string | null {
  try {
    return fs.readlinkSync(path);
  } catch {
    return null;
  }
}

function collectChildStdioPeerIds(child: ChildProcess): StdioPeerSnapshot {
  const peerIds = new Set<string>();
  let warning: string | null = null;
  for (const stream of [child.stdout, child.stderr]) {
    const fd = getStreamFd(stream);
    if (fd === null) continue;
    try {
      const output = execLsof(['-nP', '-a', '-p', String(process.pid), `-d${fd}`], {
        encoding: 'utf8',
        timeout: 1_000,
        maxBuffer: PROCESS_TREE_MAX_BUFFER,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      for (const line of output.split('\n')) {
        const entry = parseLsofUnixTableLine(line);
        if (entry?.peerEndpoint) peerIds.add(entry.peerEndpoint);
      }
    } catch (err) {
      warning ??= `stdio peer collection unavailable: ${formatProcessTreeError(err)}`;
    }
  }
  return { peerIds, warning: peerIds.size === 0 ? warning : null };
}

function getStreamFd(stream: ChildProcess['stdout'] | ChildProcess['stderr']): number | null {
  const fd = (stream as unknown as { _handle?: { fd?: unknown } } | null)?._handle?.fd;
  return typeof fd === 'number' && fd >= 0 ? fd : null;
}

function parseLsofUnixTableLine(line: string): { pid: number; localEndpoint: string; peerEndpoint?: string } | null {
  const match = line.match(/^\S+\s+(\d+)\s+\S+\s+\S+\s+unix\s+(0x[0-9a-f]+)\b(.*)$/i);
  if (!match) return null;
  const pid = Number(match[1]);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const peerMatch = match[3].match(/->(0x[0-9a-f]+)/i);
  return {
    pid,
    localEndpoint: match[2].toLowerCase(),
    peerEndpoint: peerMatch?.[1].toLowerCase(),
  };
}

function mergeProcessSnapshots(...snapshots: ProcessTreeSnapshot[]): ProcessTreeSnapshot {
  const pids = dedupePids(snapshots.flatMap((snapshot) => snapshot.pids));
  const warning = snapshots.find((snapshot) => snapshot.warning)?.warning ?? null;
  return { pids, warning };
}

function dedupePids(values: readonly number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))];
}

function formatProcessTreeError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}
