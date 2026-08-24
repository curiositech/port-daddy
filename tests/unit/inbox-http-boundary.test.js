import { describe, expect, jest, test } from '@jest/globals';
import {
  authorizeCanonicalInboxOwner,
  createExternalInboxRateLimiter,
  parseExternalInboxContent,
  resolveCanonicalInboxTarget,
  resolveExternalInboxSender,
} from '../../lib/inbox-http-boundary.js';

function authority() {
  const verifyCredential = jest.fn((credential, harbor) => (
    credential === 'ACTOR_A.secret' && harbor === 'tenant-a' ? 'ACTOR_A' : null
  ));
  const resolveActor = jest.fn((id) => ({
    actorId: id === 'alias-a' ? 'ACTOR_A' : id,
    soulClass: id === 'ACTOR_A' || id === 'alias-a' ? 'newcomer' : 'unknown',
  }));
  const souls = {
    constants: { defaultHarbor: 'tenant-a' },
    verifyCredential,
    resolveActor,
  };
  const resolver = {
    resolveLiveActorInbox: jest.fn((actorId, harbor) => ({
      success: true,
      binding: {
        actorId,
        harbor,
        inboxTarget: actorId,
        boundAt: 1,
        lastHeartbeat: 1,
      },
    })),
  };
  return { souls, resolver, verifyCredential };
}

describe('inbox HTTP authority boundary', () => {
  test('owner reads require the exact canonical actor and tenant-scoped credential', () => {
    const { souls, resolver, verifyCredential } = authority();
    const owner = authorizeCanonicalInboxOwner({
      souls,
      resolver,
      headers: { 'x-actor-credential': 'ACTOR_A.secret' },
      requestedActorId: 'ACTOR_A',
      route: 'GET /inbox',
    });

    expect(owner).toEqual({
      ok: true,
      actorId: 'ACTOR_A',
      harbor: 'tenant-a',
      inboxTarget: 'ACTOR_A',
    });
    expect(verifyCredential).toHaveBeenCalledWith('ACTOR_A.secret', 'tenant-a');
  });

  test('missing credentials fail closed before any live inbox lookup', () => {
    const { souls, resolver } = authority();
    const result = authorizeCanonicalInboxOwner({
      souls,
      resolver,
      headers: {},
      requestedActorId: 'ACTOR_A',
      route: 'GET /inbox',
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 401, code: 'IDENTITY_CREDENTIAL_REQUIRED' });
    expect(resolver.resolveLiveActorInbox).not.toHaveBeenCalled();
  });

  test('a same-soul display alias never becomes the inbox party', () => {
    const { souls, resolver } = authority();
    const result = authorizeCanonicalInboxOwner({
      souls,
      resolver,
      headers: { 'x-actor-credential': 'ACTOR_A.secret' },
      requestedActorId: 'alias-a',
      route: 'GET /inbox',
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 403, code: 'INBOX_OWNER_MISMATCH' });
    expect(resolver.resolveLiveActorInbox).not.toHaveBeenCalled();
  });

  test('target lookup rejects a non-canonical binding returned by the registry', () => {
    const { souls } = authority();
    const result = resolveCanonicalInboxTarget({
      souls,
      requestedActorId: 'ACTOR_A',
      resolver: {
        resolveLiveActorInbox: () => ({
          success: true,
          binding: {
            actorId: 'ACTOR_A',
            harbor: 'tenant-a',
            inboxTarget: 'victim-alias',
            boundAt: 1,
            lastHeartbeat: 1,
          },
        }),
      },
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 503, code: 'ACTOR_INBOX_BINDING_INVALID' });
  });

  test.each(['from', 'type', 'wake', 'project', 'harbor', 'identity', 'provenance', 'deliveryKey'])
  ('external content rejects caller authority field %s', (field) => {
    const result = parseExternalInboxContent({ content: 'hello', [field]: 'forged' });
    expect(result).toMatchObject({
      ok: false,
      httpStatus: 400,
      code: 'INBOX_AUTHORITY_OVERRIDE_FORBIDDEN',
    });
  });

  test('external content is bounded and limited to text or JSON', () => {
    expect(parseExternalInboxContent({ content: 'ok' })).toMatchObject({
      ok: true,
      contentType: 'text',
      bytes: 2,
    });
    expect(parseExternalInboxContent({ content: 'x'.repeat(9) }, 8)).toMatchObject({
      ok: false,
      httpStatus: 413,
      code: 'INBOX_CONTENT_TOO_LARGE',
    });
    expect(parseExternalInboxContent({ content: 'AA==', contentType: 'binary' })).toMatchObject({
      ok: false,
      code: 'INBOX_CONTENT_TYPE_INVALID',
    });
    expect(parseExternalInboxContent({ content: 'hello', credential: 'ACTOR_A.secret' })).toMatchObject({
      ok: false,
      code: 'INBOX_AUTHORITY_OVERRIDE_FORBIDDEN',
    });
    expect(parseExternalInboxContent({ content: 'hello', futureOverride: true })).toMatchObject({
      ok: false,
      code: 'INBOX_FIELD_UNSUPPORTED',
    });
  });

  test('anonymous and authenticated sends get daemon-selected provenance', () => {
    const { souls, resolver } = authority();
    const anonymous = resolveExternalInboxSender({
      souls,
      resolver,
      headers: {},
      harbor: 'tenant-a',
      route: 'POST /inbox',
    });
    const authenticated = resolveExternalInboxSender({
      souls,
      resolver,
      headers: { 'x-actor-credential': 'ACTOR_A.secret' },
      harbor: 'tenant-a',
      route: 'POST /inbox',
    });

    expect(anonymous).toEqual({
      ok: true,
      from: 'external:anonymous',
      messageType: 'external.anonymous',
      provenance: { kind: 'anonymous-external', actorId: null, harbor: 'tenant-a' },
    });
    expect(authenticated).toEqual({
      ok: true,
      from: 'ACTOR_A',
      messageType: 'external.authenticated',
      provenance: { kind: 'authenticated-external', actorId: 'ACTOR_A', harbor: 'tenant-a' },
    });
  });

  test('rate limits use fixed anonymous, canonical actor, target, and global buckets', () => {
    let now = 100;
    const limiter = createExternalInboxRateLimiter({
      now: () => now,
      windowMs: 1_000,
      anonymousLimit: 1,
      actorLimit: 2,
      targetLimit: 3,
      globalLimit: 4,
    });

    expect(limiter.consume({ senderActorId: null, targetActorId: 'A' })).toEqual({ ok: true });
    expect(limiter.consume({ senderActorId: null, targetActorId: 'B' })).toMatchObject({ ok: false, scope: 'anonymous' });
    expect(limiter.consume({ senderActorId: 'S', targetActorId: 'A' })).toEqual({ ok: true });
    expect(limiter.consume({ senderActorId: 'S', targetActorId: 'B' })).toEqual({ ok: true });
    expect(limiter.consume({ senderActorId: 'S', targetActorId: 'B' })).toMatchObject({ ok: false, scope: 'actor' });
    now += 1_001;
    expect(limiter.consume({ senderActorId: null, targetActorId: 'B' })).toEqual({ ok: true });
  });
});
