#!/usr/bin/env -S npx tsx
/**
 * CLI for the Fleetbot GitHub App publisher.
 *
 * Two commands:
 *
 *   preflight [--origin URL]
 *     Non-mutating. Reports whether the publish route is actually deployed on
 *     the relay being addressed, and whether a daemon capability provider is
 *     reachable. Run this first when a publish fails — it separates "the route
 *     is not deployed" from "admission refused", which otherwise look alike.
 *
 *   open-pr --repo O/R --base BRANCH --base-sha SHA --head-sha SHA
 *           --title T --body-file F --session ID [--origin URL]
 *     Publishes a pull request as port-daddy[bot]. Refuses loudly if the
 *     actuator cannot admit it. It will never fall back to `gh`, a PAT, or an
 *     ambient login — that fallback is the defect this path exists to remove.
 *
 * Credentials are read from the environment by name and never printed:
 *   PD_ACCOUNT_TOKEN   the operator pdu_ account bearer
 *
 * The daemon capability provider is resolved through
 * `lib/fleetbot-daemon-capability.ts`, which borrows the running daemon's
 * Phase 2 Ed25519 identity. This process holds no key of its own: if the daemon
 * identity is not enrolled, publication refuses rather than degrading.
 */

import { existsSync, readFileSync } from 'node:fs';
import {
  DEFAULT_RELAY_ORIGIN,
  FleetbotPublishError,
  PUBLISH_PATH,
  buildActionRequest,
  capabilitySpec,
  publish,
  type CapabilityProvider,
} from '../lib/fleetbot-publish-client.js';
import type { FleetbotAuthorship } from '../lib/github-publisher-contract.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
  const value = arg(name);
  if (!value) {
    console.error(`fleetbot-publish: --${name} is required`);
    process.exit(2);
  }
  return value;
}

/** Row id of the daemon's Phase 2 Ed25519 identity in the local registry. */
const PHASE2_KEY_ID = 'harbor-daemon-ed25519-v1';

/**
 * Open the running daemon's identity WITHOUT creating one.
 *
 * `initDaemonIdentity()` generates a keypair on a brand-new install, which is
 * right for the daemon and wrong for a CLI: a preflight that silently mints a
 * root-of-trust key would enrol an identity nobody registered with Relay and
 * then report itself ready. So the Phase 2 row is checked first and an absent
 * identity is reported as absent.
 *
 * @returns the daemon signer, or a string naming why there is none.
 */
async function resolveDaemonSigner(): Promise<
  { ok: true; signer: { signHex(m: string): Promise<string>; phase2PublicKeyHex(): string } }
  | { ok: false; reason: string }
