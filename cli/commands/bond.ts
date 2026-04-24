/**
 * CLI `pd bond` — bond escrow inspection and manual slashes
 *
 *   pd bond list [--project P] [--state S] [--limit N]
 *   pd bond slash <id> --portion 0.5 --reason "<text>" [--yes]
 */

import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isJson, isQuiet } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';

interface BondRecord {
  id: number;
  project: string;
  agent_id?: string;
  agentId?: string;
  archetype?: string | null;
  bond_usd?: number;
  bondUsd?: number;
  state: 'escrowed' | 'running' | 'exiting' | 'refunded' | 'slashed';
  escrowed_at?: string | number;
  escrowedAt?: string | number;
  resolved_at?: string | number | null;
  slash_reason?: string | null;
}

function fmtUsd(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '$0.00';
  return `$${n.toFixed(4)}`;
}

function pad(s: string | number | null | undefined, n: number): string {
  const v = s == null ? '' : String(s);
  return v.length >= n ? v.slice(0, n) : v.padEnd(n);
}

function bondAgent(b: BondRecord): string { return b.agent_id ?? b.agentId ?? ''; }
function bondUsd(b: BondRecord): number | undefined { return b.bond_usd ?? b.bondUsd; }
function bondEscrowedAt(b: BondRecord): string { return String(b.escrowed_at ?? b.escrowedAt ?? '-'); }

async function confirm(label: string, options: CLIOptions): Promise<boolean> {
  if (options.yes) return true;
  if (!ui.canPrompt()) {
    ui.error(`${label} (use --yes to skip confirmation in non-interactive mode)`);
    return false;
  }
  const ok = await ui.select<'yes' | 'no'>({
    label,
    choices: [
      { value: 'no', label: 'Cancel' },
      { value: 'yes', label: 'Confirm slash' },
    ],
    default: 'no',
  });
  return ok === 'yes';
}

export async function handleBondList(options: CLIOptions): Promise<void> {
  const params = new URLSearchParams();
  if (options.project) params.set('project', String(options.project));
  if (options.state) params.set('state', String(options.state));
  if (options.limit) params.set('limit', String(options.limit));
  const qs = params.toString() ? `?${params}` : '';
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/bonds${qs}`);
  const data = (await res.json()) as { bonds?: BondRecord[]; error?: string } | BondRecord[];
  if (!res.ok) { ui.error((data as { error?: string }).error || `HTTP ${res.status}`); process.exit(1); }
  const bonds: BondRecord[] = Array.isArray(data) ? (data as BondRecord[]) : (data as { bonds?: BondRecord[] }).bonds || [];

  if (isJson(options)) { console.log(JSON.stringify(bonds, null, 2)); return; }
  if (isQuiet(options)) { console.log(String(bonds.length)); return; }

  console.log('');
  console.log(`Bonds · ${bonds.length} entr${bonds.length === 1 ? 'y' : 'ies'}`);
  console.log('─'.repeat(96));
  console.log(`${pad('id', 6)}  ${pad('project', 16)}  ${pad('agent', 24)}  ${pad('state', 10)}  ${pad('usd', 10)}  escrowed_at`);
  console.log('─'.repeat(96));
  if (bonds.length === 0) { console.log('  (no bonds)'); console.log(''); return; }
  for (const b of bonds) {
    console.log(`${pad(b.id, 6)}  ${pad(b.project, 16)}  ${pad(bondAgent(b), 24)}  ${pad(b.state, 10)}  ${pad(fmtUsd(bondUsd(b)), 10)}  ${bondEscrowedAt(b)}`);
  }
  console.log('');
}

export async function handleBondSlash(idArg: string | undefined, options: CLIOptions): Promise<void> {
  if (!idArg) {
    ui.error('Usage: pd bond slash <id> --portion 0..1 --reason "<text>"');
    process.exit(1);
  }
  const id = parseInt(idArg, 10);
  if (!Number.isFinite(id) || id <= 0) { ui.error(`Invalid bond id: ${idArg}`); process.exit(1); }
  const portionRaw = options.portion;
  const portion = typeof portionRaw === 'number' ? portionRaw : parseFloat(String(portionRaw ?? ''));
  if (!Number.isFinite(portion) || portion < 0 || portion > 1) {
    ui.error('Missing or invalid --portion (must be a number between 0 and 1)');
    process.exit(1);
  }
  const reason = options.reason ? String(options.reason).trim() : '';
  if (!reason) { ui.error('Missing --reason "<text>" (slashes are audited; reason is required)'); process.exit(1); }

  const ok = await confirm(`Slash bond ${id} by portion=${portion} with reason "${reason}"?`, options);
  if (!ok) { ui.warn('Cancelled.'); process.exit(1); }

  const res: PdFetchResponse = await pdFetch(
    `${PORT_DADDY_URL}/bonds/${id}/slash`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portion, reason }) },
  );
  const data = (await res.json()) as { ok?: boolean; bond?: BondRecord; error?: string };
  if (!res.ok) { ui.error(data.error || `HTTP ${res.status}`); process.exit(1); }

  if (isJson(options)) { console.log(JSON.stringify(data, null, 2)); return; }
  if (isQuiet(options)) { console.log('ok'); return; }

  ui.success(`Bond ${id} slashed · portion=${portion} · ${reason}`);
  if (data.bond) {
    console.log(`  state:  ${data.bond.state}`);
    console.log(`  bond:   ${fmtUsd(bondUsd(data.bond))}`);
  }
}

export async function handleBond(args: string[], options: CLIOptions): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case 'list':
    case 'ls': await handleBondList(options); return;
    case 'slash': await handleBondSlash(rest[0], options); return;
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      console.log('Usage:');
      console.log('  pd bond list [--project P] [--state S] [--limit N]');
      console.log('  pd bond slash <id> --portion 0..1 --reason "<text>" [--yes]');
      return;
    default:
      ui.error(`Unknown bond subcommand: ${sub}`);
      process.exit(1);
  }
}
