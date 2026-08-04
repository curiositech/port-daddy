/**
 * CLI Resurrection Commands
 *
 * Self-healing agent system commands for discovering and
 * reclaiming work from stale or dead agents.
 */

import { JOLLY_ROGER, JOLLY_ROGER_COMPACT, ANSI } from '../../lib/banner.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';
import { requireConfirmation, DESTRUCTIVE_EXIT_CODE } from '../utils/destructive-confirm.js';
import { readCurrentContext } from '../utils/current-context.js';
import { normalizeSelfSalvage, formatSelfSalvageNote } from '../../lib/telos-salvage.js';

interface StaleAgent {
  id: string;
  name: string;
  purpose: string | null;
  sessionId: string | null;
  lastHeartbeat: number;
  staleSince: number;
  status: 'pending' | 'stale' | 'dead' | 'resurrecting';
  notes?: string[];
  identityProject: string | null;
  identityStack: string | null;
  identityContext: string | null;
}

export interface SalvageTriageSummary {
  total: number;
  statuses: Record<string, number>;
  ageBuckets: {
    recent: number;
    sameDay: number;
    stale: number;
  };
  projects: Array<{ project: string; count: number }>;
  encryptedNotes: number;
}

export type SalvageTriageBucketId =
  | 'resume-now'
  | 'verify-dismiss'
  | 'test-noise'
  | 'no-evidence'
  | 'archive-later';

export interface SalvageTriageEntry {
  id: string;
  name: string;
  identity: string | null;
  status: StaleAgent['status'];
  ageMs: number;
  reason: string;
  evidence: string | null;
  command: string;
}

export interface SalvageTriageBucket {
  id: SalvageTriageBucketId;
  title: string;
  action: string;
  count: number;
  agents: SalvageTriageEntry[];
}

export interface SalvageTriagePlan {
  summary: SalvageTriageSummary;
  buckets: SalvageTriageBucket[];
  nextActions: string[];
}

export interface SalvageNextSelection {
  bucket: Pick<SalvageTriageBucket, 'id' | 'title' | 'action' | 'count'>;
  item: SalvageTriageEntry;
}

function parseEncryptedNote(note: string): boolean {
  try {
    const parsed = JSON.parse(note) as Record<string, unknown>;
    return typeof parsed.iv === 'string' && typeof parsed.ct === 'string' && typeof parsed.tag === 'string';
  } catch {
    return false;
  }
}

export function formatSalvageNote(note: string): string {
  if (parseEncryptedNote(note)) {
    return '[encrypted note redacted; use the original session context or keychain-backed tooling if the content is needed]';
  }
  return note;
}

function agentIdentity(agent: StaleAgent): string | null {
  if (!agent.identityProject) return null;
  return `${agent.identityProject}${agent.identityStack ? ':' + agent.identityStack : ''}${agent.identityContext ? ':' + agent.identityContext : ''}`;
}

export function summarizeSalvageAgents(agents: StaleAgent[], now: number = Date.now()): SalvageTriageSummary {
  const statuses: Record<string, number> = {};
  const projectCounts = new Map<string, number>();
  const ageBuckets = { recent: 0, sameDay: 0, stale: 0 };
  let encryptedNotes = 0;

  for (const agent of agents) {
    statuses[agent.status] = (statuses[agent.status] ?? 0) + 1;
    const project = agent.identityProject || '(unknown project)';
    projectCounts.set(project, (projectCounts.get(project) ?? 0) + 1);

    const ageMs = Math.max(0, now - agent.staleSince);
    if (ageMs < 2 * 60 * 60 * 1000) {
      ageBuckets.recent++;
    } else if (ageMs < 24 * 60 * 60 * 1000) {
      ageBuckets.sameDay++;
    } else {
      ageBuckets.stale++;
    }

    encryptedNotes += (agent.notes ?? []).filter(parseEncryptedNote).length;
  }

  const projects = [...projectCounts.entries()]
    .map(([project, count]) => ({ project, count }))
    .sort((a, b) => b.count - a.count || a.project.localeCompare(b.project));

  return {
    total: agents.length,
    statuses,
    ageBuckets,
    projects,
    encryptedNotes,
  };
}

