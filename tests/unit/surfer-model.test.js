import { describe, expect, test } from '@jest/globals';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const frictionScripts = join(repo, 'skills', 'ux-friction-analyzer', 'scripts');
const frictionExamples = join(repo, 'skills', 'ux-friction-analyzer', 'examples');
const appealSkill = join(repo, 'skills', 'product-appeal-analyzer');

const load = (path) => import(pathToFileURL(path).href);
const readJson = async (path) =>
  JSON.parse((await import('node:fs')).readFileSync(path, 'utf8'));

function linearChain(readerMode = 'study', costSeconds = 60) {
  const ids = ['a', 'b', 'c', 'd'];
  return {
    surfaceKind: 'pdf-document',
    readerMode,
    entryNodes: ['a'],
    payoffNodes: ['d'],
    nodes: ids.map((id, i) => ({
      id,
      label: id.toUpperCase(),
      costSeconds,
      hook: 0.8,
      payoff: i === ids.length - 1 ? 1 : 0.2,
      attentionElements: 2,
      gestalt: { groupingClarity: 9, figureGroundClarity: 9 },
      ...(i + 1 < ids.length ? { links: [{ to: ids[i + 1] }] } : {}),
    })),
  };
}

describe('surfer_model: absorbing-chain invariants', () => {
  test('completion and abandonment partition the arrivals exactly', async () => {
    const { simulateSurfer } = await load(join(frictionScripts, 'surfer_model.mjs'));
    for (const mode of ['skim', 'scan', 'study', 'task']) {
      const { readout } = simulateSurfer(linearChain(mode));
      expect(readout.completion + readout.abandonment).toBeCloseTo(1, 10);
      expect(readout.completion).toBeGreaterThan(0);
      expect(readout.completion).toBeLessThanOrEqual(1);
    }
  });

  test('attention mass is a distribution and reach probabilities are probabilities', async () => {
    const { simulateSurfer } = await load(join(frictionScripts, 'surfer_model.mjs'));
    const { readout } = simulateSurfer(linearChain());
    const massTotal = readout.nodes.reduce((s, n) => s + n.attentionMass, 0);
    expect(massTotal).toBeCloseTo(1, 10);
    for (const node of readout.nodes) {
      expect(node.reachProbability).toBeGreaterThanOrEqual(0);
      expect(node.reachProbability).toBeLessThanOrEqual(1);
    }
    // The entry node is always reached; later nodes are reached no more often.
    expect(readout.nodes[0].reachProbability).toBeCloseTo(1, 6);
    expect(readout.nodes[3].reachProbability).toBeLessThanOrEqual(readout.nodes[0].reachProbability);
  });

  test('time-to-first-insight on a linear chain is the upstream reading cost', async () => {
    const { simulateSurfer } = await load(join(frictionScripts, 'surfer_model.mjs'));
    // study mode teleports only 2% of the time, so the only real route to the
    // payoff is straight through a, b, c: 3 x 60s.
    const { readout } = simulateSurfer(linearChain('study', 60));
    const payoff = readout.payoffReach[0];
    expect(payoff.id).toBe('d');
    expect(payoff.expectedSecondsToReach).toBeGreaterThan(175);
    expect(payoff.expectedSecondsToReach).toBeLessThan(195);
  });

  test('a clean chain produces no findings; more reading costs more time', async () => {
    const { simulateSurfer } = await load(join(frictionScripts, 'surfer_model.mjs'));
    const cheap = simulateSurfer(linearChain('study', 60));
    const dear = simulateSurfer(linearChain('study', 600));
    expect(cheap.findings).toHaveLength(0);
    expect(cheap.pass).toBe(true);
    expect(dear.readout.expectedSecondsBeforeExit).toBeGreaterThan(
      cheap.readout.expectedSecondsBeforeExit
    );
  });
});

