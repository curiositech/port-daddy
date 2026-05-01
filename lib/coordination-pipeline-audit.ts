/**
 * Coxswain's coordination-pipeline audit.
 *
 * Periodically scans the live communications fabric — declared + observed
 * channels, agent activity, tuple keys — and emits structured "complaints"
 * about pathologies that suggest the swarm is mis-coordinating:
 *
 *   - subscription_coverage:     channel has publishers but zero subscribers
 *   - channel_near_duplicate:    two channels have semantically identical names
 *   - channel_naming:            channel doesn't match `<scope>:<purpose>` shape
 *   - tuple_naming:              tuple key shape is inconsistent with siblings
 *   - silent_agent:              agent registered > N min ago, zero outbound traffic
 *
 * Every check is **deterministic** here. Triggers are SQL counts and regex.
 * Borderline cases (similarity in the ambiguous middle, silence in the
 * "could be deep work" window) are flagged with `needsJudge: true` for the
 * coordination-judge layer to evaluate (see lib/coordination-judge.ts in
 * a follow-up commit). This module never DMs anyone — it only emits issues.
 *
 * Cooldown: every issue carries a `cooldownKey`. The audit's caller
 * (server.ts) maintains a per-key TTL cache so we don't spam the same
 * agent about the same channel-naming-drift every 5 minutes forever.
 *
 * Owned by actor:coxswain (lib/maritime-actors.ts coxswain.owns includes
 * channels, tuples, channel-naming-hygiene, tuple-nomenclature,
 * subscription-coverage, silent-agents, comm-pipeline-debug as of the
 * commit-prior comms-officer scope expansion).
 */

import { createHash } from 'node:crypto';

// Channel name shape: <scope>:<topic>[:<sub-topic>...] using lowercase letters,
// digits, hyphens, periods. Stars allowed for wildcard subscriptions, but a
// declared channel should NOT contain a star. Underscores accepted but
// discouraged via warning, not error.
export const DEFAULT_CHANNEL_NAMING_PATTERN = /^[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)+$/;
// Tuple keys are `<noun>/<noun>` style: `claim/files`, `lock/holders`, etc.
export const DEFAULT_TUPLE_KEY_PATTERN = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;

export type IssueKind =
  | 'subscription_coverage'
  | 'channel_near_duplicate'
  | 'channel_naming'
  | 'tuple_naming'
  | 'silent_agent';

export type IssueSeverity = 'info' | 'warn' | 'critical';

export interface ComplaintIssue {
  /** Discriminator — also picks the DM template in C3. */
  kind: IssueKind;
  severity: IssueSeverity;
  /** Where to send the resulting nudge. `agentId` is set when a specific
   *  agent is at fault; `actor` is the coxswain mailbox + (optionally) the
   *  affected agent's actor classification. */
  target: { actor: string; agentId?: string | null };
  /** Concrete evidence — included verbatim in the DM template AND passed to
   *  the judge if needsJudge is true. */
  evidence: Record<string, unknown>;
  /** Template id consumed by the DM layer in C3. */
  templateName: string;
  /** When true, the issue is in the ambiguous middle — clear-signal cases
   *  go straight to DM, borderline cases ask the judge for a yes/no. */
  needsJudge: boolean;
  /** Stable hash of (kind, target, primary-evidence-key). The audit caller
   *  uses this to suppress duplicate complaints inside the cooldown window. */
  cooldownKey: string;
}

export interface AuditChannel {
  channel: string;
  count: number;
  lastMessage: number | null;
}

export interface AuditAgent {
  id: string;
  registeredAt: number;
  lastHeartbeat: number;
  /** Optional outbound activity counter (publishes + inbox sends + notes).
   *  When omitted, silent-agent detection falls back to "no heartbeat
   *  delta beyond a single tick" — coarser, but never false-positives on
   *  agents that are heartbeating normally. */
  outboundActivityCount?: number;
}

