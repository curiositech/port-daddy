import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const pdFetch = jest.fn();
const success = jest.fn();
const error = jest.fn();
const info = jest.fn();

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({ pdFetch }));
jest.unstable_mockModule('../../cli/utils/ui.js', () => ({ success, error, info }));

const { handleDoctrine } = await import('../../cli/commands/doctrine.js');

function response(body) {
  return { ok: true, json: async () => body };
}

describe('pd doctrine CLI run receipt wording', () => {
  beforeEach(() => {
    pdFetch.mockReset();
    success.mockReset();
    error.mockReset();
    info.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    ['control', 'control-1', 'Control run control-1'],
    ['treatment', 'treatment-1', 'Treatment run treatment-1'],
    ['sham', 'sham-1', 'Sham run sham-1'],
  ])('reports the neutral %s factual-run receipt without assuming a treatment-only response', async (arm, runId, expected) => {
    pdFetch.mockResolvedValueOnce(response({ success: true, run: { runId, arm } }));

    await handleDoctrine(['run', 'experiment-case13'], {
      input: JSON.stringify({
        projectDir: '/repo/port-daddy',
        citations: ['receipt:case13:run'],
        arm,
        action: 'observe',
        outcome: 'recorded',
        fidelity: 'matched',
        replayContext: {
          model: 'fixture-model',
          modelVersion: '2026-08-26',
          harness: 'fixture-harness',
          worktree: 'case13',
          environment: 'test',
          checkpoint: 'checkpoint:case13',
          replicaId: `replica:${arm}`,
        },
      }),
    });

    expect(pdFetch).toHaveBeenCalledWith(
      '/doctrine/experiments/experiment-case13/runs',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(success).toHaveBeenCalledWith(expected);
  });
});
