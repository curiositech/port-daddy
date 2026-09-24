import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from '@jest/globals';

const repo = process.cwd();
const capacitySkill = join(repo, 'skills/context-economics-for-agent-swarms');
const resurrectionSkill = join(repo, 'skills/agent-resurrection-and-body-continuity');
const capacityFixturePath = join(capacitySkill, 'examples/capacity-evidence.ready.json');
const unknownCapacityFixturePath = join(capacitySkill, 'examples/capacity-evidence.unknown.json');
const resurrectionFixturePath = join(resurrectionSkill, 'examples/resurrection-plan.ready.json');
const unsafeResurrectionFixturePath = join(
  resurrectionSkill,
  'examples/resurrection-plan.unsafe-ready.json',
);

function fixture(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function validators() {
  const capacityModule = await import(pathToFileURL(
    join(capacitySkill, 'scripts/validate-capacity-evidence.mjs'),
  ).href);
  const resurrectionModule = await import(pathToFileURL(
    join(resurrectionSkill, 'scripts/validate-resurrection-plan.mjs'),
  ).href);
  return { ...capacityModule, ...resurrectionModule };
}

describe('Drydock safety evidence', () => {
  test('the sealed capacity and resurrection fixtures pass structural and semantic validation', async () => {
    const { validateCapacityEvidence, validateResurrectionPlan } = await validators();
    const capacity = fixture(capacityFixturePath);
    const plan = fixture(resurrectionFixturePath);

    expect(validateCapacityEvidence(capacity)).toEqual({ valid: true, errors: [] });
    expect(validateResurrectionPlan(plan, { capacityEvidence: capacity })).toEqual({
      valid: true,
      errors: [],
    });
  });

  test('a forecast cannot spend through a route outside its canonical capacity bucket', async () => {
    const { validateCapacityEvidence } = await validators();
    const capacity = fixture(capacityFixturePath);
    capacity.buckets[0].forecast.route = 'provider-demo:unowned-route';

    const result = validateCapacityEvidence(capacity);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('forecast route provider-demo:unowned-route is not one of its routeAliases'),
      'bucket bucket:provider-demo:seat-demo:five-hour eligibility disagrees with evidence',
      'admissible must match fresh eligible buckets, complete reservation, and nonblocking preemption state',
    ]));
  });

  test('a committed reservation is stale at the exact expiry boundary', async () => {
    const { validateCapacityEvidence } = await validators();
    const capacity = fixture(capacityFixturePath);
    capacity.reservation.expiresAt = capacity.evaluatedAt;

    const result = validateCapacityEvidence(capacity);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'admissible evidence requires issuedAt <= evaluatedAt < expiresAt',
      'admissible must match fresh eligible buckets, complete reservation, and nonblocking preemption state',
    ]));
  });

  test('a matching content digest cannot launder semantically invalid capacity evidence', async () => {
    const { digest, validateResurrectionPlan } = await validators();
    const capacity = fixture(capacityFixturePath);
    const plan = fixture(resurrectionFixturePath);
    capacity.buckets[0].forecast.route = 'provider-demo:unowned-route';
    plan.capacity.capacityEvidenceDigest = digest(capacity);

    const result = validateResurrectionPlan(plan, { capacityEvidence: capacity });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'capacity evidence: bucket bucket:provider-demo:seat-demo:five-hour forecast route provider-demo:unowned-route is not one of its routeAliases',
    );
    expect(result.errors).not.toContain('capacity evidence digest mismatch');
  });

  test('a matching content digest cannot launder structurally invalid capacity evidence', async () => {
    const { digest, validateResurrectionPlan } = await validators();
    const capacity = fixture(capacityFixturePath);
    const plan = fixture(resurrectionFixturePath);
    delete capacity.observation.parserProfileId;
    plan.capacity.capacityEvidenceDigest = digest(capacity);

    const result = validateResurrectionPlan(plan, { capacityEvidence: capacity });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "capacity evidence: schema /observation must have required property 'parserProfileId'",
    );
    expect(result.errors).not.toContain('capacity evidence digest mismatch');
  });

  test('effect identity is recomputed from arguments and approval slot', async () => {
    const { validateResurrectionPlan } = await validators();
    const capacity = fixture(capacityFixturePath);
    const plan = fixture(resurrectionFixturePath);
    plan.effects.items[0].normalizedArguments.draft = false;

    const result = validateResurrectionPlan(plan, { capacityEvidence: capacity });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/^effect effect-slot-1 canonical fingerprint mismatch; expected sha256:/),
    ]));
  });

  test('a new slot ID cannot disguise a duplicate logical effect', async () => {
    const { validateResurrectionPlan } = await validators();
    const capacity = fixture(capacityFixturePath);
    const plan = fixture(resurrectionFixturePath);
    const duplicate = structuredClone(plan.effects.items[0]);
    duplicate.effectSlotId = 'effect-slot-2';
    duplicate.idempotencyKeys = ['idem-demo-03'];
    plan.effects.items.push(duplicate);

    const result = validateResurrectionPlan(plan, { capacityEvidence: capacity });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      `duplicate canonical effect fingerprint ${duplicate.canonicalFingerprint}`,
    );
  });

  test('capsule facts are sealed instead of trusting a caller-supplied digest', async () => {
    const { validateResurrectionPlan } = await validators();
    const capacity = fixture(capacityFixturePath);
    const plan = fixture(resurrectionFixturePath);
    plan.capsule.verifiedFacts[0].statement = 'The predecessor might still be running';

    const result = validateResurrectionPlan(plan, { capacityEvidence: capacity });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/^capsule digest mismatch; expected sha256:/),
    ]));
  });

  test('the signature receipt binds the exact signature material', async () => {
    const { validateResurrectionPlan } = await validators();
    const capacity = fixture(capacityFixturePath);
    const plan = fixture(resurrectionFixturePath);
    plan.capsule.signer.signature = 'different-demo-signature';

    const result = validateResurrectionPlan(plan, { capacityEvidence: capacity });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('signature receipt must bind the exact signature bytes');
    expect(result.errors).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/^capsule digest mismatch/),
    ]));
  });

  test('the signature receipt cannot point at a different capsule digest', async () => {
    const { validateResurrectionPlan } = await validators();
    const capacity = fixture(capacityFixturePath);
    const plan = fixture(resurrectionFixturePath);
    plan.capsule.signatureVerificationReceipt.capsuleDigest =
      'sha256:0000000000000000000000000000000000000000000000000000000000000000';

    const result = validateResurrectionPlan(plan, { capacityEvidence: capacity });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('signature receipt must bind the capsule digest');
  });

  test('native-resume mode cannot hide under a weaker rebodiment verdict', async () => {
    const { validateResurrectionPlan } = await validators();
    const capacity = fixture(capacityFixturePath);
    const plan = fixture(resurrectionFixturePath);
    plan.destination.mode = 'native-resume';

    const result = validateResurrectionPlan(plan, { capacityEvidence: capacity });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('/verdict must be equal to constant'),
      'native-resume mode and NATIVE_RESUME_ELIGIBLE verdict must be equivalent',
      'native resume requires native-session lease',
      'native-session lease must be exclusive',
      'native-session lease requires a receipt',
    ]));
  });

  test('the supplied unsafe-ready fixture remains a meaningful fail-closed example', async () => {
    const { validateResurrectionPlan } = await validators();
    const capacity = fixture(unknownCapacityFixturePath);
    const plan = fixture(unsafeResurrectionFixturePath);

    const result = validateResurrectionPlan(plan, { capacityEvidence: capacity });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'capacity evidence execution class must match the proposed body',
      'ready verdict requires halt state inactive',
      'ready verdict forbids ambiguous effects',
      'ready verdict requires admissible capacity evidence',
    ]));
  });
});
