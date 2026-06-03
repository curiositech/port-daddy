/**
 * `pd attest` — the honest self-report (ADR-0045).
 *
 * Merges two halves: the daemon-side report (GET /attest — integrity, schema,
 * perms) and client-side checks only the CLI can do (CLI↔daemon version match;
 * brew-hash provenance is a staged follow-up). Applies the honest-green rule and
 * exits NON-ZERO when any CRITICAL invariant is not satisfied, so scripts / CI /
 * boot gates fail loudly. `--json` prints the merged report instead.
 */
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import {
  runAttest,
  summarize,
  exitCode,
  renderReport,
  type InvariantResult,
} from '../../lib/attest.js';
import { createInvariants, type AttestContext } from '../../lib/attest-invariants.js';
import type { CLIOptions } from '../types.js';

interface ServerReport {
  results?: InvariantResult[];
}

/** Merge server + client results by id; prefer the non-skipped contributor. */
function mergeResults(server: InvariantResult[], client: InvariantResult[]): InvariantResult[] {
  const byId = new Map<string, InvariantResult>();
  for (const r of [...server, ...client]) {
    const existing = byId.get(r.id);
    if (!existing) {
      byId.set(r.id, r);
    } else if (existing.status === 'skipped' && r.status !== 'skipped') {
      byId.set(r.id, r); // a real verdict beats a skip
    }
  }
  return [...byId.values()];
}

export async function handleAttest(
  _args: string[],
  options: CLIOptions,
  cliVersion: string,
): Promise<void> {
  // 1) daemon-side report
  let serverResults: InvariantResult[] = [];
  let daemonVersion: string | undefined;
  try {
    const res = await pdFetch(`${PORT_DADDY_URL}/attest`);
    const body = (await res.json()) as { report?: ServerReport };
    serverResults = body.report?.results ?? [];
  } catch {
    // daemon unreachable — the client-side daemon-responds check will FAIL loudly.
  }
  try {
    const h = await pdFetch(`${PORT_DADDY_URL}/health`);
    daemonVersion = ((await h.json()) as { version?: string }).version;
  } catch {
    /* leave undefined */
  }

  // 2) client-side checks (the install/version things the daemon can't see)
  const clientCtx: AttestContext = {
    daemonHealth: async () => (daemonVersion ? { status: 'ok', version: daemonVersion } : null),
    expectedVersion: cliVersion,
  };
  const clientReport = await runAttest(createInvariants(), clientCtx);

  // 3) merge + apply the honest-green rule
  const merged = summarize(mergeResults(serverResults, clientReport.results), Date.now());

  if (options.json) {
    process.stdout.write(JSON.stringify(merged, null, 2) + '\n');
  } else {
    process.stdout.write(renderReport(merged) + '\n');
  }
  process.exit(exitCode(merged));
}
