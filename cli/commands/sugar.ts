/**
 * CLI Sugar Commands — Compound commands for common workflows
 *
 * Handles: begin, done, whoami, with-lock
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { status as maritimeStatus, highlightChannel } from '../../lib/maritime.js';
import { pdFetch } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import { IS_TTY, relativeTime } from '../utils/output.js';
import { canPrompt, promptText, promptSelect, promptIdentity, promptConfirm, printRoger } from '../utils/prompt.js';
import { autoIdentityFromPackageJson } from './services.js';
import type { PdFetchResponse } from '../utils/fetch.js';

// =============================================================================
// .portdaddy/current.json — local context file
// =============================================================================

interface CurrentContext {
  agentId: string;
  sessionId: string;
  purpose: string;
  identity: string | null;
  startedAt: number;
}

function getContextDir(): string {
  return join(process.cwd(), '.portdaddy');
}

function getContextPath(): string {
  return join(getContextDir(), 'current.json');
}

function writeContext(ctx: CurrentContext): void {
  const dir = getContextDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getContextPath(), JSON.stringify(ctx, null, 2));
}

function readContext(): CurrentContext | null {
  const path = getContextPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as CurrentContext;
  } catch {
    return null;
  }
}

function clearContext(): void {
  const path = getContextPath();
  try { unlinkSync(path); } catch {}
}

// =============================================================================
// handleBegin — pd begin "purpose" [--identity X] [--files f1 f2...]
// =============================================================================

export async function handleBegin(
  purpose: string | undefined,
  rest: string[],
  options: CLIOptions,
): Promise<void> {
  // Flag takes precedence over positional
  purpose = purpose || (options.purpose as string) || undefined;

  if (!purpose && canPrompt()) {
    // Interactive wizard
    purpose = await promptText({ label: 'What are you working on?', required: true }) || undefined;
    if (!purpose) {
      console.error(maritimeStatus('error', 'Purpose is required'));
      process.exit(1);
    }

    // Prompt for optional identity with auto-detection
    if (!options.identity) {
      const suggested = autoIdentityFromPackageJson() || undefined;
      const identity = await promptIdentity({ suggested });
      if (identity) options.identity = identity;
    }

    // Prompt for file claims
    if (!options.files) {
      const wantFiles = await promptConfirm('Claim any files?', false);
      if (wantFiles) {
        const filesStr = await promptText({ label: 'File paths (space-separated):' });
        if (filesStr) options.files = filesStr.split(/\s+/).filter(Boolean);
      }
    }
  } else if (!purpose) {
    console.error('Usage: pd begin <purpose> [--purpose "text"] [-P "text"]');
    console.error('       pd begin --identity ID --agent AGENT_ID --files f1 f2...');
    console.error('       pd begin                                 # interactive (TTY only)');
    process.exit(1);
  }

  // Auto-detect identity from package.json if not provided
  const identity = (options.identity as string) || autoIdentityFromPackageJson() || undefined;

  const body: Record<string, unknown> = { purpose };
  if (identity) body.identity = identity;
  if (options.agent) body.agentId = options.agent;
  if (options.type) body.type = options.type;
  if (options.force) body.force = true;

  // Collect files from --files option or remaining positional args
  const files: string[] = [];
  if (options.files) {
    if (typeof options.files === 'string') files.push(options.files);
    else if (Array.isArray(options.files)) files.push(...options.files);
  }
  for (const arg of rest) {
    if (!arg.startsWith('-')) files.push(arg);
  }
  if (files.length > 0) body.files = files;

  const res: PdFetchResponse = await pdFetch('/sugar/begin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to begin'));
    process.exit(1);
  }

  // Write local context file
  writeContext({
    agentId: data.agentId as string,
    sessionId: data.sessionId as string,
    purpose,
    identity: (data.identity as string) || null,
    startedAt: Date.now(),
  });

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (isQuiet(options)) {
    console.log(data.agentId);
    return;
  }

  console.error(maritimeStatus('success', `Agent ${highlightChannel(data.agentId as string)} ready`));
  console.error(`  Session: ${data.sessionId}`);
  console.error(`  Purpose: ${purpose}`);
  if (identity) console.error(`  Identity: ${identity}`);
  if (data.fileClaims) {
    const claims = data.fileClaims as string[];
    console.error(`  Files: ${claims.length} claimed`);
  }
  if (data.fileConflicts) {
    const conflicts = data.fileConflicts as Array<{ filePath: string; sessionId: string }>;
    console.error(`  Conflicts: ${conflicts.length} file(s) claimed by other sessions`);
  }
  if (data.salvageHint) {
    console.error('');
    console.error(`  ${data.salvageHint}`);
  }
}

// =============================================================================
// handleDone — pd done ["note"] [--status STATUS]
// =============================================================================

export async function handleDone(
  note: string | undefined,
  options: CLIOptions,
): Promise<void> {
  // Flag takes precedence over positional
  note = note || (options.note as string) || undefined;

  // Interactive mode when no note and no flags provided
  if (!note && !options.status && canPrompt()) {
    note = await promptText({ label: 'Final note (optional):' }) || undefined;
    if (!options.status) {
      const status = await promptSelect({
        label: 'Session status?',
        choices: [
          { value: 'completed', label: 'Work finished successfully' },
          { value: 'abandoned', label: 'Leaving incomplete' },
        ],
        default: 'completed',
      });
      if (status) options.status = status;
    }
  }

  // Try to read local context first
  const ctx = readContext();

  const body: Record<string, unknown> = {};
  if (ctx) {
    body.agentId = ctx.agentId;
    body.sessionId = ctx.sessionId;
  }
  if (options.agent) body.agentId = options.agent;
  if (options.session) body.sessionId = options.session;
  if (note) body.note = note;
  if (options.status) body.status = options.status;

  const res: PdFetchResponse = await pdFetch('/sugar/done', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to end session'));
    process.exit(1);
  }

  // Clear local context
  clearContext();

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (isQuiet(options)) {
    console.log(data.sessionId || 'done');
    return;
  }

  const statusLabel = data.sessionStatus === 'abandoned' ? 'warning' : 'success';
  console.error(maritimeStatus(statusLabel as 'success' | 'warning', `Session ${data.sessionId} ${data.sessionStatus}`));
  if (data.agentUnregistered) console.error(`  Agent ${data.agentId} unregistered`);
  if (data.notesCount) console.error(`  Notes: ${data.notesCount}`);
  if (note) console.error(`  Final note: "${note}"`);
}

// =============================================================================
// handleWhoami — pd whoami
// =============================================================================

export async function handleWhoami(options: CLIOptions): Promise<void> {
  // Try local context first
  const ctx = readContext();
  const agentId = (options.agent as string) || ctx?.agentId;

  if (!agentId) {
    if (isJson(options)) {
      console.log(JSON.stringify({ success: true, active: false, hint: 'No active session. Use pd begin to start.' }, null, 2));
    } else if (!isQuiet(options)) {
      console.error('No active session. Use pd begin to start.');
    }
    return;
  }

  const params = new URLSearchParams();
  params.set('agentId', agentId);

  const res: PdFetchResponse = await pdFetch(`/sugar/whoami?${params}`, {
    method: 'GET',
  });

  const data = await res.json();

  if (isJson(options)) {
    // Merge local context timing if available
    if (ctx) {
      data.localContext = {
        agentId: ctx.agentId,
        sessionId: ctx.sessionId,
        startedAt: ctx.startedAt,
      };
    }
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (!data.active) {
    if (isQuiet(options)) return;
    console.error(data.hint || 'No active session');
    return;
  }

  if (isQuiet(options)) {
    console.log(`${data.agentId}:${data.sessionId}`);
    return;
  }

  console.error('');
  console.error(`  Agent:    ${data.agentId}`);
  console.error(`  Session:  ${data.sessionId}`);
  console.error(`  Purpose:  ${data.purpose}`);
  if (data.identity) console.error(`  Identity: ${data.identity}`);
  console.error(`  Phase:    ${data.phase}`);
  if (data.duration != null) {
    console.error(`  Duration: ${relativeTime(data.duration as number)}`);
  }
  if (data.noteCount) console.error(`  Notes:    ${data.noteCount}`);
  if (data.files && (data.files as string[]).length > 0) {
    console.error(`  Files:    ${(data.files as string[]).join(', ')}`);
  }
  console.error('');
}

// =============================================================================
// handleWithLock — pd with-lock <name> <cmd...>
// =============================================================================

export async function handleWithLock(
  name: string | undefined,
  command: string[],
  options: CLIOptions,
): Promise<void> {
  if (!name || command.length === 0) {
    console.error('Usage: pd with-lock <lock-name> <command...>');
    console.error('');
    console.error('Acquires a lock, runs the command, then releases the lock.');
    console.error('The lock is released even if the command fails.');
    console.error('');
    console.error('Examples:');
    console.error('  pd with-lock db-migrations npm run migrate');
    console.error('  pd with-lock deploy ./deploy.sh');
    process.exit(1);
  }

  const ttl = options.ttl ? parseInt(options.ttl as string, 10) : 300000;
  const owner = (options.owner as string) || `cli-${process.pid}`;

  // Acquire lock
  const lockRes: PdFetchResponse = await pdFetch(`/locks/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, ttl, pid: process.pid }),
  });

  if (!lockRes.ok) {
    const lockData = await lockRes.json();
    console.error(maritimeStatus('error', `Failed to acquire lock "${name}": ${lockData.error || 'lock is held'}`));
    process.exit(1);
  }

  if (IS_TTY && !isQuiet(options)) {
    console.error(maritimeStatus('success', `Lock "${name}" acquired`));
  }

  // Run the command — shell: false by default to prevent injection.
  // If the user passed a single string with pipes/&&, they need --shell.
  const useShell = !!options.shell;
  const [cmd, ...cmdArgs] = command;
  const child = spawn(cmd, cmdArgs, {
    stdio: 'inherit',
    shell: useShell,
  });

  // Handle signals — release lock on SIGINT/SIGTERM
  const cleanup = async (signal: string) => {
    child.kill(signal as NodeJS.Signals);
    await pdFetch(`/locks/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner, force: true }),
    }).catch(() => {});
    process.exit(128 + (signal === 'SIGINT' ? 2 : 15));
  };

  const onSigInt = () => cleanup('SIGINT');
  const onSigTerm = () => cleanup('SIGTERM');
  process.on('SIGINT', onSigInt);
  process.on('SIGTERM', onSigTerm);

  const exitCode = await new Promise<number>((resolve) => {
    child.on('exit', (code) => resolve(code ?? 1));
  });

  // Remove signal handlers to prevent listener leak
  process.removeListener('SIGINT', onSigInt);
  process.removeListener('SIGTERM', onSigTerm);

  // Release lock
  await pdFetch(`/locks/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, force: true }),
  }).catch(() => {});

  if (IS_TTY && !isQuiet(options)) {
    console.error(maritimeStatus('success', `Lock "${name}" released`));
  }

  process.exit(exitCode);
}
