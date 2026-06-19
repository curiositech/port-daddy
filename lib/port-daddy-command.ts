import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PortDaddyInvocation {
  command: string;
  args: string[];
}

function sourceRootCandidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    join(here, '..', 'bin', 'port-daddy-cli.js'),
    join(here, '..', '..', 'bin', 'port-daddy-cli.js'),
  ];
}

export function resolvePortDaddyInvocation(): PortDaddyInvocation {
  const override = process.env.PORT_DADDY_CLI || process.env.PD_CLI;
  if (override && override.trim()) return { command: override.trim(), args: [] };

  for (const candidate of sourceRootCandidates()) {
    if (existsSync(candidate)) {
      return { command: process.execPath, args: [candidate] };
    }
  }

  return { command: 'pd', args: [] };
}

export function quoteShellArg(value: string): string {
  return JSON.stringify(value);
}

export function buildPortDaddyShellCommand(args: string[]): string {
  const invocation = resolvePortDaddyInvocation();
  return [invocation.command, ...invocation.args, ...args].map(quoteShellArg).join(' ');
}
