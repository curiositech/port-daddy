#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_USE_CASES = ['cache', 'distributed-lock', 'rate-limit', 'leaderboard', 'durable-queue', 'notification'];
const VALID_MESSAGING = ['streams', 'pubsub', 'none'];
const VALID_DELETE_METHODS = ['DEL', 'UNLINK', 'batched-scan'];
const VALID_EVICTION = ['noeviction', 'allkeys-lru', 'allkeys-lfu', 'volatile-lru', 'volatile-ttl'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a Redis pattern plan against redis-patterns-expert's anti-patterns
 * and Quality Gates. All rules operate on structured enum/boolean fields --
 * no free-text matching.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/redis-patterns-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditRedisPatterns(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_USE_CASES.includes(plan.useCase)) {
    throw new TypeError(`plan.useCase must be one of: ${VALID_USE_CASES.join(', ')}`);
  }

  const findings = [];
  const recommendations = [];
  let score = 100;
  let criticalHit = false;

  function fail(rule, severity, message, recommendation) {
    findings.push({ rule, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
    score -= { critical: 30, high: 15, medium: 8, low: 3 }[severity] ?? 5;
  }

  const { useCase } = plan;

  // --- Gate: pub/sub used only for ephemeral notifications, never durable jobs ---
  if (useCase === 'durable-queue') {
    if (!VALID_MESSAGING.includes(plan.messagingPrimitive)) {
      fail(
        'durable-queue-primitive-unspecified',
        'high',
        'useCase is durable-queue but messagingPrimitive is not one of streams/pubsub/none.',
        'Declare messagingPrimitive: "streams" -- durable multi-consumer queues in Redis are Streams + consumer groups.'
      );
    } else if (plan.messagingPrimitive === 'pubsub') {
      fail(
        'pubsub-for-durable-jobs',
        'critical',
        'messagingPrimitive is pubsub for a durable-queue use case: pub/sub is at-most-once and subscribers offline at publish time lose the message.',
        'Use Streams + consumer groups (XADD / XREADGROUP / XACK) for durable jobs. Always.'
      );
    } else if (plan.messagingPrimitive === 'streams') {
      if (plan.pendingReclaimHandled !== true) {
        fail(
          'no-pel-reclaim',
          'high',
          'Streams consumer group has pendingReclaimHandled !== true: work claimed by a crashed consumer stays in the PEL forever.',
          'Add an XPENDING + XCLAIM sweep (or XAUTOCLAIM) so idle pending entries are reclaimed, with a max-deliveries dead-letter threshold.'
        );
      }
      if (plan.streamMaxlenCapped !== true) {
        fail(
          'uncapped-stream',
          'medium',
          'streamMaxlenCapped is not true: an uncapped stream grows without bound.',
          "Cap growth with XADD ... MAXLEN ~ N (the ~ makes trimming approximate and cheap)."
        );
      }
    }
  }

  // --- Gates: cache keys have atomic TTL with jitter; eviction policy fits a cache ---
  if (useCase === 'cache') {
    if (plan.ttlSet !== true) {
      fail(
        'cache-key-without-ttl',
        'high',
        'ttlSet is not true: cache entries without a TTL live until eviction pressure, and stale data serves forever.',
        'Set a TTL on every cache key (SET key val EX seconds).'
      );
    } else if (plan.ttlJitter !== true) {
      fail(
        'ttl-without-jitter',
        'medium',
        'ttlJitter is not true: keys set together expire together -- the dogpile/thundering-herd on expiry.',
        'Add 5-15% randomization to every cache TTL so a deploy-time cache fill does not expire in one burst.'
      );
    }
    if (plan.atomicSetWithExpiry !== true) {
      fail(
        'set-then-expire',
        'high',
        'atomicSetWithExpiry is not true: a crash between SET and EXPIRE leaves an immortal key.',
        'Use SET key val EX seconds in one command -- never SET followed by EXPIRE.'
      );
    }
    if (plan.evictionPolicy !== undefined && plan.evictionPolicy === 'noeviction') {
      fail(
        'noeviction-for-cache',
        'high',
        'evictionPolicy is noeviction for a pure cache: writes will start failing at maxmemory instead of evicting cold keys.',
        'Use allkeys-lru (or allkeys-lfu for long-lived hot keys) for a pure cache.'
      );
    }
    if (plan.maxmemorySet !== true) {
      fail(
        'maxmemory-unset',
        'medium',
        'maxmemorySet is not true: without an explicit maxmemory, Redis grows until the OS OOM-kills it.',
        'Set maxmemory and maxmemory-policy explicitly per environment.'
      );
    }
  }

  if (plan.evictionPolicy !== undefined && !VALID_EVICTION.includes(plan.evictionPolicy)) {
    fail(
      'invalid-eviction-policy',
      'medium',
      `evictionPolicy "${plan.evictionPolicy}" is not one of: ${VALID_EVICTION.join(', ')}.`,
      'Pick a real maxmemory-policy value from the eviction table in SKILL.md.'
    );
  }

  // --- Gate: locks use ownership tokens; release via Lua ---
  if (useCase === 'distributed-lock') {
    if (plan.lockOwnershipToken !== true) {
      fail(
        'lock-without-ownership-token',
        'critical',
        'lockOwnershipToken is not true: without a per-acquisition token, a client whose work overran the lease can release someone else\'s lock.',
        'SET lockKey <random-token> NX PX leaseMs, and only release when the stored token matches yours.'
      );
    }
    if (plan.lockReleaseViaLua !== true) {
      fail(
        'non-atomic-lock-release',
        'high',
        'lockReleaseViaLua is not true: GET-compare-then-DEL as separate commands is a TOCTOU race.',
        'Release via the compare-and-delete Lua script so the token check and DEL are atomic.'
      );
    }
  }

  // --- Gate: no KEYS in production ---
  if (plan.usesKeysCommand === true) {
    fail(
      'keys-in-production',
      'critical',
      'usesKeysCommand is true: KEYS blocks the server while it scans every key; latency spikes correlate with admin commands.',
      'Use SCAN cursor-based iteration (per-shard on Cluster) instead of KEYS.'
    );
  }

  // --- Gate: UNLINK over DEL for big structures ---
  if (plan.largeDeleteMethod !== undefined) {
    if (!VALID_DELETE_METHODS.includes(plan.largeDeleteMethod)) {
      fail(
        'invalid-delete-method',
        'medium',
        `largeDeleteMethod "${plan.largeDeleteMethod}" is not one of: ${VALID_DELETE_METHODS.join(', ')}.`,
        'Declare DEL, UNLINK, or batched-scan so the big-key deletion strategy is auditable.'
      );
    } else if (plan.largeDeleteMethod === 'DEL') {
      fail(
        'blocking-del-on-big-key',
        'high',
        'largeDeleteMethod is DEL: deleting a multi-million-item structure synchronously blocks the main thread for seconds.',
        'Use UNLINK (async free), or batch via SCAN-family + chunked removes for sorted sets.'
      );
    }
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Plan clears every gate this skill checks. Still verify TTL jitter and lock lease lengths against measured origin latency before shipping.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: redis_patterns_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditRedisPatterns(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`redis_patterns_audit: ${e.message}\n`);
    process.exit(1);
  }
}
