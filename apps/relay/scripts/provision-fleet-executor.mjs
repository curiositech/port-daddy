#!/usr/bin/env node
/**
 * provision-fleet-executor.mjs — one-shot operator runbook for plan N2.
 *
 * Generates a fresh Ed25519 keypair for the fleet executor, registers it with
 * the relay (POST /v1/fleet/executor-identity, operator token), and prints the
 * exact `wrangler secret put` commands that finish the job. The private seed
 * is printed ONCE and never sent anywhere except stdout — the relay only ever
 * sees the public key.
 *
 * Usage:
 *   node scripts/provision-fleet-executor.mjs \
 *     --relay https://port-daddy-relay-latest.example.workers.dev \
 *     --deployment staging
 *
 * The operator token is read from RELAY_OPERATOR_TOKEN in the environment
 * (never a flag — flags leak into shell history).
 *
 * Rotation: run POST /v1/revoke-by-issuer with issuer
 * `operator:fleet-executor@<deployment>` and the old grant's iat window, then
 * run this script again with a fresh deployment or the same one.
 */

import { webcrypto } from 'node:crypto';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const relay = arg('relay');
const deployment = arg('deployment') ?? 'staging';
const operatorToken = process.env.RELAY_OPERATOR_TOKEN;

if (!relay || !operatorToken) {
  console.error('usage: RELAY_OPERATOR_TOKEN=... node scripts/provision-fleet-executor.mjs --relay <url> [--deployment staging]');
  process.exit(2);
}

const toHex = (b) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');

const seed = webcrypto.getRandomValues(new Uint8Array(32));
const seedHex = toHex(seed);
const pubKey = toHex(ed.getPublicKey(seed));

const res = await fetch(`${relay.replace(/[/]+$/, '')}/v1/fleet/executor-identity`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${operatorToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({ pub_key: pubKey, deployment }),
});
const body = await res.json();
if (!res.ok) {
  console.error(`provisioning failed (${res.status}):`, body);
  process.exit(1);
}

console.log('provisioned fleet-executor identity');
console.log(`  deployment:        ${deployment}`);
console.log(`  fingerprint:       ${body.fingerprint}`);
console.log(`  relay fingerprint: ${body.relay_fingerprint}`);
console.log(`  card jti:          ${body.jti} (expires ${new Date(body.exp * 1000).toISOString()})`);
console.log('');
console.log('finish with (run from apps/fleet-executor):');
console.log(`  printf %s '${seedHex}' | wrangler secret put FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX --config wrangler.deploy.toml`);
console.log(`  printf %s '${body.card}' | wrangler secret put FLEET_EXECUTOR_HARBOR_CARD --config wrangler.deploy.toml`);
console.log('');
console.log('the seed above is the ONLY copy — store it nowhere else.');
