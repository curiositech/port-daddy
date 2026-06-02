/**
 * lib/fleet/github-output.ts
 *
 * One primitive for every fleet ship that needs to write to GitHub.
 *
 * Why this exists
 * ────────────────
 * Pre-2026-05-20, fleet ships published findings to pub/sub channels
 * (`port-daddy:fleet:qa`, `notify-findings`, etc.). The operator never
 * read them. Findings died in a SQLite row no human ever opened. That's
 * the failure mode this module ends.
 *
 * Ships now write where the operator already lives: GitHub PR comments,
 * issues, and draft PRs. Channels remain — they're how ships chain to
 * other ships — but they are internal plumbing, not the operator
 * surface.
 *
 * Auth bootstrap
 * ──────────────
 * Today: shells out to `gh` and inherits the operator's auth token.
 * That's the same token that runs `gh pr view` locally. No new
 * credentials to manage.
 *
 * Tomorrow: when the Port Daddy GitHub App lands (sibling work in
 * flight), this module flips to App credentials via `GH_TOKEN` env
 * injected by the daemon. The interface below does not change.
 *
 * One comment per PR per ship
 * ───────────────────────────
 * `postPRComment` with `editIfExists: true` (the default) keeps a
 * marker line at the top of every comment:
 *
 *     <!-- pd-fleet:ship=<name> -->
 *
 * On resync the ship finds its own previous comment by that marker and
 * edits in place. The PR conversation stays scannable; ships don't
 * carpet-bomb 20 comments on a fast-moving branch.
 */

import { spawn } from 'node:child_process';

export interface GitHubOutput {
  /**
   * Post a comment on a pull request. If `editIfExists` (default true),
   * find this ship's existing comment by marker and edit it in place
   * instead of appending a new one.
   */
  postPRComment(
    prNumber: number,
    body: string,
    opts?: { editIfExists?: boolean }
  ): Promise<{ url: string; commentId?: number; edited: boolean }>;

  /**
   * Open a GitHub issue. Idempotent on (title, label) when
   * `dedupeByTitle` is true — re-running the same ship won't duplicate.
   */
  openIssue(
    title: string,
    body: string,
    labels: string[],
    opts?: { dedupeByTitle?: boolean }
  ): Promise<{ number: number; url: string; created: boolean }>;

  /**
   * Open a draft PR from `branchName` against `baseBranch` (default
   * `main`). Caller is responsible for having already pushed the
   * branch with the proposed commits.
   */
  openDraftPR(
    branchName: string,
    title: string,
    body: string,
    baseBranch?: string
  ): Promise<{ number: number; url: string }>;

  /** Close an issue and leave a final comment with `reason`. */
  closeIssue(number: number, reason: string): Promise<void>;
}

export interface GitHubOutputDeps {
  /** The ship's name. Used to scope the comment marker. */
  shipName: string;
  /** Repo in `owner/name` form. Defaults to the cwd's origin. */
  repo?: string;
  /** Optional override for the `gh` binary path (test injection). */
  ghBin?: string;
  /** Optional logger; defaults to no-op. */
  log?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
}

interface GhExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

function commentMarker(shipName: string): string {
  return `<!-- pd-fleet:ship=${shipName} -->`;
}

