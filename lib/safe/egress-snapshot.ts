/**
 * lib/safe/egress-snapshot.ts — A6, the egress snapshot (ADR-0088 Phase A).
 *
 * A READ-ONLY point-in-time map of who is talking to the network:
 *
 *   `nettop -P -m route -l 1`  → per-PID remote host + byte counters (NO sudo)
 *   `lsof -i -nP`              → own-UID open sockets (pid ↔ binary ↔ remote)
 *
 * joined into `{ pid, binary, remoteHost, bytes }`, then correlated against PD's
 * spawn registry (lib/spawner.ts) so a flow attributes to a KNOWN agent/sortie,
 * not a bare PID.
 *
 * This is volumetric + destination EVIDENCE only — TLS bodies are opaque. It is
 * NOT enforcement (Phase D promotes the snapshot into a continuous poller; Phase
 * E enforces). All shelling is behind an injectable runner; the parsers are pure
 * and DEFENSIVE — every field is optional and tolerated-missing.
 */

import { execFileSync } from 'node:child_process';
import type {
  EgressFlow,
  EgressSnapshot,
  KnownSpawn,
} from './types.js';

/** Injectable command runner: combined stdout or null when unrunnable. */
export type EgressRunner = (cmd: string, args: string[]) => string | null;

/** Real runner over `execFileSync`. Tolerates non-zero exits (returns stdout). */
export const realEgressRunner: EgressRunner = (cmd, args) => {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer | string };
    const out = e?.stdout ? e.stdout.toString() : '';
    return out.length > 0 ? out : null;
  }
};

/** The spawn-registry lookup the daemon supplies: PID → known agent, or null. */
export type SpawnLookup = (pid: number) => KnownSpawn | null;

// ── nettop parsing ───────────────────────────────────────────────────────────

/** One row from nettop: a pid with a remote host and byte counters. */
export interface NettopRow {
  pid: number;
  remoteHost: string | null;
  remotePort: number | null;
  bytes: number | null;
}

/**
 * Parse `nettop -P -m route -l 1` output DEFENSIVELY. `-P` gives per-process
 * rows; `-m route` adds the destination; columns vary by macOS version, so we
 * locate the bytes columns from the header where present and fall back to a
 * tolerant heuristic. Lines that don't parse are skipped, never thrown on.
 *
 * Typical CSV-ish shape (nettop emits comma-separated with -P on recent macOS):
 *   time,,bytes_in,bytes_out,...
 *   ,curl.12345,,1024,2048,...
 *   ,,1.2.3.4:443,512,256,...
 */
export function parseNettop(out: string): NettopRow[] {
  const rows: NettopRow[] = [];
  if (!out) return rows;
  const lines = out.split('\n').map((l) => l.replace(/\r$/, ''));
  // When a header is present we know whether bytes_in precedes bytes_out (it
  // always does on macOS), but the ABSOLUTE column index does not line up with a
  // flow row (the endpoint occupies a column the header labels differently). So
  // we locate the endpoint column in each flow row and read the byte counters
  // that immediately FOLLOW it — robust to version-varying leading columns.
  const hasHeader = lines.some((l) => /bytes_in/i.test(l));
  let currentPid: number | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    if (/bytes_in/i.test(line)) continue; // header row
    const cols = line.split(',');

    // A process row carries `name.PID` in the second column (e.g. `curl.12345`)
    // and NO remote endpoint.
    const nameCol = cols[1] ?? '';
    const pidM = nameCol.match(/\.(\d+)\s*$/);
    const endpoint = findEndpoint(cols);
    if (pidM && !endpoint) {
      currentPid = Number(pidM[1]);
      continue;
    }
    if (!endpoint || currentPid == null) continue;

    // Byte counters follow the endpoint column. With a header we know two
    // counters (in,out) follow; without one we still read the next ≤2 numerics.
    const epIdx = cols.findIndex((c) => c.includes(endpoint.host));
    const bytesIn = firstNumericAfter(cols, epIdx, 1);
    const bytesOut = firstNumericAfter(cols, epIdx, 2);
    const bytes =
      bytesIn == null && bytesOut == null ? null : (bytesIn ?? 0) + (bytesOut ?? 0);

    rows.push({
      pid: currentPid,
      remoteHost: endpoint.host,
      remotePort: endpoint.port,
      bytes,
    });
  }
  return rows;
}

