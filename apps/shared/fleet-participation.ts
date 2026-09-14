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
  | 'privacy'
  | 'storage'
  | 'security-uncertain'
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
  'schema-migration', 'deployment', 'generated-code', 'privacy', 'storage', 'security-uncertain',
  'large-diff',
]);

function enumList<T extends string>(value: unknown, values: ReadonlySet<T>): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is T => typeof item === 'string' && values.has(item as T));
}

/** Parse repository-authored participation policy; malformed rules are dropped closed. */
export function isShipParticipationPolicyValid(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as { default?: unknown; rules?: unknown };
  if (Object.keys(value).some(key => key !== 'default' && key !== 'rules')) return false;
  if (typeof raw.default !== 'string' || !PARTICIPATION_VALUES.has(raw.default as ShipParticipation)) return false;
  if (raw.rules !== undefined && !Array.isArray(raw.rules)) return false;
  return (raw.rules ?? []).every(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const rule = item as Record<string, unknown>;
    if (Object.keys(rule).some(key => !['disposition', 'prClasses', 'riskSignals', 'reason'].includes(key))) return false;
    if (typeof rule.disposition !== 'string' || !PARTICIPATION_VALUES.has(rule.disposition as ShipParticipation)) return false;
    if ('prClasses' in rule && (!Array.isArray(rule.prClasses) || rule.prClasses.length === 0 || enumList(rule.prClasses, PR_CLASS_VALUES).length !== rule.prClasses.length)) return false;
    if ('riskSignals' in rule && (!Array.isArray(rule.riskSignals) || rule.riskSignals.length === 0 || enumList(rule.riskSignals, RISK_VALUES).length !== rule.riskSignals.length)) return false;
    if ('reason' in rule && (typeof rule.reason !== 'string' || rule.reason.trim().length === 0)) return false;
    return true;
  });
}

export function parseShipParticipationPolicy(value: unknown): ShipParticipationPolicy {
  const fallback: ShipParticipationPolicy = {
    default: 'ineligible',
    rules: [],
  };
  if (!isShipParticipationPolicyValid(value)) return fallback;
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
 * Compute quorum over required voters only. Advisory ships publish findings but
 * do not vote. Deliberate abstentions and ineligible ships remain visible but
 * cannot dilute the denominator or masquerade as successful reviews.
 */
export function computeFleetQuorum(votes: ShipVote[]): FleetQuorumResult {
  if (new Set(votes.map(v => v.ship)).size !== votes.length) {
    return { reached: false, eligibleVoters: 0, approvals: 0, rejections: 0, abstentions: 0,
      failures: 0, excludedIneligible: 0, unmetRequiredShips: ['duplicate ship identity'] };
  }
  // Only `required` ships are voters. Advisory ships still run and publish
  // findings, but cannot satisfy or dilute merge quorum.
  const eligible = votes.filter(v => v.participation === 'required');
  const approvals = eligible.filter(v => v.outcome === 'approve').length;
  const rejections = eligible.filter(v => v.outcome === 'reject').length;
  const abstentions = votes.filter(
    v => v.participation === 'abstain' || (v.participation === 'required' && v.outcome === 'abstain'),
  ).length;
  const failures = eligible.filter(v => v.outcome === 'failed').length;
  const unmetRequiredShips = eligible
    .filter(v => v.participation === 'required' && v.outcome !== 'approve').map(v => v.ship);
  const reached = eligible.length > 0 && approvals > 0 && unmetRequiredShips.length === 0 && failures === 0;
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

/** Closed registries: unknown names never become authority by string convention. */
export const SHIP_TOOL_CAPABILITIES = {
  read_file: 'read',
  list_files: 'read',
  search: 'read',
  dynamic_skill_search: 'read',
  write_file: 'write',
  edit_file: 'write',
  run_tests: 'execute',
  shell: 'execute',
} as const;
export type ShipToolCapability = keyof typeof SHIP_TOOL_CAPABILITIES;

export const SHIP_MCP_CAPABILITIES = {
  'github.read': 'read',
  'relay.read': 'read',
  'telemetry.read': 'read',
  'github.write': 'write',
  'relay.write': 'write',
} as const;
export type ShipMcpCapability = keyof typeof SHIP_MCP_CAPABILITIES;

declare const networkEndpointBrand: unique symbol;
/** Exact HTTPS origin admitted by trusted configuration; symbolic providers are refused. */
export type ShipNetworkEndpoint = string & { readonly [networkEndpointBrand]: true };

/** Trusted repository policy. Exact tenant and filesystem bindings are minted later. */
export interface ShipExecutionPolicy {
  mode: ShipExecutionMode;
  repository: 'current_repository';
  worktree: 'isolated';
  /** Relative to the isolated worktree. Empty, absolute, and traversal paths are refused. */
  cwd: string;
  toolAllowlist: ShipToolCapability[];
  mcpAllowlist: ShipMcpCapability[];
  networkAllowlist: ShipNetworkEndpoint[];
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
export type ShipExecutionConfigState = 'absent' | 'valid' | 'invalid';

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim()))];
}