const TRIAGE_BUCKET_META: Record<SalvageTriageBucketId, { title: string; action: string }> = {
  'resume-now': {
    title: 'Resume now',
    action: 'Claim these first; they look recent, blocked, or continuation-rich.',
  },
  'verify-dismiss': {
    title: 'Verify, then dismiss',
    action: 'Likely completed/promoted. Check the named commit or validation note, then dismiss if landed.',
  },
  'test-noise': {
    title: 'Test or fixture residue',
    action: 'Usually safe to dismiss after confirming it came from stale-context/test coverage.',
  },
  'no-evidence': {
    title: 'No evidence',
    action: 'No purpose or usable notes. Inspect session files before spending agent time.',
  },
  'archive-later': {
    title: 'Archive later',
    action: 'Older or ambiguous context. Queue behind resume-now and verify-dismiss work.',
  },
};

const completionPattern = /\b(committed|pushed|promoted|promotion complete|completed|validation|validated|tests? passed|typecheck passed|green)\b/i;
const blockerPattern = /\b(blocked|blocker|not committed|uncommitted|dirty|failed|failing|todo|next|starting|continuing|in progress|wip|needs?)\b/i;
const testNoisePattern = /(^|:)test(:|$)|stale-whoami|stale-note|demo-scripts-test|recovered from stale context/i;
const DEFAULT_NEXT_BUCKETS: SalvageTriageBucketId[] = ['resume-now', 'archive-later'];
const ALL_TRIAGE_BUCKETS = Object.keys(TRIAGE_BUCKET_META) as SalvageTriageBucketId[];

function previewText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized;
}

function triageEvidence(agent: StaleAgent): string {
  return [
    agent.purpose ?? '',
    ...(agent.notes ?? []).map(formatSalvageNote),
    agentIdentity(agent) ?? '',
    agent.name,
    agent.id,
  ].join('\n');
}

function firstEvidenceLine(agent: StaleAgent): string | null {
  return previewText(agent.purpose)
    ?? previewText((agent.notes ?? []).map(formatSalvageNote).find(note => note.trim().length > 0))
    ?? agentIdentity(agent);
}

function classifySalvageAgent(agent: StaleAgent, now: number): { bucket: SalvageTriageBucketId; reason: string } {
  const evidence = triageEvidence(agent);
  const ageMs = Math.max(0, now - agent.staleSince);
  const isRecent = ageMs < 2 * 60 * 60 * 1000;
  const hasPurpose = Boolean(previewText(agent.purpose));
  const hasNotes = (agent.notes ?? []).some(note => previewText(formatSalvageNote(note)));
  const looksComplete = completionPattern.test(evidence);
  const looksBlocked = blockerPattern.test(evidence);
  const looksLikeTestNoise = testNoisePattern.test(evidence);

  if (looksLikeTestNoise) {
    return { bucket: 'test-noise', reason: 'identity or notes look like test/stale-context residue' };
  }
  if (isRecent || (looksBlocked && !looksComplete)) {
    return { bucket: 'resume-now', reason: isRecent ? 'recent non-live work' : 'notes mention blockers or continuation' };
  }
  if (looksComplete && !looksBlocked) {
    return { bucket: 'verify-dismiss', reason: 'notes mention commit, push, promotion, or green validation' };
  }
  if (!hasPurpose && !hasNotes) {
    return { bucket: 'no-evidence', reason: 'no purpose or note context' };
  }
  return { bucket: 'archive-later', reason: 'older ambiguous handoff' };
}

