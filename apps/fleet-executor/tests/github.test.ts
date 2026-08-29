import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTrustedShipContract } from '../src/github.js';

/** Stub the GitHub Contents response with the supplied decoded contract text. */
function stubTrustedContract(contract: string): ReturnType<typeof vi.fn> {
  const fetcher = vi.fn(async () => new Response(
    JSON.stringify({ encoding: 'base64', content: btoa(contract) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ));
  vi.stubGlobal('fetch', fetcher as unknown as typeof fetch);
  return fetcher;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchTrustedShipContract', () => {
  it.each(['', ' \t\n'])('rejects a 200 payload whose decoded contract is only whitespace', async contract => {
    const fetcher = stubTrustedContract(contract);

    await expect(
      fetchTrustedShipContract('curiositech', 'port-daddy', 'code-reviewer', 'main', 'token'),
    ).rejects.toThrow('fleet/ships/code-reviewer.md returned an empty contract');

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/repos/curiositech/port-daddy/contents/fleet/ships/code-reviewer.md?ref=main',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('returns a nonblank trusted contract verbatim', async () => {
    stubTrustedContract('## Reviewer contract\n\nFind concrete defects.\n');

    await expect(
      fetchTrustedShipContract('curiositech', 'port-daddy', 'code-reviewer', 'main', 'token'),
    ).resolves.toBe('## Reviewer contract\n\nFind concrete defects.\n');
  });
});
