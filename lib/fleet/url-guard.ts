/**
 * SSRF guard for fleet OUTPUT sinks (ADR-0093 §Phase-1 hardening).
 *
 * WHY THIS EXISTS: `lib/fleet/outputs/webhook.ts` did `fetch(payload.recipient)`
 * with ZERO URL validation, while its docstring and the io-wiring build plan
 * claimed it was "SSRF-guarded". It was not. An agent (or an untrusted trigger
 * driving one) could POST the operator's context to:
 *   - cloud metadata: http://169.254.169.254/latest/meta-data/...
 *   - loopback services: http://127.0.0.1:6379 , http://[::1]:8080
 *   - private ranges: http://10.x , http://192.168.x , http://172.16-31.x
 *   - obfuscated IPs: http://2852039166/ (decimal), http://0177.0.0.1 (octal)
 *
 * This module is the real guard. It is a PURE function over the literal URL:
 * it parses the host, classifies IP-literal forms (incl. decimal/octal/hex and
 * IPv6, incl. IPv4-mapped), and blocks the SSRF-class destinations. An optional
 * allowlist tightens it to known hosts only.
 *
 * HONEST LIMITATION (in code, per the Coast Guard honesty rule): a literal
 * guard cannot stop DNS rebinding — a hostname that resolves to a private IP at
 * connect time. The sound mitigation is allowlist-only mode plus resolve-and-
 * pin at the socket layer (ADR-0093 §Residual, follow-up). We never claim more
 * than we deliver.
 */

