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
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';
import { readCurrentContext } from '../utils/current-context.js';

function createSessionClient(options: CLIOptions): PortDaddy {
  const current = readCurrentContext();
  return new PortDaddy({
    agentId: (typeof options.agent === 'string' ? options.agent : undefined) || current?.agentId || `cli-${process.pid}`,
    pid: process.pid,
  });
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
    console.error('Usage: port-daddy session <start|end|done|abandon|rm|files|phase> [args]');
    console.error('');
    console.error('Commands:');
    console.error('  start <purpose> [--files file1 file2...] [--agent AGENT_ID] [--force]');
    console.error('  end [note] [--status STATUS]');
    console.error('  done [note]           # Alias for "end" with status=completed');
    console.error('  abandon [note]        # End session with status=abandoned');
    console.error('  rm <id>               # Delete a session');
    console.error('  files add <paths...>  # Claim files in active session');
    console.error('  files rm <paths...>   # Release files in active session');
    console.error('  phase <id> <phase>    # Set session phase');
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
    case 'rm':
      return sessionRemove(rest, options);
    case 'files':
      return sessionFiles(rest, options);
    case 'phase':
      return sessionPhase(rest, options);
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
  } else if (!purpose) {
    console.error('Usage: port-daddy session start <purpose> [--purpose "text"] [-P "text"]');
    process.exit(1);
  }

  const body: Record<string, unknown> = { purpose };
  if (options.agent) body.agentId = options.agent;
  if (options.force) body.force = true;

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

  const pd = createSessionClient(options);
  let data: Record<string, unknown>;
  try {
    data = await pd.startSession(body as {
      purpose: string;
      agentId?: string;
      files?: string[];
      force?: boolean;
      metadata?: Record<string, unknown>;
    }) as Record<string, unknown>;
  } catch (error) {
    const body = error && typeof error === 'object' && 'body' in error ? (error as { body?: Record<string, unknown> }).body : null;
    data = body && typeof body === 'object' ? body : {};
    ui.error((data.error as string) || (error as Error).message || 'Failed to start session');
    if (Array.isArray(data.conflicts)) {
      const conflicts = data.conflicts as Array<{ filePath?: string; file?: string; sessionId: string; purpose: string }>;
      console.error('');
      console.error('File conflicts:');
      for (const c of conflicts) {
        const filePath = c.filePath || c.file || '<unknown>';
        console.error(`  ${filePath} (claimed by ${c.sessionId}: ${c.purpose})`);
      }
    }
    process.exit(1);
  }

  const sessionId = data.id;
  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (isQuiet(options)) {
    console.log(sessionId);
  } else {
    ui.success(`Started session: ${sessionId}`);
    console.log(`  Purpose: ${purpose}`);
    if (files.length > 0) {
      console.log(`  Files claimed: ${files.length}`);
    }
  }
}

