/**
 * apps/shared/repo-ai-settings.ts — the Workers AI call-deadline setting,
 * shared between `apps/relay` (writer, via the `/account/repos` screen) and
 * `apps/fleet-executor` (reader, at the start of every run).
 *
 * Why shared: both Workers bind the same D1 database (`port-daddy-relay`,
 * `binding = "DB"` in both `wrangler.deploy.toml` files), so fleet-executor
 * reads relay's `repo_settings` table directly — no service binding, no
 * network hop. Keeping the bounds/default and the read logic in one file
 * (rather than hand-kept copies in each Worker) is the same discipline
 * `apps/shared/model-registry.generated.ts` already established for this
 * repo: two independently-edited copies of the same fact drift silently.
 *
 * Storage: the deadline lives inside `repo_settings.settings_json` — the
 * table's forward-compatible JSON bag — as `aiCallDeadlineMs`, not a new
 * column. No migration is needed to add it, and it can coexist with whatever
 * settings key lands here next.
 *
 * Ownership caveat: `repo_settings` is keyed `(user_id, repo_full_name)`, a
 * per-user-per-repo record. A queue-driven Fleet run has no "current user" to
 * scope by, so {@link resolveAiCallDeadlineMs} takes the most-recently-updated
 * row across every user who has configured that repository ("last editor
 * wins" among the users who could legitimately write a non-default value).
 * This is safe only because the WRITE side is gated: `apps/relay`'s
 * `handleRepoSettingsSet` requires `userIsRepoAdmin` (GitHub's own
 * `permissions.admin` for the caller) before it will persist a value that
 * would actually change the repo's currently-effective deadline — a
 * DO-NOT-SHIP finding on PR #9800 was that mere read access let any GitHub
 * user who could see a public repository silently change execution behavior
 * for every installation reviewing it. "Last admin wins" among multiple
 * legitimate admins is an accepted, much smaller residual tradeoff; a real
 * per-repo/installation authority record is still out of scope here.
 */

/** Default deadline for a single Workers AI binding call: 5 minutes. */
export const DEFAULT_AI_CALL_DEADLINE_MS = 300_000;

/** Floor: below this, ordinary model latency would trip the circuit spuriously. */
export const MIN_AI_CALL_DEADLINE_MS = 5_000;

/**
 * Ceiling: 10 minutes. Bounded well under the Cloudflare Queue's consumer
 * visibility timeout so a single hung call cannot itself cause the queue to
 * redeliver mid-call and double-run a ship.
 */
export const MAX_AI_CALL_DEADLINE_MS = 600_000;

/** The minimal D1 binding surface this module needs (both Workers' `env.DB`). */
export interface AiSettingsDb {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(colName?: string): Promise<T | null>;
    };
  };
}

/**
 * Validate and clamp a caller-supplied deadline in milliseconds.
 *
 * Why clamp rather than reject at the bounds: an operator typing "20 minutes"
 * almost certainly means "as long as it takes", which this repo already
 * treats as "the maximum we consider safe" rather than a value worth
 * rejecting the whole form submission over. Only a value that cannot
 * possibly be a duration (non-finite, zero, negative, unparseable) returns
 * null so the caller can reject the write outright instead of silently
 * coercing garbage into a valid-looking number.
 *
 * @param raw - The submitted value (form field, JSON bag entry, etc).
 * @returns The clamped integer milliseconds, or null when unparseable.
 */
export function parseAiCallDeadlineMs(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(MAX_AI_CALL_DEADLINE_MS, Math.max(MIN_AI_CALL_DEADLINE_MS, Math.round(n)));
}

/**
 * Read one repository's `settings_json` bag and pull out `aiCallDeadlineMs`.
 *
 * Why a separate function from the D1 read: `apps/relay`'s settings page
 * already has the row in hand (it just read or wrote it) and only needs the
 * parse; only `apps/fleet-executor` needs the full D1 round-trip below.
 *
 * @param settingsJson - The raw `repo_settings.settings_json` column value.
 * @returns The configured deadline, or the default when absent/invalid.
 */
export function aiCallDeadlineMsFromSettingsJson(settingsJson: string | null | undefined): number {
  if (!settingsJson) return DEFAULT_AI_CALL_DEADLINE_MS;
  try {
    const bag = JSON.parse(settingsJson) as Record<string, unknown>;
    return parseAiCallDeadlineMs(bag.aiCallDeadlineMs) ?? DEFAULT_AI_CALL_DEADLINE_MS;
  } catch {
    return DEFAULT_AI_CALL_DEADLINE_MS;
  }
}

/**
 * Resolve the effective Workers AI call deadline for one repository, direct
 * from D1.
 *
 * Design rationale — fails closed to {@link DEFAULT_AI_CALL_DEADLINE_MS} on
 * any missing binding, missing row, or malformed JSON: this value gates every
 * AI call fleet-wide, so a settings-read hiccup must never throw and must
 * never block a run.
 *
 * @param db - The shared `DB` binding (fleet-executor's `env.DB`).
 * @param repoFullName - `owner/name` of the repository being reviewed.
 * @returns The effective deadline in milliseconds.
 */
export async function resolveAiCallDeadlineMs(
  db: AiSettingsDb | undefined | null,
  repoFullName: string,
): Promise<number> {
  if (!db) return DEFAULT_AI_CALL_DEADLINE_MS;
  try {
    const row = await db
      .prepare(
        `SELECT settings_json FROM repo_settings
           WHERE repo_full_name = ?
           ORDER BY updated_at DESC LIMIT 1`,
      )
      .bind(repoFullName)
      .first<{ settings_json: string }>();
    return aiCallDeadlineMsFromSettingsJson(row?.settings_json ?? null);
  } catch (err) {
    console.error(`[repo-ai-settings] deadline read failed repo=${repoFullName}: ${String(err)}`);
    return DEFAULT_AI_CALL_DEADLINE_MS;
  }
}
