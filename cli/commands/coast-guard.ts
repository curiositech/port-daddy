/**
 * pd coast-guard — the operator's READ PATH into the Coast Guard (ADR-0050).
 *
 * The guard sandboxes spawned agents away from your secrets, but it shipped
 * opaque — no way to SEE it.
 *
 *   pd coast-guard status        — confinement / secret broker / egress cap on
 *                                  this machine. Read-only; never prints secret
 *                                  values, only the paths that are protected.
 *   pd coast-guard rent          — the rent → slash loop (phase 7): the current
 *                                  mode (advisory by default) and, for the active
 *                                  session, its coordination-rent breach state.
 *                                  Read-only; it does NOT trigger a slash.
 *
 * The breach/cure ACTIONS are mechanism, driven by the Coordination Guard at
 * commit-time and the daemon — there is deliberately no manual "slash myself"
 * CLI verb (that would be a footgun). This command only SEES the loop.
 */
import { CLIOptions, isJson } from '../types.js';
import * as ui from '../utils/ui.js';
import { coastGuardStatus } from '../../lib/coast-guard.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { readCurrentContext } from '../utils/current-context.js';

const tilde = (p: string): string => p.replace(process.env.HOME || '\0', '~');

export async function handleCoastGuard(
  subcommand: string | undefined,
  options: CLIOptions,
): Promise<void> {
  const sub = (subcommand || 'status').toLowerCase();
  if (sub === 'status') {
    printStatus(options);
    return;
  }
  if (sub === 'rent') {
    await printRent(options);
    return;
  }
  ui.error(`Unknown subcommand '${sub}'. Try: pd coast-guard status | pd coast-guard rent`);
  process.exitCode = 1;
}

function printStatus(options: CLIOptions): void {
  const s = coastGuardStatus();
  if (isJson(options)) {
    console.log(JSON.stringify(s, null, 2));
    return;
  }

  const mark = (ok: boolean): string => (ok ? '✓' : '✗');

  ui.message(
    `${ui.fmtBold('Coast Guard')}  ${s.onByDefault ? 'on by default' : ui.dim('OFF (PD_COAST_GUARD_OFF=1)')}`,
  );
  if (s.confinementAvailable) {
    ui.success(`Spawned agents are confined via ${s.mechanism} on ${s.platform}.`);
  } else {
    ui.warn(`No OS sandbox on ${s.platform} — spawns would run UNCONFINED (mechanism: none).`);
  }

  ui.table(
    ['Protection', 'In force'],
    [
      ['Secret broker', `${mark(s.secretBroker)} raw provider keys scrubbed from the agent env`],
      ['Dotenv under $HOME', `${mark(s.protects.dotenvUnderHome)} every .env / .env.local read denied`],
      ['Egress spend cap', `${mark(s.egressMetering)} outbound forced through a hard-capped meter (per-spawn)`],
      ['OS confinement', `${mark(s.confinementAvailable)} ${s.mechanism}`],
    ],
    { title: 'What it does' },
  );

  ui.message(ui.dim(`Protected directories: ${s.protects.deniedDirs.map(tilde).join(', ')}`));
}

interface RentStatusResponse {
  success?: boolean;
  mode?: 'off' | 'advisory' | 'enforce';
  principal?: string;
  project?: string;
  state?: { breachCount?: number; firstBreachAt?: number; lastEventAt?: number } | null;
  error?: string;
}

async function printRent(options: CLIOptions): Promise<void> {
  // The breach state is per-session; pass the active session if we have one so
  // the daemon can resolve THIS principal's breach count (server-side — the CLI
  // never names a foreign principal).
  const ctx = readCurrentContext();
  const qs = ctx?.sessionId ? `?sessionId=${encodeURIComponent(ctx.sessionId)}` : '';

  let body: RentStatusResponse;
  try {
    const res = await pdFetch(`${PORT_DADDY_URL}/coast-guard/rent-status${qs}`);
    body = (await res.json()) as RentStatusResponse;
    if (!res.ok) {
      ui.error(body?.error || `rent-status failed (${res.status})`);
      process.exitCode = 1;
      return;
    }
  } catch (err) {
    ui.error(`Could not reach the daemon: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  if (isJson(options)) {
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  const mode = body.mode ?? 'advisory';
  ui.message(`${ui.fmtBold('Coordination-rent → slash')}  mode: ${ui.fmtBold(mode)}`);
  if (mode === 'advisory') {
    ui.message(
      ui.dim(
        'ADVISORY (default): a repeated rent breach is logged with the slash that WOULD ' +
          'happen, but no bond is debited. Enabling enforcement is an operator decision.',
      ),
    );
  } else if (mode === 'off') {
    ui.message(ui.dim('OFF: the rent → slash loop is disabled.'));
  } else {
    ui.warn('ENFORCE: a repeated rent breach DEBITS the breaching principal\'s bond (graduated).');
  }

  if (body.principal && body.state) {
    const n = body.state.breachCount ?? 0;
    const tier = n <= 1 ? 'grace (first miss → no slash)' : `escalating (breach #${n})`;
    ui.message(`Principal ${ui.fmtBold(body.principal)}: ${n} un-cured breach(es) — ${tier}.`);
  } else if (body.principal) {
    ui.message(`Principal ${ui.fmtBold(body.principal)}: no recorded rent breaches.`);
  } else {
    ui.message(ui.dim('No active session — showing the daemon mode only.'));
  }
}
