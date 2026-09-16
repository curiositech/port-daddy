import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runLearnOrientation } from '../../../cli/commands/tutorial.ts';
import type { FetchOptions, PdFetchResponse } from '../../../cli/utils/fetch.ts';

type FetchCall = { path: string; options?: FetchOptions };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TUTORIAL_SOURCE = readFileSync(join(ROOT, 'cli', 'commands', 'tutorial.ts'), 'utf8');

function response(body: Record<string, unknown>): PdFetchResponse {
  return {
    ok: true,
    status: 200,
    headers: {},
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('pd learn adversarial safety contract', () => {
  test('headless execution is stable and cannot reach the daemon', async () => {
    const calls: FetchCall[] = [];
    let output = '';

    await runLearnOrientation({
      interactive: false,
      fetchImpl: async (path, options) => {
        calls.push({ path, options });
        return response({ status: 'ok' });
      },
      write: (text) => { output += text; },
      pause: async () => {},
    });

    expect(calls).toEqual([]);
    expect(output).toContain('People use FleetBar');
    expect(output).toContain('the CLI envelope makes exactly one append-only');
    expect(output).toContain('usage-telemetry attempt.');
    expect(output).toContain('pd attention');
    expect(output).toContain('pd attention --peek');
    expect(output).toContain('pd sitrep --template');
    expect(output).toContain('--roadmap <slug>');
    expect(output).toContain('pd plan set');
    expect(output).toContain('pd session files add <exact-path>');
    expect(output).toContain('pd guard check --staged');
    expect(output).toContain('pd done');
    expect(output).toContain('pd feedback');
  });

  test('the only reachable handler daemon contract is bounded GET health without retry', async () => {
    const calls: FetchCall[] = [];
    await runLearnOrientation({
      interactive: true,
      fetchImpl: async (path, options) => {
        calls.push({ path, options });
        return response({ status: 'ok', version: 'test' });
      },
      write: () => {},
      pause: async () => {},
    });

    expect(calls).toEqual([{ path: '/health', options: { timeout: 750, retry: false } }]);
  });

  test('the implementation cannot reintroduce default-consent or cleanup machinery', () => {
    expect(TUTORIAL_SOURCE).not.toContain('promptConfirm');
    expect(TUTORIAL_SOURCE).not.toContain('promptText');
    expect(TUTORIAL_SOURCE).not.toContain('promptIdentity');
    expect(TUTORIAL_SOURCE).not.toContain('process.exit(');
    expect(TUTORIAL_SOURCE).not.toContain('cleanupTutorialState');
    expect(TUTORIAL_SOURCE).not.toContain('TutorialState');

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(TUTORIAL_SOURCE).not.toMatch(new RegExp(`method\\s*:\\s*['\"]${method}['\"]`));
    }
    for (const route of [
      '/claim',
      '/release',
      '/agents',
      '/actors/register',
      '/notes',
      '/msg/',
      '/dns',
      '/locks/',
      '/sugar/begin',
      '/sugar/done',
    ]) {
      expect(TUTORIAL_SOURCE).not.toContain(`pdFetch('${route}`);
    }
  });

  test('orientation clearly separates search from ingestion and model training', async () => {
    let output = '';
    await runLearnOrientation({
      interactive: false,
      write: (text) => { output += text; },
      pause: async () => {},
    });

    expect(output).toContain('It does not train a model, ingest history, or rebuild an index.');
    expect(output).toContain('pd ideas search');
    expect(output).toContain('pd memory episodes --query');
    expect(output).toContain('pd roster search');
    expect(output).toContain('pd skill-graft');
    expect(output).toContain('Target invariant: semantic results carry model/space metadata');
    expect(output).toContain('never compare vectors from incompatible model spaces.');
  });
});
