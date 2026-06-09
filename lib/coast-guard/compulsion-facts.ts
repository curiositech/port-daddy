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
 *  back through origin/HEAD and a local main before giving up. */
function resolveBaseRef(cwd: string): string | null {
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
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
  const empty: SessionSignal = { noteTimesMs: [], claimsTotal: 0 };
  try {
    const notesRes = await pdFetch(
      `${PORT_DADDY_URL}/sessions/${encodeURIComponent(sessionId)}/notes?limit=500`,
    );
    const notesData = (await notesRes.json()) as { notes?: Array<{ createdAt?: number }> };
    const noteTimesMs = (notesData.notes ?? [])
      .map((n) => (typeof n.createdAt === 'number' ? n.createdAt : NaN))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);

    let claimsTotal = 0;
    try {
      const sessRes = await pdFetch(`${PORT_DADDY_URL}/sessions/${encodeURIComponent(sessionId)}`);
      const sessData = (await sessRes.json()) as { files?: unknown[]; session?: { files?: unknown[] } };
      const files = sessData.files ?? sessData.session?.files ?? [];
      claimsTotal = Array.isArray(files) ? files.length : 0;
    } catch {
      /* claims unknown — treated as 0 (fail-open) */
    }
    return { noteTimesMs, claimsTotal };
  } catch {
    return empty;
  }
}

/**
 * The guard's narrow need: how many commits on this lease have NO coordination
 * note published after them. A commit "after the last note" is un-noted rent.
 * Fails open (returns 0) on any daemon/git failure.
 */
export async function gatherCommitsSinceLastNote(sessionId: string, cwd: string): Promise<number> {
  const { noteTimesMs } = await fetchSessionSignal(sessionId);
  const latestNote = noteTimesMs.length ? noteTimesMs[noteTimesMs.length - 1] : 0;
  const commitTimes = aheadCommitTimesMs(cwd);
  // A commit pays its rent when a note is published AFTER it. Count commits with
  // no later note — i.e. commits whose time is at/after the latest note.
  return commitTimes.filter((t) => t > latestNote).length;
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
  const { noteTimesMs, claimsTotal } = await fetchSessionSignal(sessionId);
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
