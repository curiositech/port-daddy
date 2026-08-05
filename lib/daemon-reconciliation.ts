/**
 * DAEMON RECONCILIATION — half-alive duplicate detection (2026-07-04 incident).
 *
 * The startup duplicate-daemon guard used to trust the unix socket alone: if
 * something answered `"status":"ok"` on SOCK_PATH, the new spawn exited 0.
 * That is necessary but NOT sufficient. A daemon whose Cellar binary was
 * deleted underneath it (brew upgrade churn) can keep answering on the unix
 * socket while its TCP listener on the daemon port is dead — a half-alive zombie. Under
 * launchd KeepAlive that produced 345 consecutive polite exits: every respawn
 * probed the socket, heard "ok" from the corpse, and quit, while every HTTP
 * client fell back to the dev daemon's database (split-brain sessions/claims).
 *
 * The rule now: an existing daemon earns deference only when BOTH surfaces
 * are healthy. Socket-ok + TCP-dead (after generous retries, so a merely
 * slow daemon is never shot) means zombie — terminate the stale PID and
 * replace it under the one configured supervisor.
 */

export type DuplicateAction = 'defer' | 'replace-stale' | 'clean-start';

export interface TcpProbeOptions {
  /** Probe attempts before declaring the TCP surface dead. */
  attempts?: number;
  /** Per-attempt timeout. Generous: a booting daemon can take ~3s per reply. */
  timeoutMs?: number;
  /** Injection point for tests. */
  fetchImpl?: typeof fetch;
  /** Sleep between attempts. */
  retryDelayMs?: number;
}

export interface HealthIdentity {
  ok: boolean;
  pid: number | null;
}

/**
 * Parse either a bare JSON health body or a complete HTTP response received
 * over the Unix socket. PID is deliberately strict: it is later used as an
 * ownership witness before a stale process may be signalled.
 */
export function parseHealthIdentity(raw: string): HealthIdentity {
  const body = raw.includes('\r\n\r\n') ? raw.slice(raw.indexOf('\r\n\r\n') + 4) : raw;
  try {
    const parsed = JSON.parse(body) as { status?: unknown; pid?: unknown };
    const pid = typeof parsed.pid === 'number'
      && Number.isSafeInteger(parsed.pid)
      && parsed.pid > 1
      ? parsed.pid
      : null;
    return { ok: parsed.status === 'ok', pid };
  } catch {
    return { ok: raw.includes('"status":"ok"'), pid: null };
  }
}

/**
 * A /health body counts as ok when it PARSES as JSON with `status: "ok"`;
 * the exact-substring check is only a fallback for a truncated body.
 * Misreading a healthy daemon as a zombie gets it killed, so this check is
 * deliberately format-tolerant (whitespace/key-order changes stay healthy).
 */
export function healthBodyIsOk(body: string): boolean {
  return parseHealthIdentity(body).ok;
}

/**
 * A PID is safe to reconcile only when the state file and the process that
 * answered on the owned Unix socket independently identify the same process.
 */
export function verifiedStalePid(pidFileValue: unknown, socketHealthPid: unknown): number | null {
  const pidFromFile = typeof pidFileValue === 'number' ? pidFileValue : Number(pidFileValue);
  if (!Number.isSafeInteger(pidFromFile) || pidFromFile <= 1) return null;
  if (!Number.isSafeInteger(socketHealthPid) || socketHealthPid !== pidFromFile) return null;
  return pidFromFile;
}

/**
 * True when `http://127.0.0.1:{port}/health` answers status ok within the
 * attempt budget. Retries exist so a healthy-but-slow daemon (post-boot
 * catch-up regularly serves /health in 2–3s) is never misread as a zombie.
 */
export async function probeTcpHealth(port: number, opts: TcpProbeOptions = {}): Promise<boolean> {
  const attempts = opts.attempts ?? 3;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const retryDelayMs = opts.retryDelayMs ?? 500;
  const fetchImpl = opts.fetchImpl ?? fetch;

  for (let i = 0; i < attempts; i += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
        const body = await res.text();
        if (res.ok && healthBodyIsOk(body)) return true;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // connection refused / abort / reset — fall through to retry
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, retryDelayMs));
  }
  return false;
}

/**
 * Decide what a starting daemon should do about an apparent predecessor.
 *
 * - socket dead → 'clean-start' (stale files; unlink and boot — pre-existing behavior)
 * - socket ok + tcp ok → 'defer' (a genuinely healthy daemon owns the berth)
 * - socket ok + tcp dead → 'replace-stale' (half-alive zombie)
 *
 * `tcpDisabled` daemons (PORT_DADDY_NO_TCP=1) have no second surface to
 * cross-check, so a live socket is authoritative for them.
 */
export function decideDuplicateAction(input: {
  sockAlive: boolean;
  tcpAlive: boolean;
  tcpDisabled: boolean;
}): DuplicateAction {
  if (!input.sockAlive) return 'clean-start';
  if (input.tcpDisabled || input.tcpAlive) return 'defer';
  return 'replace-stale';
}

export interface TerminateOptions {
  /** Injection point for tests. Same contract as process.kill. */
  killImpl?: (pid: number, signal: NodeJS.Signals | 0) => void;
  /** How long to wait for SIGTERM to land before escalating to SIGKILL. */
  graceMs?: number;
  pollMs?: number;
}

/**
 * SIGTERM the stale PID, wait up to graceMs for it to exit, then SIGKILL.
 * Refuses obviously-wrong targets (self, pid <= 1, NaN). Returns what it did.
 */
export async function terminateVerifiedStalePid(
  pid: number,
  opts: TerminateOptions = {},
): Promise<'no-op' | 'term' | 'kill'> {
  const killImpl = opts.killImpl ?? ((p: number, s: NodeJS.Signals | 0) => process.kill(p, s));
  const graceMs = opts.graceMs ?? 3000;
  const pollMs = opts.pollMs ?? 100;

  if (!Number.isFinite(pid) || pid <= 1 || pid === process.pid) return 'no-op';

  const alive = (): boolean => {
    try {
      killImpl(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  if (!alive()) return 'no-op';
  try {
    killImpl(pid, 'SIGTERM');
  } catch {
    return 'no-op';
  }

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!alive()) return 'term';
    await new Promise((r) => setTimeout(r, pollMs));
  }

  if (alive()) {
    try {
      killImpl(pid, 'SIGKILL');
    } catch {
      // it died between the check and the kill — fine
    }
    return 'kill';
  }
  return 'term';
}
