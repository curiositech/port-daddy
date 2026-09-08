/**
 * Git Origin Check — Precondition gate for pd done.
 *
 * This module verifies, before pd done is allowed to mark a session
 * complete, that:
 *   1. The clean session worktree's HEAD is contained in a freshly advertised
 *      origin upstream, or in origin's advertised default branch. The latter
 *      proves delivered ancestry, not that this feature branch was pushed.
 *   2. The result note ("Result: ...") includes one of three sentinels
 *      describing where the work lands:
 *        - A PR URL (https://github.com/.../pull/<n>)
 *        - "no-pr-yet: <reason>"
 *        - "not-applicable: <reason>"
 *
 * The 2026-05-20 incident that motivated this rule: 9 worktree branches
 * were orphaned because agents wrote pd done without ever pushing. No
 * one audited until the operator did it himself. This precondition is
 * the substrate fix.
 *
 * Implementation note: we use execFileSync (no shell) with hard-coded
 * argv arrays so no user input is interpolated into a shell command.
 * This mirrors the convention in lib/worktree.ts.
 */

import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import { devNull } from 'node:os';

export interface OriginCheckResult {
  ok: boolean;
  /** A short machine-readable code when ok=false */
  code?:
    | 'NO_REPO'
    | 'NO_UPSTREAM'
    | 'BRANCH_AHEAD'
    | 'DIRTY_WORKTREE'
    | 'GIT_ERROR';
  /** Human-readable explanation when ok=false */
  error?: string;
  /** Remediation hint, ready to print to operator */
  hint?: string;
  /** Current branch name, when detectable */
  branch?: string | null;
  /** Upstream ref (e.g. "origin/feat/foo"), when detectable */
  upstream?: string | null;
  /** Number of commits ahead of upstream (0 means clean) */
  ahead?: number;
  /** Exact read-only observation; not a PR/review/merge-policy receipt. */
  proof?: {
    kind: 'origin-upstream' | 'origin-default-ancestry';
    head: string;
    ref: string;
    oid: string;
  };
}

export interface GitOriginChecker {
  /** Prove clean HEAD ancestry in a freshly advertised, origin-bound ref. */
  checkBranchOnOrigin(cwd?: string): OriginCheckResult;
  /**
   * Returns ok=true only for a ledger-only worktree: no tracked/untracked
   * changes and no commits absent from every remote ref. This is the narrow
   * `pd done --no-pr` path for a session that produced durable notes but no
   * repository artifact.
   */
  checkLedgerOnly?(cwd?: string): LedgerOnlyCheckResult;
}

export interface LedgerOnlyCheckResult {
  ok: boolean;
  code?: 'NO_REPO' | 'DIRTY_WORKTREE' | 'UNPUBLISHED_COMMITS' | 'GIT_ERROR';
  error?: string;
  hint?: string;
  unpublishedCommits?: number;
  dirtyEntries?: number;
}

function gitExecOptions(cwd?: string): ExecFileSyncOptionsWithStringEncoding {
  return {
    ...(cwd ? { cwd } : {}),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  };
}

function tryGit(args: string[], opts: ExecFileSyncOptionsWithStringEncoding): { ok: true; out: string } | { ok: false; err: string } {
  try {
    const out = execFileSync('git', args, opts).toString().trim();
    return { ok: true, out };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, err: message };
  }
}

/**
 * Production implementation. The design separates Git containment from PR
 * policy and does not repair tracking metadata as a completion side effect.
 * @returns The ordinary delivery and separate ledger-only verifiers.
 */
