import { describe, it, expect, vi } from 'vitest';
import { handleGithubWebhook } from '../../src/github-webhook.js';
import { makeEnv } from './mocks.js';

const SECRET = 'super-secret-webhook-key';

describe('merge_group channel publication', () => {
  it('publishes to correct channels', async () => {
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

    expect(published).toEqual([
      'github:webhook:merge_group',
      'github:webhook:merge_group:checks_requested',
      'github:curiositech/port-daddy:merge_group'
    ]);
  });

  it('handles invalid event type', async () => {
    const cap = { events: [], audits: [] };
    const published = [];
    const env = makeEnv(cap, published, SECRET);
    
    const body = JSON.stringify({
      action: 'checks_requested',
      installation: { id: 42 },
      repository: { full_name: 'curiositech/port-daddy', id: 42 },
      sender: { login: 'github-merge-queue[bot]', id: 1 }
    });

    await handleGithubWebhook(
      { body, headers: { 'x-github-event': 'invalid' }, env },
      env
    );

    expect(published).toHaveLength(0);
  });
});