import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
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
}

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
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CurrentContext | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.agentId !== 'string' || typeof parsed.sessionId !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function ensureContextDirs(cwd: string): void {
  const dir = getContextDir(cwd);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const storeDir = getContextStoreDir(cwd);
  if (!existsSync(storeDir)) mkdirSync(storeDir, { recursive: true });
}

function writeJson(path: string, value: CurrentContext): void {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function listStoredContexts(cwd: string): Array<{ path: string; context: CurrentContext; mtimeMs: number }> {
  const storeDir = getContextStoreDir(cwd);
  if (!existsSync(storeDir)) return [];
  return readdirSync(storeDir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => {
      const path = join(storeDir, entry);
      const context = readContextFile(path);
      if (!context) return null;
      let mtimeMs = 0;
      try {
        mtimeMs = statSync(path).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      return { path, context, mtimeMs };
    })
    .filter((entry): entry is { path: string; context: CurrentContext; mtimeMs: number } => Boolean(entry))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function writeCurrentContext(context: CurrentContext, cwd: string = process.cwd()): CurrentContext {
  const slot = sanitizeSlot(context.contextSlot || resolveContextSlot());
  const record: CurrentContext = { ...context, contextSlot: slot };
  ensureContextDirs(cwd);
  writeJson(getContextPathForSlot(slot, cwd), record);
  writeJson(getLegacyContextPath(cwd), record);
  return record;
}

export function readCurrentContext(cwd: string = process.cwd()): CurrentContext | null {
  // Env vars take priority — no filesystem needed. Useful in worktrees, CI,
  // and any shell where `pd begin` exported PD_AGENT_ID.
  const envAgentId = process.env.PD_AGENT_ID?.trim();
  const envSessionId = process.env.PD_SESSION_ID?.trim();
  if (envAgentId || envSessionId) {
    return {
      agentId: envAgentId ?? '',
      sessionId: envSessionId ?? '',
    };
  }

  const slot = resolveContextSlot();
  const slotRecord = readContextFile(getContextPathForSlot(slot, cwd));
  if (slotRecord) return slotRecord;
  const legacy = readContextFile(getLegacyContextPath(cwd));
  if (!legacy) return null;
  if (!canUseLegacyContextForSlot(legacy, slot)) return null;
  return legacy;
}

export function clearCurrentContext(cwd: string = process.cwd()): void {
  const slot = resolveContextSlot();
  const slotPath = getContextPathForSlot(slot, cwd);
  try {
    if (existsSync(slotPath)) unlinkSync(slotPath);
  } catch {}

  const legacyPath = getLegacyContextPath(cwd);
  const legacy = readContextFile(legacyPath);
  if (!legacy) return;

  const clearLegacy = canUseLegacyContextForSlot(legacy, slot);
  if (legacy.contextSlot && legacy.contextSlot !== slot) {
    if (!clearLegacy) return;
    try {
      unlinkSync(getContextPathForSlot(legacy.contextSlot, cwd));
    } catch {}
  }
  if (!legacy.contextSlot && legacy.sessionId) {
    const fallback = listStoredContexts(cwd)[0];
    if (fallback) {
      writeJson(legacyPath, fallback.context);
      return;
    }
  }

  const replacement = listStoredContexts(cwd)[0];
  if (replacement) {
    writeJson(legacyPath, replacement.context);
    return;
  }

  try {
    unlinkSync(legacyPath);
  } catch {}
}

export function readCurrentContextFromPaths(paths: string[]): CurrentContext | null {
  for (const basePath of paths) {
    const context = readCurrentContext(basePath);
    if (context) return context;
    const legacy = readContextFile(getLegacyContextPath(basePath));
    if (legacy) return legacy;
  }
  return null;
}

export function removeAllContextFiles(cwd: string = process.cwd()): void {
  try {
    rmSync(getContextStoreDir(cwd), { recursive: true, force: true });
  } catch {}
  try {
    unlinkSync(getLegacyContextPath(cwd));
  } catch {}
}
