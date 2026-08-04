/**
 * CLI Sessions & Notes Commands
 *
 * Handles: session, sessions, note, notes commands
 */

import PortDaddy from '../../lib/client.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import { getDirectSessions } from '../utils/direct-db.js';
import { canPrompt, promptText, promptSelect } from '../utils/prompt.js';
import { requireConfirmation, DESTRUCTIVE_EXIT_CODE } from '../utils/destructive-confirm.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';
import { readCurrentContext, writeCurrentContext } from '../utils/current-context.js';
import { loadFleetConfig } from '../../lib/fleet-engine.js';
import { deriveChangelogFromNote } from '../../lib/changelog-from-note.js';
import {
  attachCliSessionWorktreePolicy,
  resolveCliSessionWorktreePolicy,
} from '../utils/session-worktree-policy.js';
import { resolveRelinkRent, formatRentReceipt, RELINK_GATE_MESSAGE } from './sugar.js';

type SessionStartResult = Awaited<ReturnType<PortDaddy['startSession']>>;
type SessionEndResult = Awaited<ReturnType<PortDaddy['endSession']>>;
type SessionListResult = Awaited<ReturnType<PortDaddy['sessions']>>;
type SessionRemoveResult = Awaited<ReturnType<PortDaddy['removeSession']>>;
type SessionTakeoverResult = Awaited<ReturnType<PortDaddy['takeoverSession']>>;
type FileClaimResult = Awaited<ReturnType<PortDaddy['claimFiles']>>;
type FileReleaseResult = Awaited<ReturnType<PortDaddy['releaseFiles']>>;
type NoteResult = Awaited<ReturnType<PortDaddy['note']>>;
type ErrorBody = Record<string, unknown>;
type ActiveSessionResolution = {
  sessionId: string;
  source: 'explicit-session' | 'current-context' | 'active-agent';
};
type FileRegion = {
  path: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
  symbolPath?: string;
};
type SessionLifecycle = 'durable' | 'ephemeral';

function parseSessionLifecycle(value: unknown): SessionLifecycle | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'durable' || normalized === 'ephemeral' ? normalized : null;
}

function createSessionClient(options: CLIOptions): PortDaddy {
  const current = readCurrentContext();
  return new PortDaddy({
    agentId: (typeof options.agent === 'string' ? options.agent : undefined) || current?.agentId || `cli-${process.pid}`,
    pid: process.pid,
  });
}

function getErrorBody(error: unknown): ErrorBody {
  if (error && typeof error === 'object' && 'body' in error) {
    const body = (error as { body?: unknown }).body;
    if (body && typeof body === 'object') return body as ErrorBody;
  }
  return {};
}