export function createGitOriginChecker(): GitOriginChecker {
  return {
    /**
     * Observe origin and this exact worktree twice so read-time movement cannot
     * silently substitute another branch. The intent is evidence, not a lock.
     * @param cwd The session's physical linked worktree.
     * @returns Publication/containment proof or a sanitized refusal.
     */
    checkBranchOnOrigin(cwd?: string): OriginCheckResult {
      // This synchronous gate has one total budget, not a new timeout per Git
      // command. Never inherit another worktree selector or trace destination.
      const deadline = performance.now() + 10_000;
      const env = { ...process.env };
      for (const key of Object.keys(env)) {
        if (key.startsWith('GIT_') || key.startsWith('SSH_ASKPASS')) delete env[key];
      }
      Object.assign(env, {
        GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '',
        SSH_ASKPASS_REQUIRE: 'never', GCM_INTERACTIVE: 'Never', GCM_GUI_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1',
        GIT_GRAFT_FILE: devNull,
        GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=yes',
      });
      /**
       * Execute one read within the shared deadline; the purpose of omitting
       * stderr is to keep credential-bearing transport errors out of receipts.
       * @param args Fixed Git argv, without shell interpolation.
       * @returns Bounded stdout or only the numeric exit status.
       */
      const run = (args: string[]): { ok: boolean; out: string; status?: number } => {
        const remaining = Math.floor(deadline - performance.now());
        if (remaining <= 0) return { ok: false, out: '' };
        try {
          const out = execFileSync('git', ['-c', 'credential.interactive=false', '-c', 'core.fsmonitor=false', '-c', 'protocol.ext.allow=never', ...args], {
            ...gitExecOptions(cwd), env, timeout: remaining, killSignal: 'SIGKILL', maxBuffer: 64 * 1024,
          });
          return { ok: true, out: out.trim(), status: 0 };
        } catch (error) {
          // Git diagnostics can contain credential-bearing URLs or provider
          // messages. Return only bounded typed state, never stderr/error text.
          const status = (error as { status?: unknown })?.status;
          return { ok: false, out: '', ...(typeof status === 'number' ? { status } : {}) };
        }
      };
      /**
       * Construct a fixed diagnostic; the design never forwards Git stderr.
       * @param error Authored explanation of the failed evidence boundary.
       * @param extra Structured state relevant to that refusal.
       * @returns An unsuccessful check, not a repair instruction or bypass.
       */
      const fail = (error: string, extra: Partial<OriginCheckResult> = {}): OriginCheckResult => ({
        ok: false, code: 'GIT_ERROR', error,
        hint: 'Inspect the exact origin and worktree; fetch missing objects through the normal workflow, then retry completion. No Git state was changed by this check.',
        ...extra,
      });
      /**
       * Accept the two Git object formats by design, never revision expressions.
       * @param value The advertised or locally resolved object identifier.
       * @returns Whether the identifier is an entire SHA-1 or SHA-256 hex value.
       */
      const oid = (value: string) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
      const rootRes = run(['rev-parse', '--show-toplevel']);
      if (!rootRes.ok) {
        return fail('Not inside a Git repository, or Git is unavailable.', { code: 'NO_REPO' });
      }
      const branchRes = run(['symbolic-ref', '--quiet', 'HEAD']);
      const headRes = run(['rev-parse', '--verify', 'HEAD^{commit}']);
      if (!branchRes.ok || !branchRes.out.startsWith('refs/heads/') || !headRes.ok || !oid(headRes.out)) {
        return fail('An attached branch and its exact commit could not be verified.', { branch: null });
      }
      const branch = branchRes.out.slice('refs/heads/'.length);
      const head = headRes.out;
      /**
       * Preserve ignored evidence while rejecting unfinished repository work.
       * This design applies equally to upstream and default-ancestry proofs.
       * @returns A refusal, or undefined when the observed worktree is clean.
       */
      const clean = (): OriginCheckResult | undefined => {
        const status = run(['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none']);
        if (!status.ok) return fail('Worktree cleanliness could not be verified.', { branch });
        if (status.out) return fail('Worktree contains uncommitted or untracked work.', {
          code: 'DIRTY_WORKTREE', branch,
          hint: 'Preserve, commit and deliver unfinished repository work before closing. Ignored local evidence may remain; do not delete artifacts merely to pass completion.',
        });
        return undefined;
      };
      const dirty = clean();
      if (dirty) return dirty;

      // A missing remote must not turn "origin" into a relative path. Exactly
      // one effective fetch URL is required; never expose its possibly secret
      // contents in the result. The configured URL is rechecked before success.
      const origin = run(['remote', 'get-url', '--all', 'origin']);
      if (!origin.ok || !origin.out || /[\r\n\0]/.test(origin.out)) {
        return fail('Exactly one configured origin URL is required.', { branch });
      }
      const upstreamArgs = ['for-each-ref', '--format=%(upstream:remotename)%00%(upstream:remoteref)', branchRes.out];
      const tracking = run(upstreamArgs);
      if (!tracking.ok) return fail('Branch tracking metadata could not be read.', { branch });
      const [remote, trackedRef, ...extra] = tracking.out.split('\0');
      const originUpstream = remote === 'origin' && extra.length === 0 && trackedRef?.startsWith('refs/heads/')
        && run(['check-ref-format', trackedRef]).ok ? trackedRef : null;
      const upstream = originUpstream ? `origin/${originUpstream.slice('refs/heads/'.length)}` : null;
      type Advertisement = { defaultRef?: string; defaultOid?: string; upstreamOid?: string };
      /**
       * Read the named origin, then select exact candidate refs: ls-remote
       * patterns also match slash-delimited tails. Legitimate extra rows are
       * not proof; contradictory or duplicate selected evidence must not win.
       * @returns A fresh advertisement, or undefined for missing/ambiguous data.
       */
      const advertisement = (): Advertisement | undefined => {
        const result = run(['ls-remote', '--quiet', '--symref', 'origin', 'HEAD', ...(originUpstream ? [originUpstream] : [])]);
        if (!result.ok) return undefined;
        let defaultRef: string | undefined;
        let defaultOid: string | undefined;
        let upstreamOid: string | undefined;
        const refOids = new Map<string, string>();
        for (const line of result.out.split('\n')) {
          const parts = line.split('\t');
          if (parts.length !== 2) return undefined;
          const [value, ref] = parts;
          if (ref === 'HEAD' && value.startsWith('ref: refs/heads/')) {
            if (defaultRef !== undefined) return undefined;
            defaultRef = value.slice(5);
          } else if (ref === 'HEAD' && oid(value)) {
            if (defaultOid !== undefined) return undefined;
            defaultOid = value;
          } else {
            // HEAD can also return refs/heads/topic/HEAD, tags and their
            // peeled rows. Even a full ref pattern can match a longer tail.
            // Validate these rows, but never use a tail match as the selected
            // upstream or default branch's own OID.
            const peeled = ref.endsWith('^{}');
            const namedRef = peeled ? ref.slice(0, -3) : ref;
            const matches = namedRef.endsWith('/HEAD') || (originUpstream
              && (namedRef === originUpstream || namedRef.endsWith(`/${originUpstream}`)));
            if (!oid(value) || !matches || !namedRef.startsWith('refs/')
              || (peeled && !namedRef.startsWith('refs/tags/'))
              || !run(['check-ref-format', namedRef]).ok || refOids.has(ref)) return undefined;
            refOids.set(ref, value);
            if (ref === originUpstream) upstreamOid = value;
          }
        }
        if (defaultRef && (!defaultOid || !run(['check-ref-format', defaultRef]).ok)) return undefined;
        if (defaultOid && !defaultRef) return undefined;
        // The HEAD pseudoref and its named branch must agree whenever both
        // rows were returned. No other candidate may rescue contradictory
        // evidence from the same advertised branch.
        if (defaultRef && refOids.has(defaultRef) && refOids.get(defaultRef) !== defaultOid) return undefined;
        if (!defaultRef && !upstreamOid) return undefined;
        return { ...(defaultRef ? { defaultRef, defaultOid } : {}), ...(upstreamOid ? { upstreamOid } : {}) };
      };
      const advertised = advertisement();
      if (!advertised) return fail('Origin did not provide an unambiguous current default-branch advertisement within the bounded read.', { branch, upstream });

      const candidates: NonNullable<OriginCheckResult['proof']>[] = [];
      if (originUpstream && advertised.upstreamOid) {
        candidates.push({ kind: 'origin-upstream', head, ref: originUpstream, oid: advertised.upstreamOid });
      }
      if (advertised.defaultRef && advertised.defaultOid) {
        candidates.push({ kind: 'origin-default-ancestry', head, ref: advertised.defaultRef, oid: advertised.defaultOid });
      }
      let proof: OriginCheckResult['proof'];
      let missingObject = false;
      for (const candidate of candidates) {
        const type = run(['cat-file', '-t', candidate.oid]);
        if (!type.ok || type.out !== 'commit') { missingObject = true; continue; }
        const ancestry = run(['merge-base', '--is-ancestor', head, candidate.oid]);
        if (ancestry.ok) { proof = candidate; break; }
        if (ancestry.status !== 1) return fail('Exact origin ancestry could not be inspected.', { branch, upstream });
      }
      if (!proof) {
        if (missingObject) return fail('An advertised origin commit is unavailable locally; delivery remains unproven.', { branch, upstream });
        return fail('HEAD is not contained in the advertised origin upstream or default branch.', {
          code: originUpstream ? 'BRANCH_AHEAD' : 'NO_UPSTREAM', branch, upstream,
          hint: 'Deliver unique local commits through the normal reviewed workflow. Missing tracking metadata does not prove never-pushed work; squash/rebase delivery cannot be inferred from ancestry alone.',
        });
      }
      // A second advertised read detects movement during the proof. There is
      // no atomic lock across the remote and local repository: this is an
      // exact observation, not a promise that neither can change afterward.
      const finalAdvertisement = advertisement();
      const finalOrigin = run(['remote', 'get-url', '--all', 'origin']);
      const finalTracking = run(upstreamArgs);
      const finalRoot = run(['rev-parse', '--show-toplevel']);
      const finalBranch = run(['symbolic-ref', '--quiet', 'HEAD']);
      const finalHead = run(['rev-parse', '--verify', 'HEAD^{commit}']);
      if (!finalAdvertisement || JSON.stringify(finalAdvertisement) !== JSON.stringify(advertised)
        || !finalOrigin.ok || finalOrigin.out !== origin.out || !finalTracking.ok || finalTracking.out !== tracking.out
        || !finalRoot.ok || finalRoot.out !== rootRes.out || !finalBranch.ok || finalBranch.out !== branchRes.out
        || !finalHead.ok || finalHead.out !== head) {
        return fail('Origin or the selected worktree changed during the delivery proof; completion was not accepted.', { branch, upstream });
      }
      const finalDirty = clean();
      if (finalDirty) return finalDirty;
      return { ok: true, branch, upstream, ahead: 0, proof };
    },

    /**
     * Prove there is no repository artifact for a `--no-pr` session. The
     * design checks both worktree state and commits absent from every remote
     * ref so a convenience flag cannot silently orphan unpublished work.
     *
     * @param cwd - Worktree whose local and remote-reachability state is inspected.
     * @returns Structured success or the exact failed ledger-only invariant.
     */
    checkLedgerOnly(cwd?: string): LedgerOnlyCheckResult {
      const opts = gitExecOptions(cwd);
      const rootRes = tryGit(['rev-parse', '--show-toplevel'], opts);
      if (!rootRes.ok) {
        return {
          ok: false,
          code: 'NO_REPO',
          error: 'Not inside a Git repository (or git is unavailable).',
          hint: 'A --no-pr close still requires a verifiably clean repository worktree.',
        };
      }

      const statusRes = tryGit(['status', '--porcelain=v1', '--untracked-files=all'], opts);
      if (!statusRes.ok) {
        return {
          ok: false,
          code: 'GIT_ERROR',
          error: `Could not inspect worktree cleanliness: ${statusRes.err}`,
          hint: 'Inspect the worktree and preserve or revert every local change before closing --no-pr.',
        };
      }
      const dirtyEntries = statusRes.out ? statusRes.out.split('\n').filter(Boolean).length : 0;
      if (dirtyEntries > 0) {
        return {
          ok: false,
          code: 'DIRTY_WORKTREE',
          error: `Worktree has ${dirtyEntries} uncommitted or untracked entr${dirtyEntries === 1 ? 'y' : 'ies'}.`,
          hint: 'Commit and publish the work, or remove only verified session-owned residue before closing --no-pr.',
          dirtyEntries,
        };
      }

      const unpublishedRes = tryGit(['rev-list', '--count', 'HEAD', '--not', '--remotes'], opts);
      if (!unpublishedRes.ok) {
        return {
          ok: false,
          code: 'GIT_ERROR',
          error: `Could not inspect unpublished commits: ${unpublishedRes.err}`,
          hint: 'Fetch the canonical remote and verify the branch has no unpublished commits.',
        };
      }
      const unpublishedCommits = Number.parseInt(unpublishedRes.out, 10);
      if (!Number.isFinite(unpublishedCommits) || unpublishedCommits < 0) {
        return {
          ok: false,
          code: 'GIT_ERROR',
          error: `Unexpected unpublished commit count: "${unpublishedRes.out}"`,
          hint: 'Fetch the canonical remote and verify the branch has no unpublished commits.',
        };
      }
      if (unpublishedCommits > 0) {
        return {
          ok: false,
          code: 'UNPUBLISHED_COMMITS',
          error: `Branch contains ${unpublishedCommits} commit${unpublishedCommits === 1 ? '' : 's'} absent from every remote ref.`,
          hint: 'Push the branch and open a PR; --no-pr is only for sessions with no repository artifact.',
          unpublishedCommits,
        };
      }

      return { ok: true, dirtyEntries: 0, unpublishedCommits: 0 };
    },
  };
}

