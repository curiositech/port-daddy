/**
 * The compulsion — fact gathering (the impure half of ADR-0050's keystone).
 *
 * `compulsion.ts` decides; this file gathers. It shells out to git and queries
 * the daemon to assemble the `LeaseFacts` the pure evaluator judges. Everything
 * here FAILS OPEN: a flaky daemon or an odd git state yields "no rent owed"
 * rather than wedging every commit in the repo. The claim discipline still
 * bites; only the note-per-commit rent relaxes when truth can't be read.
 */

import { spawnSync } from 'node:child_process';
import { pdFetch, PORT_DADDY_URL } from '../../cli/utils/fetch.js';
import type { LeaseFacts } from './compulsion.js';

function git(args: string[], cwd: string): string | null {
  try {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (r.status !== 0) return null;
    return r.stdout.trim();
  } catch {
    return null;
  }
}

/** Resolve the live base ref to diff against. origin/main is canonical; fall
 *  back through origin/master, origin/HEAD (the remote's default branch,
 *  whatever it's named), then a local main/master before giving up. */
function resolveBaseRef(cwd: string): string | null {
  for (const ref of ['origin/main', 'origin/master', 'origin/HEAD', 'main', 'master']) {
    if (git(['rev-parse', '--verify', '--quiet', ref], cwd) !== null) return ref;
  }
  return null;
}

/** Commit timestamps (epoch ms) for commits on HEAD ahead of the base. When no
 *  base resolves, fall back to a bounded recent window so we never walk all of
 *  history. */
function aheadCommitTimesMs(cwd: string): number[] {
  const base = resolveBaseRef(cwd);
  const range = base ? `${base}..HEAD` : 'HEAD';
  const limit = base ? [] : ['-n', '50'];
  const out = git(['log', ...limit, range, '--format=%ct'], cwd);
  if (!out) return [];
  return out
    .split('\n')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n))
    .map((sec) => sec * 1000);
}

/** How many commits HEAD is behind the base (0 when none / unknown). */
function commitsBehindBase(cwd: string): number {
  const base = resolveBaseRef(cwd);
  if (!base) return 0;
  const out = git(['rev-list', '--count', `HEAD..${base}`], cwd);
  const n = out ? parseInt(out, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

interface SessionSignal {
  /** Note timestamps (epoch ms), ascending. */
  noteTimesMs: number[];
  /** Active (unreleased) file/region claims. */
  claimsTotal: number;
}

async function fetchSessionSignal(sessionId: string): Promise<SessionSignal> {
  // A non-2xx notes response is a FAILURE, not "zero notes". Parsing a 500's
  // JSON error body as an empty notes list would make every ahead-commit look
  // un-noted — fail-CLOSED, the opposite of the contract — and wrongly block
  // commits whenever the daemon hiccups. Throw so the gatherers below fail open.
  const notesRes = await pdFetch(
    `${PORT_DADDY_URL}/sessions/${encodeURIComponent(sessionId)}/notes?limit=500`,
  );
  if (!notesRes.ok) {
    throw new Error(`session notes fetch failed: ${notesRes.status}`);
  }
  const notesData = (await notesRes.json()) as { notes?: Array<{ createdAt?: number }> };
  const noteTimesMs = (notesData.notes ?? [])
    .map((n) => (typeof n.createdAt === 'number' ? n.createdAt : NaN))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  // Claims are a softer signal — a failed claims read degrades to 0 without
  // failing the whole gather (notes already succeeded; rent can be judged).
  let claimsTotal = 0;
  try {
    const sessRes = await pdFetch(`${PORT_DADDY_URL}/sessions/${encodeURIComponent(sessionId)}`);
    if (sessRes.ok) {
      const sessData = (await sessRes.json()) as { files?: unknown[]; session?: { files?: unknown[] } };
      const files = sessData.files ?? sessData.session?.files ?? [];
      claimsTotal = Array.isArray(files) ? files.length : 0;
    }
  } catch {
    /* claims unknown — treated as 0 */
  }
  return { noteTimesMs, claimsTotal };
}

/**
 * The guard's narrow need: how many commits on this lease have NO coordination
 * note published after them. A commit "after the last note" is un-noted rent.
 * Fails open (returns 0) on any daemon/git failure.
 */
export async function gatherCommitsSinceLastNote(sessionId: string, cwd: string): Promise<number> {
  try {
    const { noteTimesMs } = await fetchSessionSignal(sessionId);
    const latestNote = noteTimesMs.length ? noteTimesMs[noteTimesMs.length - 1] : 0;
    const commitTimes = aheadCommitTimesMs(cwd);
    // A commit pays its rent when a note is published AFTER it. Count commits
    // with no later note — i.e. commits strictly after the latest note (a commit
    // at the exact note timestamp is treated as noted, the lenient choice).
    return commitTimes.filter((t) => t > latestNote).length;
  } catch {
    // Fail open: if coordination truth can't be read, charge no rent rather than
    // wedge the commit (the claim discipline still bites).
    return 0;
  }
}

/**
 * The reaper's fuller need: the complete `LeaseFacts` for a sandbox, so the
 * reclaim sweep can judge idle/stale leases. `now` is injected for testability.
 */
export async function gatherLeaseFacts(
  sessionId: string,
  cwd: string,
  sessionStartedAtMs: number,
  now: number,
): Promise<LeaseFacts> {
  // Fail open for the reaper too: if the daemon signal can't be read, give the
  // lease the benefit of the doubt (looks paid + recently active) so a daemon
  // hiccup never reclaims a live sandbox. Git facts are still gathered honestly.
  let signal: SessionSignal;
  try {
    signal = await fetchSessionSignal(sessionId);
  } catch {
    return {
      commitsSinceLastNote: 0,
      commitsTotal: aheadCommitTimesMs(cwd).length,
      notesTotal: 1,
      claimsTotal: 1,
      commitsBehindBase: commitsBehindBase(cwd),
      ageMs: Math.max(0, now - sessionStartedAtMs),
      lastSignalAgeMs: 0,
    };
  }
  const { noteTimesMs, claimsTotal } = signal;
  const commitTimes = aheadCommitTimesMs(cwd);
  const latestNote = noteTimesMs.length ? noteTimesMs[noteTimesMs.length - 1] : 0;
  const latestCommit = commitTimes.length ? Math.max(...commitTimes) : 0;
  const lastSignal = Math.max(latestNote, latestCommit, sessionStartedAtMs);

  return {
    commitsSinceLastNote: commitTimes.filter((t) => t > latestNote).length,
    commitsTotal: commitTimes.length,
    notesTotal: noteTimesMs.length,
    claimsTotal,
    commitsBehindBase: commitsBehindBase(cwd),
    ageMs: Math.max(0, now - sessionStartedAtMs),
    lastSignalAgeMs: Math.max(0, now - lastSignal),
  };
}
