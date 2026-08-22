/**
 * Tests for the approval gate and the skill builder (src/snipe-builder.ts, G′6).
 *
 * THE CLAIM UNDER TEST: no approval ⇒ no build ⇒ no pull request, structurally.
 * Each mechanism is exercised against the REAL schema, because each one is a
 * SQL guarantee and a mock would only prove what the test author believed:
 *
 *   · the capability exists ONLY because an approval created it;
 *   · one approval can mint exactly one capability, ever (PRIMARY KEY);
 *   · claiming is single-use (conditional UPDATE on `consumed_at IS NULL`);
 *   · a dismissal revokes an unspent capability, so the veto beats the sweep;
 *   · the build's OUTPUT IS A PULL REQUEST, and its url lands on the row;
 *   · a build that opens no PR never marks anything built;
 *   · a suggestion that is no longer 'approved' is refused at build time even
 *     when a capability for it is in hand.
 *
 * The GitHub seam is injected, so "opens a pull request" is asserted on the
 * actual arguments — branch, path, file content, base — rather than mocked away.
 */

import { describe, it, expect } from 'vitest';
import {
  MAX_BUILD_ATTEMPTS,
  SNIPE_BRANCH_PREFIX,
  buildSkillPullRequest,
  claimBuildGrant,
  handleSnipeApprove,
  handleSnipeDismiss,
  handleSnipeSuggest,
  handleSnipeSuggestionList,
  issueBuildGrant,
  releaseBuildGrant,
  renderSkillFile,
  revokeBuildGrant,
  runSnipeBuildSweep,
  skillFilePath,
  type BuildDeps,
} from '../src/snipe-builder.js';
import { base64UrlEncode, fromHex, hashHex } from '../src/crypto.js';
import { makeKV, makeTestD1, readSuggestion, seedSession, seedSuggestion, type TestD1 } from './support/d1-sqlite.js';
import type { Env } from '../src/types.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = join(dirname(dirname(fileURLToPath(import.meta.url))), 'src');

const BASE = 'https://relay.example';
const COOKIE = 'sess-value-abc';
const REPO = 'octocat/port-daddy';
const INSTALL = 4242;
const PR_URL = 'https://github.com/octocat/port-daddy/pull/77';

interface OpenPrCall {
  owner: string;
  repo: string;
  baseBranch: string;
  branchName: string;
  files: Record<string, string>;
  prTitle: string;
  prBody: string;
}

function deps(over: Partial<BuildDeps> = {}): { deps: BuildDeps; opened: OpenPrCall[] } {
  const opened: OpenPrCall[] = [];
  return {
    opened,
    deps: {
      installationToken: async () => 'ghs_test_token',
      defaultBranch: async () => 'main',
      openPr: async (m) => {
        opened.push(m as unknown as OpenPrCall);
        return PR_URL;
      },
      newBranch: () => `${SNIPE_BRANCH_PREFIX}fixed`,
      ...over,
    },
  };
}

const WRAP_KEY = 'cc'.repeat(32);

/** Seal a token the way auth-github's sealToken does, so resolveSession opens it. */
async function sealForTest(token: string): Promise<{ enc: string; iv: string }> {
  const key = await crypto.subtle.importKey('raw', fromHex(WRAP_KEY), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)),
  );
  return { enc: base64UrlEncode(ct), iv: base64UrlEncode(iv) };
}

/**
 * An env whose GitHub side is stubbed at two distinct places, because the
 * approval gate consults two distinct authorities and conflating them would
 * hide a real bug:
 *   · `userOwnsInstallation` asks GitHub, with the USER's token, which
 *     installations this person owns — stubbed at `fetch`.
 *   · `getRepoInstallationId` asks which installation serves the repo —
 *     answered here from a pre-seeded KV entry, the cache the real path reads.
 */
