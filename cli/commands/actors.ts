import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isJson, isQuiet } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';
import { posixShellQuote } from '../../lib/shell-quote.js';

interface ActorRecord {
  id: string;
  label: string;
  title: string;
  mission: string;
  owns: string[];
  aliases: string[];
  compatibilityFleetAgent: string | null;
  inboxTarget: string;
  mailboxStats: { total: number; unread: number; max: number | null } | null;
  leaseState: string;
  liveBodies: Array<{ id: string; identity: string | null; liveness: string | null }>;
  recentSessions: Array<{ id: string; status: string | null; purpose: string | null }>;
  salvage: Array<{ id: string; status: string | null; purpose: string | null }>;
  evidence: string[];
}

interface ActorInboxMessage {
  id: number;
  from: string | null;
  content: unknown;
  contentType: string;
  type: string;
  read: boolean;
  createdAt: number;
}

interface ActorsResponse {
  success: boolean;
  count?: number;
  actors?: ActorRecord[];
  actor?: ActorRecord;
  resolvedId?: string;
  actorId?: string;
  inboxTarget?: string;
  messageId?: number;
  messages?: ActorInboxMessage[];
  total?: number;
  unread?: number;
  max?: number | null;
  marked?: number;
  delivered?: boolean;
  woke?: boolean;
  error?: string;
}

interface OperatorAdmissionIssueResponse {
  success: boolean;
  grant?: {
    grantId: string;
    identity: string;
    worktreeRoot: string;
    branch: string;
    remote: string;
    head: string;
    base: string;
    roadmapSlug: string;
    operatorIdentity: string;
    expiresAt: number;
    status: string;
  };
  receipt?: { receiptId: string; kind: string };
  idempotent?: boolean;
  code?: string;
  error?: string;
}

function parseAdmissionTtl(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const match = String(value).trim().match(/^(\d+)(ms|s|m)?$/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  return unit === 'm' ? amount * 60_000 : unit === 's' ? amount * 1_000 : amount;
}

async function issueOperatorAdmissionGrant(options: CLIOptions): Promise<void> {
  const identity = typeof options.identity === 'string' ? options.identity.trim() : '';
  const roadmapSlug = typeof options.roadmap === 'string' ? options.roadmap.trim() : '';
  const worktreeRoot = typeof options.worktree === 'string' && options.worktree.trim()
    ? options.worktree.trim()
    : process.cwd();
  if (!identity || !roadmapSlug) {
    ui.error('usage: pd actor admission grant --identity <project:role> --roadmap <slug> [--worktree <absolute-path>] [--ttl 5m] --confirm');
    process.exit(1);
  }
  if (options.confirm !== true) {
    ui.error('refusing to issue authority without --confirm for this exact identity/worktree/roadmap tuple');
    process.exit(1);
  }
  const ttlMs = parseAdmissionTtl(options.ttl);
  if (options.ttl !== undefined && ttlMs === undefined) {
    ui.error('--ttl must be an integer duration such as 30s or 5m');
    process.exit(1);
  }
  const res: PdFetchResponse = await pdFetch('/operator/admission-grants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, worktreeRoot, roadmapSlug, ttlMs, confirmed: true }),
  });
  const data = await res.json() as unknown as OperatorAdmissionIssueResponse;
  if (!res.ok || !data.success || !data.grant) {
    ui.error(data.error || `operator admission grant failed with status ${res.status}`);
    process.exit(1);
  }
  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (isQuiet(options)) {
    console.log(data.grant.grantId);
    return;
  }
  const grant = data.grant;
  console.log(`${data.idempotent ? 'Existing' : 'Issued'} exact operator admission grant ${grant.grantId}`);
  console.log(`  identity:  ${grant.identity}`);
  console.log(`  worktree:  ${grant.worktreeRoot}`);
  console.log(`  branch:    ${grant.branch}`);
  console.log(`  remote:    ${grant.remote}`);
  console.log(`  head/base: ${grant.head.slice(0, 12)} / ${grant.base.slice(0, 12)}`);
  console.log(`  roadmap:   ${grant.roadmapSlug}`);
  console.log(`  expires:   ${new Date(grant.expiresAt).toISOString()}`);
  console.log('');
  console.log('Bound begin command:');
  console.log(`  pd begin <purpose> --identity ${posixShellQuote(grant.identity)} --lifecycle durable --roadmap ${posixShellQuote(grant.roadmapSlug)} --admission-grant ${posixShellQuote(grant.grantId)}`);
}

