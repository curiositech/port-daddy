/**
 * CLI-side resolution of the ADR-0040 daemon-minted actor credential
 * (#8877 / ADR-0122).
 *
 * Every attributed daemon write (sessions, notes, file claims, locks,
 * salvage, commitments, sugar done/relink) now REQUIRES the credential the
 * mint doors issue (`POST /actors/register`, `POST /sugar/begin`). The pd
 * CLI holds it in two places: the PD_ACTOR_CREDENTIAL /
 * PORT_DADDY_ACTOR_CREDENTIAL env vars (exported by `eval $(pd begin ...)`
 * or injected by a harness), and the per-worktree context store `pd begin`
 * writes. This module is the ONE resolver both the pdFetch header injection
 * and the SDK-client-constructing commands use, so every command agrees on
 * precedence and on the safety rule below.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getContextDir, readCurrentContext, resolveContextSlot } from './current-context.js';

interface StoredCliActor {
  agentId?: string | null;
  credential: string;
}

function actorStoreDir(cwd: string = process.cwd()): string {
  return join(getContextDir(cwd), 'actors');
}

function actorFilePath(cwd: string = process.cwd()): string {
  return join(actorStoreDir(cwd), `${resolveContextSlot()}.json`);
}

function readStoredCliActor(): StoredCliActor | null {
  try {
    const path = actorFilePath();
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as StoredCliActor | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.credential !== 'string' || !parsed.credential.trim()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Resolve the actor credential this CLI invocation should present.
 *
 * Precedence: explicit env (PD_ACTOR_CREDENTIAL, then
 * PORT_DADDY_ACTOR_CREDENTIAL), then the context-file credential — but the
 * context credential is returned ONLY when `expectedAgentId` is absent or
 * matches the context's agentId. Why: presenting soul A's credential while
 * asserting agent B's name is exactly the laundering the daemon rejects
 * (403 IDENTITY_ALIAS_MISMATCH); withholding the mismatched credential
 * yields the clearer 401 IDENTITY_CREDENTIAL_REQUIRED instead.
 *
 * A third source, the per-slot actor file (`.portdaddy/actors/<slot>.json`),
 * covers commands that mint OUTSIDE a session (e.g. `pd lock` in a shell
 * that never ran `pd begin`): {@link persistCliActorCredential} writes it,
 * and later invocations in the same shell slot read it back — otherwise
 * every `pd lock` / `pd unlock` pair would mint two different souls and the
 * unlock would fail the soul-level ownership check.
 *
 * @param expectedAgentId - The agent id this command will assert, if any.
 * @returns The credential to present, or undefined (the daemon will then
 *          reject attributed writes 401 — fail-closed by design).
 */
export function resolveCliActorCredential(expectedAgentId?: string): string | undefined {
  const envCredential = process.env.PD_ACTOR_CREDENTIAL?.trim()
    || process.env.PORT_DADDY_ACTOR_CREDENTIAL?.trim();
  if (envCredential) return envCredential;
  try {
    const context = readCurrentContext();
    if (
      context &&
      typeof context.credential === 'string' &&
      context.credential.trim() &&
      (!expectedAgentId || context.agentId === expectedAgentId)
    ) {
      return context.credential.trim();
    }
  } catch {
    // Unreadable context — fall through (fail-closed server-side).
  }
  const stored = readStoredCliActor();
  if (stored && (!expectedAgentId || !stored.agentId || stored.agentId === expectedAgentId)) {
    return stored.credential.trim();
  }
  return undefined;
}

/**
 * Persist a minted credential into the per-slot actor file so later pd
 * invocations in the same shell slot present the SAME soul.
 *
 * @param credential - The plaintext credential a mint door just returned.
 * @param agentId - The display agent/owner name it was minted for, if any.
 */
export function persistCliActorCredential(credential: string, agentId?: string | null): void {
  try {
    const dir = actorStoreDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // 0o600: the file holds a plaintext bearer credential — owner read/write
    // only, same posture as an SSH private key and the custody bar ADR-0040
    // sets for plaintext bearer credentials at rest. Other local users must
    // not be able to read (and thus present) this shell's soul.
    writeFileSync(actorFilePath(), JSON.stringify({ agentId: agentId ?? null, credential }, null, 2), { mode: 0o600 });
  } catch {
    // Best-effort: an unpersistable credential only costs a re-mint later.
  }
}

/**
 * Resolve this shell's actor credential, MINTING one when none exists.
 *
 * Purpose: commands that perform attributed writes without a prior
 * `pd begin` (locks, with-lock) still need a daemon-minted soul under
 * #8877 / ADR-0122. This resolves through {@link resolveCliActorCredential}
 * first; on a miss it registers through the public mint door
 * (`POST /actors/register`, binding `alias` when given) and persists the
 * credential to the per-slot actor file so the shell keeps ONE soul.
 *
 * @param alias - Display alias (owner/agent name) to bind on a fresh mint.
 * @returns The credential to present.
 * @throws When the mint door rejects or is unreachable.
 */
export async function ensureCliActorCredential(alias?: string): Promise<string> {
  const existing = resolveCliActorCredential(alias);
  if (existing) return existing;
  // Dynamic import: cli/utils/fetch.ts imports this module for its header
  // injection, so a static import here would create a cycle.
  const { pdFetch } = await import('./fetch.js');
  const res = await pdFetch('/actors/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(alias ? { alias } : {}),
  });
  const data = await res.json();
  if (!res.ok || typeof data.credential !== 'string' || !data.credential) {
    throw new Error(typeof data.error === 'string' ? data.error : `actor registration failed (HTTP ${res.status})`);
  }
  persistCliActorCredential(data.credential, alias ?? null);
  return data.credential;
}
