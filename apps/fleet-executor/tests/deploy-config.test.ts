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
  });

  it('binds the DLQ to the Worker that completes abandoned checks', () => {
    const dlq = consumerBlock(readConfig(name), 'fleet-runs-dlq');
    expect(dlq).toMatch(/^\s*max_retries\s*=\s*1\s*$/m);
  });

  it('raises the CPU ceiling above the 30s default a fleet run cannot fit in', () => {
    // Exceeding the CPU budget TERMINATES the invocation: index.ts's catch
    // never runs, the message is never acked, and the platform redelivers it
    // until it dead-letters. That failure is invisible from inside the Worker,
    // so the only defence is not hitting the ceiling — pin it here rather than
    // letting a config edit silently restore the default.
    const config = readConfig(name);
    const limits = config.split(/^\[limits\]\s*$/m)[1];
    expect(limits, 'missing [limits] block').toBeDefined();
    const cpuMs = Number(/^\s*cpu_ms\s*=\s*(\d+)\s*$/m.exec(limits!)?.[1]);
    expect(cpuMs).toBe(300_000);
  });
});
