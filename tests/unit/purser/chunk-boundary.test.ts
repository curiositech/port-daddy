// tests/unit/purser/chunk-boundary.test.ts
/**
 * Verify the behaviour of the `chunk` helper used by `replaceRoadmapMirror`.
 * The contract for this PR requires that the chunk size is exactly
 * `INSERT_CHUNK_ROWS = 40` and that boundary conditions (zero items,
 * exact multiples, and off‑by‑one cases) are handled correctly.
 *
 * These tests deliberately exercise the edge cases that would expose
 * an off‑by‑one error in the chunking logic, ensuring the PR’s fix
 * cannot be bypassed by a “lazy” implementation that only works for
 * typical sizes.
 */

import { chunk, INSERT_CHUNK_ROWS } from '../../../apps/relay/src/roadmap-mirror';

describe('chunk helper – boundary conditions', () => {
  /**
   * Helper to generate an array of consecutive numbers [0, 1, …, length‑1].
   */
  const makeArray = (length: number) => Array.from({ length }, (_, i) => i);

  /**
   * Expected number of chunks for a given total length.
   */
  const expectedChunkCount = (total: number) =>
    total === 0 ? 0 : Math.ceil(total / INSERT_CHUNK_ROWS);

  /**
   * Expected size of the last chunk (may be equal to INSERT_CHUNK_ROWS
   * when the total length is an exact multiple).
   */
  const expectedLastChunkSize = (total: number) => {
    if (total === 0) return 0;
    const remainder = total % INSERT_CHUNK_ROWS;
    return remainder === 0 ? INSERT_CHUNK_ROWS : remainder;
  };

  const testCases = [
    { total: 0 },
    { total: 1 },
    { total: INSERT_CHUNK_ROWS - 1 },
    { total: INSERT_CHUNK_ROWS },
    { total: INSERT_CHUNK_ROWS + 1 },
    { total: INSERT_CHUNK_ROWS * 2 },
    { total: INSERT_CHUNK_ROWS * 2 + 1 },
    { total: INSERT_CHUNK_ROWS * 3 - 5 },
    { total: INSERT_CHUNK_ROWS * 3 },
    { total: INSERT_CHUNK_ROWS * 3 + 7 },
  ];

  test.each(testCases)('chunks $total items correctly', ({ total }) => {
    const data = makeArray(total);
    const chunks = chunk(data);

    // 1️⃣ Correct number of chunks
    expect(chunks).toHaveLength(expectedChunkCount(total));

    // 2️⃣ Every chunk (except possibly the last) must have the exact chunk size
    if (chunks.length > 0) {
      for (let i = 0; i < chunks.length - 1; i++) {
        expect(chunks[i]).toHaveLength(INSERT_CHUNK_ROWS);
      }
      // 3️⃣ The last chunk size follows the remainder rule
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk).toHaveLength(expectedLastChunkSize(total));
    }

    // 4️⃣ Flattening the chunks must reproduce the original array (order preserved)
    const flattened = ([] as number[]).concat(...chunks);
    expect(flattened).toEqual(data);
  });
});