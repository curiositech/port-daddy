// tests/unit/purser/ip-normalization-edge.test.ts
import { isLoopback } from '../../../routes/agent-harbor.ts';

describe('isLoopback – IPv6 edge‑case handling', () => {
  test.each([
    // Valid IPv4‑mapped IPv6 loopback (standard form)
    ['::ffff:127.0.0.1', true],
    // Upper‑case prefix should be accepted (case‑insensitive handling)
    ['::FFFF:127.0.0.1', true],
    // Native IPv6 loopback address
    ['::1', true],
    // IPv4‑mapped IPv6 non‑loopback address
    ['::ffff:192.168.0.1', false],
    // Malformed prefix – too many leading colons
    [':::ffff:127.0.0.1', false],
    // Extra trailing characters after the IPv4 portion
    ['::ffff:127.0.0.1abc', false],
    // Non‑string inputs – per contract they must be treated as non‑loopback
    [null as any, false],
    [undefined as any, false],
    [12345 as any, false],
    // Empty string – clearly not a loopback address
    ['', false],
    // Fully expanded IPv6 loopback (equivalent to ::1)
    ['0:0:0:0:0:0:0:1', true],
  ])('isLoopback(%p) → %p', (input, expected) => {
    expect(isLoopback(input as any)).toBe(expected);
  });
});