// =============================================================================
// Result-note sentinel detection
// =============================================================================

/**
 * Matches GitHub-style PR URLs. We accept https://github.com/<owner>/<repo>/pull/<n>.
 * (GitLab and other forges can be added if/when needed; sentinels are also accepted
 * for those cases via no-pr-yet / not-applicable.)
 */
const PR_URL_RE = /https?:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/i;
const NO_PR_YET_RE = /\bno-pr-yet\s*:/i;
const NOT_APPLICABLE_RE = /\bnot-applicable\s*:/i;

export type NoteSentinelKind = 'pr-url' | 'no-pr-yet' | 'not-applicable';

export interface NoteSentinelResult {
  ok: boolean;
  kind?: NoteSentinelKind;
  match?: string;
}

/**
 * Returns ok=true if the note contains one of the three accepted sentinels.
 * Returns ok=false (with no kind/match) when the note is missing or lacks any sentinel.
 */
export function checkResultNoteSentinel(note: string | null | undefined): NoteSentinelResult {
  if (typeof note !== 'string' || !note.trim()) {
    return { ok: false };
  }
  const m1 = note.match(PR_URL_RE);
  if (m1) return { ok: true, kind: 'pr-url', match: m1[0] };
  if (NO_PR_YET_RE.test(note)) return { ok: true, kind: 'no-pr-yet' };
  if (NOT_APPLICABLE_RE.test(note)) return { ok: true, kind: 'not-applicable' };
  return { ok: false };
}

export function noteSentinelErrorMessage(): string {
  return [
    'Result note must include one of:',
    '  - A PR URL                 (e.g., "Result: ... PR opened: https://github.com/owner/repo/pull/143")',
    '  - no-pr-yet: <reason>      (e.g., "Result: ... no-pr-yet: blocked on operator approval")',
    '  - not-applicable: <reason> (e.g., "Result: ... not-applicable: docs-only sync")',
  ].join('\n');
}
