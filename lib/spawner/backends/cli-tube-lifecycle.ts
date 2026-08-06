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
  /**
   * Optional wall-clock deadline (ms) for the CLI invocation, measured from
   * the moment this wait begins. When omitted (or not a finite number), NO
   * termination timer and NO process-tree poller are scheduled — the child
   * is only ever settled by its own `close`/`error` events, so it may run
   * indefinitely while remaining externally observable (stdout/stderr,
   * onStreamLine, tube publish). When set, SIGTERM is sent to the full
   * process tree at the deadline, SIGKILL after `killGraceMs`, and the wait
   * settles (`timedOut: true`) if the tree still hasn't closed within
   * `killCloseDeadlineMs` of the SIGKILL.
   */
  deadlineMs?: number;
  killGraceMs: number;
  killCloseDeadlineMs: number;
}

const PROCESS_TREE_POLL_MS = 100;
const PROCESS_TREE_MAX_BUFFER = 1024 * 1024;
const LSOF_MAX_BUFFER = 4 * 1024 * 1024;
const LSOF_SEARCH_DIRS = ['/usr/sbin', '/sbin', '/usr/bin', '/bin'];
const LSOF_SEARCH_PATHS = LSOF_SEARCH_DIRS.map((dir) => `${dir}/lsof`);
const PROC_SCAN_CONCURRENCY = 32;
const HAS_PROC_FS = fs.existsSync('/proc');

let cachedLsofPath: string | null = null;

