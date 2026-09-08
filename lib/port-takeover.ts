/**
 * Detect when the canonical Port Daddy TCP port is already held by a sibling
 * daemon (typically a Friday-orphan whose parent died but whose server.ts kept
 * running and got reparented to PID 1).
 *
 * The previous behavior on `EADDRINUSE` was a silent walk to ports 9877..9886.
 * That let two Port Daddy daemons run side-by-side, each listening on a
 * different TCP port but writing to the same SQLite DB. Their views of
 * sessions, fleet, and active ports diverged within minutes.
 *
 * `probePortOwner` tells the caller what can be learned about the holder. The
 * default policy is stricter than the probe: a canonical daemon never walks
 * away from its declared port merely because the holder stopped answering
 * during the probe. It refuses and lets the sole supervisor retry. The legacy
 * fallback walk is available only through the explicit escape hatch.
 */

import http from 'node:http';

export type PortOwnerKind = 'port-daddy' | 'foreign' | 'unreachable';

export interface PortOwnerProbe {
  kind: PortOwnerKind;
  pid?: number;
  uptimeSeconds?: number;
  version?: string;
  rawStatus?: number;
  reason?: string;
}

interface HealthResponse {
  status?: string;
  version?: string;
  uptime_seconds?: number;
  pid?: number;
}

/**
 * GET http://host:port/health with a tight timeout. Anything other than a
 * recognizable Port Daddy health JSON is treated as a foreign process.
 *
 * Sample inputs and outputs:
 *
 * ```ts
 * await probePortOwner('127.0.0.1', 9876)
 * // => { kind: 'port-daddy', pid: 66221, uptimeSeconds: 75123, version: '3.12.0' }
 *
 * await probePortOwner('127.0.0.1', 9876)            // nothing listening
 * // => { kind: 'unreachable', reason: 'ECONNREFUSED' }
 *
 * await probePortOwner('127.0.0.1', 9876)            // some other web server
 * // => { kind: 'foreign', rawStatus: 200, reason: 'non-port-daddy response' }
 * ```
 */
export function probePortOwner(
  host: string,
  port: number,
  timeoutMs = 750,
): Promise<PortOwnerProbe> {
  return new Promise((resolve) => {
    const req = http.request(
      { host, port, path: '/health', method: 'GET', timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let parsed: HealthResponse | null = null;
          try { parsed = JSON.parse(body) as HealthResponse; } catch { parsed = null; }
          if (parsed && parsed.status === 'ok' && typeof parsed.pid === 'number') {
            resolve({
              kind: 'port-daddy',
              pid: parsed.pid,
              uptimeSeconds: typeof parsed.uptime_seconds === 'number' ? parsed.uptime_seconds : undefined,
              version: typeof parsed.version === 'string' ? parsed.version : undefined,
              rawStatus: res.statusCode,
            });
            return;
          }
          resolve({
            kind: 'foreign',
            rawStatus: res.statusCode,
            reason: 'non-port-daddy response',
          });
        });
      },
    );
    req.on('error', (err: NodeJS.ErrnoException) => {
      resolve({ kind: 'unreachable', reason: err.code ?? err.message });
    });
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
      resolve({ kind: 'unreachable', reason: 'timeout' });
    });
    req.end();
  });
}

export interface DecideTakeoverInput {
  probe: PortOwnerProbe;
  selfPid: number;
  /** When true (env PD_ALLOW_TCP_FALLBACK=1), restore the legacy walk-to-fallback-port behavior. */
  allowFallback: boolean;
}

export type TakeoverDecision =
  | { action: 'fallback'; reason: string }
  | { action: 'refuse'; reason: string; foreignPid?: number };

/**
 * Decide what to do when the canonical TCP port is busy.
 *
 * Inputs and outputs:
 *
 * ```ts
 * decideTakeover({ probe: { kind: 'port-daddy', pid: 66221 }, selfPid: 12345, allowFallback: false })
 * // => { action: 'refuse', reason: 'sibling Port Daddy daemon ...', foreignPid: 66221 }
 *
 * decideTakeover({ probe: { kind: 'port-daddy', pid: 12345 }, selfPid: 12345, allowFallback: false })
 * // => { action: 'refuse', reason: 'this process already owns ...', foreignPid: 12345 }
 *
 * decideTakeover({ probe: { kind: 'foreign' }, selfPid: 12345, allowFallback: false })
 * // => { action: 'refuse', reason: 'canonical port is occupied by a foreign process' }
 *
 * decideTakeover({ probe: { kind: 'unreachable' }, selfPid: 12345, allowFallback: false })
 * // => { action: 'fallback', reason: 'no Port Daddy daemon detected on the busy port' }
 * ```
 */
export function decideTakeover(input: DecideTakeoverInput): TakeoverDecision {
  const { probe, selfPid, allowFallback } = input;
  if (allowFallback) {
    const suffix = probe.kind === 'port-daddy'
      ? 'sibling daemon detected'
      : probe.kind === 'foreign'
        ? 'foreign process detected'
        : 'port ownership could not be verified';
    return {
      action: 'fallback',
      reason: `${suffix}; PD_ALLOW_TCP_FALLBACK=1`,
      ...(probe.pid ? { foreignPid: probe.pid } : {}),
    } as TakeoverDecision;
  }
  if (probe.kind === 'port-daddy') {
    if (probe.pid === selfPid) {
      return {
        action: 'refuse',
        reason: 'another instance reports the same pid as this process; refusing to start',
        foreignPid: probe.pid,
      };
    }
    return {
      action: 'refuse',
      reason: 'a sibling Port Daddy daemon already owns the canonical port; refusing to start to avoid SQLite corruption',
      foreignPid: probe.pid,
    };
  }
  if (probe.kind === 'foreign') {
    return {
      action: 'refuse',
      reason: 'the canonical Port Daddy port is occupied by a foreign process; refusing to advertise a different port',
    };
  }
  return {
    action: 'refuse',
    reason: 'the canonical Port Daddy port is busy but its owner could not be verified; refusing to advertise a different port',
  };
}
