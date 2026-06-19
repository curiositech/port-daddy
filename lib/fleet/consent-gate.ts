/**
 * Consent gate — the single chokepoint every personal-agent output sink
 * MUST call before touching PII.
 *
 * The operator stated the hard rule plainly: "DO NOT exfiltrate user data
 * anywhere. Every personal-agent output sink that touches PII must call
 * through a consent-gate.ts that checks an opt-in flag."
 *
 * Design:
 *   - Default is closed. Sinks refuse to dispatch PII unless the operator
 *     explicitly opted in for that sink kind.
 *   - Opt-ins live in ~/.port-daddy/personal-consent.json so they survive
 *     daemon restarts and are operator-readable in plain text.
 *   - Each opt-in is per (sink kind, recipient pattern) so granting
 *     "email:send to your-own-address@gmail.com" doesn't also grant
 *     "email:send to random@externaldomain.com".
 *   - The gate logs every grant / deny / dispatch so the operator can
 *     audit what was actually sent.
 *
 * What counts as PII:
 *   The agent (or the sink) sets `payload.pii` to 'none' | 'low' | 'high'.
 *   - 'none'  : no personal data. Free to dispatch.
 *   - 'low'   : aggregated / synthetic. Requires opt-in for sink kind.
 *   - 'high'  : raw operator data (calendar contents, contact names,
 *               message excerpts). Requires opt-in for sink kind AND
 *               recipient must match an allowlist pattern.
 *
 * The fleet engine should NOT bypass this. Sinks call `assertAllowed`
 * before they touch network or filesystem boundaries.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { OutputPayload, OutputSinkKind } from './types.js';

const DEFAULT_CONFIG_PATH = join(homedir(), '.port-daddy', 'personal-consent.json');
const DEFAULT_AUDIT_LOG = join(homedir(), '.port-daddy', 'personal-consent.log.jsonl');

export interface ConsentRecord {
  /** Sink the operator opted in for (e.g. "email", "calendar"). */
  sink: OutputSinkKind;
  /** PII tier the operator allowed. */
  maxPii: 'low' | 'high';
  /** Glob/substring patterns the recipient must match. Empty = any
   *  recipient allowed at the granted tier. */
  recipientAllowlist?: string[];
  /** Epoch ms when the operator opted in. */
  grantedAt: number;
  /** Optional expiry. If set and `< Date.now()`, treat as revoked. */
  expiresAt?: number;
  /** Operator's freeform reason ("for my morning briefing"). */
  reason?: string;
}

export interface ConsentDecision {
  allowed: boolean;
  /** Why the decision was made — surfaced in error messages and audit. */
  reason: string;
  /** The matched record (if allowed). */
  record?: ConsentRecord;
}

export interface ConsentGateOptions {
  configPath?: string;
  auditLogPath?: string;
  /** Override the file reader (tests). */
  readFile?: (path: string) => string | null;
  /** Override the audit writer (tests). */
  appendAudit?: (line: string) => void;
}

export class ConsentGate {
  private readonly configPath: string;
  private readonly auditLogPath: string;
  private readonly readFileImpl: (path: string) => string | null;
  private readonly appendAuditImpl: (line: string) => void;

  constructor(opts: ConsentGateOptions = {}) {
    this.configPath = opts.configPath ?? DEFAULT_CONFIG_PATH;
    this.auditLogPath = opts.auditLogPath ?? DEFAULT_AUDIT_LOG;
    this.readFileImpl = opts.readFile ?? defaultRead;
    this.appendAuditImpl = opts.appendAudit ?? this.defaultAudit.bind(this);
  }

  /**
   * Decide whether `payload` is allowed to dispatch through `sink`.
   * Sinks should call this and throw if `decision.allowed === false`.
   */
  evaluate(sink: OutputSinkKind, payload: OutputPayload): ConsentDecision {
    const pii = payload.pii ?? 'high'; // Default-deny: missing pii flag = treat as high.

    if (pii === 'none') {
      const decision: ConsentDecision = {
        allowed: true,
        reason: 'payload.pii=none — no consent required',
      };
      this.audit('allow', sink, payload, decision);
      return decision;
    }

    const records = this.loadRecords();
    const candidate = records.find((r) => r.sink === sink && !isExpired(r));
    if (!candidate) {
      const decision: ConsentDecision = {
        allowed: false,
        reason:
          `No consent grant for sink="${sink}" at pii="${pii}". ` +
          `Operator must run: pd fleet consent grant --sink ${sink} --tier ${pii}`,
      };
      this.audit('deny', sink, payload, decision);
      return decision;
    }

    if (pii === 'high' && candidate.maxPii !== 'high') {
      const decision: ConsentDecision = {
        allowed: false,
        reason:
          `Consent for sink="${sink}" capped at maxPii=${candidate.maxPii}, ` +
          `but payload.pii=high. Upgrade via pd fleet consent grant --sink ${sink} --tier high`,
        record: candidate,
      };
      this.audit('deny', sink, payload, decision);
      return decision;
    }

    if (candidate.recipientAllowlist && candidate.recipientAllowlist.length > 0) {
      const recipient = payload.recipient ?? '';
      const matched = candidate.recipientAllowlist.some((pattern) => recipientMatches(recipient, pattern));
      if (!matched) {
        const decision: ConsentDecision = {
          allowed: false,
          reason:
            `Recipient "${recipient}" does not match allowlist ` +
            `(${candidate.recipientAllowlist.join(', ')}) for sink="${sink}"`,
          record: candidate,
        };
        this.audit('deny', sink, payload, decision);
        return decision;
      }
    }

    const decision: ConsentDecision = {
      allowed: true,
      reason: `Matched consent record granted ${new Date(candidate.grantedAt).toISOString()}`,
      record: candidate,
    };
    this.audit('allow', sink, payload, decision);
    return decision;
  }