function commandForBucket(bucket: SalvageTriageBucketId, agentId: string): string {
  if (bucket === 'verify-dismiss' || bucket === 'test-noise') {
    return `pd salvage dismiss ${agentId}`;
  }
  return `pd salvage claim ${agentId}`;
}

export function triageSalvageAgents(agents: StaleAgent[], now: number = Date.now()): SalvageTriagePlan {
  const buckets = new Map<SalvageTriageBucketId, SalvageTriageEntry[]>();
  for (const bucketId of Object.keys(TRIAGE_BUCKET_META) as SalvageTriageBucketId[]) {
    buckets.set(bucketId, []);
  }

  for (const agent of agents) {
    const { bucket, reason } = classifySalvageAgent(agent, now);
    const ageMs = Math.max(0, now - agent.staleSince);
    buckets.get(bucket)!.push({
      id: agent.id,
      name: agent.name || agent.id,
      identity: agentIdentity(agent),
      status: agent.status,
      ageMs,
      reason,
      evidence: firstEvidenceLine(agent),
      command: commandForBucket(bucket, agent.id),
    });
  }

  const orderedBuckets = ([...buckets.entries()] as Array<[SalvageTriageBucketId, SalvageTriageEntry[]]>)
    .map(([id, entries]) => {
      const meta = TRIAGE_BUCKET_META[id];
      const agents = entries.sort((a, b) => a.ageMs - b.ageMs || a.id.localeCompare(b.id));
      return {
        id,
        title: meta.title,
        action: meta.action,
        count: agents.length,
        agents,
      };
    });

  return {
    summary: summarizeSalvageAgents(agents, now),
    buckets: orderedBuckets,
    nextActions: [
      'Claim one resume-now item, finish it, then run pd salvage complete or dismiss.',
      'Dismiss verify-dismiss and test-noise entries only after checking the referenced commit/session evidence.',
      'Use --json as the future idle-agent work queue: agents should pull one bounded item, claim it, and publish notes.',
    ],
  };
}

export function selectNextSalvageWork(
  plan: SalvageTriagePlan,
  preferredBucket?: SalvageTriageBucketId,
): SalvageNextSelection | null {
  const bucketOrder = preferredBucket ? [preferredBucket] : DEFAULT_NEXT_BUCKETS;

  for (const bucketId of bucketOrder) {
    const bucket = plan.buckets.find(candidate => candidate.id === bucketId);
    const item = bucket?.agents[0];
    if (bucket && item) {
      return {
        bucket: {
          id: bucket.id,
          title: bucket.title,
          action: bucket.action,
          count: bucket.count,
        },
        item,
      };
    }
  }

  return null;
}

function formatCount(name: string, count: number): string | null {
  return count > 0 ? `${count} ${name}` : null;
}