/** The Nth numeric value strictly after column `idx` (1-based n). Defensive. */
function firstNumericAfter(cols: string[], idx: number, n: number): number | null {
  if (idx < 0) return null;
  let seen = 0;
  for (let i = idx + 1; i < cols.length; i++) {
    const t = cols[i].trim();
    if (t === '') continue;
    const v = Number(t);
    if (!Number.isFinite(v)) continue;
    seen++;
    if (seen === n) return v;
  }
  return null;
}

/**
 * Find a network endpoint among the columns. nettop route rows use a COLON to
 * separate host and port (`140.82.112.3:443`, `[2606:...]:443`), while the
 * process row uses a DOT (`node.12345` = name.PID). We therefore only accept the
 * colon form, which cleanly excludes `name.PID` rows. Tolerant: returns the first
 * colon-separated `host:port` it finds, or null.
 */
function findEndpoint(cols: string[]): { host: string; port: number | null } | null {
  for (const raw of cols) {
    const c = raw.trim();
    if (!c) continue;
    // Bracketed IPv6 `[..]:port`.
    let m = c.match(/^\[([0-9a-fA-F:]+)\]:(\d{1,5})$/);
    if (m) return { host: m[1], port: clampPort(m[2]) };
    // IPv4 / hostname `host:port` — host must contain a dot or be a hostname,
    // and the separator is a COLON (distinguishes from `name.PID`).
    m = c.match(/^([0-9]{1,3}(?:\.[0-9]{1,3}){3}|[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z0-9-]+):(\d{1,5})$/);
    if (m) return { host: m[1], port: clampPort(m[2]) };
  }
  return null;
}

/** Parse a port string into a valid 1..65535 number, or null. */
function clampPort(s: string): number | null {
  const p = Number(s);
  return Number.isFinite(p) && p >= 0 && p <= 65535 ? p : null;
}

// ── lsof parsing ─────────────────────────────────────────────────────────────

/** One row from lsof -i: pid, command, remote endpoint. */
export interface LsofRow {
  pid: number;
  command: string | null;
  remoteHost: string | null;
  remotePort: number | null;
}

/**
 * Parse `lsof -i -nP` DEFENSIVELY. Whitespace-columned:
 *   COMMAND  PID  USER  FD  TYPE  DEVICE  SIZE/OFF  NODE  NAME
 * NAME is `local->remote` for an established connection, e.g.
 *   `192.168.1.2:54321->140.82.112.3:443 (ESTABLISHED)`.
 * Only rows with a `->remote` endpoint are kept; malformed rows are skipped.
 */
export function parseLsof(out: string): LsofRow[] {
  const rows: LsofRow[] = [];
  if (!out) return rows;
  for (const line of out.split('\n')) {
    const t = line.trim();
    if (!t || /^COMMAND\b/.test(t)) continue;
    const cols = t.split(/\s+/);
    if (cols.length < 9) continue;
    const command = cols[0] || null;
    const pid = Number(cols[1]);
    if (!Number.isFinite(pid)) continue;
    // NAME is the rest from column 9 onward (joined — it can contain spaces in
    // the trailing `(ESTABLISHED)` part).
    const name = cols.slice(8).join(' ');
    const ep = parseLsofEndpoint(name);
    if (!ep) continue;
    rows.push({ pid, command, remoteHost: ep.host, remotePort: ep.port });
  }
  return rows;
}

