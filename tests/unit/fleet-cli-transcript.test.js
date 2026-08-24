/**
 * pd fleet transcript — the terminal surface over the relay's pd-transcript.v1
 * read path (Phase 3 of docs/FLEET-SESSION-TRANSCRIPTS.md).
 *
 * Invariants under test:
 *   1. Relay URL + credential resolve from env (PD_RELAY_URL /
 *      PD_RELAY_OPERATOR_TOKEN); a bearer rides the Authorization header while
 *      a pasted `v1.<hmac>` run-page capability token rides `?t=` — exactly
 *      the two credential shapes the relay accepts.
 *   2. Without a ship, the transcripts.json ledger renders as a table; with a
 *      ship, the .jsonl prints as turn headers with prompts FOLDED by default
 *      (--full opens them), mirroring the web viewer's <details> posture.
 *   3. A relay 404 (unknown/unauthorized — indistinguishable by design) exits
 *      non-zero with an honest message, never a stack trace.
 */

import { jest } from '@jest/globals';

const mockPdFetch = jest.fn();
const mockUi = {
  error: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  warn: jest.fn(),
  dim: jest.fn((s) => s),
};
const mockLoadFleetConfig = jest.fn();
const mockResolveFleetAgentRuntime = jest.fn();
const mockAssessBackendReadiness = jest.fn();

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  pdFetch: mockPdFetch,
  PORT_DADDY_URL: 'http://localhost:9876',
  isDaemonRunning: jest.fn(),
  getDaemonUrl: jest.fn(() => 'http://localhost:9876'),
}));

jest.unstable_mockModule('../../cli/utils/ui.js', () => mockUi);

jest.unstable_mockModule('../../cli/utils/post-commit-hook.js', () => ({
  isLegacyPortDaddyPostCommitHook: jest.fn(() => false),
  isScopedPortDaddyPostCommitHook: jest.fn(() => false),
  loadPostCommitHookTemplate: jest.fn(() => '#!/bin/zsh\n'),
}));

jest.unstable_mockModule('../../lib/fleet-engine.js', () => ({
  findFleetConfigPath: jest.fn(() => '/tmp/pd-fleet.yml'),
  loadFleetConfig: mockLoadFleetConfig,
  createFleetRunner: jest.fn(),
  getFleetRuntimeDefaults: jest.fn(() => ({})),
  resolveFleetAgentRuntime: mockResolveFleetAgentRuntime,
  validateTopology: jest.fn(() => ({ valid: true, cycle: null })),
}));

jest.unstable_mockModule('../../lib/backend-readiness.js', () => ({
  assessBackendReadiness: mockAssessBackendReadiness,
}));

jest.unstable_mockModule('../../lib/fleet-channels.js', () => ({
  resolveFleetChannel: jest.fn((channel) => channel),
}));

const { handleFleet } = await import('../../cli/commands/fleet.js');

const RUN = 'run:abc';
const LEDGER = {
  runId: RUN,
  transcripts: [
    {
      ship: 'qa', attempt: 2, turns: 3, bytes: 900, models: ['@cf/test/model'],
      promptTokens: 120, completionTokens: 30, costUsd: 0.0012, incomplete: false,
      createdAt: 1700000000,
      viewerPath: `/fleet/runs/${encodeURIComponent(RUN)}/transcript/qa?attempt=2`,
      jsonlPath: `/fleet/runs/${encodeURIComponent(RUN)}/transcript/qa.jsonl?attempt=2`,
    },
  ],
};
// COMPLETE pd-transcript.v1 envelopes, exactly as the producer writes them —
// the --validate tests depend on every always-written field being present.
const JSONL =
  JSON.stringify({ v: 1, runId: RUN, ship: 'qa', attempt: 2, seq: 0, kind: 'system', phase: 'map', chunk: null, model: 'm', ts: 1700000000, latencyMs: null, usage: null, costUsd: null, content: [{ type: 'text', text: 'You are pd-qa.' }], sysRef: 'fnv1a:aa:14', truncated: false }) + '\n' +
  JSON.stringify({ v: 1, runId: RUN, ship: 'qa', attempt: 2, seq: 1, kind: 'assistant', phase: 'map', chunk: null, model: 'm', ts: 1700000004, latencyMs: 900, usage: { prompt: 120, completion: 30 }, costUsd: 0.001, content: [{ type: 'text', text: 'FLEET-VERDICT: PASS' }], sysRef: null, truncated: false }) + '\n';