> {
  const { resolveDbPath } = await import('../lib/db.js');
  const dbPath = resolveDbPath();
  if (!existsSync(dbPath)) {
    return { ok: false, reason: `no Port Daddy registry at the resolved path (set PORT_DADDY_DB or start the daemon)` };
  }
  let db: import('better-sqlite3').Database;
  try {
    const Database = (await import('better-sqlite3')).default;
    db = new Database(dbPath, { readonly: false, fileMustExist: true });
  } catch (err) {
    return { ok: false, reason: `registry could not be opened: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    const row = db.prepare('SELECT id FROM harbor_token_signing_keys WHERE id = ?').get(PHASE2_KEY_ID);
    if (!row) {
      return { ok: false, reason: 'daemon Phase 2 identity is not enrolled in this registry' };
    }
    const { createHarborTokens } = await import('../lib/harbor-tokens.js');
    const tokens = createHarborTokens(db);
    await tokens.initDaemonIdentity();
    return { ok: true, signer: tokens };
  } catch (err) {
    return { ok: false, reason: `daemon identity unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Resolve the daemon signer into a capability provider.
 *
 * Returns null when the identity or the account binding is absent. Null is a
 * refusal path, not a degraded one: `publish` raises MissingActuatorError
 * rather than proceeding, and nothing here reads a GitHub credential.
 */
async function resolveCapabilityProvider(): Promise<
  { provider: CapabilityProvider | null; reason: string }
> {
  const token = process.env.PD_ACCOUNT_TOKEN;
  if (!token) {
    return { provider: null, reason: 'PD_ACCOUNT_TOKEN is not set, so the capability cannot bind a bearer' };
  }
  const identity = await resolveDaemonSigner();
  if (!identity.ok) return { provider: null, reason: identity.reason };
  try {
    const { createDaemonCapabilityProvider } = await import('../lib/fleetbot-daemon-capability.js');
    return {
      provider: createDaemonCapabilityProvider({ signer: identity.signer, accountToken: token }),
      reason: 'daemon Phase 2 identity',
    };
  } catch (err) {
    const code = (err as { code?: string }).code;
    return { provider: null, reason: code ? `${code}: ${(err as Error).message}` : String(err) };
  }
}

async function preflight(): Promise<number> {
  const origin = (arg('origin') ?? DEFAULT_RELAY_ORIGIN).replace(/\/+$/, '');
  console.log(`fleetbot-publish preflight: ${origin}`);

  let health = 'unreachable';
  try {
    const response = await fetch(`${origin}/health`);
    health = `${response.status}`;
  } catch (err) {
    health = `unreachable (${err instanceof Error ? err.message : String(err)})`;
  }
  console.log(`  relay /health            : ${health}`);

  // An unauthenticated POST distinguishes deployment from admission. The
  // handler answers 401 when it exists and 404 only when it does not.
  let routeState: string;
  try {
    const response = await fetch(`${origin}${PUBLISH_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    routeState = response.status === 404
      ? '404 — ROUTE NOT DEPLOYED on this relay'
      : `${response.status} — route is deployed (refusal is the admission gate, as expected)`;
  } catch (err) {
    routeState = `unreachable (${err instanceof Error ? err.message : String(err)})`;
  }
  console.log(`  POST ${PUBLISH_PATH} : ${routeState}`);

  console.log(`  PD_ACCOUNT_TOKEN         : ${process.env.PD_ACCOUNT_TOKEN ? 'present' : 'absent'}`);

  const { provider, reason } = await resolveCapabilityProvider();
  console.log(`  daemon capability signer : ${provider ? `configured (${reason})` : `NOT configured — ${reason}`}`);

  // Local signing self-test. Mints a real capability over a synthetic,
  // non-mutating inspect scope and confirms the daemon key produces a
  // well-formed, self-consistent signature. Nothing is sent; the capability is
  // discarded. This separates "the daemon cannot sign" from "Relay refused",
  // which are the two failures that otherwise both surface as a 401.
  let signerState = 'skipped (no provider)';
  if (provider) {
    try {
      const probe = buildActionRequest({
        operation: 'pull-request.inspect',
        repository: 'curiositech/port-daddy',
        sessionId: 'preflight-self-test',
        authorship: {
          actorId: 'preflight-self-test',
          agentId: 'fleetbot-preflight',
          sessionId: 'preflight-self-test',
          purpose: 'Local capability signing self-test; never transmitted',
          identityProject: 'port-daddy',
          roadmapItem: 'fleetbot-publisher',
          sidequestReason: null,
          worktreeId: null,
          sourceBranch: null,
        },
        payload: {
          baseBranch: 'main',
          baseSha: '0'.repeat(40),
          pullRequestNumber: 1,
          expectedGithubHeadSha: '0'.repeat(40),
        },
      });
      const minted = await provider.mint(capabilitySpec(probe, {
        baseBranch: 'main',
        baseSha: '0'.repeat(40),
        headSha: '0'.repeat(40),
      }));
      const ttl = minted.capability.expiresAt - minted.capability.issuedAt;
      signerState =
        `OK — signed by daemon fingerprint ${minted.capability.daemonFingerprint.slice(0, 12)}…, `
        + `generation ${minted.capability.signingKeyGeneration}, ttl ${ttl}s`;
    } catch (err) {
      const code = (err as { code?: string }).code;
      signerState = `FAILED — ${code ?? 'error'}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  console.log(`  capability self-test     : ${signerState}`);

  const ready = routeState.startsWith('4') && !routeState.startsWith('404')
    && Boolean(provider) && signerState.startsWith('OK');
  console.log('');
  console.log(ready
    ? 'fleetbot-publish: actuator looks ready. A successful self-test proves this machine can '
      + 'sign; it does not prove Relay will admit the signature — only a real publish does that.'
    : 'fleetbot-publish: actuator is NOT ready — publication through it will refuse. '
      + 'Do not publish with a personal credential instead.');
  return ready ? 0 : 1;
}

async function openPr(): Promise<number> {
  const repository = required('repo').toLowerCase();
  const baseBranch = required('base');
  const baseSha = required('base-sha');
  const headSha = required('head-sha');
  const sessionId = required('session');
  const title = required('title');
  const body = readFileSync(required('body-file'), 'utf8');
  const origin = arg('origin') ?? DEFAULT_RELAY_ORIGIN;

  const authorship: FleetbotAuthorship = {
    actorId: required('actor-id'),
    agentId: required('agent-id'),
    sessionId,
    purpose: arg('purpose') ?? 'Publish a reviewed change',
    identityProject: arg('project') ?? 'port-daddy',
    roadmapItem: arg('roadmap-item') ?? null,
    sidequestReason: arg('sidequest-reason') ?? null,
    worktreeId: arg('worktree-id') ?? null,
    sourceBranch: arg('source-branch') ?? null,
  };

  const request = buildActionRequest({
    operation: 'pull-request.publish',
    repository,
    sessionId,
    authorship,
    payload: {
      baseBranch,
      baseSha,
      sourceHeadSha: headSha,
      sourceTreeSha: required('tree-sha'),
      sourceCommittedAt: Number(required('committed-at')),
      commitMessage: required('commit-message'),
      changes: JSON.parse(readFileSync(required('changes-file'), 'utf8')),
      title,
      body,
      draft: process.argv.includes('--draft'),
    },
  });

  try {
    const result = await publish(request, {
      origin,
      accountToken: process.env.PD_ACCOUNT_TOKEN ?? '',
      capabilityProvider: (await resolveCapabilityProvider()).provider,
      scope: { baseBranch, baseSha, headSha },
    });
    console.log(`fleetbot-publish: ${result.receipt.result} ${result.receipt.resourceUrl}`);
    console.log(`  receipt   : ${result.receipt.receiptId}`);
    console.log(`  authority : ${result.receipt.authority} (${result.receipt.appSlug})`);
    console.log(`  head      : ${result.receipt.githubHeadSha}`);
    return 0;
  } catch (err) {
    if (err instanceof FleetbotPublishError) {
      console.error(err.report());
      return 1;
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === 'preflight') process.exitCode = await preflight();
  else if (command === 'open-pr') process.exitCode = await openPr();
  else {
    console.error('usage: fleetbot-publish.ts <preflight|open-pr> [options]');
    process.exitCode = 2;
  }
}

void main();
