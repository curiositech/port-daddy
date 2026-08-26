import { describe, expect, it } from 'vitest';
import {
  decodeFleetDeliveryAttemptCursor,
  encodeFleetDeliveryAttempt,
  fleetDeliveryAttemptLabel,
  readFleetDeliveryAttempt,
} from '../../shared/fleet-delivery-attempt.js';

describe('Fleet delivery attempt coordinates', () => {
  it('keeps sequence and platform attempt separate while preserving a monotonic cursor', () => {
    expect(encodeFleetDeliveryAttempt(null, 2)).toEqual({
      attemptCursor: 2,
      continuationSequence: null,
      platformAttempt: 2,
    });
    expect(encodeFleetDeliveryAttempt(1, 1)).toEqual({
      attemptCursor: 101,
      continuationSequence: 1,
      platformAttempt: 1,
    });
  });

  it('decodes legacy cursor-only evidence without rendering 101 attempts', () => {
    const attempt = decodeFleetDeliveryAttemptCursor(101);
    expect(attempt).toEqual({
      attemptCursor: 101,
      continuationSequence: 1,
      platformAttempt: 1,
    });
    expect(fleetDeliveryAttemptLabel(attempt)).toBe(
      'continuation 1, platform attempt 1',
    );
  });

  it('prefers explicit new evidence but remains compatible with legacy detail', () => {
    expect(readFleetDeliveryAttempt({ attempt: 202 })).toEqual({
      attemptCursor: 202,
      continuationSequence: 2,
      platformAttempt: 2,
    });
    expect(readFleetDeliveryAttempt({
      attempt: 1,
      platformAttempt: 1,
      continuationSequence: 3,
      attemptCursor: 301,
    })).toEqual({
      attemptCursor: 301,
      continuationSequence: 3,
      platformAttempt: 1,
    });
  });
});
