import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, test } from '@jest/globals';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const SEED = ['98', '76'].join('');

const ROOT_FILES = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'WS0-DB-CONSOLIDATION-VERIFICATION-CHECKLIST.md',
  'pd-fleet-personal.example.yml',
];

const ACTIVE_ROOTS = [
  'docs/agents',
  'docs/operations',
  'docs/operator',
  'fleet/ships',
  'templates',
  'skills/port-daddy-agent-skill',
  'skills/port-daddy-internal-dev',
  '.agents/skills/port-daddy-agent-skill',
  '.agents/skills/port-daddy-internal-dev',
  '.claude/skills/port-daddy-agent-skill',
  '.claude/skills/port-daddy-internal-dev',
  '.codex/skills/port-daddy-agent-skill',
  '.codex/skills/port-daddy-internal-dev',
  '.gemini/extensions/port-daddy/skills/port-daddy-agent-skill',
  '.gemini/extensions/port-daddy/skills/port-daddy-internal-dev',
];

const TEXT_EXTENSIONS = new Set(['.json', '.md', '.sh', '.yaml', '.yml']);
const FORBIDDEN = [
  { label: 'fixed preferred daemon endpoint', pattern: new RegExp(`(?:localhost|127\\.0\\.0\\.1):${SEED}|:${SEED}\\b`) },
  { label: 'retired standalone launchd label', pattern: /com\.portdaddy\.daemon/ },
  { label: 'deleted source-stable promotion script', pattern: /scripts\/promote-stable\.sh/ },
  { label: 'retired spawn process-kill verb', pattern: /pd spawn kill\b/ },
  { label: 'npm-backed TypeScript runner', pattern: /\bnpx tsx\b/ },
];

function* walk(absolutePath) {
  if (!existsSync(absolutePath)) return;
  if (!statSync(absolutePath).isDirectory()) {
    yield absolutePath;
    return;
  }
  for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
    const child = join(absolutePath, entry.name);
    if (entry.isDirectory()) yield* walk(child);
    else if (TEXT_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) yield child;
  }
}

function activeGuidanceFiles() {
  return [
    ...ROOT_FILES.map((name) => resolve(REPO_ROOT, name)),
    ...ACTIVE_ROOTS.flatMap((name) => [...walk(resolve(REPO_ROOT, name))]),
  ].filter(existsSync);
}

describe('active guidance runtime hygiene', () => {
  test.each(FORBIDDEN)('contains no $label', ({ pattern }) => {
    const offenders = [];
    for (const filename of activeGuidanceFiles()) {
      const lines = readFileSync(filename, 'utf8').split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        if (pattern.test(lines[index])) {
          offenders.push(`${relative(REPO_ROOT, filename)}:${index + 1}: ${lines[index].trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
