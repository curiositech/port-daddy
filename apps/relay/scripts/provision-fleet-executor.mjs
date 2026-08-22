#!/usr/bin/env node
/**
 * provision-fleet-executor.mjs — agent-owned provisioning primitive for plan N2.
 *
 * Generates a fresh Ed25519 keypair for the fleet executor, registers it with
 * the relay (POST /v1/fleet/executor-identity, operator token), and writes the
 * private seed and harbor card directly to Wrangler over child-process stdin.
 * Neither credential is placed in argv, a shell command, stdout, or shell
 * history. The relay only ever sees the public key.
 *
 * Usage:
 *   node scripts/provision-fleet-executor.mjs \
 *     --relay https://port-daddy-relay-latest.example.workers.dev \
 *     --deployment staging
 *
 * The operator token is read from RELAY_OPERATOR_TOKEN in the environment
 * (never a flag). This script is for FleetBar/agent automation; it is not a
 * terminal instruction for the operator.
 *
 * Rotation: run POST /v1/revoke-by-issuer with issuer
 * `operator:fleet-executor@<deployment>` and the old grant's iat window, then
 * run this script again with a fresh deployment or the same one.
 */

import { webcrypto } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultWranglerBin = resolve(scriptDir, '../node_modules/.bin/wrangler');
const defaultConfigPath = resolve(scriptDir, '../../fleet-executor/wrangler.deploy.toml');

function arg(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function putSecret(name, value, options) {
  const result = options.run(
    options.wranglerBin,
    ['secret', 'put', name, '--config', options.configPath],
    {
      encoding: 'utf8',
      input: `${value}\n`,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  if (result.error) {
    throw new Error(`could not start Wrangler while installing ${name}`);
  }
  if (result.status !== 0) {
    throw new Error(`Wrangler failed while installing ${name} (exit ${result.status ?? 'unknown'})`);
  }
}

const toHex = (b) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Install the two executor credentials without exposing either value outside
 * Wrangler's stdin. Dependencies are injectable so the trust boundary is
 * executable in tests rather than asserted only in prose.
 */
export function installExecutorSecrets(
  { seedHex, card },
  {
    run = spawnSync,
    wranglerBin = defaultWranglerBin,
    configPath = defaultConfigPath,
    log = console.log,
  } = {},
) {
  const options = { run, wranglerBin, configPath };
  putSecret('FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX', seedHex, options);
  putSecret('FLEET_EXECUTOR_HARBOR_CARD', card, options);
  log('installed fleet-executor identity secrets through Wrangler stdin');
}

export async function main({ argv = process.argv, env = process.env, fetchImpl = fetch } = {}) {
  const relay = arg(argv, 'relay');
  const deployment = arg(argv, 'deployment') ?? 'staging';
  const operatorToken = env.RELAY_OPERATOR_TOKEN;

  if (!relay || !operatorToken) {
    throw new Error('RELAY_OPERATOR_TOKEN and --relay <url> are required');
  }

  const seed = webcrypto.getRandomValues(new Uint8Array(32));
  const seedHex = toHex(seed);
  const pubKey = toHex(ed.getPublicKey(seed));

  const res = await fetchImpl(`${relay.replace(/[/]+$/, '')}/v1/fleet/executor-identity`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${operatorToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ pub_key: pubKey, deployment }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`provisioning failed (${res.status})`);
  }

  installExecutorSecrets({ seedHex, card: body.card });
  console.log('provisioned fleet-executor identity');
  console.log(`  deployment:        ${deployment}`);
  console.log(`  fingerprint:       ${body.fingerprint}`);
  console.log(`  relay fingerprint: ${body.relay_fingerprint}`);
  console.log(`  card jti:          ${body.jti} (expires ${new Date(body.exp * 1000).toISOString()})`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'provisioning failed');
    process.exitCode = 1;
  });
}
