/**
 * lib/coast-guard/egress-meter.ts — a local, hard-capped metering proxy.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WHAT THIS IS (ADR-0050 phase 0 / phase 2)
 * ════════════════════════════════════════════════════════════════════════
 * Port Daddy points a confined agent's outbound API traffic here via
 * `HTTPS_PROXY` / `HTTP_PROXY`. We meter per-host request count + tunnelled
 * bytes and **hard-refuse** once a cap is hit — so a runaway or looping agent
 * **cannot** burn unbounded spend. "Bankrupt me" becomes a refused request.
 *
 * This is the TypeScript successor to `tools/coast-guard/egress-meter.py`. It
 * runs in-process (for tests + the in-daemon broker) AND as a standalone
 * subprocess (the spawner launches one per agent). Same logic, one source.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  THE SECRET BROKER (ADR-0050 phase 1)
 * ════════════════════════════════════════════════════════════════════════
 * The spawned agent's env carries **no raw API key** (the spawner scrubs
 * them — see coast-guard.ts `scrubRawSecretsFromEnv`). For plain-HTTP
 * outbound calls (e.g. the ollama loopback backend, or any non-TLS provider
 * shim) this proxy can **inject** the real `Authorization` header from the
 * broker before forwarding — the key never lived in the agent's environment.
 *
 * Honest limit, stated in the receipt and here: HTTPS is tunnelled via the
 * `CONNECT` method, so for TLS providers we count requests + bytes but cannot
 * read or inject headers without a MITM CA (phase 2 dollar-accurate metering).
 * Header injection therefore covers the loopback / plain-HTTP case today; the
 * TLS-injection upgrade is a documented, separate phase. What is ALREADY true
 * for every backend: the raw key is not in the agent's env, and `.env.local`
 * is unreadable under the Seatbelt/Landlock profile. So `cat .env.local` or an
 * env dump yields nothing usable — which is phase-1's "done when".
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WHAT THIS IS NOT
 * ════════════════════════════════════════════════════════════════════════
 * A truly-malicious same-UID agent can `unset HTTPS_PROXY` and egress
 * directly, bypassing the cap entirely. Sealing that needs a separate
 * UID / netns + pf/nftables forced egress (ADR-0050 phase 4). This defends
 * the COOPERATIVE case: runaway spend, accidental exfiltration, confused
 * deputy. We never claim more.
 */

import net from 'node:net';
import http from 'node:http';
import { Buffer } from 'node:buffer';

/** Per-host injection rule the broker hands the proxy. */
export interface BrokerHostRule {
  /** Header name to inject on plain-HTTP requests to this host (e.g. 'authorization'). */
  header: string;
  /** Header value, including any scheme prefix (e.g. 'Bearer sk-...'). */
  value: string;
}

export interface EgressMeterOptions {
  /** Hard cap on total proxied requests. The (cap+1)th request is refused. */
  maxRequests: number;
  /**
   * Optional hard cap on total tunnelled bytes. Once exceeded, in-flight and
   * new connections are refused. 0 / undefined = no byte cap.
   */
  maxBytes?: number;
  /**
   * Broker injection rules keyed by lowercased host. Used only for plain-HTTP
   * (non-CONNECT) requests — the cooperative-case header injection path.
   */
  brokerRules?: Record<string, BrokerHostRule>;
  /** Bind host. Defaults to loopback — never expose this proxy off-box. */
  host?: string;
}

export interface EgressMeterState {
  requests: number;
  bytes: number;
  blocked: number;
  injected: number;
  byHost: Record<string, number>;
  cap: number;
  byteCap: number;
}

/**
 * An in-process metering proxy. Construct, `await listen()`, point a child at
 * `proxyUrl`, then read `state` / `dispose()`. Pure-ish: deterministic counters
 * make it unit-testable without real network providers.
 */
export class EgressMeter {
  private server: net.Server;
  private readonly opts: Required<Pick<EgressMeterOptions, 'maxRequests' | 'host'>> & EgressMeterOptions;
  private readonly _state: EgressMeterState;
  private _port = 0;
  private readonly sockets = new Set<net.Socket>();

  constructor(options: EgressMeterOptions) {
    this.opts = {
      host: '127.0.0.1',
      ...options,
    };
    this._state = {
      requests: 0,
      bytes: 0,
      blocked: 0,
      injected: 0,
      byHost: {},
      cap: options.maxRequests,
      byteCap: options.maxBytes ?? 0,
    };
    this.server = net.createServer((socket) => this.handle(socket));
    this.server.on('error', () => {
      // Surfaced via listen() rejection; runtime errors here must not crash the daemon.
    });
  }

  get state(): Readonly<EgressMeterState> {
    return this._state;
  }

  get port(): number {
    return this._port;
  }

  get proxyUrl(): string {
    return `http://${this.opts.host}:${this._port}`;
  }

