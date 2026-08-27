import { describe, expect, test } from '@jest/globals';
import {
  claimTreeTroubleStateMachineMermaid,
  classifyClaimTreeTrouble,
  renderClaimTreeTroubleMermaid,
} from '../../lib/claim-tree-trouble.js';

const clear = {
  sourceComplete: true,
  worldComparable: true,
  counterpartActive: true,
  claimFresh: true,
  directOverlap: false,
  precisionKnown: true,
  dependencyReachable: false,
};

describe('claim-tree trouble finite-state classifier', () => {
  test.each([
    [{ ...clear, sourceComplete: false }, 'VERIFY'],
    [{ ...clear, counterpartActive: false }, 'RESCUE'],
    [{ ...clear, directOverlap: true }, 'COORDINATE'],
    [{ ...clear, precisionKnown: false }, 'INSPECT'],
    [{ ...clear, claimFresh: false }, 'RECONCILE'],
    [{ ...clear, dependencyReachable: true }, 'WATCH'],
    [clear, 'PROCEED'],
  ])('classifies %s as %s', (evidence, state) => {
    expect(classifyClaimTreeTrouble(evidence).state).toBe(state);
  });

  test('earlier states dominate later evidence, making the result explainable', () => {
    expect(classifyClaimTreeTrouble({ ...clear, sourceComplete: false, directOverlap: true }).state).toBe('VERIFY');
    expect(classifyClaimTreeTrouble({ ...clear, counterpartActive: false, directOverlap: true }).state).toBe('RESCUE');
    expect(classifyClaimTreeTrouble({ ...clear, directOverlap: true, precisionKnown: false }).state).toBe('COORDINATE');
  });

  test('exports a complete Mermaid state machine and bounded ego graph', () => {
    const stateMachine = claimTreeTroubleStateMachineMermaid();
    for (const state of ['VERIFY', 'RESCUE', 'COORDINATE', 'INSPECT', 'RECONCILE', 'WATCH', 'PROCEED']) {
      expect(stateMachine).toContain(state);
    }
    expect(renderClaimTreeTroubleMermaid({ filePath: 'lib/x.ts', selfSessionId: 'self', otherSessionId: 'other', state: 'COORDINATE' }))
      .toContain('COORDINATE');
  });
});
