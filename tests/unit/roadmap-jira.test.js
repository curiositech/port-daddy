import {
  JIRA_CONFIG_KEYS,
  JiraRoadmapError,
  createJiraRoadmapReader,
  jiraConfigFromSecrets,
  normalizeJiraConfig,
} from '../../lib/roadmap-jira.js';

const CONFIG = {
  baseUrl: 'https://acme.atlassian.net',
  projectKey: 'ROAD',
  email: 'operator@example.com',
  apiToken: 'jira-secret-token',
};

function response(status, body, values = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const match = Object.entries(values)
          .find(([key]) => key.toLowerCase() === name.toLowerCase());
        return match?.[1] ?? null;
      },
    },
    async json() { return body; },
  };
}

function issue(key, overrides = {}) {
  return {
    id: key.replace(/\D/g, '') || '1',
    key,
    fields: {
      summary: `Summary for ${key}`,
      status: { name: 'In Progress', statusCategory: { name: 'In Progress' } },
      priority: { name: 'High' },
      assignee: { displayName: 'Ada Lovelace' },
      issuetype: { name: 'Story' },
      parent: { key: 'ROAD-1' },
      labels: ['harbor', 'console'],
      created: '2026-08-20T10:00:00.000+0000',
      updated: '2026-08-29T10:00:00.000+0000',
      duedate: '2026-09-15',
      ...overrides,
    },
  };
}

describe('Jira managed configuration', () => {
  test('reports every missing key without guessing', () => {
    const state = jiraConfigFromSecrets(() => undefined);
    expect(state).toEqual({ configured: false, missing: [...JIRA_CONFIG_KEYS] });
  });

  test('normalizes the origin and project key without returning credentials in errors', () => {
    expect(normalizeJiraConfig({ ...CONFIG, baseUrl: 'https://acme.atlassian.net/', projectKey: 'road' }))
      .toEqual({ ...CONFIG, projectKey: 'ROAD' });
    expect(() => normalizeJiraConfig({ ...CONFIG, baseUrl: 'https://user:pass@acme.atlassian.net' }))
      .toThrow(JiraRoadmapError);
    expect(() => normalizeJiraConfig({ ...CONFIG, projectKey: 'ROAD OR project = SECRET' }))
      .toThrow(/PROJECT_KEY/);
  });
});

describe('Jira roadmap reader', () => {
  test('uses enhanced JQL pagination and returns full source-labelled issue metadata', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      const request = JSON.parse(init.body);
      return request.nextPageToken
        ? response(200, { issues: [issue('ROAD-3', { assignee: null, parent: null })], isLast: true })
        : response(200, { issues: [issue('ROAD-2')], nextPageToken: 'page-two', isLast: false });
    };
    const reader = createJiraRoadmapReader({ fetchImpl, now: () => 1234, ttlMs: 15_000 });

    const result = await reader.read(CONFIG);

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://acme.atlassian.net/rest/api/3/search/jql');
    const firstBody = JSON.parse(calls[0].init.body);
    expect(firstBody.jql).toBe('project = ROAD ORDER BY rank ASC, updated DESC');
    expect(firstBody.fields).toContain('assignee');
    expect(JSON.parse(calls[1].init.body).nextPageToken).toBe('page-two');
    expect(result).toMatchObject({
      source: 'jira', projectKey: 'ROAD', baseUrl: CONFIG.baseUrl, fetchedAt: 1234,
      cached: false, pageCount: 2, truncated: false,
    });
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]).toMatchObject({
      source: 'jira', key: 'ROAD-2', summary: 'Summary for ROAD-2', status: 'In Progress',
      priority: 'High', assignee: 'Ada Lovelace', issueType: 'Story', parentKey: 'ROAD-1',
      url: 'https://acme.atlassian.net/browse/ROAD-2',
    });
    expect(result.issues[1]).toMatchObject({ key: 'ROAD-3', assignee: null, parentKey: null });
    expect(JSON.stringify(result)).not.toContain(CONFIG.email);
    expect(JSON.stringify(result)).not.toContain(CONFIG.apiToken);
  });

  test('coalesces concurrent reads and then serves the short exact cache', async () => {
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const fetchImpl = async () => {
      calls += 1;
      await gate;
      return response(200, { issues: [issue('ROAD-7')], isLast: true });
    };
    let now = 10;
    const reader = createJiraRoadmapReader({ fetchImpl, now: () => now, ttlMs: 100 });
    const first = reader.read(CONFIG);
    const second = reader.read(CONFIG);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
    expect(a.issues).toEqual(b.issues);

    now = 50;
    const cached = await reader.read(CONFIG);
    expect(calls).toBe(1);
    expect(cached.cached).toBe(true);
  });

  test('honors Retry-After and bounds retries for transient Jira responses', async () => {
    const delays = [];
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return response(429, {}, { 'Retry-After': '2' });
      if (calls === 2) return response(503, {});
      return response(200, { issues: [issue('ROAD-8')], isLast: true });
    };
    const reader = createJiraRoadmapReader({
      fetchImpl,
      sleep: async (delayMs) => { delays.push(delayMs); },
      retryBaseDelayMs: 100,
      maxRetries: 2,
    });

    const result = await reader.read(CONFIG);

    expect(calls).toBe(3);
    expect(delays).toEqual([2_000, 200]);
    expect(result.issues.map((item) => item.key)).toEqual(['ROAD-8']);
  });

  test('fails fast when Retry-After exceeds the bounded console wait', async () => {
    const delays = [];
    let calls = 0;
    const reader = createJiraRoadmapReader({
      fetchImpl: async () => {
        calls += 1;
        return response(429, {}, { 'Retry-After': '30' });
      },
      sleep: async (delayMs) => { delays.push(delayMs); },
      maxRetryDelayMs: 1_000,
    });

    await expect(reader.read(CONFIG)).rejects.toThrow('HTTP 429');
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });

  test('labels a bounded partial result instead of presenting it as complete', async () => {
    const reader = createJiraRoadmapReader({
      maxPages: 1,
      fetchImpl: async () => response(200, {
        issues: [issue('ROAD-1')],
        nextPageToken: 'more-exists',
        isLast: false,
      }),
    });

    const result = await reader.read(CONFIG);
    expect(result).toMatchObject({ pageCount: 1, truncated: true });
    expect(result.issues.map((item) => item.key)).toEqual(['ROAD-1']);
  });

  test('surfaces only bounded status context for upstream errors', async () => {
    const reader = createJiraRoadmapReader({
      fetchImpl: async () => response(401, { errorMessages: ['do not echo tenant details'] }),
    });
    await expect(reader.read(CONFIG)).rejects.toThrow('HTTP 401');
    await expect(reader.read(CONFIG)).rejects.not.toThrow('tenant details');
  });

  test('does not echo an invalid upstream response through the parse failure', async () => {
    const reader = createJiraRoadmapReader({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() { throw new Error('tenant response contained private-roadmap-name'); },
      }),
    });
    await expect(reader.read(CONFIG)).rejects.toThrow('invalid JSON');
    await expect(reader.read(CONFIG)).rejects.not.toThrow('private-roadmap-name');
  });
});
