import { describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const corpus = JSON.parse(readFileSync(resolve(repoRoot, 'whitepaper/corpus.json'), 'utf8'));

describe('proof-estate corpus manifest', () => {
  test('the checker accepts the current manifest against the current (unmoved) layout', () => {
    const stdout = execFileSync(process.execPath, ['scripts/check-whitepaper-corpus.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(stdout).toContain('Proof-estate manifest check passed');
  });

  test('forbiddenLegacyRoots is opt-in and off, because this branch performed no relocation', () => {
    expect(corpus.forbiddenLegacyRoots.enabled).toBe(false);
    expect(corpus.forbiddenLegacyRoots.reason.length).toBeGreaterThan(0);
    // analyses/ and proofs/ are exactly the roots the origin branch this was
    // recovered from would have forbidden -- confirm they're real and
    // populated on this branch, not accidentally already forbidden.
    expect(corpus.forbiddenLegacyRoots.roots).not.toEqual(
      expect.arrayContaining(['analyses', 'proofs', 'docs/adr/models']),
    );
  });

  test('every artifact is WIRED (names a real job) or RETIRED (names a reason) -- no third state', () => {
    for (const artifact of [...corpus.formalArtifacts, ...corpus.researchProgramArtifacts]) {
      expect(['wired', 'retired']).toContain(artifact.ci.status);
      if (artifact.ci.status === 'wired') {
        expect(Array.isArray(artifact.ci.job)).toBe(true);
        expect(artifact.ci.job.length).toBeGreaterThan(0);
      } else {
        expect(typeof artifact.ci.reason).toBe('string');
        expect(artifact.ci.reason.length).toBeGreaterThan(0);
      }
    }
  });

  test('the three Kani harnesses are registered and wired to kani-harbor-card', () => {
    const kaniEntries = corpus.formalArtifacts.filter((a) => a.method === 'Kani');
    expect(kaniEntries).toHaveLength(3);
    const harnessNames = kaniEntries.map((a) => a.harnessName).sort();
    expect(harnessNames).toEqual([
      'proof_capability_attenuation',
      'proof_constant_time_behavior',
      'proof_verify_logic_only',
    ]);
    for (const entry of kaniEntries) {
      expect(entry.paths).toEqual(['core/harbor-card-rs/src/lib.rs']);
      expect(entry.ci).toEqual({ status: 'wired', job: ['kani-harbor-card'] });
    }
  });

  test('every relay TLA+ model and config is wired to its CI job', () => {
    const cardRevocation = corpus.formalArtifacts.find((a) => a.id === 'relay-card-revocation-tla');
    expect(cardRevocation.paths.sort()).toEqual([
      'proofs/relay/CardRevocation.tla',
      'proofs/relay/CardRevocation_baseline.cfg',
      'proofs/relay/CardRevocation_epoch.cfg',
      'proofs/relay/CardRevocation_rollback.cfg',
    ].sort());
    expect(cardRevocation.ci).toEqual({ status: 'wired', job: ['tla-relay-card-revocation'] });

    const webhookDelivery = corpus.formalArtifacts.find((a) => a.id === 'relay-webhook-delivery-tla');
    expect(webhookDelivery.paths.sort()).toEqual([
      'proofs/relay/WebhookDelivery.tla',
      'proofs/relay/WebhookDelivery.cfg',
      'proofs/relay/WebhookDelivery_vuln.cfg',
    ].sort());
    expect(webhookDelivery.ci).toEqual({ status: 'wired', job: ['tla-relay-webhook-delivery'] });
  });

  test('every ProVerif model under analyses/, proofs/**, docs/adr/models/ is wired to proverif-estate', () => {
    const wiredProverifEntries = corpus.formalArtifacts.filter(
      (a) => a.method === 'ProVerif' && a.ci.status === 'wired',
    );
    expect(wiredProverifEntries).toHaveLength(25);
    for (const entry of wiredProverifEntries) {
      expect(entry.ci).toEqual({ status: 'wired', job: ['proverif-estate'] });
    }
    // The one ProVerif-method entry that is NOT wired is the skill teaching
    // template, covered by its own dedicated test below.
    const retiredProverifEntries = corpus.formalArtifacts.filter(
      (a) => a.method === 'ProVerif' && a.ci.status === 'retired',
    );
    expect(retiredProverifEntries).toHaveLength(1);
  });

  test('the skill teaching template is explicitly RETIRED, not silently unregistered', () => {
    const template = corpus.formalArtifacts.find(
      (a) => a.paths[0] === 'skills/pd-relay-zero-trust/templates/proverif-relay.pv',
    );
    expect(template).toBeDefined();
    expect(template.ci.status).toBe('retired');
  });

  test('EasyCrypt binding.ec is RETIRED with its partial-proof caveat in evidencePolicy', () => {
    const easycrypt = corpus.formalArtifacts.find((a) => a.method === 'EasyCrypt');
    expect(easycrypt.status).toBe('partial');
    expect(easycrypt.ci.status).toBe('retired');
    expect(easycrypt.evidencePolicy).toMatch(/admit/);
  });

  test('the 19 harbor-results R-scripts are one wired research-program entry', () => {
    const rScripts = corpus.researchProgramArtifacts.find((a) => a.id === 'harbor-results-r-scripts');
    expect(rScripts.paths).toHaveLength(19);
    expect(rScripts.ci).toEqual({ status: 'wired', job: ['harbor-results-estate'] });
  });

  test('only threat-bands.mjs is wired; the other three Monte Carlo scripts are retired', () => {
    const monteCarlo = corpus.researchProgramArtifacts.filter((a) => a.paths[0].endsWith('.mjs'));
    expect(monteCarlo).toHaveLength(4);
    const wired = monteCarlo.filter((a) => a.ci.status === 'wired');
    const retired = monteCarlo.filter((a) => a.ci.status === 'retired');
    expect(wired.map((a) => a.paths[0])).toEqual(['proofs/bonded/pareto/threat-bands.mjs']);
    expect(retired).toHaveLength(3);
  });
});
