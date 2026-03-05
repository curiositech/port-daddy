/**
 * CLI Sessions & Notes Commands
 *
 * Handles: session, sessions, note, notes commands
 */

import { status as maritimeStatus } from '../../lib/maritime.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import { getDirectSessions } from '../utils/direct-db.js';
import { canPrompt, promptText, promptSelect } from '../utils/prompt.js';
import type { PdFetchResponse } from '../utils/fetch.js';

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

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to start session'));
    if (data.conflicts) {
      const conflicts = data.conflicts as Array<{ file: string; sessionId: string; purpose: string }>;
      console.error('');
      console.error('File conflicts:');
      for (const c of conflicts) {
        console.error(`  ${c.file} (claimed by ${c.sessionId}: ${c.purpose})`);
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
    console.log(maritimeStatus('success', `Started session: ${sessionId}`));
    console.log(`  Purpose: ${purpose}`);
    if (files.length > 0) {
      console.log(`  Files claimed: ${files.length}`);
    }
  }
}

async function sessionEnd(rest: string[], options: CLIOptions, status: string): Promise<void> {
  const note = rest[0] || (options.note as string) || undefined;

  // Find active session first
  const listRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/sessions?status=active&limit=1`);
  const listData = await listRes.json();

  if (!listRes.ok || (listData.count as number) === 0) {
    console.error(maritimeStatus('error', 'No active session found'));
    process.exit(1);
  }

  const sessions = listData.sessions as Array<{ id: string }>;
  const sessionId = sessions[0].id;

  const body: Record<string, unknown> = { status };
  if (note) body.note = note;

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to end session'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (!isQuiet(options)) {
    const statusMsg = status === 'abandoned' ? 'warning' : 'success';
    const verb = status === 'abandoned' ? 'Abandoned' : 'Ended';
    console.log(maritimeStatus(statusMsg, `${verb} session: ${sessionId}`));
    if (data.filesReleased) {
      console.log(`  Files released: ${data.filesReleased}`);
    }
  }
}

async function sessionRemove(rest: string[], options: CLIOptions): Promise<void> {
  const sessionId = rest[0];
  if (!sessionId) {
    console.error('Usage: port-daddy session rm <id>');
    process.exit(1);
  }

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE'
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to delete session'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (!isQuiet(options)) {
    console.log(maritimeStatus('success', `Deleted session: ${sessionId}`));
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

  // Find active session first
  const listRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/sessions?status=active&limit=1`);
  const listData = await listRes.json();

  if (!listRes.ok || (listData.count as number) === 0) {
    console.error(maritimeStatus('error', 'No active session found'));
    process.exit(1);
  }

  const sessions = listData.sessions as Array<{ id: string }>;
  const sessionId = sessions[0].id;

  if (filesCmd === 'add') {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/sessions/${encodeURIComponent(sessionId)}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: paths })
    });

    const data = await res.json();

    if (!res.ok) {
      console.error(maritimeStatus('error', (data.error as string) || 'Failed to claim files'));
      if (data.conflicts) {
        const conflicts = data.conflicts as Array<{ file: string; sessionId: string; purpose: string }>;
        console.error('');
        console.error('File conflicts:');
        for (const c of conflicts) {
          console.error(`  ${c.file} (claimed by ${c.sessionId}: ${c.purpose})`);
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
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/sessions/${encodeURIComponent(sessionId)}/files`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: paths })
    });

    const data = await res.json();

    if (!res.ok) {
      console.error(maritimeStatus('error', (data.error as string) || 'Failed to release files'));
      process.exit(1);
    }

    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else if (!isQuiet(options)) {
      console.log(`Released ${data.filesReleased || 0} file(s) from session ${sessionId}`);
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
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to set phase'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (!isQuiet(options)) {
    console.log(maritimeStatus('success', `Session ${sessionId}: ${data.previousPhase} → ${data.phase}`));
  }
}

/**
 * Handle `pd files` command — list all active file claims
 */
export async function handleFiles(options: CLIOptions): Promise<void> {
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/files`);
  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to list files'));
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
  }>;

  if (!claims || claims.length === 0) {
    if (!isQuiet(options)) {
      console.log('No active file claims');
    }
    return;
  }

  const now = Date.now();
  console.log('FILE'.padEnd(40) + 'SESSION'.padEnd(18) + 'AGENT'.padEnd(14) + 'PHASE'.padEnd(14) + 'AGE');
  console.log('\u2500'.repeat(90));

  for (const c of claims) {
    const age = formatAge(now - c.claimedAt);
    const file = c.filePath.length > 38 ? '...' + c.filePath.slice(-35) : c.filePath.padEnd(40);
    const agent = (c.agentId || '-').slice(0, 12).padEnd(14);
    console.log(
      `${file}${c.sessionId.slice(0, 16).padEnd(18)}${agent}${c.phase.padEnd(14)}${age}`
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
    console.error('Usage: port-daddy who-owns <file-path>');
    process.exit(1);
  }

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/files/who-owns?path=${encodeURIComponent(filePath)}`);
  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to check ownership'));
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
  }>;

  if (isQuiet(options)) {
    console.log(data.claimed ? 'claimed' : 'unclaimed');
    return;
  }

  if (!owners || owners.length === 0) {
    console.log(`${filePath}: unclaimed`);
    return;
  }

  console.log(`${filePath}: claimed by ${owners.length} session(s)`);
  for (const o of owners) {
    const agent = o.agentId ? ` (agent: ${o.agentId})` : '';
    console.log(`  ${o.sessionId}: ${o.purpose} [${o.phase}]${agent}`);
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
        console.error(maritimeStatus('error', (result.error as string) || 'Failed to start session'));
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(result, null, 2));
      } else if (isQuiet(options)) {
        console.log(result.id);
      } else {
        console.log(maritimeStatus('success', `Started session: ${result.id}`));
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
  const params = new URLSearchParams();

  // Default to active sessions unless --all is specified
  if (!options.all) {
    params.append('status', 'active');
  }

  if (options.status) {
    params.delete('status');
    params.append('status', options.status as string);
  }

  // Worktree filtering: by default, show current worktree only
  // Use --all-worktrees or --aw to see sessions from all worktrees
  if (options['all-worktrees'] || options.aw) {
    params.append('allWorktrees', 'true');
  }

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/sessions?${params}`);
  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to list sessions'));
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

  const body: Record<string, unknown> = { content };
  if (options.type) body.type = options.type;

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to add note'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (!isQuiet(options)) {
    console.log(maritimeStatus('success', `Note added to session ${data.sessionId}`));
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
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to get notes'));
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
