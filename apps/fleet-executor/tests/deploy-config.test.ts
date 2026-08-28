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

function producerBlock(config: string, binding: string): string {
  const blocks = config.split('[[queues.producers]]').slice(1);
  const block = blocks.find((candidate) =>
    new RegExp(`^\\s*binding\\s*=\\s*"${binding}"`, 'm').test(candidate)
  );
  expect(block, `missing ${binding} producer`).toBeDefined();
  return block!;
}

describe.each(['wrangler.deploy.toml', 'wrangler.toml.example'])('%s queue contract', (name) => {
  it('keeps main-delivery throughput globally bounded without serializing every review', () => {
    const main = consumerBlock(readConfig(name), 'fleet-runs');
    expect(main).toMatch(/^\s*max_batch_size\s*=\s*1\s*$/m);
    expect(main).toMatch(/^\s*max_concurrency\s*=\s*3\s*$/m);
    expect(main).toMatch(/^\s*dead_letter_queue\s*=\s*"fleet-runs-dlq"\s*$/m);
  });

  it('binds the DLQ to the Worker that completes abandoned checks', () => {
    const dlq = consumerBlock(readConfig(name), 'fleet-runs-dlq');
    expect(dlq).toMatch(/^\s*max_retries\s*=\s*1\s*$/m);
  });

  it('routes explicit continuation messages to an isolated consumer pool', () => {
    const continuation = producerBlock(readConfig(name), 'FLEET_CONTINUATIONS');
    expect(continuation).toMatch(/^\s*queue\s*=\s*"fleet-continuations"\s*$/m);

    const consumer = consumerBlock(readConfig(name), 'fleet-continuations');
    expect(consumer).toMatch(/^\s*max_batch_size\s*=\s*1\s*$/m);
    expect(consumer).toMatch(/^\s*max_concurrency\s*=\s*1\s*$/m);
    expect(consumer).toMatch(/^\s*max_batch_timeout\s*=\s*5\s*$/m);
    expect(consumer).toMatch(/^\s*max_retries\s*=\s*3\s*$/m);
    expect(consumer).toMatch(/^\s*dead_letter_queue\s*=\s*"fleet-runs-dlq"\s*$/m);
  });

  it('bounds true delivery failures independently of the ship roster', () => {
    const main = consumerBlock(readConfig(name), 'fleet-runs');
    const maxRetries = Number(/^\s*max_retries\s*=\s*(\d+)\s*$/m.exec(main)?.[1]);

    // Successful checkpoints are new messages, so this counter once again
    // means only infrastructure failure. Three retries preserve the provider
    // circuit's bounded probes without letting one poison delivery monopolize
    // the serialized consumer through a roster-sized retry budget.
    expect(maxRetries).toBe(3);
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

  it('binds Fleet to Relay for per-run coordination grants without a static macaroon', () => {
    const config = readConfig(name);
    const services = config.split('[[services]]').slice(1);
    const grants = services.find(block => /^\s*binding\s*=\s*"COORDINATION_GRANTS"/m.test(block));
    expect(grants, 'missing COORDINATION_GRANTS service binding').toBeDefined();
    expect(grants).toMatch(/^\s*service\s*=\s*"port-daddy-relay"\s*$/m);
    expect(grants).toMatch(/^\s*entrypoint\s*=\s*"CoordinationGrantService"\s*$/m);
    expect(config).toMatch(/^\s*PORT_DADDY_COORDINATION_URL\s*=\s*"https:\/\/relay\.portdaddy\.dev"\s*$/m);
    expect(config).not.toContain('PORT_DADDY_COORDINATION_PROJECT');
    expect(config).not.toContain('PORT_DADDY_COORDINATION_ACTOR');
    expect(config).not.toContain('PORT_DADDY_COORDINATION_MACAROON');
  });
});
