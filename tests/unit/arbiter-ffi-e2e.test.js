/**
 * End-to-end cross-boundary coverage for the Arbiter's CAP_ESCALATION rule over
 * the REAL FFI loader (`lib/arbiter.ts`'s `createArbiter`) — the one genuinely
 * live production hot path in this repo. On every `LOCK_ACQUIRE` activity event
 * for a capability-scoped resource, `checkCapEscalation()` calls the Rust
 * enforcer's `harbor_verify_caps_subset_json` over koffi to decide whether the
 * acquiring agent actually holds the capability it is locking.
 *
 * The existing arbiter suites (`arbiter.test.js`, `arbiter-unit.test.js`) either
 * mock away the enforcer or tolerate it being absent; none drives the real FFI
 * decision through a realistic MULTI-HOP lock-escalation sequence and asserts
 * the kernel path agrees, hop by hop, with the pure-TS subset reference. This
 * does. When the dylib is absent (CI, which does not build it) `checkCapEscalation`
 * is a safe no-op, so the FFI-dependent block is `describe.skip`-gated and a
 * separate always-run block proves the arbiter degrades cleanly without it.
 *
 * NOTE on the parity reference: the FFI export computes an EXACT subset
 * (`root_caps.contains(sub)`), so its byte-parity TS twin is an exact-subset
 * check — NOT `lib/cap-attenuation-monitor.ts`, which is a richer prefix-aware
 * chain checker serving the separate `checkCapAttenuation` surface. We compare
 * the kernel decision against the exact-subset twin the arbiter's hot path
 * actually relies on.
 */
import { describe, expect, test, afterEach } from '@jest/globals';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArbiter } from '../../lib/arbiter.js';
import { ActivityType } from '../../lib/activity.js';

const here = dirname(fileURLToPath(import.meta.url));
const HARBOR_DYLIB = join(
  here,
  '../../dist/core',
  'libharbor_card_rs.' + (process.platform === 'darwin' ? 'dylib' : 'so'),
);
const haveHarbor = existsSync(HARBOR_DYLIB);

/** The exact-subset check the FFI hot path relies on — required ⊆ held. */
function tsRequiredHeld(held, required) {
  return required.every((c) => held.includes(c));
}

/**
 * Build a live arbiter over a controllable activity log and an agent registry.
 * `emit(entry)` synchronously delivers an activity entry to the arbiter's
 * subscription, exactly as the real activity log would.
 */
