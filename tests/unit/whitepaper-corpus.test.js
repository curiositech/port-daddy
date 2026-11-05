import { describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const repoRoot = process.cwd();
const corpus = JSON.parse(readFileSync(resolve(repoRoot, 'book/corpus.json'), 'utf8'));

describe('proof-estate corpus manifest', () => {
  test('the checker accepts the current manifest against the current (unmoved) layout', () => {
    const stdout = execFileSync(process.execPath, ['scripts/check-whitepaper-corpus.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(stdout).toContain('Proof-estate manifest check passed');
  });

  test('forbiddenLegacyRoots is opt-in and off, because the wholesale relocation never happened', () => {
    expect(corpus.forbiddenLegacyRoots.enabled).toBe(false);
    expect(corpus.forbiddenLegacyRoots.reason.length).toBeGreaterThan(0);
    // analyses/ and proofs/ are exactly the roots the origin branch this was
    // recovered from would have forbidden -- confirm they're real and
    // populated on this branch, not accidentally already forbidden.
    expect(corpus.forbiddenLegacyRoots.roots).not.toEqual(
      expect.arrayContaining(['analyses', 'proofs']),
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

  test('all six Kani harnesses are registered at their real source and CI lane', () => {
    const kaniEntries = corpus.formalArtifacts.filter((a) => a.method === 'Kani');
    const expectedSources = {
      proof_capability_attenuation: 'core/harbor-card-rs/src/kani_claims.rs',
      proof_constant_time_behavior: 'core/harbor-card-rs/src/lib.rs',
      proof_decoded_channel_authority: 'core/harbor-card-rs/src/kani_claims.rs',
      proof_decoded_claims_policy: 'core/harbor-card-rs/src/kani_claims.rs',
      proof_decoded_delegation_two_hops: 'core/harbor-card-rs/src/kani_claims.rs',
      proof_verify_logic_only: 'core/harbor-card-rs/src/lib.rs',
    };
    expect(kaniEntries.map((a) => a.harnessName).sort()).toEqual(Object.keys(expectedSources).sort());
    // Five bounded predicate/comparator harnesses run on PRs. The separate
    // stubbed parser lane is manual/on-demand and cannot witness acceptance.
    // A wired job records coverage of the estate, not a successful proof run.
    for (const entry of kaniEntries) {
      const job = entry.harnessName === 'proof_verify_logic_only'
        ? 'kani-harbor-card-parser' : 'kani-harbor-card';
      expect(entry.paths).toEqual([expectedSources[entry.harnessName]]);
      expect(entry.ci).toEqual({ status: 'wired', job: [job] });
    }
  });

  test('the Kani workflow actually selects every registered harness in its declared lane', () => {
    const workflow = parseYaml(readFileSync(resolve(repoRoot, '.github/workflows/proofs.yml'), 'utf8'));
    expect(workflow.on.pull_request.branches).toContain('main');
    for (const entry of corpus.formalArtifacts.filter((a) => a.method === 'Kani')) {
      const job = workflow.jobs[entry.ci.job[0]];
      expect(job).toBeDefined();
      const commands = job.steps.map((step) => step.run ?? '').join('\n');
      expect(commands).toMatch(new RegExp(`(?:^|\\s)--harness\\s+${entry.harnessName}(?=\\s|$)`, 'u'));
      if (entry.ci.job[0] !== 'kani-harbor-card-parser') {
        expect(commands).toContain('scripts/check-kani-log.py');
        expect(commands).toContain('scripts/check-kani-negative-controls.py');
      }
    }
  });

  test('the parser lane has a real manual trigger and cannot run on PRs or a schedule', () => {
    const workflow = parseYaml(readFileSync(resolve(repoRoot, '.github/workflows/proofs.yml'), 'utf8'));
    const checkManualParser = (candidate) => {
      expect(candidate.on).toHaveProperty('workflow_dispatch');
      expect(candidate.on).not.toHaveProperty('schedule');
      expect(candidate.jobs['kani-harbor-card-parser'].if)
        .toBe("github.event_name == 'workflow_dispatch'");
    };
    checkManualParser(workflow);
    const noTrigger = structuredClone(workflow);
    delete noTrigger.on.workflow_dispatch;
    expect(() => checkManualParser(noTrigger)).toThrow();
    const onPullRequest = structuredClone(workflow);
    onPullRequest.jobs['kani-harbor-card-parser'].if += " || github.event_name == 'pull_request'";
    expect(() => checkManualParser(onPullRequest)).toThrow();
    const recurring = structuredClone(workflow);
    recurring.on.schedule = [{ cron: '0 0 * * *' }];
    expect(() => checkManualParser(recurring)).toThrow();
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

  test('every ProVerif model under analyses/ and proofs/** is wired to proverif-estate', () => {
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

  test('the guidance-envelope pair lives under proofs/coordination and its twin stays a negative control', () => {
    const signed = corpus.formalArtifacts.find((a) => a.id === 'guidance-envelope-v0-proverif');
    const unsigned = corpus.formalArtifacts.find((a) => a.id === 'guidance-envelope-v0-unsigned-vuln-proverif');
    expect(signed.paths).toEqual(['proofs/coordination/guidance_envelope_v0.pv']);
    expect(unsigned.paths).toEqual(['proofs/coordination/guidance_envelope_v0_unsigned_vuln.pv']);
    // The unsigned twin is SUPPOSED to fail. It stays kind "negative-control"
    // and keeps a filename matching run-proverif.py's *_vuln*.pv glob, so the
    // runner asserts its queries still come back false. Flipping either would
    // turn a working negative control into a silently vacuous one.
    expect(unsigned.kind).toBe('negative-control');
    expect(unsigned.paths[0]).toMatch(/_vuln.*\.pv$/u);
    for (const entry of [signed, unsigned]) {
      expect(entry.ci).toEqual({ status: 'wired', job: ['proverif-estate'] });
    }
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

  test('the 22 harbor-results R-scripts are one wired research-program entry', () => {
    const rScripts = corpus.researchProgramArtifacts.find((a) => a.id === 'harbor-results-r-scripts');
    expect(rScripts.paths).toHaveLength(22);
    expect(rScripts.paths).toContain('skills/harbor-results/scripts/sheaf_repair_and_2complex.py');
    expect(rScripts.paths).toContain('skills/harbor-results/scripts/paper7_failure_cases.py');
    expect(rScripts.ci).toEqual({ status: 'wired', job: ['harbor-results-estate'] });
  });

  test('the CR4 contract test has its own wired research-program entry', () => {
    const cr4 = corpus.researchProgramArtifacts.find((a) => a.id === 'harbor-results-cr4-contract');
    expect(cr4.paths).toEqual(['skills/harbor-results/scripts/test_cr4_contract.py']);
    expect(cr4.ci).toEqual({ status: 'wired', job: ['harbor-results-estate'] });
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
