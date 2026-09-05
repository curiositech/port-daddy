import { describe, expect, test } from '@jest/globals';
import { MANAGED_CLI_CAPABILITIES, createManagedCliLaunchPolicy, assertManagedCliConfinement, resolveManagedCliExecutionIntent } from '../../lib/spawner/backends/managed-cli-launch-policy.js';
import { buildCliTubeArgs } from '../../lib/spawner/backends/cli-tube-provider-specs.js';

const providers = ['claude-code', 'codex', 'agy'];
const session = '22222222-2222-4222-8222-222222222222';
const bypasses = ['--dangerously-skip-permissions', '--dangerously-bypass-approvals-and-sandbox', 'yolo'];

describe.each(providers)('%s managed policy', (provider) => {
  test.each([false, true])('confinement enabled=%s never grants autonomy by itself', (enabled) => {
    const policy = createManagedCliLaunchPolicy(provider, enabled);
    expect(policy.executionIntent).toBe('manual');
    expect(policy.requiresConfinement).toBe(false);
    const { args } = buildCliTubeArgs(provider, { prompt: 'only selected guidance', launchPolicy: policy });
    for (const bypass of bypasses) expect(args).not.toContain(bypass);
    expect(args).not.toContain('--approve-for-me');
    expect(args).not.toContain(undefined);
    expect(() => assertManagedCliConfinement(policy, { confined: false })).not.toThrow();
  });

  test.each([undefined, session])('autonomous fresh/resume=%s preserves prompt/model and delegates only with proof', (resumeSessionId) => {
    const policy = createManagedCliLaunchPolicy(provider, true, 'autonomous');
    expect(policy.guidanceAttachment).toBe('caller-provided-unattested');
    const { args, stdin } = buildCliTubeArgs(provider, {
      prompt: 'exact selected instruction', model: 'explicit-model', cwd: '/bound/workspace',
      outputPath: '/owned/last-message', codexConfig: ['skills.include_instructions=true'],
      launchPolicy: policy, resumeSessionId,
    });
    expect(stdin).toBeNull();
    expect(args.at(-1)).toBe('exact selected instruction');
    expect(args.filter(arg => arg === 'exact selected instruction')).toHaveLength(1);
    expect(args[args.indexOf('--model') + 1]).toBe('explicit-model');
    expect(args).not.toContain('--bare');
    expect(args).not.toContain('--safe-mode');
    expect(args.includes('--disable-slash-commands')).toBe(provider !== 'codex');
    expect(args).not.toContain('--approve-for-me');
    for (const flag of policy.capabilities.bypassArgs) expect(args).toContain(flag);
    for (const flag of bypasses.filter(flag => !policy.capabilities.bypassArgs.includes(flag))) expect(args).not.toContain(flag);
    if (provider === 'codex') {
      expect(args.filter((_, i) => args[i - 1] === '-c').at(-1)).toBe('skills.include_instructions=false');
      expect(args).toContain('--output-last-message');
      expect(args.includes('-C')).toBe(!resumeSessionId);
    } else {
      expect(args.some(arg => arg.includes('skills.include_instructions'))).toBe(false);
      expect(args).not.toContain('-C');
      expect(args).not.toContain('--output-last-message');
    }
    if (resumeSessionId) expect(args).toContain(session);
    for (const confined of [false, undefined]) expect(() => assertManagedCliConfinement(policy, { confined })).toThrow(/did not establish external confinement/);
    expect(() => assertManagedCliConfinement(policy, { confined: true })).not.toThrow();
  });

  test('explicit autonomous request refuses disabled confinement', () => {
    expect(() => createManagedCliLaunchPolicy(provider, false, 'autonomous')).toThrow(/autonomous launch blocked/);
  });
});

test.each([
  ['claude-code', ['--permission-mode', 'acceptEdits']],
  ['agy', ['--mode', 'accept-edits']],
])('%s edit-only maps exactly without bypass', (provider, expected) => {
  const policy = createManagedCliLaunchPolicy(provider, false, 'edit-only');
  expect(policy.permissionArgs).toEqual(expected);
  const { args } = buildCliTubeArgs(provider, { prompt: 'edit', launchPolicy: policy });
  for (const flag of expected) expect(args).toContain(flag);
  for (const flag of bypasses) expect(args).not.toContain(flag);
});

test('unsupported edit-only and unverified autonomous controls fail honestly', () => {
  expect(() => createManagedCliLaunchPolicy('codex', true, 'edit-only')).toThrow(/no verified edit-only control/);
  expect(MANAGED_CLI_CAPABILITIES.groq.launchContract).toBe('unverified');
  expect(() => createManagedCliLaunchPolicy('groq', true)).toThrow(/native skill suppression/);
  expect(() => createManagedCliLaunchPolicy('groq', true, 'autonomous')).toThrow(/native skill suppression/);
  expect(MANAGED_CLI_CAPABILITIES.grok.launchContract).toBe('unsupported');
  expect(() => buildCliTubeArgs('grok', { prompt: 'must not launch' })).toThrow(/no supported noninteractive prompt contract/);
});

test.each(['claude-code', 'agy'])('%s suppresses native skills on every mode and fresh/resume invocation', provider => {
  for (const intent of ['manual', 'edit-only', 'autonomous']) {
    for (const resumeSessionId of [undefined, session]) {
      const launchPolicy = createManagedCliLaunchPolicy(provider, true, intent);
      const args = buildCliTubeArgs(provider, { prompt: 'explicit Jury-rig guidance', launchPolicy, resumeSessionId }).args;
      expect(args.filter(arg => arg === '--disable-slash-commands')).toHaveLength(1);
      expect(args).not.toContain('--bare');
      expect(args).not.toContain('--safe-mode');
      expect(args.at(-1)).toBe('explicit Jury-rig guidance');
    }
  }
});

test.each(['gemini', 'groq', 'grok'])('%s refuses every managed intent until required native controls are proven', provider => {
  for (const intent of ['manual', 'edit-only', 'autonomous']) {
    for (const enabled of [false, true]) expect(() => createManagedCliLaunchPolicy(provider, enabled, intent)).toThrow(/Managed CLI launch blocked/);
  }
});

test('executionIntent is the sole contract; removed compatibility fields are refused', () => {
  expect(resolveManagedCliExecutionIntent()).toBe('manual');
  expect(resolveManagedCliExecutionIntent('edit-only')).toBe('edit-only');
  expect(resolveManagedCliExecutionIntent('autonomous')).toBe('autonomous');
  expect(() => resolveManagedCliExecutionIntent('acceptEdits')).toThrow(/Unsupported/);
  expect(() => buildCliTubeArgs('claude-code', { prompt: 'x', permissionMode: 'default' })).toThrow(/was removed/);
});
