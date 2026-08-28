import { describe, expect, test } from '@jest/globals';

const { createGitHubOutput } = await import('../../lib/fleet/github-output.js');

/**
 * Build a deterministic GitHub CLI runner that records its exact requests.
 *
 * The output adapter is an operator-facing transport seam, so these tests
 * inspect stdin as well as argv instead of only asserting a happy-path URL.
 *
 * @param existingComment - Optional comment returned by the discovery call.
 * @returns Captured requests and the runner supplied to the output adapter.
 */
function recordedRunner(existingComment = null) {
  const calls = [];
  const runGh = async (args, stdin) => {
    calls.push({ args, stdin });
    if (args.includes('--paginate')) {
      return {
        ok: true,
        stdout: existingComment ? JSON.stringify(existingComment) : '',
        stderr: '',
        exitCode: 0,
      };
    }
    return {
      ok: true,
      stdout: 'https://github.com/acme/port-daddy/pull/42#issuecomment-7',
      stderr: '',
      exitCode: 0,
    };
  };
  return { calls, runGh };
}

describe('GitHub PR comment output', () => {
  test('streams new comments as untouched Markdown through gh --body-file', async () => {
    const { calls, runGh } = recordedRunner();
    const output = createGitHubOutput({
      shipName: 'proof-reviewer',
      repo: 'acme/port-daddy',
      runGh,
    });
    const markdown = '## Review follow-up\n\n- Real proof\n- Red refusal\n\n| Scene | State |\n| --- | --- |\n| Collision | expected |';

    await output.postPRComment(42, markdown);

    expect(calls).toHaveLength(2);
    expect(calls[1].args).toEqual([
      'pr',
      'comment',
      '42',
      '-R',
      'acme/port-daddy',
      '--body-file',
      '-',
    ]);
    expect(calls[1].stdin).toBe(`<!-- pd-fleet:ship=proof-reviewer -->\n\n${markdown}`);
  });

  test('edits existing comments with a JSON body instead of the literal body=@- field', async () => {
    const { calls, runGh } = recordedRunner({
      id: 7,
      url: 'https://github.com/acme/port-daddy/pull/42#issuecomment-7',
    });
    const output = createGitHubOutput({
      shipName: 'proof-reviewer',
      repo: 'acme/port-daddy',
      runGh,
    });
    const markdown = '## Review follow-up\n\n- Preserve this exact list item\n- Preserve `code` too';

    const result = await output.postPRComment(42, markdown);

    expect(result).toEqual({
      url: 'https://github.com/acme/port-daddy/pull/42#issuecomment-7',
      commentId: 7,
      edited: true,
    });
    expect(calls).toHaveLength(2);
    expect(calls[1].args).toEqual([
      'api',
      '--method',
      'PATCH',
      '-R',
      'acme/port-daddy',
      '-H',
      'Content-Type: application/json',
      'repos/{owner}/{repo}/issues/comments/7',
      '--input',
      '-',
    ]);
    expect(JSON.parse(calls[1].stdin)).toEqual({
      body: `<!-- pd-fleet:ship=proof-reviewer -->\n\n${markdown}`,
    });
    expect(calls[1].args).not.toContain('body=@-');
  });
});
