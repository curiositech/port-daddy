/**
 * Fail-closed regression tests for operatorOnly() (PR #340 / #697).
 *
 * operatorOnly() gates every operator-only endpoint. Before the fail-closed
 * guard, a misconfigured deployment (RELAY_OPERATOR_TOKEN unset or empty) was a
 * SILENT AUTH BYPASS: the token comparison is timingSafeEqual(bearer, secret),
 * and timingSafeEqual('', '') === true — so a request bearing an empty token
 * matched the empty secret and operatorOnly returned null (== "authorized").
 * (An `undefined` secret was worse still: `.length` threw.)
 *
 * These tests PROVE the guard fail-closes: in every misconfigured state the
 * guard returns a 500 Response — never null — including for the exact request
 * that WOULD be authorized if the guard were absent. They also pin the 32-char
 * boundary so a well-configured token still authenticates normally (the guard
 * is a length floor, not a blanket reject).
 */

import { describe, it, expect } from 'vitest';
import { operatorOnly } from '../src/handlers.js';
import { timingSafeEqual } from '../src/crypto.js';
import type { Env } from '../src/types.js';

// operatorOnly only reads env.RELAY_OPERATOR_TOKEN; nothing else is touched.
function envWithToken(token: string | undefined): Env {
  return { RELAY_OPERATOR_TOKEN: token } as unknown as Env;
}

// Build a request with a chosen Authorization header (or none).
function reqWithBearer(bearer?: string): Request {
  const headers: Record<string, string> = {};
  if (bearer !== undefined) headers['Authorization'] = `Bearer ${bearer}`;
  return new Request('https://relay.example.com/v1/fleet/config', { headers });
}

const VALID_TOKEN = 'k'.repeat(32); // exactly the 32-char minimum

describe('operatorOnly — fail-closed on misconfiguration', () => {
  // The precondition that makes this a real vulnerability, asserted directly so
  // the "bypass" the guard closes is not hypothetical.
  it('timingSafeEqual("", "") is true — the empty-secret/empty-token bypass exists absent the guard', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('undefined token: rejects with 500 MISCONFIGURED instead of throwing on .length', async () => {
    const res = operatorOnly(reqWithBearer('anything'), envWithToken(undefined));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(500);
    expect((await res!.json() as { code: string }).code).toBe('MISCONFIGURED');
  });

  it('PROVES no bypass: empty secret + empty bearer (would authenticate absent the guard) still 500s, never null', async () => {
    // Without the guard this is the worst case: token '' === secret '' via
    // timingSafeEqual, so operatorOnly would return null (authorized). The guard
    // must instead deny. We assert it returns a Response (not the null "allow").
    const res = operatorOnly(reqWithBearer(''), envWithToken(''));
    expect(res).not.toBeNull();
    expect(res).toBeInstanceOf(Response);
    expect(res!.status).toBe(500);
    expect((await res!.json() as { code: string }).code).toBe('MISCONFIGURED');
  });

  it('empty secret + no Authorization header at all: 500, not null', async () => {
    const res = operatorOnly(reqWithBearer(undefined), envWithToken(''));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(500);
  });

  it('too-short secret (31 chars, one below the floor): 500 MISCONFIGURED', async () => {
    const shortToken = 'k'.repeat(31);
    // Even a request bearing the *correct* short token is denied — the deployment
    // is misconfigured regardless of what the caller presents.
    const res = operatorOnly(reqWithBearer(shortToken), envWithToken(shortToken));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(500);
    expect((await res!.json() as { code: string }).code).toBe('MISCONFIGURED');
  });

  it('names RELAY_OPERATOR_TOKEN in the 500 body so misconfig triage is fast', async () => {
    const res = operatorOnly(reqWithBearer('x'), envWithToken('short'));
    const body = await res!.json() as { error: string };
    expect(body.error).toContain('RELAY_OPERATOR_TOKEN');
  });
});

describe('operatorOnly — well-configured token authenticates normally', () => {
  it('accepts a matching bearer at the 32-char boundary (returns null = proceed)', () => {
    const res = operatorOnly(reqWithBearer(VALID_TOKEN), envWithToken(VALID_TOKEN));
    expect(res).toBeNull();
  });

  it('rejects a wrong bearer with 401 UNAUTHORIZED (not 500) — proves the guard is a length floor, not a blanket reject', async () => {
    const res = operatorOnly(reqWithBearer('wrong-but-long-enough-token-abcdef'), envWithToken(VALID_TOKEN));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    expect((await res!.json() as { code: string }).code).toBe('UNAUTHORIZED');
  });

  it('rejects a missing bearer against a valid secret with 401 (not 500)', async () => {
    const res = operatorOnly(reqWithBearer(undefined), envWithToken(VALID_TOKEN));
    expect(res!.status).toBe(401);
  });
});
