import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Fleet daemon endpoint selection', () => {
  beforeEach(() => {
    vi.resetModules();
    window.history.replaceState({}, '', '/fleet-ui/');
  });

  it('uses the daemon-served page origin instead of guessing a port', async () => {
    const api = await import('./api');

    expect(api.getDaemonUrl()).toBe(window.location.origin);
    expect(api.getDaemonChoices()).toEqual([window.location.origin]);
  });

  it('honors an explicit selected endpoint before same-origin discovery', async () => {
    const selected = 'http://127.0.0.1:43127';
    window.history.replaceState({}, '', `/fleet-ui/?daemon=${encodeURIComponent(selected)}`);

    const api = await import('./api');

    expect(api.getDaemonUrl()).toBe(selected);
    expect(api.getDaemonChoices()).toContain(selected);
  });

  it('rejects an empty custom endpoint instead of falling back to a guessed port', async () => {
    const api = await import('./api');

    expect(() => api.setDaemonUrl('')).toThrow('A daemon endpoint is required');
  });
});