function stringOption(options: CLIOptions, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = options[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function numberOption(options: CLIOptions, ...keys: string[]): number | undefined {
  const raw = keys.map(key => options[key]).find(value => value !== undefined);
  if (raw === undefined) return undefined;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function projectFromIdentity(identity: string | null | undefined): string | undefined {
  if (!identity || typeof identity !== 'string') return undefined;
  const project = identity.split(':')[0]?.trim();
  return project || undefined;
}

function inferNotesProject(options: CLIOptions): string | undefined {
  if (options.all || options['all-projects'] || options.global) return undefined;
  const explicit = stringOption(options, 'project');
  if (explicit) return explicit;

  try {
    const fleetConfig = loadFleetConfig(process.cwd());
    if (fleetConfig?.name) return fleetConfig.name;
  } catch {
    // Fall back to session context below.
  }

  const current = readCurrentContext();
  return projectFromIdentity(current?.identity) ?? projectFromIdentity(current?.agentId);
}

function buildRegionFromOptions(paths: string[], options: CLIOptions): FileRegion[] | undefined {
  const symbolPath = stringOption(options, 'symbol-path', 'symbolPath');
  const symbol = stringOption(options, 'symbol');
  const startLine = numberOption(options, 'start-line', 'startLine');
  const endLine = numberOption(options, 'end-line', 'endLine');
  const hasStart = startLine !== undefined;
  const hasEnd = endLine !== undefined;
  const hasRegion = Boolean(symbolPath || symbol || hasStart || hasEnd);

  if (!hasRegion) return undefined;
  if (paths.length !== 1) {
    ui.error('Region claims operate on exactly one path. Use separate commands for multiple regions.');
    process.exit(1);
  }
  if (Number.isNaN(startLine) || Number.isNaN(endLine)) {
    ui.error('--start-line and --end-line must be numbers');
    process.exit(1);
  }
  if (hasStart !== hasEnd) {
    ui.error('Provide both --start-line and --end-line for line-range claims');
    process.exit(1);
  }
  if (!symbolPath && !hasStart) {
    ui.error('Region claims require --symbol-path or both --start-line and --end-line');
    process.exit(1);
  }

  const region: FileRegion = { path: paths[0] };
  if (symbolPath) region.symbolPath = symbolPath;
  if (symbol) region.symbol = symbol;
  if (hasStart) region.startLine = startLine;
  if (hasEnd) region.endLine = endLine;
  return [region];
}

/**
 * Resolve the active session that a file-claim command should mutate.
 *
 * Sample input:
 * `current = { agentId: "agent-a", sessionId: "session-1" }`
 *
 * Sample output:
 * `{ sessionId: "session-1", source: "current-context" }`
 */
async function resolveActiveSessionForFiles(
  pd: PortDaddy,
  options: CLIOptions
): Promise<ActiveSessionResolution | null> {
  const current = readCurrentContext();
  const explicitSessionId = stringOption(options, 'session', 'session-id', 'sessionId');
  const explicitAgentId = stringOption(options, 'agent', 'agent-id', 'agentId');
  const contextSessionId = current?.sessionId;
  const contextAgentId = current?.agentId;
  const candidateSessionId = explicitSessionId || contextSessionId;
  const candidateAgentId = explicitAgentId || contextAgentId || pd.agentId;

  if (candidateSessionId) {
    try {
      const whoami = await pd.whoami({ agentId: candidateAgentId, sessionId: candidateSessionId });
      if (whoami?.active && whoami.sessionId) {
        return {
          sessionId: whoami.sessionId,
          source: explicitSessionId ? 'explicit-session' : 'current-context',
        };
      }
      if (explicitSessionId) {
        ui.error(whoami?.hint || `Session "${explicitSessionId}" is not active`);
        process.exit(1);
      }
    } catch (error) {
      if (explicitSessionId) {
        const errorBody = getErrorBody(error);
        ui.error((errorBody.error as string) || (error as Error).message || 'Failed to resolve session');
        process.exit(1);
      }
    }
  }

  let listData: SessionListResult;
  try {
    listData = await pd.sessions({
      status: 'active',
      agentId: candidateAgentId,
      limit: 1,
    });
  } catch (error) {
    const errorBody = getErrorBody(error);
    ui.error((errorBody.error as string) || (error as Error).message || 'Failed to list sessions');
    process.exit(1);
  }

  if (!listData.success || listData.count === 0) return null;

  return {
    sessionId: listData.sessions[0].id,
    source: 'active-agent',
  };
}

/**
 * Handle `pd session <subcommand>` commands
 */
export async function handleSession(
  subcommand: string | undefined,
  rest: string[],
  options: CLIOptions,
  useDirect = false
): Promise<void> {
  if (!subcommand) {
    console.error('Usage: port-daddy session <start|end|done|abandon|takeover|rm|files|phase|relink> [args]');
    console.error('');
    console.error('Commands:');
    console.error('  start <purpose> [--files file1 file2...] [--agent AGENT_ID] [--force]');
    console.error('  end [note] [--status STATUS]');
    console.error('  done [note]           # Alias for "end" with status=completed');
    console.error('  abandon [note]        # End session with status=abandoned');
    console.error('  takeover <id> [note]  # Start a successor session; preserve old notes');
    console.error('  rm <id>               # Archive a session; preserve old notes');
    console.error('  files add <paths...> [--session ID]  # Claim files in active session');
    console.error('  files rm <paths...> [--session ID]   # Release files in active session');
    console.error('  symbols add --file <path> --symbol <symbolPath> [--type modify]  # Declare a symbol claim (409s on blocking conflict)');
    console.error('  symbols list [--session ID]          # List active symbol claims');
    console.error('  phase <id> <phase>    # Set session phase');
    console.error('  relink --roadmap <slug> | --sidequest "<reason>"  # Fix the active session\'s roadmap rent');
    console.error('');
    console.error('Phases: planning, in_progress, testing, reviewing, completed, abandoned');
    process.exit(1);
  }

  // Direct mode for Tier 1 session operations
  if (useDirect) {
    return handleSessionDirect(subcommand, rest, options);
  }

  switch (subcommand) {
    case 'start':
      return sessionStart(rest, options);
    case 'end':
    case 'done':
      return sessionEnd(rest, options, subcommand === 'done' ? 'completed' : (options.status as string) || 'completed');
    case 'abandon':
      return sessionEnd(rest, options, 'abandoned');
    case 'takeover':
      return sessionTakeover(rest, options);
    case 'rm':
      return sessionRemove(rest, options);
    case 'files':
      return sessionFiles(rest, options);
    case 'symbols':
      return sessionSymbols(rest, options);
    case 'phase':
      return sessionPhase(rest, options);
    case 'relink':
      return sessionRelink(options);
    default:
      console.error(`Unknown session command: ${subcommand}`);
      console.error('Run "port-daddy session" for usage');
      process.exit(1);
  }
}

async function sessionStart(rest: string[], options: CLIOptions): Promise<void> {
  let purpose: string | undefined = rest[0] || (options.purpose as string) || undefined;

  if (!purpose && canPrompt()) {
    purpose = await promptText({ label: 'Session purpose:', required: true }) || undefined;
    if (!purpose) {
      console.error('Purpose is required');
      process.exit(1);
    }
    if (!options.lifecycle) {
      const lifecycle = await promptSelect({
        label: 'Session lifecycle?',
        choices: [
          { value: 'durable', label: 'Durable work context' },
          { value: 'ephemeral', label: 'Heartbeat-bound process session' },
        ],
        default: 'durable',
      });
      if (lifecycle) options.lifecycle = lifecycle;
    }
  } else if (!purpose) {
    console.error('Usage: port-daddy session start <purpose> --lifecycle durable|ephemeral [--purpose "text"] [-P "text"]');
    process.exit(1);
  }

  const lifecycle = parseSessionLifecycle(options.lifecycle);
  if (!lifecycle) {
    ui.error('session start requires --lifecycle durable|ephemeral');
    console.error('Usage: port-daddy session start <purpose> --lifecycle durable|ephemeral [--purpose "text"] [-P "text"]');
    process.exit(1);
  }

  const pd = createSessionClient(options);
  const body: Record<string, unknown> = { purpose };
  if (pd.agentId) body.agentId = pd.agentId;
  if (options.force) body.force = true;
  body.lifecycle = lifecycle;

  // Collect files from --files option or remaining positional args
  const files: string[] = [];
  if (options.files) {
    const filesOpt = options.files;
    if (typeof filesOpt === 'string') {
      files.push(filesOpt);
    } else if (Array.isArray(filesOpt)) {
      files.push(...filesOpt);
    }
  }
  // Also check remaining positional args after purpose
  for (let i = 1; i < rest.length; i++) {
    if (!rest[i].startsWith('-')) {
      files.push(rest[i]);
    }
  }
  if (files.length > 0) {
    body.files = files;
  }

  const worktreePolicy = resolveCliSessionWorktreePolicy(options);
  if (!worktreePolicy.success) {
    ui.error(worktreePolicy.error || 'Session worktree policy failed');
    if (worktreePolicy.hint) console.error(`  ${worktreePolicy.hint}`);
    process.exit(1);
  }
  attachCliSessionWorktreePolicy(body, worktreePolicy);

  let data: SessionStartResult;
  try {
    data = await pd.startSession(body as {
      purpose: string;
      agentId?: string;
      files?: string[];
      force?: boolean;
      metadata?: Record<string, unknown>;
      lifecycle?: SessionLifecycle;
    });
  } catch (error) {
    const errorBody = getErrorBody(error);
    ui.error((errorBody.error as string) || (error as Error).message || 'Failed to start session');
    if (Array.isArray(errorBody.conflicts)) {
      const conflicts = errorBody.conflicts as Array<{ filePath?: string; file?: string; sessionId: string; purpose: string }>;
      console.error('');
      console.error('File conflicts:');
      for (const c of conflicts) {
        const filePath = c.filePath || c.file || '<unknown>';
        console.error(`  ${filePath} (claimed by ${c.sessionId}: ${c.purpose})`);
      }
    }
    process.exit(1);
  }

  const sessionId = data.id as string;
  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (isQuiet(options)) {
    console.log(sessionId);
  } else if (ui.lineworkEnabled({ json: isJson(options), quiet: isQuiet(options) })) {
    const rows: ui.LineworkRow[] = [
      { state: 'confirmed', label: 'session', text: sessionId },
      { state: 'pending', label: 'purpose', text: purpose },
      { state: lifecycle === 'durable' ? 'healthy' : 'info', label: 'lifecycle', text: lifecycle },
    ];
    if (files.length > 0) {
      rows.push({ state: 'confirmed', label: 'files', text: `${files.length} claimed` });
    }
    console.log(ui.renderLineworkPanel({
      title: 'Session Start',
      subtitle: sessionId,
      tone: 'healthy',
      zone: 'session anchored',
      rows,
      footer: 'notes and file claims are now attached to this session',
    }));
  } else {
    ui.success(`Started session: ${sessionId}`);
    console.log(`  Purpose: ${purpose}`);
    console.log(`  Lifecycle: ${lifecycle}`);
    if (files.length > 0) {
      console.log(`  Files claimed: ${files.length}`);
    }
  }
}

async function sessionEnd(rest: string[], options: CLIOptions, status: string): Promise<void> {
  const note = rest[0] || (options.note as string) || undefined;

  if (status === 'abandoned') {
    const ok = await requireConfirmation({
      summary: 'Session abandon will mark your active session as abandoned and release every file claim it holds. Notes are preserved but other agents may take over the abandoned work via salvage.',
      args: options as Record<string, unknown>,
    });
    if (!ok) process.exit(DESTRUCTIVE_EXIT_CODE);
  }

  const pd = createSessionClient(options);
  let data: SessionEndResult;
  try {
    if (status === 'completed') {
      const noPr = options['no-pr'] === true || options.noPr === true;
      const subtask = options.subtask === true || options['subtask'] === true;
      const skipOriginCheck = options.skipOriginCheck === true || options['skip-origin-check'] === true;
      const skipOriginCheckReason = (options.reason as string | undefined) || undefined;

      const sugarResult = await pd.done(note, {
        agentId: stringOption(options, 'agent', 'agent-id', 'agentId'),
        sessionId: stringOption(options, 'session', 'session-id', 'sessionId'),
        status,
        skipOriginCheck: skipOriginCheck ? true : undefined,
        skipOriginCheckReason: skipOriginCheck ? skipOriginCheckReason : undefined,
        noPr: noPr ? true : undefined,
        subtask: subtask ? true : undefined,
      });

      data = {
        success: sugarResult.success,
        id: sugarResult.sessionId,
        error: sugarResult.error,
        releasedFiles: sugarResult.releasedFiles,
      } as any;
    } else {
      data = await pd.endSession(note, { status });
    }
  } catch (error) {
    const errorBody = getErrorBody(error);
    ui.error((errorBody.error as string) || (error as Error).message || 'Failed to end session');
    const hint = (errorBody as any)?.hint;
    if (typeof hint === 'string') {
      console.error(hint.split('\n').map((line: string) => `  ${line}`).join('\n'));
    }
    process.exit(1);
  }

  const sessionId = data.id;

  if (!data.success || !sessionId) {
    ui.error(data.error || 'No active session found');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (!isQuiet(options)) {
    const verb = status === 'abandoned' ? 'Abandoned' : 'Ended';
    if (status === 'abandoned') {
      ui.warn(`${verb} session: ${sessionId}`);
    } else {
      ui.success(`${verb} session: ${sessionId}`);
    }
    const releasedFiles = Array.isArray(data.releasedFiles) ? data.releasedFiles : [];
    if (releasedFiles.length > 0) {
      console.log(`  Files released: ${releasedFiles.length}`);
    }
  }
}

async function sessionRemove(rest: string[], options: CLIOptions): Promise<void> {
  const sessionId = rest[0];
  if (!sessionId) {
    console.error('Usage: port-daddy session rm <id>');
    process.exit(1);
  }

  const pd = createSessionClient(options);
  let data: SessionRemoveResult;
  try {
    data = await pd.removeSession(sessionId);
  } catch (error) {
    const errorBody = getErrorBody(error);
    ui.error((errorBody.error as string) || (error as Error).message || 'Failed to delete session');
    process.exit(1);
  }

  if (!data.success) {
    ui.error('Failed to archive session');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (!isQuiet(options)) {
    ui.success(`Archived session: ${sessionId}`);
    const releasedFiles = Array.isArray((data as any).releasedFiles) ? (data as any).releasedFiles : [];
    if (releasedFiles.length > 0) {
      console.log(`  Files released: ${releasedFiles.length}`);
    }
    console.log('  Notes preserved: yes');
  }
}

async function sessionTakeover(rest: string[], options: CLIOptions): Promise<void> {
  const sessionId = rest[0];
  if (!sessionId) {
    console.error('Usage: port-daddy session takeover <id> [note] [--purpose PURPOSE] [--no-files] [--lifecycle durable|ephemeral]');
    process.exit(1);
  }

  const note = rest.slice(1).join(' ') || (options.note as string) || undefined;
  const lifecycleValue = options.lifecycle === undefined ? undefined : parseSessionLifecycle(options.lifecycle);
  if (options.lifecycle !== undefined && !lifecycleValue) {
    ui.error('session takeover requires --lifecycle durable|ephemeral when lifecycle is provided');
    process.exit(1);
  }

  const pd = createSessionClient(options);
  const body: Parameters<PortDaddy['takeoverSession']>[1] = {
    note,
    purpose: typeof options.purpose === 'string' ? options.purpose : undefined,
    lifecycle: lifecycleValue || undefined,
    claimFiles: !(options['no-files'] || options['no-claims']),
  };

  const worktreePolicy = resolveCliSessionWorktreePolicy(options);
  if (!worktreePolicy.success) {
    ui.error(worktreePolicy.error || 'Session worktree policy failed');
    if (worktreePolicy.hint) console.error(`  ${worktreePolicy.hint}`);
    process.exit(1);
  }
  attachCliSessionWorktreePolicy(body as Record<string, unknown>, worktreePolicy);

  let data: SessionTakeoverResult;
  try {
    data = await pd.takeoverSession(sessionId, body);
  } catch (error) {
    const errorBody = getErrorBody(error);
    ui.error((errorBody.error as string) || (error as Error).message || 'Failed to take over session');
    process.exit(1);
  }

  if (!data.success) {
    ui.error(data.error || 'Failed to take over session');
    process.exit(1);
  }

  if (data.successorId) {
    const successor = data.session as Record<string, unknown> | undefined;
    const successorAgentId = typeof successor?.agentId === 'string'
      ? successor.agentId
      : (typeof options.agent === 'string' ? options.agent : readCurrentContext()?.agentId);
    if (successorAgentId) {
      writeCurrentContext({
        agentId: successorAgentId,
        sessionId: data.successorId,
        purpose: typeof successor?.purpose === 'string' ? successor.purpose : undefined,
        identity: typeof successor?.identityProject === 'string' ? successor.identityProject : null,
        startedAt: typeof successor?.createdAt === 'number' ? successor.createdAt : Date.now(),
      });
    }
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (isQuiet(options)) {
    console.log(data.successorId);
  } else {
    ui.success(`Took over session: ${sessionId}`);
    console.log(`  Successor: ${data.successorId}`);
    console.log('  Notes preserved: yes');
    if (Array.isArray(data.claimedFiles) && data.claimedFiles.length > 0) {
      console.log(`  Files claimed: ${data.claimedFiles.length}`);
    }
    if (Array.isArray(data.conflicts) && data.conflicts.length > 0) {
      ui.warn(`  Conflicts reported: ${data.conflicts.length}`);
    }
    if (Array.isArray(data.warnings) && data.warnings.length > 0) {
      for (const warning of data.warnings) {
        ui.warn(`  ${warning}`);
      }
    }
  }
}

async function sessionFiles(rest: string[], options: CLIOptions): Promise<void> {
  const rawFilesCmd = rest[0];
  const filesCmd = rawFilesCmd === 'claim'
    ? 'add'
    : rawFilesCmd === 'release'
      ? 'rm'
      : rawFilesCmd;

  if (!filesCmd || !['add', 'rm'].includes(filesCmd)) {
    console.error('Usage: port-daddy session files <add|rm> <paths...> [--session ID]');
    console.error('       Compatibility aliases: claim -> add, release -> rm');
    process.exit(1);
  }

  const paths = rest.slice(1);
  if (paths.length === 0) {
    console.error(`Usage: port-daddy session files ${filesCmd} <paths...> [--session ID]`);
    console.error(`       Region options: --symbol-path SYMBOL_PATH or --start-line N --end-line N [--symbol NAME]`);
    process.exit(1);
  }
  const regions = buildRegionFromOptions(paths, options);

  const pd = createSessionClient(options);
  const activeSession = await resolveActiveSessionForFiles(pd, options);
  if (!activeSession) {
    ui.error('No active session found');
    process.exit(1);
  }

  const sessionId = activeSession.sessionId;

  if (filesCmd === 'add') {
    let data: FileClaimResult;
    try {
      data = regions
        ? await pd.claimFiles(sessionId, [], { regions, force: Boolean(options.force) })
        : await pd.claimFiles(sessionId, paths);
    } catch (error) {
      const errorBody = getErrorBody(error);
      ui.error((errorBody.error as string) || (error as Error).message || 'Failed to claim files');
      if (Array.isArray(errorBody.conflicts)) {
        const conflicts = errorBody.conflicts as Array<{ filePath?: string; file?: string; sessionId: string; purpose: string }>;
        console.error('');
        console.error('File conflicts:');
        for (const c of conflicts) {
          const filePath = c.filePath || c.file || '<unknown>';
          console.error(`  ${filePath} (claimed by ${c.sessionId}: ${c.purpose})`);
        }
      }
      process.exit(1);
    }

    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else if (!isQuiet(options)) {
      const claimed = Array.isArray(data.claimed) ? data.claimed.length : paths.length;
      console.log(`Claimed ${claimed} file(s) in session ${sessionId}`);
    }
  } else {
    let data: FileReleaseResult;
    try {
      data = regions
        ? await pd.releaseFiles(sessionId, [], { regions })
        : await pd.releaseFiles(sessionId, paths);
    } catch (error) {
      const errorBody = getErrorBody(error);
      ui.error((errorBody.error as string) || (error as Error).message || 'Failed to release files');
      process.exit(1);
    }

    if (!data.success) {
      ui.error('Failed to release files');
      process.exit(1);
    }

    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else if (!isQuiet(options)) {
      const released = Array.isArray(data.released) ? data.released.length : 0;
      console.log(`Released ${released} file(s) from session ${sessionId}`);
    }
  }
}

/**
 * `pd session symbols add --file <path> --symbol <symbolPath> [--type modify] [--no-radius]`
 * `pd session symbols list [--session ID]`
 *
 * The claim-a-function verb (function-claims revival, slice 1). Hits the daemon's
 * POST/GET /sessions/:id/symbols; the route's ast-a2-1 pre-flight validator (#983)
 * REFUSES blocking conflicts with 409 BLOCKING_CONFLICT — this handler prints the
 * conflicting session/agent and symbol, the witnessed refusal.
 */
async function sessionSymbols(rest: string[], options: CLIOptions): Promise<void> {
  const symCmd = rest[0];
  const usage = () => {
    console.error('Usage: port-daddy session symbols add --file <path> --symbol <symbolPath> [--type read|modify|add-sibling|add-child|delete|rename] [--no-radius] [--session ID]');
    console.error('       port-daddy session symbols list [--session ID]');
  };
  if (!symCmd || !['add', 'list'].includes(symCmd)) {
    usage();
    process.exit(1);
  }

  const pd = createSessionClient(options);
  const activeSession = await resolveActiveSessionForFiles(pd, options);
  if (!activeSession) {
    ui.error('No active session found');
    process.exit(1);
  }
  const sessionId = activeSession.sessionId;

  if (symCmd === 'list') {
    const res: PdFetchResponse = await pdFetch(`/sessions/${encodeURIComponent(sessionId)}/symbols`);
    const data = await res.json();
    if (!res.ok) {
      ui.error((data.error as string) || 'Failed to list symbol claims');
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    const claims = (data.claims ?? []) as Array<{
      filePath: string; symbolPath: string; type: string; autoDerived: boolean; derivedFrom: string | null;
    }>;
    if (claims.length === 0) {
      if (!isQuiet(options)) console.log(`No active symbol claims in session ${sessionId}`);
      return;
    }
    console.log('SYMBOL'.padEnd(36) + 'FILE'.padEnd(40) + 'TYPE'.padEnd(14) + 'SOURCE');
    console.log('─'.repeat(100));
    for (const c of claims) {
      const sym = c.symbolPath.length > 34 ? c.symbolPath.slice(0, 31) + '...' : c.symbolPath;
      const file = c.filePath.length > 38 ? '...' + c.filePath.slice(-35) : c.filePath;
      const source = c.autoDerived ? `auto (${c.derivedFrom ?? 'radius'})` : 'explicit';
      console.log(sym.padEnd(36) + file.padEnd(40) + c.type.padEnd(14) + source);
    }
    console.log('');
    console.log(`Total: ${claims.length} symbol claim(s) in session ${sessionId}`);
    return;
  }

  // add
  const file = stringOption(options, 'file');
  const symbol = stringOption(options, 'symbol', 'symbol-path', 'symbolPath');
  const type = stringOption(options, 'type') || 'modify';
  if (!file || !symbol) {
    usage();
    process.exit(1);
  }

  const body: Record<string, unknown> = { claims: [{ filePath: file, symbolPath: symbol, type }] };
  if (options['no-radius']) body.autoDeriveRadius = false;

  const res: PdFetchResponse = await pdFetch(`/sessions/${encodeURIComponent(sessionId)}/symbols`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();

  if (res.status === 409 && data.code === 'BLOCKING_CONFLICT') {
    ui.error(`Symbol claim REFUSED: ${symbol} — blocking conflict with an active session`);
    const conflicts = (data.conflicts ?? []) as Array<{
      type: string;
      a: { filePath: string; symbolPath: string; type: string };
      b: { filePath: string; symbolPath: string; type: string };
      otherSessionId: string;
      otherAgentId?: string | null;
    }>;
    for (const c of conflicts) {
      const holder = c.otherAgentId ? `${c.otherAgentId} (session ${c.otherSessionId})` : `session ${c.otherSessionId}`;
      console.error(`  ${c.type}: ${c.b.filePath}::${c.b.symbolPath} held as ${c.b.type}-claim by ${holder}`);
    }
    console.error('');
    console.error('Coordinate with the holder or wait for their session to end, then retry.');
    process.exit(1);
  }
  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to claim symbol');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (!isQuiet(options)) {
    const claimed = Array.isArray(data.claimed) ? data.claimed.length : 0;
    const autoDerived = Array.isArray(data.autoDerived) ? data.autoDerived.length : 0;
    ui.success(`Claimed ${symbol} (${type}) in session ${sessionId}`);
    if (autoDerived > 0) {
      console.log(`  Blast radius: ${autoDerived} auto-derived read-claim(s) on downstream callers`);
    } else if (claimed > 1) {
      console.log(`  Recorded ${claimed} claim(s)`);
    }
    const conflicts = Array.isArray(data.conflicts) ? data.conflicts : [];
    if (conflicts.length > 0) {
      ui.warn(`  ${conflicts.length} non-blocking conflict(s) predicted — check pd inbox for details`);
    }
  }
}

async function sessionPhase(rest: string[], options: CLIOptions): Promise<void> {
  const sessionId = rest[0];
  const phase = rest[1];

  if (!sessionId || !phase) {
    console.error('Usage: port-daddy session phase <session-id> <phase>');
    console.error('Phases: planning, in_progress, testing, reviewing, completed, abandoned');
    process.exit(1);
  }

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/sessions/${encodeURIComponent(sessionId)}/phase`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phase })
  });

  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to set phase');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (!isQuiet(options)) {
    ui.success(`Session ${sessionId}: ${data.previousPhase} → ${data.phase}`);
  }
}

/**
 * `pd session relink --roadmap <slug> | --sidequest "<reason>"`
 *
 * Anti-Goodhart valve for rent-at-claim: fixes the ACTIVE session's roadmap
 * link / sidequest opt-out. Same validation as pd begin (slug must exist,
 * with did-you-mean; sidequest min 12 chars; mutually exclusive). The daemon
 * records an old -> new audit note on the session.
 */
async function sessionRelink(options: CLIOptions): Promise<void> {
  const rent = resolveRelinkRent(options);
  if (!rent.ok) {
    ui.error(rent.error || RELINK_GATE_MESSAGE);
    process.exit(1);
  }

  const ctx = readCurrentContext();
  const agentId = (typeof options.agent === 'string' ? options.agent : undefined) || ctx?.agentId;
  const sessionId = (typeof options.session === 'string' ? options.session : undefined) || ctx?.sessionId;

  const body: Record<string, unknown> = {};
  if (agentId) body.agentId = agentId;
  if (sessionId) body.sessionId = sessionId;
  if (rent.roadmapLink) body.roadmapLink = rent.roadmapLink;
  if (rent.sidequestReason) body.sidequestReason = rent.sidequestReason;

  const res: PdFetchResponse = await pdFetch('/sugar/relink', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to relink session');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (isQuiet(options)) {
    console.log(data.sessionId);
    return;
  }

  const oldDesc = data.previousRoadmapLink
    ? `roadmap:${data.previousRoadmapLink}`
    : data.previousSidequestReason
      ? `sidequest:${data.previousSidequestReason}`
      : 'none';
  const newDesc = data.roadmapLink
    ? `roadmap:${data.roadmapLink}`
    : `sidequest:${data.sidequestReason}`;
  ui.success(`Session ${data.sessionId} relinked: ${oldDesc} → ${newDesc}`);
  const receipt = formatRentReceipt({
    roadmapLink: data.roadmapLink as string | undefined,
    sidequestReason: data.sidequestReason as string | undefined,
  });
  if (receipt) console.error(`  ${receipt}`);
}

/**
 * Handle `pd files` command — list all active file claims
 */
export async function handleFiles(options: CLIOptions): Promise<void> {
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/files`);
  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to list files');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const claims = data.claims as Array<{
    filePath: string;
    sessionId: string;
    purpose: string;
    agentId: string | null;
    phase: string;
    claimedAt: number;
    startLine: number | null;
    endLine: number | null;
    symbol: string | null;
  }>;

  if (!claims || claims.length === 0) {
    if (!isQuiet(options)) {
      console.log('No active file claims');
    }
    return;
  }

  const now = Date.now();
  console.log('FILE'.padEnd(40) + 'SESSION'.padEnd(18) + 'AGENT'.padEnd(14) + 'REGION'.padEnd(22) + 'AGE');
  console.log('\u2500'.repeat(100));

  for (const c of claims) {
    const age = formatAge(now - c.claimedAt);
    const file = c.filePath.length > 38 ? '...' + c.filePath.slice(-35) : c.filePath.padEnd(40);
    const agent = (c.agentId || '-').slice(0, 12).padEnd(14);
    let region = 'whole file';
    if (c.startLine != null && c.endLine != null) {
      region = `lines ${c.startLine}-${c.endLine}`;
      if (c.symbol) region += `: ${c.symbol}`;
    }
    console.log(
      `${file}${c.sessionId.slice(0, 16).padEnd(18)}${agent}${region.slice(0, 20).padEnd(22)}${age}`
    );
  }
  console.log('');
  console.log(`Total: ${claims.length} file claim(s)`);
}

/**
 * Handle `pd who-owns <path>` command
 */
export async function handleWhoOwns(filePath: string | undefined, options: CLIOptions): Promise<void> {
  if (!filePath) {
    console.error('Usage: port-daddy who-owns <file-path>[:<startLine>-<endLine>] [--symbol-path SYMBOL_PATH]');
    process.exit(1);
  }

  // Parse optional range syntax: "src/routes.ts:10-50"
  let actualPath = filePath;
  let startLine: number | undefined;
  let endLine: number | undefined;
  const rangeMatch = filePath.match(/^(.+):(\d+)-(\d+)$/);
  if (rangeMatch) {
    actualPath = rangeMatch[1];
    startLine = parseInt(rangeMatch[2], 10);
    endLine = parseInt(rangeMatch[3], 10);
  }
  const optionStartLine = numberOption(options, 'start-line', 'startLine');
  const optionEndLine = numberOption(options, 'end-line', 'endLine');
  if (Number.isNaN(optionStartLine) || Number.isNaN(optionEndLine)) {
    ui.error('--start-line and --end-line must be numbers');
    process.exit(1);
  }
  if (optionStartLine !== undefined) startLine = optionStartLine;
  if (optionEndLine !== undefined) endLine = optionEndLine;
  if ((startLine === undefined) !== (endLine === undefined)) {
    ui.error('Provide both --start-line and --end-line for line-range ownership checks');
    process.exit(1);
  }
  const symbolPath = stringOption(options, 'symbol-path', 'symbolPath');

  let url = `${PORT_DADDY_URL}/files/who-owns?path=${encodeURIComponent(actualPath)}`;
  if (startLine !== undefined && endLine !== undefined) {
    url += `&startLine=${startLine}&endLine=${endLine}`;
  }
  if (symbolPath) {
    url += `&symbolPath=${encodeURIComponent(symbolPath)}`;
  }

  const res: PdFetchResponse = await pdFetch(url);
  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to check ownership');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const owners = data.owners as Array<{
    sessionId: string;
    purpose: string;
    agentId: string | null;
    phase: string;
    claimedAt: number;
    startLine: number | null;
    endLine: number | null;
    symbol: string | null;
    symbolPath?: string | null;
  }>;

  if (isQuiet(options)) {
    console.log(data.claimed ? 'claimed' : 'unclaimed');
    return;
  }

  const displayPath = symbolPath
    ? `${actualPath}#${symbolPath}`
    : startLine
      ? `${actualPath}:${startLine}-${endLine}`
      : actualPath;
  if (!owners || owners.length === 0) {
    console.log(`${displayPath}: unclaimed`);
    return;
  }

  console.log(`${displayPath}: claimed by ${owners.length} session(s)`);
  for (const o of owners) {
    const agent = o.agentId ? ` (agent: ${o.agentId})` : '';
    let region = '';
    if (o.startLine != null && o.endLine != null) {
      region = ` [lines ${o.startLine}-${o.endLine}${o.symbol ? ': ' + o.symbol : ''}]`;
      if (o.symbolPath) region += ` (${o.symbolPath})`;
    } else {
      region = ' [whole file]';
    }
    console.log(`  ${o.sessionId}: ${o.purpose} [${o.phase}]${agent}${region}`);
  }
}

/**
 * Direct-mode session handler (no daemon required)
 */
function handleSessionDirect(subcommand: string, rest: string[], options: CLIOptions): void {
  const sessions = getDirectSessions();

  switch (subcommand) {
    case 'start': {
      const purpose = rest[0];
      if (!purpose) {
        console.error('Usage: port-daddy session start <purpose> --lifecycle durable|ephemeral [--files file1 file2...]');
        process.exit(1);
      }

      const lifecycle = parseSessionLifecycle(options.lifecycle);
      if (!lifecycle) {
        console.error('Usage: port-daddy session start <purpose> --lifecycle durable|ephemeral [--files file1 file2...]');
        process.exit(1);
      }

      const files: string[] = [];
      if (options.files) {
        const filesOpt = options.files;
        if (typeof filesOpt === 'string') {
          files.push(filesOpt);
        } else if (Array.isArray(filesOpt)) {
          files.push(...filesOpt);
        }
      }

      const result = sessions.start(purpose, {
        agentId: options.agent as string,
        files: files.length > 0 ? files : undefined,
        durable: lifecycle === 'durable',
      });

      if (!result.success) {
        ui.error((result.error as string) || 'Failed to start session');
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(result, null, 2));
      } else if (isQuiet(options)) {
        console.log(result.id);
      } else {
        ui.success(`Started session: ${result.id}`);
        console.log(`  Lifecycle: ${lifecycle}`);
      }
      break;
    }

    default:
      // For other direct-mode commands, fall back to showing help
      console.error(`Direct mode not yet implemented for: session ${subcommand}`);
      console.error('Start the daemon or use API mode.');
      process.exit(1);
  }
}

/**
 * Handle `pd sessions` command
 */
export async function handleSessions(options: CLIOptions): Promise<void> {
  const pd = createSessionClient(options);
  let data: SessionListResult;
  try {
    data = await pd.sessions({
      status: options.all ? undefined : (options.status as string) || 'active',
      agentId: options.agent as string | undefined,
      project: options.project as string | undefined,
      purpose: options.purpose as string | undefined,
      allWorktrees: Boolean(options['all-worktrees'] || options.aw),
    });
  } catch (error) {
    const errorBody = getErrorBody(error);
    ui.error((errorBody.error as string) || (error as Error).message || 'Failed to list sessions');
    process.exit(1);
  }

  if (!data.success) {
    ui.error(data.error || 'Failed to list sessions');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const sessions = data.sessions as Array<{
    id: string;
    purpose: string;
    status: string;
    worktreeId?: string;
    createdAt: number;
    fileCount?: number;
    noteCount?: number;
    metadata?: { roadmapLink?: string; sidequestReason?: string } | null;
  }>;

  if (sessions.length === 0) {
    if (!isQuiet(options)) {
      const worktreeNote = data.worktreeId ? ` (worktree: ${data.worktreeId})` : '';
      console.log(`No sessions found${worktreeNote}`);
    }
    return;
  }

  // Table output
  const now = Date.now();
  const showingAll = options['all-worktrees'] || options.aw;
  if (!isQuiet(options) && data.worktreeId && !showingAll) {
    console.log(`Showing sessions for worktree ${data.worktreeId} (use --all-worktrees for all)`);
    console.log('');
  }
  if (ui.lineworkEnabled({ json: isJson(options), quiet: isQuiet(options) })) {
    const rows = sessions.map((s): ui.LineworkRow => {
      const meta = s.metadata && typeof s.metadata === 'object' ? s.metadata : null;
      const link = typeof meta?.roadmapLink === 'string' && meta.roadmapLink
        ? `roadmap ${meta.roadmapLink}`
        : typeof meta?.sidequestReason === 'string' && meta.sidequestReason
          ? `sidequest ${meta.sidequestReason}`
          : 'no link';
      const status = s.status.toLowerCase();
      const state: ui.LineworkState = status === 'active'
        ? 'active'
        : status === 'completed'
          ? 'confirmed'
          : status === 'abandoned'
            ? 'recovering'
            : status.includes('block')
              ? 'blocked'
              : 'unknown';
      const age = formatAge(now - s.createdAt);
      return {
        state,
        label: s.id.slice(0, 10),
        text: `${s.purpose} · ${s.status} · files ${s.fileCount || 0} · notes ${s.noteCount || 0} · ${age} · ${link}`,
      };
    });
    console.log(ui.renderLineworkPanel({
      title: 'Sessions',
      subtitle: showingAll ? 'all worktrees' : (data.worktreeId ? `worktree ${data.worktreeId}` : 'active'),
      tone: rows.some((row) => row.state === 'blocked') ? 'blocked' : 'running',
      zone: `${sessions.length} session(s)`,
      rows,
      footer: showingAll
        ? `${sessions.length} session(s) shown across all worktrees`
        : `${sessions.length} session(s) shown · use --all-worktrees for the full fleet`,
    }));
    return;
  }
  console.log('ID              PURPOSE                    STATUS    FILES  NOTES  AGE      LINK');
  console.log('─'.repeat(95));

  for (const s of sessions) {
    const age = formatAge(now - s.createdAt);
    const purposeStr = s.purpose.length > 26 ? s.purpose.slice(0, 23) + '...' : s.purpose.padEnd(26);
    // Rent-at-claim (S3): show the roadmap link or the sidequest opt-out.
    const meta = s.metadata && typeof s.metadata === 'object' ? s.metadata : null;
    const link = typeof meta?.roadmapLink === 'string' && meta.roadmapLink
      ? meta.roadmapLink
      : typeof meta?.sidequestReason === 'string' && meta.sidequestReason
        ? `sidequest: ${meta.sidequestReason.length > 32 ? meta.sidequestReason.slice(0, 29) + '...' : meta.sidequestReason}`
        : '—';
    console.log(
      `${s.id.padEnd(16)}${purposeStr} ${s.status.padEnd(10)}${String(s.fileCount || 0).padStart(5)}  ${String(s.noteCount || 0).padStart(5)}  ${age.padEnd(8)} ${link}`
    );
  }
}

/**
 * Handle `pd note <content>` command
 */
export async function handleNote(content: string | undefined, options: CLIOptions): Promise<void> {
  // Flag alternative: --content "text" or -c "text"
  content = content || (options.content as string) || undefined;

  if (!content && canPrompt()) {
    content = await promptText({ label: 'Note content:', required: true }) || undefined;
    if (!content) {
      console.error('Note content is required');
      process.exit(1);
    }
    if (!options.type) {
      const type = await promptSelect({
        label: 'Note type?',
        choices: [
          { value: 'general', label: 'General note' },
          { value: 'progress', label: 'Progress update' },
          { value: 'decision', label: 'Decision made' },
          { value: 'blocker', label: 'Something blocking' },
          { value: 'question', label: 'Need input' },
        ],
        default: 'general',
      });
      if (type) options.type = type;
    }
  } else if (!content) {
    console.error('Usage: port-daddy note <content> [--content "text"] [-c "text"] [--type TYPE]');
    process.exit(1);
  }

  const current = readCurrentContext();
  const explicitSessionId = typeof options.session === 'string' ? options.session : undefined;
  const explicitAgentId = typeof options.agent === 'string' ? options.agent : undefined;
  const pd = createSessionClient(options);

  let sessionId = explicitSessionId;
  let agentId = explicitAgentId;

  if (!sessionId && !explicitAgentId && current?.sessionId) {
    try {
      const whoami = await pd.whoami({
        agentId: current.agentId || pd.agentId,
        sessionId: current.sessionId,
      });
      if (whoami?.active && whoami.sessionId) {
        sessionId = whoami.sessionId;
        agentId = whoami.agentId || current.agentId || undefined;
      }
    } catch {
      // Ignore stale local context and fail closed below if no explicit scope exists.
    }
  }

  if (!sessionId && !agentId && current?.agentId) {
    try {
      const whoami = await pd.whoami({ agentId: current.agentId });
      if (whoami?.active) {
        sessionId = whoami.sessionId || undefined;
        agentId = whoami.agentId || current.agentId;
      }
    } catch {
      // Ignore stale local context and fall through to the server-side closed-fail path.
    }
  }

  const body: Record<string, unknown> = { content };
  if (options.type) body.type = options.type;
  if (!sessionId) {
    if (agentId) body.agentId = agentId;
  }

  const data: NoteResult = await pd.note(content, {
    type: typeof body.type === 'string' ? body.type : undefined,
    agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
    sessionId,
  });

  if (!data?.success) {
    ui.error(data?.error || 'Failed to add note');
    process.exit(1);
  }

  // Rent-note → changelog (ADR-0050 phase 7). The compulsion already guarantees
  // a note per commit; when the author marks it (--changelog or a leading
  // Conventional-Commit token), that same note also files a changelog entry —
  // one note, two purposes. Best-effort: a changelog failure never fails the
  // note (coordination rent is already paid by this point).
  // NOTE: `--type` is the NOTE's own kind (general/progress/decision/…) and must
  // NOT be reused as the changelog type. The changelog type comes from the
  // leading Conventional-Commit token or an explicit `--changelog-type`.
  const intent = deriveChangelogFromNote({
    content,
    changelog: Boolean(options.changelog),
    type: typeof options['changelog-type'] === 'string' ? (options['changelog-type'] as string) : undefined,
  });
  let changelogId: number | undefined;
  if (intent.record) {
    const identity =
      (typeof options.identity === 'string' && options.identity) ||
      current?.identity ||
      inferNotesProject(options) ||
      'port-daddy';
    try {
      const res = await pdFetch(`${PORT_DADDY_URL}/changelog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity,
          type: intent.type,
          summary: intent.summary,
          description: intent.description,
          sessionId: data.sessionId ?? sessionId,
          agentId,
        }),
      });
      const cl = await res.json();
      if (res.ok && typeof cl.id === 'number') changelogId = cl.id;
    } catch {
      // Changelog is best-effort; the note (the rent) already landed.
    }
  }

  if (isJson(options)) {
    console.log(JSON.stringify({ ...data, changelogId }, null, 2));
  } else if (!isQuiet(options)) {
    ui.success(`Note added to session ${data.sessionId}`);
    if (changelogId !== undefined) {
      ui.info(`Changelog entry #${changelogId} filed (${intent.type}): ${intent.summary}`);
    }
  }
}

/**
 * Handle `pd notes [session-id]` command
 */
export async function handleNotes(sessionId: string | undefined, options: CLIOptions): Promise<void> {
  let url: string;
  if (sessionId) {
    url = `${PORT_DADDY_URL}/sessions/${encodeURIComponent(sessionId)}/notes`;
  } else {
    url = `${PORT_DADDY_URL}/notes`;
  }

  const params = new URLSearchParams();
  if (options.limit) params.append('limit', String(options.limit));
  if (options.type) params.append('type', options.type as string);
  const explicitProject = stringOption(options, 'project');
  if (explicitProject) {
    params.append('project', explicitProject);
  } else if (!sessionId) {
    const project = inferNotesProject(options);
    if (project) params.append('project', project);
  }

  const res: PdFetchResponse = await pdFetch(`${url}?${params}`);
  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to get notes');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const notes = data.notes as Array<{
    id: number;
    sessionId: string;
    content: string;
    type: string;
    createdAt: number;
    sessionPurpose?: string;
    sessionStatus?: string;
  }>;

  if (notes.length === 0) {
    if (!isQuiet(options)) {
      console.log('No notes found');
    }
    return;
  }

  // Group by session if showing all notes
  const now = Date.now();
  let currentSessionId = '';

  for (const note of notes) {
    if (note.sessionId !== currentSessionId) {
      currentSessionId = note.sessionId;
      const statusStr = note.sessionStatus ? ` (${note.sessionStatus})` : '';
      console.log(`\n--- ${note.sessionId}: ${note.sessionPurpose || 'Unknown'}${statusStr} ---`);
    }

    const age = formatAge(now - note.createdAt);
    const typePrefix = note.type !== 'note' ? `[${note.type}] ` : '';
    console.log(`  [${age}] ${typePrefix}${note.content}`);
  }
}

function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