describe('surfer_model: comprehension debt is charged', () => {
  test('a never-introduced prerequisite is flagged and raises the abandon hazard', async () => {
    const { simulateSurfer } = await load(join(frictionScripts, 'surfer_model.mjs'));
    const clean = linearChain('study');
    const debt = linearChain('study');
    debt.nodes[2].requiresConcepts = ['never-defined-a', 'never-defined-b', 'never-defined-c'];

    const cleanRun = simulateSurfer(clean);
    const debtRun = simulateSurfer(debt);

    const ids = debtRun.findings.map((f) => f.id);
    expect(ids).toContain('unintroduced-prerequisite');
    expect(debtRun.readout.nodes[2].abandonHazard).toBeGreaterThan(
      cleanRun.readout.nodes[2].abandonHazard
    );
    expect(debtRun.readout.completion).toBeLessThan(cleanRun.readout.completion);
  });

  test('a concept used before it is introduced is a forward reference', async () => {
    const { simulateSurfer } = await load(join(frictionScripts, 'surfer_model.mjs'));
    const graph = linearChain('study');
    graph.nodes[0].requiresConcepts = ['widget'];
    graph.nodes[2].newConcepts = ['widget'];
    const ids = simulateSurfer(graph).findings.map((f) => f.id);
    expect(ids).toContain('forward-reference');
  });

  test('the shipped example graphs behave as documented', async () => {
    const { simulateSurfer } = await load(join(frictionScripts, 'surfer_model.mjs'));
    const wireframe = simulateSurfer(await readJson(join(frictionExamples, 'surfer-wireframe.json')));
    expect(wireframe.pass).toBe(true);
    expect(wireframe.findings).toHaveLength(0);

    const book = await readJson(join(frictionExamples, 'surfer-latex-book.json'));
    const run = simulateSurfer(book);
    expect(run.pass).toBe(false);
    const ids = run.findings.map((f) => f.id);
    expect(ids).toContain('time-to-first-insight-exceeds-budget');
    expect(ids).toContain('entropy-cliff');
    expect(run.readout.medianExitNode).not.toBeNull();
  });

  test('regression churn shows up for studiers and not for skimmers', async () => {
    const { simulateSurfer } = await load(join(frictionScripts, 'surfer_model.mjs'));
    const book = await readJson(join(frictionExamples, 'surfer-latex-book.json'));
    const study = simulateSurfer({ ...book, readerMode: 'study' });
    const skim = simulateSurfer({ ...book, readerMode: 'skim' });
    expect(study.readout.regressionsPerVisit).toBeGreaterThan(skim.readout.regressionsPerVisit);
  });
});

describe('surfer_model: input validation', () => {
  test('rejects malformed graphs with actionable messages', async () => {
    const { simulateSurfer } = await load(join(frictionScripts, 'surfer_model.mjs'));
    expect(() => simulateSurfer(null)).toThrow(/JSON object/);
    expect(() => simulateSurfer('not-an-object')).toThrow(/JSON object/);
    expect(() => simulateSurfer({ nodes: [] })).toThrow(/non-empty array/);
    expect(() => simulateSurfer({ nodes: [{ id: 'a' }], readerMode: 'lounging' })).toThrow(/readerMode/);
    expect(() => simulateSurfer({ nodes: [{ id: 'a' }, { id: 'a' }] })).toThrow(/duplicate node id/);
    expect(() =>
      simulateSurfer({ nodes: [{ id: 'a', links: [{ to: 'nowhere' }] }] })
    ).toThrow(/unknown node id/);
    expect(() =>
      simulateSurfer({ nodes: [{ id: 'a' }], payoffNodes: ['ghost'] })
    ).toThrow(/unknown node id/);
  });
});