function buildHarness(agentRegistry) {
  const subscribers = new Set();
  const activityLog = {
    subscribe(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    log() {
      return { success: true };
    },
  };
  const agents = {
    get(agentId) {
      const agent = agentRegistry.get(agentId);
      return agent ? { success: true, agent } : { success: false };
    },
  };
  const arbiter = createArbiter(
    { activityLog, agents, sessions: {}, locks: {} },
    { strictMode: false },
  );
  const emit = (entry) => subscribers.forEach((cb) => cb(entry));
  return { arbiter, emit };
}

const activeArbiters = [];
afterEach(() => {
  while (activeArbiters.length > 0) activeArbiters.pop()?.stop();
});

// ── Always-run (CI-safe): the arbiter is coherent with OR without the dylib ──

describe('arbiter FFI e2e — degrades cleanly and reports coherent status', () => {
  test('a scoped lock event never throws, whatever the enforcer state', () => {
    const registry = new Map([['agent-a', { pid: 1, metadata: { capabilities: ['db:read'] } }]]);
    const { arbiter, emit } = buildHarness(registry);
    activeArbiters.push(arbiter);
    // Whether the enforcer loaded or not, delivering a scoped LOCK_ACQUIRE must
    // not throw across the subscription boundary.
    expect(() =>
      emit({ type: ActivityType.LOCK_ACQUIRE, agentId: 'agent-a', targetId: 'db:read' }),
    ).not.toThrow();
    const status = arbiter.getStatus();
    expect(typeof status.enforcerLoaded).toBe('boolean');
    const cap = status.ruleDetails.find((r) => r.name === 'CAP_ESCALATION');
    expect(cap).toBeDefined();
    // The rule's engine reflects whether the native enforcer is loaded.
    expect(cap.engine).toBe(status.enforcerLoaded ? 'ffi' : 'runtime');
  });
});

// ── Dylib-required: the real FFI hot path, hop by hop ───────────────────────
const ffiDescribe = haveHarbor ? describe : describe.skip;

ffiDescribe('arbiter FFI e2e — the Rust enforcer decides a multi-hop lock-escalation chain', () => {
  test('kernel CAP_ESCALATION verdicts match the exact-subset TS reference on every hop', () => {
    // A 6-hop delegation chain: authority narrows down the chain. Each hop is an
    // agent acquiring a capability-scoped lock. Legit hops lock a capability they
    // hold; hop `escalator` grabs a capability its attenuated set never conveyed.
    const hops = [
      { agentId: 'op',        held: ['db:write', 'db:read', 'fs:critical', 'spawn:agent', 'net:egress'], lock: 'db:write' },
      { agentId: 'lead',      held: ['db:read', 'fs:critical', 'spawn:agent', 'net:egress'],             lock: 'spawn:agent' },
      { agentId: 'worker',    held: ['db:read', 'fs:critical', 'net:egress'],                            lock: 'fs:critical' },
      { agentId: 'reader',    held: ['db:read', 'net:egress'],                                           lock: 'db:read' },
      { agentId: 'escalator', held: ['db:read'],                                                         lock: 'fs:critical' }, // ESCALATION
      { agentId: 'tail',      held: ['db:read'],                                                         lock: 'db:read' },
    ];

    const registry = new Map(
      hops.map((h) => [h.agentId, { pid: 100, metadata: { capabilities: h.held } }]),
    );
    const { arbiter, emit } = buildHarness(registry);
    activeArbiters.push(arbiter);
    expect(arbiter.getStatus().enforcerLoaded).toBe(true); // the real Rust enforcer is live

    for (const h of hops) {
      emit({ type: ActivityType.LOCK_ACQUIRE, agentId: h.agentId, targetId: h.lock });
    }

    // What the exact-subset TS twin predicts should be flagged.
    const expectedEscalators = hops
      .filter((h) => !tsRequiredHeld(h.held, [h.lock]))
      .map((h) => h.agentId)
      .sort();

    // What the kernel-driven arbiter actually flagged.
    const capViolations = arbiter
      .getViolations()
      .filter((v) => v.rule === 'CAP_ESCALATION')
      .map((v) => v.agentId)
      .sort();

    expect(capViolations).toEqual(expectedEscalators);
    // The chain was designed to escalate exactly once.
    expect(capViolations).toEqual(['escalator']);
  });

  test('an agent holding the locked capability is never flagged; one lacking it always is', () => {
    const registry = new Map([
      ['holder', { pid: 1, metadata: { capabilities: ['db:write', 'db:read'] } }],
      ['pretender', { pid: 2, metadata: { capabilities: ['db:read'] } }],
    ]);
    const { arbiter, emit } = buildHarness(registry);
    activeArbiters.push(arbiter);

    emit({ type: ActivityType.LOCK_ACQUIRE, agentId: 'holder', targetId: 'db:write' });
    emit({ type: ActivityType.LOCK_ACQUIRE, agentId: 'pretender', targetId: 'db:write' });

    const flagged = arbiter
      .getViolations()
      .filter((v) => v.rule === 'CAP_ESCALATION')
      .map((v) => v.agentId);
    expect(flagged).toEqual(['pretender']);
    // And it agrees with the exact-subset TS reference for both.
    expect(tsRequiredHeld(['db:write', 'db:read'], ['db:write'])).toBe(true);
    expect(tsRequiredHeld(['db:read'], ['db:write'])).toBe(false);
  });
});