async function sessionEnd(rest: string[], options: CLIOptions, status: string): Promise<void> {
  const note = rest[0] || (options.note as string) || undefined;
  const pd = createSessionClient(options);
  const data = await pd.endSession(note, { status }) as Record<string, unknown>;
  const sessionId = data.id as string | undefined;

  if (!data.success || !sessionId) {
    ui.error((data.error as string) || 'No active session found');
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
  const data = await pd.removeSession(sessionId) as Record<string, unknown>;

  if (!data.success) {
    ui.error((data.error as string) || 'Failed to delete session');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (!isQuiet(options)) {
    ui.success(`Deleted session: ${sessionId}`);
  }
}

async function sessionFiles(rest: string[], options: CLIOptions): Promise<void> {
  const filesCmd = rest[0];
  if (!filesCmd || !['add', 'rm'].includes(filesCmd)) {
    console.error('Usage: port-daddy session files <add|rm> <paths...>');
    process.exit(1);
  }

  const paths = rest.slice(1);
  if (paths.length === 0) {
    console.error(`Usage: port-daddy session files ${filesCmd} <paths...>`);
    process.exit(1);
  }

  const pd = createSessionClient(options);
  const listData = await pd.sessions({ status: 'active', limit: 1 }) as Record<string, unknown>;

  if (!listData.success || (listData.count as number) === 0) {
    ui.error('No active session found');
    process.exit(1);
  }

  const sessions = listData.sessions as Array<{ id: string }>;
  const sessionId = sessions[0].id;

  if (filesCmd === 'add') {
    let data: Record<string, unknown>;
    try {
      data = await pd.claimFiles(sessionId, paths) as Record<string, unknown>;
    } catch (error) {
      const body = error && typeof error === 'object' && 'body' in error ? (error as { body?: Record<string, unknown> }).body : null;
      data = body && typeof body === 'object' ? body : {};
      ui.error((data.error as string) || (error as Error).message || 'Failed to claim files');
      if (Array.isArray(data.conflicts)) {
        const conflicts = data.conflicts as Array<{ filePath?: string; file?: string; sessionId: string; purpose: string }>;
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
      console.log(`Claimed ${paths.length} file(s) in session ${sessionId}`);
    }
  } else {
    const data = await pd.releaseFiles(sessionId, paths) as Record<string, unknown>;

    if (!data.success) {
      ui.error((data.error as string) || 'Failed to release files');
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
    console.error('Usage: port-daddy who-owns <file-path>[:<startLine>-<endLine>]');
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

  let url = `${PORT_DADDY_URL}/files/who-owns?path=${encodeURIComponent(actualPath)}`;
  if (startLine !== undefined && endLine !== undefined) {
    url += `&startLine=${startLine}&endLine=${endLine}`;
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
  }>;

  if (isQuiet(options)) {
    console.log(data.claimed ? 'claimed' : 'unclaimed');
    return;
  }

  const displayPath = startLine ? `${actualPath}:${startLine}-${endLine}` : actualPath;
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
        console.error('Usage: port-daddy session start <purpose> [--files file1 file2...]');
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
        files: files.length > 0 ? files : undefined
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
  const data = await pd.sessions({
    status: options.all ? undefined : (options.status as string) || 'active',
    agentId: options.agent as string | undefined,
    project: options.project as string | undefined,
    purpose: options.purpose as string | undefined,
    allWorktrees: Boolean(options['all-worktrees'] || options.aw),
  }) as Record<string, unknown>;

  if (!data.success) {
    ui.error((data.error as string) || 'Failed to list sessions');
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
  console.log('ID              PURPOSE                    STATUS    FILES  NOTES  AGE');
  console.log('─'.repeat(75));

  for (const s of sessions) {
    const age = formatAge(now - s.createdAt);
    const purposeStr = s.purpose.length > 26 ? s.purpose.slice(0, 23) + '...' : s.purpose.padEnd(26);
    console.log(
      `${s.id.padEnd(16)}${purposeStr} ${s.status.padEnd(10)}${String(s.fileCount || 0).padStart(5)}  ${String(s.noteCount || 0).padStart(5)}  ${age}`
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
  const sessionId = (typeof options.session === 'string' ? options.session : undefined) || current?.sessionId;

  const body: Record<string, unknown> = { content };
  if (options.type) body.type = options.type;
  if (!sessionId) {
    const agentId = (typeof options.agent === 'string' ? options.agent : undefined) || current?.agentId;
    if (agentId) body.agentId = agentId;
  }

  const endpoint = sessionId
    ? `${PORT_DADDY_URL}/sessions/${encodeURIComponent(sessionId)}/notes`
    : `${PORT_DADDY_URL}/notes`;

  const pd = new PortDaddy({
    agentId: typeof body.agentId === 'string' ? body.agentId : current?.agentId,
  });
  const data = await pd.note(content, {
    type: typeof body.type === 'string' ? body.type : undefined,
    agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
    sessionId,
  });

  if (!data?.success) {
    ui.error((data?.error as string) || 'Failed to add note');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (!isQuiet(options)) {
    ui.success(`Note added to session ${data.sessionId}`);
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
