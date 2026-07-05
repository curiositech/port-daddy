/**
 * Roadmap command handler for the fleet comment system.
 *
 * Handles issue_comment events. When a PR comment contains
 * `!pd roadmap add all` or `!pd roadmap add 1 3`, this handler:
 *   1. Fetches all fleet ship comments from the PR
 *   2. Parses the <!-- pd-ideas-json ... --> blocks from spider/spark
 *   3. Creates GitHub issues for the requested ideas
 *   4. Replies with a summary of created issues
 */

import type { WebhookEnvelope } from './forward.js';
import type { ExecutorEnv } from './worker.js';
import {
  getInstallationToken,
  fetchFleetComments,
  createGitHubIssue,
  postIssueComment,
} from './github.js';

const ROADMAP_CMD = /!pd\s+roadmap\s+add\s+(all|\d[\d\s]*)/i;
const IDEAS_JSON_RE = /<!-- pd-ideas-json\s*([\s\S]*?)\s*-->/;
const SHIP_TAG_RE = /<!-- pd-ship:([\w-]+) -->/;

interface IdeaEntry {
  n: number;
  title: string;
  body: string;
}

export async function handleRoadmapCommand(
  envelope: WebhookEnvelope,
  env: ExecutorEnv,
): Promise<void> {
  if (envelope.event !== 'issue_comment') return;
  if (envelope.action !== 'created') return;
  if (!envelope.repository || !envelope.installation_id) return;

  const payload = envelope.payload;
  const comment = payload.comment as Record<string, unknown> | undefined;
  const issue = payload.issue as Record<string, unknown> | undefined;
  if (!comment || !issue) return;

  // Only handle PR comments (issues have pull_request key)
  const isPR = !!(issue.pull_request);
  if (!isPR) return;

  const commentBody = (comment.body as string) ?? '';
  const match = ROADMAP_CMD.exec(commentBody);
  if (!match) return;

  // Only privileged repo members may trigger fleet commands.
  // author_association is set by GitHub — it cannot be spoofed by the commenter.
  const assoc = (comment.author_association as string) ?? '';
  if (!['OWNER', 'MEMBER', 'COLLABORATOR'].includes(assoc)) return;

  const [owner, repo] = envelope.repository.full_name.split('/');
  const prNumber = issue.number as number;
  const triggeringCommentId = comment.id as number;

  const token = await getInstallationToken(
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY,
    envelope.installation_id,
  ).catch(() => null);
  if (!token) return;

  // Fetch all fleet comments on this PR (filtered to App-authored only)
  const allComments = await fetchRawFleetComments(owner, repo, prNumber, token, env.GITHUB_APP_ID);

  // Collect ideas from spider and spark comments
  const allIdeas: Array<IdeaEntry & { ship: string }> = [];
  let baseN = 0;
  for (const c of allComments) {
    const ship = SHIP_TAG_RE.exec(c.body)?.[1];
    if (ship !== 'spider' && ship !== 'spark') continue;
    const jsonMatch = IDEAS_JSON_RE.exec(c.body);
    if (!jsonMatch) continue;
    try {
      const ideas = JSON.parse(jsonMatch[1]) as IdeaEntry[];
      for (const idea of ideas) {
        allIdeas.push({ ...idea, n: baseN + idea.n, ship });
      }
      baseN += ideas.length;
    } catch {
      // skip malformed block
    }
  }

  if (allIdeas.length === 0) {
    await postIssueComment(
      owner, repo, prNumber,
      '> !pd roadmap add\n\nNo ideas found yet — spider and spark may still be running, or this PR has no fleet comments.',
      token,
    );
    return;
  }

  // Determine which ideas to create
  const requestStr = match[1].trim().toLowerCase();
  let targets: Array<IdeaEntry & { ship: string }>;
  if (requestStr === 'all') {
    targets = allIdeas;
  } else {
    const requested = new Set(requestStr.split(/\s+/).map(Number).filter(Boolean));
    targets = allIdeas.filter(i => requested.has(i.n));
  }

  if (targets.length === 0) {
    await postIssueComment(
      owner, repo, prNumber,
      `> !pd roadmap add ${match[1]}\n\nNo matching ideas found. Available: ${allIdeas.map(i => `#${i.n}`).join(', ')}.`,
      token,
    );
    return;
  }

  // Create issues one at a time (avoid rate limit)
  const created: Array<{ title: string; url: string }> = [];
  for (const idea of targets) {
    const issueBody =
      `**Source:** pd-${idea.ship} on PR #${prNumber}\n\n` +
      `${idea.body}\n\n` +
      `*Auto-created by Port Daddy Fleet via \`!pd roadmap add\`.*`;
    const result = await createGitHubIssue(
      owner, repo,
      `feat: ${idea.title}`,
      issueBody,
      ['roadmap', 'from-fleet'],
      token,
    );
    if (result) {
      created.push({ title: idea.title, url: result.html_url });
    }
  }

  if (created.length === 0) {
    await postIssueComment(
      owner, repo, prNumber,
      `> !pd roadmap add ${match[1]}\n\nFailed to create issues — GitHub API error. Check fleet logs.`,
      token,
    );
    return;
  }

  const lines = created.map(i => `- [${i.title}](${i.url})`).join('\n');
  await postIssueComment(
    owner, repo, prNumber,
    `> !pd roadmap add ${match[1]}\n\nCreated ${created.length} roadmap issue${created.length === 1 ? '' : 's'}:\n${lines}`,
    token,
  );
}

interface RawComment {
  id: number;
  body: string;
  user: { login: string; type: string };
  performed_via_github_app: { id: number } | null;
}

/** Fetches PR comments and returns only those authored by this GitHub App bot. */
async function fetchRawFleetComments(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
  appId: string,
): Promise<RawComment[]> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'port-daddy-fleet/1.0',
      },
    },
  );
  if (!res.ok) return [];
  const all = (await res.json()) as RawComment[];

  // Only trust idea JSON embedded in comments posted by this GitHub App.
  // A human or third-party bot could otherwise inject arbitrary idea content.
  const numericAppId = parseInt(appId, 10);
  return all.filter(
    c =>
      c.user?.type === 'Bot' &&
      c.performed_via_github_app?.id === numericAppId,
  );
}
