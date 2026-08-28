import { describe, expect, test } from '@jest/globals';
import {
  CLAIM_TREE_TROUBLE_STATE_ORDER,
  claimTreeTroubleStateMachineMermaid,
  claimTreeTroubleTransitionTable,
  classifyClaimTreeTrouble,
  renderClaimTreeTroubleMermaid,
  validateClaimTreeTroubleStateMachineMermaid,
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

  test('exports a stable transition table and Mermaid graph', () => {
    const table = claimTreeTroubleTransitionTable();

    expect(table.stages.map(({ state }) => state)).toEqual(CLAIM_TREE_TROUBLE_STATE_ORDER.slice(0, -1));
    expect(table.terminal.state).toBe('PROCEED');
    expect(table).toMatchInlineSnapshot(`
      {
        "stages": [
          {
            "action": "refresh the claim tree and compare the intended merge world before editing",
            "advanceLabel": "provenance/world confirmed",
            "advanceTo": "RESCUE",
            "advanceWhen": "sourceComplete && worldComparable",
            "holdLabel": "incomplete or cross-world evidence",
            "reason": "claim provenance is incomplete or names different worlds",
            "state": "VERIFY",
          },
          {
            "action": "inspect salvage or handoff evidence before reclaiming the surface",
            "advanceLabel": "counterpart live",
            "advanceTo": "COORDINATE",
            "advanceWhen": "counterpartActive",
            "holdLabel": "counterpart inactive",
            "reason": "the counterpart claim is no longer backed by a live session",
            "state": "RESCUE",
          },
          {
            "action": "open a parley, hand off, or split the surface before proceeding",
            "advanceLabel": "no direct overlap",
            "advanceTo": "INSPECT",
            "advanceWhen": "!directOverlap",
            "holdLabel": "overlap remains",
            "reason": "two live sessions claim the same declared surface",
            "state": "COORDINATE",
          },
          {
            "action": "resolve symbols or ranges, then re-scan before editing",
            "advanceLabel": "precision known",
            "advanceTo": "RECONCILE",
            "advanceWhen": "precisionKnown",
            "holdLabel": "imprecise claim",
            "reason": "the shared surface lacks symbol or complete range precision",
            "state": "INSPECT",
          },
          {
            "action": "refresh provenance and reconcile the claim with current work",
            "advanceLabel": "claim fresh",
            "advanceTo": "WATCH",
            "advanceWhen": "claimFresh",
            "holdLabel": "stale claim",
            "reason": "the claim tree is older than its freshness boundary",
            "state": "RECONCILE",
          },
          {
            "action": "proceed with a narrow change and watch the dependent surface",
            "advanceLabel": "no dependency concern",
            "advanceTo": "PROCEED",
            "advanceWhen": "!dependencyReachable",
            "holdLabel": "dependency remains",
            "reason": "a dependency connects otherwise separate claimed surfaces",
            "state": "WATCH",
          },
        ],
        "terminal": {
          "action": "proceed, keeping the claim current",
          "reason": "no trouble is visible in the supplied evidence",
          "state": "PROCEED",
        },
      }
    `);
    expect(claimTreeTroubleStateMachineMermaid()).toMatchInlineSnapshot(`
      "stateDiagram-v2
        [*] --> VERIFY
        VERIFY --> RESCUE: provenance/world confirmed
        RESCUE --> COORDINATE: counterpart live
        COORDINATE --> INSPECT: no direct overlap
        INSPECT --> RECONCILE: precision known
        RECONCILE --> WATCH: claim fresh
        WATCH --> PROCEED: no dependency concern
        VERIFY --> VERIFY: incomplete or cross-world evidence
        RESCUE --> RESCUE: counterpart inactive
        COORDINATE --> COORDINATE: overlap remains
        INSPECT --> INSPECT: imprecise claim
        RECONCILE --> RECONCILE: stale claim
        WATCH --> WATCH: dependency remains"
    `);
  });

  test('validator confirms the graph matches the table and catches drift', () => {
    expect(validateClaimTreeTroubleStateMachineMermaid()).toMatchInlineSnapshot(`
      {
        "actualEdges": [
          {
            "from": "[*]",
            "label": "",
            "to": "VERIFY",
          },
          {
            "from": "VERIFY",
            "label": "provenance/world confirmed",
            "to": "RESCUE",
          },
          {
            "from": "RESCUE",
            "label": "counterpart live",
            "to": "COORDINATE",
          },
          {
            "from": "COORDINATE",
            "label": "no direct overlap",
            "to": "INSPECT",
          },
          {
            "from": "INSPECT",
            "label": "precision known",
            "to": "RECONCILE",
          },
          {
            "from": "RECONCILE",
            "label": "claim fresh",
            "to": "WATCH",
          },
          {
            "from": "WATCH",
            "label": "no dependency concern",
            "to": "PROCEED",
          },
          {
            "from": "VERIFY",
            "label": "incomplete or cross-world evidence",
            "to": "VERIFY",
          },
          {
            "from": "RESCUE",
            "label": "counterpart inactive",
            "to": "RESCUE",
          },
          {
            "from": "COORDINATE",
            "label": "overlap remains",
            "to": "COORDINATE",
          },
          {
            "from": "INSPECT",
            "label": "imprecise claim",
            "to": "INSPECT",
          },
          {
            "from": "RECONCILE",
            "label": "stale claim",
            "to": "RECONCILE",
          },
          {
            "from": "WATCH",
            "label": "dependency remains",
            "to": "WATCH",
          },
        ],
        "expectedEdges": [
          {
            "from": "[*]",
            "label": "",
            "to": "VERIFY",
          },
          {
            "from": "VERIFY",
            "label": "provenance/world confirmed",
            "to": "RESCUE",
          },
          {
            "from": "RESCUE",
            "label": "counterpart live",
            "to": "COORDINATE",
          },
          {
            "from": "COORDINATE",
            "label": "no direct overlap",
            "to": "INSPECT",
          },
          {
            "from": "INSPECT",
            "label": "precision known",
            "to": "RECONCILE",
          },
          {
            "from": "RECONCILE",
            "label": "claim fresh",
            "to": "WATCH",
          },
          {
            "from": "WATCH",
            "label": "no dependency concern",
            "to": "PROCEED",
          },
          {
            "from": "VERIFY",
            "label": "incomplete or cross-world evidence",
            "to": "VERIFY",
          },
          {
            "from": "RESCUE",
            "label": "counterpart inactive",
            "to": "RESCUE",
          },
          {
            "from": "COORDINATE",
            "label": "overlap remains",
            "to": "COORDINATE",
          },
          {
            "from": "INSPECT",
            "label": "imprecise claim",
            "to": "INSPECT",
          },
          {
            "from": "RECONCILE",
            "label": "stale claim",
            "to": "RECONCILE",
          },
          {
            "from": "WATCH",
            "label": "dependency remains",
            "to": "WATCH",
          },
        ],
        "extraEdges": [],
        "missingEdges": [],
        "ok": true,
      }
    `);

    const drifted = claimTreeTroubleStateMachineMermaid().replace(
      'WATCH --> PROCEED: no dependency concern',
      'WATCH --> PROCEED: dependency concern',
    );
    const validation = validateClaimTreeTroubleStateMachineMermaid(drifted);
    expect(validation.ok).toBe(false);
    expect(validation.missingEdges).toEqual([
      { from: 'WATCH', to: 'PROCEED', label: 'no dependency concern' },
    ]);
    expect(validation.extraEdges).toEqual([
      { from: 'WATCH', to: 'PROCEED', label: 'dependency concern' },
    ]);
  });

  test('exports a complete bounded ego graph', () => {
    expect(
      renderClaimTreeTroubleMermaid({ filePath: 'lib/x.ts', selfSessionId: 'self', otherSessionId: 'other', state: 'COORDINATE' }),
    ).toContain('COORDINATE');
  });
});
