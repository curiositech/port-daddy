/**
 * apps/relay/src/snipe-builder.ts — the approval gate and the skill builder (G′6).
 *
 *   POST /account/seamanship/suggest   (session + same-origin) → queue a run
 *   POST /account/seamanship/approve   (session + same-origin) → APPROVE one
 *   POST /account/seamanship/dismiss   (session + same-origin) → DISMISS one
 *   GET  /v1/seamanship/suggestions    (session)               → own rows, JSON
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  NO APPROVAL ⇒ NO BUILD ⇒ NO PULL REQUEST — STRUCTURALLY, NOT BY CONVENTION
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A gate that is merely a convention is a gate that the next refactor removes
 * by accident. This one is made of three interlocking pieces, and defeating it
 * requires defeating all three:
 *
 * 1. THE BUILDER'S SIGNATURE. {@link buildSkillPullRequest} does not take a
 *    suggestion id. It takes a {@link BuildGrant} — an opaque type whose brand
 *    is a `unique symbol` declared inside this module and exported nowhere. No
 *    caller in this codebase, or any future one, can write an object literal
 *    that type-checks as a grant. The build cannot be invoked without one, and
 *    the only function that returns one is {@link claimBuildGrant}.
 *
 * 2. THE GRANT'S ORIGIN. A grant row exists only because
 *    {@link handleSnipeApprove} inserted it, and that insert happens only after
 *    a conditional UPDATE moved the suggestion 'proposed' → 'approved' and
 *    reported exactly one row changed. No approval, no row; and because
 *    `suggestion_id` is the table's PRIMARY KEY, one approval can never mint
 *    two grants.
 *
 * 3. THE CLAIM. {@link claimBuildGrant} spends the grant with a conditional
 *    UPDATE requiring `consumed_at IS NULL AND revoked_at IS NULL`. A replayed
 *    build finds it already spent and gets `null`. A dismissal that lands first
 *    sets `revoked_at`, and the claim then fails too — so an approval is
 *    genuinely retractable right up until a build starts, rather than being a
 *    race the operator loses.
 *
 * And the terminal transition agrees with all of it: the status law
 * (src/snipe-suggestions.ts `nextStatus`) has no 'proposed' → 'built' edge at
 * all, and the write that records a finished build names `status = 'approved'`
 * in its WHERE clause. A suggestion nobody approved cannot be marked built even
 * by a direct call to the recording function.
 *
 * ── THE OUTPUT IS A PULL REQUEST. THAT IS THE WHOLE POINT. ───────────────────
 *
 * Approval does not write a skill. It authorizes ONE pull request into the
 * operator's own repo, through `commitFilesAndOpenPr` — the single mutation
 * core the fleet control plane uses, which can create a fresh branch and open a
 * PR and can do nothing else. It cannot push to an existing branch and cannot
 * merge. The operator's review and merge is the last gate, and there is no code
 * path in this relay that adds a skill to a catalog without passing through it.
 *
 * The authored SKILL.md carries provenance frontmatter — `owner`, `repos`, and
 * `visibility: private` — so a built skill starts at the narrowest tier the
 * catalog has. Publishing is a separate, later, per-skill act by the author
 * editing their own file; nothing here can widen a skill's audience, and a
 * builder that defaulted to a wider tier would be making that choice on the
 * author's behalf.
 *
 * ── TENANCY, AND WHY THE INSTALLATION IS RECORDED AT APPROVAL ───────────────
 *
 * Ownership of a GitHub App installation is established from GitHub's own
 * answer about the SIGNED-IN USER (`userOwnsInstallation`), which needs their
 * session token. The build runs later, on a sweep, where there is no session —
 * so the proof cannot be re-taken then. It is taken once, by the approving
 * request, and recorded on the grant. The build uses the recorded installation
 * and no other, so a build can never target a repo the approver did not prove
 * they owned.
 */

