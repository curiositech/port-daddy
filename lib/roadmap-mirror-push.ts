/**
 * lib/roadmap-mirror-push.ts — send the daemon's roadmap to the relay mirror.
 *
 * WHY THIS EXISTS. `apps/relay/src/roadmap-mirror.ts` and its migration
 * (`2026-08-22-roadmap-mirror.sql`, applied in staging) were shipped as "PR 1 of
 * 4" of the roadmap command centre: a D1 replica plus `PUT /v1/roadmap/snapshot`
 * and `GET /v1/roadmap/mirror`. The evidence pack in
 * `docs/reports/relay-roadmap-mirror/` drives it end to end against a real
 * Worker with this repository's own 279-item export.
 *
 * Nothing ever pushed to it. Grepping the daemon, the CLI and the scripts for
 * that endpoint finds the relay's own handler, the relay's tests, and the
 * capture harness -- and no producer. The mirror has been a well-tested, empty
 * table, and every reader built since has had to find the roadmap somewhere
 * else. This module is the missing producer.
 *
 * TWO SOURCES, ONE HONEST WATERMARK. The daemon is the roadmap's single writer,
 * so a live read is preferred. But the mirror's whole design turns on
 * `generatedAt` being the DAEMON's clock, passed through verbatim and shown
 * beside the relay's own arrival time -- which means the committed snapshot at
 * `docs/roadmap/roadmap.snapshot.json` is also a legitimate source: it carries
 * the daemon clock from the moment it was exported. Pushing it is not a stale
 * push pretending to be fresh; it is an old snapshot that says how old it is.
 * So a halted daemon degrades to "push what was last exported, labelled", not
 * to "cannot push" -- and never to "push old data under a new timestamp",
 * which is the one thing that would make the watermark a lie.
 *
 * No I/O here beyond the injected fetch: the caller reads files and resolves
 * the daemon, so the translation and the guards can be tested without either.
 */

import type { RoadmapSnapshot } from './roadmap-snapshot.js';

/** The five lanes the mirror's CHECK constraint admits. Identical to the
 *  daemon's `RoadmapStatus` (lib/roadmap-items.ts) -- the CHECK was written
 *  from it. Re-stated rather than imported so a widening of the daemon's
 *  ladder shows up here as a failing translation instead of a 400 from the
 *  relay after the push has already been attempted. */
export const MIRROR_STATUSES = ['now', 'backlog', 'parked', 'merge', 'done'] as const;
export type MirrorStatus = (typeof MIRROR_STATUSES)[number];

/** The relay's own ingest ceilings (roadmap-mirror.ts MAX_SNAPSHOT_*). Checked
 *  here so an operator reads a sentence naming the limit instead of a 413. */
export const MIRROR_MAX_ITEMS = 5000;
export const MIRROR_MAX_BYTES = 2 * 1024 * 1024;

/** One item on the `PUT /v1/roadmap/snapshot` wire. */
export interface MirrorItem {
  slug: string;
  status: MirrorStatus;
  summaryMd: string;
}

/** The full `PUT /v1/roadmap/snapshot` body. */
export interface MirrorPayload {
  repoFullName: string;
  harbor: string;
  /** Daemon clock, unix ms — carried from the snapshot, never re-stamped. */
  generatedAt: number;
  daemonLabel?: string;
  items: MirrorItem[];
}

/** Which of the two sources a payload was built from, for the operator line. */
export type MirrorSourceKind = 'daemon' | 'committed';

export interface MirrorPushResult {
  status: number;
  ok: boolean;
  /** The relay's parsed body, or null when it did not return JSON. */
  body: Record<string, unknown> | null;
  /** The relay's error code (`TOO_MANY_ITEMS`, `BAD_STATUS`, …) when it failed. */
  error: string | null;
}

