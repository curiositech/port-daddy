import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url));

function readConfig(name: string): string {
  return readFileSync(`${APP_ROOT}/${name}`, 'utf8');
}

function consumerBlock(config: string, queue: string): string {
  const blocks = config.split('[[queues.consumers]]').slice(1);
  const block = blocks.find((candidate) => new RegExp(`^\\s*queue\\s*=\\s*"${queue}"`, 'm').test(candidate));
  expect(block, `missing ${queue} consumer`).toBeDefined();
  return block!;
}

describe.each(['wrangler.deploy.toml', 'wrangler.toml.example'])('%s queue contract', (name) => {
  it('serializes main deliveries across batches and Worker invocations', () => {
    const main = consumerBlock(readConfig(name), 'fleet-runs');
    expect(main).toMatch(/^\s*max_batch_size\s*=\s*1\s*$/m);
    expect(main).toMatch(/^\s*max_concurrency\s*=\s*1\s*$/m);
    expect(main).toMatch(/^\s*dead_letter_queue\s*=\s*"fleet-runs-dlq"\s*$/m);

    const gates = consumerBlock(readConfig(name), 'fleet-gates');
    expect(gates).toMatch(/^\s*max_batch_size\s*=\s*1\s*$/m);
    expect(gates).toMatch(/^\s*max_concurrency\s*=\s*1\s*$/m);
    expect(gates).toMatch(/^\s*dead_letter_queue\s*=\s*"fleet-runs-dlq"\s*$/m);
  });

  it('binds the DLQ to the Worker that completes abandoned checks', () => {
    const dlq = consumerBlock(readConfig(name), 'fleet-runs-dlq');
    expect(dlq).toMatch(/^\s*max_retries\s*=\s*1\s*$/m);
  });
});

describe('production sandbox rollout boundary', () => {
  it('keeps the beta container binding disabled until the deploy token and application are provisioned', () => {
    const config = readConfig('wrangler.deploy.toml');
    expect(config).not.toMatch(/^\s*\[\[containers\]\]/m);
    expect(config).not.toMatch(/^\s*name\s*=\s*"SANDBOX"\s*$/m);
  });
});
