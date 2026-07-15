/**
 * Egress-recording guard (ADR-0101 Appendix — Critical 1).
 *
 * Preloaded into the Port Daddy daemon subprocess via
 *   NODE_OPTIONS="--import <this file>"
 * BEFORE any application code runs. It patches the single TCP chokepoint —
 * `net.Socket.prototype.connect` — and appends every outbound connection
 * target to the JSONL file named by `PD_EGRESS_LOG`.
 *
 * It RECORDS, it does not BLOCK: the daemon boots and runs normally, and the
 * test that owns this guard classifies the recorded targets afterwards. All
 * higher-level egress paths funnel through `Socket.prototype.connect`:
 *   - http/https Agent sockets
 *   - tls.connect (TLSSocket extends net.Socket)
 *   - globalThis.fetch / undici (net.connect under the hood)
 *   - ws / any raw TCP
 * so patching this one method catches them all. undici resolves a hostname to
 * an IP first, so an external fetch still surfaces here as a non-loopback IP
 * connect even though DNS itself is not intercepted.
 *
 * No-ops when PD_EGRESS_LOG is unset, so accidental preload never perturbs an
 * unrelated process.
 */

import net from 'node:net';
import fs from 'node:fs';

const LOG = process.env.PD_EGRESS_LOG;

if (LOG) {
  const record = (entry) => {
    try {
      fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), ...entry }) + '\n');
    } catch {
      // Best effort — never let recording crash the host process.
    }
  };

  // Marker so the owning test can PROVE the guard was actually active. A green
  // egress assertion is meaningless if the recorder never loaded.
  record({ kind: 'guard-init', pid: process.pid });

  // net.Socket.prototype.connect has three public call shapes:
  //   connect(options[, listener])
  //   connect(path[, listener])            (unix socket / named pipe)
  //   connect(port[, host][, listener])
  // Node also pre-normalizes internal calls into a single [options, cb] array
  // before handing them to Socket.prototype.connect, so unwrap that too.
  const normalize = (args) => {
    let a0 = args[0];
    if (Array.isArray(a0)) a0 = a0[0];
    if (a0 && typeof a0 === 'object') {
      return { host: a0.host, port: a0.port, path: a0.path };
    }
    if (typeof a0 === 'string') {
      return { path: a0 };
    }
    const host = typeof args[1] === 'string' ? args[1] : undefined;
    return { host, port: a0 };
  };

  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function patchedConnect(...args) {
    try {
      record({ kind: 'socket.connect', ...normalize(args) });
    } catch {
      // ignore
    }
    return origConnect.apply(this, args);
  };
}