function capabilityList<T extends string>(value: unknown, registry: Readonly<Record<T, string>>): T[] | null {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim().length === 0)) return null;
  const list = stringList(value);
  if (list.length !== value.length) return null;
  return list.every(item => /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(item) && !item.includes('*') && item in registry)
    ? list as T[]
    : null;
}

function exactNetworkEndpoints(value: unknown): ShipNetworkEndpoint[] | null {
  if (!Array.isArray(value)) return null;
  const endpoints: ShipNetworkEndpoint[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() !== item || !item) return null;
    let url: URL;
    try {
      url = new URL(item);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        url.pathname !== '/' || url.hostname.includes('*') || url.origin !== item.replace(/\/$/, '')) return null;
    endpoints.push(url.origin as ShipNetworkEndpoint);
  }
  return new Set(endpoints).size === endpoints.length ? endpoints : null;
}

const READ_ONLY_TOOLS = new Set<ShipToolCapability>(
  (Object.keys(SHIP_TOOL_CAPABILITIES) as ShipToolCapability[])
    .filter(tool => SHIP_TOOL_CAPABILITIES[tool] === 'read'),
);
const READ_ONLY_MCPS = new Set<ShipMcpCapability>(
  (Object.keys(SHIP_MCP_CAPABILITIES) as ShipMcpCapability[])
    .filter(mcp => SHIP_MCP_CAPABILITIES[mcp] === 'read'),
);

/**
 * Parse execution policy. Missing or malformed authority is deny-all. Merely
 * naming tools no longer implies permission to execute them.
 */
export function parseShipExecutionPolicy(value: unknown): ShipExecutionPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DENY_ALL_EXECUTION };
  const raw = value as Record<string, unknown>;
  const allowedKeys = new Set([
    'mode', 'repository', 'worktree', 'cwd', 'toolAllowlist', 'mcpAllowlist',
    'networkAllowlist', 'writePathAllowlist', 'maxWallClockMs', 'maxCostMicrousd',
  ]);
  if (Object.keys(raw).some(key => !allowedKeys.has(key))) return { ...DENY_ALL_EXECUTION };
  const mode = raw.mode;
  if (mode !== 'read_only_sandbox' && mode !== 'write_sandbox') return { ...DENY_ALL_EXECUTION };
  if (raw.repository !== 'current_repository' || raw.worktree !== 'isolated') return { ...DENY_ALL_EXECUTION };
  const cwd = typeof raw.cwd === 'string' ? raw.cwd.trim() : '';
  const maxWallClockMs = raw.maxWallClockMs;
  const maxCostMicrousd = raw.maxCostMicrousd;
  if (!safeRelativePath(cwd)) return { ...DENY_ALL_EXECUTION };
  if (!Number.isSafeInteger(maxWallClockMs) || (maxWallClockMs as number) <= 0 || (maxWallClockMs as number) > MAX_EXECUTION_WALL_CLOCK_MS) return { ...DENY_ALL_EXECUTION };
  if (!Number.isSafeInteger(maxCostMicrousd) || (maxCostMicrousd as number) <= 0 || (maxCostMicrousd as number) > MAX_EXECUTION_COST_MICROUSD) return { ...DENY_ALL_EXECUTION };
  if (!Array.isArray(raw.writePathAllowlist) || raw.writePathAllowlist.some(path => typeof path !== 'string' || !safeRelativePath(path.trim()))) {
    return { ...DENY_ALL_EXECUTION };
  }
  const writePathAllowlist = stringList(raw.writePathAllowlist);
  if (mode === 'read_only_sandbox' && writePathAllowlist.length > 0) return { ...DENY_ALL_EXECUTION };
  const toolAllowlist = capabilityList(raw.toolAllowlist, SHIP_TOOL_CAPABILITIES);
  const mcpAllowlist = capabilityList(raw.mcpAllowlist, SHIP_MCP_CAPABILITIES);
  const networkAllowlist = exactNetworkEndpoints(raw.networkAllowlist);
  if (!toolAllowlist || !mcpAllowlist || !networkAllowlist) return { ...DENY_ALL_EXECUTION };
  if (mode === 'read_only_sandbox' && (
    toolAllowlist.some(tool => !READ_ONLY_TOOLS.has(tool)) ||
    mcpAllowlist.some(mcp => !READ_ONLY_MCPS.has(mcp)) ||
    networkAllowlist.length > 0
  )) return { ...DENY_ALL_EXECUTION };
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