describe('surfer_model: edge cases stay well-formed', () => {
  test('a single node, a cycle, and an entry that is also the payoff', async () => {
    const { simulateSurfer } = await load(join(frictionScripts, 'surfer_model.mjs'));

    const single = simulateSurfer({
      nodes: [{ id: 'only', costSeconds: 10, payoff: 1 }],
      payoffNodes: ['only'],
    });
    expect(single.readout.completion + single.readout.abandonment).toBeCloseTo(1, 10);
    expect(single.readout.payoffReach[0].expectedSecondsToReach).toBe(0);

    // A payoff you start on costs no waiting time and is always reached.
    const atEntry = simulateSurfer({
      nodes: [
        { id: 'a', costSeconds: 10, payoff: 1, links: [{ to: 'b' }] },
        { id: 'b', costSeconds: 10 },
      ],
      entryNodes: ['a'],
      payoffNodes: ['a'],
    });
    expect(atEntry.readout.payoffReach[0].reachProbability).toBe(1);
    expect(atEntry.readout.payoffReach[0].expectedSecondsToReach).toBe(0);

    // A cycle must not diverge: the abandon floor keeps the chain absorbing.
    const cyclic = simulateSurfer({
      nodes: [
        { id: 'a', costSeconds: 10, links: [{ to: 'b' }] },
        { id: 'b', costSeconds: 10, links: [{ to: 'a' }] },
      ],
      entryNodes: ['a'],
      payoffNodes: ['b'],
    });
    expect(Number.isFinite(cyclic.readout.expectedSecondsBeforeExit)).toBe(true);
    expect(cyclic.readout.completion).toBeGreaterThanOrEqual(0);
    expect(cyclic.readout.completion).toBeLessThanOrEqual(1);
  });

  test('entry weights normalise, and a zero-weight entry set is rejected', async () => {
    const { simulateSurfer } = await load(join(frictionScripts, 'surfer_model.mjs'));
    const run = simulateSurfer({
      nodes: [
        { id: 'a', costSeconds: 10, links: [{ to: 'b' }] },
        { id: 'b', costSeconds: 10 },
      ],
      entryNodes: [
        { id: 'a', weight: 3 },
        { id: 'b', weight: 1 },
      ],
    });
    expect(run.readout.nodes.reduce((s, n) => s + n.attentionMass, 0)).toBeCloseTo(1, 10);
    expect(() =>
      simulateSurfer({ nodes: [{ id: 'a' }], entryNodes: [{ id: 'a', weight: 0 }] })
    ).toThrow(/positive total weight/);
  });

  test('an extremely hostile node still yields a valid probability distribution', async () => {
    const { simulateSurfer } = await load(join(frictionScripts, 'surfer_model.mjs'));
    const run = simulateSurfer({
      readerMode: 'task',
      nodes: [
        {
          id: 'a',
          costSeconds: 10,
          attentionElements: 200,
          gestalt: { groupingClarity: 0, figureGroundClarity: 0 },
          requiresConcepts: ['w', 'x', 'y', 'z'],
          links: [{ to: 'b' }],
        },
        { id: 'b', costSeconds: 10 },
      ],
      entryNodes: ['a'],
    });
    const hazard = run.readout.nodes[0].abandonHazard;
    expect(hazard).toBeGreaterThan(0);
    expect(hazard).toBeLessThanOrEqual(0.85);
    expect(run.readout.completion + run.readout.abandonment).toBeCloseTo(1, 10);
  });
});