/**
 * `owner/name` for the mirror's key, rejecting anything else.
 *
 * The same shape the relay's `normalizeRepoFullName` accepts. Validated on this
 * side too so a typo is a local error naming the flag, not a 400 the operator
 * has to map back to their own argument.
 *
 * @param value - Candidate repository name, typically from `--repo` or a git remote.
 * @returns The trimmed `owner/name`, or null when it is not exactly two valid segments.
 */
export function normalizeRepoFullName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const parts = trimmed.split('/');
  if (parts.length !== 2) return null;
  const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  if (!parts.every((p) => p.length > 0 && p.length <= 100 && SEGMENT.test(p))) return null;
  return trimmed;
}

/**
 * Pull `owner/name` out of a git remote URL, SSH or HTTPS.
 *
 * Convenience only: `--repo` always wins, and a remote this cannot read is not
 * an error here — the caller asks the operator for the flag instead of guessing.
 *
 * @param remote - A remote URL as `git remote get-url origin` prints it.
 * @returns The `owner/name` it names, or null when the URL is not a recognisable repo URL.
 */
export function repoFromGitRemote(remote: string | null | undefined): string | null {
  if (typeof remote !== 'string') return null;
  const m = remote
    .trim()
    .replace(/\.git$/, '')
    .match(/[:/]([^/:]+)\/([^/]+)$/);
  return m ? normalizeRepoFullName(`${m[1]}/${m[2]}`) : null;
}

/**
 * Decide which repository a mirror push is for: what the operator named, or
 * the origin remote, or nothing.
 *
 * The rule that matters is the second clause. The remote is consulted ONLY
 * when the operator named nothing at all -- a named-but-unusable value is an
 * error, never a reason to fall back. A mirror is keyed by repository, so a
 * silent fallback from a typo'd `--repo` would push this roadmap over
 * somebody else's board, and the operator would see a success line. Failing
 * with the value they typed is the only safe answer.
 *
 * Split out of the push handler so the branch is reachable by a test without
 * standing up an account, a daemon and a git remote first: the handler reads
 * the remote and passes it in, and this decides.
 *
 * @param named - What the operator gave, positionally or via --repo; null when they gave nothing.
 * @param remote - The origin remote URL, or null when it could not be read. Consulted only when `named` is null.
 * @returns `{ repo }` with the resolved `owner/name`, or `{ repo: null, reason }` saying which failure it was.
 */
export function resolveMirrorRepo(
  named: string | null | undefined,
  remote: string | null | undefined,
): { repo: string; reason?: undefined } | { repo: null; reason: 'named-unusable' | 'no-remote' } {
  const hasNamed = typeof named === 'string' && named.trim().length > 0;
  if (hasNamed) {
    const repo = normalizeRepoFullName(named);
    return repo ? { repo } : { repo: null, reason: 'named-unusable' };
  }
  const guessed = repoFromGitRemote(remote);
  return guessed ? { repo: guessed } : { repo: null, reason: 'no-remote' };
}

/** A translation that could not be made, naming the item that broke it. */
export class MirrorTranslationError extends Error {}

/**
 * Shape a committed-or-freshly-built snapshot into the mirror's wire body.
 *
 * The watermark is copied, never generated: `generatedAt` is the daemon clock
 * this snapshot was made under, and re-stamping it with `Date.now()` would tell
 * every future reader that a two-week-old roadmap arrived this minute. That
 * subtraction — daemon clock against the relay's own arrival clock — is the
 * only staleness signal the mirror has, so it is the one field that must never
 * be helpfully refreshed.
 *
 * @param snapshot - The snapshot to send, from the daemon or from disk.
 * @param repoFullName - Validated `owner/name` the mirror keys the replica by.
 * @param daemonLabel - Display-only label for which daemon pushed, when known.
 * @returns The `PUT /v1/roadmap/snapshot` body.
 * @throws MirrorTranslationError when the snapshot carries a status the mirror
 *   cannot store, or an item with no slug — both of which the relay would
 *   refuse wholesale, so refusing here names the offending item instead.
 */