export interface AuditTupleKey {
  /** Full key, e.g. "claim/files". */
  key: string;
  /** Number of distinct values stored under this key. */
  cardinality: number;
}

export interface AuditDeps {
  listChannels: () => AuditChannel[];
  subscriberCount: (channel: string) => number;
  listAgents: () => AuditAgent[];
  /** Returns a sample of declared tuple keys. Optional — omitting it just
   *  skips the tuple_naming check, never errors. */
  listTupleKeys?: () => AuditTupleKey[];
  /** Embedding function for fuzzy duplicate detection. Optional —
   *  omitting it skips channel_near_duplicate AND treats the high
   *  threshold of `channel_naming` as the only dedupe signal. The repo's
   *  lib/semantic-resolver.ts already exposes this. */
  embed?: (texts: string[]) => Promise<number[][]>;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
  /** `Date.now` injection point for tests. */
  now?: () => number;
}

export interface AuditOptions {
  // Subscription coverage
  /** Minimum publish count in the window before "no subscribers" becomes a
   *  complaint. Defaults to 5 — anything less is below the noise floor. */
  subscriptionCoverageMinPublishes?: number;
  /** Time window (ms) the publish count is measured against; channels
   *  whose `lastMessage` is older than `now - window` are exempt. Default 1h. */
  subscriptionCoverageWindowMs?: number;

  // Silent agent
  /** Agent must be older than this before silence becomes suspicious. */
  silentAgentMinAgeMs?: number;
  /** Borderline window — silence between min and max gets needsJudge=true.
   *  Beyond max, it's fired deterministically. */
  silentAgentBorderlineMaxMs?: number;

  // Near-duplicate channels
  duplicateChannelSimThreshold?: number;
  duplicateChannelBorderlineLow?: number;

  // Naming hygiene
  channelNamingPattern?: RegExp;
  tupleKeyPattern?: RegExp;
}

const DEFAULTS: Required<Omit<AuditOptions, 'channelNamingPattern' | 'tupleKeyPattern'>> & {
  channelNamingPattern: RegExp;
  tupleKeyPattern: RegExp;
} = {
  subscriptionCoverageMinPublishes: 5,
  subscriptionCoverageWindowMs: 60 * 60 * 1000,
  silentAgentMinAgeMs: 30 * 60 * 1000,
  silentAgentBorderlineMaxMs: 60 * 60 * 1000,
  duplicateChannelSimThreshold: 0.92,
  duplicateChannelBorderlineLow: 0.78,
  channelNamingPattern: DEFAULT_CHANNEL_NAMING_PATTERN,
  tupleKeyPattern: DEFAULT_TUPLE_KEY_PATTERN,
};

function hashKey(parts: Array<string | number>): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 16);
}

/**
 * Cosine similarity between two pre-normalized vectors. (The repo's existing
 * embedder returns unit-norm vectors, so this reduces to a dot product.)
 * If a pair of vectors aren't normalized, the similarity is still meaningful
 * but absolute thresholds shift — re-tune accordingly.
 */
function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

/**
 * Subscription coverage check. A channel that has published `>= min`
 * messages in the recent window but currently has zero subscribers is
 * either (a) shouting into the void, or (b) an audit/log channel that
 * intentionally has no listeners. We can't tell which deterministically,
 * so this is always a clear-signal trigger but the *DM template* will
 * include an "if this is intentional, see <doc>" footer.
 */