/** Preserve whether deny-all was intentional, absent, or caused by malformed authority. */
export function parseShipExecutionConfiguration(value: unknown): {
  state: ShipExecutionConfigState;
  policy: ShipExecutionPolicy;
} {
  if (value === undefined) return { state: 'absent', policy: { ...DENY_ALL_EXECUTION } };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const raw = value as Record<string, unknown>;
    if (Object.keys(raw).length === 1 && raw.mode === 'none') {
      return { state: 'valid', policy: { ...DENY_ALL_EXECUTION } };
    }
  }
  const policy = parseShipExecutionPolicy(value);
  return policy.mode === 'none'
    ? { state: 'invalid', policy }
    : { state: 'valid', policy };
}

export interface ShipExecutionGrant extends ShipExecutionPolicy {
  grantId: string;
  nonce: string;
  tenantId: string;
  tenantBindingReceiptId: string;
  repositoryId: string;
  repositoryFullName: string;
  worktreePath: string;
  cwdPath: string;
  /** Canonical roots only. A consumer must realpath every target again before opening it. */
  canonicalWritePathRoots: string[];
  requiresTargetRealpathRecheck: true;
  headSha: string;
  runId: string;
  attempt: number;
  issuedAtEpochMs: number;
  expiresAtEpochMs: number;
  singleUse: true;
  digestSha256: string;
}

