import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateForecast } from '../scripts/validate-forecast.mjs';

const rawRecord = JSON.parse(readFileSync(new URL('../examples/raw-evaluated.json', import.meta.url)));

const calibratedRecord = {
  ...structuredClone(rawRecord),
  fitEvidence: {
    modelId: 'isotonic-map',
    cohortId: 'fit-week-0',
    forecastIds: ['forecast-fit-1'],
  },
  calibrationMap: { id: 'isotonic-map', version: '1', fitCohortId: 'fit-week-0' },
  evaluation: { ...structuredClone(rawRecord.evaluation), mode: 'calibrated' },
};

test('valid raw evaluation passes without a fitted map', () => {
  assert.equal(validateForecast(rawRecord).valid, true);
});

test('valid calibrated evaluation passes with disjoint fit evidence', () => {
  assert.equal(validateForecast(calibratedRecord).valid, true);
});

const invalidMutations = [
  ['invalid calendar', (record) => { record.forecast.forecastTime = '2026-99-99Tgarbage'; }],
  ['whitespace event predicate', (record) => { record.forecast.event.predicate = '   '; }],
  ['whitespace forecast identity', (record) => { record.forecast.forecastId = '   '; }],
  ['whitespace cohort', (record) => { record.forecast.cohortId = '\t'; }],
  ['blank outcome source', (record) => { record.evaluation.samples[0].resolutionSource = ' '; }],
  ['evaluated without evaluation', (record) => { delete record.evaluation; }],
  ['fitted without map', (record) => {
    record.status = 'calibration-fitted';
    record.fitEvidence = structuredClone(calibratedRecord.fitEvidence);
  }],
  ['fit reused as evaluation', (record) => {
    Object.assign(record, structuredClone(calibratedRecord));
    record.evaluation.samples[0].forecastId = 'forecast-fit-1';
  }],
  ['map fit cohort differs from fit evidence cohort', (record) => {
    Object.assign(record, structuredClone(calibratedRecord));
    record.calibrationMap.fitCohortId = 'fit-other';
  }],
  ['map identity differs from fitted model', (record) => {
    Object.assign(record, structuredClone(calibratedRecord));
    record.calibrationMap.id = 'different-map';
  }],
  ['declared denominator disagrees with samples', (record) => { record.evaluation.denominator = 999; }],
  ['evaluation cohort differs from forecast cohort', (record) => { record.evaluation.cohortId = 'other-cohort'; }],
  ['current probability rewritten after resolution', (record) => { record.evaluation.samples[0].probability = 0.2; }],
  ['outcome event does not bind to forecast event', (record) => { record.evaluation.samples[0].eventId = 'event-other'; }],
  ['outcome precedes forecast', (record) => { record.evaluation.samples[0].resolvedAt = '2026-01-01T00:00:00Z'; }],
  ['aggregate Brier arithmetic is false', (record) => { record.evaluation.meanBrier = 0.2; }],
  ['raw evaluation includes a fit', (record) => { record.fitEvidence = structuredClone(calibratedRecord.fitEvidence); }],
  ['fitted record retains an evaluation', (record) => {
    record.status = 'calibration-fitted';
    record.fitEvidence = structuredClone(calibratedRecord.fitEvidence);
    record.calibrationMap = structuredClone(calibratedRecord.calibrationMap);
  }],
  ['uncalibrated record retains evaluation evidence', (record) => { record.status = 'uncalibrated'; }],
  ['outer and inner decline states disagree', (record) => { record.status = 'declined'; }],
];

for (const [label, mutate] of invalidMutations) {
  test(`rejects ${label}`, () => {
    const record = structuredClone(rawRecord);
    mutate(record);
    assert.equal(validateForecast(record).valid, false);
  });
}

test('declined forecast accepts null probability and no evidence', () => {
  const record = structuredClone(rawRecord);
  record.forecast.status = 'declined';
  record.forecast.probability = null;
  record.status = 'declined';
  delete record.evaluation;
  assert.equal(validateForecast(record).valid, true);
});

test('declined forecast rejects retained evaluation evidence', () => {
  const record = structuredClone(rawRecord);
  record.forecast.status = 'declined';
  record.forecast.probability = null;
  record.status = 'declined';
  assert.equal(validateForecast(record).valid, false);
});

test('additional evidence fields remain permitted', () => {
  const record = structuredClone(rawRecord);
  record.forecast.evidenceRefs = ['receipt:evidence-a'];
  record.auditNote = 'reviewed';
  assert.equal(validateForecast(record).valid, true);
});

test('uncalibrated forecast passes without score or fit evidence', () => {
  const record = structuredClone(rawRecord);
  record.status = 'uncalibrated';
  delete record.evaluation;
  assert.equal(validateForecast(record).valid, true);
});

test('fitted calibration map passes before a held-out evaluation', () => {
  const record = structuredClone(rawRecord);
  record.status = 'calibration-fitted';
  record.fitEvidence = structuredClone(calibratedRecord.fitEvidence);
  record.calibrationMap = structuredClone(calibratedRecord.calibrationMap);
  delete record.evaluation;
  assert.equal(validateForecast(record).valid, true);
});


for (const field of ['forecastTime', 'resolutionDeadline', 'resolvedAt']) {
  test(`rejects unsupported leap-second timestamp in ${field}`, () => {
    const record = structuredClone(rawRecord);
    const target = field === 'resolvedAt' ? record.evaluation.samples[0] : record.forecast;
    target[field] = '2026-06-30T23:59:60Z';
    assert.equal(validateForecast(record).valid, false);
  });
}
for (const field of ['id', 'fitCohortId']) {
  test(`fit-only record rejects inconsistent map ${field}`, () => {
    const record = structuredClone(calibratedRecord);
    record.status = 'calibration-fitted';
    delete record.evaluation;
    record.calibrationMap[field] = 'different';
    assert.equal(validateForecast(record).valid, false);
  });
}
test('three-sample Brier teaching arithmetic passes', () => {
  const record = structuredClone(rawRecord);
  record.forecast.probability = 0.8;
  const sample = record.evaluation.samples[0];
  record.evaluation.samples = [
    {...sample, probability: 0.8, outcome: 1},
    {...sample, forecastId: 'f2', probability: 0.8, outcome: 0},
    {...sample, forecastId: 'f3', probability: 0.2, outcome: 0},
  ];
  record.evaluation.denominator = 3;
  record.evaluation.meanBrier = 0.24;
  assert.equal(validateForecast(record).valid, true);
});
test('duplicate scored identities are rejected even with consistent arithmetic', () => {
  const record = structuredClone(rawRecord);
  record.evaluation.samples.push(structuredClone(record.evaluation.samples[0]));
  record.evaluation.denominator = 2;
  assert.equal(validateForecast(record).valid, false);
});