function printSalvageTriage(summary: SalvageTriageSummary): void {
  const statusLine = Object.entries(summary.statuses)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${count} ${status}`)
    .join(', ');
  const ageLine = [
    formatCount('<2h', summary.ageBuckets.recent),
    formatCount('2-24h', summary.ageBuckets.sameDay),
    formatCount('>24h', summary.ageBuckets.stale),
  ].filter(Boolean).join(', ');
  const projectLine = summary.projects
    .slice(0, 5)
    .map(entry => `${entry.project}:${entry.count}`)
    .join(', ');

  console.log(`${ANSI.bold}Triage:${ANSI.reset} ${summary.total} non-live queue entr${summary.total === 1 ? 'y' : 'ies'}`);
  if (statusLine) console.log(`  status: ${statusLine}`);
  if (ageLine) console.log(`  age:    ${ageLine}`);
  if (projectLine) console.log(`  scope:  ${projectLine}${summary.projects.length > 5 ? ', ...' : ''}`);
  if (summary.encryptedNotes > 0) {
    console.log(`  notes:  ${summary.encryptedNotes} encrypted note${summary.encryptedNotes === 1 ? '' : 's'} redacted from CLI output`);
  }
  console.log(`  active: compare with ${ANSI.fgCyan}pd sessions --active${ANSI.reset} and ${ANSI.fgCyan}pd agents --active${ANSI.reset}`);
  console.log('');
}

function printSalvageTriagePlan(plan: SalvageTriagePlan, options: CLIOptions): void {
  console.log(`${ANSI.fgYellow}${ANSI.bold}⚓ Salvage Triage${ANSI.reset}`);
  console.log(`${ANSI.fgGray}${'─'.repeat(60)}${ANSI.reset}`);
  console.log('');
  printSalvageTriage(plan.summary);

  const sampleLimit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0
    ? Math.floor(Number(options.limit))
    : 5;

  for (const bucket of plan.buckets) {
    if (bucket.count === 0) continue;
    console.log(`${ANSI.bold}${bucket.title}${ANSI.reset} (${bucket.count})`);
    console.log(`  ${bucket.action}`);
    for (const entry of bucket.agents.slice(0, sampleLimit)) {
      const age = formatAge(entry.ageMs);
      const identity = entry.identity ? ` ${ANSI.fgCyan}${entry.identity}${ANSI.reset}` : '';
      console.log(`  - ${entry.name} (${entry.status}, ${age})${identity}`);
      console.log(`    Reason: ${entry.reason}`);
      if (entry.evidence) console.log(`    Evidence: ${entry.evidence}`);
      console.log(`    Next: ${ANSI.fgCyan}${entry.command}${ANSI.reset}`);
    }
    if (bucket.count > sampleLimit) {
      console.log(`    ... ${bucket.count - sampleLimit} more; rerun with --limit ${bucket.count} or --json`);
    }
    console.log('');
  }

  console.log(`${ANSI.bold}Queue handoff${ANSI.reset}`);
  for (const action of plan.nextActions) {
    console.log(`  - ${action}`);
  }
}

function parseBucketOption(value: unknown): SalvageTriageBucketId | undefined {
  if (typeof value !== 'string') return undefined;
  if ((ALL_TRIAGE_BUCKETS as string[]).includes(value)) return value as SalvageTriageBucketId;
  return undefined;
}

function bucketScopeLabel(bucketId: SalvageTriageBucketId | undefined): string {
  return bucketId ?? DEFAULT_NEXT_BUCKETS.join('/');
}

function printSalvageNext(selection: SalvageNextSelection, plan: SalvageTriagePlan): void {
  const entry = selection.item;
  const age = formatAge(entry.ageMs);
  console.log(`${ANSI.bold}Next salvage work${ANSI.reset}`);
  console.log(`  Bucket: ${selection.bucket.title} (${selection.bucket.count})`);
  console.log(`  Action: ${selection.bucket.action}`);
  console.log(`  Agent:  ${entry.name} (${entry.status}, ${age})`);
  if (entry.identity) console.log(`  Scope:  ${ANSI.fgCyan}${entry.identity}${ANSI.reset}`);
  console.log(`  Reason: ${entry.reason}`);
  if (entry.evidence) console.log(`  Evidence: ${entry.evidence}`);
  console.log(`  Next:   ${ANSI.fgCyan}${entry.command}${ANSI.reset}`);
  console.log('');
  console.log(`${ANSI.bold}Queue state${ANSI.reset}`);
  console.log(`  Total: ${plan.summary.total}`);
  console.log(`  Default pull buckets: ${DEFAULT_NEXT_BUCKETS.join(', ')}`);
  console.log(`  Inspect all buckets: ${ANSI.fgCyan}pd salvage triage --json${ANSI.reset}`);
}

async function claimSalvageAgent(agentId: string, options: CLIOptions): Promise<Record<string, unknown>> {
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/salvage/claim/${encodeURIComponent(agentId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newAgentId: options.agent || readCurrentContext()?.agentId || `cli-${process.pid}` })
  });
  const data = await res.json();

  if (!res.ok) {
    throw new Error((data.error as string) || 'Failed to claim agent');
  }

  return data as Record<string, unknown>;
}

/**
 * Handle `pd salvage` command
 * Lists agents pending resurrection with their context
 */
export async function handleSalvage(subcommand: string | undefined, args: string[], options: CLIOptions): Promise<void> {
  if (subcommand === 'help') {
    console.error('Usage: port-daddy salvage [subcommand] [options]');
    console.error('');
    console.error('Salvage work from dead/stale agents');
    console.error('');
    console.error('Subcommands:');
    console.error('  (none)                          Show agents awaiting salvage (filtered by --project)');
    console.error('  triage                          Cluster salvage queue into action buckets');
    console.error('  next                            Print one bounded work item for an idle agent');
    console.error('  show <agent-id>                 Render the full self-salvage capsule + notes for one queue entry');
    console.error('  claim <agent-id>                Claim an agent\'s work');
    console.error('  complete <old-id> <new-id>      Mark salvage complete');
    console.error('  abandon <agent-id>              Return agent to queue');
    console.error('  dismiss <agent-id>              Remove from queue (reviewed)');
    console.error('');
    console.error('Options:');
    console.error('  --project <name>                Filter to agents in this project (e.g., myapp)');
    console.error('  --stack <name>                  Further filter by stack (requires --project)');
    console.error('  --all                           Show ALL queue entries globally (use sparingly)');
    console.error('  --limit <n>                     Limit number of results');
    console.error('  --summary                       Show only grouped stale/dead triage');
    console.error('  --bucket <id>                   With next: pull a specific triage bucket');
    console.error('  --claim                         With next: claim a claimable item immediately');
    console.error('');
    console.error('By default, salvage shows agents in the current project. Use --all for global view.');
    process.exit(0);
  }

  switch (subcommand) {
    case 'next': {
      const endpoint = options.all ? '/salvage' : '/salvage/pending';
      const params = new URLSearchParams();
      if (options.project) params.append('project', options.project as string);
      if (options.stack) params.append('stack', options.stack as string);

      const requestedBucket = options.bucket === undefined ? undefined : parseBucketOption(options.bucket);
      if (options.bucket !== undefined && !requestedBucket) {
        ui.error(`Unknown salvage bucket "${String(options.bucket)}". Use one of: ${ALL_TRIAGE_BUCKETS.join(', ')}`);
        process.exit(1);
      }

      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}${endpoint}${params.toString() ? '?' + params : ''}`);
      const data = await res.json();

      if (!res.ok) {
        ui.error((data.error as string) || 'Failed to inspect salvage queue');
        process.exit(1);
      }

      const agents = data.agents as StaleAgent[];
      const plan = triageSalvageAgents(agents);
      const selection = selectNextSalvageWork(plan, requestedBucket);

      if (!selection) {
        const payload = {
          success: true,
          bucket: requestedBucket ?? null,
          item: null,
          command: null,
          summary: plan.summary,
          nextActions: plan.nextActions,
        };
        if (isJson(options)) {
          console.log(JSON.stringify(payload, null, 2));
          return;
        }
        if (!isQuiet(options)) {
          ui.info(`No salvage work available in ${bucketScopeLabel(requestedBucket)}.`);
          console.log(`Inspect the full queue with ${ANSI.fgCyan}pd salvage triage --project ${options.project || '<project>'}${ANSI.reset}`);
        }
        return;
      }

      const claimRequested = options.claim === true;
      if (claimRequested && !selection.item.command.startsWith('pd salvage claim ')) {
        ui.error(`Selected ${selection.bucket.id} item is not claimable. Run: ${selection.item.command}`);
        process.exit(1);
      }

      let claim: Record<string, unknown> | null = null;
      if (claimRequested) {
        try {
          claim = await claimSalvageAgent(selection.item.id, options);
        } catch (error) {
          ui.error(error instanceof Error ? error.message : 'Failed to claim agent');
          process.exit(1);
        }
      }

      if (isJson(options)) {
        console.log(JSON.stringify({
          success: true,
          bucket: selection.bucket,
          item: selection.item,
          command: selection.item.command,
          claimed: claimRequested,
          claim,
          summary: plan.summary,
          nextActions: plan.nextActions,
        }, null, 2));
        return;
      }

      printSalvageNext(selection, plan);
      if (claim) {
        ui.success(`Claimed ${selection.item.id} for salvage`);
      }
      break;
    }

    case 'triage': {
      const endpoint = options.all ? '/salvage' : '/salvage/pending';
      const params = new URLSearchParams();
      if (options.project) params.append('project', options.project as string);
      if (options.stack) params.append('stack', options.stack as string);

      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}${endpoint}${params.toString() ? '?' + params : ''}`);
      const data = await res.json();

      if (!res.ok) {
        ui.error((data.error as string) || 'Failed to triage salvage queue');
        process.exit(1);
      }

      const agents = data.agents as StaleAgent[];
      const plan = triageSalvageAgents(agents);

      if (isJson(options)) {
        console.log(JSON.stringify(plan, null, 2));
        return;
      }

      if (agents.length === 0) {
        if (!isQuiet(options)) ui.info('No agents awaiting salvage.');
        return;
      }

      printSalvageTriagePlan(plan, options);
      break;
    }

    case 'show': {
      const agentId = args[0];
      if (!agentId) {
        console.error('Usage: pd salvage show <agent-id>');
        process.exit(1);
      }

      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/salvage/${encodeURIComponent(agentId)}`);
      const data = await res.json();

      if (!res.ok) {
        ui.error((data.error as string) || 'Failed to show salvage entry');
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      const agent = data.agent as StaleAgent;
      const capsule = data.capsule as Record<string, unknown> | null;

      // Header — reuse the list renderer's status icons and age formatting.
      const statusIcon = agent.status === 'dead' ? JOLLY_ROGER_COMPACT : agent.status === 'resurrecting' ? '↻' : '⚠';
      const ago = formatAge(Date.now() - agent.staleSince);
      const identity = agentIdentity(agent);

      console.log(`${statusIcon} ${ANSI.bold}${agent.name || agent.id}${ANSI.reset} (${agent.status}, ${ago})`);
      console.log(`  Agent:   ${agent.id}`);
      if (identity) console.log(`  Identity: ${ANSI.fgCyan}${identity}${ANSI.reset}`);
      if (agent.sessionId) console.log(`  Session: ${agent.sessionId}`);
      if (agent.purpose) console.log(`  Purpose: ${agent.purpose}`);
      console.log('');

      // Capsule — untrusted content written by the dying agent. Validate via
      // normalizeSelfSalvage; on success render the canonical note, on failure
      // print raw keys under an honest banner — never crash on forged fields.
      if (capsule) {
        const normalized = normalizeSelfSalvage(capsule);
        if (normalized.success && normalized.capsule) {
          console.log(`${ANSI.bold}Self-Salvage Capsule${ANSI.reset}`);
          for (const line of formatSelfSalvageNote(normalized.capsule).split('\n')) {
            console.log(`  ${line}`);
          }
        } else {
          console.log(`${ANSI.bold}Self-Salvage Capsule${ANSI.reset} ${ANSI.fgYellow}[unverified capsule fields]${ANSI.reset}`);
          for (const [key, value] of Object.entries(capsule)) {
            const rendered = typeof value === 'string' ? value : JSON.stringify(value);
            console.log(`  ${key}: ${String(rendered).slice(0, 200)}`);
          }
        }
        console.log('');
      } else {
        console.log('No self-salvage capsule recorded for this entry.');
        console.log('');
      }

      // Notes — ALL of them (unlike the 3-note list truncation), each through
      // the encrypted-note redaction.
      if (agent.notes?.length) {
        console.log(`${ANSI.bold}Notes${ANSI.reset} (${agent.notes.length})`);
        for (const note of agent.notes) {
          console.log(`  - ${formatSalvageNote(note)}`);
        }
        console.log('');
      }

      console.log(`Claim: ${ANSI.fgCyan}pd salvage claim ${agent.id}${ANSI.reset}   Dismiss: ${ANSI.fgCyan}pd salvage dismiss ${agent.id}${ANSI.reset}`);
      break;
    }

    case 'claim': {
      const agentId = args[0];
      if (!agentId) {
        console.error('Usage: pd salvage claim <agent-id>');
        process.exit(1);
      }

      const ok = await requireConfirmation({
        summary: `Salvage claim will transfer agent ${agentId}'s session, file claims, and notes to you. The previous owner loses control of that work.`,
        args: options as Record<string, unknown>,
      });
      if (!ok) process.exit(DESTRUCTIVE_EXIT_CODE);

      let data: Record<string, unknown>;
      try {
        data = await claimSalvageAgent(agentId, options);
      } catch (error) {
        ui.error(error instanceof Error ? error.message : 'Failed to claim agent');
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      ui.success(`Claimed ${agentId} for salvage`);
      const context = data.context as { sessionId?: string; purpose?: string; notes?: string[] } | undefined;
      if (context) {
        console.log('');
        console.log('Context:');
        if (context.sessionId) console.log(`  Session: ${context.sessionId}`);
        if (context.purpose) console.log(`  Purpose: ${context.purpose}`);
        if (context.notes?.length) {
          console.log('  Notes:');
          for (const note of context.notes) {
            console.log(`    - ${note.slice(0, 80)}${note.length > 80 ? '...' : ''}`);
          }
        }
      }
      break;
    }

    case 'complete': {
      const oldAgentId = args[0];
      const newAgentId = args[1];

      if (!oldAgentId || !newAgentId) {
        console.error('Usage: pd salvage complete <old-agent-id> <new-agent-id>');
        process.exit(1);
      }

      const ok = await requireConfirmation({
        summary: `Salvage complete will mark ${oldAgentId}'s queue entry as finished by ${newAgentId}. The salvage entry is removed and cannot be re-pulled.`,
        args: options as Record<string, unknown>,
      });
      if (!ok) process.exit(DESTRUCTIVE_EXIT_CODE);

      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/salvage/complete/${encodeURIComponent(oldAgentId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newAgentId })
      });
      const data = await res.json();

      if (!res.ok) {
        ui.error((data.error as string) || 'Failed to complete salvage');
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        ui.success(`Salvage complete: ${oldAgentId} -> ${newAgentId}`);
      }
      break;
    }

    case 'abandon': {
      const agentId = args[0];
      if (!agentId) {
        console.error('Usage: pd salvage abandon <agent-id>');
        process.exit(1);
      }

      const ok = await requireConfirmation({
        summary: `Salvage abandon will return ${agentId} to the queue and release any claim you had on its work. Another agent may pick it up.`,
        args: options as Record<string, unknown>,
      });
      if (!ok) process.exit(DESTRUCTIVE_EXIT_CODE);

      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/salvage/abandon/${encodeURIComponent(agentId)}`, {
        method: 'POST'
      });
      const data = await res.json();

      if (!res.ok) {
        ui.error((data.error as string) || 'Failed to abandon salvage');
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(`Returned ${agentId} to salvage queue`);
      }
      break;
    }

    case 'dismiss': {
      const agentId = args[0];
      if (!agentId) {
        console.error('Usage: pd salvage dismiss <agent-id>');
        process.exit(1);
      }

      const ok = await requireConfirmation({
        summary: `Salvage dismiss will permanently remove ${agentId} from the queue. Its purpose, notes, and session context will not be retrievable.`,
        args: options as Record<string, unknown>,
      });
      if (!ok) process.exit(DESTRUCTIVE_EXIT_CODE);

      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/salvage/${encodeURIComponent(agentId)}`, {
        method: 'DELETE'
      });
      const data = await res.json();

      if (!res.ok) {
        ui.error((data.error as string) || 'Failed to dismiss');
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(`Dismissed ${agentId} from salvage queue`);
      }
      break;
    }

    default: {
      // List pending resurrections - filter by project unless --all
      const endpoint = options.all ? '/salvage' : '/salvage/pending';
      const params = new URLSearchParams();
      if (options.limit) params.append('limit', String(options.limit));
      if (options.project) params.append('project', options.project as string);
      if (options.stack) params.append('stack', options.stack as string);

      // Warn about global salvage (can be noisy)
      if (options.all && !options.project && !isQuiet(options) && !isJson(options)) {
        ui.warn('Showing ALL agents globally. Use --project to filter.');
        console.log('');
      }

      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}${endpoint}${params.toString() ? '?' + params : ''}`);
      const data = await res.json();

      if (!res.ok) {
        ui.error((data.error as string) || 'Failed to list salvage queue');
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      const agents = data.agents as StaleAgent[];

      if (agents.length === 0) {
        if (!isQuiet(options)) {
          const scope = options.project ? `${options.project}:*` : 'any project';
          ui.info(`No agents awaiting salvage in ${scope}`);
        }
        return;
      }

      // Show the jolly roger when we have dead agents to salvage
      const deadCount = agents.filter(a => a.status === 'dead').length;
      if (deadCount > 0) {
        console.log(JOLLY_ROGER);
      }

      const scopeLabel = options.project
        ? `${ANSI.fgCyan}${options.project}${options.stack ? ':' + options.stack : ''}:*${ANSI.reset}`
        : `${ANSI.fgGray}(all projects)${ANSI.reset}`;

      console.log(`${ANSI.fgYellow}${ANSI.bold}⚓ Salvage Report${ANSI.reset} ${scopeLabel}`);
      console.log(`${ANSI.fgGray}${'─'.repeat(60)}${ANSI.reset}`);
      console.log('');

      const summary = summarizeSalvageAgents(agents);
      printSalvageTriage(summary);

      if (options.summary === true) {
        return;
      }

      for (const agent of agents) {
        const statusIcon = agent.status === 'dead' ? JOLLY_ROGER_COMPACT : agent.status === 'resurrecting' ? '↻' : '⚠';
        const ago = formatAge(Date.now() - agent.staleSince);

        // Show identity if available
        const identity = agent.identityProject
          ? `${agent.identityProject}${agent.identityStack ? ':' + agent.identityStack : ''}${agent.identityContext ? ':' + agent.identityContext : ''}`
          : null;

        console.log(`${statusIcon} ${agent.name || agent.id} (${agent.status}, ${ago})`);
        if (identity) console.log(`  Identity: ${ANSI.fgCyan}${identity}${ANSI.reset}`);
        if (agent.purpose) console.log(`  Purpose: ${agent.purpose}`);
        if (agent.sessionId) console.log(`  Session: ${agent.sessionId}`);
        if (agent.notes?.length) {
          console.log('  Notes:');
          for (const note of agent.notes.slice(0, 3)) {
            const formatted = formatSalvageNote(note);
            console.log(`    - ${formatted.slice(0, 90)}${formatted.length > 90 ? '...' : ''}`);
          }
          if (agent.notes.length > 3) {
            console.log(`    ... and ${agent.notes.length - 3} more`);
          }
        }
        console.log(`  Salvage: pd salvage claim ${agent.id}`);
        console.log('');
      }

      const filterNote = data.filtered ? ' (filtered)' : '';
      console.log(`${data.count} agent(s) in salvage queue${filterNote}`);
    }
  }
}

/**
 * Format age in human-readable form
 */
function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