import { randomHex } from './crypto.js';
import type { Env } from './types.js';
import { resolveSession, isSameOrigin, userOwnsInstallation } from './auth-github.js';
import { commitFilesAndOpenPr } from './fleet-control.js';
import {
  getInstallationTokenCached,
  getRepoDefaultBranch,
  getRepoInstallationId,
} from './github-app.js';
import {
  applySuggestionTransition,
  enqueueSuggestionJob,
  getSuggestion,
  listSuggestions,
  nextStatus,
  type SuggestionRow,
} from './snipe-suggestions.js';

/** Branch names the builder creates. Nothing else may be pushed by this path. */
export const SNIPE_BRANCH_PREFIX = 'snipe-skill-';

/** Build attempts one grant may spend before it stops being retried. */
export const MAX_BUILD_ATTEMPTS = 3;

/** Grants a single sweep will try to build. Bounds one cron invocation. */
export const MAX_BUILDS_PER_SWEEP = 3;

const REPO_FULL_NAME_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SUGGESTION_ID_RE = /^sug_[a-f0-9]{4,64}$/;

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
}

function publicError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/[A-Za-z0-9+/=_-]{60,}/g, '[redacted]').slice(0, 240);
}

function isFormPost(request: Request): boolean {
  return (request.headers.get('Content-Type') ?? '').includes('application/x-www-form-urlencoded');
}