export function toMirrorPayload(
  snapshot: RoadmapSnapshot,
  repoFullName: string,
  daemonLabel?: string,
): MirrorPayload {
  const allowed = new Set<string>(MIRROR_STATUSES);
  const items: MirrorItem[] = snapshot.items.map((item) => {
    const slug = String(item.slug ?? '').trim();
    if (!slug) throw new MirrorTranslationError('a roadmap item has no slug');
    if (!allowed.has(item.status)) {
      throw new MirrorTranslationError(
        `item "${slug}" has status "${item.status}", which the mirror cannot store ` +
          `(it accepts ${MIRROR_STATUSES.join(', ')}). The daemon's status ladder and ` +
          `the mirror's CHECK constraint have diverged; widen the migration first.`,
      );
    }
    return { slug, status: item.status as MirrorStatus, summaryMd: String(item.summaryMd ?? '') };
  });

  const payload: MirrorPayload = {
    repoFullName,
    harbor: snapshot.harbor,
    generatedAt: snapshot.generatedAt,
    items,
  };
  if (daemonLabel) payload.daemonLabel = daemonLabel;
  return payload;
}

/**
 * Would the relay accept this body's size, or refuse it?
 *
 * Both ceilings are the relay's, restated so the operator gets a sentence with
 * the number in it before a request is spent. The byte count is of the exact
 * JSON that will be sent, not an estimate.
 *
 * @param payload - The body about to be sent.
 * @returns `{ ok: true, bytes }`, or `{ ok: false, reason }` naming which ceiling it broke.
 */
export function checkMirrorPayloadFits(
  payload: MirrorPayload,
): { ok: true; bytes: number } | { ok: false; reason: string; bytes: number } {
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  if (payload.items.length > MIRROR_MAX_ITEMS) {
    return {
      ok: false,
      bytes,
      reason:
        `${payload.items.length} items exceeds the mirror's ceiling of ${MIRROR_MAX_ITEMS}. ` +
        `The relay would refuse this with 413 TOO_MANY_ITEMS.`,
    };
  }
  if (bytes > MIRROR_MAX_BYTES) {
    return {
      ok: false,
      bytes,
      reason:
        `${bytes} bytes exceeds the mirror's ceiling of ${MIRROR_MAX_BYTES}. ` +
        `The relay would refuse this with 413 PAYLOAD_TOO_LARGE.`,
    };
  }
  return { ok: true, bytes };
}

/** The least of `fetch` this module uses, so a test can stand in for it. */
export interface PushFetch {
  (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
  ): Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
}

export interface PushOptions {
  /** Relay origin, e.g. `https://relay.portdaddy.dev`. Trailing slash tolerated. */
  relayUrl: string;
  /** The account's `pdu_` device token, from `pd account login`. */
  token: string;
  payload: MirrorPayload;
  fetchImpl?: PushFetch;
  timeoutMs?: number;
}

/**
 * Send one full-replace snapshot to the relay.
 *
 * Returns the outcome rather than throwing on a refusal: a 413 or a 400 is the
 * relay stating a rule, and the caller turns it into an operator line naming
 * that rule. Only a transport failure throws.
 *
 * @param options - Relay origin, device token, body, and optional fetch/timeout injection.
 * @returns The status, the parsed body when there was one, and the relay's error code.
 */
export async function pushRoadmapMirror(options: PushOptions): Promise<MirrorPushResult> {
  const { relayUrl, token, payload, fetchImpl = globalThis.fetch as unknown as PushFetch } = options;
  const url = `${relayUrl.replace(/\/$/, '')}/v1/roadmap/snapshot`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  try {
    const res = await fetchImpl(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    let body: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
    } catch {
      body = null;
    }
    const error = typeof body?.error === 'string' ? body.error : null;
    return { status: res.status, ok: res.ok, body, error };
  } finally {
    clearTimeout(timer);
  }
}
