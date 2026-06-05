/**
 * lib/coast-guard/egress-meter-main.ts — standalone entry for the metering proxy.
 *
 * The spawner launches one of these per confined agent:
 *   node egress-meter-main.js <port> <maxRequests> <stateFile> [maxBytes] [brokerFile]
 *
 * It writes the live meter state to <stateFile> on each connection close so the
 * spawner can fold it into the agent's signed receipt. brokerFile (optional) is
 * a JSON map of { host: { header, value } } the proxy injects on plain-HTTP
 * requests — the secret-broker path. See egress-meter.ts for the threat model.
 *
 * NOTE: This is invoked with the daemon's runtime (tsx/bun via the spawner), not
 * compiled separately — it imports the shared EgressMeter so there is one source
 * of metering logic.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { EgressMeter, serializeState, type BrokerHostRule } from './egress-meter.js';

async function main(): Promise<void> {
  const [, , portArg, maxReqArg, stateFile, maxBytesArg, brokerFile] = process.argv;
  const port = Number(portArg);
  const maxRequests = Number(maxReqArg);
  if (!stateFile || !Number.isFinite(maxRequests)) {
    process.stderr.write('usage: egress-meter-main <port> <maxRequests> <stateFile> [maxBytes] [brokerFile]\n');
    process.exit(2);
    return;
  }

  let brokerRules: Record<string, BrokerHostRule> | undefined;
  if (brokerFile) {
    try {
      brokerRules = JSON.parse(readFileSync(brokerFile, 'utf-8'));
    } catch {
      brokerRules = undefined;
    }
  }

  const meter = new EgressMeter({
    maxRequests,
    maxBytes: maxBytesArg ? Number(maxBytesArg) : undefined,
    brokerRules,
  });
  await meter.listen(port);

  const flush = (): void => {
    try {
      writeFileSync(stateFile, serializeState(meter.state));
    } catch {
      /* state file may be on a torn-down tmp dir during shutdown */
    }
  };
  flush();
  const interval = setInterval(flush, 250);
  interval.unref?.();

  const shutdown = (): void => {
    flush();
    meter.dispose();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main();
