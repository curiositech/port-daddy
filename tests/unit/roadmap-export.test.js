/**
 * Unit Tests for Roadmap Export (lib/roadmap-export.ts)
 *
 * No live network, ever — every test injects a fetch stub built from each
 * target API's actual documented response shape (GitHub REST Issues, Linear
 * GraphQL issueCreate, Jira Cloud REST v3 issue create), so the request
 * construction and response parsing are both exercised for real without
 * needing live credentials against a real GitHub/Linear/Jira account.
 */

import { describe, it, expect } from '@jest/globals';
import { exportRoadmapItem, RoadmapExportError } from '../../lib/roadmap-export.js';

function item(overrides = {}) {
  return {
    slug: 'fix-login-bug',
    summaryMd: 'Fix the login bug',
    descriptionMd: null,
    status: 'now',
    tags: [],
    ...overrides,
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

describe('roadmap-export / github', () => {
  it('creates an issue and returns its number + html_url', async () => {
    let capturedUrl, capturedInit;
    const fetchImpl = async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse(201, { number: 42, html_url: 'https://github.com/acme/widgets/issues/42' });
    };

    const result = await exportRoadmapItem(item(), {
      target: 'github',
      repo: 'acme/widgets',
      token: 'ghp_secret',
      fetchImpl,
    });

    expect(result).toEqual({
      target: 'github',
      externalId: '42',
      externalUrl: 'https://github.com/acme/widgets/issues/42',
    });
    expect(capturedUrl).toBe('https://api.github.com/repos/acme/widgets/issues');
    expect(capturedInit.method).toBe('POST');
    expect(capturedInit.headers.Authorization).toBe('Bearer ghp_secret');
    const body = JSON.parse(capturedInit.body);
    expect(body.title).toBe('Fix the login bug');
    expect(body.body).toContain('fix-login-bug');
  });

  it('rejects a malformed repo string before making a request', async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return jsonResponse(200, {}); };
    await expect(
      exportRoadmapItem(item(), { target: 'github', repo: 'not-a-repo', token: 't', fetchImpl }),
    ).rejects.toThrow(RoadmapExportError);
    expect(called).toBe(false);
  });

  it('surfaces a non-2xx response as a RoadmapExportError', async () => {
    const fetchImpl = async () => jsonResponse(403, { message: 'Resource not accessible by integration' });
    await expect(
      exportRoadmapItem(item(), { target: 'github', repo: 'acme/widgets', token: 't', fetchImpl }),
    ).rejects.toThrow(/HTTP 403/);
  });

  it('passes tags through as labels when present', async () => {
    let capturedBody;
    const fetchImpl = async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return jsonResponse(201, { number: 1, html_url: 'https://github.com/a/b/issues/1' });
    };
    await exportRoadmapItem(item({ tags: ['bug', 'p1'] }), {
      target: 'github', repo: 'a/b', token: 't', fetchImpl,
    });
    expect(capturedBody.labels).toEqual(['bug', 'p1']);
  });
});

describe('roadmap-export / linear', () => {
  it('creates an issue via the issueCreate mutation and returns its identifier + url', async () => {
    let capturedBody;
    const fetchImpl = async (url, init) => {
      capturedBody = JSON.parse(init.body);
      expect(url).toBe('https://api.linear.app/graphql');
      return jsonResponse(200, {
        data: { issueCreate: { success: true, issue: { id: 'uuid-1', identifier: 'ENG-123', url: 'https://linear.app/acme/issue/ENG-123' } } },
      });
    };

    const result = await exportRoadmapItem(item(), {
      target: 'linear',
      teamId: 'team-uuid',
      token: 'lin_api_key',
      fetchImpl,
    });

    expect(result).toEqual({
      target: 'linear',
      externalId: 'ENG-123',
      externalUrl: 'https://linear.app/acme/issue/ENG-123',
    });
    expect(capturedBody.variables.teamId).toBe('team-uuid');
    expect(capturedBody.variables.title).toBe('Fix the login bug');
  });

  it('surfaces a GraphQL-level error even on HTTP 200', async () => {
    const fetchImpl = async () => jsonResponse(200, { errors: [{ message: 'Team not found' }] });
    await expect(
      exportRoadmapItem(item(), { target: 'linear', teamId: 'bad', token: 't', fetchImpl }),
    ).rejects.toThrow(/Team not found/);
  });

  it('surfaces success:false as an error even with no explicit errors array', async () => {
    const fetchImpl = async () => jsonResponse(200, { data: { issueCreate: { success: false } } });
    await expect(
      exportRoadmapItem(item(), { target: 'linear', teamId: 't', token: 't', fetchImpl }),
    ).rejects.toThrow(RoadmapExportError);
  });
});

describe('roadmap-export / jira', () => {
  it('creates an issue via REST v3 and returns its key + browse url', async () => {
    let capturedUrl, capturedInit;
    const fetchImpl = async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse(201, { id: '10001', key: 'ROAD-7', self: 'https://acme.atlassian.net/rest/api/3/issue/10001' });
    };

    const result = await exportRoadmapItem(item(), {
      target: 'jira',
      baseUrl: 'https://acme.atlassian.net/',
      projectKey: 'ROAD',
      email: 'ops@acme.com',
      apiToken: 'jira-token',
      fetchImpl,
    });

    expect(result).toEqual({
      target: 'jira',
      externalId: 'ROAD-7',
      externalUrl: 'https://acme.atlassian.net/browse/ROAD-7',
    });
    expect(capturedUrl).toBe('https://acme.atlassian.net/rest/api/3/issue'); // trailing slash on baseUrl stripped
    const body = JSON.parse(capturedInit.body);
    expect(body.fields.project.key).toBe('ROAD');
    expect(body.fields.summary).toBe('Fix the login bug');
    expect(body.fields.issuetype.name).toBe('Task'); // default
    // Basic auth is base64(email:token) — verify it round-trips, never asserted as a literal
    // (a literal assertion would just re-encode the same secret into the test source).
    const decoded = Buffer.from(capturedInit.headers.Authorization.replace('Basic ', ''), 'base64').toString();
    expect(decoded).toBe('ops@acme.com:jira-token');
  });

  it('respects a custom issueType', async () => {
    let capturedBody;
    const fetchImpl = async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return jsonResponse(201, { id: '1', key: 'ROAD-8' });
    };
    await exportRoadmapItem(item(), {
      target: 'jira', baseUrl: 'https://acme.atlassian.net', projectKey: 'ROAD',
      email: 'e', apiToken: 't', issueType: 'Story', fetchImpl,
    });
    expect(capturedBody.fields.issuetype.name).toBe('Story');
  });

  it('surfaces a non-2xx response as a RoadmapExportError', async () => {
    const fetchImpl = async () => jsonResponse(400, { errorMessages: ['project key is required'] });
    await expect(
      exportRoadmapItem(item(), {
        target: 'jira', baseUrl: 'https://acme.atlassian.net', projectKey: 'ROAD', email: 'e', apiToken: 't', fetchImpl,
      }),
    ).rejects.toThrow(/HTTP 400/);
  });
});