/** Extract the remote side of an `local->remote` lsof NAME field. */
function parseLsofEndpoint(name: string): { host: string; port: number | null } | null {
  const arrow = name.indexOf('->');
  if (arrow < 0) return null;
  let remote = name.slice(arrow + 2).trim();
  // strip a trailing `(STATE)`.
  remote = remote.replace(/\s*\([^)]*\)\s*$/, '').trim();
  // remote is `host:port` (ipv4) or `[v6]:port`.
  const m = remote.match(/^(\[[0-9a-fA-F:]+\]|[0-9a-zA-Z.-]+):(\d{1,5})$/);
  if (!m) return null;
  const host = m[1].replace(/^\[|\]$/g, '');
  const port = Number(m[2]);
  return { host, port: Number.isFinite(port) ? port : null };
}

// ── Join + correlate ─────────────────────────────────────────────────────────

/**
 * Join nettop rows (bytes + host) with lsof rows (binary + host) on pid, then
 * correlate each flow to a known PD agent. Pure over the parsed rows + lookup.
 *
 * lsof gives us the binary name and a confirmed endpoint; nettop gives the byte
 * counters. We key flows by (pid, remoteHost) and merge. A flow seen only in
 * nettop still surfaces (binary null); one seen only in lsof surfaces (bytes
 * null). Defensive: a missing field never drops the flow.
 */
export function joinFlows(
  nettopRows: NettopRow[],
  lsofRows: LsofRow[],
  lookup: SpawnLookup,
): EgressFlow[] {
  const byKey = new Map<string, EgressFlow>();
  const key = (pid: number, host: string | null) => `${pid}|${host ?? ''}`;

  const ensure = (pid: number, host: string | null, port: number | null): EgressFlow => {
    const k = key(pid, host);
    let f = byKey.get(k);
    if (!f) {
      f = {
        pid,
        binary: null,
        remoteHost: host,
        remotePort: port,
        bytes: null,
        agent: safeLookup(lookup, pid),
      };
      byKey.set(k, f);
    }
    return f;
  };

  // lsof first: it carries the binary name + a confirmed remote.
  for (const r of lsofRows) {
    const f = ensure(r.pid, r.remoteHost, r.remotePort);
    if (r.command) f.binary = r.command;
    if (f.remotePort == null) f.remotePort = r.remotePort;
  }
  // nettop: byte counters; matches an lsof flow by (pid, host) or stands alone.
  for (const r of nettopRows) {
    const f = ensure(r.pid, r.remoteHost, r.remotePort);
    if (r.bytes != null) f.bytes = (f.bytes ?? 0) + r.bytes;
    if (f.remotePort == null) f.remotePort = r.remotePort;
  }

  return [...byKey.values()];
}

/** Lookup that never throws on a bad daemon registry (defensive). */
function safeLookup(lookup: SpawnLookup, pid: number): KnownSpawn | null {
  try {
    return lookup(pid) ?? null;
  } catch {
    return null;
  }
}

/**
 * Capture a full egress snapshot. Read-only. Injectable runner + spawn lookup
 * for tests; defaults to the real `nettop`/`lsof` + a no-op lookup (the daemon
 * wires its real spawn registry).
 */
export function captureEgressSnapshot(opts: {
  run?: EgressRunner;
  lookup?: SpawnLookup;
} = {}): EgressSnapshot {
  const run = opts.run ?? realEgressRunner;
  const lookup = opts.lookup ?? (() => null);

  const nettopOut = run('nettop', ['-P', '-m', 'route', '-l', '1']);
  const lsofOut = run('lsof', ['-i', '-nP']);

  const nettopRows = nettopOut ? parseNettop(nettopOut) : [];
  const lsofRows = lsofOut ? parseLsof(lsofOut) : [];

  return {
    flows: joinFlows(nettopRows, lsofRows, lookup),
    nettopAvailable: nettopRows.length > 0,
    lsofAvailable: lsofRows.length > 0,
  };
}
