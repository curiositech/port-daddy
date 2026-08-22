import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseFleetShips } from '../src/fleet.js';

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

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

  it('keeps bounded retry headroom in the deploy and operator example configs', () => {
    const main = consumerBlock(readConfig(name), 'fleet-runs');
    const maxRetries = Number(/^\s*max_retries\s*=\s*(\d+)\s*$/m.exec(main)?.[1]);
    const fleetYaml = readFileSync(`${REPO_ROOT}/pd-fleet.yml`, 'utf8');
    const prShips = parseFleetShips(fleetYaml, 'pull_request:opened');

    expect(prShips, 'repository PR fleet must parse').not.toBeNull();
    // max_retries excludes the first delivery. Even if the platform ends each
    // invocation immediately after one durable ship checkpoint, the retry
    // budget must cover the current roster and two transient no-progress runs.
    expect(maxRetries + 1).toBeGreaterThanOrEqual(prShips!.length + 2);
    expect(maxRetries).toBe(12);
  });

  it('isolates deterministic merge-group gates from substantive review latency', () => {
    const gates = consumerBlock(readConfig(name), 'fleet-gates');
    expect(gates).toMatch(/^\s*max_batch_size\s*=\s*1\s*$/m);
    expect(gates).toMatch(/^\s*max_concurrency\s*=\s*1\s*$/m);
    expect(gates).toMatch(/^\s*max_batch_timeout\s*=\s*5\s*$/m);
    expect(gates).toMatch(/^\s*dead_letter_queue\s*=\s*"fleet-runs-dlq"\s*$/m);
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

  it('keeps production delivery diagnostics queryable', () => {
    const config = readConfig(name);
    const observability = config.split(/^\[observability\]\s*$/m)[1];
    expect(observability, 'missing [observability] block').toBeDefined();
    expect(observability).toMatch(/^\s*enabled\s*=\s*true\s*$/m);
  });
});
