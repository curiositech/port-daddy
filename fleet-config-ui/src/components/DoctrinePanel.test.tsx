import { describe, expect, it } from 'vitest';
import { admissionReadiness } from './DoctrinePanel';
import type { DoctrineDetail } from '../types';

function detailWithRuns(runs: NonNullable<DoctrineDetail['experiment']>['runs']): DoctrineDetail {
  return {
    doctrine: {
      id: 'candidate-1',
      doctrineId: 'doctrine:candidate-1',
      episodeId: 'episode-1',
      projectDir: '/repo',
      actorId: 'steward',
      citations: ['receipt://episode'],
      occurredAt: '2026-08-26T00:00:00Z',
      decisionClass: 'integration.merge',
      title: 'Evidence-weighted merge gate',
      when: 'there is review evidence',
      prefer: 'inspect evidence',
      over: 'count threads',
      because: 'thread state is only a proxy',
      unless: [],
      school: null,
      skillRefs: [],
      status: 'candidate',
      reviewerId: null,
      experimentId: 'experiment-1',
      admissionCitations: [],
      contestedReason: null,
    },
    episode: null,
    experiment: {
      id: 'experiment-1',
      candidateId: 'candidate-1',
      projectDir: '/repo',
      actorId: 'researcher',
      citations: ['receipt://experiment'],
      occurredAt: '2026-08-26T00:00:00Z',
      hypothesis: 'Thread state and technical evidence differ.',
      primaryOutcome: 'merge decision',
      control: 'factual control',
      treatment: 'technical concern changed',
      sham: null,
      runs,
    },
    retrievals: [],
    applications: [],
    outcomes: [],
  };
}

describe('admissionReadiness', () => {
  it('keeps admission disabled until matched factual control and treatment runs exist', () => {
    const result = admissionReadiness(detailWithRuns([
      {
        id: 'control', experimentId: 'experiment-1', arm: 'control', action: 'hold', outcome: 'recorded', fidelity: 'matched', notes: null, occurredAt: '2026-08-26T00:00:00Z', citations: ['receipt://control'],
      },
      {
        id: 'treatment', experimentId: 'experiment-1', arm: 'treatment', action: 'merge', outcome: 'recorded', fidelity: 'mismatched', notes: null, occurredAt: '2026-08-26T00:00:00Z', citations: ['receipt://treatment'],
      },
    ]));

    expect(result.ready).toBe(false);
    expect(result.label).toBe('Evidence incomplete');
    expect(result.detail).toMatch(/matched treatment/);
  });

  it('allows only provisional admission after both factual arms are matched', () => {
    const result = admissionReadiness(detailWithRuns([
      {
        id: 'control', experimentId: 'experiment-1', arm: 'control', action: 'hold', outcome: 'recorded', fidelity: 'matched', notes: null, occurredAt: '2026-08-26T00:00:00Z', citations: ['receipt://control'],
      },
      {
        id: 'treatment', experimentId: 'experiment-1', arm: 'treatment', action: 'merge', outcome: 'recorded', fidelity: 'matched', notes: null, occurredAt: '2026-08-26T00:00:00Z', citations: ['receipt://treatment'],
      },
    ]));

    expect(result.ready).toBe(true);
    expect(result.label).toBe('Factual gate met');
    expect(result.detail).toMatch(/provisional/i);
  });
});
