/**
 * CLI `pd wallet` — project wallet management
 *
 *   pd wallet show <project>
 *   pd wallet top-up <project> --usd <N> [--yes]
 *   pd wallet history <project> [--since 7d] [--limit N]
 */

import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isJson, isQuiet } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';

interface WalletRow {
  project: string;
  balance_usd?: number;
  balanceUsd?: number;
  commons_pool_usd?: number;
  commonsPoolUsd?: number;
  created_at?: string | number;
  updated_at?: string | number;
  createdAt?: string | number;
  updatedAt?: string | number;
}

interface ActivityEntry {
  timestamp?: string;
  type?: string;
  target?: string;
  identity?: string;
  details?: string | Record<string, unknown>;
}

function parseSince(spec: string | undefined): number | undefined {
  if (!spec) return undefined;
  const m = /^(\d+)\s*([smhd])?$/i.exec(spec.trim());
  if (!m) {
    const n = parseInt(spec, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  const value = parseInt(m[1], 10);
  const unit = (m[2] || 's').toLowerCase();
  const mult = unit === 'd' ? 86400 : unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
  return value * mult;
}

function fmtUsd(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '$0.00';
  return `$${n.toFixed(2)}`;
}

function walletBalance(w: WalletRow | undefined): number | undefined {
  if (!w) return undefined;
  return w.balance_usd ?? w.balanceUsd;
}

function walletCommons(w: WalletRow | undefined): number | undefined {
  if (!w) return undefined;
  return w.commons_pool_usd ?? w.commonsPoolUsd;
}

function fmtClock(ts: string | number | undefined): string {
  if (ts == null) return '-';
  const d = typeof ts === 'string' ? new Date(ts) : new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

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
      { value: 'yes', label: 'Confirm' },
    ],
    default: 'no',
  });
  return ok === 'yes';
}

