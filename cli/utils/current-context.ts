import {
  constants as fsConstants,
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';

export interface CurrentContext {
  agentId: string;
  sessionId: string;
  agentName?: string | null;
  sessionName?: string | null;
  purpose?: string;
  identity?: string | null;
  startedAt?: number;
  contextSlot?: string;
  /**
   * ADR-0040 daemon-minted actor credential (`<actor_id>.<secret>`) captured
   * from `pd begin` (#8877 / ADR-0122). Attributed writes (done, notes, file
   * claims, locks, salvage, commitments) are rejected 401 without it, so
   * `pdFetch` reads it from here and presents it as the `x-actor-credential`
   * header on mutating requests. Stored in the per-worktree `.portdaddy/`
   * context store alongside the session it authenticates.
   */
  credential?: string | null;
  /**
   * The begin idempotency key this context was created under (lib/
   * begin-idempotency.ts). `pd session find --key` re-derives the session and
   * its credential from it when this file is the only local state that
   * survived; a retry of the same `pd begin` sends it so the daemon replays
   * instead of minting a second session.
   */
  idempotencyKey?: string | null;
}

/**
 * A `pd begin` that has been SENT but whose response has not been
 * persisted yet. Written before the request goes on the wire so a crash or
 * lost response leaves the key on disk; `pd session find` (no arguments)
 * reads it back and recovers the session the daemon may have committed.
 */
export interface BeginAttempt {
  idempotencyKey: string;
  purpose?: string;
  identity?: string | null;
  startedAt: number;
  contextSlot?: string;
}

export interface CurrentContextProvenance {
  source: 'environment' | 'slot' | 'legacy';
  agentId: string;
  sessionId: string;
  contextSlot?: string;
  path?: string;
}

export type CurrentContextResolution =
  | {
      success: true;
      context: CurrentContext | null;
      provenance: CurrentContextProvenance | null;
      ignoredPartialEnvironment?: {
        agentId: string | null;
        sessionId: string | null;
      };
    }
  | {
      success: false;
      context: null;
      code: 'CONTEXT_CONFLICT';
      error: string;
      provenances: {
        environment: CurrentContextProvenance;
        stored: CurrentContextProvenance;
      };
    };

function sanitizeSlot(raw: string): string {
  return raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'default';
}

/**
 * Env vars set by specific coding-agent harnesses to a value stable for the
 * whole session (thread/conversation id), usable as the shell slot even with
 * no TTY. This list is an optimization, not a requirement for correctness —
 * a harness missing from it still resolves via the HEADLESS_SLOT fallback
 * below, not via the old per-process ppid slot. Add entries as new harnesses
 * turn up; never remove CODEX_THREAD_ID's 'codex' prefix, existing on-disk
 * context files were written under it.
 */
const AGENT_SESSION_ENV_VARS: Array<{ env: string; prefix: string }> = [
  { env: 'CODEX_THREAD_ID', prefix: 'codex' },
  { env: 'CLAUDE_SESSION_ID', prefix: 'claude' },
  { env: 'CLAUDE_CODE_SESSION_ID', prefix: 'claude-code' },
  { env: 'CURSOR_SESSION_ID', prefix: 'cursor' },
  { env: 'AIDER_SESSION_ID', prefix: 'aider' },
  { env: 'COPILOT_SESSION_ID', prefix: 'copilot' },
];

/**
 * Fallback slot when no TTY and no known per-tool session id is available
 * (headless agent harnesses, `git commit` hooks forked from them, CI).
 *
 * The old fallback here was `ppid-${process.ppid}`. That's fatally unstable
 * for this exact case: `git commit` forks a brand-new process to run each
 * hook, so the hook's `pd guard check` always computes a different ppid slot
 * than the `pd begin` that ran moments earlier in the calling shell — the
 * session it just wrote can never be found again. A single shared slot loses
 * the ability to distinguish multiple concurrent headless shells in the same
 * worktree, but the ppid slot never actually provided that either (a fresh
 * ppid on every invocation made same-shell continuity the thing that broke).
 * One worktree normally has exactly one active non-interactive driver at a
 * time, so this trades imaginary isolation for a fallback that works.
 */
const HEADLESS_SLOT = 'headless';

export function resolveContextSlot(): string {
  const explicit = typeof process.env.PORT_DADDY_CONTEXT_SLOT === 'string' ? process.env.PORT_DADDY_CONTEXT_SLOT.trim() : '';
  if (explicit) return sanitizeSlot(explicit);

  for (const { env, prefix } of AGENT_SESSION_ENV_VARS) {
    const value = typeof process.env[env] === 'string' ? process.env[env].trim() : '';
    if (value) return sanitizeSlot(`${prefix}-${value}`);
  }

  const ttyCandidates = [process.stdin, process.stdout, process.stderr]
    .map((stream) => {
      const candidate = (stream as NodeJS.WriteStream & { path?: string }).isTTY ? (stream as NodeJS.WriteStream & { path?: string }).path : undefined;
      return typeof candidate === 'string' && candidate.trim() ? basename(candidate.trim()) : null;
    })
    .filter((value): value is string => Boolean(value));
  if (ttyCandidates.length > 0) return sanitizeSlot(`tty-${ttyCandidates[0]}`);

  const termSessionId = typeof process.env.TERM_SESSION_ID === 'string' ? process.env.TERM_SESSION_ID.trim() : '';
  if (termSessionId) return sanitizeSlot(`term-${termSessionId}`);

  return sanitizeSlot(HEADLESS_SLOT);
}

function canUseLegacyContextForSlot(legacy: CurrentContext, slot: string): boolean {
  return !legacy.contextSlot || legacy.contextSlot === slot;
}

export function getContextDir(cwd: string = process.cwd()): string {
  const injected = typeof process.env.PORT_DADDY_CONTEXT_DIR === 'string' ? process.env.PORT_DADDY_CONTEXT_DIR.trim() : '';
  if (injected) return injected;
  return join(cwd, '.portdaddy');
}

export function getContextStoreDir(cwd: string = process.cwd()): string {
  return join(getContextDir(cwd), 'contexts');
}

export function getLegacyContextPath(cwd: string = process.cwd()): string {
  return join(getContextDir(cwd), 'current.json');
}

export function getContextPathForSlot(slot: string, cwd: string = process.cwd()): string {
  return join(getContextStoreDir(cwd), `${sanitizeSlot(slot)}.json`);
}

function readContextFile(path: string): CurrentContext | null {
  let fd: number | null = null;
  try {
    if (!existsSync(path)) return null;
    const link = lstatSync(path);
    const uid = process.getuid?.();
    if (link.isSymbolicLink() || !link.isFile() || link.nlink !== 1 || (uid !== undefined && link.uid !== uid)) return null;
    fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== link.ino || opened.dev !== link.dev
      || (uid !== undefined && opened.uid !== uid)) return null;
    if ((opened.mode & 0o777) !== 0o600) fchmodSync(fd, 0o600);
    const parsed = JSON.parse(readFileSync(fd, 'utf8')) as CurrentContext | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.agentId !== 'string' || typeof parsed.sessionId !== 'string') return null;
    return parsed;
  } catch {
    return null;
  } finally {
    if (fd !== null) try { closeSync(fd); } catch {}
  }
}

