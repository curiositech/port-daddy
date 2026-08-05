import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const retiredContracts = [
  {
    file: 'lib/spawner.ts',
    patterns: [
      /spec\.timeout\b/,
      /Pick<SpawnSpec, 'deadlineMs' \| 'timeout'>/,
      /timeoutMs:\s*resolveTransportTimeoutMs\(spec\)/,
      /transportTimeoutMs:\s*resolveTransportTimeoutMs\(spec\)/,
    ],
  },
  {
    file: 'lib/client.ts',
    patterns: [/Legacy alias for `deadlineMs`/, /\n\s*timeout\?: number;\n\s*allowedTools/],
  },
  {
    file: 'cli/commands/spawn.ts',
    patterns: [/: options\.timeout != null/],
  },
  {
    file: 'cli/commands/sortie.ts',
    patterns: [/options\.timeout != null/],
  },
  {
    file: 'cli/commands/fleet.ts',
    patterns: [/agent\.deadlineMs \?\? agent\.timeout/],
  },
  {
    file: 'lib/fleet/conductor.ts',
    patterns: [/intent\.timeoutMs\b/, /\n\s*timeoutMs\?: number;/],
  },
  {
    file: 'lib/tube-spawner-router.ts',
    patterns: [/cmd\.timeout\b/, /maxTimeoutMs/, /Legacy alias/],
  },
  {
    file: 'scripts/tube-spawn-router.ts',
    patterns: [/max-timeout-ms/],
  },
  {
    file: 'fleet-config-ui/src/types.ts',
    patterns: [/\n\s*timeout\?: number;\n\s*allowedTools/],
  },
  {
    file: 'fleet-config-ui/src/api.ts',
    patterns: [/opts\.timeout\b/, /Legacy alias for `deadlineMs`/],
  },
  {
    file: 'routes/spawn.ts',
    patterns: [/typeof timeout === 'number'/],
  },
  {
    file: 'routes/sorties.ts',
    patterns: [/body\.timeout\b/],
  },
  {
    file: 'lib/fleet-engine.ts',
    patterns: [/agent\.timeout\b/, /\n\s*timeout\?: number;\n\s*allowedTools/],
  },
  {
    file: 'lib/fleet-ast.ts',
    patterns: [/gInt\(m, 'timeout'/, /\n\s*timeout\?:\s+IntNode;/],
  },
  {
    file: 'lib/orchestrator.ts',
    patterns: [/spec\.timeout\b/],
  },
  {
    file: 'routes/memory.ts',
    patterns: [/body\.timeoutMs\b/, /\n\s*timeoutMs\?: unknown;/],
  },
  {
    file: 'pd-fleet.yml',
    patterns: [/^\s+timeout:\s*\d+/m],
  },
];

describe('retired spawn timeout contract', () => {
  test.each(retiredContracts)('$file contains no task-timeout compatibility path', ({ file, patterns }) => {
    const source = readFileSync(join(ROOT, file), 'utf8');
    for (const pattern of patterns) expect(source).not.toMatch(pattern);
  });
});
