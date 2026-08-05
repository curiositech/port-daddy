import { readFileSync } from 'node:fs';

const repoRoot = new URL('../../', import.meta.url);

function readRepoFile(path) {
  return readFileSync(new URL(path, repoRoot), 'utf8');
}

describe('spawn status contract coverage', () => {
  test('over_budget is present in transcript, API, and client status contracts', () => {
    const contracts = [
      [
        'lib/transcripts.ts TranscriptStatus',
        readRepoFile('lib/transcripts.ts'),
        /export type TranscriptStatus = 'running' \| 'completed' \| 'failed' \| 'killed' \| 'over_budget';/,
      ],
      [
        'lib/transcript-compliance.ts tracked run status',
        readRepoFile('lib/transcript-compliance.ts'),
        /status: 'running' \| 'completed' \| 'failed' \| 'killed' \| 'over_budget';/,
      ],
      [
        'lib/client.ts SpawnResult status',
        readRepoFile('lib/client.ts'),
        /status: 'running' \| 'completed' \| 'failed' \| 'killed' \| 'over_budget';/,
      ],
      [
        'docs/openapi.yaml /spawn status enum',
        readRepoFile('docs/openapi.yaml'),
        /enum: \[running, completed, failed, killed, over_budget, unknown\]/,
      ],
    ];

    for (const [label, source, matcher] of contracts) {
      expect(source).toEqual(expect.stringMatching(matcher), label);
    }
  });
});
