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
  it('isolates main deliveries so one long review cannot block newer heads', () => {
    const main = consumerBlock(readConfig(name), 'fleet-runs');
    expect(main).toMatch(/^\s*max_batch_size\s*=\s*1\s*$/m);
    expect(main).toMatch(/^\s*dead_letter_queue\s*=\s*"fleet-runs-dlq"\s*$/m);
  });

  it('binds the DLQ to the Worker that completes abandoned checks', () => {
    const dlq = consumerBlock(readConfig(name), 'fleet-runs-dlq');
    expect(dlq).toMatch(/^\s*max_retries\s*=\s*1\s*$/m);
  });
});
