/**
 * Deploy-config contract tests for apps/relay/wrangler.deploy.toml.
 *
 * Motivation: wrangler environments INHERIT top-level configuration, and the
 * inheritance that matters most here is `routes` — which carries the custom
 * domain relay.portdaddy.dev. An `[env.latest]` block that does not override it
 * makes `wrangler deploy --env latest` reassign PRODUCTION's domain to the
 * staging Worker. Wrangler only warns about this, in a line easy to lose in CI
 * logs, and the damage happens at deploy time where no unit test would normally
 * look. So the guardrail is asserted here, in the cheapest place that fails
 * before a merge rather than after a domain hijack.
 *
 * Mirrors the existing contract-test idiom in
 * apps/fleet-executor/tests/deploy-config.test.ts: parse the committed TOML as
 * text and assert the invariants that CI actually ships.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONFIG = readFileSync(`${APP_ROOT}/wrangler.deploy.toml`, 'utf8');
const GITHUB_APP_MANIFEST = JSON.parse(
  readFileSync(`${APP_ROOT}/../github-app-fleet/manifest.json`, 'utf8')
) as {
  default_events?: string[];
  default_permissions?: Record<string, string>;
};

/**
 * Everything from a section header to the next top-level `[` header.
 *
 * @param header exact section header text, e.g. `[env.latest]`
 * @returns the section body, or '' when the section is absent
 */
function section(header: string): string {
  const start = CONFIG.indexOf(`\n${header}`);
  if (start === -1) return '';
  const rest = CONFIG.slice(start + header.length + 1);
  const next = rest.search(/\n\[[a-z]/);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * Find one committed queue producer block by header and binding name.
 *
 * @param header exact TOML array header, including brackets
 * @param binding queue binding expected inside the block
 * @returns the matching producer block, or '' when it is absent
 */
function producerBlock(header: string, binding: string): string {
  const blocks = CONFIG.split(header).slice(1);
  return blocks.find((candidate) =>
    new RegExp(`^\\s*binding\\s*=\\s*"${binding}"`, 'm').test(candidate)
  ) ?? '';
}

describe('wrangler.deploy.toml — release-channel domain safety (ADR-0119)', () => {
  it('prod owns the branded custom domain', () => {
    // The top-level block IS prod; the domain lives there and nowhere else.
    expect(CONFIG).toMatch(/pattern\s*=\s*"relay\.portdaddy\.dev"/);
    expect(CONFIG).toMatch(/custom_domain\s*=\s*true/);
  });

  it('the latest channel overrides routes to empty so it can never hijack prod', () => {
    const latest = section('[env.latest]');
    expect(latest, 'missing [env.latest] block').not.toBe('');
    // Without this line the environment inherits prod's `routes` — the whole
    // point of the assertion. An empty array is the ONLY acceptable value:
    // staging lives on its *.workers.dev URL and owns no domain.
    expect(latest).toMatch(/^routes\s*=\s*\[\s*\]\s*$/m);
  });

  it('no environment other than prod declares the production hostname', () => {
    // A route could also be smuggled in as [[env.latest.routes]] or by naming
    // the domain inside the latest block; neither may mention prod's hostname.
    // Comments are stripped first: the block deliberately NAMES the domain in
    // prose to explain why the override exists, and prose is not config.
    const latestConfig = section('[env.latest]')
      .split('\n')
      .filter(line => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(latestConfig).not.toContain('relay.portdaddy.dev');
    expect(CONFIG).not.toMatch(/\[\[env\.[a-z]+\.routes\]\]/);
  });

  it('the two channels bind DIFFERENT D1 databases', () => {
    // Staging must never write production data; a copy-pasted database_id is
    // the easy mistake this catches.
    const ids = [...CONFIG.matchAll(/database_id\s*=\s*"([0-9a-f-]+)"/g)].map(m => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ids).size, `duplicate database_id across channels: ${ids.join(', ')}`).toBe(ids.length);
  });

  it('the latest channel keeps its own worker name', () => {
    expect(section('[env.latest]')).toMatch(/name\s*=\s*"relay-latest"/);
  });

  it('keeps deterministic merge-group gates off the substantive review queues', () => {
    const prod = producerBlock('[[queues.producers]]', 'FLEET_GATES');
    const latest = producerBlock('[[env.latest.queues.producers]]', 'FLEET_GATES');
    expect(prod, 'missing production FLEET_GATES producer').toMatch(
      /^\s*queue\s*=\s*"fleet-gates"\s*$/m
    );
    expect(latest, 'missing staging FLEET_GATES producer').toMatch(
      /^\s*queue\s*=\s*"fleet-gates-staging"\s*$/m
    );
  });

  it('keeps the GitHub App subscribed and permitted for merge-group delivery', () => {
    expect(GITHUB_APP_MANIFEST.default_events).toContain('merge_group');
    expect(['read', 'write']).toContain(
      GITHUB_APP_MANIFEST.default_permissions?.merge_queues
    );
  });
});
