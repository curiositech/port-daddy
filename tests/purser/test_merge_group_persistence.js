import { describe, it, expect, vi } from 'vitest';
import { handleGithubWebhook } from '../../src/github-webhook.js';
import { makeEnv } from './mocks.js';

const SECRET = 'super-secret-webhook-key';

describe('merge_group event persistence', () => {
  it('persists merge_group event to D1', async () => {
    const cap = { events: [], audits: [] };
    const published = [];
    const env = makeEnv(cap, published, SECRET);
    
    const body = JSON.stringify({
      action: 'checks_requested',
      installation: { id: 42 },
      merge_group: {
        head_sha: 'MERGEGROUPSHA',
        head_ref: 'refs/heads/gh-readonly-queue/main/pr-5062-base',
      },
      repository: { full_name: 'curiositech/port-daddy', id: 42 },
      sender: { login: 'github-merge-queue[bot]', id: 1 }
    });

    await handleGithubWebhook(
      { body, headers: { 'x-github-event': 'merge_group' }, env },
      env
    );

    expect(cap.events).toHaveLength(1);
    expect(cap.events[0].eventType).toBe('merge_group');
    expect(cap.events[0].payload.merge_group).toBeDefined();
  });

  it('handles missing head_ref in merge_group', async () => {
    const cap = { events: [], audits: [] };
    const published = [];
    const env = makeEnv(cap, published, SECRET);
    
    const body = JSON.stringify({
      action: 'checks_requested',
      installation: { id: 42 },
      merge_group: { head_sha: 'MERGEGROUPSHA' },
      repository: { full_name: 'curiositech/port-daddy', id: 42 },
      sender: { login: 'github-merge-queue[bot]', id: 1 }
    });

    await handleGithubWebhook(
      { body, headers: { 'x-github-event': 'merge_group' }, env },
      env
    );

    expect(cap.events).toHaveLength(1);
    expect(cap.events[0].payload.merge_group.head_ref).toBeUndefined();
  });
});