function makeEnv(t: TestD1, over: Record<string, unknown> = {}, repoBoundTo: number = INSTALL): Env {
  return {
    DB: t.db,
    KV: makeKV({ [`github_repo_inst_octocat_port-daddy`]: String(repoBoundTo) }),
    PUBLIC_BASE_URL: BASE,
    USER_TOKEN_WRAPPING_KEY: WRAP_KEY,
    GITHUB_APP_ID: '123',
    GITHUB_APP_PRIVATE_KEY: 'pem',
    ...over,
  } as unknown as Env;
}

/** Answer GET /user/installations — the only network call these paths make. */
function stubGithub(ownsInstallation = true): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/user/installations')) {
      return new Response(
        JSON.stringify({ installations: ownsInstallation ? [{ id: INSTALL, account: { login: 'octocat' } }] : [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

function post(path: string, body: unknown, withCookie = true): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (withCookie) headers.set('Cookie', `__Host-pd_session=${COOKIE}`);
  return new Request(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

/** A browser form POST (urlencoded), which is what makes isFormPost true. */
function formPost(path: string, fields: Record<string, string>): Request {
  const headers = new Headers({
    'Content-Type': 'application/x-www-form-urlencoded',
    Cookie: `__Host-pd_session=${COOKIE}`,
    Origin: BASE,
  });
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: new URLSearchParams(fields).toString(),
  });
}

async function seeded(
  status = 'proposed',
  repoBoundTo: number = INSTALL,
): Promise<{ t: TestD1; env: Env; userId: string }> {
  const t = makeTestD1();
  const { userId } = seedSession(t, { tokenHash: hashHex(COOKIE), sealed: await sealForTest('gho_user_token') });
  seedSuggestion(t, { id: 'sug_a1b2', userId, repo: REPO, skillName: 'migration-backfill-verify', status });
  return { t, env: makeEnv(t, {}, repoBoundTo), userId };
}

// ── The authored artifact ────────────────────────────────────────────────────

describe('snipe builder — the file it authors', () => {
  const file = renderSkillFile({
    skillName: 'migration-backfill-verify',
    description: 'Walks a migration, its backfill and its verification as one dance.',
    rationale: 'Three PRs hand-rolled the same three-step dance.',
    owner: 'octocat',
    repoFullName: REPO,
  });

  it('carries provenance frontmatter: owner, repos, and the narrowest tier', () => {
    expect(file.startsWith('---\n')).toBe(true);
    expect(file).toContain('name: migration-backfill-verify');
    expect(file).toContain("owner: 'octocat'");
    expect(file).toContain("  - 'octocat/port-daddy'");
    expect(file).toContain('visibility: private');
  });

  it('NEVER emits a wider tier — publishing is the author’s later act, not the builder’s', () => {
    expect(file).not.toMatch(/^visibility:\s*(listed|public)/m);
  });

  it('lands at skills/<id>/SKILL.md and nowhere else', () => {
    expect(skillFilePath('migration-backfill-verify')).toBe('skills/migration-backfill-verify/SKILL.md');
  });

  it('is byte-identical for identical inputs — no clock, no randomness', () => {
    const again = renderSkillFile({
      skillName: 'migration-backfill-verify',
      description: 'Walks a migration, its backfill and its verification as one dance.',
      rationale: 'Three PRs hand-rolled the same three-step dance.',
      owner: 'octocat',
      repoFullName: REPO,
    });
    expect(again).toBe(file);
  });

  it('a description containing a quote cannot break out of its YAML scalar', () => {
    const risky = renderSkillFile({
      skillName: 'x-thing',
      description: "it's tricky: not for 'other' things",
      rationale: 'r',
      owner: 'o',
      repoFullName: REPO,
    });
    expect(risky).toContain("description: 'it''s tricky: not for ''other'' things'");
  });
});

// ── The capability is unforgeable ────────────────────────────────────────────

describe('snipe builder — the capability cannot be forged', () => {
  // `tsc` refuses a hand-written BuildGrant ("Property '[BUILD_GRANT_BRAND]' is
  // missing"), which is the real guarantee. The relay's build script only
  // typechecks src/, so that compile error is not a gate on this test file —
  // these read the source instead, and fail if a refactor ever makes the brand
  // nameable from outside the module.
  const source = readFileSync(join(SRC_DIR, 'snipe-builder.ts'), 'utf8');

  it('the brand is a module-private unique symbol', () => {
    expect(source).toMatch(/declare const BUILD_GRANT_BRAND: unique symbol;/);
  });

  it('the brand is NOT exported — no outside module can name it', () => {
    expect(source).not.toMatch(/export\s+(declare\s+)?const BUILD_GRANT_BRAND/);
    expect(source).not.toMatch(/export\s*\{[^}]*BUILD_GRANT_BRAND/);
  });

  it('BuildGrant carries the brand, so a plain object literal cannot satisfy it', () => {
    expect(source).toMatch(/interface BuildGrant \{\s*\n\s*readonly \[BUILD_GRANT_BRAND\]: true;/);
  });

  it('claimBuildGrant is the only function that returns one', () => {
    const producers = source.match(/:\s*Promise<BuildGrant \| null>|\):\s*BuildGrant\b/g) ?? [];
    expect(producers).toHaveLength(1);
    expect(source).toMatch(/export async function claimBuildGrant[\s\S]*?Promise<BuildGrant \| null>/);
  });

  it('the builder REQUIRES one — its signature takes a grant, never a suggestion id', () => {
    expect(source).toMatch(/export async function buildSkillPullRequest\(\s*\n\s*env: Env,\s*\n\s*grant: BuildGrant,/);
  });
});

// ── The capability ───────────────────────────────────────────────────────────

describe('snipe builder — the build capability', () => {
  it('one suggestion can mint exactly one grant, ever', async () => {
    const { t, userId } = await seeded();
    try {
      const first = await issueBuildGrant(t.db, {
        suggestionId: 'sug_a1b2', userId, repoFullName: REPO, installationId: INSTALL, issuedBy: 'octocat', now: 1,
      });
      expect(first).toMatch(/^grant_/);
      const second = await issueBuildGrant(t.db, {
        suggestionId: 'sug_a1b2', userId, repoFullName: REPO, installationId: INSTALL, issuedBy: 'octocat', now: 2,
      });
      expect(second).toBeNull();
      const n = t.raw.prepare('SELECT COUNT(*) AS n FROM seamanship_build_grants').get() as { n: number };
      expect(n.n).toBe(1);
    } finally {
      t.close();
    }
  });

  it('a claim is single-use: the second call gets nothing', async () => {
    const { t, userId } = await seeded();
    try {
      const grantId = (await issueBuildGrant(t.db, {
        suggestionId: 'sug_a1b2', userId, repoFullName: REPO, installationId: INSTALL, issuedBy: 'octocat', now: 1,
      })) as string;
      expect(await claimBuildGrant(t.db, grantId, 10)).not.toBeNull();
      expect(await claimBuildGrant(t.db, grantId, 11)).toBeNull();
    } finally {
      t.close();
    }
  });

  it('a revoked grant cannot be claimed — the veto beats the sweep', async () => {
    const { t, userId } = await seeded();
    try {
      const grantId = (await issueBuildGrant(t.db, {
        suggestionId: 'sug_a1b2', userId, repoFullName: REPO, installationId: INSTALL, issuedBy: 'octocat', now: 1,
      })) as string;
      expect(await revokeBuildGrant(t.db, 'sug_a1b2', 5)).toBe(true);
      expect(await claimBuildGrant(t.db, grantId, 10)).toBeNull();
    } finally {
      t.close();
    }
  });

  it('an already-spent grant cannot be revoked, so a dismissal cannot un-open a PR', async () => {
    const { t, userId } = await seeded();
    try {
      const grantId = (await issueBuildGrant(t.db, {
        suggestionId: 'sug_a1b2', userId, repoFullName: REPO, installationId: INSTALL, issuedBy: 'octocat', now: 1,
      })) as string;
      await claimBuildGrant(t.db, grantId, 10);
      expect(await revokeBuildGrant(t.db, 'sug_a1b2', 20)).toBe(false);
    } finally {
      t.close();
    }
  });

  it('a released grant is claimable again, but only within its attempt budget', async () => {
    const { t, userId } = await seeded();
    try {
      const grantId = (await issueBuildGrant(t.db, {
        suggestionId: 'sug_a1b2', userId, repoFullName: REPO, installationId: INSTALL, issuedBy: 'octocat', now: 1,
      })) as string;
      for (let i = 0; i < MAX_BUILD_ATTEMPTS; i += 1) {
        expect(await claimBuildGrant(t.db, grantId, 10 + i)).not.toBeNull();
        await releaseBuildGrant(t.db, grantId);
      }
      // The budget is spent; no further claim, however many releases happened.
      expect(await claimBuildGrant(t.db, grantId, 99)).toBeNull();
    } finally {
      t.close();
    }
  });
});

// ── The approval act ─────────────────────────────────────────────────────────

describe('snipe builder — approval is the only thing that queues a build', () => {
  it('approving moves the row and mints exactly one grant', async () => {
    const { t, env } = await seeded();
    const restore = stubGithub();
    try {
      const res = await handleSnipeApprove(post('/account/seamanship/approve', {
        suggestionId: 'sug_a1b2', installationId: INSTALL,
      }), env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { code: string; status: string; queued: boolean };
      expect(body).toMatchObject({ code: 'OK_APPROVED', status: 'approved', queued: true });

      const row = readSuggestion(t, 'sug_a1b2');
      expect(row).toMatchObject({ status: 'approved' });
      expect(row?.approved_at).toBeTruthy();
      expect(row?.approved_by).toBeTruthy();

      const grants = t.raw.prepare('SELECT * FROM seamanship_build_grants').all() as Record<string, unknown>[];
      expect(grants).toHaveLength(1);
      expect(grants[0]).toMatchObject({ suggestion_id: 'sug_a1b2', installation_id: INSTALL });
    } finally {
      restore();
      t.close();
    }
  });

  it('NO APPROVAL ⇒ NO GRANT: a proposed suggestion has no pending build', async () => {
    const { t } = await seeded();
    try {
      const n = t.raw.prepare('SELECT COUNT(*) AS n FROM seamanship_build_grants').get() as { n: number };
      expect(n.n).toBe(0);
      const sweep = await runSnipeBuildSweep(makeEnv(t), 100, deps().deps);
      expect(sweep).toMatchObject({ claimed: 0, built: 0, errors: [] });
      expect(readSuggestion(t, 'sug_a1b2')).toMatchObject({ status: 'proposed', pr_url: null });
    } finally {
      t.close();
    }
  });

  it('approving twice mints nothing the second time', async () => {
    const { t, env } = await seeded();
    const restore = stubGithub();
    try {
      await handleSnipeApprove(post('/account/seamanship/approve', { suggestionId: 'sug_a1b2', installationId: INSTALL }), env);
      const again = await handleSnipeApprove(post('/account/seamanship/approve', { suggestionId: 'sug_a1b2', installationId: INSTALL }), env);
      expect(again.status).toBe(409);
      expect(((await again.json()) as { code: string }).code).toBe('ILLEGAL_TRANSITION');
      const n = t.raw.prepare('SELECT COUNT(*) AS n FROM seamanship_build_grants').get() as { n: number };
      expect(n.n).toBe(1);
    } finally {
      restore();
      t.close();
    }
  });

  it('approval requires a session, same-origin, and installation ownership — in that order', async () => {
    const { t, env } = await seeded();
    const restore = stubGithub(false);
    try {
      const anon = await handleSnipeApprove(post('/account/seamanship/approve', { suggestionId: 'sug_a1b2', installationId: INSTALL }, false), env);
      expect(anon.status).toBe(401);

      const headers = new Headers({ 'Content-Type': 'application/json', Origin: 'https://evil.example', Cookie: `__Host-pd_session=${COOKIE}` });
      const xorigin = await handleSnipeApprove(
        new Request(`${BASE}/account/seamanship/approve`, { method: 'POST', headers, body: JSON.stringify({ suggestionId: 'sug_a1b2', installationId: INSTALL }) }),
        env,
      );
      expect(xorigin.status).toBe(403);

      const notOwned = await handleSnipeApprove(post('/account/seamanship/approve', { suggestionId: 'sug_a1b2', installationId: INSTALL }), env);
      expect(notOwned.status).toBe(403);
      expect(((await notOwned.json()) as { code: string }).code).toBe('FORBIDDEN');

      // A relay with no GitHub App refuses here rather than minting a grant it
      // could never spend. The guard sits AFTER session and same-origin, so it
      // never tells an anonymous caller whether this relay is provisioned; the
      // two checks above are what prove that ordering.
      const unconfigured = await handleSnipeApprove(
        post('/account/seamanship/approve', { suggestionId: 'sug_a1b2', installationId: INSTALL }),
        makeEnv(t, { GITHUB_APP_ID: '' }),
      );
      expect(unconfigured.status).toBe(503);
      expect(((await unconfigured.json()) as { code: string }).code).toBe('BUILD_UNCONFIGURED');

      // Nothing moved and nothing was minted by any of those.
      expect(readSuggestion(t, 'sug_a1b2')).toMatchObject({ status: 'proposed' });
      const n = t.raw.prepare('SELECT COUNT(*) AS n FROM seamanship_build_grants').get() as { n: number };
      expect(n.n).toBe(0);
    } finally {
      restore();
      t.close();
    }
  });

  // ── What the BROWSER is told ──────────────────────────────────────────────
  //
  // The JSON path reports `queued: grantId !== null`. The form path used to
  // redirect `?notice=approved` either way, so a browser operator who clicked
  // Approve was told a build was queued even when no grant was minted and no
  // pull request would ever open. These assert the handler CHOOSES the right
  // notice — the page tests only prove the two notices render differently.

  it('a browser approval that mints a grant says so', async () => {
    const { t, env } = await seeded();
    const restore = stubGithub();
    try {
      const res = await handleSnipeApprove(
        formPost('/account/seamanship/approve', { suggestionId: 'sug_a1b2', installationId: String(INSTALL) }),
        env,
      );
      expect(res.status).toBe(303);
      expect(res.headers.get('Location')).toBe('/account/seamanship?notice=approved');
      const n = t.raw.prepare('SELECT COUNT(*) AS n FROM seamanship_build_grants').get() as { n: number };
      expect(n.n).toBe(1);
    } finally {
      restore();
      t.close();
    }
  });

  it('a browser approval that mints NO grant does not claim it queued a build', async () => {
    // Second approval of the same suggestion: the grants table has
    // suggestion_id as PRIMARY KEY, so issueBuildGrant returns null. The
    // approval still stands; the build does not start. Saying "approved" flat
    // would be a false success on the gate that authorizes a PR into the
    // operator's repo.
    const { t, env } = await seeded();
    const restore = stubGithub();
    try {
      const first = await handleSnipeApprove(
        formPost('/account/seamanship/approve', { suggestionId: 'sug_a1b2', installationId: String(INSTALL) }),
        env,
      );
      expect(first.headers.get('Location')).toBe('/account/seamanship?notice=approved');

      // Put it back to 'proposed' so the transition is legal again, leaving the
      // grant row in place — the exact state where a grant cannot be minted.
      t.raw.prepare("UPDATE seamanship_suggestions SET status = 'proposed' WHERE id = ?").run('sug_a1b2');

      const second = await handleSnipeApprove(
        formPost('/account/seamanship/approve', { suggestionId: 'sug_a1b2', installationId: String(INSTALL) }),
        env,
      );
      expect(second.status).toBe(303);
      expect(second.headers.get('Location')).toBe('/account/seamanship?notice=approved_not_queued');

      // Premise: still exactly one grant, so the second really did mint none.
      const n = t.raw.prepare('SELECT COUNT(*) AS n FROM seamanship_build_grants').get() as { n: number };
      expect(n.n).toBe(1);
    } finally {
      restore();
      t.close();
    }
  });

  it('the repo must resolve to the SAME installation the approver owns', async () => {
    const { t, env } = await seeded('proposed', 9999);
    const restore = stubGithub();
    try {
      const res = await handleSnipeApprove(post('/account/seamanship/approve', { suggestionId: 'sug_a1b2', installationId: INSTALL }), env);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe('REPO_NOT_INSTALLED');
      expect(readSuggestion(t, 'sug_a1b2')).toMatchObject({ status: 'proposed' });
    } finally {
      restore();
      t.close();
    }
  });

  it('another account’s suggestion is 404, byte-identical to one that never existed', async () => {
    const { t, env } = await seeded();
    const restore = stubGithub();
    try {
      const mine = await handleSnipeApprove(post('/account/seamanship/approve', { suggestionId: 'sug_ffff', installationId: INSTALL }), env);
      expect(mine.status).toBe(404);
      const mineBody = await mine.text();

      t.raw.prepare('INSERT INTO users (id, github_user_id, login, created_at, email_verified) VALUES (?, 77, ?, ?, 0)').run('u_other', 'other', 1);
      seedSuggestion(t, { id: 'sug_dddd', userId: 'u_other', repo: REPO, skillName: 'theirs' });
      const theirs = await handleSnipeApprove(post('/account/seamanship/approve', { suggestionId: 'sug_dddd', installationId: INSTALL }), env);
      expect(theirs.status).toBe(404);
      expect(await theirs.text()).toBe(mineBody);
    } finally {
      restore();
      t.close();
    }
  });
});

// ── Dismissal ────────────────────────────────────────────────────────────────

describe('snipe builder — dismissal', () => {
  it('dismissing an approved suggestion revokes its pending build', async () => {
    const { t, env } = await seeded();
    const restore = stubGithub();
    try {
      await handleSnipeApprove(post('/account/seamanship/approve', { suggestionId: 'sug_a1b2', installationId: INSTALL }), env);
      const res = await handleSnipeDismiss(post('/account/seamanship/dismiss', { suggestionId: 'sug_a1b2' }), env);
      expect(res.status).toBe(200);
      expect((await res.json()) as { revokedGrant: boolean }).toMatchObject({ revokedGrant: true });

      const sweep = await runSnipeBuildSweep(makeEnv(t), 100, deps().deps);
      expect(sweep).toMatchObject({ claimed: 0, built: 0 });
      expect(readSuggestion(t, 'sug_a1b2')).toMatchObject({ status: 'dismissed', pr_url: null });
    } finally {
      restore();
      t.close();
    }
  });

  it('a dismissed suggestion cannot then be approved', async () => {
    const { t, env } = await seeded();
    const restore = stubGithub();
    try {
      await handleSnipeDismiss(post('/account/seamanship/dismiss', { suggestionId: 'sug_a1b2' }), env);
      const res = await handleSnipeApprove(post('/account/seamanship/approve', { suggestionId: 'sug_a1b2', installationId: INSTALL }), env);
      expect(res.status).toBe(409);
      const n = t.raw.prepare('SELECT COUNT(*) AS n FROM seamanship_build_grants').get() as { n: number };
      expect(n.n).toBe(0);
    } finally {
      restore();
      t.close();
    }
  });
});

// ── The build ────────────────────────────────────────────────────────────────

describe('snipe builder — the output is a pull request', () => {
  it('builds an approved suggestion into a PR and stores its url on the row', async () => {
    const { t, env } = await seeded();
    const restore = stubGithub();
    const d = deps();
    try {
      await handleSnipeApprove(post('/account/seamanship/approve', { suggestionId: 'sug_a1b2', installationId: INSTALL }), env);
      const sweep = await runSnipeBuildSweep(makeEnv(t), 500, d.deps);
      expect(sweep).toMatchObject({ claimed: 1, built: 1, failed: 0, errors: [] });

      // The PR is real, and shaped the way the contract says.
      expect(d.opened).toHaveLength(1);
      const call = d.opened[0] as OpenPrCall;
      expect(call).toMatchObject({ owner: 'octocat', repo: 'port-daddy', baseBranch: 'main' });
      expect(call.branchName.startsWith(SNIPE_BRANCH_PREFIX)).toBe(true);
      expect(Object.keys(call.files)).toEqual(['skills/migration-backfill-verify/SKILL.md']);
      expect(call.files['skills/migration-backfill-verify/SKILL.md']).toContain('visibility: private');
      expect(call.prTitle).toContain('migration-backfill-verify');
      expect(call.prBody).toContain('approved');

      // ...and the row links back to it.
      const row = readSuggestion(t, 'sug_a1b2');
      expect(row).toMatchObject({ status: 'built', pr_url: PR_URL, build_error: null });
    } finally {
      restore();
      t.close();
    }
  });

  it('a second sweep does not open a second PR', async () => {
    const { t, env } = await seeded();
    const restore = stubGithub();
    const d = deps();
    try {
      await handleSnipeApprove(post('/account/seamanship/approve', { suggestionId: 'sug_a1b2', installationId: INSTALL }), env);
      await runSnipeBuildSweep(makeEnv(t), 500, d.deps);
      const again = await runSnipeBuildSweep(makeEnv(t), 600, d.deps);
      expect(again).toMatchObject({ claimed: 0, built: 0 });
      expect(d.opened).toHaveLength(1);
    } finally {
      restore();
      t.close();
    }
  });

  it('a failed PR call leaves the row APPROVED with a legible error — never built', async () => {
    const { t, env } = await seeded();
    const restore = stubGithub();
    const d = deps({ openPr: async () => { throw new Error('GitHub said no'); } });
    try {
      await handleSnipeApprove(post('/account/seamanship/approve', { suggestionId: 'sug_a1b2', installationId: INSTALL }), env);
      const sweep = await runSnipeBuildSweep(makeEnv(t), 500, d.deps);
      expect(sweep).toMatchObject({ claimed: 1, built: 0, failed: 1, released: 0 });
      const row = readSuggestion(t, 'sug_a1b2');
      expect(row).toMatchObject({ status: 'approved', pr_url: null });
      expect(String(row?.build_error)).toContain('pull request failed');
    } finally {
      restore();
      t.close();
    }
  });

  it('a failure BEFORE GitHub is reached returns the grant to the queue', async () => {
    const { t, env } = await seeded();
    const restore = stubGithub();
    const d = deps({ defaultBranch: async () => { throw new Error('network'); } });
    try {
      await handleSnipeApprove(post('/account/seamanship/approve', { suggestionId: 'sug_a1b2', installationId: INSTALL }), env);
      const sweep = await runSnipeBuildSweep(makeEnv(t), 500, d.deps);
      expect(sweep).toMatchObject({ claimed: 1, built: 0, failed: 1, released: 1 });
      const grant = t.raw.prepare('SELECT consumed_at, attempts FROM seamanship_build_grants').get() as {
        consumed_at: number | null; attempts: number;
      };
      expect(grant.consumed_at).toBeNull();
      expect(grant.attempts).toBe(1);
    } finally {
      restore();
      t.close();
    }
  });

  it('a suggestion no longer approved is refused at build time even with a grant in hand', async () => {
    const { t, userId } = await seeded('approved');
    const d = deps();
    try {
      await issueBuildGrant(t.db, {
        suggestionId: 'sug_a1b2', userId, repoFullName: REPO, installationId: INSTALL, issuedBy: 'octocat', now: 1,
      });
      // The row is walked back out from under the capability.
      t.raw.prepare("UPDATE seamanship_suggestions SET status='dismissed' WHERE id='sug_a1b2'").run();
      const sweep = await runSnipeBuildSweep(makeEnv(t), 500, d.deps);
      expect(sweep).toMatchObject({ claimed: 1, built: 0, failed: 1 });
      expect(d.opened).toHaveLength(0);
      expect(readSuggestion(t, 'sug_a1b2')).toMatchObject({ status: 'dismissed', pr_url: null });
    } finally {
      t.close();
    }
  });

  it('the builder refuses to run when the GitHub App is not provisioned', async () => {
    const { t, userId } = await seeded('approved');
    try {
      const grantId = (await issueBuildGrant(t.db, {
        suggestionId: 'sug_a1b2', userId, repoFullName: REPO, installationId: INSTALL, issuedBy: 'octocat', now: 1,
      })) as string;
      const grant = await claimBuildGrant(t.db, grantId, 2);
      expect(grant).not.toBeNull();
      const row = readSuggestion(t, 'sug_a1b2') as never;
      const bare = { DB: t.db, KV: {} } as unknown as Env;
      const out = await buildSkillPullRequest(bare, grant!, row, 'octocat', deps().deps);
      expect(out).toMatchObject({ ok: false, retryable: true });
      if (!out.ok) expect(out.error).toContain('BUILD_UNCONFIGURED');
    } finally {
      t.close();
    }
  });
});

// ── The suggestion-run request + read surface ────────────────────────────────

describe('snipe builder — the surrounding surface', () => {
  it('queueing a suggestion run records an admission receipt and 202s', async () => {
    const { t, env } = await seeded();
    try {
      const res = await handleSnipeSuggest(post('/account/seamanship/suggest', { repo: REPO }), env);
      expect(res.status).toBe(202);
      expect(((await res.json()) as { code: string }).code).toBe('OK_QUEUED');
      const jobs = t.raw.prepare('SELECT state, repo_full_name FROM seamanship_suggestion_jobs').all();
      expect(jobs).toEqual([{ state: 'queued', repo_full_name: REPO }]);
    } finally {
      t.close();
    }
  });

  it('a second run for a repo already in flight is 409, not a race', async () => {
    const { t, env } = await seeded();
    try {
      await handleSnipeSuggest(post('/account/seamanship/suggest', { repo: REPO }), env);
      const again = await handleSnipeSuggest(post('/account/seamanship/suggest', { repo: REPO }), env);
      expect(again.status).toBe(409);
    } finally {
      t.close();
    }
  });

  it('a malformed repo never reaches the database', async () => {
    const { t, env } = await seeded();
    try {
      const res = await handleSnipeSuggest(post('/account/seamanship/suggest', { repo: '../../etc/passwd' }), env);
      expect(res.status).toBe(400);
      const n = t.raw.prepare('SELECT COUNT(*) AS n FROM seamanship_suggestion_jobs').get() as { n: number };
      expect(n.n).toBe(0);
    } finally {
      t.close();
    }
  });

  it('the read surface serves only the signed-in account’s rows', async () => {
    const { t, env } = await seeded();
    try {
      t.raw.prepare('INSERT INTO users (id, github_user_id, login, created_at, email_verified) VALUES (?, 88, ?, ?, 0)').run('u_other', 'other', 1);
      seedSuggestion(t, { id: 'sug_eeee', userId: 'u_other', repo: REPO, skillName: 'not-yours' });
      const res = await handleSnipeSuggestionList(
        new Request(`${BASE}/v1/seamanship/suggestions?repo=${encodeURIComponent(REPO)}`, {
          headers: { Cookie: `__Host-pd_session=${COOKIE}` },
        }),
        env,
      );
      const body = (await res.json()) as { suggestions: { id: string }[]; count: number };
      expect(body.count).toBe(1);
      expect(body.suggestions[0]?.id).toBe('sug_a1b2');
    } finally {
      t.close();
    }
  });
});
