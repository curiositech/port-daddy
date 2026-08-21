import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readWorkflow = (name) => readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');

describe('release workflow topology contracts', () => {
  test('release publication is derived from merged tree state, not the PR head name', () => {
    const workflow = readWorkflow('release-train.yml');

    expect(workflow).toContain("github.event.pull_request.base.ref == 'main'");
    expect(workflow).toContain('Detect an unpublished merged release version');
    expect(workflow).toContain('git show-ref --verify --quiet "refs/tags/$tag"');
    expect(workflow).toContain('git rev-list --reverse "$range" -- package.json');
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
    expect(workflow).toContain('brew info --json=v2 curiositech/tap/port-daddy');
    expect(workflow).toContain('if [ "$actual_version" != "$expected_version" ]');
  });
});
