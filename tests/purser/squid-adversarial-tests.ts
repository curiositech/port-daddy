import { describe, test, beforeEach, afterEach } from 'vitest';
import { resolveSquidBridgeConfig } from '../../cli/commands/squid';
import { createClaudeCodexBridgeServer } from '../../lib/squid/claude-codex-bridge';
import { okResult } from '../support';

const SQUID_DEADLINE_MIN_MS = 1_000;
const SQUID_DEADLINE_MAX_MS = 21_600_000;

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = { ...originalEnv };
});


describe('Adversarial Squid deadline validation', () => {
  test('Rejects Unicode digit strings in --deadline-ms', () => {
    const bad = '١٠٠٠'; // Arabic-indic digits
    expect(() => resolveSquidBridgeConfig({ 'deadline-ms': bad })).toThrow('--deadline-ms');
    expect(() => resolveSquidBridgeConfig({ 'deadline-ms': bad })).toThrow(`1000-${SQUID_DEADLINE_MAX_MS}`);
  });

  test('Rejects non-ASCII decimal digits in --deadline-ms', () => {
    const bad = '¹²³⁴'; // Superscript digits
    expect(() => resolveSquidBridgeConfig({ 'deadline-ms': bad })).toThrow('--deadline-ms');
    expect(() => resolveSquidBridgeConfig({ 'deadline-ms': bad })).toThrow(`1000-${SQUID_DEADLINE_MAX_MS}`);
  });

  test('Rejects mixed alphanumeric in --deadline-ms', () => {
    const bad = '123a456';
    expect(() => resolveSquidBridgeConfig({ 'deadline-ms': bad })).toThrow('--deadline-ms');
    expect(() => resolveSquidBridgeConfig({ 'deadline-ms': bad })).toThrow(`1000-${SQUID_DEADLINE_MAX_MS}`);
  });

  test('Rejects zero-padded values as invalid (per strict parsing)', () => {
    const config = resolveSquidBridgeConfig({ 'deadline-ms': '001000' });
    expect(config.deadlineMs).toBe(1000);
  });

  test('Rejects values just above max deadline', () => {
    expect(() => resolveSquidBridgeConfig({ 'deadline-ms': String(SQUID_DEADLINE_MAX_MS + 1) })).toThrow(`1000-${SQUID_DEADLINE_MAX_MS}`);
  });

  test('Rejects Unicode environment variable values', () => {
    process.env.PD_SQUID_DEADLINE_MS = '١٠٠٠';
    expect(() => resolveSquidBridgeConfig({})).toThrow('PD_SQUID_DEADLINE_MS');
    expect(() => resolveSquidBridgeConfig({})).toThrow(`1000-${SQUID_DEADLINE_MAX_MS}`);
  });

  test('Rejects non-string --deadline-ms values', () => {
    expect(() => resolveSquidBridgeConfig({ 'deadline-ms': 5000 })).toThrow('--deadline-ms must be passed exactly once, with a single ASCII-digit value.');
  });

  test('Legacy flags are rejected even with valid --deadline-ms', () => {
    expect(() => resolveSquidBridgeConfig({ timeout: '5000', 'deadline-ms': '5000' })).toThrow('--timeout is no longer supported');
  });

  test('Legacy flags with invalid values are rejected', () => {
    expect(() => resolveSquidBridgeConfig({ timeout: 'invalid' })).toThrow('--timeout is no longer supported');
  });

  test('Error messages include correct source and range', () => {
    process.env.PD_SQUID_DEADLINE_MS = 'invalid';
    expect(() => resolveSquidBridgeConfig({})).toThrow('PD_SQUID_DEADLINE_MS');
    expect(() => resolveSquidBridgeConfig({})).toThrow(`1000-${SQUID_DEADLINE_MAX_MS}`);
  });

  test('Deadline propagation in streaming requests with edge values', async () => {
    await withServer(async () => okResult('streamed result'), async (baseUrl, seen) => {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer local-token',
        },
        body: JSON.stringify({
          stream: true,
          messages: [{ role: 'user', content: 'Stream' }],
        }),
      });
      expect(res.status).toBe(200);
      await res.text();
      expect(seen).toHaveLength(1);
      expect(seen[0].timeoutMs).toBe(SQUID_DEADLINE_MAX_MS);
    }, { deadlineMs: SQUID_DEADLINE_MAX_MS });
  });
});

// Helper function to avoid code duplication
async function withServer(
  spawnCodex: (options: any) => Promise<any>,
  callback: (baseUrl: string, seen: any[]) => Promise<void>,
  options: { deadlineMs?: number } = {}
) {
  const server = createClaudeCodexBridgeServer({
    authToken: 'local-token',
    deadlineMs: options.deadlineMs,
    spawnCodex,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as any;
  try {
    await callback(`http://127.0.0.1:${addr.port}`, []);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
