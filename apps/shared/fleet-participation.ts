/**
 * Provider-neutral Fleet participation and execution authority contracts.
 *
 * These types deliberately separate three questions that the historical
 * `blocking` and `needsExecution` booleans collapsed:
 *
 *  1. Is this ship relevant to this PR?
 *  2. If relevant, is its judgement required or advisory?
 *  3. May it execute code, and inside exactly which sandbox?
 *
 * A model may suggest a policy. Only trusted repository configuration and the
 * tenant control plane may mint the resulting execution grant.
 */

export type PullRequestClass =
  | 'code'
  | 'documentation'
  | 'dependencies'
  | 'security'
  | 'ci'
  | 'infrastructure'
  | 'data'
  | 'ui'
  | 'unknown';

export type PullRequestRiskSignal =
  | 'authentication'
  | 'authorization'
  | 'secrets'
  | 'cryptography'
  | 'billing'
  | 'tenant-boundary'
  | 'schema-migration'
  | 'deployment'
  | 'generated-code'
  | 'large-diff';

/**
 * `abstain` means the ship is eligible but deliberately declines this vote.
 * `ineligible` means the ship is outside the review population for this PR.
 * Neither is a failure and neither contributes to quorum.
 */
export type ShipParticipation = 'required' | 'advisory' | 'abstain' | 'ineligible';

export interface ShipParticipationRule {
  disposition: ShipParticipation;
  prClasses?: PullRequestClass[];
  riskSignals?: PullRequestRiskSignal[];
  reason?: string;
}

export interface ShipParticipationPolicy {
  default: ShipParticipation;
  /** First matching rule wins. Rules therefore remain reviewable and deterministic. */
  rules: ShipParticipationRule[];
}

export interface PullRequestProfile {
  prClass: PullRequestClass;
  riskSignals: PullRequestRiskSignal[];
}

export interface ShipParticipationDecision {
  disposition: ShipParticipation;
  reason: string;
  matchedRule: number | null;
}

const PARTICIPATION_VALUES = new Set<ShipParticipation>([
  'required', 'advisory', 'abstain', 'ineligible',
]);
const PR_CLASS_VALUES = new Set<PullRequestClass>([
  'code', 'documentation', 'dependencies', 'security', 'ci', 'infrastructure', 'data', 'ui', 'unknown',
]);
const RISK_VALUES = new Set<PullRequestRiskSignal>([
  'authentication', 'authorization', 'secrets', 'cryptography', 'billing', 'tenant-boundary',
  'schema-migration', 'deployment', 'generated-code', 'large-diff',
]);

function enumList<T extends string>(value: unknown, values: ReadonlySet<T>): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is T => typeof item === 'string' && values.has(item as T));
}

/** Parse repository-authored participation policy; malformed rules are dropped closed. */
export function parseShipParticipationPolicy(
  value: unknown,
  legacyBlocking: boolean,
): ShipParticipationPolicy {
  const fallback: ShipParticipationPolicy = {
    default: legacyBlocking ? 'required' : 'advisory',
    rules: [],
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const raw = value as { default?: unknown; rules?: unknown };
  const defaultValue = typeof raw.default === 'string' && PARTICIPATION_VALUES.has(raw.default as ShipParticipation)
    ? raw.default as ShipParticipation
    : fallback.default;
  const rules: ShipParticipationRule[] = [];
  if (Array.isArray(raw.rules)) {
    for (const item of raw.rules) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const rule = item as Record<string, unknown>;
      if (typeof rule.disposition !== 'string' || !PARTICIPATION_VALUES.has(rule.disposition as ShipParticipation)) continue;
      const prClasses = enumList(rule.prClasses, PR_CLASS_VALUES);
      const riskSignals = enumList(rule.riskSignals, RISK_VALUES);
      // A misspelled selector must not collapse into a match-all rule.
      if ('prClasses' in rule && prClasses.length === 0) continue;
      if ('riskSignals' in rule && riskSignals.length === 0) continue;
      rules.push({
        disposition: rule.disposition as ShipParticipation,
        ...(prClasses.length ? { prClasses } : {}),
        ...(riskSignals.length ? { riskSignals } : {}),
        ...(typeof rule.reason === 'string' && rule.reason.trim() ? { reason: rule.reason.trim() } : {}),
      });
    }
  }
  return { default: defaultValue, rules };
}