function checkSubscriptionCoverage(deps: AuditDeps, opts: Required<Omit<AuditOptions, 'channelNamingPattern' | 'tupleKeyPattern'>> & { channelNamingPattern: RegExp; tupleKeyPattern: RegExp }, now: number): ComplaintIssue[] {
  const issues: ComplaintIssue[] = [];
  const cutoff = now - opts.subscriptionCoverageWindowMs;
  for (const ch of deps.listChannels()) {
    if (ch.count < opts.subscriptionCoverageMinPublishes) continue;
    if (ch.lastMessage !== null && ch.lastMessage < cutoff) continue;
    const subs = deps.subscriberCount(ch.channel);
    if (subs > 0) continue;
    issues.push({
      kind: 'subscription_coverage',
      severity: 'warn',
      target: { actor: 'coxswain' },
      evidence: {
        channel: ch.channel,
        publishCount: ch.count,
        lastMessage: ch.lastMessage,
        subscriberCount: subs,
      },
      templateName: 'channel.shouts-into-void',
      needsJudge: false,
      cooldownKey: hashKey(['subscription_coverage', ch.channel]),
    });
  }
  return issues;
}

/**
 * Channel naming hygiene check. A declared channel that doesn't match the
 * `<scope>:<topic>[...]` pattern is flagged. Star-suffixed wildcard
 * subscriptions are exempt because they're not declared channels.
 */
function checkChannelNaming(deps: AuditDeps, opts: Required<Omit<AuditOptions, 'channelNamingPattern' | 'tupleKeyPattern'>> & { channelNamingPattern: RegExp; tupleKeyPattern: RegExp }): ComplaintIssue[] {
  const issues: ComplaintIssue[] = [];
  for (const ch of deps.listChannels()) {
    if (ch.channel.includes('*')) continue;
    if (opts.channelNamingPattern.test(ch.channel)) continue;
    issues.push({
      kind: 'channel_naming',
      severity: 'info',
      // Convention is cartographer's surface, not the agent's fault.
      target: { actor: 'cartographer' },
      evidence: { channel: ch.channel, expected: opts.channelNamingPattern.toString() },
      templateName: 'channel.naming-violation',
      needsJudge: false,
      cooldownKey: hashKey(['channel_naming', ch.channel]),
    });
  }
  return issues;
}

/**
 * Tuple-key naming check. Same idea as channel naming — flag keys that
 * don't match the canonical `<noun>/<noun>` shape.
 */
function checkTupleNaming(deps: AuditDeps, opts: Required<Omit<AuditOptions, 'channelNamingPattern' | 'tupleKeyPattern'>> & { channelNamingPattern: RegExp; tupleKeyPattern: RegExp }): ComplaintIssue[] {
  if (!deps.listTupleKeys) return [];
  const issues: ComplaintIssue[] = [];
  for (const t of deps.listTupleKeys()) {
    if (opts.tupleKeyPattern.test(t.key)) continue;
    issues.push({
      kind: 'tuple_naming',
      severity: 'info',
      target: { actor: 'cartographer' },
      evidence: { key: t.key, expected: opts.tupleKeyPattern.toString(), cardinality: t.cardinality },
      templateName: 'tuple.shape-violation',
      needsJudge: false,
      cooldownKey: hashKey(['tuple_naming', t.key]),
    });
  }
  return issues;
}

/**
 * Silent-agent check. An agent is "silent" if:
 *   - registered more than `silentAgentMinAgeMs` ago, AND
 *   - has zero outbound activity (when `outboundActivityCount` is provided)
 *     OR has not heartbeated since registration (fallback when activity
 *     count is unavailable).
 *
 * Silence in [min, borderlineMax) is borderline (could be deep work) and
 * gets needsJudge=true. Silence beyond borderlineMax fires deterministically.
 */
