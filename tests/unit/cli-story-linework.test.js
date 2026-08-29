import {
  LINEWORK_SIGNALS,
  LINEWORK_STATES,
  lineworkEnabled,
  lineworkPolicy,
  lineworkSignal,
  lineworkVisual,
  renderLineworkPanel,
  visibleWidth,
} from '../../cli/utils/ui.js';
import { detectTerminalCapabilities } from '../../cli/utils/output.js';
import {
  renderStatusFailureOutput,
  renderStatusFailureLinework,
  renderStatusLinework,
  renderStatusOutput,
  renderStatusPlain,
  runStatus,
} from '../../cli/commands/diagnostics.js';
import { dispatchState } from '../../cli/commands/dispatch.js';

function stripAnsi(value) {
  return value.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

describe('CLI story-linework renderer', () => {
  const envSnapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  test('state fixture covers healthy, pending, unknown, recovering, confirmed, blocked, and failed next action', () => {
    const rendered = renderLineworkPanel({
      title: 'Proof',
      subtitle: 'state grammar',
      tone: 'running',
      zone: 'bounded live content',
      width: 72,
      colorLevel: 'none',
      styled: false,
      rows: [
        { state: 'healthy', label: 'healthy', text: 'daemon heartbeat now' },
        { state: 'pending', label: 'pending', text: 'proposal waiting for review' },
        { state: 'unknown', label: 'unknown', text: 'worker health not reported' },
        { state: 'recovering', label: 'recovering', text: 'salvage available' },
        { state: 'confirmed', label: 'confirmed', text: 'receipt stored' },
        { state: 'guard-blocked', label: 'blocked', text: 'guard stopped the commit' },
        { state: 'failed', label: 'failed', text: 'spawn failed; next: inspect transcript' },
      ],
      footer: 'golden no-color shape',
    });

    expect(rendered).toMatchInlineSnapshot(`
"Proof  state grammar
bounded live content
healthy: daemon heartbeat now
pending: proposal waiting for review
unknown: worker health not reported
recovering: salvage available
[C] confirmed: receipt stored
[F] blocked: guard stopped the commit
failed: spawn failed; next: inspect transcript
golden no-color shape"
`);
  });

  test('narrow terminal output stays within the requested width after ANSI stripping', () => {
    const rendered = renderLineworkPanel({
      title: 'Port Daddy',
      subtitle: 'daemon · :9876 · very long subtitle that must truncate',
      tone: 'running',
      zone: 'daemon confirmed',
      width: 44,
      colorLevel: 'truecolor',
      rows: [
        { state: 'healthy', label: 'daemon', text: 'pid 123 · up 11h 42m · 65 ports' },
        { state: 'guard-blocked', label: 'next', text: 'operator action required before continuing' },
      ],
      footer: 'guard enforce · budget $0.00/$8.50',
    });

    for (const line of rendered.split('\n')) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(44);
    }
    expect(rendered).toContain('\x1b[38;2;95;206;151m▌');
    expect(stripAnsi(rendered)).toContain('██F');
    expect(stripAnsi(rendered)).toContain('operator action required');
  });

  test('16, 256, and truecolor ANSI levels degrade predictably', () => {
    expect(lineworkSignal('Q', { colorLevel: '16' })).toContain('\x1b[33m');
    expect(lineworkSignal('Q', { colorLevel: '256' })).toContain('\x1b[38;5;190m');
    expect(lineworkSignal('Q', { colorLevel: 'truecolor' })).toContain('\x1b[38;2;219;234;0m');

    const kilo = lineworkSignal('K', { colorLevel: 'truecolor' });
    expect(kilo).toContain('\x1b[38;2;219;234;0m');
    expect(kilo).toContain('\x1b[38;2;30;72;190m');
    expect(stripAnsi(kilo)).toBe('██K');

    const ansi16Panel = renderLineworkPanel({
      title: 'Port Daddy',
      tone: 'running',
      rows: [],
      colorLevel: '16',
    });
    expect(ansi16Panel).toContain('\x1b[44m\x1b[37m');
  });

  test('NO_COLOR, pipe/plain, and JSON suppress styling', () => {
    process.env.NO_COLOR = '1';
    delete process.env.FORCE_COLOR;
    expect(lineworkEnabled()).toBe(false);

    process.env.NO_COLOR = '';
    process.env.FORCE_COLOR = '3';
    expect(lineworkEnabled({ json: true })).toBe(false);
    expect(lineworkEnabled({ quiet: true })).toBe(false);

    const plain = renderLineworkPanel({
      title: 'Pipe',
      rows: [{ tone: 'healthy', label: 'ok', text: 'plain contract', signal: 'Q' }],
      colorLevel: 'none',
    });
    expect(plain).not.toMatch(/\x1b\[/);
    expect(plain).toContain('[Q] ok: plain contract');
  });

  test('signal registry carries registered ICOS meanings for visual states', () => {
    expect(LINEWORK_SIGNALS.Q.meaning).toMatch(/healthy/);
    expect(LINEWORK_SIGNALS.X.meaning).toMatch(/Stop carrying out/);
    expect(LINEWORK_SIGNALS.N.meaning).toMatch(/negative/i);
    expect(LINEWORK_SIGNALS.O.meaning).toMatch(/Man overboard/);
    expect(LINEWORK_SIGNALS.R.meaning).toMatch(/No 1969 single-letter meaning/);
  });

  test('semantic states resolve through one registered tone and signal vocabulary', () => {
    expect(lineworkVisual('awaiting-human')).toEqual(LINEWORK_STATES['awaiting-human']);
    expect(lineworkVisual('awaiting-human')).toMatchObject({ tone: 'blocked', signal: 'F' });
    expect(lineworkVisual('conflict')).toMatchObject({ tone: 'blocked', signal: 'V' });
    expect(lineworkVisual('guard-blocked')).toMatchObject({ tone: 'blocked', signal: 'F' });
    expect(lineworkVisual('recovering')).toMatchObject({ tone: 'recovering' });
    expect(lineworkVisual('recovering').signal).toBeUndefined();
    expect(lineworkVisual('healthy').signal).toBeUndefined();
    expect(lineworkVisual('fleet-healthy')).toMatchObject({ tone: 'healthy', signal: 'P' });
    expect(lineworkVisual('pending').signal).toBeUndefined();
    expect(lineworkVisual('unknown').signal).toBeUndefined();
    expect(lineworkVisual('failed').signal).toBeUndefined();
  });

  test.each([
    ['json', { json: true, capabilities: { env: {}, isTTY: true } }, 'json'],
    ['quiet', { quiet: true, capabilities: { env: {}, isTTY: true } }, 'quiet'],
    ['NO_COLOR presence', { capabilities: { env: { NO_COLOR: '' }, isTTY: true } }, 'no-color'],
    ['TERM=dumb', { capabilities: { env: { TERM: 'dumb' }, isTTY: true } }, 'dumb-terminal'],
    ['pipe', { capabilities: { env: {}, isTTY: false } }, 'not-tty'],
    ['FORCE_COLOR=0', { capabilities: { env: { FORCE_COLOR: '0' }, isTTY: true } }, 'force-color-disabled'],
  ])('%s disables structured human rendering with an explicit reason', (_name, options, reason) => {
    expect(lineworkPolicy(options)).toMatchObject({ enabled: false, reason });
  });

  test('terminal capability detection honors explicit truecolor and 256-color overrides', () => {
    expect(detectTerminalCapabilities('stdout', {
      env: { COLORTERM: 'truecolor' },
      isTTY: true,
      columns: 132,
    })).toMatchObject({ colorLevel: 'truecolor', columns: 132, unicode: true, reason: 'enabled' });
    expect(detectTerminalCapabilities('stderr', {
      env: { TERM: 'xterm-256color' },
      isTTY: true,
    })).toMatchObject({ colorLevel: '256', reason: 'enabled' });
  });

  test('width accounting handles combining marks, emoji ZWJ sequences, and narrow panels', () => {
    expect(visibleWidth('e\u0301')).toBe(1);
    expect(visibleWidth('👩‍💻')).toBe(2);
    expect(visibleWidth('🇺🇸')).toBe(2);
    expect(visibleWidth('👍🏽')).toBe(2);
    expect(visibleWidth('1️⃣')).toBe(2);
    expect(visibleWidth('👨‍👩‍👧‍👦')).toBe(2);
    expect(visibleWidth('©️')).toBe(2);
    expect(visibleWidth('界')).toBe(2);
    expect(visibleWidth('\x1b[31m👍🏽界\x1b[0m')).toBe(4);

    for (const width of [20, 24, 31, 39]) {
      const rendered = renderLineworkPanel({
        title: 'Narrow',
        width,
        colorLevel: '16',
        rows: [{ state: 'active', label: 'worker', text: 'full truth wraps instead of disappearing' }],
      });
      for (const line of rendered.split('\n')) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      expect(stripAnsi(rendered)).toContain('disappearing');
    }
  });

  test.each([
    ['proposed', 'pending'],
    ['claimed', 'active'],
    ['in_progress', 'active'],
    ['produced', 'pending'],
    ['review_pending', 'pending'],
    ['accepted', 'confirmed'],
    ['rejected', 'refused'],
    ['settled', 'confirmed'],
    ['failed', 'failed'],
    ['salvage', 'recovering'],
  ])('maps dispatch state %s exhaustively to %s', (state, visual) => {
    expect(dispatchState(state)).toBe(visual);
  });
});

describe('pd status story-linework output', () => {
  test('healthy status has a linework golden and no decorative emoji in plain output', () => {
    const data = {
      status: 'ok',
      severity: 'ok',
      version: '3.24.2',
      pid: 123,
      uptimeSeconds: 72,
      uptimeHuman: '1m 12s',
      active_ports: 2,
      daemon: { version: '3.24.2', codeHash: 'abcdef0' },
      metrics: { activePorts: 2 },
      runtime: { state: 'nominal', degraded: false },
      fleet: { projects: [{}], totalAgents: 3, totalLaunchableAgents: 2 },
      guardians: { bosun: { state: 'idle', reason: 'daemon heartbeat writer active' } },
      history: { lastActivityAt: Date.now() },
    };

    const linework = stripAnsi(renderStatusLinework(data, { width: 72, colorLevel: '16' }));
    expect(linework).toContain('PORT DADDY');
    expect(linework).toContain('daemon');
    expect(linework).toContain('fleet');

    const plain = renderStatusPlain({
      ...data,
      fleet: { projects: [{}], totalAgents: 3, totalLaunchableAgents: 0 },
    });
    expect(plain).toContain('WARN no launchable backend');
    expect(plain).not.toContain('⚠');
  });

  test('daemon-down status renders failed-with-next-action state', () => {
    const rendered = renderStatusFailureLinework({ width: 78, colorLevel: 'none', styled: false });

    expect(rendered).toContain('failed with next action');
    expect(rendered).toContain('daemon: DAEMON_UNAVAILABLE · Port Daddy daemon is not accepting status requests');
    expect(rendered).not.toContain('[N] daemon');
    expect(rendered).toContain('[F] next');
    expect(rendered).toContain('diagnose: run pd doctor');
    expect(rendered).toContain('open FleetBar and restart the daemon');
    expect(rendered).toContain('exit 1');
  });

  test('JSON mode preserves structured healthy and failure contracts', () => {
    const healthy = JSON.parse(renderStatusOutput({
      status: 'ok',
      severity: 'ok',
      version: '3.24.2',
      pid: 123,
      runtime: { state: 'nominal', degraded: false },
    }, { json: true }));
    expect(healthy).toMatchObject({ success: true, version: '3.24.2', pid: 123 });

    const failure = JSON.parse(renderStatusFailureOutput({ json: true }));
    expect(failure).toMatchObject({
      success: false,
      error: { code: 'DAEMON_UNAVAILABLE', retryable: true },
    });
    expect(failure.nextActions).toHaveLength(2);
  });

  test('command path returns typed failures and refuses unknown health', async () => {
    const response = (body, { ok = true, status = 200, malformed = false } = {}) => ({
      ok,
      status,
      headers: {},
      json: async () => {
        if (malformed) throw new SyntaxError('bad json');
        return body;
      },
      text: async () => JSON.stringify(body),
    });

    const httpOutput = [];
    const httpCode = await runStatus({ json: true }, {
      fetch: async () => response({}, { ok: false, status: 500 }),
      write: (line) => httpOutput.push(line),
    });
    expect(httpCode).toBe(1);
    expect(JSON.parse(httpOutput[0])).toMatchObject({ success: false, error: { code: 'HTTP_ERROR' } });

    const malformedOutput = [];
    const malformedCode = await runStatus({ json: true }, {
      fetch: async () => response({}, { malformed: true }),
      write: (line) => malformedOutput.push(line),
    });
    expect(malformedCode).toBe(1);
    expect(JSON.parse(malformedOutput[0])).toMatchObject({ success: false, error: { code: 'MALFORMED_RESPONSE' } });

    const unknownOutput = [];
    const unknownCode = await runStatus({ json: true }, {
      fetch: async (path) => path === '/status'
        ? response({ status: 'ok', severity: 'ok', pid: 123, runtime: { state: 'mystery', degraded: false } })
        : response({ status: 'ok', severity: 'ok', runtime: { state: 'mystery', degraded: false } }),
      write: (line) => unknownOutput.push(line),
    });
    expect(unknownCode).toBe(1);
    expect(JSON.parse(unknownOutput[0])).toMatchObject({
      success: false,
      error: { code: 'HEALTH_STATE_INVALID' },
      data: { runtime: { state: 'mystery' } },
    });

    const health503Output = [];
    const health503Code = await runStatus({ json: true }, {
      fetch: async (path) => path === '/status'
        ? response({ status: 'ok', severity: 'ok', runtime: { state: 'nominal', degraded: false } })
        : response({}, { ok: false, status: 503 }),
      write: (line) => health503Output.push(line),
    });
    expect(health503Code).toBe(1);
    expect(JSON.parse(health503Output[0])).toMatchObject({ success: false, error: { code: 'HEALTH_UNAVAILABLE' } });

    const healthMalformedOutput = [];
    const healthMalformedCode = await runStatus({ json: true }, {
      fetch: async (path) => path === '/status'
        ? response({ status: 'ok', severity: 'ok', runtime: { state: 'nominal', degraded: false } })
        : response({}, { malformed: true }),
      write: (line) => healthMalformedOutput.push(line),
    });
    expect(healthMalformedCode).toBe(1);
    expect(JSON.parse(healthMalformedOutput[0])).toMatchObject({ success: false, error: { code: 'MALFORMED_RESPONSE' } });

    const healthThrownOutput = [];
    const healthThrownCode = await runStatus({ json: true }, {
      fetch: async (path) => {
        if (path === '/health') throw new Error('probe refused');
        return response({ status: 'ok', severity: 'ok', runtime: { state: 'nominal', degraded: false } });
      },
      write: (line) => healthThrownOutput.push(line),
    });
    expect(healthThrownCode).toBe(1);
    expect(JSON.parse(healthThrownOutput[0])).toMatchObject({ success: false, error: { code: 'HEALTH_UNAVAILABLE' } });

    const degradedOutput = [];
    const degradedCode = await runStatus({ json: true }, {
      fetch: async () => response({
        status: 'ok',
        severity: 'warn',
        runtime: { state: 'nominal', degraded: false },
        binaryDrift: { drifted: false },
      }),
      write: (line) => degradedOutput.push(line),
    });
    expect(degradedCode).toBe(1);
    expect(JSON.parse(degradedOutput[0])).toMatchObject({
      success: false,
      error: { code: 'HEALTH_DEGRADED' },
    });

    const driftOutput = [];
    const driftCode = await runStatus({ json: true }, {
      fetch: async (path) => path === '/status'
        ? response({ status: 'ok', severity: 'ok', runtime: { state: 'nominal', degraded: false } })
        : response({
            status: 'ok',
            severity: 'warn',
            runtime: { state: 'nominal', degraded: false },
            binaryDrift: { drifted: true, runningPath: '/feature/pd', onDiskPath: '/stable/pd' },
          }),
      write: (line) => driftOutput.push(line),
    });
    expect(driftCode).toBe(1);
    expect(JSON.parse(driftOutput[0])).toMatchObject({ success: false, error: { code: 'BINARY_DRIFT' } });
  });
});