  /**
   * Sink-side helper. Throws a tagged error when consent is denied so
   * the fleet engine can route it to `on_failure:` cleanly.
   */
  assertAllowed(sink: OutputSinkKind, payload: OutputPayload): void {
    const decision = this.evaluate(sink, payload);
    if (!decision.allowed) {
      const err = new Error(decision.reason);
      (err as Error & { code?: string }).code = 'PD_CONSENT_DENIED';
      throw err;
    }
  }

  /**
   * Persist a new consent grant. Called by `pd fleet consent grant` (CLI).
   * Replaces any prior record for the same (sink) key — the operator
   * always sees one row per sink in the config file.
   */
  grant(record: ConsentRecord): void {
    const all = this.loadRecords().filter((r) => r.sink !== record.sink);
    all.push(record);
    this.writeRecords(all);
    this.audit('grant', record.sink, undefined, {
      allowed: true,
      reason: `granted maxPii=${record.maxPii} (${record.reason ?? 'no reason given'})`,
      record,
    });
  }

  /** Drop a grant for a sink kind. */
  revoke(sink: OutputSinkKind): void {
    const all = this.loadRecords().filter((r) => r.sink !== sink);
    this.writeRecords(all);
    this.audit('revoke', sink, undefined, { allowed: false, reason: 'revoked by operator' });
  }

  /** Read-only view of every active grant. Used by `pd fleet consent list`. */
  list(): ConsentRecord[] {
    return this.loadRecords();
  }

  // ── internal ────────────────────────────────────────────────────────────

  private loadRecords(): ConsentRecord[] {
    const raw = this.readFileImpl(this.configPath);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isConsentRecord);
    } catch {
      // Malformed config: treat as empty. Operator can fix by hand.
      return [];
    }
  }

  private writeRecords(records: ConsentRecord[]): void {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.configPath, JSON.stringify(records, null, 2) + '\n', 'utf8');
  }

  private defaultAudit(line: string): void {
    const dir = dirname(this.auditLogPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(this.auditLogPath, line + '\n', 'utf8');
  }

  private audit(action: string, sink: OutputSinkKind, payload: OutputPayload | undefined, decision: ConsentDecision): void {
    const entry = {
      action,
      sink,
      pii: payload?.pii ?? null,
      recipient: payload?.recipient ?? null,
      allowed: decision.allowed,
      reason: decision.reason,
      at: new Date().toISOString(),
    };
    try {
      this.appendAuditImpl(JSON.stringify(entry));
    } catch {
      // Audit failures must not block dispatch decisions.
    }
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function defaultRead(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

function isExpired(r: ConsentRecord): boolean {
  return typeof r.expiresAt === 'number' && r.expiresAt < Date.now();
}

function isConsentRecord(value: unknown): value is ConsentRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<ConsentRecord>;
  return typeof r.sink === 'string' && (r.maxPii === 'low' || r.maxPii === 'high') && typeof r.grantedAt === 'number';
}

/**
 * Minimal substring + leading-wildcard match. Intentionally NOT a full
 * glob — recipients are short strings (emails, phone numbers, URLs), and
 * supporting full globs invites a footgun where "*" accidentally grants
 * everything. Keep this dumb on purpose.
 *
 * Supported patterns:
 *   "alice@example.com"  — exact match
 *   "@example.com"       — any address with that domain (email convention)
 *   "newsletter@*"       — any address with that local-part (email convention)
 *   "*foo"               — any string ending in foo
 *   "foo*"               — any string starting with foo
 */
function recipientMatches(recipient: string, pattern: string): boolean {
  if (!pattern) return false;
  const r = recipient.toLowerCase();
  const p = pattern.toLowerCase();
  if (p === r) return true;
  // Email domain convention: "@example.com" matches "*@example.com".
  if (p.startsWith('@') && r.endsWith(p)) return true;
  // Email local-part convention: "alice@*" matches "alice@<anything>".
  if (p.endsWith('@*') && r.startsWith(p.slice(0, -1))) return true;
  if (p.startsWith('*') && r.endsWith(p.slice(1))) return true;
  if (p.endsWith('*') && r.startsWith(p.slice(0, -1))) return true;
  return false;
}

// ─── module-level convenience ──────────────────────────────────────────────

let sharedGate: ConsentGate | null = null;

/**
 * Lazy module-level gate that sinks can reach without plumbing a
 * ConsentGate through every constructor. Tests can call
 * `setSharedConsentGate(new ConsentGate({ ... }))` to inject a fake.
 */
export function getSharedConsentGate(): ConsentGate {
  if (!sharedGate) sharedGate = new ConsentGate();
  return sharedGate;
}

export function setSharedConsentGate(gate: ConsentGate | null): void {
  sharedGate = gate;
}