export async function handleWalletShow(project: string | undefined, options: CLIOptions): Promise<void> {
  if (!project) {
    ui.error('Usage: pd wallet show <project>');
    process.exit(1);
  }
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/wallets/${encodeURIComponent(project)}`);
  const data = (await res.json()) as { wallet?: WalletRow; error?: string } | WalletRow;
  if (!res.ok) {
    ui.error((data as { error?: string }).error || `HTTP ${res.status}`);
    process.exit(1);
  }
  const wallet: WalletRow | undefined =
    (data as { wallet?: WalletRow }).wallet || (data as WalletRow);

  if (isJson(options)) { console.log(JSON.stringify(wallet ?? null, null, 2)); return; }

  if (!wallet || !wallet.project) {
    if (isQuiet(options)) { console.log('missing'); return; }
    ui.warn(`No wallet for project: ${project}`);
    ui.info(`Top up with: pd wallet top-up ${project} --usd <amount>`);
    return;
  }

  if (isQuiet(options)) { console.log(fmtUsd(walletBalance(wallet))); return; }

  console.log('');
  console.log(`Wallet · ${wallet.project}`);
  console.log('─'.repeat(40));
  console.log(`  balance:       ${fmtUsd(walletBalance(wallet))}`);
  console.log(`  commons pool:  ${fmtUsd(walletCommons(wallet))}`);
  const updated = wallet.updated_at ?? wallet.updatedAt;
  if (updated != null) console.log(`  updated:       ${fmtClock(updated)}`);
  console.log('');
}

export async function handleWalletTopUp(project: string | undefined, options: CLIOptions): Promise<void> {
  if (!project) {
    ui.error('Usage: pd wallet top-up <project> --usd <amount>');
    process.exit(1);
  }
  const usdRaw = options.usd;
  const usd = typeof usdRaw === 'number' ? usdRaw : parseFloat(String(usdRaw ?? ''));
  if (!Number.isFinite(usd) || usd <= 0) {
    ui.error('Missing or invalid --usd <amount> (must be > 0)');
    process.exit(1);
  }
  const ok = await confirm(`Top up ${project} with ${fmtUsd(usd)}?`, options);
  if (!ok) { ui.warn('Cancelled.'); process.exit(1); }

  const res: PdFetchResponse = await pdFetch(
    `${PORT_DADDY_URL}/wallets/${encodeURIComponent(project)}/top-up`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usd }) },
  );
  const data = (await res.json()) as { wallet?: WalletRow; error?: string } | WalletRow;
  if (!res.ok) { ui.error((data as { error?: string }).error || `HTTP ${res.status}`); process.exit(1); }
  const wallet: WalletRow | undefined =
    (data as { wallet?: WalletRow }).wallet || (data as WalletRow);

  if (isJson(options)) { console.log(JSON.stringify(wallet ?? {}, null, 2)); return; }
  if (isQuiet(options)) { console.log(fmtUsd(walletBalance(wallet))); return; }

  ui.success(`Topped up ${project} by ${fmtUsd(usd)}`);
  if (wallet) console.log(`  new balance:  ${fmtUsd(walletBalance(wallet))}`);
}

export async function handleWalletHistory(project: string | undefined, options: CLIOptions): Promise<void> {
  if (!project) {
    ui.error('Usage: pd wallet history <project> [--since 7d]');
    process.exit(1);
  }
  const sinceSec = parseSince(options.since as string | undefined) ?? 7 * 86400;
  const params = new URLSearchParams();
  params.set('type', 'wallet.topup,bond.slash');
  params.set('identity', project);
  params.set('since', String(sinceSec));
  if (options.limit) params.set('limit', String(options.limit));
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/activity?${params}`);
  const data = (await res.json()) as { activity?: ActivityEntry[]; entries?: ActivityEntry[]; error?: string };
  if (!res.ok) { ui.error(data.error || `HTTP ${res.status}`); process.exit(1); }

  const rows: ActivityEntry[] = data.activity || data.entries || [];

  if (isJson(options)) { console.log(JSON.stringify({ project, since_seconds: sinceSec, entries: rows }, null, 2)); return; }
  if (isQuiet(options)) { console.log(String(rows.length)); return; }

  console.log('');
  console.log(`Wallet history · ${project} · last ${sinceSec}s · ${rows.length} event(s)`);
  console.log('─'.repeat(72));
  if (rows.length === 0) { console.log('  (no activity)'); console.log(''); return; }
  for (const e of rows) {
    const ts = fmtClock(e.timestamp);
    const type = (e.type || '').padEnd(14).slice(0, 14);
    const detail = typeof e.details === 'string' ? e.details : JSON.stringify(e.details ?? {});
    console.log(`  [${ts}] ${type} ${detail.slice(0, 80)}`);
  }
  console.log('');
}

export async function handleWallet(args: string[], options: CLIOptions): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case 'show': await handleWalletShow(rest[0], options); return;
    case 'top-up':
    case 'topup': await handleWalletTopUp(rest[0], options); return;
    case 'history': await handleWalletHistory(rest[0], options); return;
    case 'budget': await handleWalletBudget(rest[0], options); return;
    case 'raise': await handleWalletRaise(options); return;
    case 'pending': await handleWalletPending(options); return;
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      console.log('Usage:');
      console.log('  pd wallet show <project>');
      console.log('  pd wallet top-up <project> --usd <amount> [--yes]');
      console.log('  pd wallet history <project> [--since 7d] [--limit N]');
      console.log('  pd wallet budget <project> --usd-per-day <N>    # set daily budget (required for spawn)');
      console.log('  pd wallet pending                                # list pending budget cancellations');
      console.log('  pd wallet raise --agent <id> --usd <N>          # clear a pending cancel + top up');
      return;
    default:
      ui.error(`Unknown wallet subcommand: ${sub}`);
      process.exit(1);
  }
}