  listen(port = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, this.opts.host, () => {
        const addr = this.server.address();
        this._port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve(this._port);
      });
    });
  }

  /** True once the request cap (or byte cap) is exhausted. */
  private overCap(): boolean {
    if (this._state.requests > this.opts.maxRequests) return true;
    if (this.opts.maxBytes && this._state.bytes > this.opts.maxBytes) return true;
    return false;
  }

  private refuse(socket: net.Socket, why: string): void {
    this._state.blocked += 1;
    try {
      socket.write(
        `HTTP/1.1 402 ${why}\r\nContent-Length: 0\r\nProxy-Connection: close\r\n\r\n`,
      );
    } catch {
      /* socket may be gone */
    }
    socket.destroy();
  }

  private handle(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.once('close', () => this.sockets.delete(socket));

    socket.once('data', (chunk: Buffer) => {
      const headerEnd = chunk.indexOf('\r\n\r\n');
      const headerText = (headerEnd >= 0 ? chunk.subarray(0, headerEnd) : chunk).toString('latin1');
      const firstLine = headerText.split('\r\n')[0] || '';
      const parts = firstLine.split(' ');
      if (parts.length < 2) {
        socket.destroy();
        return;
      }
      const method = parts[0];
      const target = parts[1];

      // Count the request FIRST so a refused request still increments `blocked`.
      this._state.requests += 1;
      if (this.overCap()) {
        this.refuse(socket, 'Spend Cap Exceeded');
        return;
      }

      if (method === 'CONNECT') {
        this.handleConnect(socket, target, chunk.subarray(headerEnd + 4));
      } else {
        this.handlePlainHttp(socket, method, target, headerText, chunk, headerEnd);
      }
    });

    socket.on('error', () => socket.destroy());
  }

  /** HTTPS via CONNECT: blind tunnel, byte-metered. Cannot inject (TLS). */
  private handleConnect(socket: net.Socket, target: string, leftover: Buffer): void {
    const [host, portStr] = target.split(':');
    const upstream = net.connect(Number(portStr) || 443, host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (leftover.length) upstream.write(leftover);
      this.meter(socket, upstream, host);
      this.meter(upstream, socket, host);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  }

  /**
   * Plain HTTP: the cooperative-case broker injection path. If a broker rule
   * exists for the host and the agent did not already send the header, inject
   * the real secret here — it never lived in the agent's env.
   */
  private handlePlainHttp(
    socket: net.Socket,
    method: string,
    target: string,
    headerText: string,
    fullChunk: Buffer,
    headerEnd: number,
  ): void {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      socket.destroy();
      return;
    }
    const host = url.hostname.toLowerCase();
    const rule = this.opts.brokerRules?.[host];

    const headerLines = headerText.split('\r\n');
    const requestLine = headerLines[0];
    const existing = headerLines.slice(1).filter((l) => l.length > 0);

    let injected = false;
    if (rule) {
      const already = existing.some(
        (l) => l.split(':')[0].trim().toLowerCase() === rule.header.toLowerCase(),
      );
      if (!already) {
        existing.push(`${rule.header}: ${rule.value}`);
        injected = true;
        this._state.injected += 1;
      }
    }

    const path = url.pathname + url.search;
    const rebuiltLine = requestLine.replace(target, path || '/');
    const newHeader = [rebuiltLine, ...existing, '', ''].join('\r\n');
    const body = headerEnd >= 0 ? fullChunk.subarray(headerEnd + 4) : Buffer.alloc(0);

    const upstream = net.connect(Number(url.port) || 80, url.hostname, () => {
      upstream.write(newHeader);
      if (body.length) upstream.write(body);
      this.meter(socket, upstream, host);
      this.meter(upstream, socket, host);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    void injected;
  }

  private meter(src: net.Socket, dst: net.Socket, host: string): void {
    src.on('data', (data: Buffer) => {
      this._state.bytes += data.length;
      this._state.byHost[host] = (this._state.byHost[host] || 0) + data.length;
      // Mid-stream byte-cap enforcement: cut the tunnel if it blows the cap.
      if (this.opts.maxBytes && this._state.bytes > this.opts.maxBytes) {
        this._state.blocked += 1;
        src.destroy();
        dst.destroy();
        return;
      }
      try {
        dst.write(data);
      } catch {
        src.destroy();
      }
    });
    src.on('end', () => {
      try {
        dst.end();
      } catch {
        /* already closed */
      }
    });
  }

  dispose(): void {
    for (const s of this.sockets) {
      try {
        s.destroy();
      } catch {
        /* noop */
      }
    }
    this.sockets.clear();
    try {
      this.server.close();
    } catch {
      /* noop */
    }
  }
}

/** Helper used by the standalone subprocess entry: serialize state to JSON. */
export function serializeState(state: Readonly<EgressMeterState>): string {
  return JSON.stringify(state);
}

// Keep `http` imported for the standalone entry's type-only usage marker.
void http;
