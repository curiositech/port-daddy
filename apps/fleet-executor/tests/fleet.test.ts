import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFleetShips, defaultPRShips } from '../src/fleet.js';

// The REAL pd-fleet.yml at the repo root (apps/fleet-executor/tests → ../../..).
const REAL_YAML = readFileSync(
  fileURLToPath(new URL('../../../pd-fleet.yml', import.meta.url)),
  'utf8',
);

describe('parseFleetShips — deterministic parse of the real pd-fleet.yml', () => {
  const ships = parseFleetShips(REAL_YAML, 'pull_request:opened');

  it('returns the full set of pull_request:opened ships (no 12KB truncation loss)', () => {
    expect(ships).not.toBeNull();
    const names = new Set(ships!.map(s => s.name));
    // These all declare `trigger: pull_request:opened` in pd-fleet.yml.
    expect(names.has('code-reviewer')).toBe(true);
    expect(names.has('qa')).toBe(true);
    expect(names.has('red-team')).toBe(true);
    expect(names.has('tautology-sniffer')).toBe(true);
    expect(names.has('test-author')).toBe(true);
  });

  it('every parsed ship has a non-empty prompt', () => {
    for (const s of ships!) {
      expect(s.prompt.trim().length).toBeGreaterThan(0);
    }
  });

  it('does NOT include deterministic-body ships (harbor-pilot has no prompt)', () => {
    const names = new Set(ships!.map(s => s.name));
    expect(names.has('harbor-pilot')).toBe(false);
  });

  it('does NOT include ships triggered on a different action (tenderfoot is pull_request:merged)', () => {
    const names = new Set(ships!.map(s => s.name));
    expect(names.has('tenderfoot')).toBe(false);
  });

  it('qa is a cloud-static reviewer (needsExecution=false despite Bash(npm test*))', () => {
    const qa = ships!.find(s => s.name === 'qa');
    expect(qa).toBeDefined();
    expect(qa!.needsExecution).toBe(false);
  });

  it('test-author needs execution (has non-gh Bash tools) → routes to GHA', () => {
    const ta = ships!.find(s => s.name === 'test-author');
    expect(ta).toBeDefined();
    expect(ta!.needsExecution).toBe(true);
  });

  it('derives cfModel from the first @cf/ fallback entry', () => {
    const reviewer = ships!.find(s => s.name === 'code-reviewer');
    expect(reviewer!.cfModel).toBe('@cf/qwen/qwen2.5-coder-32b-instruct');
    const qa = ships!.find(s => s.name === 'qa');
    expect(qa!.cfModel).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
  });
});

describe('parseFleetShips — model derivation + blocking coercion', () => {
  const yaml = (body: string) => `fleet:\n  agents:\n${body}\n`;

  it('falls back to the coder model for reviewer-named ships with no @cf/ fallback', () => {
    const ships = parseFleetShips(
      yaml(
        [
          '    my-reviewer:',
          '      trigger: pull_request:opened',
          '      fallbacks:',
          '        - backend: openai',
          '          model: gpt-5-mini',
          '      prompt: |',
          '        review.',
        ].join('\n'),
      ),
      'pull_request:opened',
    );
    expect(ships![0].cfModel).toBe('@cf/qwen/qwen2.5-coder-32b-instruct');
  });

  it('falls back to the general model for non-reviewer ships with no @cf/ fallback', () => {
    const ships = parseFleetShips(
      yaml(
        ['    sniffer:', '      trigger: pull_request:opened', '      prompt: |', '        sniff.'].join(
          '\n',
        ),
      ),
      'pull_request:opened',
    );
    expect(ships![0].cfModel).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
  });

  it('coerces blocking: only a real true / "true" opts into the gate', () => {
    const ships = parseFleetShips(
      yaml(
        [
          '    a:',
          '      trigger: pull_request:opened',
          '      blocking: true',
          '      prompt: |',
          '        a.',
          '    b:',
          '      trigger: pull_request:opened',
          '      blocking: yes',
          '      prompt: |',
          '        b.',
          '    c:',
          '      trigger: pull_request:opened',
          '      prompt: |',
          '        c.',
        ].join('\n'),
      ),
      'pull_request:opened',
    );
    const byName = Object.fromEntries(ships!.map(s => [s.name, s.blocking]));
    expect(byName.a).toBe(true);
    expect(byName.b).toBe(false); // YAML `yes` is not an opt-in (fail-safe)
    expect(byName.c).toBe(false); // absent → false
  });

  it('returns null for unparseable or empty docs (caller falls back to defaults)', () => {
    expect(parseFleetShips(':::not yaml:::\n  - [', 'pull_request:opened')).toBeNull();
    expect(parseFleetShips('fleet:\n', 'pull_request:opened')).toBeNull();
    expect(parseFleetShips('fleet:\n  agents:\n    x:\n      trigger: push\n      prompt: |\n        x.\n', 'pull_request:opened')).toBeNull();
  });
});

describe('defaultPRShips fallback', () => {
  it('returns real ships with non-empty prompts (code-reviewer + qa present)', () => {
    const ships = defaultPRShips();
    const names = new Set(ships.map(s => s.name));
    expect(names.has('code-reviewer')).toBe(true);
    expect(names.has('qa')).toBe(true);
    for (const s of ships) expect(s.prompt.trim().length).toBeGreaterThan(0);
  });
});
