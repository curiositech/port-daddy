import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFleetShips, parseFleetSquidEvents, defaultPRShips } from '../src/fleet.js';
import {
  CF_ROLE_MODELS,
  resolveCfModel,
} from '../../shared/model-registry.generated.js';

// Assertions name the ROLE, not the id. The ids live in config/models.yaml and
// are expected to change; the routing policy these tests pin is what must not.
const REVIEW = CF_ROLE_MODELS.reviewBot;
const DEFAULT = CF_ROLE_MODELS.shipDefault;
const MID = CF_ROLE_MODELS.shipMid;

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

  it('routes the expensive review model to the CODE REVIEW BOT only; everything else the ship default', () => {
    // Operator directive: the review model is pricey — review bot only.
    //   - code-reviewer (declares capability: code, not pinnable) → reviewBot.
    //   - qa / red-team (declare capability: balanced, not pinnable) → default.
    const reviewer = ships!.find(s => s.name === 'code-reviewer');
    expect(reviewer!.cfModel).toBe(REVIEW);
    const qa = ships!.find(s => s.name === 'qa');
    expect(qa!.cfModel).toBe(DEFAULT);
    const redTeam = ships!.find(s => s.name === 'red-team');
    expect(redTeam!.cfModel).toBe(DEFAULT);
  });
});

describe('resolveCfModel — the empty-model guard', () => {
  it('passes through the two pinnable roles', () => {
    expect(resolveCfModel(DEFAULT)).toBe(DEFAULT);
    expect(resolveCfModel(MID)).toBe(MID);
  });

  it('remaps a non-pinnable or unknown id to the ship default', () => {
    // The review model is reached by ROLE, never by pin — so a bare pin of it
    // (or of anything else) is remapped to the default, never the pricey one.
    expect(resolveCfModel(REVIEW)).toBe(DEFAULT);
    expect(resolveCfModel('@cf/some/nonexistent-model')).toBe(DEFAULT);
    // The tombstone: the id that hung the fleet on 2026-07-03. It cannot be
    // reached even by an explicit pin.
    expect(resolveCfModel('@cf/moonshotai/kimi-k2-instruct')).toBe(DEFAULT);
  });
});

describe('parseFleetShips — model derivation + blocking coercion', () => {
  const yaml = (body: string) => `fleet:\n  agents:\n${body}\n`;

  it('routes reviewer-named ships to the review model when they have no honorable cloudflare pin', () => {
    const ships = parseFleetShips(
      yaml(
        [
          '    my-reviewer:',
          '      trigger: pull_request:opened',
          '      fallbacks:',
          '        - backend: openai',
          '          capability: cheap',
          '      prompt: |',
          '        review.',
        ].join('\n'),
      ),
      'pull_request:opened',
    );
    expect(ships![0].cfModel).toBe(REVIEW);
  });

  it('falls back to the ship default for non-reviewer ships with no cloudflare fallback', () => {
    const ships = parseFleetShips(
      yaml(
        ['    sniffer:', '      trigger: pull_request:opened', '      prompt: |', '        sniff.'].join(
          '\n',
        ),
      ),
      'pull_request:opened',
    );
    expect(ships![0].cfModel).toBe(DEFAULT);
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

describe('parseFleetSquidEvents — tenancy consent for fleet-cloud events', () => {
  it('defaults to false when the key is absent', () => {
    expect(parseFleetSquidEvents('fleet:\n  agents: {}\n')).toBe(false);
  });

  it('is true only for an explicit squidEvents: true under fleet:', () => {
    expect(parseFleetSquidEvents('fleet:\n  squidEvents: true\n  agents: {}\n')).toBe(true);
    // String 'true' also opts in (same coercion rules as `blocking:`).
    expect(parseFleetSquidEvents("fleet:\n  squidEvents: 'true'\n")).toBe(true);
  });

  it('rejects every not-quite-true value (fail-closed consent)', () => {
    expect(parseFleetSquidEvents('fleet:\n  squidEvents: false\n')).toBe(false);
    // NOTE: bare `yes` parses to boolean true only in YAML 1.1; the `yaml`
    // package (1.2 core schema) yields the string 'yes' — not consent.
    expect(parseFleetSquidEvents('fleet:\n  squidEvents: yes\n')).toBe(false);
    expect(parseFleetSquidEvents('fleet:\n  squidEvents: 1\n')).toBe(false);
    expect(parseFleetSquidEvents('fleet:\n  squidEvents: "TRUE"\n')).toBe(false);
    expect(parseFleetSquidEvents('fleet:\n  squidEvents:\n')).toBe(false);
  });

  it('is false for a top-level squidEvents outside fleet:, unparseable docs, and empty docs', () => {
    expect(parseFleetSquidEvents('squidEvents: true\n')).toBe(false);
    expect(parseFleetSquidEvents(':::not yaml:::\n  - [')).toBe(false);
    expect(parseFleetSquidEvents('')).toBe(false);
    expect(parseFleetSquidEvents('fleet: 7\n')).toBe(false);
  });

  it('the REAL pd-fleet.yml opts Port Daddy itself in', () => {
    expect(parseFleetSquidEvents(REAL_YAML)).toBe(true);
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