function redirect303(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

// ══════════════════════════════════════════════════════════════════════════
//  The capability
// ══════════════════════════════════════════════════════════════════════════

/**
 * The brand. Declared here, exported nowhere, and never assigned at runtime —
 * it exists only in the type system, where it makes {@link BuildGrant}
 * unforgeable outside this module. A caller elsewhere cannot name this symbol,
 * so it cannot write a literal that satisfies the interface, so it cannot call
 * the builder without going through {@link claimBuildGrant}.
 */
declare const BUILD_GRANT_BRAND: unique symbol;

/**
 * Proof that a human approved a specific suggestion, and that this proof has
 * not been spent yet.
 *
 * Obtainable ONLY from {@link claimBuildGrant}, which both verifies and spends
 * it in one conditional UPDATE. Holding a value of this type is therefore
 * equivalent to "an approval existed, it had not been revoked, and this call is
 * the one that consumed it".
 */
export interface BuildGrant {
  readonly [BUILD_GRANT_BRAND]: true;
  readonly grantId: string;
  readonly suggestionId: string;
  readonly userId: string;
  readonly repoFullName: string;
  readonly installationId: number;
  readonly issuedBy: string;
  readonly attempt: number;
}

export interface GrantRow {
  suggestion_id: string;
  grant_id: string;
  user_id: string;
  repo_full_name: string;
  installation_id: number;
  issued_at: number;
  issued_by: string;
  attempts: number;
  consumed_at: number | null;
  revoked_at: number | null;
}

const GRANT_COLUMNS =
  'suggestion_id, grant_id, user_id, repo_full_name, installation_id, issued_at, issued_by, ' +
  'attempts, consumed_at, revoked_at';

/**
 * Mint the build capability for a suggestion that has JUST been approved.
 *
 * Called only from the approval handler, and only after its conditional UPDATE
 * reported one row changed. The PRIMARY KEY on `suggestion_id` is what makes a
 * second grant for the same proposal impossible rather than merely unlikely.
 *
 * @returns the grant id, or null when the insert lost a race (which means a
 *   grant already exists — the correct outcome, not an error).
 */
export async function issueBuildGrant(
  db: D1Database,
  m: {
    suggestionId: string;
    userId: string;
    repoFullName: string;
    installationId: number;
    issuedBy: string;
    now: number;
  },
): Promise<string | null> {
  const grantId = `grant_${randomHex(12)}`;
  try {
    await db
      .prepare(
        'INSERT INTO seamanship_build_grants (suggestion_id, grant_id, user_id, repo_full_name, ' +
          'installation_id, issued_at, issued_by, attempts) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
      )
      .bind(m.suggestionId, grantId, m.userId, m.repoFullName, m.installationId, m.now, m.issuedBy)
      .run();
    return grantId;
  } catch {
    return null;
  }
}

/**
 * Spend a grant, atomically, and hand back the capability it represents.
 *
 * The WHERE clause is the gate: `consumed_at IS NULL` makes the claim
 * single-use, `revoked_at IS NULL` honours a dismissal that landed first, and
 * the attempts bound stops a grant that keeps failing from being retried
 * forever. Zero rows changed ⇒ `null`, and the caller has no other way to
 * obtain a {@link BuildGrant}.
 */
export async function claimBuildGrant(
  db: D1Database,
  grantId: string,
  now: number,
): Promise<BuildGrant | null> {
  const claimed = await db
    .prepare(
      'UPDATE seamanship_build_grants SET consumed_at = ?, attempts = attempts + 1 ' +
        'WHERE grant_id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND attempts < ?',
    )
    .bind(now, grantId, MAX_BUILD_ATTEMPTS)
    .run();
  if ((claimed.meta?.changes ?? 0) === 0) return null;

  const row = await db
    .prepare(`SELECT ${GRANT_COLUMNS} FROM seamanship_build_grants WHERE grant_id = ?`)
    .bind(grantId)
    .first<GrantRow>();
  if (!row) return null;

  return {
    grantId: row.grant_id,
    suggestionId: row.suggestion_id,
    userId: row.user_id,
    repoFullName: row.repo_full_name,
    installationId: row.installation_id,
    issuedBy: row.issued_by,
    attempt: row.attempts,
  } as BuildGrant;
}

/**
 * Return an unspent grant to the queue after a failure that provably happened
 * BEFORE any pull request could exist.
 *
 * Never called for a failure from the PR call itself: a request that errored
 * after reaching GitHub may have created a branch or a PR, and re-running it
 * could open a second one. An un-retried grant leaves a legible error on the
 * suggestion row instead, which is the honest outcome.
 */
export async function releaseBuildGrant(db: D1Database, grantId: string): Promise<void> {
  await db
    .prepare('UPDATE seamanship_build_grants SET consumed_at = NULL WHERE grant_id = ? AND consumed_at IS NOT NULL')
    .bind(grantId)
    .run();
}

/** Revoke an unspent grant — the dismissal path's veto over a pending build. */
export async function revokeBuildGrant(db: D1Database, suggestionId: string, now: number): Promise<boolean> {
  const res = await db
    .prepare(
      'UPDATE seamanship_build_grants SET revoked_at = ? WHERE suggestion_id = ? AND consumed_at IS NULL AND revoked_at IS NULL',
    )
    .bind(now, suggestionId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

// ══════════════════════════════════════════════════════════════════════════
//  The artifact
// ══════════════════════════════════════════════════════════════════════════

export interface SkillFileInputs {
  skillName: string;
  description: string;
  rationale: string;
  /** The author the skill is attributed to — the approving operator's login. */
  owner: string;
  /** The repo the skill is scoped to. */
  repoFullName: string;
}

/** YAML scalar quoting for a single-line value. Never emits a multi-line scalar. */
function yamlString(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  return `'${flat.replace(/'/g, "''")}'`;
}

/**
 * Render the SKILL.md a build authors.
 *
 * PROVENANCE FRONTMATTER IS NOT OPTIONAL HERE. Three fields carry it:
 *
 *   owner       — who this skill is attributed to. Recorded because a catalog
 *                 without attribution turns into a commons nobody maintains.
 *   repos       — the repo it was proposed for. A skill in this corpus is
 *                 particular to a person and their repos; the file says so.
 *   visibility  — 'private', always, from this path. The narrowest tier the
 *                 catalog defines. Publishing is a later, separate, per-skill
 *                 act the author takes by editing their own file — a builder
 *                 that emitted a wider tier would be making that choice for
 *                 them, and the whole listing model is opt-in.
 *
 * The body states what the skill is for, the friction it exists to end, and an
 * explicit NOT-FOR boundary — the same convention the corpus uses, and the
 * clause a future suggestion run reads back to avoid re-proposing this skill.
 *
 * PURE: string in, string out. No clock, no randomness, so the authored file is
 * byte-identical for identical inputs and is testable as such.
 */
export function renderSkillFile(m: SkillFileInputs): string {
  const lines = [
    '---',
    `name: ${m.skillName}`,
    `description: ${yamlString(m.description)}`,
    `owner: ${yamlString(m.owner)}`,
    'repos:',
    `  - ${yamlString(m.repoFullName)}`,
    "# Private is the narrowest tier this catalog defines, and it is where every",
    '# built skill starts. Widening it to `listed` or `public` is a deliberate',
    '# edit by the author of this file, never a default anyone lands in.',
    'visibility: private',
    '---',
    '',
    `# ${m.skillName}`,
    '',
    m.description,
    '',
    '## Why this skill exists',
    '',
    m.rationale,
    '',
    '## How to use it',
    '',
    '_This skill was scaffolded from an approved proposal and is a stub: it carries',
    'the boundary and the rationale, not yet the procedure. Fill in the steps,',
    'inputs and outputs before relying on it._',
    '',
    '## NOT for',
    '',
    '_State plainly what this skill is not for, and which skill covers that instead._',
    "Boundaries are load-bearing in this catalog: a proposal run reads them back, so",
    'a clear NOT-FOR clause here is what stops the same skill being proposed again.',
    '',
    '---',
    '',
    `Proposed by the Engineman for \`${m.repoFullName}\`, approved by \`${m.owner}\`, and`,
    'authored through a pull request. Nothing reached this catalog without that review.',
    '',
  ];
  return lines.join('\n');
}

/** The path a built skill occupies in the operator's repo. */
export function skillFilePath(skillName: string): string {
  return `skills/${skillName}/SKILL.md`;
}

// ══════════════════════════════════════════════════════════════════════════
//  The build
// ══════════════════════════════════════════════════════════════════════════

export type BuildResult =
  | { ok: true; prUrl: string; branch: string; path: string }
  | { ok: false; retryable: boolean; error: string };

/** Injectable GitHub seam, so the build is testable without network access. */
export interface BuildDeps {
  installationToken(env: Env, installationId: number): Promise<string>;
  defaultBranch(owner: string, repo: string, token: string): Promise<string>;
  openPr(m: Parameters<typeof commitFilesAndOpenPr>[0]): Promise<string>;
  newBranch?(): string;
}

export const defaultBuildDeps: BuildDeps = {
  async installationToken(env, installationId) {
    return getInstallationTokenCached(
      env.GITHUB_APP_ID ?? '',
      env.GITHUB_APP_PRIVATE_KEY ?? '',
      installationId,
      env.KV,
    );
  },
  defaultBranch: getRepoDefaultBranch,
  openPr: commitFilesAndOpenPr,
};

/**
 * Author one approved skill as a pull request.
 *
 * REQUIRES a {@link BuildGrant}, which cannot be constructed outside this
 * module — so this function is unreachable without a claimed approval. That is
 * the type-level half of the gate; the conditional UPDATE inside
 * {@link claimBuildGrant} is the runtime half.
 *
 * The `retryable` flag on a failure is a real distinction, not a hint:
 *   · true  — the failure happened before anything was sent to GitHub, so the
 *             grant can safely be returned to the queue.
 *   · false — the pull-request call itself failed, and a branch or PR MAY
 *             already exist. The grant stays spent; a second attempt could open
 *             a duplicate, which is worse than an error the operator can see.
 */
export async function buildSkillPullRequest(
  env: Env,
  grant: BuildGrant,
  suggestion: SuggestionRow,
  ownerLogin: string,
  deps: BuildDeps = defaultBuildDeps,
): Promise<BuildResult> {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    return { ok: false, retryable: true, error: 'BUILD_UNCONFIGURED: GitHub App not configured on this relay' };
  }
  if (!REPO_FULL_NAME_RE.test(grant.repoFullName)) {
    return { ok: false, retryable: false, error: "grant repo is not 'owner/name'" };
  }
  const [owner, repo] = grant.repoFullName.split('/') as [string, string];

  let token: string;
  let baseBranch: string;
  try {
    token = await deps.installationToken(env, grant.installationId);
    baseBranch = await deps.defaultBranch(owner, repo, token);
  } catch (e) {
    // Nothing has been written; a retry is safe and costs nothing.
    return { ok: false, retryable: true, error: `could not reach the repo: ${publicError(e)}` };
  }

  const branch = deps.newBranch?.() ?? `${SNIPE_BRANCH_PREFIX}${suggestion.skill_name}-${randomHex(4)}`;
  const path = skillFilePath(suggestion.skill_name);
  const file = renderSkillFile({
    skillName: suggestion.skill_name,
    description: suggestion.description,
    rationale: suggestion.rationale,
    owner: ownerLogin,
    repoFullName: grant.repoFullName,
  });

  const prBody = [
    `Scaffolds \`${path}\` — a reusable skill proposed by the **Engineman** and approved by \`@${ownerLogin}\`.`,
    '',
    '**Why:**',
    '',
    `> ${suggestion.rationale.replace(/\n/g, '\n> ')}`,
    '',
    '**Provenance:** this skill exists because a person approved a stored proposal.',
    'The approval minted a single-use build capability; this pull request spent it.',
    'An unapproved proposal has no capability and no build, so there is no path to',
    'this branch that skipped a human.',
    '',
    `**Tier:** the file declares \`visibility: private\` — the narrowest tier the`,
    'catalog defines. Widening it is a later edit you make to your own file; nothing',
    'automated can do it for you.',
    '',
    '**Scope:** a fresh branch and this one file. The builder cannot push to an',
    'existing branch and cannot merge — your review is the gate, and the skill does',
    'not exist in your catalog until you merge it.',
    '',
    '_The authored file is a stub: it carries the boundary and the rationale, not yet',
    'the procedure. Fill in the steps before relying on it._',
  ].join('\n');

  try {
    const prUrl = await deps.openPr({
      owner,
      repo,
      baseBranch,
      branchName: branch,
      files: { [path]: file },
      commitMessage: `skills: scaffold ${suggestion.skill_name} from an approved Engineman proposal`,
      prTitle: `Add skill: ${suggestion.skill_name}`,
      prBody,
      token,
    });
    return { ok: true, prUrl, branch, path };
  } catch (e) {
    // A branch or PR may already exist. NOT retryable — see the doc comment.
    return { ok: false, retryable: false, error: `pull request failed: ${publicError(e)}` };
  }
}

export interface BuildSweepResult {
  now: number;
  claimed: number;
  built: number;
  failed: number;
  released: number;
  errors: string[];
}

/**
 * Drain approved-but-unbuilt suggestions into pull requests.
 *
 * The QUEUE IS THE GRANT TABLE — open grants (`consumed_at IS NULL AND
 * revoked_at IS NULL`) are exactly the pending builds. There is no separate
 * queue that could be written to without an approval, which is what keeps the
 * gate structural: to enqueue a build you must mint a grant, and to mint a
 * grant you must approve.
 *
 * Internally fail-safe, like every sweep the relay schedules: returns a counter
 * struct with an `errors` array and never throws into the handler.
 */
export async function runSnipeBuildSweep(
  env: Env,
  now: number,
  deps: BuildDeps = defaultBuildDeps,
): Promise<BuildSweepResult> {
  const result: BuildSweepResult = { now, claimed: 0, built: 0, failed: 0, released: 0, errors: [] };
  let open: GrantRow[] = [];
  try {
    const rows = await env.DB.prepare(
      `SELECT ${GRANT_COLUMNS} FROM seamanship_build_grants ` +
        'WHERE consumed_at IS NULL AND revoked_at IS NULL AND attempts < ? ORDER BY issued_at ASC LIMIT ?',
    )
      .bind(MAX_BUILD_ATTEMPTS, MAX_BUILDS_PER_SWEEP)
      .all<GrantRow>();
    open = rows.results ?? [];
  } catch (e) {
    result.errors.push(`list: ${publicError(e)}`);
    return result;
  }

  for (const row of open) {
    try {
      const grant = await claimBuildGrant(env.DB, row.grant_id, now);
      if (!grant) continue; // revoked, or another invocation took it.
      result.claimed += 1;

      const suggestion = await getSuggestion(env.DB, grant.userId, grant.suggestionId);
      if (!suggestion) {
        result.errors.push(`${grant.grantId}: suggestion is gone`);
        result.failed += 1;
        continue;
      }
      // Belt and braces: the sweep re-reads the row and refuses to build one
      // that is not 'approved' RIGHT NOW. A grant is proof an approval once
      // existed; this is proof it still does.
      if (suggestion.status !== 'approved') {
        result.errors.push(`${grant.grantId}: suggestion is '${suggestion.status}', not 'approved'`);
        result.failed += 1;
        continue;
      }
      const login = await lookupLogin(env.DB, grant.userId);
      const built = await buildSkillPullRequest(env, grant, suggestion, login ?? grant.issuedBy, deps);

      if (built.ok) {
        const verdict = nextStatus('approved', 'build-succeeded');
        if (!verdict.ok) {
          // Unreachable while the status law holds; recorded rather than
          // silently swallowed if it ever stops holding.
          result.errors.push(`${grant.grantId}: ${verdict.reason}`);
          result.failed += 1;
          continue;
        }
        await applySuggestionTransition(env.DB, {
          suggestionId: grant.suggestionId,
          userId: grant.userId,
          from: 'approved',
          to: verdict.to,
          now,
          prUrl: built.prUrl,
          buildError: null,
        });
        result.built += 1;
        continue;
      }

      result.failed += 1;
      result.errors.push(`${grant.grantId}: ${built.error}`);
      await recordBuildError(env.DB, grant.suggestionId, grant.userId, built.error, now);
      if (built.retryable) {
        await releaseBuildGrant(env.DB, grant.grantId);
        result.released += 1;
      }
    } catch (e) {
      result.errors.push(`${row.grant_id}: ${publicError(e)}`);
    }
  }
  return result;
}

/** Record a build failure on the suggestion, leaving its status alone. */
async function recordBuildError(
  db: D1Database,
  suggestionId: string,
  userId: string,
  error: string,
  now: number,
): Promise<void> {
  try {
    await db
      .prepare(
        'UPDATE seamanship_suggestions SET build_error = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      )
      .bind(error, now, suggestionId, userId)
      .run();
  } catch {
    // A failed epilogue must not mask the failure it was describing.
  }
}

async function lookupLogin(db: D1Database, userId: string): Promise<string | null> {
  try {
    const row = await db.prepare('SELECT login FROM users WHERE id = ?').bind(userId).first<{ login: string }>();
    return row?.login ?? null;
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  Handlers
// ══════════════════════════════════════════════════════════════════════════

interface ActionFields {
  suggestionId?: string;
  installationId?: string | number;
  repo?: string;
}

async function readActionBody(request: Request, form: boolean): Promise<ActionFields | null> {
  try {
    if (form) {
      const fd = await request.formData();
      return {
        suggestionId: String(fd.get('suggestionId') ?? ''),
        installationId: String(fd.get('installationId') ?? ''),
        repo: String(fd.get('repo') ?? ''),
      };
    }
    return (await request.json()) as ActionFields;
  } catch {
    return null;
  }
}

/**
 * POST /account/seamanship/approve — THE HUMAN ACT.
 *
 * This is the only function in the relay that mints a build capability, and it
 * runs only inside a request carrying a session cookie and a same-origin
 * header. There is no scheduled path, no webhook path and no model-reachable
 * path to it: approval is something a person does, in a browser, on purpose.
 *
 * Order of the gates, and why:
 *   1. session + same-origin — as every state-changing POST.
 *   2. the row is THIS account's ('user_id' in the WHERE clause). A suggestion
 *      that is not yours reads as absent, byte-identically to one that never
 *      existed — no existence oracle.
 *   3. the status law says 'approve' is legal from where the row actually is.
 *   4. tenancy: GitHub's own answer says this user owns the installation, AND
 *      the App JWT says the repo belongs to that same installation. Both, and
 *      before anything is written.
 *   5. the conditional UPDATE 'proposed' → 'approved'. One row changed, or
 *      nothing happened.
 *   6. only then, the grant.
 */
export async function handleSnipeApprove(request: Request, env: Env): Promise<Response> {
  const form = isFormPost(request);
  const fail = (status: number, code: string, error: string): Response => {
    if (!form) return json(status, { code, error });
    if (code === 'UNAUTHENTICATED') return redirect303('/login');
    return redirect303(`/account/seamanship?notice=${encodeURIComponent(code.toLowerCase())}`);
  };

  const session = await resolveSession(request, env);
  if (!session) return fail(401, 'UNAUTHENTICATED', 'no session');
  if (!isSameOrigin(request, env)) return fail(403, 'CROSS_ORIGIN', 'cross-origin request refused');
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    return fail(503, 'BUILD_UNCONFIGURED', 'GitHub App not configured on this relay');
  }

  const body = await readActionBody(request, form);
  const suggestionId = typeof body?.suggestionId === 'string' ? body.suggestionId.trim() : '';
  if (!SUGGESTION_ID_RE.test(suggestionId)) {
    return fail(400, 'BAD_REQUEST', 'suggestionId required');
  }
  const installationId = Number(body?.installationId);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    return fail(400, 'BAD_REQUEST', 'installationId (positive integer) required');
  }

  const suggestion = await getSuggestion(env.DB, session.user.id, suggestionId);
  // Not yours and never existed are the same answer, deliberately.
  if (!suggestion) return fail(404, 'NOT_FOUND', 'no such suggestion');

  const verdict = nextStatus(suggestion.status, 'approve');
  if (!verdict.ok) return fail(409, 'ILLEGAL_TRANSITION', verdict.reason);

  if (!REPO_FULL_NAME_RE.test(suggestion.repo_full_name)) {
    return fail(400, 'BAD_REQUEST', "the suggestion's repo is not 'owner/name'");
  }
  const [owner, repo] = suggestion.repo_full_name.split('/') as [string, string];

  if (!(await userOwnsInstallation(env, session, installationId))) {
    return fail(403, 'FORBIDDEN', 'you do not own this installation');
  }
  let bound: number;
  try {
    bound = await getRepoInstallationId(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, owner, repo, env.KV);
  } catch {
    return fail(403, 'REPO_NOT_INSTALLED', `the GitHub App is not installed on ${suggestion.repo_full_name}`);
  }
  if (bound !== installationId) {
    return fail(403, 'REPO_NOT_INSTALLED', `${suggestion.repo_full_name} does not belong to that installation`);
  }

  const now = Math.floor(Date.now() / 1000);
  const moved = await applySuggestionTransition(env.DB, {
    suggestionId,
    userId: session.user.id,
    from: suggestion.status,
    to: verdict.to,
    now,
    approvedBy: session.user.id,
  });
  if (!moved) {
    // Someone else moved it between the read and the write. The conditional
    // UPDATE is what noticed; nothing was minted.
    return fail(409, 'ILLEGAL_TRANSITION', 'the suggestion changed state before the approval landed');
  }

  const grantId = await issueBuildGrant(env.DB, {
    suggestionId,
    userId: session.user.id,
    repoFullName: suggestion.repo_full_name,
    installationId,
    issuedBy: session.user.login,
    now,
  });

  if (form) return redirect303('/account/seamanship?notice=approved');
  return json(200, {
    code: 'OK_APPROVED',
    error: null,
    suggestionId,
    status: verdict.to,
    grantId,
    queued: grantId !== null,
  });
}

/**
 * POST /account/seamanship/dismiss — the operator's "no".
 *
 * Legal from 'proposed' and from 'approved'. Dismissing an approved suggestion
 * REVOKES its unspent grant, so the veto beats a build that has not started —
 * which is what makes approval a decision the operator can take back rather
 * than a race against the next sweep.
 */
export async function handleSnipeDismiss(request: Request, env: Env): Promise<Response> {
  const form = isFormPost(request);
  const fail = (status: number, code: string, error: string): Response => {
    if (!form) return json(status, { code, error });
    if (code === 'UNAUTHENTICATED') return redirect303('/login');
    return redirect303(`/account/seamanship?notice=${encodeURIComponent(code.toLowerCase())}`);
  };

  const session = await resolveSession(request, env);
  if (!session) return fail(401, 'UNAUTHENTICATED', 'no session');
  if (!isSameOrigin(request, env)) return fail(403, 'CROSS_ORIGIN', 'cross-origin request refused');

  const body = await readActionBody(request, form);
  const suggestionId = typeof body?.suggestionId === 'string' ? body.suggestionId.trim() : '';
  if (!SUGGESTION_ID_RE.test(suggestionId)) return fail(400, 'BAD_REQUEST', 'suggestionId required');

  const suggestion = await getSuggestion(env.DB, session.user.id, suggestionId);
  if (!suggestion) return fail(404, 'NOT_FOUND', 'no such suggestion');

  const verdict = nextStatus(suggestion.status, 'dismiss');
  if (!verdict.ok) return fail(409, 'ILLEGAL_TRANSITION', verdict.reason);

  const now = Math.floor(Date.now() / 1000);
  // Revoke FIRST: if the process dies between the two writes, a revoked grant
  // on a still-approved suggestion is a build that will not run — the safe
  // half-state. The reverse order would leave a dismissed suggestion holding a
  // live build capability.
  const revoked = await revokeBuildGrant(env.DB, suggestionId, now);
  const moved = await applySuggestionTransition(env.DB, {
    suggestionId,
    userId: session.user.id,
    from: suggestion.status,
    to: verdict.to,
    now,
  });
  if (!moved) return fail(409, 'ILLEGAL_TRANSITION', 'the suggestion changed state before the dismissal landed');

  if (form) return redirect303('/account/seamanship?notice=dismissed');
  return json(200, { code: 'OK_DISMISSED', error: null, suggestionId, status: verdict.to, revokedGrant: revoked });
}

/**
 * POST /account/seamanship/suggest — ask the Engineman for a fresh run.
 *
 * Records the admission receipt and returns. The run itself is drained by the
 * sweep, so a request never waits on a generator, and a run that loses its
 * isolate is visible as a stuck row rather than as nothing.
 */
export async function handleSnipeSuggest(request: Request, env: Env): Promise<Response> {
  const form = isFormPost(request);
  const fail = (status: number, code: string, error: string): Response => {
    if (!form) return json(status, { code, error });
    if (code === 'UNAUTHENTICATED') return redirect303('/login');
    return redirect303(`/account/seamanship?notice=${encodeURIComponent(code.toLowerCase())}`);
  };

  const session = await resolveSession(request, env);
  if (!session) return fail(401, 'UNAUTHENTICATED', 'no session');
  if (!isSameOrigin(request, env)) return fail(403, 'CROSS_ORIGIN', 'cross-origin request refused');

  const body = await readActionBody(request, form);
  const repoFullName = typeof body?.repo === 'string' ? body.repo.trim() : '';
  if (!REPO_FULL_NAME_RE.test(repoFullName)) return fail(400, 'BAD_REQUEST', "repo must be 'owner/name'");

  const outcome = await enqueueSuggestionJob(env.DB, {
    userId: session.user.id,
    repoFullName,
    now: Math.floor(Date.now() / 1000),
  });
  if (!outcome.ok) return fail(outcome.code === 'ALREADY_QUEUED' ? 409 : 400, outcome.code, outcome.error);

  if (form) return redirect303('/account/seamanship?notice=queued');
  return json(202, { code: 'OK_QUEUED', error: null, jobId: outcome.jobId });
}

/** GET /v1/seamanship/suggestions?repo=owner/name — this account's own rows. */
export async function handleSnipeSuggestionList(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return json(401, { code: 'UNAUTHENTICATED', error: 'no session' });
  const repo = new URL(request.url).searchParams.get('repo')?.trim() ?? '';
  if (!REPO_FULL_NAME_RE.test(repo)) return json(400, { code: 'BAD_REQUEST', error: "repo must be 'owner/name'" });
  const rows = await listSuggestions(env.DB, session.user.id, repo);
  return json(200, { code: 'OK', error: null, suggestions: rows, count: rows.length });
}