function repairPrivateDirectory(path: string, create: boolean): boolean {
  let fd: number | null = null;
  try {
    if (!existsSync(path)) {
      if (!create) return false;
      mkdirSync(path, { mode: 0o700 });
    }
    const link = lstatSync(path);
    if (link.isSymbolicLink() || !link.isDirectory()) throw new Error(`refusing unsafe context directory: ${path}`);
    fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
    const opened = fstatSync(fd);
    const uid = process.getuid?.();
    if (!opened.isDirectory() || opened.ino !== link.ino || opened.dev !== link.dev
      || (uid !== undefined && opened.uid !== uid)) throw new Error(`refusing unsafe context directory: ${path}`);
    fchmodSync(fd, 0o700);
    return true;
  } finally {
    if (fd !== null) try { closeSync(fd); } catch {}
  }
}

function ensureContextDirs(cwd: string): void {
  const dir = getContextDir(cwd);
  repairPrivateDirectory(dir, true);
  repairPrivateDirectory(getContextStoreDir(cwd), true);
}

function contextDirectoryTreeIsSafeForMutation(cwd: string): boolean {
  const contextDir = getContextDir(cwd);
  try {
    if (!existsSync(contextDir)) return false;
    repairPrivateDirectory(contextDir, false);
    const storeDir = getContextStoreDir(cwd);
    if (existsSync(storeDir)) repairPrivateDirectory(storeDir, false);
    return true;
  } catch {
    return false;
  }
}