function relayResponse(status, body, isText = false) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (isText ? body : JSON.stringify(body)),
  };
}

describe('pd fleet transcript', () => {
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalFetch = global.fetch;
  const originalEnv = { url: process.env.PD_RELAY_URL, tok: process.env.PD_RELAY_OPERATOR_TOKEN };
  let mockFetch;

  beforeEach(() => {
    jest.clearAllMocks();
    process.exit = jest.fn((code) => { throw new Error(`exit:${code}`); });
    console.log = jest.fn();
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    process.env.PD_RELAY_URL = 'https://relay.example';
    process.env.PD_RELAY_OPERATOR_TOKEN = 'op-token-0123456789abcdef0123456789abcdef';
  });

  afterAll(() => {
    process.exit = originalExit;
    console.log = originalLog;
    global.fetch = originalFetch;
    if (originalEnv.url === undefined) delete process.env.PD_RELAY_URL;
    else process.env.PD_RELAY_URL = originalEnv.url;
    if (originalEnv.tok === undefined) delete process.env.PD_RELAY_OPERATOR_TOKEN;
    else process.env.PD_RELAY_OPERATOR_TOKEN = originalEnv.tok;
  });

  test('lists the ledger as a table under an env bearer, without touching the daemon', async () => {
    mockFetch.mockResolvedValueOnce(relayResponse(200, LEDGER));

    await handleFleet(['transcript', RUN], {});

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`https://relay.example/fleet/runs/${encodeURIComponent(RUN)}/transcripts.json`);
    expect(init.headers.Authorization).toBe('Bearer op-token-0123456789abcdef0123456789abcdef');
    expect(mockPdFetch).not.toHaveBeenCalled();
    const output = console.log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('pd-qa');
    expect(output).toContain('120/30');
  });

  test('prints a ship session with prompts folded; --full opens them; --raw is verbatim', async () => {
    mockFetch
      .mockResolvedValueOnce(relayResponse(200, LEDGER))
      .mockResolvedValueOnce(relayResponse(200, JSONL, true));

    await handleFleet(['transcript', RUN, 'qa'], {});

    const jsonlUrl = mockFetch.mock.calls[1][0];
    expect(jsonlUrl).toBe(
      `https://relay.example/fleet/runs/${encodeURIComponent(RUN)}/transcript/qa.jsonl`,
    );
    const output = console.log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('#t1 ASSISTANT MAP');
    expect(output).toContain('FLEET-VERDICT: PASS');
    expect(output).toContain('pass --full to print'); // system prompt folded
    expect(output).not.toContain('You are pd-qa.');

    console.log.mockClear();
    mockFetch
      .mockResolvedValueOnce(relayResponse(200, LEDGER))
      .mockResolvedValueOnce(relayResponse(200, JSONL, true));
    await handleFleet(['transcript', RUN, 'qa'], { full: true });
    const fullOut = console.log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(fullOut).toContain('You are pd-qa.');
  });

  test('--json prints the raw ledger for machine consumption, not the table', async () => {
    mockFetch.mockResolvedValueOnce(relayResponse(200, LEDGER));

    await handleFleet(['transcript', RUN], { json: true });

    const output = console.log.mock.calls.map((c) => c.join(' ')).join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.runId).toBe(RUN);
    expect(parsed.transcripts[0]).toMatchObject({ ship: 'qa', attempt: 2, turns: 3 });
    expect(output).not.toContain('SHIP '); // no table header in machine output
  });

  test('a pasted v1.<hmac> capability token rides ?t=, not the Authorization header', async () => {
    delete process.env.PD_RELAY_OPERATOR_TOKEN;
    mockFetch.mockResolvedValueOnce(relayResponse(200, LEDGER));

    await handleFleet(['transcript', RUN], { token: 'v1.deadbeef' });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('?t=v1.deadbeef');
    expect(init.headers.Authorization).toBeUndefined();
  });

  test('a relay 404 exits non-zero with the honest indistinguishability message', async () => {
    mockFetch.mockResolvedValueOnce(relayResponse(404, { error: 'not found' }));

    await expect(handleFleet(['transcript', RUN], {})).rejects.toThrow('exit:1');
    expect(mockUi.error).toHaveBeenCalledWith(expect.stringContaining('indistinguishable'));
  });

  test('--validate judges a fetched session: exit 0 when clean, exit 1 naming each violation', async () => {
    mockFetch
      .mockResolvedValueOnce(relayResponse(200, LEDGER))
      .mockResolvedValueOnce(relayResponse(200, JSONL, true));
    await expect(handleFleet(['transcript', RUN, 'qa'], { validate: true })).rejects.toThrow('exit:0');
    expect(mockUi.success).toHaveBeenCalledWith(expect.stringContaining('all valid pd-transcript.v1'));

    console.log.mockClear();
    const bad =
      JSON.stringify({ v: 2, seq: 0, kind: 'assistant', phase: 'map', content: [], truncated: false }) + '\n' +
      'not-json\n' +
      JSON.stringify({ v: 1, seq: 0, kind: 'oracle', phase: 'mystery', content: 'nope', truncated: 'yes' }) + '\n' +
      JSON.stringify({ v: 1, seq: 0, kind: 'assistant', phase: 'map', content: [], chunk: null, usage: null, truncated: false }) + '\n';
    mockFetch
      .mockResolvedValueOnce(relayResponse(200, LEDGER))
      .mockResolvedValueOnce(relayResponse(200, bad, true));
    await expect(handleFleet(['transcript', RUN, 'qa'], { validate: true })).rejects.toThrow('exit:1');
    const report = console.log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(report).toContain('line 1: INVALID — v must be the number 1');
    expect(report).toContain('line 2: INVALID — not JSON');
    expect(report).toContain('kind must be one of');
    expect(report).toContain('phase must be one of');
    expect(report).toContain('content must be a parts array');
    expect(report).toContain('truncated must be a boolean');
    expect(report).toContain('runId must be a non-empty string');
    expect(report).toContain('model must be a non-empty string');
    // Cross-line rule: line 4 reuses seq 0 after line 3's seq 0.
    expect(report).toMatch(/line 4: INVALID — .*seq 0 does not increase past 0/);
    expect(mockUi.error).toHaveBeenCalledWith(expect.stringContaining('4 invalid line(s), 0 valid'));
  });

  test('--file validates a local capture with no relay, no credentials, no daemon', async () => {
    delete process.env.PD_RELAY_URL;
    delete process.env.PD_RELAY_OPERATOR_TOKEN;
    const os = await import('node:os');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const file = path.join(os.tmpdir(), `pd-transcript-validate-${process.pid}.jsonl`);
    fs.writeFileSync(file, JSONL);
    try {
      await expect(handleFleet(['transcript'], { file })).rejects.toThrow('exit:0');
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockPdFetch).not.toHaveBeenCalled();
      expect(mockUi.success).toHaveBeenCalledWith(expect.stringContaining('all valid pd-transcript.v1'));
    } finally {
      fs.unlinkSync(file);
    }
  });

  test('--attempt N is forwarded to the .jsonl route', async () => {
    mockFetch
      .mockResolvedValueOnce(relayResponse(200, LEDGER))
      .mockResolvedValueOnce(relayResponse(200, JSONL, true));

    await handleFleet(['transcript', RUN, 'qa'], { attempt: '1', raw: true });

    expect(mockFetch.mock.calls[1][0]).toContain('.jsonl?attempt=1');
  });
});
