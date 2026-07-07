import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFleetShips, defaultPRShips, resolveCfModel } from '../src/fleet.js';

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
    expect(names.has('spark')).toBe(true);
    expect(names.has('spider')).toBe(true);
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

  it('spark and spider are advisory PR commenters with explicit creative temperatures', () => {
    const spark = ships!.find(s => s.name === 'spark');
    const spider = ships!.find(s => s.name === 'spider');

    expect(spark).toBeDefined();
    expect(spark!.blocking).toBe(false);
    expect(spark!.needsExecution).toBe(false);
    expect(spark!.temperature).toBe(1.25);
    expect(spark!.prompt).toContain('high-temperature product imagination');

    expect(spider).toBeDefined();
    expect(spider!.blocking).toBe(false);
    expect(spider!.needsExecution).toBe(false);
    expect(spider!.temperature).toBe(0.95);
    // Spider's prompt was sharpened to a STRUCTURAL syllogism: the rationale must
    // be written verbatim as Premise A / Premise B / Therefore C.
    expect(spider!.prompt).toContain('SYLLOGISM engine');
    expect(spider!.prompt).toContain('Premise A');
    expect(spider!.prompt).toContain('Therefore C');
  });

  it('the four ideation ships (spark, spider, lookout, snipe) all parse as advisory ideation', () => {
    for (const name of ['spark', 'spider', 'lookout', 'snipe']) {
      const ship = ships!.find(s => s.name === name);
      expect(ship, `${name} should be present in pull_request:opened ships`).toBeDefined();
      expect(ship!.ideation, `${name} should be ideation`).toBe(true);
      expect(ship!.blocking, `${name} must never block`).toBe(false);
      expect(ship!.needsExecution).toBe(false);
    }
  });

  it('reviewer ships are NOT ideation (they raise findings, not proposals)', () => {
    const reviewer = ships!.find(s => s.name === 'code-reviewer');
    expect(reviewer!.ideation).toBe(false);
  });

  it('lookout carries the trouble-ahead telos and cross-branch awareness in its prompt', () => {
    const lookout = ships!.find(s => s.name === 'lookout');
    expect(lookout).toBeDefined();
    expect(lookout!.prompt).toContain('trouble-ahead');
    expect(lookout!.prompt.toLowerCase()).toContain('branch');
  });

  it('derives cfModel from the first @cf/ fallback, remapping the empty-returning ids', () => {
    // deriveCfModel takes a ship's FIRST `@cf/` fallback, then resolveCfModel
    // guards it. code-reviewer pins kimi-k2.7-code and qa pins gpt-oss-120b —
    // both return EMPTY on this Workers AI account (2026-07-07 transcript:
    // outputLength 0 for every chunk), which silently blanks the ship — so both
    // are remapped to the qwen coder model that actually returns output.
    const reviewer = ships!.find(s => s.name === 'code-reviewer');
    expect(reviewer!.cfModel).toBe('@cf/qwen/qwen2.5-coder-32b-instruct');
    const qa = ships!.find(s => s.name === 'qa');
    expect(qa!.cfModel).toBe('@cf/qwen/qwen2.5-coder-32b-instruct');
  });
});

describe('resolveCfModel — the empty-model guard', () => {
  it('passes through a known-good qwen model', () => {
    expect(resolveCfModel('@cf/qwen/qwen2.5-coder-32b-instruct')).toBe('@cf/qwen/qwen2.5-coder-32b-instruct');
    expect(resolveCfModel('@cf/qwen/qwen3-30b-a3b-fp8')).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
  });

  it('remaps the empty-returning ids that silenced the whole fleet', () => {
    // These returned outputLength:0 for every ship on this account — the exact
    // regression this guard exists to prevent recurring.
    expect(resolveCfModel('@cf/openai/gpt-oss-120b')).toBe('@cf/qwen/qwen2.5-coder-32b-instruct');
    expect(resolveCfModel('@cf/moonshotai/kimi-k2.7-code')).toBe('@cf/qwen/qwen2.5-coder-32b-instruct');
  });

  it('remaps any unrecognized id (an unknown id yields a blank response, not an error)', () => {
    expect(resolveCfModel('@cf/some/nonexistent-model')).toBe('@cf/qwen/qwen2.5-coder-32b-instruct');
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
    expect(ships![0].cfModel).toBe('@cf/qwen/qwen2.5-coder-32b-instruct');
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

  it('parses optional creative temperature without inventing a default', () => {
    const ships = parseFleetShips(
      yaml(
        [
          '    spark:',
          '      trigger: pull_request:opened',
          '      temperature: 1.25',
          '      prompt: |',
          '        spark.',
          '    qa:',
          '      trigger: pull_request:opened',
          '      prompt: |',
          '        qa.',
        ].join('\n'),
      ),
      'pull_request:opened',
    );
    const byName = Object.fromEntries(ships!.map(s => [s.name, s.temperature]));
    expect(byName.spark).toBe(1.25);
    expect(byName.qa).toBeNull();
  });

  it('rejects invalid creative temperature values', () => {
    const ships = parseFleetShips(
      yaml(
        [
          '    cold:',
          '      trigger: pull_request:opened',
          '      temperature: -0.1',
          '      prompt: |',
          '        cold.',
          '    hot:',
          '      trigger: pull_request:opened',
          '      temperature: 2.1',
          '      prompt: |',
          '        hot.',
          '    ok:',
          '      trigger: pull_request:opened',
          '      temperature: 2',
          '      prompt: |',
          '        ok.',
        ].join('\n'),
      ),
      'pull_request:opened',
    );
    const byName = Object.fromEntries(ships!.map(s => [s.name, s.temperature]));
    expect(byName.cold).toBeNull();
    expect(byName.hot).toBeNull();
    expect(byName.ok).toBe(2);
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
