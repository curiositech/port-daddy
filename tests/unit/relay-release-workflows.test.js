import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseLegacyDurableObjectMigrations,
  validateFullSha,
  validateMigrationSequence,
} from '../../scripts/check-relay-do-migration-boundary.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readWorkflow = (name) => readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');

const config = (blocks) => `${blocks.join('\n')}\n[vars]\nRELAY_VERSION = "test"\n`;
const block = (tag, operation = 'new_classes = ["Example"]') => `[[migrations]]\ntag = "${tag}"\n${operation}`;

describe('Relay Durable Object migration boundary', () => {
  test('accepts only immutable full lower-case SHAs', () => {
    const sha = 'a'.repeat(40);
    expect(validateFullSha('migration_sha', sha)).toBe(sha);
    for (const invalid of ['a'.repeat(39), 'A'.repeat(40), 'main', `${sha}^`]) {
      expect(() => validateFullSha('migration_sha', invalid)).toThrow('full 40-character');
    }
  });

  test('parses ordered top-level lifecycle blocks and rejects duplicate tags', () => {
    expect(parseLegacyDurableObjectMigrations(config([
      block('v0001'),
      block('v0002', 'new_sqlite_classes = ["Quota"]'),
    ]))).toEqual([
      { tag: 'v0001', lifecycleKeys: ['new_classes'] },
      { tag: 'v0002', lifecycleKeys: ['new_sqlite_classes'] },
    ]);
    expect(() => parseLegacyDurableObjectMigrations(config([
      block('v0001'), block('v0001'),
    ]))).toThrow('unique');
  });

  test('requires exactly one appended lifecycle migration with the expected tag', () => {
    const baselineSource = config([block('v0001')]);
    const valid = validateMigrationSequence({
      baselineSource,
      candidateSource: config([block('v0001'), block('v0002')]),
      expectedTag: 'v0002',
    });
    expect(valid.added).toEqual({ tag: 'v0002', lifecycleKeys: ['new_classes'] });

    expect(() => validateMigrationSequence({
      baselineSource,
      candidateSource: config([block('changed'), block('v0002')]),
      expectedTag: 'v0002',
    })).toThrow('preserve the baseline');
    expect(() => validateMigrationSequence({
      baselineSource,
      candidateSource: config([block('v0001'), block('v0002'), block('v0003')]),
      expectedTag: 'v0002',
    })).toThrow('exactly one');
    expect(() => validateMigrationSequence({
      baselineSource,
      candidateSource: config([block('v0001'), block('v0002', 'note = "not lifecycle"')]),
      expectedTag: 'v0002',
    })).toThrow('no Durable Object lifecycle');
  });
});

describe('Relay production workflow topology', () => {
  test('keeps the atomic migration exception guarded and separate from gradual releases', () => {
    const workflow = readWorkflow('deploy-relay-do-migration.yml');
    const executableWorkflow = workflow
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    const validate = workflow.indexOf('Validate exact-SHA lifecycle boundary');
    const checkoutMigration = workflow.indexOf('git checkout --detach "$MIGRATION_SHA"');
    const deploy = workflow.indexOf('npx wrangler deploy --config wrangler.deploy.toml --env=""');

    expect(workflow).toContain('baseline_sha:');
    expect(workflow).toContain('migration_sha:');
    expect(workflow).toContain('expected_migration_tag:');
    expect(workflow).toContain('confirm_atomic_cutover:');
    expect(workflow).toContain("inputs.confirm_atomic_cutover");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('group: deploy-relay-prod');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('check-relay-do-migration-boundary.mjs');
    expect(validate).toBeGreaterThan(-1);
    expect(checkoutMigration).toBeGreaterThan(validate);
    expect(deploy).toBeGreaterThan(checkoutMigration);
    expect(workflow).toContain('npx tsc --noEmit -p tsconfig.json');
    expect(workflow).toContain('npx vitest run');
    expect(workflow).toContain('Prove production matches the submitted baseline');
    expect(workflow).toContain('wrangler versions view "$version_id"');
    expect(workflow).toContain('.baselineMigrationTag // empty');
    expect(workflow).toContain('.resources.script_runtime.migration_tag == $tag');
    expect(workflow).toContain('https://relay.portdaddy.dev/health');
    expect(workflow).toContain('WRANGLER_OUTPUT_FILE_PATH:');
    expect(workflow).toContain('select(.type == "deploy") | .version_id');
    expect(workflow).toContain('wrangler deployments status');
    expect(workflow).toContain('.versions[0].version_id == $id');
    expect(workflow).toContain('.versions[0].percentage == 100');
    expect(executableWorkflow).not.toContain('wrangler versions upload');
    expect(executableWorkflow).not.toContain('wrangler d1 migrations apply');
  });

  test('ordinary production releases retain the version upload and promotion lane', () => {
    const workflow = readWorkflow('deploy-relay-prod.yml');
    expect(workflow).toContain('wrangler versions upload');
    expect(workflow).toContain('wrangler versions deploy');
    expect(workflow).toContain('group: deploy-relay-prod');
  });
});
