/**
 * lib/spawner/coast-guard-runner.ts — wire the Coast Guard into the spawner.
 *
 * The spawner calls `withCoastGuard(...)` around every SUBPROCESS backend
 * (codex, claude-cli, aider, custom). It:
 *   1. starts an in-process, hard-capped EgressMeter and points the child's
 *      HTTPS_PROXY at it (the CAP);
 *   2. scrubs raw API keys from the child env + builds broker injection rules
 *      from the daemon's sealed secret cache (the BROKER);
 *   3. wraps the command under the OS sandbox confining the crown jewels
 *      (the CONFINE);
 * then runs the wrapped command and emits a Coast Guard receipt.
 *
 * The meter runs IN-PROCESS (not a subprocess) so the broker can read keys
 * straight from getSecret() without ever writing them to a temp file. The
 * daemon is long-lived; one loopback proxy per running agent is cheap and is
 * torn down when the agent exits.
 *
 * Honest limit (also in the receipt): a malicious same-UID agent can
 * `unset HTTPS_PROXY` and egress directly. This is the cooperative-case
 * defense. See lib/coast-guard.ts and ADR-0050.
 */

import {
  confineCommand,
  resolveCoastGuardPolicy,
  buildBrokerRules,
  type CoastGuardPolicy,
  type CoastGuardReceipt,
  type ConfinementHandle,
} from '../coast-guard.js';
import { EgressMeter } from '../coast-guard/egress-meter.js';

export interface CoastGuardRunInput {
  agentId: string;
  backend: string;
  cmd: string;
  args: string[];
  env: Record<string, string | undefined>;
  workdir?: string;
  /** Per-spec opt-out + cap overrides (from SpawnSpec). */
  spec?: { coastGuard?: boolean; maxRequests?: number; maxBytes?: number | null };
  /** Injectable for tests so we don't read real process.env. */
  envSource?: Record<string, string | undefined>;
  /** Keys loaded from .env/.env.local — the broker scrubs ALL of them. */
  dotenvKeys?: readonly string[];
  /**
   * Scope-tier write confinement (lib/bond-pricing.ts `scopeTierWritePolicy`).
   * `'read-only'` denies the agent writes to its project workdir; default
   * `'unrestricted'`. The spawner derives this from the spawn's priced scope
   * tier so a read-tier agent is physically held to reads of the shared state
   * its bond covers.
   */
  writePolicy?: 'read-only' | 'unrestricted';
}

export interface CoastGuardRun {
  /** The command to actually exec (sandbox-wrapped when confinement is available). */
  cmd: string;
  args: string[];
  /** Child env: raw keys scrubbed, proxy wired. */
  env: Record<string, string | undefined>;
  policy: CoastGuardPolicy;
  confined: boolean;
  mechanism: ConfinementHandle['mechanism'];
  /** Build the final receipt (egress folded in). Call after the child exits. */
  receipt: () => CoastGuardReceipt;
  /** Tear down the meter + temp files. ALWAYS call in finally. */
  dispose: () => void;
}

/**
 * Prepare a Coast-Guarded run. Returns the (possibly sandbox-wrapped) command,
 * scrubbed+proxied env, and a receipt/dispose pair. When the policy is disabled
 * (operator opt-out), returns the original command untouched with a receipt
 * recording `confined:false` and no egress cap — honestly, never silently.
 *
 * Design/why: this is the single authority boundary every subprocess backend
 * (codex, claude-cli, aider, custom, and the cli-tube family) crosses before
 * spawning, so confinement cannot be forgotten per-backend. It also owns its
 * partial state: if `confineCommand()` throws after the egress meter is
 * already listening, the meter is disposed HERE before the error propagates —
 * a rejected `withCoastGuard()` never leaks a loopback listener to a caller
 * who was never handed a `dispose()`.
 *
 * `await`-able because starting the in-process meter binds a loopback port.
 *
 * @param input identity/backend for the receipt, the raw command + args + env,
 *   workdir, per-spec policy overrides, the dotenv scrub inventory, and the
 *   scope-tier write policy (see `CoastGuardRunInput`).
 * @returns a `CoastGuardRun`: the command to exec (wrapped when confinement is
 *   available), scrubbed+proxied env, resolved policy, and the
 *   `receipt()`/`dispose()` pair — call `dispose()` in a finally.
 */
export async function withCoastGuard(input: CoastGuardRunInput): Promise<CoastGuardRun> {
  const policy = resolveCoastGuardPolicy(input.spec ?? {}, input.envSource ?? process.env);

  if (!policy.enabled) {
    // Operator opted out. No proxy, no sandbox, no scrub — but a receipt that
    // says so plainly. We never imply protection that isn't in force.
    const startedAt = Date.now();
    let endedAt: number | null = null;
    return {
      cmd: input.cmd,
      args: input.args,
      env: input.env,
      policy,
      confined: false,
      mechanism: 'none',
      receipt: () => {
        endedAt = endedAt ?? Date.now();
        return {
          tool: 'pd-coast-guard',
          agentId: input.agentId,
          backend: input.backend,
          confined: false,
          mechanism: 'none',
          confinedPaths: [],
          scrubbedSecrets: [],
          egressCap: { maxRequests: 0, maxBytes: null },
          egress: null,
          writePolicy: 'unrestricted',
          writeDeniedPaths: [],
          startedAt,
          endedAt,
          honestLimits:
            'Coast Guard disabled for this spawn (operator opt-out). The agent ran ' +
            'with full filesystem access, its raw env, and no egress cap.',
        };
      },
      dispose: () => {},
    };
  }

  // 1. CAP — start the in-process metering proxy with the hard cap + broker.
  const meter = new EgressMeter({
    maxRequests: policy.maxRequests,
    maxBytes: policy.maxBytes ?? undefined,
    brokerRules: buildBrokerRules(),
  });
  await meter.listen(0);

  // 2+3. BROKER + CONFINE — scrub keys, sandbox-wrap, wire the proxy.
  let handle: ConfinementHandle;
  try {
    handle = confineCommand({
      agentId: input.agentId,
      backend: input.backend,
      cmd: input.cmd,
      args: input.args,
      env: input.env,
      workdir: input.workdir,
      dotenvKeys: input.dotenvKeys,
      writePolicy: input.writePolicy,
      policy,
      deps: {
        proxyUrl: meter.proxyUrl,
        readEgress: () => ({
          requests: meter.state.requests,
          bytes: meter.state.bytes,
          blocked: meter.state.blocked,
          injected: meter.state.injected,
        }),
        disposeProxy: () => meter.dispose(),
      },
    });
  } catch (err) {
    // confineCommand can throw synchronously (e.g. SbplInjectionError from an
    // unsafe workdir, thrown before it ever hands back a dispose()). The meter
    // is already listening on a loopback port at that point — with no handle
    // returned, the caller has nothing to dispose. Tear it down here so a
    // rejected withCoastGuard() never leaks the egress-meter listener.
    meter.dispose();
    throw err;
  }

  return {
    cmd: handle.cmd,
    args: handle.args,
    env: handle.env,
    policy,
    confined: handle.confined,
    mechanism: handle.mechanism,
    receipt: handle.receipt,
    dispose: handle.dispose,
  };
}
