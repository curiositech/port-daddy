import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const Ajv = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats');
const schemaBase = new URL('../schemas/', import.meta.url);
const inputSchema = JSON.parse(readFileSync(new URL('input.json', schemaBase)));
const outputSchema = JSON.parse(readFileSync(new URL('output.json', schemaBase)));
const ajv = new Ajv({ allErrors: true, strict: true });

addFormats(ajv);
ajv.addSchema(inputSchema, 'input.json');
const validateShape = ajv.compile(outputSchema);

function sameNumber(left, right) {
  return Math.abs(left - right) < 1e-12;
}

export function validateForecast(record) {
  if (!validateShape(record)) return { valid: false, errors: validateShape.errors };

  const forecast = record.forecast;
  const errors = [];
  const forecastAt = Date.parse(forecast.forecastTime);
  const deadlineAt = Date.parse(forecast.resolutionDeadline);

  if (!Number.isFinite(forecastAt) || !Number.isFinite(deadlineAt)) {
    errors.push('forecast and deadline timestamps must be representable by Date.parse');
  }
  if (record.fitEvidence && record.calibrationMap) {
    if (record.calibrationMap.fitCohortId !== record.fitEvidence.cohortId) {
      errors.push('calibrationMap.fitCohortId must match fitEvidence.cohortId');
    }
    if (record.calibrationMap.id !== record.fitEvidence.modelId) {
      errors.push('calibrationMap.id must match fitEvidence.modelId');
    }
  }

  if (forecastAt >= deadlineAt) {
    errors.push('forecastTime must precede resolutionDeadline');
  }
  if ((record.status === 'declined') !== (forecast.status === 'declined')) {
    errors.push('outer status and forecast status must agree on declined');
  }

  if (record.status === 'evaluated') {
    const evaluation = record.evaluation;
    if (evaluation.samples.some((sample) => !Number.isFinite(Date.parse(sample.resolvedAt)))) {
      errors.push('all resolution timestamps must be representable by Date.parse');
    }
    const ids = evaluation.samples.map((sample) => sample.forecastId);
    if (new Set(ids).size !== ids.length) {
      errors.push('evaluation sample forecast IDs must be unique');
    }
    if (evaluation.denominator !== evaluation.samples.length) {
      errors.push('evaluation denominator must equal the number of scored samples');
    }
    if (evaluation.cohortId !== forecast.cohortId) {
      errors.push('evaluation cohortId must match the current forecast cohortId');
    }

    const currentSamples = evaluation.samples.filter(
      (sample) => sample.forecastId === forecast.forecastId,
    );
    if (currentSamples.length !== 1) {
      errors.push('evaluation must contain exactly one sample for this forecastId');
    } else {
      const sample = currentSamples[0];
      if (sample.eventId !== forecast.event.id) {
        errors.push('current evaluation sample eventId must match forecast event.id');
      }
      if (!sameNumber(sample.probability, forecast.probability)) {
        errors.push('current evaluation sample probability must match the prospective forecast');
      }
      if (Date.parse(sample.resolvedAt) <= forecastAt) {
        errors.push('current evaluation outcome must resolve after the forecast');
      }
    }

    const mean = evaluation.samples.reduce(
      (sum, sample) => sum + (sample.probability - sample.outcome) ** 2,
      0,
    ) / evaluation.samples.length;
    if (!sameNumber(mean, evaluation.meanBrier)) {
      errors.push('meanBrier must equal the mean Brier loss of supplied samples');
    }

    if (evaluation.mode === 'calibrated') {
      const fitIds = new Set(record.fitEvidence.forecastIds);
      if (ids.some((id) => fitIds.has(id))) {
        errors.push('fit and evaluation forecast IDs must be disjoint');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
