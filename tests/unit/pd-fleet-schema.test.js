import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMA_PATH = join(
  ROOT,
  'skills',
  'port-daddy-agent-skill',
  'schemas',
  'pd-fleet.schema.json',
);
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

function fleetWithCloudOnly(cloudOnly) {
  return {
    fleet: {
      name: 'example',
      agents: {
        qa: {
          backend: 'cloudflare',
          model: '@cf/qwen/qwen3-30b-a3b-fp8',
          prompt: 'Review this exact head.',
          cloud_only: cloudOnly,
        },
      },
    },
  };
}

describe('pd-fleet public JSON schema cloud_only contract', () => {
  test.each([true, false])('accepts the boolean value %s', (cloudOnly) => {
    expect(validate(fleetWithCloudOnly(cloudOnly))).toBe(true);
    expect(validate.errors).toBeNull();
  });

  test('rejects string false instead of silently changing its meaning', () => {
    expect(validate(fleetWithCloudOnly('false'))).toBe(false);
    expect(validate.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        instancePath: '/fleet/agents/qa/cloud_only',
        keyword: 'type',
      }),
    ]));
  });
});
