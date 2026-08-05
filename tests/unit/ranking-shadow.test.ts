/**
 * Shadow-mode ranking: judge with an agent, log the scores, learn offline.
 *
 * The property under test is not "does the ranker rank well" — nothing here can
 * know that yet. It is that the LEDGER is trustworthy enough to answer that
 * question later: every decision records which authority made it, the scores
 * are captured at decision time (the one moment they are recoverable), and a
 * judge that is slow or dead degrades the decision without corrupting the
 * record.
 */
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { analyzeAgreement, createShadowLogger } from '../../lib/ranking-shadow.js';

let dir: string;
let path: string;
let clock: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pd-shadow-'));
  path = join(dir, 'ranking-shadow.jsonl');
  clock = 1_000;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const now = () => (clock += 1);
const features = (lexical: number, thresholdVerdict: boolean) => ({
  lexical, semantic: 0.5, fused: 0.3, sharedFiles: 0, thresholdVerdict,
});
const yes = async () => ({ useful: true, reason: 'directly relevant', judge: 'cheap-v1' });
const no = async () => ({ useful: false, reason: 'unrelated', judge: 'cheap-v1' });

const lines = (): Record<string, unknown>[] =>
  readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('the agent decides, not the threshold', () => {
  test('agent YES overrides a threshold that said hide', async () => {
    // The whole point: judgement is what we trust today. A threshold nobody
    // validated must not be able to veto it.
    const log = createShadowLogger({ path, now });
    const { shown, row } = await log.decide({
      actor: 'alpha', kind: 'salvage', candidate: 'c1', candidateText: 'x',
      query: 'wire the reconcile producers',
      features: features(0.02, false), judge: yes,
    });
    expect(shown).toBe(true);
    expect(row.decidedBy).toBe('agent');
  });

  test('agent NO overrides a threshold that said show', async () => {
    const log = createShadowLogger({ path, now });
    const { shown } = await log.decide({
      actor: 'alpha', kind: 'salvage', candidate: 'c1', candidateText: 'x',
      query: 'q', features: features(0.99, true), judge: no,
    });
    expect(shown).toBe(false);
  });

  test('the threshold verdict is still RECORDED even when overridden', async () => {
    // Without this the ledger cannot answer whether the threshold was wrong —
    // which is the only question it exists to answer.
    const log = createShadowLogger({ path, now });
    await log.decide({
      actor: 'alpha', kind: 'salvage', candidate: 'c1', candidateText: 'x',
      query: 'q', features: features(0.99, true), judge: no,
    });
    expect(lines()[0].features).toMatchObject({ thresholdVerdict: true, lexical: 0.99 });
  });
});

describe('degradation never corrupts the record', () => {
  test('a throwing judge falls back to the threshold and SAYS so', async () => {
    const log = createShadowLogger({ path, now });
    const { shown, row } = await log.decide({
      actor: 'alpha', kind: 'salvage', candidate: 'c1', candidateText: 'x',
      query: 'q', features: features(0.9, true),
      judge: async () => { throw new Error('judge timeout'); },
    });
    expect(shown).toBe(true);
    expect(row.decidedBy).toBe('threshold');
    expect(row.judgement).toBeNull();
  });

  test('a judge returning null is not a guess — it is no judgement', async () => {
    const log = createShadowLogger({ path, now });
    const { row } = await log.decide({
      actor: 'alpha', kind: 'salvage', candidate: 'c1', candidateText: 'x',
      query: 'q', features: features(0.9, true), judge: async () => null,
    });
    expect(row.decidedBy).toBe('threshold');
  });

  test('with no judge and fallback disabled, nothing is shown on a guess', async () => {
    const log = createShadowLogger({ path, now, fallbackToThreshold: false });
    const { shown } = await log.decide({
      actor: 'alpha', kind: 'salvage', candidate: 'c1', candidateText: 'x',
      query: 'q', features: features(0.99, true),
    });
    expect(shown).toBe(false);
  });

  test('an unwritable ledger never breaks the briefing', async () => {
    // A path whose PARENT is a regular file: mkdirSync fails fast and
    // deterministically, unlike /proc which behaves oddly under containers.
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'not a directory');
    const log = createShadowLogger({ path: join(blocker, 'nested', 'log.jsonl'), now });
    await expect(
      log.decide({
        actor: 'alpha', kind: 'salvage', candidate: 'c1', candidateText: 'x',
        query: 'q', features: features(0.9, true), judge: yes,
      }),
    ).resolves.toMatchObject({ shown: true });
  });
});

describe('outcomes attach separately', () => {
  test('an outcome is a distinct row, not a rewrite of the decision', async () => {
    // A decision record that can be rewritten is not a record; and an outcome
    // known at decision time would mean the harness is measuring its own
    // prediction.
    const log = createShadowLogger({ path, now });
    const { row } = await log.decide({
      actor: 'alpha', kind: 'salvage', candidate: 'c1', candidateText: 'x',
      query: 'q', features: features(0.5, true), judge: yes,
    });
    log.recordOutcome({ id: row.id, acted: true, evidence: 'agent resumed the salvage' });

    const all = lines();
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ type: 'outcome', id: row.id, acted: true });
    expect(all[0].id).toBe(row.id);
  });
});

describe('offline analysis answers the real question', () => {
  test('reports where the threshold and the agent disagree', async () => {
    const log = createShadowLogger({ path, now });
    // Threshold says show, agent says no => a false positive: noise shipped.
    await log.decide({ actor: 'a', kind: 'salvage', candidate: 'c1', candidateText: 'x', query: 'q', features: features(0.9, true), judge: no });
    // Threshold says hide, agent says yes => a false negative: value lost.
    await log.decide({ actor: 'a', kind: 'salvage', candidate: 'c2', candidateText: 'x', query: 'q', features: features(0.01, false), judge: yes });
    // And one they agree on.
    await log.decide({ actor: 'a', kind: 'salvage', candidate: 'c3', candidateText: 'x', query: 'q', features: features(0.8, true), judge: yes });

    const r = analyzeAgreement(path);
    expect(r).toMatchObject({ judged: 3, agreements: 1, falsePositives: 1, falseNegatives: 1 });
    expect(r.agreementRate).toBeCloseTo(1 / 3, 5);
  });

  test('refuses to propose a threshold from too little data', () => {
    // A cutoff fitted to three points is not a finding.
    const log = createShadowLogger({ path, now });
    return log
      .decide({ actor: 'a', kind: 'salvage', candidate: 'c1', candidateText: 'x', query: 'q', features: features(0.5, true), judge: yes })
      .then(() => expect(analyzeAgreement(path).bestLexicalThreshold).toBeNull());
  });

  test('finds a separating cutoff when one genuinely exists', async () => {
    const log = createShadowLogger({ path, now });
    // Agent says yes above 0.5 and no below — a threshold CAN reproduce this.
    for (let i = 0; i < 12; i += 1) {
      const lex = i / 12;
      await log.decide({
        actor: 'a', kind: 'salvage', candidate: `c${i}`, candidateText: 'x', query: 'q',
        features: features(lex, true), judge: lex >= 0.5 ? yes : no,
      });
    }
    const best = analyzeAgreement(path).bestLexicalThreshold;
    expect(best).not.toBeNull();
    expect(best!.accuracy).toBe(1);
    expect(best!.value).toBeCloseTo(0.5, 2);
  });

  test('a missing or torn ledger analyses to zeroes, not a crash', () => {
    expect(analyzeAgreement(join(dir, 'nope.jsonl')).rows).toBe(0);
  });
});