describe('latex_skeleton', () => {
  const fixture = () => {
    const dir = mkdtempSync(join(tmpdir(), 'latex-skeleton-'));
    writeFileSync(
      join(dir, 'main.tex'),
      [
        '\\documentclass{book}',
        '\\newcommand{\\solutions}{\\section*{Phantom preamble section}}',
        '\\begin{document}',
        '\\chapter{Introduction}\\label{ch:intro}',
        'We will prove Theorem~\\ref{thm:main} later. % \\chapter{Commented out}',
        '\\input{prelims}',
        '\\chapter{Main result}\\label{ch:main}',
        '\\begin{theorem}\\label{thm:main}Uses \\ref{def:widget}.\\end{theorem}',
        'And \\ref{nowhere:missing} resolves to nothing.',
        '\\end{document}',
      ].join('\n')
    );
    writeFileSync(
      join(dir, 'prelims.tex'),
      [
        '\\chapter{Preliminaries}\\label{ch:prelims}',
        '\\begin{definition}\\label{def:widget}A widget is a thing.\\end{definition}',
      ].join('\n')
    );
    return join(dir, 'main.tex');
  };

  test('follows \\input, strips comments, and excludes preamble sectioning', async () => {
    const { buildLatexSkeleton, flattenLatexSource } = await load(
      join(frictionScripts, 'latex_skeleton.mjs')
    );
    const skeleton = buildLatexSkeleton(flattenLatexSource(fixture()), {
      level: 'chapter',
      wpm: 120,
    });
    const ids = skeleton.nodes.map((n) => n.id);
    // prelims.tex was inlined; the commented-out \\chapter was not; and the
    // \\section* inside a preamble \\newcommand body is not a section.
    expect(ids).toEqual(['introduction', 'preliminaries', 'main-result']);
    expect(ids).not.toContain('phantom-preamble-section');
    expect(ids).not.toContain('commented-out');
  });

  test('turns the cross-reference graph into concepts, and reports the broken ones', async () => {
    const { buildLatexSkeleton, flattenLatexSource } = await load(
      join(frictionScripts, 'latex_skeleton.mjs')
    );
    const skeleton = buildLatexSkeleton(flattenLatexSource(fixture()), { level: 'chapter' });

    const byId = Object.fromEntries(skeleton.nodes.map((n) => [n.id, n]));
    expect(byId.preliminaries.newConcepts).toContain('label:def:widget');
    expect(byId['main-result'].requiresConcepts).toContain('label:def:widget');

    const { forwardReferences, danglingReferences } = skeleton._extraction;
    expect(forwardReferences.map((r) => r.ref)).toContain('thm:main');
    expect(danglingReferences.map((r) => r.ref)).toContain('nowhere:missing');

    // payoff/hook are deliberately left at 0 so an unfilled skeleton reads as
    // unfilled rather than as a verdict.
    expect(skeleton.nodes.every((n) => n.payoff === 0 && n.hook === 0)).toBe(true);
    expect(skeleton.payoffNodes).toEqual([]);
    expect(skeleton._todo.length).toBeGreaterThan(0);
  });

  test('rejects source with no sectioning at the requested level', async () => {
    const { buildLatexSkeleton } = await load(join(frictionScripts, 'latex_skeleton.mjs'));
    expect(() => buildLatexSkeleton('\\begin{document}no sections\\end{document}')).toThrow(/no \\/);
    expect(() => buildLatexSkeleton(null)).toThrow(/must be a string/);
  });
});

