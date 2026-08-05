import { describe, expect, test } from '@jest/globals';
import {
  buildCliTubeArgs,
} from '../../lib/spawner/backends/cli-tube-provider-specs.js';
import {
  resolveCodexLinkedWorktreeWritableDirs,
} from '../../lib/spawner/backends/cli-tube.js';

describe('Codex linked-worktree authorship sandbox', () => {
  test('grants only the worktree Git dir and shared write-bearing Git stores', () => {
    const commonDir = '/Users/dev/repo/.git';
    const gitDir = `${commonDir}/worktrees/feature`;
    const query = (_cwd, key) => key === '--absolute-git-dir' ? gitDir : commonDir;

    expect(resolveCodexLinkedWorktreeWritableDirs('/Users/dev/feature', query)).toEqual([
      gitDir,
      `${commonDir}/objects`,
      `${commonDir}/refs`,
      `${commonDir}/logs`,
    ]);
  });

  test('does not grant arbitrary external metadata or broaden an ordinary checkout', () => {
    const malformed = (_cwd, key) => key === '--absolute-git-dir'
      ? '/Users/dev/operator-secrets'
      : '/Users/dev/repo/.git';
    const ordinary = () => '/Users/dev/repo/.git';

    expect(resolveCodexLinkedWorktreeWritableDirs('/Users/dev/feature', malformed)).toEqual([]);
    expect(resolveCodexLinkedWorktreeWritableDirs('/Users/dev/repo', ordinary)).toEqual([]);
  });

  test.each([undefined, '22222222-2222-4222-8222-222222222222'])(
    'places --add-dir before the optional resume subcommand (%s)',
    (resumeSessionId) => {
      const roots = ['/repo/.git/worktrees/feature', '/repo/.git/objects'];
      const { args } = buildCliTubeArgs('codex', {
        prompt: 'author the commit',
        additionalWritableDirs: roots,
        resumeSessionId,
      });

      expect(args.slice(0, 5)).toEqual([
        'exec',
        '--add-dir', roots[0],
        '--add-dir', roots[1],
      ]);
      if (resumeSessionId) {
        expect(args[5]).toBe('resume');
      } else {
        expect(args).toContain('--sandbox');
        expect(args[args.indexOf('--sandbox') + 1]).toBe('workspace-write');
      }
    },
  );
});