function queryString(options: CLIOptions): string {
  const params = new URLSearchParams();
  if (typeof options.project === 'string' && options.project.trim()) {
    params.set('project', options.project.trim());
  }
  if (typeof options.limit === 'string' && options.limit.trim()) {
    params.set('limit', options.limit.trim());
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

function inboxQueryString(options: CLIOptions): string {
  const params = new URLSearchParams();
  if (options.unread === true) params.set('unread', 'true');
  if (typeof options.limit === 'string' && options.limit.trim()) {
    params.set('limit', options.limit.trim());
  }
  if (typeof options.since === 'string' && options.since.trim()) {
    params.set('since', options.since.trim());
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

async function fetchActors(path: string): Promise<ActorsResponse> {
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}${path}`);
  const data = await res.json() as unknown as ActorsResponse;
  if (!res.ok || !data.success) {
    ui.error(data.error || `actors request failed with status ${res.status}`);
    process.exit(1);
  }
  return data;
}

async function fetchActorInbox(actorId: string, options: CLIOptions): Promise<ActorsResponse> {
  return fetchActors(`/actors/${encodeURIComponent(actorId)}/inbox${inboxQueryString(options)}`);
}

async function fetchActorInboxStats(actorId: string): Promise<ActorsResponse> {
  return fetchActors(`/actors/${encodeURIComponent(actorId)}/inbox/stats`);
}

async function markActorInboxRead(actorId: string): Promise<ActorsResponse> {
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/actors/${encodeURIComponent(actorId)}/inbox/read-all`, {
    method: 'PUT',
  });
  const data = await res.json() as unknown as ActorsResponse & { marked?: number };
  if (!res.ok || !data.success) {
    ui.error(data.error || `actor inbox mark-read failed with status ${res.status}`);
    process.exit(1);
  }
  return data;
}

async function sendActorMessage(actorId: string, options: CLIOptions): Promise<ActorsResponse> {
  const message = typeof options.message === 'string'
    ? options.message
    : typeof options.m === 'string'
      ? options.m
      : undefined;
  if (!message?.trim()) {
    ui.error('actor message requires --message <text>');
    process.exit(1);
  }

  const body = {
    content: message,
    from: typeof options.from === 'string' ? options.from : undefined,
    type: typeof options.type === 'string' ? options.type : undefined,
    wake: options.wake === true,
    project: typeof options.project === 'string' ? options.project : undefined,
  };

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/actors/${encodeURIComponent(actorId)}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json() as unknown as ActorsResponse;
  if (!res.ok || !data.success) {
    ui.error(data.error || `actor message failed with status ${res.status}`);
    process.exit(1);
  }
  return data;
}

function stateLabel(state: string): string {
  switch (state) {
    case 'attached': return 'ATTACHED';
    case 'recoverable': return 'RECOVERABLE';
    case 'detached': return 'DETACHED';
    default: return 'DORMANT';
  }
}

function printActor(actor: ActorRecord): void {
  console.log(`${actor.label.toUpperCase()} · ${actor.title}`);
  console.log(`  mission: ${actor.mission}`);
  console.log(`  state: ${stateLabel(actor.leaseState)}`);
  console.log(`  inbox: ${actor.inboxTarget}`);
  if (actor.mailboxStats) {
    console.log(`  inbox depth: ${actor.mailboxStats.unread} unread / ${actor.mailboxStats.total} total`);
  }
  if (actor.compatibilityFleetAgent) {
    console.log(`  fleet compatibility: ${actor.compatibilityFleetAgent}`);
  }
  if (actor.aliases.length > 0) {
    console.log(`  aliases: ${actor.aliases.join(', ')}`);
  }
  console.log(`  owns: ${actor.owns.join(', ')}`);
  if (actor.liveBodies.length > 0) {
    console.log(`  live bodies: ${actor.liveBodies.map(body => body.id).join(', ')}`);
  }
  if (actor.recentSessions.length > 0) {
    console.log(`  recent sessions: ${actor.recentSessions.map(session => session.id).join(', ')}`);
  }
  if (actor.salvage.length > 0) {
    console.log(`  salvage: ${actor.salvage.map(entry => entry.id).join(', ')}`);
  }
}

function printActors(actors: ActorRecord[]): void {
  for (const actor of actors) {
    const bodyCount = actor.liveBodies.length;
    const sessionCount = actor.recentSessions.length;
    const salvageCount = actor.salvage.length;
    const signals = [
      bodyCount ? `${bodyCount} body` : null,
      sessionCount ? `${sessionCount} session` : null,
      salvageCount ? `${salvageCount} salvage` : null,
      actor.mailboxStats && actor.mailboxStats.total > 0
        ? `${actor.mailboxStats.unread}/${actor.mailboxStats.total} unread`
        : null,
    ].filter(Boolean).join(', ') || 'canonical';

    console.log(`${actor.label.padEnd(14)} ${stateLabel(actor.leaseState).padEnd(11)} ${actor.inboxTarget.padEnd(22)} ${signals}`);
  }
}

function formatTime(value: number): string {
  return new Date(value).toISOString();
}

function printInboxMessages(data: ActorsResponse): void {
  const messages = data.messages ?? [];
  console.log(`Actor inbox: ${data.inboxTarget ?? data.actorId}`);
  if (messages.length === 0) {
    console.log('  No messages');
    return;
  }
  for (const message of messages) {
    const state = message.read ? 'read' : 'unread';
    const from = message.from ?? 'unknown';
    const text = typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content);
    console.log(`  #${message.id} ${state} ${message.type} from ${from} at ${formatTime(message.createdAt)}`);
    console.log(`    ${text}`);
  }
}

function printInboxStats(data: ActorsResponse): void {
  console.log(`Actor inbox: ${data.inboxTarget ?? data.actorId}`);
  console.log(`  unread: ${data.unread ?? 0}`);
  console.log(`  total: ${data.total ?? 0}`);
  if (data.max !== undefined && data.max !== null) {
    console.log(`  max: ${data.max}`);
  }
}

export async function handleActors(positional: string[], options: CLIOptions): Promise<void> {
  if (positional[0] === 'admission' && positional[1] === 'grant') {
    await issueOperatorAdmissionGrant(options);
    return;
  }
  const actorId = positional[0];
  if (actorId && (options.inbox === true || options.messages === true)) {
    const data = await fetchActorInbox(actorId, options);
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    printInboxMessages(data);
    if (options['mark-read'] === true || options.ack === true) {
      const result = await markActorInboxRead(actorId);
      if (!isQuiet(options)) {
        console.log(`Marked ${result.marked ?? 0} message${result.marked === 1 ? '' : 's'} read in ${result.inboxTarget ?? actorId}`);
      }
    }
    return;
  }

  if (actorId && (options['inbox-stats'] === true || options.stats === true)) {
    const data = await fetchActorInboxStats(actorId);
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    printInboxStats(data);
    return;
  }

  if (actorId && (typeof options.message === 'string' || typeof options.m === 'string')) {
    const data = await sendActorMessage(actorId, options);
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    if (!isQuiet(options)) {
      console.log(`Message queued to ${data.inboxTarget} (${data.messageId})`);
    }
    return;
  }

  const qs = queryString(options);
  const path = actorId
    ? `/actors/${encodeURIComponent(actorId)}${qs}`
    : `/actors${qs}`;
  const data = await fetchActors(path);

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (actorId) {
    if (!data.actor) {
      ui.error('actor response did not include an actor');
      process.exit(1);
    }
    printActor(data.actor);
    return;
  }

  const actors = data.actors ?? [];
  if (isQuiet(options)) {
    console.log(String(actors.length));
    return;
  }

  if (actors.length === 0) {
    ui.info('No fleet actors found');
    return;
  }

  console.log('Fleet actors');
  console.log('------------');
  printActors(actors);
}
