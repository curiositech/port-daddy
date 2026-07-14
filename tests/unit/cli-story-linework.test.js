import {
  LINEWORK_SIGNALS,
  lineworkEnabled,
  lineworkSignal,
  renderLineworkPanel,
  visibleWidth,
} from '../../cli/utils/ui.js';
import {
  renderStatusFailureLinework,
  renderStatusLinework,
  renderStatusPlain,
} from '../../cli/commands/diagnostics.js';

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
        { tone: 'healthy', label: 'healthy', text: 'daemon heartbeat now', signal: 'Q' },
        { tone: 'pending', label: 'pending', text: 'proposal waiting for review', signal: 'P' },
        { tone: 'unknown', label: 'unknown', text: 'worker health not reported', signal: 'M' },
        { tone: 'recovering', label: 'recovering', text: 'salvage available', signal: 'O' },
        { tone: 'confirmed', label: 'confirmed', text: 'receipt stored', signal: 'C' },
        { tone: 'blocked', label: 'blocked', text: 'guard stopped the commit', signal: 'X' },
        { tone: 'failed', label: 'failed', text: 'spawn failed; next: inspect transcript', signal: 'N' },
      ],
      footer: 'golden no-color shape',
    });

    expect(rendered).toMatchInlineSnapshot(`
"Proof  state grammar
bounded live content
[Q] healthy: daemon heartbeat now
[P] pending: proposal waiting for review
[M] unknown: worker health not reported
[O] recovering: salvage available
[C] confirmed: receipt stored
[X] blocked: guard stopped the commit
[N] failed: spawn failed; next: inspect transcript
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
        { tone: 'healthy', label: 'daemon', text: 'pid 123 · up 11h 42m · 65 ports', signal: 'Q' },
        { tone: 'blocked', label: 'next', text: 'operator action required before continuing', signal: 'X' },
      ],
      footer: 'guard enforce · budget $0.00/$8.50',
    });

    for (const line of rendered.split('\n')) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(44);
    }
  });

  test('16, 256, and truecolor ANSI levels degrade predictably', () => {
    expect(lineworkSignal('Q', { colorLevel: '16' })).toContain('\x1b[32m');
    expect(lineworkSignal('Q', { colorLevel: '256' })).toContain('\x1b[38;5;78m');
    expect(lineworkSignal('Q', { colorLevel: 'truecolor' })).toContain('\x1b[38;2;95;206;151m');
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
    expect(LINEWORK_SIGNALS.N.meaning).toMatch(/negative/);
    expect(LINEWORK_SIGNALS.O.meaning).toMatch(/Man overboard/);
  });
});

describe('pd status story-linework output', () => {
  test('healthy status has a linework golden and no decorative emoji in plain output', () => {
    const data = {
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
    expect(rendered).toContain('[N]');
    expect(rendered).toContain('open FleetBar and restart the daemon');
    expect(rendered).toContain('exit 1');
  });
});
