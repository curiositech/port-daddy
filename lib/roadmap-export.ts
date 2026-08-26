/**
 * Roadmap Export — push a roadmap_items row to an external tracker.
 *
 * `roadmap_items` is the DB-of-record (ADR-0033), but plenty of teams still
 * live in GitHub Issues, Linear, or Jira day-to-day. This module is a ONE-WAY
 * export: create (or find-and-return, for a repeat export) the corresponding
 * external issue, and hand back enough to record a typed `issue` link on the
 * roadmap card (`lib/planner-edges.ts`'s `issue` ArtifactType) so the two
 * records stay associated. It deliberately does NOT attempt two-way sync —
 * that's a materially harder problem (webhook plumbing, conflict resolution
 * on edits made in either system) and isn't the ask; "export" is push-once,
 * repeatable, not "keep in sync."
 *
 * Each target implementation takes an injected fetch (same testability
 * pattern as lib/roadmap-snapshot.ts's SnapshotFetch / lib/whois.ts's
 * resolver injection — no live network in unit tests, ever) and is
 * responsible only for its own API's request/response shape. The exported
 * `exportRoadmapItem` dispatcher is the one thing callers (the route, the
 * CLI) need to know about.
 *
 * Idempotency note: none of the three target APIs offer a create-if-absent
 * primitive keyed on our slug, so a repeat export creates a SECOND external
 * issue rather than silently no-op'ing (unlike lib/roadmap-chomp.ts's
 * upsert-by-slug). Callers that want at-most-once semantics should check for
 * an existing `issue` link (`lib/planner-edges.ts`'s `listItemLinks`) before
 * calling this — documented, not enforced here, because "already linked"
 * legitimately has multiple valid responses (skip, re-export anyway, export
 * to a second tracker) that only the caller can decide between.
 */

export type ExportTarget = 'github' | 'linear' | 'jira';

export interface RoadmapExportItem {
  slug: string;
  summaryMd: string;
  descriptionMd: string | null;
  status: string;
  tags: string[];
}

export interface ExportResult {
  target: ExportTarget;
  /** The external system's own id (issue number for GitHub, issue id for Linear/Jira). */
  externalId: string;
  /** A permalink a human can click straight to the created issue. */
  externalUrl: string;
}

