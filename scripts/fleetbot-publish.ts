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
 * `lib/fleetbot-daemon-capability.ts` when one is configured. There is
 * deliberately no way to sign a capability from this process.
 */

import { readFileSync } from 'node:fs';
import {
  DEFAULT_RELAY_ORIGIN,
  FleetbotPublishError,
  PUBLISH_PATH,
  buildActionRequest,
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

/**
 * Resolve the daemon signer.
 *
 * Returns null when none is configured. Null is a refusal path, not a
 * degraded one: `publish` raises MissingActuatorError rather than proceeding.
 */
async function resolveCapabilityProvider(): Promise<CapabilityProvider | null> {
  try {
    const mod = await import('../lib/fleetbot-daemon-capability.js');
    const provider = (mod as { createDaemonCapabilityProvider?: () => CapabilityProvider })
      .createDaemonCapabilityProvider;
    return typeof provider === 'function' ? provider() : null;
  } catch {
    return null;
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

  const provider = await resolveCapabilityProvider();
  console.log(`  daemon capability signer : ${provider ? 'configured' : 'NOT configured'}`);
  console.log(`  PD_ACCOUNT_TOKEN         : ${process.env.PD_ACCOUNT_TOKEN ? 'present' : 'absent'}`);

  const ready = routeState.startsWith('4') && !routeState.startsWith('404')
    && Boolean(provider) && Boolean(process.env.PD_ACCOUNT_TOKEN);
  console.log('');
  console.log(ready
    ? 'fleetbot-publish: actuator looks ready.'
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
      capabilityProvider: await resolveCapabilityProvider(),
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
