import { CLIOptions, isJson, isQuiet } from '../types.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';
import {
  ReasoningShape,
  SubtaskIndependence,
  SwarmFitInput,
  WriteContention,
  evaluateSwarmFit,
} from '../../lib/swarm-coordination.js';

function readString(options: CLIOptions, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = options[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function readNumber(options: CLIOptions, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = options[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function readList(options: CLIOptions, key: string): string[] {
  const value = options[key];
  if (Array.isArray(value)) return value.flatMap((item) => String(item).split(',')).map((s) => s.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
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

function parseReasoningShape(value: string | undefined): ReasoningShape {
  if (value === 'breadth_first' || value === 'depth_first' || value === 'mixed') return value;
  return 'mixed';
}

function parseIndependence(value: string | undefined): SubtaskIndependence {
  if (value === 'none' || value === 'partial' || value === 'high') return value;
  return 'partial';
}

function parseContention(value: string | undefined): WriteContention {
  if (value === 'none' || value === 'low' || value === 'medium' || value === 'high') return value;
  return 'medium';
}

export async function handleParley(args: string[], options: CLIOptions): Promise<void> {
  const sub = args[0];
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(`Usage:
  pd parley call --surface <path|symbol> --reason <text> --with <sessionA,sessionB> --as <agentId>
  pd parley respond <id> --as <party> --performative propose|critique|revise|agree|refuse|inform --content <text>
  pd parley resolve <id> --status COLLAPSED|ESCALATED|VOIDED --as <agentId> [--decision <text>] [--dissenters <a,b>]
  pd parley list [--status <state>] [--harbor <h>]
  pd parley show <id>
  pd parley fit --shape breadth_first|depth_first|mixed --independence none|partial|high --contention none|low|medium|high
`);
    return;
  }

  if (sub === 'fit') {
    const input: SwarmFitInput = {
      reasoningShape: parseReasoningShape(readString(options, 'shape', 'reasoningShape')),
      singleAgentBaseline: readNumber(options, 'baseline', 'singleAgentBaseline'),
      fitsInOneContext: options['fits-in-one-context'] === true || options.fitsInOneContext === true,
      taskValueMultiplier: readNumber(options, 'value', 'taskValueMultiplier') ?? 10,
      estimatedTokenMultiplier: readNumber(options, 'tokens', 'estimatedTokenMultiplier') ?? 5,
      subtaskIndependence: parseIndependence(readString(options, 'independence', 'subtaskIndependence')),
      writeContention: parseContention(readString(options, 'contention', 'writeContention')),
      verificationAvailable: options.verify !== false && options.verificationAvailable !== false,
      heterogeneousAgents: options.heterogeneous === true || options.heterogeneousAgents === true,
      maxConcurrentWriters: readNumber(options, 'writers', 'maxConcurrentWriters'),
    };
    const decision = evaluateSwarmFit(input);
    if (isJson(options)) {
      console.log(JSON.stringify(decision, null, 2));
      return;
    }
    if (isQuiet(options)) {
      console.log(decision.topology);
      return;
    }
    console.log(`Topology: ${decision.topology}`);
    console.log(`Allowed:  ${decision.allowed}`);
    console.log(`Confidence: ${decision.confidence}`);
    if (decision.reasons.length) console.log(`Reasons: ${decision.reasons.join('; ')}`);
    if (decision.requirements.length) console.log(`Requires: ${decision.requirements.join('; ')}`);
    if (decision.risks.length) console.log(`Risks: ${decision.risks.join('; ')}`);
    return;
  }

  if (sub === 'call') {
    const surface = readString(options, 'surface') ?? args[1];
    const reason = readString(options, 'reason');
    const calledBy = readString(options, 'as', 'calledBy', 'agent');
    const parties = readList(options, 'with').concat(readList(options, 'parties'));
    if (!surface || !reason || !calledBy || parties.length < 2) {
      ui.error('--surface, --reason, --with <a,b>, and --as <agentId> are required');
      process.exit(1);
    }
    const body: Record<string, unknown> = { surface, reason, calledBy, parties };
    const harbor = readString(options, 'harbor');
    if (harbor) body.harbor = harbor;
    const ttlMs = readNumber(options, 'ttl-ms', 'ttlMs');
    if (ttlMs !== undefined) body.ttlMs = ttlMs;
    const roundLimit = readNumber(options, 'round-limit', 'roundLimit');
    if (roundLimit !== undefined) body.roundLimit = roundLimit;

    const { ok, data } = await postJson('/parley/call', body);
    if (!ok) {
      ui.error(data.error || 'parley call failed');
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data.parley, null, 2));
      return;
    }
    if (isQuiet(options)) {
      console.log(data.parley.parleyId);
      return;
    }
    console.log(`Parley ${data.parley.parleyId} opened on ${data.parley.surface}`);
    console.log(`Channel: ${data.parley.channel}`);
    return;
  }

  if (sub === 'respond') {
    const parleyId = args[1] ?? readString(options, 'parley', 'parleyId', 'id');
    const party = readString(options, 'as', 'party');
    const performative = readString(options, 'performative');
    const content = readString(options, 'content');
    if (!parleyId || !party || !performative || !content) {
      ui.error('parley id, --as <party>, --performative, and --content are required');
      process.exit(1);
    }
    const body: Record<string, unknown> = {
      parleyId,
      party,
      performative,
      content,
      proposalId: readString(options, 'proposal', 'proposalId'),
      evidenceRefs: readList(options, 'evidence'),
    };
    const { ok, data } = await postJson('/parley/respond', body);
    if (!ok) {
      ui.error(data.error || 'parley respond failed');
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    console.log(`Turn recorded. Parley status: ${data.status?.status ?? 'unknown'}`);
    return;
  }

  if (sub === 'resolve') {
    const parleyId = args[1] ?? readString(options, 'parley', 'parleyId', 'id');
    const status = readString(options, 'status');
    const resolvedBy = readString(options, 'as', 'resolvedBy', 'agent');
    if (!parleyId || !status || !resolvedBy) {
      ui.error('parley id, --status, and --as <agentId> are required');
      process.exit(1);
    }
    const body: Record<string, unknown> = {
      parleyId,
      status,
      resolvedBy,
      decision: readString(options, 'decision'),
      reason: readString(options, 'reason'),
      dissenters: readList(options, 'dissenters'),
    };
    const { ok, data } = await postJson('/parley/resolve', body);
    if (!ok) {
      ui.error(data.error || 'parley resolve failed');
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    console.log(`Parley resolved: ${data.outcome.status}`);
    return;
  }

  if (sub === 'list') {
    const params = new URLSearchParams();
    const status = readString(options, 'status');
    if (status) params.set('status', status);
    const harbor = readString(options, 'harbor');
    if (harbor) params.set('harbor', harbor);
    const limit = readNumber(options, 'limit');
    if (limit !== undefined) params.set('limit', String(limit));
    const qs = params.toString();
    const { ok, data } = await getJson(`/parley${qs ? `?${qs}` : ''}`);
    if (!ok) {
      ui.error(data.error || 'parley list failed');
      process.exit(1);
    }
    const parleys = data.parleys ?? [];
    if (isJson(options)) {
      console.log(JSON.stringify(parleys, null, 2));
      return;
    }
    if (isQuiet(options)) {
      for (const p of parleys) console.log(p.parley.parleyId);
      return;
    }
    console.log(`${parleys.length} parley(s)`);
    for (const p of parleys) {
      console.log(`  - ${p.parley.parleyId.slice(0, 8)} ${p.status} ${p.parley.surface}`);
    }
    return;
  }

  if (sub === 'show') {
    const parleyId = args[1] ?? readString(options, 'parley', 'parleyId', 'id');
    if (!parleyId) {
      ui.error('parley id required: pd parley show <id>');
      process.exit(1);
    }
    const { ok, data } = await getJson(`/parley/${encodeURIComponent(parleyId)}`);
    if (!ok) {
      ui.error(data.error || 'parley not found');
      process.exit(1);
    }
    const summary = data.summary;
    if (isJson(options)) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    console.log(`Parley ${summary.parley.parleyId}`);
    console.log(`  status:  ${summary.status}`);
    console.log(`  surface: ${summary.parley.surface}`);
    console.log(`  reason:  ${summary.parley.reason}`);
    console.log(`  channel: ${summary.parley.channel}`);
    console.log(`  parties: ${summary.parley.parties.join(', ')}`);
    console.log(`  missing: ${summary.missingParties.join(', ') || 'none'}`);
    if (summary.outcome) {
      console.log(`  outcome: ${summary.outcome.status}`);
      if (summary.outcome.decision) console.log(`  decision: ${summary.outcome.decision}`);
    }
    return;
  }

  ui.error(`Unknown parley subcommand: ${sub}`);
  process.exit(1);
}