function checkSilentAgents(deps: AuditDeps, opts: Required<Omit<AuditOptions, 'channelNamingPattern' | 'tupleKeyPattern'>> & { channelNamingPattern: RegExp; tupleKeyPattern: RegExp }, now: number): ComplaintIssue[] {
  const issues: ComplaintIssue[] = [];
  for (const agent of deps.listAgents()) {
    const age = now - agent.registeredAt;
    if (age < opts.silentAgentMinAgeMs) continue;

    const isSilent = (agent.outboundActivityCount !== undefined)
      ? agent.outboundActivityCount === 0
      : agent.lastHeartbeat <= agent.registeredAt;

    if (!isSilent) continue;

    const borderline = age < opts.silentAgentBorderlineMaxMs;
    issues.push({
      kind: 'silent_agent',
      severity: borderline ? 'info' : 'warn',
      target: { actor: 'coxswain', agentId: agent.id },
      evidence: {
        agentId: agent.id,
        ageMs: age,
        outboundActivityCount: agent.outboundActivityCount ?? null,
        lastHeartbeat: agent.lastHeartbeat,
        registeredAt: agent.registeredAt,
      },
      templateName: 'agent.silent-too-long',
      needsJudge: borderline,
      cooldownKey: hashKey(['silent_agent', agent.id]),
    });
  }
  return issues;
}

/**
 * Near-duplicate channel detection. Embeds every declared channel name and
 * flags any pair whose cosine similarity is above the high threshold.
 * Pairs in the [borderlineLow, high) range are flagged with needsJudge=true.
 *
 * O(N²) over channel count; fine while N stays in the dozens. If channel
 * count grows past a few hundred we'd switch to LSH or coarse bucketing.
 */
async function checkNearDuplicateChannels(deps: AuditDeps, opts: Required<Omit<AuditOptions, 'channelNamingPattern' | 'tupleKeyPattern'>> & { channelNamingPattern: RegExp; tupleKeyPattern: RegExp }): Promise<ComplaintIssue[]> {
  if (!deps.embed) return [];
  const channels = deps.listChannels()
    .filter(c => !c.channel.includes('*'))
    .map(c => c.channel);
  if (channels.length < 2) return [];

  let vectors: number[][];
  try {
    vectors = await deps.embed(channels);
  } catch (err) {
    deps.log?.('embed failed, skipping channel_near_duplicate this tick', { error: (err as Error).message });
    return [];
  }
  if (vectors.length !== channels.length) return [];

  const issues: ComplaintIssue[] = [];
  // Pair every channel with every other channel exactly once. Use the
  // higher of (a, b) lex order to keep the cooldownKey deterministic.
  for (let i = 0; i < channels.length; i += 1) {
    for (let j = i + 1; j < channels.length; j += 1) {
      const sim = cosine(vectors[i], vectors[j]);
      if (sim < opts.duplicateChannelBorderlineLow) continue;
      const [lo, hi] = channels[i] < channels[j] ? [channels[i], channels[j]] : [channels[j], channels[i]];
      const borderline = sim < opts.duplicateChannelSimThreshold;
      issues.push({
        kind: 'channel_near_duplicate',
        severity: borderline ? 'info' : 'warn',
        target: { actor: 'coxswain' },
        evidence: { channelA: lo, channelB: hi, similarity: Number(sim.toFixed(4)) },
        templateName: 'channel.near-duplicate',
        needsJudge: borderline,
        cooldownKey: hashKey(['channel_near_duplicate', lo, hi]),
      });
    }
  }
  return issues;
}

export interface CoordinationPipelineAudit {
  /** Run a single audit pass. Pure — does not mutate daemon state, does not
   *  fire DMs. Returns the issues; the caller decides what to do with them. */
  auditOnce: () => Promise<ComplaintIssue[]>;
}

export function createCoordinationPipelineAudit(deps: AuditDeps, options: AuditOptions = {}): CoordinationPipelineAudit {
  const opts = { ...DEFAULTS, ...options };
  const now = deps.now ?? Date.now;

  return {
    async auditOnce() {
      const tNow = now();
      const issues: ComplaintIssue[] = [];
      issues.push(...checkSubscriptionCoverage(deps, opts, tNow));
      issues.push(...checkChannelNaming(deps, opts));
      issues.push(...checkTupleNaming(deps, opts));
      issues.push(...checkSilentAgents(deps, opts, tNow));
      issues.push(...await checkNearDuplicateChannels(deps, opts));
      return issues;
    },
  };
}
