import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseLegacyDurableObjectMigrations,
  validateFullSha,
  validateMigrationSequence,
  validateRepositoryBoundary,
} from '../../scripts/check-relay-do-migration-boundary.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readWorkflow = (name) => readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');

const config = (blocks) => `${blocks.join('\n')}\n[vars]\nRELAY_VERSION = "test"\n`;
const block = (tag, operation = 'new_classes = ["Example"]') => `[[migrations]]\ntag = "${tag}"\n${operation}`;
const BASELINE_SHA = 'a'.repeat(40);
const MIGRATION_SHA = 'b'.repeat(40);
const CONFIG_PATH = 'apps/relay/wrangler.deploy.toml';
const D1_MIGRATIONS_PATH = 'apps/relay/migrations';

const workflowConcurrency = (source) => {
  const match = source.match(
    /^concurrency:\s*\n\s*group:\s*([^\s#]+)\s*\n\s*cancel-in-progress:\s*(true|false)\s*$/m,
  );
  if (!match) throw new Error('workflow lacks a static concurrency policy');
  return { group: match[1], cancelInProgress: match[2] === 'true' };
};

const repositoryGit = ({ d1Changes = '', failCommand = null } = {}) => {
  const baselineSource = config([block('v0001')]);
  const candidateSource = config([block('v0001'), block('v0002')]);
  return (args, options = {}) => {
    const command = args.join(' ');
    if (command === failCommand) {
      if (options.allowFailure) return { status: 1, stdout: '', stderr: 'forced failure' };
      throw new Error(`git ${command} failed: forced failure`);
    }
    if (command.startsWith('merge-base --is-ancestor ')) {
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command === `show ${BASELINE_SHA}:${CONFIG_PATH}`) {
      return { status: 0, stdout: baselineSource, stderr: '' };
    }
    if (command === `show ${MIGRATION_SHA}:${CONFIG_PATH}`) {
      return { status: 0, stdout: candidateSource, stderr: '' };
    }
    if (command === `diff --name-only ${BASELINE_SHA}..${MIGRATION_SHA} -- ${D1_MIGRATIONS_PATH}`) {
      return { status: 0, stdout: d1Changes, stderr: '' };
    }
    if (command === `diff --name-only ${BASELINE_SHA}..${MIGRATION_SHA} -- apps/relay`) {
      return { status: 0, stdout: `${CONFIG_PATH}\n`, stderr: '' };
    }
    throw new Error(`unexpected fake Git command: ${command}`);
  };
};

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

  test('rejects hostile migration tags instead of accepting regex lookalikes', () => {
    const baselineSource = config([block('v0001')]);
    const candidateSource = config([block('v0001'), block('v0002')]);
    for (const expectedTag of ['v 0002', 'v🔥', 'v/0002', 'v0002\nextra']) {
      expect(() => validateMigrationSequence({
        baselineSource,
        candidateSource,
        expectedTag,
      })).toThrow('expected migration tag');
    }
  });

  test('fails closed on Git ancestry and command errors', () => {
    const input = {
      baselineSha: BASELINE_SHA,
      migrationSha: MIGRATION_SHA,
      expectedTag: 'v0002',
    };
    expect(() => validateRepositoryBoundary(
      input,
      repositoryGit({
        failCommand: `merge-base --is-ancestor ${BASELINE_SHA} origin/main`,
      }),
    )).toThrow(`${BASELINE_SHA} is not an ancestor of origin/main`);
    expect(() => validateRepositoryBoundary(
      input,
      repositoryGit({ failCommand: `show ${MIGRATION_SHA}:${CONFIG_PATH}` }),
    )).toThrow('git show');
    expect(() => validateRepositoryBoundary(
      input,
      repositoryGit({
        failCommand: `diff --name-only ${BASELINE_SHA}..${MIGRATION_SHA} -- ${D1_MIGRATIONS_PATH}`,
      }),
    )).toThrow('git diff');
  });

  test('rejects a D1 migration in the atomic Durable Object interval', () => {
    expect(() => validateRepositoryBoundary(
      {
        baselineSha: BASELINE_SHA,
        migrationSha: MIGRATION_SHA,
        expectedTag: 'v0002',
      },
      repositoryGit({ d1Changes: 'apps/relay/migrations/0002_forbidden.sql\n' }),
    )).toThrow('D1 migrations belong to the staging-first lane');
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

  test('serializes atomic and ordinary production deploys under one policy', () => {
    const atomic = workflowConcurrency(readWorkflow('deploy-relay-do-migration.yml'));
    const ordinary = workflowConcurrency(readWorkflow('deploy-relay-prod.yml'));
    expect(atomic).toEqual({ group: 'deploy-relay-prod', cancelInProgress: false });
    expect(atomic).toEqual(ordinary);
  });
});
