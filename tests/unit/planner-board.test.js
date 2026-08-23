import { derivePlan } from '../../lib/planner-migrate.js';
import { schedule } from '../../lib/planner-schedule.js';
import { renderBoard, axisTickStep, axisTicks } from '../../lib/planner-board.js';

function fixture() {
  const items = [
    { slug: 'adr-0048-phase-0-ratify', summaryMd: 'ratify the stack', status: 'now', dependencies: [], notes: [], harbor: 'port-daddy' },
    { slug: 'adr-0048-phase-1-proto', summaryMd: 'protocol', status: 'now', dependencies: ['adr-0048-phase-0-ratify'], notes: [], harbor: 'port-daddy' },
    { slug: 'loose-xss', summaryMd: '<script>alert(1)</script> & "quotes"', status: 'backlog', dependencies: [], notes: [], harbor: 'fleet' },
  ];
  const plan = derivePlan(items);
  const sched = schedule(plan.tasks.map((t) => ({ id: t.slug, estimate: 1 })), plan.dependsOnEdges);
  return { plan, sched, items };
}

describe('renderBoard', () => {
  const { plan, sched, items } = fixture();
  const html = renderBoard({ plan, schedule: sched, items, generatedAt: 0 });

  test('returns a complete self-contained HTML document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
    expect(html).toContain('Planner Board');
  });

  test('renders the epics and tasks', () => {
    expect(html).toContain('ADR-0048');
    expect(html).toContain('adr-0048-phase-0-ratify');
    expect(html).toContain('Unsorted');
  });

  test('marks the critical path and a Gantt', () => {
    expect(html).toContain('critical path');
    expect(html).toContain('view-gantt');
    expect(html).toContain('gbar');
  });

  test('embeds the live layer (poll + tube) and the data payload', () => {
    expect(html).toContain('pdTube');
    expect(html).toContain('/roadmap/items');
    expect(html).toContain('board-data');
  });

  test('escapes HTML in user content (no raw injection)', () => {
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('flags banner reports the harbor split (3 harbors → fleet+port-daddy)', () => {
    expect(html).toContain('harbor split');
  });
});

describe('gantt time axis', () => {
  test('tick step adapts from days to weeks to quarters (console parity ladder)', () => {
    expect(axisTickStep(1)).toBe(1);
    expect(axisTickStep(8)).toBe(1);
    expect(axisTickStep(9)).toBe(2); // 9 daily intervals no longer fit
    expect(axisTickStep(16)).toBe(2);
    expect(axisTickStep(17)).toBe(7); // weeks
    expect(axisTickStep(56)).toBe(7);
    expect(axisTickStep(57)).toBe(14); // fortnights
    expect(axisTickStep(200)).toBe(28); // 4-week blocks
    expect(axisTickStep(700)).toBe(91); // quarters
    expect(axisTickStep(3000)).toBe(364 * 2); // beyond the ladder: whole years
  });

  test('ticks anchor today at unit 0 and carry real UTC dates', () => {
    const anchor = Date.UTC(2026, 7, 22); // 2026-08-22
    const ticks = axisTicks(9, anchor);
    expect(ticks[0]).toMatchObject({ unit: 0, pct: 0, label: 'today', isToday: true });
    expect(ticks[1]).toMatchObject({ unit: 2, label: '08-24', isToday: false });
    // Closing tick frames the schedule end even off the step grid (9 % 2 !== 0).
    const last = ticks[ticks.length - 1];
    expect(last.unit).toBe(9);
    expect(last.pct).toBeCloseTo(100);
    expect(last.label).toBe('08-31');
  });

  test('rendered board carries the axis, gridlines, and today-marker', () => {
    const { plan, sched, items } = fixture();
    const html = renderBoard({ plan, schedule: sched, items, generatedAt: Date.UTC(2026, 7, 22) });
    expect(html).toContain('gaxis-track');
    expect(html).toContain('1 est unit = 1 day');
    expect(html).toContain('gtoday-line'); // the today gridline
    expect(html).toContain('>today<'); // the today tick label
    expect(html).toContain('ggridline');
  });
});
