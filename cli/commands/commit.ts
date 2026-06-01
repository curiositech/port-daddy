/**
 * `pd commit` / `pd obligations` — durable commitments CLI (ADR-0041 slice).
 *
 *   pd commit "<object>" [--success <cmd>] [--impossible <cmd>] [--motivation <cmd>]
 *                        [--scope claim|review|standing|default] [--strategy single|open]
 *   pd obligations [--overdue] [--mine] [--owner <actorId>]
 *   pd commit close <id> --oracle <ref>
 *
 * Every surface SHOWS its result — the created/closed row, or the overdue list —
 * not just an "ok". `due_at` is daemon-derived (Law 1); `close` needs an oracle
 * (Law 2). The owner defaults to the current session/actor id from local context.
 */

import { CLIOptions, isJson } from '../types.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { readCurrentContext } from '../utils/current-context.js';
import * as ui from '../utils/ui.js';

interface Commitment {
  id: string;
  ownerActorId: string;
  objectText: string;
  successCheck: string | null;
  impossibleCheck: string | null;
  motivationCheck: string | null;
  dueAt: number;
  commitmentStrategy: string;
  scope: string;
  state: string;
  closedByOracleRef: string | null;
  createdAt: number;
  lastTouchedAt: number;
}

interface OverdueCommitment {
  id: string;
  ownerActorId: string;
  objectText: string;
  dueAt: number;
  overdueByMs: number;
  scope: string;
  commitmentStrategy: string;
}

function readOption(options: CLIOptions, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = options[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function resolveOwner(options: CLIOptions): string | undefined {
  const explicit = readOption(options, 'owner', 'as', 'actor');
  if (explicit) return explicit;
  const ctx = readCurrentContext();
  return ctx?.agentId;
}

function fmtWhen(ms: number): string {
  try {
    return new Date(ms).toISOString();
  } catch {
    return String(ms);
  }
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = (m / 60).toFixed(1);
  return `${h}h`;
}

function printCommitment(c: Commitment): void {
  ui.success(`Commitment ${c.id}`);
  console.log(`  ${ui.fmtBold(c.objectText)}`);
  console.log(`  state=${c.state}  scope=${c.scope}  strategy=${c.commitmentStrategy}`);
  console.log(`  owner=${c.ownerActorId}`);
  console.log(`  due=${fmtWhen(c.dueAt)} ${ui.dim('(daemon-derived from scope — Law 1)')}`);
  if (c.successCheck) console.log(`  success=${c.successCheck}`);
  if (c.impossibleCheck) console.log(`  impossible=${c.impossibleCheck}`);
  if (c.motivationCheck) console.log(`  motivation=${c.motivationCheck}`);
  if (c.closedByOracleRef) console.log(`  closed-by-oracle=${c.closedByOracleRef}`);
}

async function handleCommitClose(args: string[], options: CLIOptions): Promise<void> {
  const id = args[0] || readOption(options, 'id');
  const oracleRef = readOption(options, 'oracle', 'oracleRef', 'ref');
  if (!id) {
    ui.error('Usage: pd commit close <id> --oracle <ref>');
    process.exit(1);
  }
  if (!oracleRef) {
    ui.error('close requires --oracle <ref> (released claim / commit SHA / test id). A note does not close a commitment (ADR-0041 Law 2).');
    process.exit(1);
  }
  const res = await pdFetch(`${PORT_DADDY_URL}/commitments/${encodeURIComponent(id)}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oracleRef }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    commitment?: Commitment;
    error?: string;
  };
  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    if (!data.success) process.exit(1);
    return;
  }
  if (!data.success || !data.commitment) {
    ui.error(data.error || 'Failed to close commitment');
    process.exit(1);
  }
  printCommitment(data.commitment);
}

export async function handleCommit(args: string[], options: CLIOptions): Promise<void> {
  const sub = args[0];
  if (sub === 'close') {
    await handleCommitClose(args.slice(1), options);
    return;
  }

  const objectText = sub && !sub.startsWith('--') ? sub : readOption(options, 'object');
  if (!objectText) {
    ui.error('Usage: pd commit "<object>" [--success <cmd>] [--impossible <cmd>] [--scope claim|review|standing|default] [--strategy single|open]');
    process.exit(1);
  }

  const ownerActorId = resolveOwner(options);
  if (!ownerActorId) {
    ui.error('No owner actor id. Run `pd begin` first, or pass --owner <actorId>.');
    process.exit(1);
  }

  const body: Record<string, unknown> = { ownerActorId, objectText };
  const success = readOption(options, 'success');
  if (success) body.successCheck = success;
  const impossible = readOption(options, 'impossible');
  if (impossible) body.impossibleCheck = impossible;
  const motivation = readOption(options, 'motivation');
  if (motivation) body.motivationCheck = motivation;
  const scope = readOption(options, 'scope');
  if (scope) body.scope = scope;
  const strategy = readOption(options, 'strategy');
  if (strategy) body.commitmentStrategy = strategy;

  const res = await pdFetch(`${PORT_DADDY_URL}/commitments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    commitment?: Commitment;
    error?: string;
  };
  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    if (!data.success) process.exit(1);
    return;
  }
  if (!data.success || !data.commitment) {
    ui.error(data.error || 'Failed to create commitment');
    process.exit(1);
  }
  printCommitment(data.commitment);
}

export async function handleObligations(args: string[], options: CLIOptions): Promise<void> {
  const overdueOnly = options.overdue === true || args.includes('--overdue');

  if (overdueOnly) {
    const res = await pdFetch(`${PORT_DADDY_URL}/commitments/overdue`);
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      overdue?: OverdueCommitment[];
      count?: number;
      checkedAt?: number;
      error?: string;
    };
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    const overdue = data.overdue ?? [];
    if (overdue.length === 0) {
      ui.success('No overdue obligations. Every open promise is still within its deadline.');
      return;
    }
    ui.warn(`${overdue.length} overdue obligation(s):`);
    for (const c of overdue) {
      console.log(`  - ${ui.fmtBold(c.objectText)}`);
      console.log(`    id=${c.id} owner=${c.ownerActorId} scope=${c.scope}`);
      console.log(`    overdue by ${fmtDuration(c.overdueByMs)} (due ${fmtWhen(c.dueAt)})`);
    }
    return;
  }

  const params = new URLSearchParams();
  const mine = options.mine === true || args.includes('--mine');
  const owner = readOption(options, 'owner') ?? (mine ? resolveOwner(options) : undefined);
  if (owner) params.set('ownerActorId', owner);
  const state = readOption(options, 'state');
  if (state) params.set('state', state);
  const qs = params.toString();
  // Build the suffix without a nested template literal so the path stays a
  // single `${...}`-terminated string the endpoint-parity extractor can parse.
  const suffix = qs ? `?${qs}` : '';
  const res = await pdFetch(`${PORT_DADDY_URL}/commitments${suffix}`);
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    commitments?: Commitment[];
    count?: number;
    error?: string;
  };
  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  const items = data.commitments ?? [];
  if (items.length === 0) {
    ui.info('No commitments found.');
    return;
  }
  ui.info(`${items.length} commitment(s):`);
  for (const c of items) {
    const flag = c.state === 'done' ? 'done' : c.state;
    console.log(`  - [${flag}] ${ui.fmtBold(c.objectText)}`);
    console.log(`    id=${c.id} owner=${c.ownerActorId} scope=${c.scope} due=${fmtWhen(c.dueAt)}`);
    if (c.closedByOracleRef) console.log(`    closed-by-oracle=${c.closedByOracleRef}`);
  }
}