describe('surfer_model: reader maps', () => {
  const book = () => ({
    surfaceKind: 'latex-book',
    readerMode: 'study',
    entryNodes: ['ch1'],
    payoffNodes: ['ch4'],
    nodes: [
      { id: 'ch1', label: 'Ch1', costSeconds: 60, newConcepts: ['widget'], hook: 0.6, payoff: 0.1, links: [{ to: 'ch2' }] },
      { id: 'ch2', label: 'Ch2', costSeconds: 60, newConcepts: ['gadget'], hook: 0.6, payoff: 0.1, links: [{ to: 'ch3' }] },
      { id: 'ch3', label: 'Ch3', costSeconds: 60, requiresConcepts: ['gadget'], hook: 0.6, payoff: 0.3, links: [{ to: 'ch4' }] },
      { id: 'ch4', label: 'Ch4', costSeconds: 60, requiresConcepts: ['widget'], hook: 0.6, payoff: 1 },
    ],
  });

  test('a route that skips the chapter defining what it needs is flagged as broken-by-map', async () => {
    const { simulateSurfer } = await load(join(frictionScripts, 'surfer_model.mjs'));
    const graph = book();
    // The map sends practitioners past Ch2, which introduces 'gadget' — and
    // Ch3, which is on the route, needs it.
    graph.readerPaths = [
      { id: 'practitioner', persona: 'Practitioner', nodes: ['ch1', 'ch3', 'ch4'] },
      { id: 'theorist', persona: 'Theorist', nodes: ['ch1', 'ch2', 'ch3', 'ch4'] },
    ];
    const run = simulateSurfer(graph);
    const broken = run.findings.filter((f) => f.id === 'reader-map-broken-prerequisite');
    expect(broken).toHaveLength(1);
    expect(broken[0].message).toMatch(/gadget/);
    expect(run.pass).toBe(false);

    const byId = Object.fromEntries(run.readout.readerPaths.map((p) => [p.id, p]));
    expect(byId.practitioner.brokenByMap).toHaveLength(1);
    expect(byId.practitioner.brokenByMap[0].introducedIn.id).toBe('ch2');
    expect(byId.practitioner.skipped).toEqual(['ch2']);
    // The full route carries its own prerequisites and is not flagged.
    expect(byId.theorist.brokenByMap).toHaveLength(0);
  });

  test('a concept nothing introduces is a book-wide defect, not a broken map', async () => {
    const { simulateSurfer } = await load(join(frictionScripts, 'surfer_model.mjs'));
    const graph = book();
    graph.nodes[3].requiresConcepts = ['never-introduced-anywhere'];
    graph.readerPaths = [{ id: 'all', persona: 'Anyone', nodes: ['ch1', 'ch2', 'ch3', 'ch4'] }];
    const run = simulateSurfer(graph);
    const ids = run.findings.map((f) => f.id);
    expect(ids).toContain('unintroduced-prerequisite');
    expect(ids).not.toContain('reader-map-broken-prerequisite');
  });

  test('a route with no payoff on it is flagged, and routes carry their own budgets', async () => {
    const { simulateSurfer } = await load(join(frictionScripts, 'surfer_model.mjs'));
    const graph = book();
    graph.readerPaths = [{ id: 'dead-end', persona: 'Someone', nodes: ['ch1', 'ch2'] }];
    const run = simulateSurfer(graph);
    expect(run.findings.map((f) => f.id)).toContain('reader-map-omits-payoff');

    const budgeted = book();
    budgeted.readerPaths = [
      { id: 'hurried', persona: 'Hurried', nodes: ['ch1', 'ch2', 'ch3', 'ch4'], patienceBudgetSeconds: 5 },
    ];
    const run2 = simulateSurfer(budgeted);
    const scoped = run2.findings.filter((f) => f.path === 'hurried');
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.map((f) => f.id)).toContain('reader-path-patience-budget-exceeded');
  });

  test('the shipped book example carries its documented reader-map defect', async () => {
    const { simulateSurfer } = await load(join(frictionScripts, 'surfer_model.mjs'));
    const run = simulateSurfer(await readJson(join(frictionExamples, 'surfer-latex-book.json')));
    const paths = Object.fromEntries(run.readout.readerPaths.map((p) => [p.id, p]));
    expect(paths.practitioner.brokenByMap.length).toBeGreaterThan(0);
    expect(paths.theorist.brokenByMap).toHaveLength(0);
    // The documented inversion: the shorter, broken route completes MORE.
    expect(paths.practitioner.completion).toBeGreaterThan(paths.theorist.completion);
  });

  test('malformed reader paths are rejected', async () => {
    const { simulateSurfer } = await load(join(frictionScripts, 'surfer_model.mjs'));
    const graph = book();
    expect(() => simulateSurfer({ ...graph, readerPaths: [{ id: 'x' }] })).toThrow(/non-empty "nodes"/);
    expect(() =>
      simulateSurfer({ ...graph, readerPaths: [{ id: 'x', nodes: ['ghost'] }] })
    ).toThrow(/unknown node id/);
  });
});

describe('appeal_audit: reader-map persona matching', () => {
  const base = async () =>
    readJson(join(appealSkill, 'examples', 'sample-input.json'));

  test('a scored persona with no route, and a route with no scored persona, are both reported', async () => {
    const { auditDesirability } = await load(join(appealSkill, 'scripts', 'appeal_audit.mjs'));
    const spec = await base();
    const report = auditDesirability({
      ...spec,
      technicalDocument: {
        readerMap: {
          declared: true,
          paths: [{ id: 'ghost-route', persona: 'Somebody we are not scoring' }],
        },
      },
    });
    const ids = report.findings.map((f) => f.id);
    expect(ids).toContain('reader-path-persona-unmatched');
    expect(ids).toContain('reader-map-persona-unserved');
    expect(report.scorecard.technicalDocument.readerMap.personasRouted).toBe(0);
    expect(report.scorecard.technicalDocument.readerMap.unservedPersonas).toHaveLength(2);
  });

  test('persona names join as keys, tolerating case and surrounding whitespace only', async () => {
    const { auditDesirability } = await load(join(appealSkill, 'scripts', 'appeal_audit.mjs'));
    const spec = await base();
    const report = auditDesirability({
      ...spec,
      technicalDocument: {
        readerMap: {
          declared: true,
          paths: spec.personas.map((p, i) => ({
            id: `route-${i}`,
            persona: `  ${p.name.toUpperCase()}  `,
          })),
        },
      },
    });
    const ids = report.findings.map((f) => f.id);
    expect(ids).not.toContain('reader-path-persona-unmatched');
    expect(ids).not.toContain('reader-map-persona-unserved');
    expect(report.scorecard.technicalDocument.readerMap.personasRouted).toBe(spec.personas.length);
  });

  test('the technical-book example reports its route defects', async () => {
    const { auditDesirability } = await load(join(appealSkill, 'scripts', 'appeal_audit.mjs'));
    const report = auditDesirability(
      await readJson(join(appealSkill, 'examples', 'technical-book-spec.json'))
    );
    const ids = report.findings.map((f) => f.id);
    expect(ids).toContain('reader-map-undiscoverable');
    expect(ids).toContain('reader-path-broken-prerequisites');
    expect(ids).toContain('reader-path-payoff-mismatch');
    expect(ids).toContain('reader-map-persona-unserved');
  });
});

