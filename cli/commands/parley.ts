import { CLIOptions, isJson, isQuiet } from '../types.js';
import { readCurrentContext } from '../utils/current-context.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';
import type { ParleyPerformative } from '../../lib/parley.js';
import {
  ReasoningShape,
  SubtaskIndependence,
  SwarmFitInput,
  WriteContention,
  evaluateSwarmFit,
} from '../../lib/swarm-coordination.js';

/** Turn verbs: `pd parley agree <id> "text"` ≡ respond with that performative. */
const TURN_VERBS: Record<string, ParleyPerformative> = {
  propose: 'propose',
  critique: 'critique',
  revise: 'revise',
  agree: 'agree',
  refuse: 'refuse',
  say: 'inform',
};

/**
 * Resolves the first present CLI string option into its canonical trimmed form.
 * The design keeps each Parley command from treating whitespace as a distinct identity.
 * @param options Parsed command-line options.
 * @param keys Candidate option names in precedence order.
 * @returns The first non-blank option value, or undefined when absent.
 */
function readString(options: CLIOptions, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = options[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Resolves a finite numeric CLI option without inventing a fallback value.
 * The purpose is to keep command validation explicit at the CLI boundary.
 * @param options Parsed command-line options.
 * @param keys Candidate option names in precedence order.
 * @returns The first finite numeric value, or undefined when none is supplied.
 */
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

/**
 * Normalizes a comma-delimited or repeated CLI option into non-blank values.
 * The design makes transport payloads deterministic regardless of parser shape.
 * @param options Parsed command-line options.
 * @param key Option name containing one value or an array of values.
 * @returns Canonical non-empty option entries.
 */
function readList(options: CLIOptions, key: string): string[] {
  const value = options[key];
  if (Array.isArray(value)) return value.flatMap((item) => String(item).split(',')).map((s) => s.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

/**
 * Posts a JSON command payload to the daemon and retains both HTTP and body evidence.
 * The purpose is to let command handlers make one consistent success decision.
 * @param path Daemon-relative route path.
 * @param body JSON-safe request payload.
 * @returns The response success flag and parsed JSON body.
 */
async function postJson(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: any }> {
  const res = await pdFetch(`${PORT_DADDY_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

/**
 * Fetches a JSON daemon resource while preserving status separately from payload data.
 * The design avoids treating a parseable failure body as a successful Parley operation.
 * @param path Daemon-relative route path.
 * @returns The response success flag and parsed JSON body.
 */
async function getJson(path: string): Promise<{ ok: boolean; data: any }> {
  const res = await pdFetch(`${PORT_DADDY_URL}${path}`);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

/**
 * Chooses an explicit actor first, then falls back to the active Port Daddy session.
 * The purpose is to preserve attributable Parley mutations without silently inventing an identity.
 * @param options Parsed command-line options.
 * @param keys Explicit actor option names in precedence order.
 * @returns The resolved actor identifier, or undefined when no attributable actor exists.
 */
function resolveActor(options: CLIOptions, ...keys: string[]): string | undefined {
  const explicit = readString(options, ...keys);
  if (explicit) return explicit;
  const agentId = readCurrentContext()?.agentId?.trim();
  return agentId || undefined;
}

/**
 * Formats a turn timestamp for terminal transcript output.
 * The design gives operators a stable, timezone-neutral visual order.
 * @param at Unix timestamp in milliseconds.
 * @returns A compact ISO-like timestamp for display.
 */
function formatTurnTime(at: number): string {
  return new Date(at).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Renders Parley turns and receipt progress for a human CLI reader.
 * The purpose is to make missing context and unread work visible without mutating state.
 * @param summary Parley summary data supplied by the daemon.
 * @param viewer Optional actor whose own receipt is annotated.
 * @returns Nothing; output is written to the terminal.
 */
function printTranscript(summary: {
  turns: Array<{ party: string; performative: string; content: string; at: number }>;
  receipts?: Array<{ party: string; lastSeenAt: number | null; unseenTurns: number }>;
}, viewer?: string): void {
  if (summary.turns.length === 0) {
    console.log('  turns:   none yet');
  } else {
    console.log(`  turns (${summary.turns.length}):`);
    for (const turn of summary.turns) {
      console.log(`    [${formatTurnTime(turn.at)}] ${turn.party} ${turn.performative}: ${turn.content}`);
    }
  }
  if (summary.receipts && summary.receipts.length > 0) {
    console.log('  seen:');
    for (const receipt of summary.receipts) {
      const marker = receipt.party === viewer ? ' (you)' : '';
      if (receipt.unseenTurns === 0) {
        console.log(`    ${receipt.party}${marker}: caught up`);
      } else {
        const lastSeen = receipt.lastSeenAt === null
          ? 'never checked in'
          : `last seen ${formatTurnTime(receipt.lastSeenAt)}`;
        console.log(`    ${receipt.party}${marker}: ${receipt.unseenTurns} unseen turn(s), ${lastSeen}`);
      }
    }
  }
}

/**
 * Maps a CLI reasoning-shape option to the conservative swarm-fit default.
 * The design preserves compatibility when a caller omits or supplies an unknown shape.
 * @param value Candidate shape string.
 * @returns A supported reasoning shape.
 */
function parseReasoningShape(value: string | undefined): ReasoningShape {
  if (value === 'breadth_first' || value === 'depth_first' || value === 'mixed') return value;
  return 'mixed';
}

/**
 * Maps a CLI independence option to the conservative swarm-fit default.
 * The purpose is to prevent malformed options from producing undefined fit inputs.
 * @param value Candidate independence string.
 * @returns A supported subtask-independence value.
 */
function parseIndependence(value: string | undefined): SubtaskIndependence {
  if (value === 'none' || value === 'partial' || value === 'high') return value;
  return 'partial';
}

/**
 * Maps a CLI contention option to the conservative swarm-fit default.
 * The design keeps planning behavior deterministic for missing or invalid input.
 * @param value Candidate contention string.
 * @returns A supported write-contention value.
 */
function parseContention(value: string | undefined): WriteContention {
  if (value === 'none' || value === 'low' || value === 'medium' || value === 'high') return value;
  return 'medium';
}

/**
 * Dispatches the Parley CLI surface while preserving explicit actor and harbor context.
 * The purpose is to make each read or mutation reach the same configured harbor as its record.
 * @param args Positional Parley subcommand arguments.
 * @param options Parsed command-line flags.
 * @returns A promise that resolves after terminal output or daemon interaction completes.
 */
export async function handleParley(args: string[], options: CLIOptions): Promise<void> {
  const sub = args[0];
  if (options.help || !sub || sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(`Usage:
  pd parley call --surface <path|symbol> --reason <text> --with <actorA,actorB>
  pd parley propose|critique|revise|agree|refuse|say <id> <content...> [--harbor <h>]
  pd parley respond <id> --performative propose|critique|revise|agree|refuse|inform --content <text> [--harbor <h>]
  pd parley resolve <id> --status COLLAPSED|ESCALATED|VOIDED [--decision <text>] [--dissenters <a,b>] [--harbor <h>]
  pd parley list [--status <state>] [--harbor <h>]
  pd parley show <id> [--harbor <h>]
  pd parley fit --shape breadth_first|depth_first|mixed --independence none|partial|high --contention none|low|medium|high

Identity: --as defaults to your active pd session (pd begin / PD_AGENT_ID).
Delivery: every turn is fanned out to the other participants' inboxes (pd attention / pd inbox).
Receipts: pd parley show records a read receipt when --as or an active identity is available.
Settlement: raw resolve is CAP0-gated and currently fail-closed; terminal Sugar receipts are a separate capability.
`);
    return;
  }

  const turnVerb = TURN_VERBS[sub];
  if (sub === 'respond' || turnVerb) {
    const parleyId = args[1] ?? readString(options, 'parley', 'parleyId', 'id');
    const party = resolveActor(options, 'as', 'party');
    const performative = turnVerb ?? readString(options, 'performative');
    const content = turnVerb
      ? (args.slice(2).join(' ').trim() || readString(options, 'content'))
      : readString(options, 'content');
    if (!parleyId || !party || !performative || !content) {
      if (turnVerb) ui.error(`usage: pd parley ${sub} <id> <content...>  (identity from session or --as)`);
      else ui.error('parley id, --performative, and --content are required (identity from session or --as)');
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
    const harbor = readString(options, 'harbor');
    if (harbor) body.harbor = harbor;
    const { ok, data } = await postJson('/parley/respond', body);
    if (!ok) {
      ui.error(data.error || 'parley respond failed');
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    const delivered = Array.isArray(data.notified) && data.notified.length > 0
      ? ` → delivered to ${data.notified.join(', ')}`
      : '';
    console.log(`Turn recorded${delivered}. Parley status: ${data.status?.status ?? 'unknown'}`);
    if (Array.isArray(data.notifyFailures) && data.notifyFailures.length > 0) {
      ui.error(`delivery failed for: ${data.notifyFailures.join('; ')} (turn is still recorded)`);
    }
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
    const reason = readString(options, 'reason') ?? args[2];
    const calledBy = resolveActor(options, 'as', 'calledBy', 'agent');
    const parties = readList(options, 'with').concat(readList(options, 'parties'));
    if (!surface || !reason || !calledBy || parties.length < 2) {
      ui.error('--surface, --reason, and --with <a,b> are required (identity from session or --as)');
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

  if (sub === 'resolve') {
    const parleyId = args[1] ?? readString(options, 'parley', 'parleyId', 'id');
    const status = readString(options, 'status');
    const resolvedBy = resolveActor(options, 'as', 'resolvedBy', 'agent');
    if (!parleyId || !status || !resolvedBy) {
      ui.error('parley id and --status are required (identity from session or --as)');
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
    const harbor = readString(options, 'harbor');
    if (harbor) body.harbor = harbor;
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
    const viewer = resolveActor(options, 'as');
    const params = new URLSearchParams();
    if (viewer) params.set('as', viewer);
    const harbor = readString(options, 'harbor');
    if (harbor) params.set('harbor', harbor);
    const query = params.toString();
    const { ok, data } = await getJson(`/parley/${encodeURIComponent(parleyId)}${query ? `?${query}` : ''}`);
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
    printTranscript(summary, viewer);
    if (summary.outcome) {
      console.log(`  outcome: ${summary.outcome.status}`);
      if (summary.outcome.decision) console.log(`  decision: ${summary.outcome.decision}`);
    }
    if (data.receiptRecorded && viewer) {
      console.log(`  (read receipt recorded for ${viewer})`);
    }
    return;
  }

  ui.error(`Unknown parley subcommand: ${sub} (try call, propose, critique, revise, agree, refuse, say, respond, resolve, list, show, fit)`);
  process.exit(1);
}
