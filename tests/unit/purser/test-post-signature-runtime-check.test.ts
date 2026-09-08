import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSemanticRuntimeProof } from '../../../scripts/lib/onnx-runtime-native.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('release workflow performs the semantic import after the signing step', () => {
  const workflow = readFileSync(resolve(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8');
  const signIndex = workflow.indexOf('node scripts/sign-and-notarize.mjs dist/pd');
  const smokeIndex = workflow.indexOf('Smoke exact release semantic runtime (post-sign on macOS)');

  expect(signIndex).toBeGreaterThan(-1);
  expect(smokeIndex).toBeGreaterThan(signIndex);
  expect(workflow.slice(smokeIndex)).toContain('PORT_DADDY_RESOURCE_DIR: ${{ github.workspace }}');
  expect(workflow.slice(smokeIndex)).toContain('dist/pd __semantic-runtime-check');
});

test('semantic proof parser accepts the runtime backend receipt shape', () => {
  expect(parseSemanticRuntimeProof(JSON.stringify({
    success: true,
    backends: [
      { name: 'cpu', bundled: true },
      { name: 'webgpu', bundled: true },
      { name: 'coreml', bundled: true },
    ],
  }))).toMatchObject({ success: true });
});

const binaryPath = resolve(repoRoot, 'dist', 'pd');
const exactArtifactTest = process.platform === 'darwin' && existsSync(binaryPath)
  ? test
  : test.skip;

exactArtifactTest('exact built artifact imports ONNX with both DYLD variables absent', () => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.DYLD_FALLBACK_LIBRARY_PATH;
  delete env.DYLD_LIBRARY_PATH;
  env.PORT_DADDY_RESOURCE_DIR = repoRoot;

  const proof = parseSemanticRuntimeProof(execFileSync(
    binaryPath,
    ['__semantic-runtime-check'],
    { env, encoding: 'utf8' },
  ));
  const backendNames = proof.backends.map((backend: { name?: string }) => backend.name);

  expect(backendNames).toEqual(expect.arrayContaining(['cpu', 'webgpu', 'coreml']));
});
