// tests/unit/fleet-personal-triggers.test.js
//
// Covers the generalized fleet primitives:
//   - parseTriggerSpec / parseOutputTarget
//   - ConsentGate (default-deny, grant/deny/revoke, recipient allowlist)
//   - registry builders (sources/sinks present + introspectable)
//
// No daemon round-trips. Pure-function tests.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const types = await import('../../lib/fleet/types.js');
const gateMod = await import('../../lib/fleet/consent-gate.js');
const triggers = await import('../../lib/fleet/triggers/index.js');
const outputs = await import('../../lib/fleet/outputs/index.js');

const { parseTriggerSpec, parseOutputTarget } = types;
const { ConsentGate } = gateMod;
const { buildTriggerRegistry } = triggers;
const { buildOutputRegistry } = outputs;

// Use ~/coding/tmp (the CLAUDE.md ban on /tmp), but the test harness
// passes through TMPDIR which is fine here for the duration of one run.
// We override mkdtemp prefix only.
const SCRATCH_PREFIX = join(process.env.HOME || '', 'coding', 'tmp', 'pd-fleet-test-');

function makeScratch() {
  // Fall back to os.tmpdir if ~/coding/tmp isn't available (CI).
  try {
    return mkdtempSync(SCRATCH_PREFIX);
  } catch {
    return mkdtempSync(join(tmpdir(), 'pd-fleet-test-'));
  }
}

describe('parseTriggerSpec', () => {
  it('parses email:received(from:@team.com)', () => {
    const spec = parseTriggerSpec('email:received(from:@team.com)');
    expect(spec).toEqual({
      kind: 'email',
      type: 'received',
      arg: undefined,
      filters: { from: '@team.com' },
      raw: 'email:received(from:@team.com)',
    });
  });

  it('parses calendar:event-starting(30m) with positional arg', () => {
    const spec = parseTriggerSpec('calendar:event-starting(30m)');
    expect(spec.kind).toBe('calendar');
    expect(spec.type).toBe('event-starting');
    expect(spec.arg).toBe('30m');
  });

  it('parses webhook:my-channel(secret:HMAC_VAR)', () => {
    const spec = parseTriggerSpec('webhook:my-channel(secret:HMAC_VAR)');
    expect(spec.kind).toBe('webhook');
    expect(spec.type).toBe('my-channel');
    expect(spec.filters.secret).toBe('HMAC_VAR');
  });

  it('returns null for unknown source kind', () => {
    expect(parseTriggerSpec('frobnicate:foo')).toBeNull();
  });

  it('returns null for malformed string', () => {
    expect(parseTriggerSpec('not a trigger')).toBeNull();
    expect(parseTriggerSpec('')).toBeNull();
  });
});

describe('parseOutputTarget', () => {
  it('parses notify:os', () => {
    expect(parseOutputTarget('notify:os')).toEqual({ sink: 'notify', type: 'os', arg: undefined });
  });

  it('parses file:write(~/notes/foo.md) with positional arg', () => {
    const out = parseOutputTarget('file:write(~/notes/foo.md)');
    expect(out.sink).toBe('file');
    expect(out.type).toBe('write');
    expect(out.arg).toBe('~/notes/foo.md');
  });

  it('rejects unknown sink kind', () => {
    expect(parseOutputTarget('frobnicate:os')).toBeNull();
  });
});

