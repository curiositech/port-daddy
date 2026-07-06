import { derivePlan } from '../../lib/planner-migrate.js';
import { schedule } from '../../lib/planner-schedule.js';
import { renderBoard } from '../../lib/planner-board.js';

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