/** Select one ship's participation without invoking a model. */
export function decideShipParticipation(
  policy: ShipParticipationPolicy,
  profile: PullRequestProfile,
): ShipParticipationDecision {
  const risks = new Set(profile.riskSignals);
  for (let i = 0; i < policy.rules.length; i += 1) {
    const rule = policy.rules[i];
    const classMatches = !rule.prClasses?.length || rule.prClasses.includes(profile.prClass);
    const riskMatches = !rule.riskSignals?.length || rule.riskSignals.some(risk => risks.has(risk));
    if (classMatches && riskMatches) {
      return {
        disposition: rule.disposition,
        reason: rule.reason?.trim() || `matched participation rule ${i + 1}`,
        matchedRule: i,
      };
    }
  }
  return { disposition: policy.default, reason: 'fleet participation default', matchedRule: null };
}

export type ShipVoteOutcome = 'approve' | 'reject' | 'abstain' | 'failed';

export interface ShipVote {
  ship: string;
  participation: ShipParticipation;
  outcome: ShipVoteOutcome;
}

export interface FleetQuorumPolicy {
  minimumEligibleVoters: number;
  minimumApprovals: number;
  /** Required voters must return approve; failure, rejection, or abstention is not approval. */
  requireEveryRequiredApproval: boolean;
}

export interface FleetQuorumResult {
  reached: boolean;
  eligibleVoters: number;
  approvals: number;
  rejections: number;
  abstentions: number;
  failures: number;
  excludedIneligible: number;
  unmetRequiredShips: string[];
}

/**
 * Compute quorum over required/advisory voters only. Deliberate abstentions and
 * ineligible ships remain visible but cannot dilute the denominator or masquerade
 * as successful reviews.
 */
export function computeFleetQuorum(votes: ShipVote[], policy: FleetQuorumPolicy): FleetQuorumResult {
  const eligible = votes.filter(v => v.participation === 'required' || v.participation === 'advisory');
  const approvals = eligible.filter(v => v.outcome === 'approve').length;
  const rejections = eligible.filter(v => v.outcome === 'reject').length;
  const abstentions = votes.filter(
    v => v.participation === 'abstain' || (v.participation !== 'ineligible' && v.outcome === 'abstain'),
  ).length;
  const failures = eligible.filter(v => v.outcome === 'failed').length;
  const unmetRequiredShips = policy.requireEveryRequiredApproval
    ? eligible.filter(v => v.participation === 'required' && v.outcome !== 'approve').map(v => v.ship)
    : [];
  const policyValid =
    Number.isSafeInteger(policy.minimumEligibleVoters) && policy.minimumEligibleVoters >= 0 &&
    Number.isSafeInteger(policy.minimumApprovals) && policy.minimumApprovals >= 0;
  const reached = policyValid &&
    eligible.length >= policy.minimumEligibleVoters &&
    approvals >= policy.minimumApprovals &&
    unmetRequiredShips.length === 0;
  return {
    reached,
    eligibleVoters: eligible.length,
    approvals,
    rejections,
    abstentions,
    failures,
    excludedIneligible: votes.filter(v => v.participation === 'ineligible').length,
    unmetRequiredShips,
  };
}

export type ShipExecutionMode = 'none' | 'read_only_sandbox' | 'write_sandbox';

/** Trusted repository policy. Exact tenant and filesystem bindings are minted later. */
export interface ShipExecutionPolicy {
  mode: ShipExecutionMode;
  repository: 'current_repository';
  worktree: 'isolated';
  /** Relative to the isolated worktree. Empty, absolute, and traversal paths are refused. */
  cwd: string;
  toolAllowlist: string[];
  mcpAllowlist: string[];
  networkAllowlist: string[];
  writePathAllowlist: string[];
  maxWallClockMs: number;
  maxCostMicrousd: number;
}

export const DENY_ALL_EXECUTION: Readonly<ShipExecutionPolicy> = Object.freeze({
  mode: 'none',
  repository: 'current_repository',
  worktree: 'isolated',
  cwd: '.',
  toolAllowlist: [],
  mcpAllowlist: [],
  networkAllowlist: [],
  writePathAllowlist: [],
  maxWallClockMs: 0,
  maxCostMicrousd: 0,
});

export const MAX_EXECUTION_WALL_CLOCK_MS = 30 * 60 * 1000;
export const MAX_EXECUTION_COST_MICROUSD = 25_000_000;

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim()))];
}

function capabilityList(value: unknown): string[] | null {
  const list = stringList(value);
  return list.every(item => /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(item) && !item.includes('*'))
    ? list
    : null;
}

/**
 * Parse execution policy. Missing or malformed authority is deny-all. Merely
 * naming tools no longer implies permission to execute them.
 */
