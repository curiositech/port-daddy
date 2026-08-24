/**
 * Quorum CLI — `pd quorum propose|vote|list|show`
 *
 * Thin wrapper around `/quorum/*` HTTP endpoints. Mirrors the daemon
 * primitive so swarm decisions can be driven from a terminal as well
 * as from inside agent code.
 */

import { CLIOptions, isJson, isQuiet } from '../types.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';

interface ProposalRecord {
  tupleId: number;
  proposalId: string;
  role: string;
  reason: string;
  threshold: number;
  proposedBy: string;
  authorityHarbor: string;
  harbor: string;
  autoSpawn: boolean;
  expiresAt: number | null;
  createdAt: number;
}

interface VoteRecord {
  tupleId: number;
  proposalId: string;
  voterId: string;
  stance: 'yes' | 'no' | 'abstain';
  weight: number;
  at: number;
}

interface QuorumStatus {
  proposal: ProposalRecord;
  votes: VoteRecord[];
  yesWeight: number;
  noWeight: number;
  abstainWeight: number;
  passed: boolean;
  expired: boolean;
  remainingNeeded: number;
}

function readString(options: CLIOptions, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = options[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function readNumber(options: CLIOptions, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = options[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const n = Number.parseInt(value, 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function hasAnyOption(options: CLIOptions, ...keys: string[]): boolean {
  return keys.some((key) => options[key] !== undefined);
}

async function postJson(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: any }> {
  const res = await pdFetch(`${PORT_DADDY_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function getJson(path: string): Promise<{ ok: boolean; data: any }> {
  const res = await pdFetch(`${PORT_DADDY_URL}${path}`);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

function printProposal(p: ProposalRecord): void {
  console.log(`  - ${p.proposalId.slice(0, 8)}  role=${p.role}  threshold=${p.threshold}  by=${p.proposedBy}  harbor=${p.harbor}  authority=${p.authorityHarbor}`);
  console.log(`    ${p.reason}`);
}

export async function handleQuorum(args: string[], options: CLIOptions): Promise<void> {
  const sub = args[0];
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(`Usage:
  pd quorum propose --role <name> --reason <text> --threshold <n> [--harbor <h>] [--auto-spawn] [--ttl-ms <ms>]
  pd quorum vote --proposal <id> --stance yes|no|abstain
  pd quorum list [--harbor <h>] [--limit <n>]
  pd quorum show <proposalId>
`);
    return;
  }

  if (sub === 'propose') {
    const role = readString(options, 'role');
    const reason = readString(options, 'reason');
    const threshold = readNumber(options, 'threshold');
    if (hasAnyOption(options, 'as', 'proposedBy', 'proposed-by', 'agent')) {
      ui.error('proposal identity comes from the stored actor credential; --as/--proposed-by/--agent are not accepted');
      process.exit(1);
    }
    if (!role || !reason || threshold === undefined) {
      ui.error('--role, --reason, and --threshold <n> are all required');
      process.exit(1);
    }
    const body: Record<string, unknown> = { role, reason, threshold };
    const harbor = readString(options, 'harbor');
    if (harbor) body.harbor = harbor;
    if (options['auto-spawn'] === true || options.autoSpawn === true) body.autoSpawn = true;
    const ttlMs = readNumber(options, 'ttl-ms', 'ttlMs');
    if (ttlMs !== undefined) body.ttlMs = ttlMs;

    const { ok, data } = await postJson('/quorum/propose', body);
    if (!ok) {
      ui.error(data.error || 'propose failed');
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data.proposal, null, 2));
      return;
    }
    if (isQuiet(options)) {
      console.log(data.proposal.proposalId);
      return;
    }
    console.log(`Proposal ${data.proposal.proposalId} created. Threshold: ${data.proposal.threshold} yes-votes.`);
    return;
  }

  if (sub === 'vote') {
    const proposalId = readString(options, 'proposal', 'proposalId', 'id') || args[1];
    const stance = readString(options, 'stance');
    if (hasAnyOption(options, 'as', 'voter', 'voterId', 'voter-id', 'agent')) {
      ui.error('voter identity comes from the stored actor credential; --as/--voter/--agent are not accepted');
      process.exit(1);
    }
    if (!proposalId || !stance) {
      ui.error('--proposal <id> and --stance yes|no|abstain are required');
      process.exit(1);
    }
    if (options.weight !== undefined) {
      ui.error('vote weight is assigned by the server; --weight is not accepted');
      process.exit(1);
    }
    const body: Record<string, unknown> = { proposalId, stance };

    const { ok, data } = await postJson('/quorum/vote', body);
    if (!ok) {
      ui.error(data.error || 'vote failed');
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    const status: QuorumStatus | undefined = data.status;
    if (isQuiet(options)) {
      console.log(status?.passed ? 'passed' : `${status?.yesWeight}/${status?.proposal.threshold}`);
      return;
    }
    if (status) {
      console.log(`Vote recorded. yes=${status.yesWeight} no=${status.noWeight} abstain=${status.abstainWeight} passed=${status.passed}`);
    }
    return;
  }

  if (sub === 'list') {
    const params = new URLSearchParams();
    const harbor = readString(options, 'harbor');
    if (harbor) params.set('harbor', harbor);
    const limit = readNumber(options, 'limit');
    if (limit !== undefined) params.set('limit', String(limit));
    const qs = params.toString();
    const { ok, data } = await getJson(`/quorum/proposals${qs ? `?${qs}` : ''}`);
    if (!ok) {
      ui.error(data.error || 'list failed');
      process.exit(1);
    }
    const proposals: ProposalRecord[] = data.proposals ?? [];
    if (isJson(options)) {
      console.log(JSON.stringify(proposals, null, 2));
      return;
    }
    if (isQuiet(options)) {
      for (const p of proposals) console.log(p.proposalId);
      return;
    }
    console.log(`${proposals.length} proposal(s)`);
    for (const p of proposals) printProposal(p);
    return;
  }

  if (sub === 'show') {
    const proposalId = args[1] || readString(options, 'proposal', 'proposalId', 'id');
    if (!proposalId) {
      ui.error('proposalId required: pd quorum show <id>');
      process.exit(1);
    }
    const { ok, data } = await getJson(`/quorum/proposals/${encodeURIComponent(proposalId)}`);
    if (!ok) {
      ui.error(data.error || 'not found');
      process.exit(1);
    }
    const status: QuorumStatus = data.status;
    if (isJson(options)) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    console.log(`Proposal ${status.proposal.proposalId}`);
    console.log(`  role:       ${status.proposal.role}`);
    console.log(`  reason:     ${status.proposal.reason}`);
    console.log(`  by:         ${status.proposal.proposedBy}`);
    console.log(`  harbor:     ${status.proposal.harbor}`);
    console.log(`  authority:  ${status.proposal.authorityHarbor}`);
    console.log(`  threshold:  ${status.proposal.threshold}`);
    console.log(`  tally:      yes=${status.yesWeight} no=${status.noWeight} abstain=${status.abstainWeight}`);
    console.log(`  passed:     ${status.passed}`);
    console.log(`  expired:    ${status.expired}`);
    console.log(`  remaining:  ${status.remainingNeeded} more yes-vote(s) needed`);
    if (status.votes.length > 0) {
      console.log('  votes:');
      for (const v of status.votes) {
        console.log(`    - ${v.voterId} → ${v.stance}${v.weight !== 1 ? ` (weight=${v.weight})` : ''}`);
      }
    }
    return;
  }

  ui.error(`Unknown quorum subcommand: ${sub}`);
  process.exit(1);
}
