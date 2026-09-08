/**
 * lib/safe/egress-assertion.ts — the runtime-verifiable "local-only uploads
 * nothing" check (ADR-0101 tenancy-boundary audit, Critical 1 / issue #2460).
 *
 * The audit's `localOnlyMode.uploadsNothingTestable` boolean may be `true` ONLY
 * when backed by a runtime-verifiable check. This module IS that backing
 * artifact: it turns an `EgressSnapshot` (lib/safe/egress-snapshot.ts) into a
 * PASS/FAIL verdict — in local-only operation, no considered flow may reach a
 * NON-loopback host. It is fail-closed and names every offender, so any future
 * feature that phones home in local-only mode makes the assertion FAIL until it
 * is gated behind explicit configuration (a paired relay in `allowHosts`).
 *
 * Pure over a captured snapshot, so it runs identically over a live capture
 * (macOS `nettop`/`lsof`) or a recorded fixture (CI). Because `parseLsof` only
 * emits established remotes (it requires a `->` in the lsof NAME), LISTEN
 * sockets never appear here — every `remoteHost` is a real outbound destination.
 *
 * IMPORTANT — vacuous-pass guard: on a host where neither tool is available
 * (e.g. Linux CI with no `nettop`), a snapshot has zero flows. That is NOT the
 * same as "verified zero egress". The result carries `verified` so callers can
 * distinguish "checked, nothing leaked" from "could not check". A test that
 * silently passes when it could not observe anything is the exact overclaim
 * this audit exists to catch.
 */

import { captureEgressSnapshot, type EgressRunner, type SpawnLookup } from './egress-snapshot.js';
import type { EgressSnapshot, EgressFlow } from './types.js';

/**
 * Is this remote host a loopback / non-routable endpoint (i.e. traffic that
 * never left the machine)? Covers IPv4 127.0.0.0/8, IPv6 `::1`, the
 * unspecified/wildcard binds, `localhost`, and IPv4-mapped-IPv6 loopback.
 * A `null`/empty host (no destination recorded) is treated as non-egress.
 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (host == null) return true;
  let h = host.trim().toLowerCase();
  if (h === '') return true;
  // strip IPv6 brackets: [::1] -> ::1
  h = h.replace(/^\[/, '').replace(/\]$/, '');
  if (h === 'localhost' || h === '*') return true;
  if (h === '::1' || h === '::' || h === '0.0.0.0') return true;
  // IPv4-mapped IPv6 loopback, e.g. ::ffff:127.0.0.1
  if (h.startsWith('::ffff:')) h = h.slice('::ffff:'.length);
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m && Number(m[1]) === 127) return true;
  return false;
}

export interface EgressAssertionOptions {
  /**
   * Only consider flows attributed to a known PD spawn/daemon (via the snapshot
   * lookup). Default `false`: EVERY flow is considered. Set `true` to scope the
   * assertion to Port-Daddy-owned processes on a busy host.
   */
  knownAgentsOnly?: boolean;
  /**
   * Hosts explicitly permitted to receive egress — the paired relay origin in
   * cloud mode. Matched by exact host or bare hostname (port-insensitive). In
   * local-only mode this is empty, so ALL non-loopback egress is a violation.
   */
  allowHosts?: string[];
}

/** One flow that breached the local-only boundary. */
export interface EgressViolation {
  host: string;
  pid: number;
  binary: string | null;
  /** Known PD agent id/label, when the pid was in the spawn registry. */
  agent: string | null;
  port: number | null;
  bytes: number | null;
}

export interface EgressAssertionResult {
  /** True iff no considered flow reached a disallowed non-loopback host. */
  ok: boolean;
  /**
   * True iff the snapshot could actually observe egress (at least one of
   * nettop/lsof ran). When `false`, `ok` is not a positive proof of zero
   * egress — the environment could not be inspected. Callers MUST treat
   * `verified === false` as "unable to verify", never as a pass.
   */
  verified: boolean;
  violations: EgressViolation[];
  consideredFlows: number;
  /** Flows dropped because they carried no destination (null remoteHost). */
  unclassifiedFlows: number;
  toolsAvailable: { nettop: boolean; lsof: boolean };
  reason: string;
}

function normalizeAllow(allowHosts: string[] | undefined): Set<string> {
  const set = new Set<string>();
  for (const raw of allowHosts ?? []) {
    if (!raw) continue;
    let h = raw.trim().toLowerCase();
    // accept full origins (https://host:443/…) and bare host[:port]
    h = h.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
    const bare = h.replace(/:\d+$/, '');
    set.add(h);
    set.add(bare);
  }
  return set;
}

function agentLabel(flow: EgressFlow): string | null {
  const a = flow.agent as unknown as { id?: string; label?: string; identity?: string } | null;
  if (!a) return null;
  return a.label ?? a.id ?? a.identity ?? null;
}

/**
 * Assert that a captured snapshot shows no egress to a disallowed non-loopback
 * host. Pure. See module header for the `verified` vacuous-pass guard.
 */
export function assertLocalOnlyNoEgress(
  snapshot: EgressSnapshot,
  opts: EgressAssertionOptions = {},
): EgressAssertionResult {
  const allow = normalizeAllow(opts.allowHosts);
  const toolsAvailable = { nettop: snapshot.nettopAvailable, lsof: snapshot.lsofAvailable };
  const verified = snapshot.nettopAvailable || snapshot.lsofAvailable;

  let consideredFlows = 0;
  let unclassifiedFlows = 0;
  const violations: EgressViolation[] = [];

  for (const flow of snapshot.flows) {
    if (opts.knownAgentsOnly && flow.agent == null) continue;
    if (flow.remoteHost == null) {
      unclassifiedFlows += 1;
      continue;
    }
    consideredFlows += 1;
    if (isLoopbackHost(flow.remoteHost)) continue;

    const host = flow.remoteHost.trim().toLowerCase();
    const bare = host.replace(/:\d+$/, '');
    if (allow.has(host) || allow.has(bare)) continue;

    violations.push({
      host: flow.remoteHost,
      pid: flow.pid,
      binary: flow.binary,
      agent: agentLabel(flow),
      port: flow.remotePort,
      bytes: flow.bytes,
    });
  }

  const ok = violations.length === 0;
  const reason = !verified
    ? 'UNVERIFIED: neither nettop nor lsof produced output on this host — egress could not be observed'
    : ok
      ? `OK: ${consideredFlows} flow(s) inspected, all loopback${allow.size ? ' or explicitly allowed' : ''}`
      : `EGRESS VIOLATION: ${violations.length} flow(s) reached non-loopback host(s): ` +
        violations.map((v) => `${v.binary ?? 'pid ' + v.pid}→${v.host}`).join(', ');

  return { ok, verified, violations, consideredFlows, unclassifiedFlows, toolsAvailable, reason };
}

/**
 * Capture a live snapshot and assert local-only in one call. Injectable runner
 * + lookup for tests; defaults to the real `nettop`/`lsof` + no-op lookup.
 */
export function captureAndAssertLocalOnly(
  opts: EgressAssertionOptions & { run?: EgressRunner; lookup?: SpawnLookup } = {},
): EgressAssertionResult {
  const snapshot = captureEgressSnapshot({ run: opts.run, lookup: opts.lookup });
  return assertLocalOnlyNoEgress(snapshot, opts);
}