function sameExecutionPolicy(left: ShipExecutionPolicy, right: ShipExecutionPolicy): boolean {
  return left.mode === right.mode && left.repository === right.repository && left.worktree === right.worktree &&
    left.cwd === right.cwd && left.maxWallClockMs === right.maxWallClockMs &&
    left.maxCostMicrousd === right.maxCostMicrousd &&
    JSON.stringify(left.toolAllowlist) === JSON.stringify(right.toolAllowlist) &&
    JSON.stringify(left.mcpAllowlist) === JSON.stringify(right.mcpAllowlist) &&
    JSON.stringify(left.networkAllowlist) === JSON.stringify(right.networkAllowlist) &&
    JSON.stringify(left.writePathAllowlist) === JSON.stringify(right.writePathAllowlist);
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
export async function mintShipExecutionGrant(params: {
  policy: ShipExecutionPolicy;
  tenantId: string;
  admittedTenantId: string;
  repositoryId: string;
  admittedRepositoryId: string;
  repositoryFullName: string;
  admittedRepositoryFullName: string;
  worktreePath: string;
  isolatedWorktreeRoot: string;
  /** Trusted runner primitive (realpath or equivalent) used to collapse symlinks. */
  canonicalizePath: (path: string) => Promise<string>;
  tenantBindingReceiptId: string;
  headSha: string;
  runId: string;
  attempt: number;
  nonce: string;
  /** Trusted current time supplied by the minting control plane. */
  nowEpochMs: number;
  issuedAtEpochMs: number;
  expiresAtEpochMs: number;
}): Promise<ShipExecutionGrant | null> {
  // Reparse a structural clone so typed callers cannot smuggle post-parse
  // unknown capabilities or expanded caps into a grant.
  const policy = parseShipExecutionPolicy({ ...params.policy });
  if (policy.mode === 'none') return null;
  if (!sameExecutionPolicy(policy, params.policy)) return null;
  if (!params.tenantId || !params.repositoryId) return null;
  if (params.tenantId !== params.admittedTenantId || params.repositoryId !== params.admittedRepositoryId) return null;
  if (params.repositoryFullName.toLowerCase() !== params.admittedRepositoryFullName.toLowerCase()) return null;
  if (!safeAbsolutePath(params.worktreePath) || !safeAbsolutePath(params.isolatedWorktreeRoot) || !isStrictChild(params.isolatedWorktreeRoot, params.worktreePath)) return null;
  if (!safeRelativePath(policy.cwd)) return null;
  if (!Number.isSafeInteger(policy.maxWallClockMs) || policy.maxWallClockMs <= 0) return null;
  if (!Number.isSafeInteger(policy.maxCostMicrousd) || policy.maxCostMicrousd <= 0) return null;
  if (policy.mode === 'read_only_sandbox' && policy.writePathAllowlist.length > 0) return null;
  const lexicalCwdPath = policy.cwd === '.' ? params.worktreePath : `${params.worktreePath}/${policy.cwd}`;
  if (!isStrictChild(params.worktreePath, lexicalCwdPath)) return null;
  let canonicalRoot: string;
  let canonicalWorktree: string;
  let cwdPath: string;
  let canonicalWritePathRoots: string[];
  try {
    [canonicalRoot, canonicalWorktree, cwdPath, ...canonicalWritePathRoots] = await Promise.all([
      params.canonicalizePath(params.isolatedWorktreeRoot),
      params.canonicalizePath(params.worktreePath),
      params.canonicalizePath(lexicalCwdPath),
      ...policy.writePathAllowlist.map(path => params.canonicalizePath(`${params.worktreePath}/${path}`)),
    ]);
  } catch {
    return null;
  }
  if (!safeAbsolutePath(canonicalRoot) || !safeAbsolutePath(canonicalWorktree) || !safeAbsolutePath(cwdPath)) return null;
  if (!isStrictChild(canonicalRoot, canonicalWorktree) || !isStrictChild(canonicalWorktree, cwdPath)) return null;
  if (canonicalWritePathRoots.some(path => !safeAbsolutePath(path) || !isStrictChild(canonicalWorktree, path))) return null;
  if (new Set(canonicalWritePathRoots).size !== canonicalWritePathRoots.length) return null;
  if (!params.tenantBindingReceiptId || !/^[a-f0-9]{40,128}$/i.test(params.headSha) || !params.runId) return null;
  if (!Number.isSafeInteger(params.attempt) || params.attempt < 1) return null;
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(params.nonce)) return null;
  if (!Number.isSafeInteger(params.nowEpochMs) || !Number.isSafeInteger(params.issuedAtEpochMs) || !Number.isSafeInteger(params.expiresAtEpochMs) ||
      params.issuedAtEpochMs > params.nowEpochMs || params.expiresAtEpochMs <= params.nowEpochMs ||
      params.expiresAtEpochMs <= params.issuedAtEpochMs ||
      params.expiresAtEpochMs - params.issuedAtEpochMs > policy.maxWallClockMs) return null;
  const digestInput = JSON.stringify([
    'fleet-execution-grant-v1', params.nonce, params.tenantId, params.tenantBindingReceiptId,
    params.repositoryId, params.repositoryFullName.toLowerCase(), canonicalWorktree, cwdPath,
    params.headSha, params.runId, params.attempt, params.issuedAtEpochMs, params.expiresAtEpochMs,
    canonicalWritePathRoots, policy,
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(digestInput));
  const digestSha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  // No production runner atomically consumes this envelope yet. Refuse write
  // grants rather than returning an object that could be mistaken for usable
  // mutation authority. The canonical-root contract above remains the required
  // shape for that future consumer.
  if (policy.mode === 'write_sandbox') return null;
  return {
    ...policy,
    grantId: `seg_${digestSha256.slice(0, 32)}`,
    nonce: params.nonce,
    tenantId: params.tenantId,
    tenantBindingReceiptId: params.tenantBindingReceiptId,
    repositoryId: params.repositoryId,
    repositoryFullName: params.repositoryFullName,
    worktreePath: canonicalWorktree,
    cwdPath,
    canonicalWritePathRoots,
    requiresTargetRealpathRecheck: true,
    headSha: params.headSha,
    runId: params.runId,
    attempt: params.attempt,
    issuedAtEpochMs: params.issuedAtEpochMs,
    expiresAtEpochMs: params.expiresAtEpochMs,
    singleUse: true,
    digestSha256,
  };
}

/**
 * Mandatory final write-target check for a future grant consumer. This helper
 * does not consume a nonce and is therefore necessary but not sufficient to
 * authorize execution; the production executor still refuses write grants.
 */
export async function recheckShipWriteTarget(
  grant: ShipExecutionGrant,
  targetPath: string,
  nowEpochMs: number,
  canonicalizePath: (path: string) => Promise<string>,
): Promise<string | null> {
  if (grant.mode !== 'write_sandbox' || grant.requiresTargetRealpathRecheck !== true ||
      !Number.isSafeInteger(nowEpochMs) || nowEpochMs < grant.issuedAtEpochMs ||
      nowEpochMs >= grant.expiresAtEpochMs || !safeAbsolutePath(targetPath)) return null;
  let canonicalTarget: string;
  try {
    canonicalTarget = await canonicalizePath(targetPath);
  } catch {
    return null;
  }
  if (!safeAbsolutePath(canonicalTarget) || !isStrictChild(grant.worktreePath, canonicalTarget)) return null;
  return grant.canonicalWritePathRoots.some(root => isStrictChild(root, canonicalTarget))
    ? canonicalTarget
    : null;
}
