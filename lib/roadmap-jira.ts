/**
 * Read-only Jira Cloud roadmap projection.
 *
 * Port Daddy's local roadmap remains its own authority. This reader projects
 * the operator's Jira project beside it without pretending the two stores are
 * synchronized. Credentials and project configuration come from the managed
 * keychain allow-list; response objects never contain either credential.
 */

import { createHash } from 'node:crypto';

export const JIRA_CONFIG_KEYS = Object.freeze([
  'PD_JIRA_BASE_URL',
  'PD_JIRA_PROJECT_KEY',
  'PD_JIRA_EMAIL',
  'PD_JIRA_API_TOKEN',
] as const);

export type JiraConfigKey = (typeof JIRA_CONFIG_KEYS)[number];
export type JiraSecretReader = (key: JiraConfigKey) => string | undefined;

export interface JiraRoadmapConfig {
  baseUrl: string;
  projectKey: string;
  email: string;
  apiToken: string;
}

export interface JiraRoadmapIssue {
  source: 'jira';
  id: string;
  key: string;
  url: string;
  summary: string;
  status: string;
  statusCategory: string;
  priority: string;
  assignee: string | null;
  issueType: string;
  parentKey: string | null;
  labels: string[];
  created: string | null;
  updated: string | null;
  dueDate: string | null;
}

export interface JiraRoadmapResult {
  source: 'jira';
  projectKey: string;
  baseUrl: string;
  fetchedAt: number;
  cached: boolean;
  pageCount: number;
  truncated: boolean;
  issues: JiraRoadmapIssue[];
}

export interface JiraFetchResponse {
  ok: boolean;
  status: number;
  headers?: {
    get(name: string): string | null;
  };
  json(): Promise<unknown>;
}

export interface JiraFetch {
  (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }): Promise<JiraFetchResponse>;
}

export class JiraRoadmapError extends Error {
  constructor(message: string) {
    super(`[roadmap-jira] ${message}`);
    this.name = 'JiraRoadmapError';
  }
}

export type JiraConfigState =
  | { configured: true; config: JiraRoadmapConfig; missing: [] }
  | { configured: false; missing: JiraConfigKey[] };

function requiredValue(reader: JiraSecretReader, key: JiraConfigKey): string | undefined {
  const value = reader(key)?.trim();
  return value || undefined;
}

/** Resolve the complete Jira configuration, reporting exact missing keys. */
export function jiraConfigFromSecrets(reader: JiraSecretReader): JiraConfigState {
  const values = new Map<JiraConfigKey, string>();
  const missing: JiraConfigKey[] = [];
  for (const key of JIRA_CONFIG_KEYS) {
    const value = requiredValue(reader, key);
    if (value) values.set(key, value);
    else missing.push(key);
  }
  if (missing.length > 0) return { configured: false, missing };

  return {
    configured: true,
    missing: [],
    config: normalizeJiraConfig({
      baseUrl: values.get('PD_JIRA_BASE_URL')!,
      projectKey: values.get('PD_JIRA_PROJECT_KEY')!,
      email: values.get('PD_JIRA_EMAIL')!,
      apiToken: values.get('PD_JIRA_API_TOKEN')!,
    }),
  };
}

/** Validate URL/project identity before either value enters a request. */
export function normalizeJiraConfig(config: JiraRoadmapConfig): JiraRoadmapConfig {
  let parsed: URL;
  try {
    parsed = new URL(config.baseUrl.trim());
  } catch {
    throw new JiraRoadmapError('PD_JIRA_BASE_URL must be a valid HTTPS URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new JiraRoadmapError('PD_JIRA_BASE_URL must be HTTPS and must not contain credentials');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new JiraRoadmapError('PD_JIRA_BASE_URL must name the Jira origin, without a path');
  }
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';

  const projectKey = config.projectKey.trim().toUpperCase();
  // Jira project keys begin with a letter and contain only letters/digits/_;
  // constraining the value also makes the generated JQL non-injectable.
  if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(projectKey)) {
    throw new JiraRoadmapError('PD_JIRA_PROJECT_KEY must be 2-32 letters, digits, or underscores and start with a letter');
  }
  const email = config.email.trim();
  const apiToken = config.apiToken.trim();
  if (!email || !apiToken) throw new JiraRoadmapError('Jira email and API token are required');

  return {
    baseUrl: parsed.origin,
    projectKey,
    email,
    apiToken,
  };
}