describe('ConsentGate', () => {
  it('allows pii=none without any grant', () => {
    const dir = makeScratch();
    const gate = new ConsentGate({
      configPath: join(dir, 'consent.json'),
      auditLogPath: join(dir, 'audit.log'),
    });
    const decision = gate.evaluate('email', { sink: 'email', type: 'send', pii: 'none' });
    expect(decision.allowed).toBe(true);
  });

  it('default-denies pii=high without a grant', () => {
    const dir = makeScratch();
    const gate = new ConsentGate({
      configPath: join(dir, 'consent.json'),
      auditLogPath: join(dir, 'audit.log'),
    });
    const decision = gate.evaluate('email', {
      sink: 'email',
      type: 'send',
      pii: 'high',
      recipient: 'someone@example.com',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/No consent grant/);
  });

  it('allows after a matching grant', () => {
    const dir = makeScratch();
    const gate = new ConsentGate({
      configPath: join(dir, 'consent.json'),
      auditLogPath: join(dir, 'audit.log'),
    });
    gate.grant({
      sink: 'email',
      maxPii: 'high',
      recipientAllowlist: ['@example.com'],
      grantedAt: Date.now(),
      reason: 'test',
    });
    const decision = gate.evaluate('email', {
      sink: 'email',
      type: 'send',
      pii: 'high',
      recipient: 'alice@example.com',
    });
    expect(decision.allowed).toBe(true);
  });

  it('refuses recipient outside the allowlist', () => {
    const dir = makeScratch();
    const gate = new ConsentGate({
      configPath: join(dir, 'consent.json'),
      auditLogPath: join(dir, 'audit.log'),
    });
    gate.grant({
      sink: 'email',
      maxPii: 'high',
      recipientAllowlist: ['@example.com'],
      grantedAt: Date.now(),
    });
    const decision = gate.evaluate('email', {
      sink: 'email',
      type: 'send',
      pii: 'high',
      recipient: 'mallory@evil.example',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/allowlist/);
  });

  it('refuses pii=high when grant capped at low', () => {
    const dir = makeScratch();
    const gate = new ConsentGate({
      configPath: join(dir, 'consent.json'),
      auditLogPath: join(dir, 'audit.log'),
    });
    gate.grant({ sink: 'file', maxPii: 'low', grantedAt: Date.now() });
    const decision = gate.evaluate('file', {
      sink: 'file',
      type: 'write',
      pii: 'high',
      recipient: '~/notes/x.md',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/capped at maxPii=low/);
  });

  it('revoke wipes the grant', () => {
    const dir = makeScratch();
    const gate = new ConsentGate({
      configPath: join(dir, 'consent.json'),
      auditLogPath: join(dir, 'audit.log'),
    });
    gate.grant({ sink: 'email', maxPii: 'high', grantedAt: Date.now() });
    gate.revoke('email');
    const decision = gate.evaluate('email', { sink: 'email', type: 'send', pii: 'high' });
    expect(decision.allowed).toBe(false);
  });

  it('audit log records every decision', () => {
    const dir = makeScratch();
    const audit = join(dir, 'audit.log');
    const gate = new ConsentGate({ configPath: join(dir, 'consent.json'), auditLogPath: audit });
    gate.evaluate('email', { sink: 'email', type: 'send', pii: 'none' });
    gate.evaluate('email', { sink: 'email', type: 'send', pii: 'high' });
    const lines = readFileSync(audit, 'utf8').trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      const entry = JSON.parse(line);
      expect(entry.sink).toBe('email');
      expect(typeof entry.allowed).toBe('boolean');
    }
  });
});

describe('buildTriggerRegistry', () => {
  it('registers every known trigger source kind', () => {
    const registry = buildTriggerRegistry({
      channelSubscribe: () => () => {},
      resolveChannel: (c) => c,
      scheduleCron: () => () => {},
      registerWebhookHandler: () => () => {},
    });
    const kinds = Array.from(registry.keys()).sort();
    expect(kinds).toEqual(['calendar', 'email', 'file', 'git', 'github', 'pd', 'schedule', 'sms', 'webhook']);
  });
});

describe('buildOutputRegistry', () => {
  it('registers every known output sink kind', () => {
    const registry = buildOutputRegistry({
      pd: {
        appendNote: async () => ({ id: 'n' }),
        sendToInbox: async () => ({ id: 'i' }),
        publishChannel: async () => {},
      },
    });
    const kinds = Array.from(registry.keys()).sort();
    expect(kinds).toEqual(['calendar', 'email', 'file', 'github', 'notify', 'pd', 'sms', 'webhook']);
  });
});
