import {
  derivePlan,
  adrNumberOf,
  priorityForStatus,
  planSummary,
  ROOT_PROJECT_ID,
  UNSORTED_EPIC_ID,
} from '../../lib/planner-migrate.js';

function item(slug, opts = {}) {
  return {
    slug,
    summaryMd: opts.summaryMd ?? `summary for ${slug}`,
    status: opts.status ?? 'now',
    dependencies: opts.dependencies ?? [],
    notes: opts.notes ?? [],
    harbor: opts.harbor ?? 'port-daddy',
  };
}

describe('adrNumberOf — structured ID extraction', () => {
  test('from the adr-NNNN-phase slug', () => {
    expect(adrNumberOf(item('adr-0048-phase-0-ratify-stack'))).toBe('0048');
    expect(adrNumberOf(item('adr-50-phase-1'))).toBe('0050'); // zero-padded
  });
  test('from an ADR-NNNN token in the summary when the slug has none', () => {
    expect(adrNumberOf(item('planner-scheduler-kernel', { summaryMd: 'ADR-0086 Phase 1a: kernel' }))).toBe('0086');
  });
  test('from an adr:NNNN note stamp', () => {
    expect(adrNumberOf(item('whatever', { notes: [{ text: 'adr:0043 phase 1' }] }))).toBe('0043');
  });
  test('null when no ADR id is present', () => {
    expect(adrNumberOf(item('mcp-parity-no-copouts', { summaryMd: 'no identifier here' }))).toBeNull();
  });
});

describe('priorityForStatus', () => {
  test('now/merge are high, backlog mid, parked low, done lowest', () => {
    expect(priorityForStatus('now')).toBe(2);
    expect(priorityForStatus('merge')).toBe(2);
    expect(priorityForStatus('backlog')).toBe(3);
    expect(priorityForStatus('parked')).toBe(4);
    expect(priorityForStatus('done')).toBe(5);
  });
});

describe('derivePlan', () => {
  const items = [
    item('adr-0048-phase-0-ratify-stack'),
    item('adr-0048-phase-1-coordination', { dependencies: ['adr-0048-phase-0-ratify-stack'] }),
    item('adr-0050-phase-0-wrapper', { status: 'backlog' }),
    item('planner-scheduler-kernel', { summaryMd: 'ADR-0086 Phase 1a kernel scheduler' }),
    item('a-loose-idea', { summaryMd: 'no adr token', status: 'backlog' }),
    item('dup', { harbor: 'fleet' }),
    item('dup', { harbor: 'port-daddy' }), // duplicate slug, different harbor
    item('has-dangling', { dependencies: ['ghost-dep'] }),
  ];
  const plan = derivePlan(items);

  test('creates one project root', () => {
    expect(plan.project.id).toBe(ROOT_PROJECT_ID);
    expect(plan.project.kind).toBe('project');
  });

  test('creates an epic per ADR (slug, summary, note) plus the unsorted catch-all last', () => {
    const epicIds = plan.epics.map((e) => e.id);
    expect(epicIds).toContain('adr-0048');
    expect(epicIds).toContain('adr-0050');
    expect(epicIds).toContain('adr-0086'); // derived from the summary token
    expect(epicIds).toContain(UNSORTED_EPIC_ID);
    expect(epicIds[epicIds.length - 1]).toBe(UNSORTED_EPIC_ID); // unsorted sorts last
    expect(plan.epics.find((e) => e.id === 'adr-0048').title).toBe('ADR-0048');
  });

  test('each task is parented to its epic with a status-derived priority', () => {
    const kernel = plan.tasks.find((t) => t.slug === 'planner-scheduler-kernel');
    expect(kernel.parent).toBe('adr-0086');
    expect(kernel.kind).toBe('task');
    expect(kernel.priority).toBe(2); // now
    const wrapper = plan.tasks.find((t) => t.slug === 'adr-0050-phase-0-wrapper');
    expect(wrapper.priority).toBe(3); // backlog
  });

  test('loose items (no ADR) go under unsorted and are flagged', () => {
    expect(plan.flags.loose).toContain('a-loose-idea');
    expect(plan.tasks.find((t) => t.slug === 'a-loose-idea').parent).toBe(UNSORTED_EPIC_ID);
  });

  test('dependencies become depends_on edges (dep → dependent)', () => {
    expect(plan.dependsOnEdges).toContainEqual({
      from: 'adr-0048-phase-0-ratify-stack',
      to: 'adr-0048-phase-1-coordination',
    });
  });

  test('dependencies on unknown slugs are flagged, not emitted as edges', () => {
    expect(plan.flags.danglingDeps).toContainEqual({ slug: 'has-dangling', missing: 'ghost-dep' });
    expect(plan.dependsOnEdges.some((e) => e.from === 'ghost-dep')).toBe(false);
  });

  test('duplicate slugs collapse to one task and are reported (not merged)', () => {
    expect(plan.tasks.filter((t) => t.slug === 'dup')).toHaveLength(1);
    expect(plan.flags.duplicates).toContainEqual({ slug: 'dup', count: 2 });
  });

  test('harbor inconsistency is reported', () => {
    const harbors = plan.flags.harbors.map((h) => h.harbor);
    expect(harbors).toContain('fleet');
    expect(harbors).toContain('port-daddy');
  });

  test('parent edges connect project→epic and epic→task', () => {
    expect(plan.parentEdges).toContainEqual({ parent: ROOT_PROJECT_ID, child: 'adr-0048' });
    expect(plan.parentEdges).toContainEqual({ parent: 'adr-0048', child: 'adr-0048-phase-0-ratify-stack' });
  });

  test('planSummary counts line up', () => {
    const s = planSummary(plan);
    expect(s.tasks).toBe(7); // 8 items, one duplicate collapsed
    expect(s.duplicates).toBe(1);
    expect(s.loose).toBe(3); // a-loose-idea, dup, has-dangling all lack an ADR token
  });
});
