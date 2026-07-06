/**
 * `pd work` — the Work Intent command family (ADR-0095 fork 4: WorkIntent is
 * the sole runtime launch primitive; legacy verbs survive as intake metadata).
 *
 * First landing: `pd work probe` — the adapter conformance probe surface from
 * binder ch18 Work Order C2. It runs the daemon-witnessed compliance ladder
 * (C0..C6) plus the five required negative probes (forged-level,
 * direct-mcp-bypass, disabled-hook-after-launch, forged-heartbeat,
 * observed-to-controlled) against the executable adapter fixtures, and prints
 * which bodies would be compliant, weak, observed, or unmanaged.
 *
 * `pd work matrix` prints the adapter capability matrix (mechanical ceilings).
 *
 * `pd work start` (launching real WorkIntents) is a later slice; this command
 * refuses launch-shaped forms and points at `pd spawn` until that lands —
 * per the fork-4 rule that no new verb may own runtime state prematurely.
 */
import type { CLIOptions } from '../types.js';
import {
  runWorkProbe,
  capabilityMatrixRows,
  WorkProbeUsageError,
} from '../../lib/agent-harbor/probe-surface.js';

function usage(): void {
  console.log(`Usage: pd work <subcommand>

Subcommands:
  probe [--adapter <kind>] [--profile <profile>] [--json]
      Run the adapter conformance probe suite (binder ch18 C2).
      kinds:    claude-code codex-cli cloudflare ollama lmstudio custom-stdio custom-http
      profiles: compliant weak broken malicious   (default: all)
  matrix [--json]
      Print the adapter capability matrix (mechanical ceilings; probes decide actuals).

Launching work is not this subcommand yet — use pd spawn until pd work start lands (ADR-0095 §7).`);
}

export async function handleWork(args: string[], options: CLIOptions): Promise<void> {
  const sub = args[0];
  const asJson = options.json || options.j;

  if (!sub || sub === 'help') {
    usage();
    return;
  }

  if (sub === 'matrix') {
    const rows = capabilityMatrixRows();
    if (asJson) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    console.log('Adapter capability matrix (mechanical ceilings — a probe grants at or below, never above):');
    for (const row of rows) {
      console.log(
        `  ${row.kind.padEnd(13)} ceiling ${row.complianceCeiling}/${row.transcriptFidelityCeiling}  `
        + `launch ${row.defaultLaunchMode.padEnd(8)} tiers ${row.modelTiers}`,
      );
    }
    return;
  }

  if (sub === 'probe') {
    const opts = options as CLIOptions & { adapter?: string; profile?: string };
    try {
      const report = await runWorkProbe({
        adapterKind: opts.adapter,
        profile: opts.profile,
      });
      if (asJson) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      console.log(`Conformance probe run at ${report.probedAt} (${report.runs.length} probes):`);
      for (const line of report.summary) console.log(`  ${line}`);
      const uncaught = report.runs.flatMap(({ result }) =>
        result.negativeProbes.filter((p) => p.fired === true && p.downgraded !== true),
      );
      if (uncaught.length > 0) {
        console.error(`FAIL: ${uncaught.length} fired negative probe(s) were not downgraded — the bypass works.`);
        process.exit(1);
      }
      console.log('All fired negative probes were downgraded; forged compliance cannot ship a badge.');
    } catch (error) {
      if (error instanceof WorkProbeUsageError) {
        console.error(error.message);
        process.exit(1);
      }
      throw error;
    }
    return;
  }

  if (sub === 'start' || sub === 'plan') {
    console.error(
      `pd work ${sub} has not landed yet — launching still goes through pd spawn `
      + '(which will become a WorkIntent alias per ADR-0095 §7). This surface refuses to own runtime state early.',
    );
    process.exit(1);
  }

  console.error(`Unknown pd work subcommand: ${sub}`);
  usage();
  process.exit(1);
}