/** Structural fetch interface — same minimal shape as lib/roadmap-snapshot.ts's SnapshotFetch. */
export interface ExportFetch {
  (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;
}

export class RoadmapExportError extends Error {
  constructor(target: ExportTarget, message: string) {
    super(`[roadmap-export:${target}] ${message}`);
    this.name = 'RoadmapExportError';
  }
}

function bodyMarkdown(item: RoadmapExportItem): string {
  const parts = [item.descriptionMd?.trim() || item.summaryMd];
  parts.push('', `_Exported from Port Daddy roadmap — slug \`${item.slug}\`, status \`${item.status}\`._`);
  return parts.join('\n');
}

// ─── GitHub Issues ──────────────────────────────────────────────────────────

export interface GitHubExportConfig {
  target: 'github';
  /** `owner/repo`. */
  repo: string;
  /** A token with `repo` scope (or fine-grained Issues: write). Never logged. */
  token: string;
  fetchImpl: ExportFetch;
}

async function exportToGitHub(item: RoadmapExportItem, cfg: GitHubExportConfig): Promise<ExportResult> {
  const [owner, repo] = cfg.repo.split('/');
  if (!owner || !repo) throw new RoadmapExportError('github', `repo must be "owner/repo", got "${cfg.repo}"`);

  const res = await cfg.fetchImpl(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'port-daddy-roadmap-export',
    },
    body: JSON.stringify({
      title: item.summaryMd.slice(0, 256),
      body: bodyMarkdown(item),
      labels: item.tags.length > 0 ? item.tags : undefined,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new RoadmapExportError('github', `HTTP ${res.status} creating issue: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { number?: number; html_url?: string };
  if (typeof data.number !== 'number' || !data.html_url) {
    throw new RoadmapExportError('github', `unexpected response shape: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { target: 'github', externalId: String(data.number), externalUrl: data.html_url };
}

// ─── Linear ─────────────────────────────────────────────────────────────────

export interface LinearExportConfig {
  target: 'linear';
  /** The Linear team id (not the human-readable key) to file the issue under. */
  teamId: string;
  /** A personal API key or OAuth token with issue-create scope. */
  token: string;
  fetchImpl: ExportFetch;
}

const LINEAR_CREATE_ISSUE_MUTATION = `
  mutation PortDaddyCreateIssue($teamId: String!, $title: String!, $description: String!) {
    issueCreate(input: { teamId: $teamId, title: $title, description: $description }) {
      success
      issue { id identifier url }
    }
  }
`;

async function exportToLinear(item: RoadmapExportItem, cfg: LinearExportConfig): Promise<ExportResult> {
  const res = await cfg.fetchImpl('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: cfg.token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: LINEAR_CREATE_ISSUE_MUTATION,
      variables: { teamId: cfg.teamId, title: item.summaryMd.slice(0, 255), description: bodyMarkdown(item) },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new RoadmapExportError('linear', `HTTP ${res.status} creating issue: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    errors?: Array<{ message: string }>;
    data?: { issueCreate?: { success?: boolean; issue?: { id?: string; identifier?: string; url?: string } } };
  };
  if (data.errors?.length) {
    throw new RoadmapExportError('linear', `GraphQL error: ${data.errors.map((e) => e.message).join('; ')}`);
  }
  const issue = data.data?.issueCreate?.issue;
  if (!data.data?.issueCreate?.success || !issue?.id || !issue.url) {
    throw new RoadmapExportError('linear', `unexpected response shape: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { target: 'linear', externalId: issue.identifier ?? issue.id, externalUrl: issue.url };
}

// ─── Jira ───────────────────────────────────────────────────────────────────

export interface JiraExportConfig {
  target: 'jira';
  /** e.g. "https://your-org.atlassian.net" — no trailing slash required. */
  baseUrl: string;
  /** The project key issues are filed under, e.g. "ROAD". */
  projectKey: string;
  /** Atlassian account email, paired with an API token (Jira Cloud basic auth). */
  email: string;
  apiToken: string;
  /** Issue type name as configured in the target project. Defaults to "Task". */
  issueType?: string;
  fetchImpl: ExportFetch;
}

/** Jira Cloud's Atlassian Document Format wants a doc node, not a markdown string. */
function jiraDescriptionDoc(markdown: string) {
  return {
    type: 'doc',
    version: 1,
    content: markdown.split('\n\n').map((paragraph) => ({
      type: 'paragraph',
      content: paragraph ? [{ type: 'text', text: paragraph }] : [],
    })),
  };
}

async function exportToJira(item: RoadmapExportItem, cfg: JiraExportConfig): Promise<ExportResult> {
  const base = cfg.baseUrl.replace(/\/$/, '');
  const basicAuth = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64');

  const res = await cfg.fetchImpl(`${base}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      fields: {
        project: { key: cfg.projectKey },
        summary: item.summaryMd.slice(0, 255),
        description: jiraDescriptionDoc(bodyMarkdown(item)),
        issuetype: { name: cfg.issueType ?? 'Task' },
        labels: item.tags.length > 0 ? item.tags.map((t) => t.replace(/\s+/g, '-')) : undefined,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new RoadmapExportError('jira', `HTTP ${res.status} creating issue: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { id?: string; key?: string };
  if (!data.key) {
    throw new RoadmapExportError('jira', `unexpected response shape: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { target: 'jira', externalId: data.key, externalUrl: `${base}/browse/${data.key}` };
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

export type ExportConfig = GitHubExportConfig | LinearExportConfig | JiraExportConfig;

export async function exportRoadmapItem(item: RoadmapExportItem, config: ExportConfig): Promise<ExportResult> {
  switch (config.target) {
    case 'github': return exportToGitHub(item, config);
    case 'linear': return exportToLinear(item, config);
    case 'jira': return exportToJira(item, config);
  }
}