export function parseShipExecutionPolicy(value: unknown): ShipExecutionPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DENY_ALL_EXECUTION };
  const raw = value as Record<string, unknown>;
  const mode = raw.mode;
  if (mode !== 'read_only_sandbox' && mode !== 'write_sandbox') return { ...DENY_ALL_EXECUTION };
  if (raw.repository !== 'current_repository' || raw.worktree !== 'isolated') return { ...DENY_ALL_EXECUTION };
  const cwd = typeof raw.cwd === 'string' ? raw.cwd.trim() : '';
  const maxWallClockMs = raw.maxWallClockMs;
  const maxCostMicrousd = raw.maxCostMicrousd;
  if (!safeRelativePath(cwd)) return { ...DENY_ALL_EXECUTION };
  if (!Number.isSafeInteger(maxWallClockMs) || (maxWallClockMs as number) <= 0 || (maxWallClockMs as number) > MAX_EXECUTION_WALL_CLOCK_MS) return { ...DENY_ALL_EXECUTION };
  if (!Number.isSafeInteger(maxCostMicrousd) || (maxCostMicrousd as number) <= 0 || (maxCostMicrousd as number) > MAX_EXECUTION_COST_MICROUSD) return { ...DENY_ALL_EXECUTION };
  const writePathAllowlist = stringList(raw.writePathAllowlist).filter(safeRelativePath);
  if (mode === 'read_only_sandbox' && writePathAllowlist.length > 0) return { ...DENY_ALL_EXECUTION };
  const toolAllowlist = capabilityList(raw.toolAllowlist);
  const mcpAllowlist = capabilityList(raw.mcpAllowlist);
  const networkAllowlist = capabilityList(raw.networkAllowlist);
  if (!toolAllowlist || !mcpAllowlist || !networkAllowlist) return { ...DENY_ALL_EXECUTION };
  return {
    mode,
    repository: 'current_repository',
    worktree: 'isolated',
    cwd,
    toolAllowlist,
    // Dynamic skill discovery may be named here as one bounded capability;
    // individual skill manuals are never embedded in fleet configuration.
    mcpAllowlist,
    networkAllowlist,
    writePathAllowlist,
    maxWallClockMs: maxWallClockMs as number,
    maxCostMicrousd: maxCostMicrousd as number,
  };
}

export interface ShipExecutionGrant extends ShipExecutionPolicy {
  tenantId: string;
  repositoryId: string;
  repositoryFullName: string;
  worktreePath: string;
  cwdPath: string;
}

function safeRelativePath(value: string): boolean {
  return value === '.' || (
    value.length > 0 &&
    !value.startsWith('/') &&
    !value.split('/').some(segment => segment === '..' || segment === '')
  );
}

function safeAbsolutePath(value: string): boolean {
  return value.startsWith('/') && !value.split('/').some(segment => segment === '..' || segment === '.');
}

function isStrictChild(root: string, child: string): boolean {
  const cleanRoot = root.replace(/\/+$/, '');
  return child === cleanRoot || child.startsWith(`${cleanRoot}/`);
}

/**
 * Bind a trusted policy to one tenant/repository/worktree. Any ambiguity denies
 * execution rather than broadening authority.
 */
export function mintShipExecutionGrant(params: {
  policy: ShipExecutionPolicy;
  tenantId: string;
  admittedTenantId: string;
  repositoryId: string;
  admittedRepositoryId: string;
  repositoryFullName: string;
  admittedRepositoryFullName: string;
  worktreePath: string;
  isolatedWorktreeRoot: string;
}): ShipExecutionGrant | null {
  const { policy } = params;
  if (policy.mode === 'none') return null;
  if (!params.tenantId || !params.repositoryId) return null;
  if (params.tenantId !== params.admittedTenantId || params.repositoryId !== params.admittedRepositoryId) return null;
  if (params.repositoryFullName.toLowerCase() !== params.admittedRepositoryFullName.toLowerCase()) return null;
  if (!safeAbsolutePath(params.worktreePath) || !safeAbsolutePath(params.isolatedWorktreeRoot) || !isStrictChild(params.isolatedWorktreeRoot, params.worktreePath)) return null;
  if (!safeRelativePath(policy.cwd)) return null;
  if (!Number.isSafeInteger(policy.maxWallClockMs) || policy.maxWallClockMs <= 0) return null;
  if (!Number.isSafeInteger(policy.maxCostMicrousd) || policy.maxCostMicrousd <= 0) return null;
  if (policy.mode === 'read_only_sandbox' && policy.writePathAllowlist.length > 0) return null;
  const cwdPath = policy.cwd === '.' ? params.worktreePath : `${params.worktreePath}/${policy.cwd}`;
  if (!isStrictChild(params.worktreePath, cwdPath)) return null;
  return {
    ...policy,
    tenantId: params.tenantId,
    repositoryId: params.repositoryId,
    repositoryFullName: params.repositoryFullName,
    worktreePath: params.worktreePath,
    cwdPath,
  };
}