export async function handleWalletBudget(project: string | undefined, options: CLIOptions): Promise<void> {
  if (!project) {
    ui.error('Usage: pd wallet budget <project> --usd-per-day <N>');
    process.exit(1);
  }
  const raw = (options as Record<string, unknown>)['usd-per-day']
    ?? (options as Record<string, unknown>).usdPerDay
    ?? options.usd;
  const usdPerDay = raw == null ? null : (typeof raw === 'number' ? raw : parseFloat(String(raw)));
  if (usdPerDay != null && (!Number.isFinite(usdPerDay) || usdPerDay <= 0)) {
    ui.error('--usd-per-day must be > 0 (or omit to clear)');
    process.exit(1);
  }

  const res: PdFetchResponse = await pdFetch(
    `${PORT_DADDY_URL}/wallets/${encodeURIComponent(project)}/budget`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usdPerDay }) },
  );
  const data = (await res.json()) as { wallet?: WalletRow; error?: string };
  if (!res.ok) { ui.error(data.error || `HTTP ${res.status}`); process.exit(1); }

  if (isJson(options)) { console.log(JSON.stringify(data.wallet ?? {}, null, 2)); return; }
  if (isQuiet(options)) { console.log(usdPerDay == null ? 'cleared' : `$${usdPerDay.toFixed(2)}/day`); return; }
  ui.success(`Budget for ${project} set to ${usdPerDay == null ? 'none (cleared)' : `$${usdPerDay.toFixed(2)}/day`}`);
}

export async function handleWalletRaise(options: CLIOptions): Promise<void> {
  const agentId = typeof options.agent === 'string' ? options.agent : String(options.agent ?? '');
  if (!agentId) {
    ui.error('Usage: pd wallet raise --agent <agentId> --usd <N> [--new-budget-per-day <N>]');
    process.exit(1);
  }
  const usdRaw = options.usd;
  const usd = typeof usdRaw === 'number' ? usdRaw : parseFloat(String(usdRaw ?? ''));
  if (!Number.isFinite(usd) || usd <= 0) {
    ui.error('--usd must be > 0');
    process.exit(1);
  }
  const newRaw = (options as Record<string, unknown>)['new-budget-per-day']
    ?? (options as Record<string, unknown>).newBudgetPerDay;
  const newBudget = newRaw == null ? undefined : (typeof newRaw === 'number' ? newRaw : parseFloat(String(newRaw)));

  const res: PdFetchResponse = await pdFetch(
    `${PORT_DADDY_URL}/budget/pending/${encodeURIComponent(agentId)}/resolve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'raise', topUpUsd: usd, newBudgetUsdPerDay: newBudget }),
    },
  );
  const data = (await res.json()) as { action?: string; project?: string; error?: string };
  if (!res.ok) { ui.error(data.error || `HTTP ${res.status}`); process.exit(1); }

  if (isJson(options)) { console.log(JSON.stringify(data, null, 2)); return; }
  if (isQuiet(options)) { console.log('raised'); return; }
  ui.success(`Pending cancel for ${agentId} cleared — wallet credited $${usd.toFixed(2)}${newBudget != null ? `, budget → $${newBudget.toFixed(2)}/day` : ''}`);
}

export async function handleWalletPending(options: CLIOptions): Promise<void> {
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/budget/pending`);
  const data = (await res.json()) as { pending?: Array<Record<string, unknown>>; graceMs?: number; error?: string };
  if (!res.ok) { ui.error(data.error || `HTTP ${res.status}`); process.exit(1); }
  const rows = data.pending ?? [];

  if (isJson(options)) { console.log(JSON.stringify({ pending: rows, graceMs: data.graceMs }, null, 2)); return; }
  if (isQuiet(options)) { console.log(String(rows.length)); return; }

  console.log('');
  console.log(`Pending budget cancellations · ${rows.length} · grace ${data.graceMs ?? 60000}ms`);
  console.log('─'.repeat(80));
  if (rows.length === 0) { console.log('  (none)'); console.log(''); return; }
  for (const r of rows) {
    const agentId = String(r.agentId);
    const project = String(r.project);
    const expires = typeof r.expiresAt === 'number' ? new Date(r.expiresAt).toISOString().slice(11, 19) : '-';
    const spent = typeof r.spentTodayUsd === 'number' ? r.spentTodayUsd.toFixed(4) : '?';
    const budget = typeof r.budgetUsdPerDay === 'number' ? r.budgetUsdPerDay.toFixed(2) : '?';
    console.log(`  ${agentId}  project=${project}  spent=$${spent}/day=$${budget}  expires@${expires}`);
  }
  console.log('');
}
