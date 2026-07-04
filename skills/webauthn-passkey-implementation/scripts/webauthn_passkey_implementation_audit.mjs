#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_CEREMONIES = ['registration', 'authentication', 'both'];
const VALID_LIBRARIES = ['simplewebauthn', 'py-webauthn', 'webauthn4j', 'other-library', 'hand-rolled'];
const VALID_CHALLENGE_SOURCES = ['server', 'client'];
const VALID_USER_ID_KINDS = ['random-opaque', 'email', 'db-sequence'];
const VALID_RESIDENT_KEY = ['required', 'preferred', 'discouraged'];
const VALID_ATTESTATION = ['none', 'indirect', 'direct', 'enterprise'];
const SEVERITY_WEIGHTS = { critical: 30, high: 15, medium: 8, low: 3 };

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a WebAuthn relying-party implementation plan against the W3C 7.1/7.2
 * verification steps and this skill's Quality Gates. Structured fields only.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/webauthn-passkey-implementation-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditWebauthnPasskeyImplementation(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a JSON object (not null, not an array)');
  }
  if (!VALID_CEREMONIES.includes(plan.ceremony)) {
    throw new TypeError(`plan.ceremony must be one of: ${VALID_CEREMONIES.join(', ')}`);
  }
  if (!VALID_LIBRARIES.includes(plan.library)) {
    throw new TypeError(`plan.library must be one of: ${VALID_LIBRARIES.join(', ')}`);
  }

  const registration = plan.ceremony === 'registration' || plan.ceremony === 'both';
  const authentication = plan.ceremony === 'authentication' || plan.ceremony === 'both';

  const findings = [];
  const recommendations = [];
  let score = 100;
  let criticalHit = false;

  function fail(rule, severity, message, recommendation) {
    findings.push({ rule, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
    score -= SEVERITY_WEIGHTS[severity] ?? 5;
  }

  // --- Gate: never hand-roll CBOR/COSE/attestation parsing ---
  if (plan.library === 'hand-rolled') {
    fail(
      'hand-rolled-webauthn-crypto',
      'critical',
      'library is hand-rolled: CBOR / COSE / attestation-format parsing is exactly where DIY WebAuthn implementations have CVEs.',
      'Use SimpleWebAuthn (Node), py_webauthn (Python), or webauthn4j (Java) and review their verify functions instead.'
    );
  }

  // --- Gate: challenge discipline ---
  if (plan.challengeSource !== 'server') {
    fail(
      'client-supplied-challenge',
      'critical',
      `challengeSource is "${plan.challengeSource}": trusting a client-supplied challenge makes assertions replayable.`,
      'The server MUST generate the challenge (>=16 random bytes), store it in the session, and validate clientDataJSON.challenge against it.'
    );
  }
  if (plan.challengeSingleUse !== true) {
    fail(
      'challenge-not-single-use',
      'high',
      'challengeSingleUse is not true: a challenge that survives one verification attempt is a replay window.',
      'Delete the challenge from the session after one verification attempt, success or failure.'
    );
  }

  // --- Gates: the MUST-verify steps (W3C 7.1 / 7.2) ---
  if (plan.verifiesChallengeMatch !== true) {
    fail(
      'challenge-match-not-verified',
      'critical',
      'verifiesChallengeMatch is not true: without matching clientDataJSON.challenge to the session-stored value, any captured response replays.',
      'Verify the base64url challenge in clientDataJSON equals the session-stored challenge on every response.'
    );
  }
  if (plan.verifiesOrigin !== true) {
    fail(
      'origin-not-verified',
      'critical',
      'verifiesOrigin is not true: a phishing site can capture a passkey assertion and replay it against you.',
      'Verify clientDataJSON.origin equals the expected origin (finite allowlist, production origins only).'
    );
  }
  if (plan.verifiesRpIdHash !== true) {
    fail(
      'rpidhash-not-verified',
      'critical',
      'verifiesRpIdHash is not true: skipping the rpIdHash check allows cross-origin credential reuse.',
      'Verify authData.rpIdHash equals SHA-256(rpId) on every response.'
    );
  }
  if (authentication && plan.verifiesSignature !== true) {
    fail(
      'signature-not-verified',
      'critical',
      'authentication ceremony with verifiesSignature not true: the assertion proves nothing without verifying the signature over authenticatorData || SHA-256(clientDataJSON) with the stored public key.',
      'Verify response.signature over the signed data using the stored COSE credentialPublicKey.'
    );
  }
  if (authentication && plan.counterCheckImplemented !== true) {
    fail(
      'counter-check-missing',
      'high',
      'counterCheckImplemented is not true: without the signCount monotonicity check, a cloned authenticator goes undetected.',
      'When signCount or the stored counter is > 0, require the new value to be strictly greater; reject or flag otherwise, then persist it.'
    );
  }

  // --- Gate: user.id must be a random opaque buffer ---
  if (plan.userIdKind === 'email') {
    fail(
      'user-id-is-email',
      'critical',
      'userIdKind is email: PII lands inside the authenticator and email-change flows break.',
      'Use a random 16-64 byte opaque user.id; map it to the account separately.'
    );
  } else if (plan.userIdKind === 'db-sequence') {
    fail(
      'user-id-is-db-sequence',
      'high',
      'userIdKind is db-sequence: enumerable numeric IDs leak account structure into authenticators.',
      'Use a random opaque buffer for user.id instead of the database sequence.'
    );
  } else if (plan.userIdKind !== undefined && !VALID_USER_ID_KINDS.includes(plan.userIdKind)) {
    fail(
      'invalid-user-id-kind',
      'medium',
      `userIdKind "${plan.userIdKind}" is not one of: ${VALID_USER_ID_KINDS.join(', ')}.`,
      'Declare how user.id is generated; it must be a random opaque buffer.'
    );
  }

  // --- Gate: attestation policy ---
  if (plan.attestation !== undefined && !VALID_ATTESTATION.includes(plan.attestation)) {
    fail(
      'invalid-attestation-value',
      'medium',
      `attestation "${plan.attestation}" is not one of: ${VALID_ATTESTATION.join(', ')}.`,
      'Use "none" for consumer passkeys; stronger values only with a concrete compliance need.'
    );
  } else if (plan.attestation !== undefined && plan.attestation !== 'none' && plan.attestationComplianceNeed !== true) {
    fail(
      'attestation-without-compliance-need',
      'high',
      `attestation is "${plan.attestation}" with attestationComplianceNeed not true: requiring attestation breaks platform passkeys (iCloud, Google) that do not always attest.`,
      'Set attestation: "none" unless a concrete hardware-policy/compliance requirement exists (then verify against FIDO MDS).'
    );
  }

  // --- Gate: passkey (discoverable credential) options ---
  if (registration && plan.residentKey !== undefined && VALID_RESIDENT_KEY.includes(plan.residentKey) && plan.residentKey !== 'required') {
    fail(
      'resident-key-not-required',
      'medium',
      `residentKey is "${plan.residentKey}": passkeys are defined by discoverable credentials; anything weaker yields non-passkey credentials on some authenticators.`,
      'Set authenticatorSelection.residentKey: "required" for a passkey deployment.'
    );
  }
  if (registration && plan.excludeCredentialsPopulated !== true) {
    fail(
      'exclude-credentials-empty',
      'medium',
      'excludeCredentialsPopulated is not true: users can accidentally register the same authenticator twice.',
      'Pass every existing credentialId of the user in excludeCredentials during registration.'
    );
  }

  // --- Gate: conditional UI requires an empty allowCredentials ---
  if (plan.conditionalUiEnabled === true && plan.allowCredentialsEmptyForConditional !== true) {
    fail(
      'conditional-ui-with-allowlist',
      'high',
      'conditionalUiEnabled is true but allowCredentialsEmptyForConditional is not: with a non-empty allowCredentials the browser cannot offer discoverable credentials in autofill, so the feature silently does nothing.',
      'Send allowCredentials: [] for the conditional-UI request (plus autocomplete="username webauthn" and mediation: "conditional" client-side).'
    );
  }

  // --- Gate: store the synced-vs-device-bound flags ---
  if (plan.storesBackupFlags !== true) {
    fail(
      'backup-flags-not-stored',
      'low',
      'storesBackupFlags is not true: without BE/BS-derived deviceType/backedUp you cannot warn users who only have device-bound passkeys.',
      'Persist deviceType and backedUp per credential and surface a "add a synced passkey" hint when all are device-bound.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Plan clears every gate this skill checks. Still run the integration tests (mismatched challenge/origin/rpIdHash rejected, counter replay rejected) and manually verify conditional UI in Chrome and Safari.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: webauthn_passkey_implementation_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditWebauthnPasskeyImplementation(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`webauthn_passkey_implementation_audit: ${e.message}\n`);
    process.exit(1);
  }
}
