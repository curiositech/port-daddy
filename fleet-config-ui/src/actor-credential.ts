// ─── Fleet Config UI actor credential (#8877 / ADR-0122) ─────────────────────
//
// The UI used to write to the daemon with no credential at all, sending
// `from: 'fleet-ui'` — a self-asserted string the daemon took on faith. The
// inbox is an instruction plane (a DM with `wake: true` spawns a
// code-editing agent with `from` in its prompt), so the daemon now requires
// a daemon-minted ADR-0040 credential on every inbox send. The UI therefore
// has to become a real principal instead of a name.
//
// It mints one through the public door, POST /actors/register, and caches the
// credential per daemon URL in localStorage. Two things it deliberately does
// NOT do:
//
//   1. It does not send an `alias`. `upsertAlias` is ON CONFLICT DO NOTHING
//      (lib/actor-souls.ts), so the FIRST caller to claim 'fleet-ui' owns it
//      forever; a second registration after cleared browser storage would
//      mint a different soul that can never claim the name back, and every
//      send would then 403. Registering anonymously sidesteps the trap.
//   2. It does not send a `from` on inbox writes. With no bound alias there
//      is no name it is entitled to, so it lets the daemon derive attribution
//      from the credential itself — which is unforgeable by construction.
//
// The long-run answer for an operator-class UI principal is the operator
// token door (`operatorToken` on POST /actors/register, secret at
// ~/.port-daddy/operator.secret). That needs a way to get the secret to a
// browser, which is its own design question and is NOT solved here — this UI
// is a newcomer-class principal today.

const CREDENTIAL_STORAGE_PREFIX = 'port-daddy.actor-credential';

function canUseWindow(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function storageKey(daemonUrl: string): string {
  return `${CREDENTIAL_STORAGE_PREFIX}:${daemonUrl}`;
}

function readCached(daemonUrl: string): string | null {
  if (!canUseWindow()) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(daemonUrl));
    return raw && raw.includes('.') ? raw : null;
  } catch {
    return null;
  }
}

function writeCached(daemonUrl: string, credential: string): void {
  if (!canUseWindow()) return;
  try {
    window.localStorage.setItem(storageKey(daemonUrl), credential);
  } catch {
    // A UI that cannot cache still works; it just re-mints next load.
  }
}

/** In-flight mint, so a burst of writes registers one soul, not twenty. */
const pending = new Map<string, Promise<string | null>>();

async function mint(daemonUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${daemonUrl}/actors/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No alias (see the note above) and no project — this principal spends
      // nothing; it only needs to be a provable someone.
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const payload = await res.json().catch(() => null) as { credential?: unknown } | null;
    const credential = typeof payload?.credential === 'string' ? payload.credential : null;
    if (credential) writeCached(daemonUrl, credential);
    return credential;
  } catch {
    return null;
  }
}

/**
 * The credential this UI should present on daemon writes.
 *
 * Returns the cached one when present, otherwise mints a fresh soul through
 * POST /actors/register. Returns null when the daemon is unreachable or the
 * mint is refused — callers should still send the request, so the daemon's
 * own 401 is what surfaces to the operator rather than a UI-invented error.
 *
 * @param daemonUrl - The daemon base URL the credential is scoped to.
 * @returns The `<actor_id>.<secret>` credential, or null.
 */
export async function resolveActorCredential(daemonUrl: string): Promise<string | null> {
  const cached = readCached(daemonUrl);
  if (cached) return cached;
  const inFlight = pending.get(daemonUrl);
  if (inFlight) return inFlight;
  const promise = mint(daemonUrl).finally(() => pending.delete(daemonUrl));
  pending.set(daemonUrl, promise);
  return promise;
}

/**
 * Drop the cached credential for a daemon.
 *
 * Used when the daemon rejects it (the daemon's DB was reset, so the soul no
 * longer exists) — the next write mints a fresh one instead of looping on a
 * stale token.
 *
 * @param daemonUrl - The daemon base URL whose credential to forget.
 */
export function forgetActorCredential(daemonUrl: string): void {
  if (!canUseWindow()) return;
  try {
    window.localStorage.removeItem(storageKey(daemonUrl));
  } catch {
    // Nothing to do — a stale cache just costs one more 401.
  }
}
