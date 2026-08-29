import { describe, expect, it } from 'vitest';
import { parseShipCheckpoint, SHIP_CHECKPOINT_SCHEMA_VERSION } from '../src/ship-checkpoint.js';

describe('review coverage checkpoint contract', () => {
  const checkpointBinding = {
    bindingVersion: 3 as const,
    shipConfigSha256: `sha256:${'1'.repeat(64)}`,
    contractSha256: 'absent',
    graftSha256: `sha256:${'2'.repeat(64)}`,
    systemPromptSha256: `sha256:${'3'.repeat(64)}`,
    reviewInputSha256: `sha256:${'4'.repeat(64)}`,
    mediatorOrdersSha256: 'absent',
  };
  const cleanResult = {
    ship: 'code-reviewer',
    blocking: true,
    verdict: 'PASS',
    errored: false,
  } as const;

  it.each(['partial', 'none'] as const)(
    'preserves valid %s review coverage and its explanation',
    reviewCoverage => {
      const detail = {
        ...cleanResult,
        reviewCoverage,
        reviewCoverageReason: 'one or more reviewable files were not sent to the model',
      };

      expect(parseShipCheckpoint('code-reviewer', JSON.stringify({
        ...detail,
        checkpointSchemaVersion: SHIP_CHECKPOINT_SCHEMA_VERSION,
        checkpointBinding,
      }))).toEqual(detail);
    },
  );

  it('preserves a nonblank explanation at the 2048-character boundary', () => {
    const detail = {
      ...cleanResult,
      reviewCoverage: 'partial' as const,
      reviewCoverageReason: 'x'.repeat(2_048),
    };

    expect(parseShipCheckpoint('code-reviewer', JSON.stringify({
      ...detail,
      checkpointSchemaVersion: SHIP_CHECKPOINT_SCHEMA_VERSION,
      checkpointBinding,
    }))).toEqual(detail);
  });

  it.each([
    { reviewCoverage: 'complete' },
    { reviewCoverage: 'PARTIAL' },
    { reviewCoverage: null },
    { reviewCoverage: 1 },
    { reviewCoverageReason: 'orphaned explanation' },
    { reviewCoverage: 'none', reviewCoverageReason: 42 },
    { reviewCoverage: 'partial', reviewCoverageReason: '' },
    { reviewCoverage: 'partial', reviewCoverageReason: ' \t\n' },
    { reviewCoverage: 'partial', reviewCoverageReason: 'x'.repeat(2_049) },
  ])('rejects an invalid review coverage checkpoint: %#', detail => {
    expect(
      parseShipCheckpoint('code-reviewer', JSON.stringify({
        ...cleanResult,
        ...detail,
        checkpointSchemaVersion: SHIP_CHECKPOINT_SCHEMA_VERSION,
        checkpointBinding,
      })),
    ).toBeNull();
  });
});