function execGh(bin: string, args: string[], stdin?: string): Promise<GhExecResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      resolve({ ok: false, stdout, stderr: stderr || String(err), exitCode: -1 });
    });
    child.on('close', (code) => {
      resolve({
        ok: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? -1,
      });
    });
    if (stdin !== undefined) {
      child.stdin.write(stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

export function createGitHubOutput(deps: GitHubOutputDeps): GitHubOutput {
  const ghBin = deps.ghBin ?? 'gh';
  const log = deps.log ?? (() => {});
  const repoFlags = deps.repo ? ['-R', deps.repo] : [];
  const marker = commentMarker(deps.shipName);

  async function findExistingComment(
    prNumber: number
  ): Promise<{ id: number; url: string } | null> {
    const result = await execGh(ghBin, [
      'api',
      ...repoFlags,
      `repos/{owner}/{repo}/issues/${prNumber}/comments`,
      '--paginate',
      '--jq',
      `[.[] | select(.body | contains(${JSON.stringify(marker)})) | {id, url: .html_url}] | first // empty`,
    ]);
    if (!result.ok || !result.stdout) return null;
    try {
      const parsed = JSON.parse(result.stdout);
      if (parsed && typeof parsed.id === 'number') {
        return { id: parsed.id, url: parsed.url };
      }
    } catch {
      log('warn', `findExistingComment: failed to parse gh output`, {
        stdout: result.stdout,
      });
    }
    return null;
  }

  return {
    async postPRComment(prNumber, body, opts) {
      const editIfExists = opts?.editIfExists ?? true;
      const stamped = body.includes(marker) ? body : `${marker}\n\n${body}`;

      if (editIfExists) {
        const existing = await findExistingComment(prNumber);
        if (existing) {
          const result = await execGh(
            ghBin,
            [
              'api',
              '--method',
              'PATCH',
              ...repoFlags,
              `repos/{owner}/{repo}/issues/comments/${existing.id}`,
              '-f',
              'body=@-',
            ],
            stamped
          );
          if (!result.ok) {
            throw new Error(`gh comment edit failed: ${result.stderr}`);
          }
          log('info', `edited PR #${prNumber} comment`, { commentId: existing.id });
          return { url: existing.url, commentId: existing.id, edited: true };
        }
      }

      const result = await execGh(
        ghBin,
        ['pr', 'comment', String(prNumber), ...repoFlags, '--body-file', '-'],
        stamped
      );
      if (!result.ok) {
        throw new Error(`gh pr comment failed: ${result.stderr}`);
      }
      // `gh pr comment` prints the comment URL on stdout
      const url = result.stdout.split('\n').filter(Boolean).pop() ?? '';
      log('info', `posted PR #${prNumber} comment`, { url });
      return { url, edited: false };
    },

    async openIssue(title, body, labels, opts) {
      const dedupeByTitle = opts?.dedupeByTitle ?? true;

      if (dedupeByTitle) {
        // gh issue list will give us anything matching title in open issues
        const search = await execGh(ghBin, [
          'issue',
          'list',
          ...repoFlags,
          '--state',
          'open',
          '--search',
          `in:title "${title.replace(/"/g, '\\"')}"`,
          '--json',
          'number,url,title',
          '--limit',
          '10',
        ]);
        if (search.ok && search.stdout) {
          try {
            const matches = JSON.parse(search.stdout) as Array<{
              number: number;
              url: string;
              title: string;
            }>;
            const exact = matches.find((m) => m.title === title);
            if (exact) {
              log('info', `dedup: issue exists`, exact);
              return { number: exact.number, url: exact.url, created: false };
            }
          } catch (err) {
            log('warn', 'dedup search parse failed', { err: String(err) });
          }
        }
      }

      const args = ['issue', 'create', ...repoFlags, '--title', title, '--body-file', '-'];
      for (const label of labels) {
        args.push('--label', label);
      }
      const result = await execGh(ghBin, args, body);
      if (!result.ok) {
        throw new Error(`gh issue create failed: ${result.stderr}`);
      }
      const url = result.stdout.split('\n').filter(Boolean).pop() ?? '';
      const m = url.match(/\/issues\/(\d+)/);
      const number = m ? parseInt(m[1], 10) : -1;
      log('info', `opened issue #${number}`, { url });
      return { number, url, created: true };
    },

    async openDraftPR(branchName, title, body, baseBranch = 'main') {
      const result = await execGh(
        ghBin,
        [
          'pr',
          'create',
          ...repoFlags,
          '--draft',
          '--base',
          baseBranch,
          '--head',
          branchName,
          '--title',
          title,
          '--body-file',
          '-',
        ],
        body
      );
      if (!result.ok) {
        throw new Error(`gh pr create (draft) failed: ${result.stderr}`);
      }
      const url = result.stdout.split('\n').filter(Boolean).pop() ?? '';
      const m = url.match(/\/pull\/(\d+)/);
      const number = m ? parseInt(m[1], 10) : -1;
      log('info', `opened draft PR #${number}`, { url, branchName });
      return { number, url };
    },

    async closeIssue(number, reason) {
      // Final comment before close so the audit trail records the reason
      if (reason) {
        await execGh(
          ghBin,
          [
            'issue',
            'comment',
            String(number),
            ...repoFlags,
            '--body-file',
            '-',
          ],
          `${marker}\n\n${reason}`
        );
      }
      const result = await execGh(ghBin, ['issue', 'close', String(number), ...repoFlags]);
      if (!result.ok) {
        throw new Error(`gh issue close failed: ${result.stderr}`);
      }
      log('info', `closed issue #${number}`, { reason });
    },
  };
}

/**
 * Severity tiers used by code-reviewer, red-team, qa, and tautology-sniffer.
 *
 *   HIGH    blocking; tag @erichowens; cite a line or ADR
 *   MEDIUM  resolve before merge; doesn't block, but Erich reads these
 *   LOW     queue; cluster these — don't post one comment per LOW
 *   SCOPE   "out of scope for this PR but worth tracking" → opens an issue,
 *           not a comment
 *
 * The voice rule (operator memory `port-daddy-expository-writer`): no
 * corporate evenness. If there's nothing worth saying, say nothing. "Looks
 * good" comments are forbidden.
 */
export type FindingSeverity = 'HIGH' | 'MEDIUM' | 'LOW' | 'SCOPE';

export interface Finding {
  severity: FindingSeverity;
  title: string;
  body: string;
  /** Optional `path:line` reference. HIGH findings MUST cite a line or ADR. */
  cite?: string;
  /** Optional ADR number. */
  adr?: number;
}

/**
 * Render a list of findings as a single PR comment body. Sorts HIGH →
 * MEDIUM → LOW; drops SCOPE (those are issues, not comments). Returns
 * null if the resulting comment would be empty — never post padding.
 */
export function renderFindingsComment(
  shipName: string,
  findings: Finding[]
): string | null {
  const rank: Record<FindingSeverity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, SCOPE: 3 };
  const inline = findings.filter((f) => f.severity !== 'SCOPE');
  if (inline.length === 0) return null;
  inline.sort((a, b) => rank[a.severity] - rank[b.severity]);

  const sections = inline.map((f) => {
    const head =
      f.severity === 'HIGH'
        ? `### HIGH — ${f.title} @erichowens`
        : `### ${f.severity} — ${f.title}`;
    const meta: string[] = [];
    if (f.cite) meta.push(`\`${f.cite}\``);
    if (f.adr) meta.push(`[ADR-${String(f.adr).padStart(4, '0')}](docs/adr/)`);
    const metaLine = meta.length ? `\n${meta.join(' · ')}\n` : '';
    return `${head}\n${metaLine}\n${f.body.trim()}`;
  });

  return [`_${shipName} review_`, '', ...sections].join('\n\n');
}
