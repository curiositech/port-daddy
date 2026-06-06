/**
 * pd coast-guard — the operator's READ PATH into the Coast Guard (ADR-0050).
 *
 * The guard sandboxes spawned agents away from your secrets, but it shipped
 * opaque — no way to SEE it. `pd coast-guard status` reports whether spawns are
 * confined on this machine, what the sandbox denies, and that the secret broker
 * + egress cap are in force. Read-only; it never prints secret values, only the
 * paths that are protected.
 */
import { CLIOptions, isJson } from '../types.js';
import * as ui from '../utils/ui.js';
import { coastGuardStatus } from '../../lib/coast-guard.js';

const tilde = (p: string): string => p.replace(process.env.HOME || '\0', '~');

export function handleCoastGuard(subcommand: string | undefined, options: CLIOptions): void {
  const sub = (subcommand || 'status').toLowerCase();
  if (sub !== 'status') {
    ui.error(`Unknown subcommand '${sub}'. Try: pd coast-guard status`);
    process.exitCode = 1;
    return;
  }

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
