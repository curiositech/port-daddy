/**
 * GET /attest — the daemon-side half of the attestation report (ADR-0045).
 *
 * Runs the invariant checks that need things only the daemon has: the DB handle
 * (integrity_check, schema), the DB file (perms), committed actors. Client-only
 * checks (CLI↔daemon version match, brew-hash provenance, install path) are run
 * by `pd attest` and merged with this. Probes we can't wire here are simply not
 * provided → those invariants come back SKIPPED (honest — never assumed-pass).
 */
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { statSync } from 'node:fs';
import { runAttest } from '../lib/attest.js';
import { createInvariants, CORE_REQUIRED_TABLES, type AttestContext } from '../lib/attest-invariants.js';

interface AttestDeps {
  db: {
    prepare: (sql: string) => { get: (...a: unknown[]) => unknown; all: (...a: unknown[]) => unknown[] };
  };
  version?: string;
  dbPath?: string;
}

export const attestPlugin: FastifyPluginAsync<{ deps: AttestDeps }> = async (fastify, opts) => {
  const { db, version, dbPath } = opts.deps;

  const buildContext = (): AttestContext => ({
    daemonHealth: async () => ({ status: 'ok', version }),
    dbIntegrityCheck: () => {
      try {
        const row = db.prepare('PRAGMA integrity_check').get() as Record<string, string> | undefined;
        // sqlite returns a single row { integrity_check: 'ok' }
        const val = row ? Object.values(row)[0] : undefined;
        return typeof val === 'string' ? val : 'unknown';
      } catch (e) {
        return e instanceof Error ? e.message : 'integrity_check failed';
      }
    },
    schemaTables: () => {
      const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
      return rows.map((r) => r.name);
    },
    requiredTables: CORE_REQUIRED_TABLES,
    dbFileMode: () => {
      if (!dbPath) return null;
      try {
        return statSync(dbPath).mode & 0o777;
      } catch {
        return null;
      }
    },
  });

  fastify.get('/attest', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const report = await runAttest(createInvariants(), buildContext());
      // 200 always — the report carries the verdict. Callers gate on report.green
      // / report.criticalProblems, not on HTTP status (a 500 here would itself be
      // a silent failure of the thing meant to detect silent failures).
      return { success: true, report };
    } catch (error) {
      reply.code(500);
      return { success: false, error: error instanceof Error ? error.message : 'attest failed' };
    }
  });
};