function unlinkContextFile(path: string, cwd: string, storeScoped: boolean): boolean {
  try {
    if (!contextDirectoryTreeIsSafeForMutation(cwd)) return false;
    if (storeScoped && !existsSync(getContextStoreDir(cwd))) return false;
    const entry = lstatSync(path);
    if (entry.isSymbolicLink() || !entry.isFile()) return false;
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

function writeJson(path: string, value: CurrentContext | BeginAttempt): void {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let fd: number | null = null;
  try {
    if (existsSync(path)) {
      const destination = lstatSync(path);
      if (destination.isSymbolicLink() || !destination.isFile()) {
        throw new Error(`refusing unsafe context file: ${path}`);
      }
    }
    fd = openSync(temporaryPath, 'wx', 0o600);
    fchmodSync(fd, 0o600);
    writeFileSync(fd, JSON.stringify(value, null, 2));
    closeSync(fd);
    fd = null;
    renameSync(temporaryPath, path);
  } catch (error) {
    if (fd !== null) {
      try { closeSync(fd); } catch {}
    }
    try { unlinkSync(temporaryPath); } catch {}
    throw error;
  }
}

function listStoredContexts(cwd: string): Array<{ path: string; context: CurrentContext; mtimeMs: number }> {
  const storeDir = getContextStoreDir(cwd);
  if (!existsSync(storeDir) || !repairPrivateDirectory(storeDir, false)) return [];
  return readdirSync(storeDir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => {
      const path = join(storeDir, entry);
      const context = readContextFile(path);
      if (!context) return null;
      let mtimeMs = 0;
      try {
        const info = lstatSync(path);
        mtimeMs = info.isSymbolicLink() || !info.isFile() ? 0 : info.mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      return { path, context, mtimeMs };
    })
    .filter((entry): entry is { path: string; context: CurrentContext; mtimeMs: number } => Boolean(entry))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Resolve the calling shell's current identity without guessing across
 * contradictory authorities. The design treats `PD_AGENT_ID` and
 * `PD_SESSION_ID` as one atomic environment assertion: a lone half is
 * diagnostic residue, never authority capable of suppressing a complete
 * per-slot record. When a complete environment pair contradicts a complete
 * stored pair, the caller receives both provenances and must either pass an
 * explicit CLI scope or repair the stale carrier.
 *
 * @param cwd - Repository/worktree whose `.portdaddy` context store is read.
 * @returns A resolved context, no context, or a structured CONTEXT_CONFLICT.
 */
export function resolveCurrentContext(cwd: string = process.cwd()): CurrentContextResolution {
  const contextDir = getContextDir(cwd);
  const contextStoreDir = getContextStoreDir(cwd);
  try {
    if (existsSync(contextDir)) repairPrivateDirectory(contextDir, false);
    if (existsSync(contextStoreDir)) repairPrivateDirectory(contextStoreDir, false);
  } catch {
    return { success: true, context: null, provenance: null };
  }
  const slot = resolveContextSlot();
  const slotPath = getContextPathForSlot(slot, cwd);
  const slotRecord = readContextFile(slotPath);
  const legacyPath = getLegacyContextPath(cwd);
  const legacyRecord = slotRecord ? null : readContextFile(legacyPath);
  const storedRecord = slotRecord || (legacyRecord && canUseLegacyContextForSlot(legacyRecord, slot) ? legacyRecord : null);
  const storedProvenance: CurrentContextProvenance | null = storedRecord
    ? {
        source: slotRecord ? 'slot' : 'legacy',
        agentId: storedRecord.agentId,
        sessionId: storedRecord.sessionId,
        contextSlot: storedRecord.contextSlot || slot,
        path: slotRecord ? slotPath : legacyPath,
      }
    : null;

  const envAgentId = process.env.PD_AGENT_ID?.trim() || null;
  const envSessionId = process.env.PD_SESSION_ID?.trim() || null;
  const completeEnvironment = Boolean(envAgentId && envSessionId);
  const partialEnvironment = Boolean(envAgentId || envSessionId) && !completeEnvironment;

  if (completeEnvironment) {
    const environmentProvenance: CurrentContextProvenance = {
      source: 'environment',
      agentId: envAgentId as string,
      sessionId: envSessionId as string,
    };
    if (
      storedProvenance
      && (
        storedProvenance.agentId !== environmentProvenance.agentId
        || storedProvenance.sessionId !== environmentProvenance.sessionId
      )
    ) {
      return {
        success: false,
        context: null,
        code: 'CONTEXT_CONFLICT',
        error: 'Complete environment identity conflicts with the current context slot; pass explicit --session/--agent or repair the stale carrier.',
        provenances: {
          environment: environmentProvenance,
          stored: storedProvenance,
        },
      };
    }

    return {
      success: true,
      context: storedRecord
        ? { ...storedRecord, agentId: environmentProvenance.agentId, sessionId: environmentProvenance.sessionId }
        : { agentId: environmentProvenance.agentId, sessionId: environmentProvenance.sessionId },
      provenance: environmentProvenance,
    };
  }

  return {
    success: true,
    context: storedRecord,
    provenance: storedProvenance,
    ...(partialEnvironment
      ? {
          ignoredPartialEnvironment: {
            agentId: envAgentId,
            sessionId: envSessionId,
          },
        }
      : {}),
  };
}

export function writeCurrentContext(context: CurrentContext, cwd: string = process.cwd()): CurrentContext {
  const slot = sanitizeSlot(context.contextSlot || resolveContextSlot());
  const record: CurrentContext = { ...context, contextSlot: slot };
  ensureContextDirs(cwd);
  writeJson(getContextPathForSlot(slot, cwd), record);
  writeJson(getLegacyContextPath(cwd), record);
  return record;
}

// =============================================================================
// Begin attempts — the idempotency key outlives a lost response
// =============================================================================

export function getBeginAttemptsDir(cwd: string = process.cwd()): string {
  return join(getContextDir(cwd), 'begin-attempts');
}

export function getBeginAttemptPathForSlot(slot: string, cwd: string = process.cwd()): string {
  return join(getBeginAttemptsDir(cwd), `${sanitizeSlot(slot)}.json`);
}

function readBeginAttemptFile(path: string): BeginAttempt | null {
  let fd: number | null = null;
  try {
    if (!existsSync(path)) return null;
    const link = lstatSync(path);
    const uid = process.getuid?.();
    if (link.isSymbolicLink() || !link.isFile() || link.nlink !== 1 || (uid !== undefined && link.uid !== uid)) return null;
    fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== link.ino || opened.dev !== link.dev
      || (uid !== undefined && opened.uid !== uid)) return null;
    if ((opened.mode & 0o777) !== 0o600) fchmodSync(fd, 0o600);
    const parsed = JSON.parse(readFileSync(fd, 'utf8')) as BeginAttempt | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.idempotencyKey !== 'string' || !parsed.idempotencyKey) return null;
    if (typeof parsed.startedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  } finally {
    if (fd !== null) try { closeSync(fd); } catch {}
  }
}

/**
 * Persist a begin attempt BEFORE its request goes on the wire. The key is
 * the only thing that lets a crashed or disconnected agent recover the
 * session the daemon committed; writing it after the response would lose it
 * with the response.
 *
 * @param attempt - The key plus what the begin was for (for the human hint).
 * @param cwd - Worktree whose `.portdaddy` store receives the file.
 * @returns The stored record, slot-stamped.
 */
export function writeBeginAttempt(attempt: BeginAttempt, cwd: string = process.cwd()): BeginAttempt {
  const slot = sanitizeSlot(attempt.contextSlot || resolveContextSlot());
  const record: BeginAttempt = { ...attempt, contextSlot: slot };
  ensureContextDirs(cwd);
  repairPrivateDirectory(getBeginAttemptsDir(cwd), true);
  writeJson(getBeginAttemptPathForSlot(slot, cwd), record);
  return record;
}

/**
 * Read the pending begin attempt for this shell's slot.
 *
 * @param cwd - Worktree whose `.portdaddy` store is read.
 * @returns The attempt, or null when none is pending (or the file is unsafe).
 */
export function readBeginAttempt(cwd: string = process.cwd()): BeginAttempt | null {
  if (!contextDirectoryTreeIsSafeForMutation(cwd)) return null;
  const dir = getBeginAttemptsDir(cwd);
  try {
    if (!existsSync(dir) || !repairPrivateDirectory(dir, false)) return null;
  } catch {
    return null;
  }
  return readBeginAttemptFile(getBeginAttemptPathForSlot(resolveContextSlot(), cwd));
}

/**
 * Drop the pending begin attempt once its outcome is persisted (the context
 * file now carries the key) or the attempt is abandoned.
 *
 * @param cwd - Worktree whose `.portdaddy` store is cleaned.
 */
export function clearBeginAttempt(cwd: string = process.cwd()): void {
  if (!contextDirectoryTreeIsSafeForMutation(cwd)) return;
  const dir = getBeginAttemptsDir(cwd);
  try {
    if (!existsSync(dir) || !repairPrivateDirectory(dir, false)) return;
    const path = getBeginAttemptPathForSlot(resolveContextSlot(), cwd);
    const entry = lstatSync(path);
    if (entry.isSymbolicLink() || !entry.isFile()) return;
    unlinkSync(path);
  } catch {
    // Nothing pending, or the store is unsafe to touch: both are "cleared".
  }
}

export function readCurrentContext(cwd: string = process.cwd()): CurrentContext | null {
  const resolution = resolveCurrentContext(cwd);
  return resolution.success ? resolution.context : null;
}

export function clearCurrentContext(cwd: string = process.cwd()): void {
  // A repository controls `.portdaddy`, so clearing must validate both parent
  // directories before it resolves or unlinks any credential-bearing path.
  // Otherwise a symlinked root/store could turn a routine `pd done` cleanup
  // into deletion outside the repository.
  if (!contextDirectoryTreeIsSafeForMutation(cwd)) return;

  const slot = resolveContextSlot();
  const slotPath = getContextPathForSlot(slot, cwd);
  unlinkContextFile(slotPath, cwd, true);

  const legacyPath = getLegacyContextPath(cwd);
  if (!contextDirectoryTreeIsSafeForMutation(cwd)) return;
  const legacy = readContextFile(legacyPath);
  if (!legacy) return;

  const clearLegacy = canUseLegacyContextForSlot(legacy, slot);
  if (legacy.contextSlot && legacy.contextSlot !== slot) {
    if (!clearLegacy) return;
    unlinkContextFile(getContextPathForSlot(legacy.contextSlot, cwd), cwd, true);
  }
  if (!legacy.contextSlot && legacy.sessionId) {
    const fallback = listStoredContexts(cwd)[0];
    if (fallback) {
      if (!contextDirectoryTreeIsSafeForMutation(cwd)) return;
      writeJson(legacyPath, fallback.context);
      return;
    }
  }

  const replacement = listStoredContexts(cwd)[0];
  if (replacement) {
    if (!contextDirectoryTreeIsSafeForMutation(cwd)) return;
    writeJson(legacyPath, replacement.context);
    return;
  }

  unlinkContextFile(legacyPath, cwd, false);
}

export function readCurrentContextFromPaths(paths: string[]): CurrentContext | null {
  for (const basePath of paths) {
    const resolution = resolveCurrentContext(basePath);
    if (!resolution.success) return null;
    if (resolution.context) return resolution.context;
  }
  return null;
}

export function removeAllContextFiles(cwd: string = process.cwd()): void {
  if (!contextDirectoryTreeIsSafeForMutation(cwd)) return;
  try {
    rmSync(getContextStoreDir(cwd), { recursive: true, force: true });
  } catch {}
  try {
    rmSync(getBeginAttemptsDir(cwd), { recursive: true, force: true });
  } catch {}
  unlinkContextFile(getLegacyContextPath(cwd), cwd, false);
}
