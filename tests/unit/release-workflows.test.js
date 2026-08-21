import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareStableVersions,
  extractFormulaVersion,
  findVersionTransition,
  formulaMatchesRelease,
  parseStableVersion,
  selectVersionTransition,
  stableVersionFromTag,
} from '../../scripts/release-workflow-state.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE_HELPER = join(ROOT, 'scripts', 'release-workflow-state.mjs');
const readWorkflow = (name) => readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');

describe('release workflow topology contracts', () => {
  test('release publication is derived from merged tree state, not the PR head name', () => {
    const workflow = readWorkflow('release-train.yml');

    expect(workflow).toContain("github.event.pull_request.base.ref == 'main'");
    expect(workflow).toContain('Detect an unpublished merged release version');
    expect(workflow).toContain('git show-ref --verify --quiet "refs/tags/$tag"');
    expect(workflow).toContain('release-workflow-state.mjs find-transition "$version" "$range"');
    expect(workflow).toContain('release_sha=$release_sha');
    expect(workflow).toContain('ref: ${{ steps.release.outputs.release_sha }}');
    expect(workflow).toContain('steps.release.outputs.should_publish');
    expect(workflow).not.toContain("startsWith(github.event.pull_request.head.ref, 'release-train/')");
  });

  test('release publication and tap dispatch prefer the dedicated train token', () => {
    const train = readWorkflow('release-train.yml');
    const release = readWorkflow('release.yml');
    const tokenExpression = '${{ secrets.RELEASE_TRAIN_TOKEN || secrets.HOMEBREW_TAP_TOKEN }}';

    expect(train).toContain(tokenExpression);
    expect(release).toContain('Authenticated tap access:');
    expect(release).toContain(`token: ${tokenExpression}`);
    expect(release).not.toContain('token: ${{ secrets.HOMEBREW_TAP_TOKEN }}');
  });

  test('release-triggered brew smoke waits for and resolves the exact formula version', () => {
    const workflow = readWorkflow('fresh-install.yml');
    const waitStep = workflow.indexOf('Wait for the tap formula to match this release');
    const installStep = workflow.indexOf('Install the fully qualified Homebrew formula');

    expect(waitStep).toBeGreaterThan(-1);
    expect(installStep).toBeGreaterThan(waitStep);
    expect(workflow).toContain('EXPECTED_TAG: ${{ github.event.release.tag_name }}');
    expect(workflow).toContain('release-workflow-state.mjs validate-tag "$EXPECTED_TAG"');
    expect(workflow).toContain('release-workflow-state.mjs formula-matches "$EXPECTED_TAG" "$formula_path"');
    expect(workflow).toContain('brew info --json=v2 curiositech/tap/port-daddy');
    expect(workflow).toContain('if [ "$actual_version" != "$expected_version" ]');
  });
});

describe('release workflow state', () => {
  test('CLI rejects malformed workflow inputs with a non-zero exit', () => {
    const badVersion = spawnSync(process.execPath, [STATE_HELPER, 'validate-version', '3.29']);
    const badTag = spawnSync(process.execPath, [STATE_HELPER, 'validate-tag', '3.29.0']);
    const validTag = spawnSync(process.execPath, [STATE_HELPER, 'validate-tag', 'v3.29.0']);

    expect(badVersion.status).toBe(1);
    expect(badTag.status).toBe(1);
    expect(validTag.status).toBe(0);
    expect(validTag.stdout.toString()).toBe('3.29.0\n');
  });

  test('accepts only plain stable versions and v-prefixed stable tags', () => {
    expect(parseStableVersion('3.29.0')).toEqual([3, 29, 0]);
    expect(stableVersionFromTag('v3.29.0')).toBe('3.29.0');
    for (const invalid of ['3.29', '3.29.0-rc.1', 'v3.29.0', '']) {
      expect(() => parseStableVersion(invalid)).toThrow('not a stable x.y.z version');
    }
    for (const invalid of ['3.29.0', 'v3.29', 'v3.29.0-rc.1', '']) {
      expect(() => stableVersionFromTag(invalid)).toThrow('not a stable vx.y.z tag');
    }
  });

  test('compares all three numeric version components', () => {
    expect(compareStableVersions('3.29.0', '3.28.99')).toBeGreaterThan(0);
    expect(compareStableVersions('3.29.1', '3.29.0')).toBeGreaterThan(0);
    expect(compareStableVersions('3.29.0', '3.29.0')).toBe(0);
    expect(compareStableVersions('3.28.99', '3.29.0')).toBeLessThan(0);
  });

  test('selects the exact first version transition instead of a later carrier commit', () => {
    const candidates = [
      { sha: 'bump', version: '3.29.0', parentVersion: '3.28.0' },
      { sha: 'carrier', version: '3.29.0', parentVersion: '3.29.0' },
    ];
    expect(selectVersionTransition('3.29.0', candidates)).toBe('bump');
    expect(() => selectVersionTransition('3.30.0', candidates)).toThrow('could not locate');
  });

  test('reads candidate package states through the same git boundary the workflow calls', () => {
    const responses = new Map([
      ['rev-list --reverse v3.28.0..head -- package.json', 'bump\ncarrier'],
      ['show bump:package.json', '{"version":"3.29.0"}'],
      ['show bump^:package.json', '{"version":"3.28.0"}'],
      ['show carrier:package.json', '{"version":"3.29.0"}'],
      ['show carrier^:package.json', '{"version":"3.29.0"}'],
    ]);
    const git = (args) => responses.get(args.join(' ')) ?? '';
    expect(findVersionTransition('3.29.0', 'v3.28.0..head', git)).toBe('bump');
  });

  test('matches only the formula version declaration for the exact release tag', () => {
    const formula = 'class PortDaddy < Formula\n  version "3.29.0"\nend\n';
    expect(extractFormulaVersion(formula)).toBe('3.29.0');
    expect(formulaMatchesRelease(formula, 'v3.29.0')).toBe(true);
    expect(formulaMatchesRelease(formula, 'v3.30.0')).toBe(false);
    expect(formulaMatchesRelease('desc "version 3.29.0"\n', 'v3.29.0')).toBe(false);
  });
});