export class SsrfBlockedError extends Error {
  readonly code = 'SSRF_BLOCKED';
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

export interface UrlGuardOptions {
  /** If present, ONLY these hostnames (exact, case-insensitive) are allowed.
   *  This is the sound mode; without it we fall back to block-known-bad. */
  allowlist?: readonly string[];
  /** Permitted URL schemes. Default: http, https. */
  allowedSchemes?: readonly string[];
}

/** Parse a host token into a 32-bit IPv4 number if it is an IPv4 literal in
 *  ANY of the legal-but-evil forms (dotted, decimal, octal, hex, or mixed).
 *  Returns null if it is not an IPv4 literal. */
export function parseIpv4Maybe(host: string): number | null {
  const h = host.trim();
  if (h.length === 0) return null;

  // Single integer form: decimal (3232235521), hex (0xC0A80001), octal (017700000001)
  if (/^(0x[0-9a-f]+|0[0-7]*|[1-9][0-9]*)$/i.test(h) && !h.includes('.')) {
    const n = Number(h.startsWith('0x') || h.startsWith('0X') ? h : h.startsWith('0') ? parseInt(h, 8) : h);
    return Number.isInteger(n) && n >= 0 && n <= 0xffffffff ? n >>> 0 : null;
  }

  const parts = h.split('.');
  if (parts.length < 1 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (p.length === 0) return null;
    let v: number;
    if (/^0x[0-9a-f]+$/i.test(p)) v = parseInt(p, 16);
    else if (/^0[0-7]+$/.test(p)) v = parseInt(p, 8);
    else if (/^[0-9]+$/.test(p)) v = parseInt(p, 10);
    else return null;
    if (!Number.isInteger(v) || v < 0) return null;
    nums.push(v);
  }
  // a.b.c.d (each octet <256) is the common case; shorter forms (a, a.b, a.b.c)
  // are legal per inet_aton and used to dodge naive parsers — handle them too.
  let value = 0;
  if (nums.length === 4) {
    if (nums.some((n) => n > 0xff)) return null;
    value = ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
  } else if (nums.length === 1) {
    if (nums[0] > 0xffffffff) return null;
    value = nums[0] >>> 0;
  } else {
    // 2 or 3 parts: last part fills the remaining low bytes.
    const head = nums.slice(0, -1);
    const tail = nums[nums.length - 1];
    if (head.some((n) => n > 0xff)) return null;
    const tailBits = (4 - head.length) * 8;
    if (tail >= 2 ** tailBits) return null;
    let v = 0;
    head.forEach((n, i) => { v |= n << (24 - i * 8); });
    value = (v | tail) >>> 0;
  }
  return value;
}

/** Is a 32-bit IPv4 in a blocked range (loopback, private, link-local,
 *  unspecified, broadcast, CGNAT, etc.)? */
function ipv4Blocked(ip: number): boolean {
  const a = (ip >>> 24) & 0xff;
  const b = (ip >>> 16) & 0xff;
  if (a === 0) return true;                       // 0.0.0.0/8 (incl. unspecified)
  if (a === 10) return true;                      // 10/8 private
  if (a === 127) return true;                     // 127/8 loopback
  if (a === 169 && b === 254) return true;        // 169.254/16 link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true;        // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a >= 224) return true;                       // 224/4 multicast + 240/4 reserved
  return false;
}

/**
 * Extract the embedded IPv4 (as a 32-bit int) from an IPv4-mapped/compat IPv6
 * literal, or null. Handles BOTH the dotted-decimal tail (`::ffff:169.254.169.254`)
 * AND the hex-hextet tail Node normalizes to (`::ffff:a9fe:a9fe`, `::ffff:a00:1`,
 * `::ffff:7f00:1`) — the latter is what `url.hostname` actually yields, and the
 * form the previous dotted-only regex let slip past (SSRF metadata bypass).
 */
function mappedIpv4(host: string): number | null {
  const m = /^(?:::ffff:|::)([0-9a-f.:]+)$/i.exec(host);
  if (!m) return null;
  const tail = m[1];
  if (tail.includes('.')) {
    // ::ffff:169.254.169.254  (and ::ffff:d.d:d.d style mixes end in dotted)
    const dotted = tail.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    return dotted ? parseIpv4Maybe(dotted[1]) : null;
  }
  // Hex-hextet tail carrying the low 32 bits: one or two groups.
  const groups = tail.split(':').filter((g) => g.length > 0);
  if (groups.length === 0 || groups.length > 2) return null;
  let low32: number;
  if (groups.length === 2) {
    const hi = parseInt(groups[0], 16);
    const lo = parseInt(groups[1], 16);
    if (!Number.isInteger(hi) || !Number.isInteger(lo) || hi > 0xffff || lo > 0xffff) return null;
    low32 = ((hi << 16) | lo) >>> 0;
  } else {
    // A single group after `::` fills only the lowest 16 bits (e.g. ::ffff:1).
    const lo = parseInt(groups[0], 16);
    if (!Number.isInteger(lo) || lo > 0xffff) return null;
    low32 = lo >>> 0;
  }
  return low32;
}

/** Block dangerous IPv6 literals (loopback, unspecified, link-local, ULA, and
 *  IPv4-mapped/compat that wrap a blocked v4). Host arrives WITHOUT brackets. */
function ipv6Blocked(host: string): boolean {
  const h = host.toLowerCase();
  if (h === '::1' || h === '::') return true;     // loopback / unspecified
  if (h.startsWith('fe80')) return true;          // link-local
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA fc00::/7
  if (h.startsWith('ff')) return true;            // multicast
  // IPv4-mapped / -compat (dotted OR hex-hextet, incl. Node's normalized form).
  const v4 = mappedIpv4(h);
  if (v4 !== null && ipv4Blocked(v4)) return true;
  return false;
}

/** Classify whether a hostname/IP-literal is an SSRF-class blocked target. */
export function isBlockedHost(rawHost: string): boolean {
  let host = (rawHost ?? '').trim().toLowerCase();
  if (host.length === 0) return true;
  // Strip IPv6 brackets.
  if (host.startsWith('[') && host.endsWith(']')) {
    return ipv6Blocked(host.slice(1, -1));
  }
  if (host.includes(':')) {
    // Bare IPv6 — url.hostname strips the brackets, and IPv4-MAPPED forms
    // (::ffff:169.254.169.254) legitimately contain dots, so ANY ':' here is
    // IPv6 (the port is not part of url.hostname). A prior `!includes('.')`
    // guard let the bracketed mapped-metadata form slip past — SSRF bypass.
    return ipv6Blocked(host);
  }
  // Obvious loopback names.
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === 'metadata' || host.endsWith('.internal')) return true;
  const v4 = parseIpv4Maybe(host);
  if (v4 !== null) return ipv4Blocked(v4);
  return false;
}

/**
 * Throw SsrfBlockedError unless `raw` is a safe outbound URL. On success
 * returns the parsed URL. This is the guard webhook.ts (and any other outbound
 * sink) MUST call before fetch().
 */
export function assertSafeOutboundUrl(raw: string, opts: UrlGuardOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfBlockedError(`outbound URL is not parseable`);
  }
  const schemes = (opts.allowedSchemes ?? ['http:', 'https:']).map((s) =>
    s.endsWith(':') ? s.toLowerCase() : `${s.toLowerCase()}:`,
  );
  if (!schemes.includes(url.protocol.toLowerCase())) {
    throw new SsrfBlockedError(`scheme ${url.protocol} is not permitted for outbound webhooks`);
  }
  // Credentials in the URL are a classic exfil/confusion vector.
  if (url.username || url.password) {
    throw new SsrfBlockedError('outbound URL must not embed credentials');
  }

  const host = url.hostname.toLowerCase();
  if (opts.allowlist && opts.allowlist.length > 0) {
    const allow = opts.allowlist.map((h) => h.trim().toLowerCase());
    if (!allow.includes(host)) {
      throw new SsrfBlockedError(`host ${host} is not in the outbound allowlist`);
    }
    // Even allowlisted hosts must not be IP-literals into private space.
  }
  if (isBlockedHost(host)) {
    throw new SsrfBlockedError(`host ${host} resolves to a blocked (private/loopback/metadata) target`);
  }
  return url;
}