interface JiraSearchPage {
  issues?: unknown;
  nextPageToken?: unknown;
  isLast?: unknown;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableText(value: unknown): string | null {
  const valueText = text(value).trim();
  return valueText || null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseIssue(raw: unknown, baseUrl: string): JiraRoadmapIssue | null {
  const issue = record(raw);
  const id = text(issue.id);
  const key = text(issue.key);
  if (!id || !key) return null;
  const fields = record(issue.fields);
  const status = record(fields.status);
  const statusCategory = record(status.statusCategory);
  const priority = record(fields.priority);
  const assignee = record(fields.assignee);
  const issueType = record(fields.issuetype);
  const parent = record(fields.parent);
  const labels = Array.isArray(fields.labels)
    ? fields.labels.filter((label): label is string => typeof label === 'string')
    : [];

  return {
    source: 'jira',
    id,
    key,
    url: `${baseUrl}/browse/${encodeURIComponent(key)}`,
    summary: text(fields.summary),
    status: text(status.name),
    statusCategory: text(statusCategory.name),
    priority: text(priority.name),
    assignee: nullableText(assignee.displayName),
    issueType: text(issueType.name),
    parentKey: nullableText(parent.key),
    labels,
    created: nullableText(fields.created),
    updated: nullableText(fields.updated),
    dueDate: nullableText(fields.duedate),
  };
}

export interface JiraRoadmapReader {
  read(config: JiraRoadmapConfig): Promise<JiraRoadmapResult>;
  clear(): void;
}

export interface JiraRoadmapReaderOptions {
  fetchImpl?: JiraFetch;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  ttlMs?: number;
  maxPages?: number;
  maxIssues?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  maxRetryDelayMs?: number;
  requestTimeoutMs?: number;
}

function retryAfterMs(response: JiraFetchResponse, nowMs: number): number | undefined {
  const value = response.headers?.get('retry-after')?.trim();
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);

  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : undefined;
}

/**
 * Create a bounded, exact-response reader. The short cache prevents duplicate
 * refreshes from multiple console panes; in-flight coalescing prevents a
 * refresh burst from multiplying Jira requests. Cache identity includes a
 * one-way account digest because different Jira accounts may see different
 * issues in the same project.
 */
export function createJiraRoadmapReader(options: JiraRoadmapReaderOptions = {}): JiraRoadmapReader {
  const fetchImpl: JiraFetch = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  }));
  const ttlMs = options.ttlMs ?? 15_000;
  const maxPages = Math.max(1, options.maxPages ?? 10);
  const maxIssues = Math.max(1, options.maxIssues ?? 1_000);
  const maxRetries = Math.min(4, Math.max(0, Math.trunc(options.maxRetries ?? 2)));
  const retryBaseDelayMs = Math.max(0, options.retryBaseDelayMs ?? 250);
  const maxRetryDelayMs = Math.max(0, options.maxRetryDelayMs ?? 10_000);
  const requestTimeoutMs = Math.min(60_000, Math.max(250, options.requestTimeoutMs ?? 10_000));
  const cache = new Map<string, { expiresAt: number; value: JiraRoadmapResult }>();
  const inflight = new Map<string, Promise<JiraRoadmapResult>>();
  let generation = 0;

  const keyFor = (cfg: JiraRoadmapConfig) => {
    const account = createHash('sha256').update(cfg.email).digest('hex').slice(0, 16);
    return `${cfg.baseUrl}|${cfg.projectKey}|${account}`;
  };

  const readFresh = async (cfg: JiraRoadmapConfig): Promise<JiraRoadmapResult> => {
    const issues: JiraRoadmapIssue[] = [];
    let nextPageToken: string | undefined;
    let pageCount = 0;
    let truncated = false;

    for (let page = 0; page < maxPages && issues.length < maxIssues; page += 1) {
      const body: Record<string, unknown> = {
        // Rank is a Jira Software custom field and is not guaranteed to exist
        // for every project. Use a universal system field for the transport
        // default; the console exposes explicit user-controlled sorting.
        jql: `project = ${cfg.projectKey} ORDER BY updated DESC`,
        fields: [
          'summary', 'status', 'priority', 'assignee', 'issuetype', 'parent',
          'labels', 'created', 'updated', 'duedate',
        ],
        maxResults: Math.min(100, maxIssues - issues.length),
      };
      if (nextPageToken) body.nextPageToken = nextPageToken;

      let response: JiraFetchResponse;
      for (let attempt = 0; ; attempt += 1) {
        try {
          response = await fetchImpl(`${cfg.baseUrl}/rest/api/3/search/jql`, {
            method: 'POST',
            headers: {
              Authorization: `Basic ${Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64')}`,
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'User-Agent': 'port-daddy-roadmap-read',
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(requestTimeoutMs),
          });
        } catch {
          const delayMs = retryBaseDelayMs * (2 ** attempt);
          const canRetry = attempt < maxRetries
            && Number.isFinite(delayMs)
            && delayMs <= maxRetryDelayMs;
          if (!canRetry) {
            throw new JiraRoadmapError('Jira issue search request failed');
          }
          await sleep(delayMs);
          continue;
        }
        if (response.ok) break;

        const transient = response.status === 429
          || response.status === 502
          || response.status === 503
          || response.status === 504;
        const serverDelayMs = retryAfterMs(response, now());
        const delayMs = serverDelayMs ?? retryBaseDelayMs * (2 ** attempt);
        const canRetry = transient
          && attempt < maxRetries
          && Number.isFinite(delayMs)
          && delayMs <= maxRetryDelayMs;
        if (!canRetry) {
          throw new JiraRoadmapError(`Jira issue search returned HTTP ${response.status}`);
        }
        await sleep(delayMs);
      }
      let decoded: unknown;
      try {
        decoded = await response.json();
      } catch {
        throw new JiraRoadmapError('Jira issue search returned invalid JSON');
      }
      const pageData = record(decoded) as JiraSearchPage;
      pageCount += 1;
      if (!Array.isArray(pageData.issues)) {
        throw new JiraRoadmapError('Jira issue search returned an invalid response shape');
      }
      for (const [index, raw] of pageData.issues.entries()) {
        if (issues.length >= maxIssues) {
          truncated = index < pageData.issues.length;
          break;
        }
        const parsed = parseIssue(raw, cfg.baseUrl);
        if (parsed) issues.push(parsed);
      }
      nextPageToken = nullableText(pageData.nextPageToken) ?? undefined;
      if (pageData.isLast === true || !nextPageToken) break;
      if (issues.length >= maxIssues || page + 1 >= maxPages) {
        truncated = true;
        break;
      }
    }

    const fetchedAt = now();
    return {
      source: 'jira',
      projectKey: cfg.projectKey,
      baseUrl: cfg.baseUrl,
      fetchedAt,
      cached: false,
      pageCount,
      truncated,
      issues,
    };
  };

  return {
    async read(config) {
      const cfg = normalizeJiraConfig(config);
      const key = keyFor(cfg);
      const hit = cache.get(key);
      if (hit && hit.expiresAt > now()) return { ...hit.value, cached: true };
      const pending = inflight.get(key);
      if (pending) return pending;

      const requestGeneration = generation;
      const request = readFresh(cfg)
        .then((value) => {
          if (generation === requestGeneration) {
            cache.set(key, { expiresAt: now() + ttlMs, value });
          }
          return value;
        });
      inflight.set(key, request);
      const cleanup = () => {
        if (inflight.get(key) === request) inflight.delete(key);
      };
      void request.then(cleanup, cleanup);
      return request;
    },
    clear() {
      generation += 1;
      cache.clear();
      inflight.clear();
    },
  };
}

export const jiraRoadmapReader = createJiraRoadmapReader();
