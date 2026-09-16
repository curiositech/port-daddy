// Shape guards for the Worker deploy workflows and the conditional
// pd-console release job. These are CI-config invariants a refactor can break
// silently (pd-qa findings on #9249): a deploy workflow that loses its paths
// filter deploys on every push; one that loses its concurrency group lets two
// pushes race the same Worker; a console-job step that loses its gate `if:`
// quietly reverts to rebuilding an unchanged console; and a committed
// wrangler.deploy.toml must never grow a plaintext credential.
import { describe, test, expect } from '@jest/globals';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

const workflow = name => parse(readFileSync(resolve('.github/workflows', name), 'utf8'));

// Every Worker with a COMMITTED deploy config must deploy from CI — that is
// the point of the committed file. email-ingress / github-app-receiver only
// ship wrangler.toml.example (config deliberately out-of-band), so they are
// exempt by construction.
const DEPLOYED_WORKERS = [
  { app: 'fleet-executor', file: 'deploy-fleet-executor.yml' },
  { app: 'steward', file: 'deploy-steward.yml' },
];

describe('worker deploy workflows', () => {
  test.each(DEPLOYED_WORKERS)('$app: paths filter, concurrency, fork guard, wrangler deploy', ({ app, file }) => {
    const wf = workflow(file);
    const push = wf.on?.push ?? wf[true]?.push; // yaml parses bare `on:` as boolean true
    expect(push.branches).toEqual(['main']);
    expect(push.paths).toContain(`apps/${app}/**`);
    expect(push.paths).toContain(`.github/workflows/${file}`);

    expect(wf.concurrency.group).toBe(file.replace('.yml', ''));
    expect(wf.concurrency['cancel-in-progress']).toBe(false);

    const deploy = wf.jobs.deploy;
    expect(deploy.if).toContain("github.repository == 'curiositech/port-daddy'");
    expect(deploy.defaults.run['working-directory']).toBe(`apps/${app}`);

    const deployStep = deploy.steps.find(s => /wrangler deploy/.test(s.run ?? ''));
    expect(deployStep).toBeDefined();
    expect(deployStep.run).toContain('--config wrangler.deploy.toml');
    // Credentials come from the secrets context only — never inline.
    expect(deployStep.env.CLOUDFLARE_API_TOKEN).toBe('${{ secrets.CLOUDFLARE_API_TOKEN }}');
    expect(deployStep.env.CLOUDFLARE_ACCOUNT_ID).toBe('${{ secrets.CLOUDFLARE_ACCOUNT_ID }}');
  });

  test('every app with a committed wrangler.deploy.toml has a deploy workflow', () => {
    // relay has its own two-stage deploy (deploy-relay / deploy-relay-prod);
    // this asserts nothing NEW grows a committed deploy config without CI
    // deploy automation, the drift this PR closed for the steward.
    const covered = new Set(['fleet-executor', 'steward', 'relay']);
    const appsDir = resolve('apps');
    for (const app of readdirSync(appsDir)) {
      if (existsSync(join(appsDir, app, 'wrangler.deploy.toml'))) {
        expect(covered).toContain(app);
      }
    }
  });
});

describe('committed wrangler.deploy.toml files carry no credentials', () => {
  // TOKEN(?!S\b) excludes a plural "...TOKENS" key (a count, e.g. a chat
  // budget) from the credential-shaped match, while still catching every
  // singular TOKEN key ("TOKEN=", "API_TOKEN=", "AUTH_TOKEN_VALUE=") and any
  // TOKEN that isn't immediately followed by a lone trailing "S".
  const SECRETY = /^(?!\s*#).*\b\w*(TOKEN(?!S\b)|SECRET|PASSWORD|PRIVATE_KEY|API_KEY)\w*\s*=/i;
  const appsDir = resolve('apps');
  const committed = readdirSync(appsDir)
    .map(app => join(appsDir, app, 'wrangler.deploy.toml'))
    .filter(p => existsSync(p));

  test.each(committed)('%s has no secret-shaped assignment outside comments', path => {
    const offenders = readFileSync(path, 'utf8')
      .split('\n')
      .filter(line => SECRETY.test(line));
    expect(offenders).toEqual([]);
  });
});

describe('release.yml conditional console job', () => {
  const wf = workflow('release.yml');
  const job = wf.jobs['build-pd-console-app'];

  test('every step after the gate is guarded by the gate output', () => {
    const names = job.steps.map(s => s.name ?? s.uses);
    const gateIdx = job.steps.findIndex(s => s.id === 'gate');
    expect(gateIdx).toBeGreaterThan(0);
    for (const step of job.steps.slice(gateIdx + 1)) {
      expect({ step: step.name ?? step.uses, if: step.if }).toEqual({
        step: step.name ?? step.uses,
        if: "steps.gate.outputs.build == 'true'",
      });
    }
    // The gate itself runs the unit-tested module, not re-inlined bash.
    expect(job.steps[gateIdx].run.trim()).toBe('node scripts/console-release-gate.mjs');
    // Checkout must fetch full history or the gate cannot see the previous tag.
    const checkout = job.steps.find(s => (s.uses ?? '').startsWith('actions/checkout'));
    expect(checkout.with['fetch-depth']).toBe(0);
    expect(names.length).toBeGreaterThanOrEqual(6);
  });

  test('force_console is a boolean workflow_dispatch input defaulting to false', () => {
    const inputs = (wf.on ?? wf[true]).workflow_dispatch.inputs;
    expect(inputs.force_console.type).toBe('boolean');
    expect(inputs.force_console.default).toBe(false);
    expect(inputs.force_console.required).toBe(false);
  });
});
