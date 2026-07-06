/**
 * GET /safe/scan — the daemon-side host-safety posture audit (ADR-0088 Phase A,
 * A9/A10). Runs the read-only sensors A1–A7 via {@link runSafeScan} and folds
 * them into a deterministic-for-fixed-host posture report (score + Safe Room
 * state + blast radius + the verbatim `HONEST_LIMITS` footer).
 *
 * Why the daemon owns this: the A5 binary-trust ledger is daemon-resident
 * (`bun:sqlite`) — the scan records every binary it assessed into it so a re-scan
 * is cached and every future enforcement phase reads from the same durable spine.
 * The CLI (`pd safe scan`) and the MCP `safe_scan` tool both hit this route so
 * they emit byte-identical reports.
 *
 * 100% READ-ONLY of host state. The ONLY write is the A5 ledger record (the
 * durable spine, not host state). The opt-in reversible `chmod`
 * (`pd safe fix --auto`) is NOT exposed here — it is a deliberate, explicit,
 * client-side action so the daemon never mutates the operator's file modes.
 *
 * NO RAW SECRET ever leaves this boundary: a `SecretFinding` already carries only
 * `path/line/ruleId/last4/entropy`; the report copies those through unchanged.
 */
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { runSafeScan, type LedgerSink } from '../lib/safe/scan.js';
import { TrustLedger } from '../lib/safe/trust-ledger.js';
import type { DatabaseInstance } from '../lib/sqlite-runtime.js';

interface SafeDeps {
  db?: DatabaseInstance;
  logger?: { warn?: (msg: string) => void };
}

export const safePlugin: FastifyPluginAsync<{ deps: SafeDeps }> = async (fastify, opts) => {
  const { db, logger } = opts.deps;

  // The A5 trust ledger — daemon-resident (bun:sqlite). Built once at register
  // time; its schema migration boots here so the first scan does not pay it.
  let ledger: LedgerSink | undefined;
  if (db) {
    try {
      ledger = new TrustLedger(db);
    } catch (e) {
      // A broken ledger must never sink the scan — it degrades to live-assessment
      // only (the report still stands; it just won't be cached/durable).
      logger?.warn?.(
        `safe/scan: trust ledger unavailable, scanning without durable cache: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  fastify.get('/safe/scan', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const q = (request.query ?? {}) as Record<string, unknown>;
      const allowlistedHosts =
        typeof q.allow === 'string' && q.allow.length > 0
          ? q.allow.split(',').map((h) => h.trim()).filter(Boolean)
          : undefined;

      const result = runSafeScan({
        ...(ledger ? { ledger } : {}),
        ...(allowlistedHosts ? { allowlistedHosts } : {}),
      });

      // 200 always — the report carries its own verdict (score/state). A caller
      // gates on report.state, not on HTTP status, exactly like /attest.
      return { success: true, report: result.report };
    } catch (error) {
      reply.code(500);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'safe scan failed',
      };
    }
  });
};
