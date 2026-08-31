import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runLearnOrientation } from '../../cli/commands/tutorial.ts';
import type { FetchOptions, PdFetchResponse } from '../../cli/utils/fetch.ts';

type FetchCall = { path: string; options?: FetchOptions };

function response(body: Record<string, unknown>, status = 200): PdFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {},
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('pd learn read-only orientation', () => {
  test('headless output is deterministic and performs no daemon call', async () => {
    const calls: FetchCall[] = [];
    const run = async (): Promise<string> => {
      let output = '';
      await runLearnOrientation({
        interactive: false,
        fetchImpl: async (path, options) => {
          calls.push({ path, options });
          return response({ status: 'ok' });
        },
        write: (text) => { output += text; },
        pause: async () => {},
        daemonUrl: () => 'http://127.0.0.1:9876',
      });
      return output;
    };

    const first = await run();
    const second = await run();

    expect(first).toBe(second);
    expect(calls).toEqual([]);
    expect(first).toContain('This is the agent and automation CLI');
    expect(first).toContain('Operationally read-only:');
    expect(first).toContain('Headless orientation: live probing is intentionally skipped.');
    expect(first).toContain('No work resources, files, or indexes were changed.');
    expect(first).toContain('Standard command telemetry may have been appended.');
  });

  test('interactive mode issues exactly one optionless health GET', async () => {
    const calls: FetchCall[] = [];
    let output = '';

    await runLearnOrientation({
      interactive: true,
      fetchImpl: async (path, options) => {
        calls.push({ path, options });
        return response({
          status: 'ok',
          version: '3.30.5',
          pid: 1234,
          daemon: { label: 'stable' },
        });
      },
      write: (text) => { output += text; },
      pause: async () => {},
      daemonUrl: () => 'http://127.0.0.1:9876',
    });

    expect(calls).toEqual([{ path: '/health', options: undefined }]);
    expect(output).toContain('Runtime witness:');
    expect(output).toContain('v3.30.5');
    expect(output).toContain('PID 1234');
  });

  test('health failure does not prevent the offline-safe guide', async () => {
    let output = '';
    await expect(runLearnOrientation({
      interactive: true,
      fetchImpl: async () => { throw new Error('offline'); },
      write: (text) => { output += text; },
      pause: async () => {},
    })).resolves.toBeUndefined();

    expect(output).toContain('Live health is unavailable. The orientation still works offline.');
    expect(output).toContain('Orientation complete');
  });

  test('source contains no state-changing fetch method or legacy resource state', () => {
    const source = readFileSync(join(import.meta.dir, '..', '..', 'cli', 'commands', 'tutorial.ts'), 'utf8');

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(source).not.toContain(`method: '${method}'`);
      expect(source).not.toContain(`method: "${method}"`);
    }
    for (const legacy of [
      'TutorialState',
      'cleanupTutorialState',
      'runWithTutorialCleanup',
      "pdFetch('/claim'",
      "pdFetch('/release'",
      "pdFetch('/agents'",
      "pdFetch('/actors/register'",
      "pdFetch('/notes'",
      "pdFetch('/msg/",
      "pdFetch('/dns",
      "pdFetch('/locks/",
      "pdFetch('/sugar/begin'",
      "pdFetch('/sugar/done'",
    ]) {
      expect(source).not.toContain(legacy);
    }
  });
});