export function waitForCliChildProcess(
  child: ChildProcess,
  opts: WaitForCliChildOptions,
): Promise<CliChildWaitResult> {
  return new Promise((resolve) => {
    const hasDeadline = typeof opts.deadlineMs === 'number' && Number.isFinite(opts.deadlineMs);
    let settled = false;
    let timedOut = false;
    let activeTerminationSignal: NodeJS.Signals | null = null;
    let knownTreePids: number[] = typeof child.pid === 'number' && child.pid > 0
      ? [child.pid]
      : [];
    let processTreeWarning: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let processTreePollTimer: ReturnType<typeof setTimeout> | null = null;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    let killCloseDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
    const knownStdioProcTargets = new Set<string>();
    const knownStdioPeerIds = new Set<string>();
    let processTreeScanTail: Promise<void> = Promise.resolve();

    const rememberProcessTreeWarning = (warning: string | null): void => {
      if (!processTreeWarning && warning) processTreeWarning = warning;
    };
    const signalRememberedTree = (): void => {
      if (!settled && activeTerminationSignal) {
        signalCliProcessTree(child, activeTerminationSignal, knownTreePids);
      }
    };
    const rememberStdioIdentitiesAsync = async (): Promise<void> => {
      for (const target of await collectChildStdioProcTargetsAsync(child)) knownStdioProcTargets.add(target);
      if (!needsLsofStdioDiscovery(knownStdioProcTargets)) return;
      const peerSnapshot = await collectChildStdioPeerIdsAsync(child);
      for (const peerId of peerSnapshot.peerIds) knownStdioPeerIds.add(peerId);
      rememberProcessTreeWarning(peerSnapshot.warning);
    };
    const rememberProcessTreeAsync = (includeStdioHolders = false): Promise<void> => {
      const scan = processTreeScanTail.then(async () => {
        if (settled) return;
        const snapshots = [await collectProcessTreePidsAsync(child.pid)];
        if (includeStdioHolders) {
          await rememberStdioIdentitiesAsync();
          const stdioHolders = await collectStdioHolderPidsAsync(
            child,
            knownStdioProcTargets,
            knownStdioPeerIds,
          );
          snapshots.push(stdioHolders);
          snapshots.push(await collectProcessTreePidsAsync(stdioHolders.pids));
        }
        if (settled) return;
        const tree = mergeProcessSnapshots(...snapshots);
        rememberProcessTreeWarning(tree.warning);
        knownTreePids = dedupePids([...knownTreePids, ...tree.pids]);
      });
      processTreeScanTail = scan.catch(() => {});
      return scan;
    };
    const scheduleProcessTreePoll = (): void => {
      if (settled || timedOut) return;
      processTreePollTimer = setTimeout(async () => {
        processTreePollTimer = null;
        if (settled || timedOut) return;
        await rememberProcessTreeAsync();
        signalRememberedTree();
        scheduleProcessTreePoll();
      }, PROCESS_TREE_POLL_MS);
      processTreePollTimer.unref?.();
    };

    const settle = (code: number, spawnErr: string | null = null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (processTreePollTimer) clearTimeout(processTreePollTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (killCloseDeadlineTimer) clearTimeout(killCloseDeadlineTimer);
      resolve({ code, timedOut, spawnErr });
    };

    // No deadline: settle purely off the child's own lifecycle events. Skip
    // all process-tree bookkeeping below — it exists only to feed the kill
    // path, which never fires without a deadline.
    child.on('close', (code) => {
      settle(typeof code === 'number' ? code : -1);
    });
    child.on('error', (err) => {
      settle(-1, err.message);
    });

    if (!hasDeadline) return;

    // Process-table scans can be slow on a busy workstation. Run at most one
    // asynchronous sample at a time and schedule the next only after it
    // finishes; a synchronous setInterval here can queue scans faster than
    // they complete and starve the child's own close/error events.
    void rememberProcessTreeAsync(true).then(() => {
      signalRememberedTree();
      scheduleProcessTreePoll();
    });

    timer = setTimeout(() => {
      timedOut = true;
      activeTerminationSignal = 'SIGTERM';
      signalCliProcessTree(child, 'SIGTERM', knownTreePids);
      void rememberProcessTreeAsync(true).then(() => {
        signalRememberedTree();
      });
      forceKillTimer = setTimeout(() => {
        activeTerminationSignal = 'SIGKILL';
        signalCliProcessTree(child, 'SIGKILL', knownTreePids);
        void rememberProcessTreeAsync(true).then(() => {
          if (settled) return;
          signalRememberedTree();
          killCloseDeadlineTimer = setTimeout(() => {
            const warningSuffix = processTreeWarning ? ` (${processTreeWarning})` : '';
            settle(-1, `process tree did not close after SIGKILL; transcript may be incomplete${warningSuffix}`);
          }, opts.killCloseDeadlineMs);
          killCloseDeadlineTimer.unref?.();
        });
      }, opts.killGraceMs);
      forceKillTimer.unref?.();
    }, opts.deadlineMs);
    timer.unref?.();
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

function collectProcessTreePidsAsync(
  rootPids: number | readonly number[] | undefined,
): Promise<ProcessTreeSnapshot> {
  const roots = dedupePids(
    typeof rootPids === 'number' ? [rootPids] : (rootPids ?? []),
  );
  if (roots.length === 0) {
    return Promise.resolve({ pids: [], warning: null });
  }
  return new Promise((resolve) => {
    childProcess.execFile('ps', ['-axo', 'pid=,ppid='], {
      encoding: 'utf8',
      timeout: 1_000,
      maxBuffer: PROCESS_TREE_MAX_BUFFER,
    }, (err, output) => {
      if (err) {
        resolve({
          pids: roots,
          warning: `process tree collection unavailable: ${formatProcessTreeError(err)}`,
        });
        return;
      }
      resolve(mergeProcessSnapshots(
        ...roots.map((rootPid) => parseProcessTreeSnapshot(rootPid, output)),
      ));
    });
  });
}

function parseProcessTreeSnapshot(rootPid: number, output: string): ProcessTreeSnapshot {
  const descendants = new Map<number, number[]>();
  for (const line of output.split('\n')) {
    const [pidText, ppidText] = line.trim().split(/\s+/);
    const pid = Number(pidText);
    const ppid = Number(ppidText);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    const children = descendants.get(ppid) ?? [];
    children.push(pid);
    descendants.set(ppid, children);
  }
  const tree = [rootPid];
  for (let index = 0; index < tree.length; index += 1) {
    for (const childPid of descendants.get(tree[index]) ?? []) {
      if (!tree.includes(childPid)) tree.push(childPid);
    }
  }
  return { pids: tree, warning: null };
}

async function collectStdioHolderPidsAsync(
  child: ChildProcess,
  knownProcTargets = new Set<string>(),
  knownPeerIds = new Set<string>(),
): Promise<ProcessTreeSnapshot> {
  const procSnapshot = await collectProcFdHolderPidsAsync(child, knownProcTargets);
  if (!needsLsofStdioDiscovery(knownProcTargets)) return procSnapshot;
  return mergeProcessSnapshots(procSnapshot, await collectLsofStdioHolderPidsAsync(child, knownPeerIds));
}

async function collectProcFdHolderPidsAsync(
  child: ChildProcess,
  knownProcTargets = new Set<string>(),
): Promise<ProcessTreeSnapshot> {
  if (!HAS_PROC_FS) return { pids: [], warning: null };
  const targets = new Set([...knownProcTargets, ...await collectChildStdioProcTargetsAsync(child)]);
  if (targets.size === 0) return { pids: [], warning: null };
  const pids: number[] = [];
  const entries = await safeReadDirAsync('/proc');
  for (let index = 0; index < entries.length; index += PROC_SCAN_CONCURRENCY) {
    const batch = entries.slice(index, index + PROC_SCAN_CONCURRENCY);
    const matches = await Promise.all(batch.map(async (entry) => {
      const pid = Number(entry);
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || pid === child.pid) return null;
      for (const fdName of await safeReadDirAsync(`/proc/${pid}/fd`)) {
        const fdTarget = await safeReadLinkAsync(`/proc/${pid}/fd/${fdName}`);
        if (fdTarget && targets.has(fdTarget)) return pid;
      }
      return null;
    }));
    for (const pid of matches) {
      if (pid !== null) pids.push(pid);
    }
  }
  return { pids: dedupePids(pids), warning: null };
}

async function collectChildStdioProcTargetsAsync(child: ChildProcess): Promise<Set<string>> {
  const targets = new Set<string>();
  if (!HAS_PROC_FS) return targets;
  if (typeof child.pid === 'number' && child.pid > 0) {
    for (const target of await Promise.all(
      [1, 2].map((fd) => safeReadLinkAsync(`/proc/${child.pid}/fd/${fd}`)),
    )) {
      if (target) targets.add(target);
    }
  }
  return targets;
}

function needsLsofStdioDiscovery(knownProcTargets: ReadonlySet<string>): boolean {
  return knownProcTargets.size === 0 || !HAS_PROC_FS;
}

async function collectLsofStdioHolderPidsAsync(
  child: ChildProcess,
  knownPeerIds = new Set<string>(),
): Promise<ProcessTreeSnapshot> {
  const peerSnapshot = knownPeerIds.size > 0
    ? { peerIds: new Set<string>(), warning: null }
    : await collectChildStdioPeerIdsAsync(child);
  const peerIds = new Set([...knownPeerIds, ...peerSnapshot.peerIds]);
  if (peerIds.size === 0) return { pids: [], warning: peerSnapshot.warning };
  try {
    const output = await execLsofAsync(['-nP', '-U'], {
      timeout: 1_000,
      maxBuffer: LSOF_MAX_BUFFER,
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

async function execLsofAsync(
  args: string[],
  options: { timeout: number; maxBuffer: number },
): Promise<string> {
  const candidates = cachedLsofPath
    ? [cachedLsofPath, ...LSOF_SEARCH_PATHS.filter((candidate) => candidate !== cachedLsofPath)]
    : LSOF_SEARCH_PATHS;
  let lastErr: unknown = null;
  for (const candidate of candidates) {
    try {
      const output = await execFileUtf8(candidate, args, options);
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

async function execFileUtf8(
  command: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(command, args, { ...options, encoding: 'utf8' }, (err, output) => {
      if (err) reject(err);
      else resolve(output);
    });
  });
}

async function safeReadDirAsync(path: string): Promise<string[]> {
  try {
    return await fs.promises.readdir(path);
  } catch {
    return [];
  }
}

async function safeReadLinkAsync(path: string): Promise<string | null> {
  try {
    return await fs.promises.readlink(path);
  } catch {
    return null;
  }
}

async function collectChildStdioPeerIdsAsync(child: ChildProcess): Promise<StdioPeerSnapshot> {
  const peerIds = new Set<string>();
  let warning: string | null = null;
  await Promise.all([child.stdout, child.stderr].map(async (stream) => {
    const fd = getStreamFd(stream);
    if (fd === null) return;
    try {
      const output = await execLsofAsync(['-nP', '-a', '-p', String(process.pid), `-d${fd}`], {
        timeout: 1_000,
        maxBuffer: PROCESS_TREE_MAX_BUFFER,
      });
      for (const line of output.split('\n')) {
        const entry = parseLsofUnixTableLine(line);
        if (entry?.peerEndpoint) peerIds.add(entry.peerEndpoint);
      }
    } catch (err) {
      warning ??= `stdio peer collection unavailable: ${formatProcessTreeError(err)}`;
    }
  }));
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
