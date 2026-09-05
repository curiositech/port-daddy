/** Provider-native controls are capabilities, not interchangeable CLI flags. */
export type ManagedCliProvider = 'claude-code' | 'codex' | 'gemini' | 'agy' | 'groq' | 'grok';
export type ManagedCliExecutionIntent = 'manual' | 'edit-only' | 'autonomous';

export interface ManagedCliCapabilities {
  launchContract: 'verified' | 'unverified' | 'unsupported';
  bypassArgs: readonly string[];
  safeArgs: readonly string[];
  nativeSkillDisclosure: 'config-override' | 'disable-native-skills' | 'unavailable' | 'unverified';
  nativeResume: boolean;
  nativeStreaming: 'mapped' | 'documented-parser-pending' | 'unverified';
  cwd: 'child-process' | 'fresh-flag-and-child-process';
  capture: 'stream-json' | 'last-message-file' | 'whole-output';
}

export const MANAGED_CLI_CAPABILITIES = {
  'claude-code': { launchContract: 'verified', bypassArgs: ['--dangerously-skip-permissions'], safeArgs: [], nativeSkillDisclosure: 'disable-native-skills', nativeResume: true, nativeStreaming: 'mapped', cwd: 'child-process', capture: 'stream-json' },
  codex: { launchContract: 'verified', bypassArgs: ['--dangerously-bypass-approvals-and-sandbox'], safeArgs: [], nativeSkillDisclosure: 'config-override', nativeResume: true, nativeStreaming: 'mapped', cwd: 'fresh-flag-and-child-process', capture: 'last-message-file' },
  gemini: { launchContract: 'verified', bypassArgs: ['--approval-mode', 'yolo'], safeArgs: [], nativeSkillDisclosure: 'unavailable', nativeResume: true, nativeStreaming: 'documented-parser-pending', cwd: 'child-process', capture: 'whole-output' },
  agy: { launchContract: 'verified', bypassArgs: ['--dangerously-skip-permissions'], safeArgs: [], nativeSkillDisclosure: 'disable-native-skills', nativeResume: true, nativeStreaming: 'documented-parser-pending', cwd: 'child-process', capture: 'whole-output' },
  // No verified controls: Groq remains unverified; the installed Grok proxy is unsupported.
  groq: { launchContract: 'unverified', bypassArgs: [], safeArgs: [], nativeSkillDisclosure: 'unverified', nativeResume: false, nativeStreaming: 'unverified', cwd: 'child-process', capture: 'whole-output' },
  grok: { launchContract: 'unsupported', bypassArgs: [], safeArgs: [], nativeSkillDisclosure: 'unverified', nativeResume: false, nativeStreaming: 'unverified', cwd: 'child-process', capture: 'whole-output' },
} as const satisfies Record<ManagedCliProvider, ManagedCliCapabilities>;

export interface ManagedCliLaunchPolicy {
  provider: ManagedCliProvider;
  executionIntent: ManagedCliExecutionIntent;
  /** No selection receipt is inferred from arbitrary caller prompt text. */
  guidanceAttachment: 'caller-provided-unattested';
  capabilities: ManagedCliCapabilities;
  permissionArgs: readonly string[];
  requiresConfinement: boolean;
}

/**
 * Resolve semantic launch policy without claiming an OS wrapper exists yet.
 * Design: only providers delegating a native permission boundary require proof;
 * native catalog suppression is mandatory independently of permission mode.
 * @param provider Canonical CLI provider identity.
 * @param coastGuardEnabled Effective Coast Guard policy from the wrapper's environment.
 * @param executionIntent Explicit user/workflow intent; confinement never grants autonomy.
 * @returns Provider-native controls and the pre-spawn proof obligation.
 */
export function createManagedCliLaunchPolicy(provider: ManagedCliProvider, coastGuardEnabled: boolean, executionIntent: ManagedCliExecutionIntent = 'manual'): ManagedCliLaunchPolicy {
  resolveManagedCliExecutionIntent(executionIntent);
  const capabilities: ManagedCliCapabilities = MANAGED_CLI_CAPABILITIES[provider];
  if (capabilities.launchContract === 'unsupported') {
    throw new Error(`Managed CLI launch blocked for ${provider}: no supported noninteractive prompt contract is verified. Select a supported provider.`);
  }
  if (capabilities.launchContract === 'unverified' || ['unavailable', 'unverified'].includes(capabilities.nativeSkillDisclosure)) {
    throw new Error(`Managed CLI launch blocked for ${provider}: no verified policy-preserving native skill suppression. Select Claude Code, Codex, or agy; Gemini API is unaffected. Dynamic guidance must come from Port Daddy Jury-rig or explicit caller selection.`);
  }
  const requiresConfinement = executionIntent === 'autonomous';
  if (requiresConfinement && (!coastGuardEnabled || capabilities.launchContract !== 'verified' || capabilities.bypassArgs.length === 0)) {
    throw new Error(`Managed CLI autonomous launch blocked for ${provider}: a supported provider and active Coast Guard confinement are required. Use a supported managed worker route or request manual execution.`);
  }
  const editArgs: Partial<Record<ManagedCliProvider, readonly string[]>> = {
    'claude-code': ['--permission-mode', 'acceptEdits'], gemini: ['--approval-mode', 'auto_edit'], agy: ['--mode', 'accept-edits'],
  };
  if (executionIntent === 'edit-only' && !editArgs[provider]) {
    throw new Error(`Managed CLI edit-only launch blocked for ${provider}: no verified edit-only control. Choose a provider supporting edit-only execution.`);
  }
  return {
    provider, executionIntent, capabilities, guidanceAttachment: 'caller-provided-unattested', requiresConfinement,
    permissionArgs: requiresConfinement ? capabilities.bypassArgs : executionIntent === 'edit-only' ? editArgs[provider]! : capabilities.safeArgs,
  };
}

/**
 * Validate the sole provider-neutral execution intent.
 * Design: no compatibility field may silently override or escalate authority.
 * @param intent New semantic intent, if supplied.
 * @returns One unambiguous execution intent.
 */
export function resolveManagedCliExecutionIntent(intent?: ManagedCliExecutionIntent): ManagedCliExecutionIntent {
  if (intent !== undefined && !['manual', 'edit-only', 'autonomous'].includes(intent)) throw new Error('Unsupported managed CLI execution mode');
  return intent ?? 'manual';
}

/**
 * Admit permission delegation only after the actual wrapper proves confinement.
 * Design: configuration intent and a receipt-shaped caller object are not proof.
 * @param policy Resolved provider policy.
 * @param wrapper Actual result returned by withCoastGuard.
 * @returns Nothing when admission is safe; throws before raw CLI spawn otherwise.
 */
export function assertManagedCliConfinement(policy: ManagedCliLaunchPolicy, wrapper: { confined?: boolean }): void {
  if (policy.requiresConfinement && wrapper.confined !== true) {
    throw new Error(`Managed CLI launch blocked for ${policy.provider}: Coast Guard did not establish external confinement. Restore the confinement service before retrying.`);
  }
}
