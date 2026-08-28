import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createSessions } from '../../lib/sessions.js';

describe('sessions.applySugarParleySettlement', () => {
  let db: any;
  let sessions: ReturnType<typeof createSessions>;

  beforeEach(() => {
    db = createTestDb();
    sessions = createSessions(db, undefined, { requireAgentForFileClaims: true });
  });

  afterEach(() => {
    db?.close();
  });

  function startSession(purpose: string, agentId: string, files: string[]) {
    const result = sessions.start(purpose, { agentId, files });
    expect(result.success).toBe(true);
    return result.id as string;
  }

  function activeClaim(sessionId: string, filePath: string) {
    const result = sessions.listAllActiveClaims();
    expect(result.success).toBe(true);
    const claim = result.claims.find(candidate => candidate.sessionId === sessionId && candidate.filePath === filePath);
    expect(claim).toBeDefined();
    expect(Number.isSafeInteger(claim!.sessionFileId)).toBe(true);
    return claim! as typeof claim & { sessionFileId: number };
  }

  function settlementInput(leftId: string, rightId: string) {
    const left = activeClaim(leftId, 'lib/shared.ts');
    const right = activeClaim(rightId, 'lib/shared.ts');
    return {
      claims: [
        { sessionId: leftId, agentId: 'agent-left', sessionFileId: left.sessionFileId, claimRef: 'evidence:left' },
        { sessionId: rightId, agentId: 'agent-right', sessionFileId: right.sessionFileId, claimRef: 'evidence:right' },
      ],
      plans: [
        { sessionId: leftId, agentId: 'agent-left', content: '- [x] Sugar Parley settlement: split the shared boundary' },
        { sessionId: rightId, agentId: 'agent-right', content: '- [x] Sugar Parley settlement: take the second half' },
      ],
    };
  }

  function applyWithinParleyTransaction(input: Parameters<typeof sessions.applySugarParleySettlement>[0]) {
    return db.transaction(() => sessions.applySugarParleySettlement(input))();
  }

  test('releases only the exact durable claim rows and appends the two plan receipts', () => {
    const leftId = startSession('left work', 'agent-left', ['lib/shared.ts', 'lib/left-only.ts']);
    const rightId = startSession('right work', 'agent-right', ['lib/shared.ts', 'lib/right-only.ts']);
    const input = settlementInput(leftId, rightId);

    const result = applyWithinParleyTransaction(input);

    expect(result).toMatchObject({ success: true });
    if (!result.success) throw new Error(result.error);
    expect(result.claimUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionId: leftId,
        sessionFileId: input.claims[0].sessionFileId,
        claimRef: 'evidence:left',
        filePath: 'lib/shared.ts',
        released: true,
        claimForestRowsReleased: 1,
      }),
      expect.objectContaining({
        sessionId: rightId,
        sessionFileId: input.claims[1].sessionFileId,
        claimRef: 'evidence:right',
        filePath: 'lib/shared.ts',
        released: true,
        claimForestRowsReleased: 1,
      }),
    ]));
    expect(result.planUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: leftId, agentId: 'agent-left', type: 'todo_list', updated: true }),
      expect.objectContaining({ sessionId: rightId, agentId: 'agent-right', type: 'todo_list', updated: true }),
    ]));

    const active = sessions.listAllActiveClaims();
    expect(active.claims.some(claim => claim.sessionFileId === input.claims[0].sessionFileId)).toBe(false);
    expect(active.claims.some(claim => claim.sessionFileId === input.claims[1].sessionFileId)).toBe(false);
    expect(active.claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: leftId, filePath: 'lib/left-only.ts' }),
      expect.objectContaining({ sessionId: rightId, filePath: 'lib/right-only.ts' }),
    ]));

    expect(sessions.getNotes(leftId, { type: 'todo_list' }).notes).toEqual([
      expect.objectContaining({ content: input.plans[0].content, type: 'todo_list' }),
    ]);
    expect(sessions.getNotes(rightId, { type: 'todo_list' }).notes).toEqual([
      expect.objectContaining({ content: input.plans[1].content, type: 'todo_list' }),
    ]);
  });

  test('leaves claims and plan receipts unchanged when one target session is at note capacity', () => {
    const leftId = startSession('left work', 'agent-left', ['lib/shared.ts']);
    const rightId = startSession('right work', 'agent-right', ['lib/shared.ts']);
    const input = settlementInput(leftId, rightId);
    for (let index = 0; index < 500; index += 1) {
      expect(sessions.addNote(leftId, `existing note ${index}`).success).toBe(true);
    }

    const result = applyWithinParleyTransaction(input);

    expect(result).toMatchObject({ success: false, code: 'NOTES_LIMIT_EXCEEDED' });
    const active = sessions.listAllActiveClaims();
    expect(active.claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionFileId: input.claims[0].sessionFileId, filePath: 'lib/shared.ts' }),
      expect.objectContaining({ sessionFileId: input.claims[1].sessionFileId, filePath: 'lib/shared.ts' }),
    ]));
    expect(sessions.getNotes(leftId, { type: 'todo_list' }).count).toBe(0);
    expect(sessions.getNotes(rightId, { type: 'todo_list' }).count).toBe(0);
  });

  test('rejects an unknown durable session-file id without touching any settlement effect', () => {
    const leftId = startSession('left work', 'agent-left', ['lib/shared.ts']);
    const rightId = startSession('right work', 'agent-right', ['lib/shared.ts']);
    const input = settlementInput(leftId, rightId);
    input.claims[0].sessionFileId += 100_000;

    const result = applyWithinParleyTransaction(input);

    expect(result).toMatchObject({ success: false, code: 'SETTLEMENT_CLAIM_NOT_ACTIVE' });
    const active = sessions.listAllActiveClaims();
    expect(active.claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: leftId, filePath: 'lib/shared.ts' }),
      expect.objectContaining({ sessionId: rightId, filePath: 'lib/shared.ts' }),
    ]));
    expect(sessions.getNotes(leftId, { type: 'todo_list' }).count).toBe(0);
    expect(sessions.getNotes(rightId, { type: 'todo_list' }).count).toBe(0);
  });

  test('rolls exact claim releases back when writing a checked plan receipt fails', () => {
    const leftId = startSession('left work', 'agent-left', ['lib/shared.ts']);
    const rightId = startSession('right work', 'agent-right', ['lib/shared.ts']);
    const input = settlementInput(leftId, rightId);
    db.exec(`
      CREATE TRIGGER fail_sugar_parley_plan_receipt
      BEFORE INSERT ON session_notes
      WHEN NEW.type = 'todo_list'
      BEGIN
        SELECT RAISE(ABORT, 'test settlement plan write failure');
      END;
    `);

    const result = applyWithinParleyTransaction(input);

    expect(result).toMatchObject({ success: false, code: 'SETTLEMENT_WRITE_FAILED' });
    const active = sessions.listAllActiveClaims();
    expect(active.claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionFileId: input.claims[0].sessionFileId, filePath: 'lib/shared.ts' }),
      expect.objectContaining({ sessionFileId: input.claims[1].sessionFileId, filePath: 'lib/shared.ts' }),
    ]));
    expect(sessions.getNotes(leftId, { type: 'todo_list' }).count).toBe(0);
    expect(sessions.getNotes(rightId, { type: 'todo_list' }).count).toBe(0);
  });

  test('refuses to run outside the owning terminal Parley transaction', () => {
    const leftId = startSession('left work', 'agent-left', ['lib/shared.ts']);
    const rightId = startSession('right work', 'agent-right', ['lib/shared.ts']);
    const input = settlementInput(leftId, rightId);

    const result = sessions.applySugarParleySettlement(input);

    expect(result).toMatchObject({ success: false, code: 'SETTLEMENT_TRANSACTION_REQUIRED' });
    expect(sessions.listAllActiveClaims().claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: leftId, filePath: 'lib/shared.ts' }),
      expect.objectContaining({ sessionId: rightId, filePath: 'lib/shared.ts' }),
    ]));
  });
});