describe('appeal_audit: technical-document and surfer extensions', () => {
  test('the pre-existing landing-page sample still passes unchanged', async () => {
    const { auditDesirability } = await load(join(appealSkill, 'scripts', 'appeal_audit.mjs'));
    const report = auditDesirability(await readJson(join(appealSkill, 'examples', 'sample-input.json')));
    expect(report.pass).toBe(true);
    expect(report.findings).toHaveLength(0);
    // Optional blocks absent means absent, not zeroed.
    expect(report.scorecard.technicalDocument).toBeNull();
    expect(report.scorecard.surfer).toBeNull();
  });

  test('the technical-book sample fires every new gate', async () => {
    const { auditDesirability } = await load(join(appealSkill, 'scripts', 'appeal_audit.mjs'));
    const report = auditDesirability(
      await readJson(join(appealSkill, 'examples', 'technical-book-spec.json'))
    );
    expect(report.pass).toBe(false);
    const ids = report.findings.map((f) => f.id);
    for (const expected of [
      'shelf-test-failed',
      'return-on-effort-below-five',
      'payoff-outside-patience-budget',
      'audience-undeclared',
      'prerequisites-undeclared',
      'prerequisites-dishonest',
      'structural-abstract',
      'unlocatable-contribution',
      'figures-not-self-contained',
      'trust-evidence-absent',
      'surfer-payoff-unreachable',
    ]) {
      expect(ids).toContain(expected);
    }
    expect(report.scorecard.technicalDocument.returnOnEffort).toBeLessThan(5);
    expect(report.scorecard.technicalDocument.timeToFirstInsightScore).toBe(0);
  });

  test('a wireframe spec carries the honesty guard in its recommendations', async () => {
    const { auditDesirability } = await load(join(appealSkill, 'scripts', 'appeal_audit.mjs'));
    const spec = await readJson(join(appealSkill, 'examples', 'sample-input.json'));
    const report = auditDesirability({ ...spec, surfaceKind: 'wireframe' });
    expect(report.recommendations.join(' ')).toMatch(/can FAIL appeal but cannot PASS it/);
  });

  test('malformed technical blocks are rejected rather than silently scored', async () => {
    const { auditDesirability } = await load(join(appealSkill, 'scripts', 'appeal_audit.mjs'));
    const base = await readJson(join(appealSkill, 'examples', 'sample-input.json'));
    expect(() =>
      auditDesirability({
        ...base,
        technicalDocument: { shelfTest: { subject: true, audience: true, promise: true, cost: true } },
      })
    ).toThrow(/differentiation/);
    expect(() =>
      auditDesirability({
        ...base,
        technicalDocument: { returnOnEffort: { costTransparency: 'high', payoffVisibility: 5 } },
      })
    ).toThrow(/costTransparency/);
    expect(() =>
      auditDesirability({ ...base, technicalDocument: { reproducibilityArtifacts: 'vibes' } })
    ).toThrow(/reproducibilityArtifacts/);
  });
});
