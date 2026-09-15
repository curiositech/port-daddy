import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFleetShips, parseFleetSquidEvents, defaultPRShips, resolveCfModel } from '../src/fleet.js';
import { CF_ADMITTED_MODELS, CF_ROLE_MODELS } from '../../shared/model-registry.generated.js';

// The REAL pd-fleet.yml at the repo root (apps/fleet-executor/tests → ../../..).
const REAL_YAML = readFileSync(
  fileURLToPath(new URL('../../../pd-fleet.yml', import.meta.url)),
  'utf8',
);

describe('parseFleetShips — deterministic parse of the real pd-fleet.yml', () => {
  const ships = parseFleetShips(REAL_YAML, 'pull_request:opened');
  // Derivation (models, prompts, telos, class) is a property of a ship's
  // DECLARATION, not of whether it is currently in service. A paused ship is
  // excluded from every parse, so those assertions read the real config with
  // the pauses stripped — which keeps them testing the parser rather than the
  // operator's current on/off choices, and keeps them honest if a ship is
  // un-paused later.
  const UNPAUSED_YAML = REAL_YAML.replace(/^[ \t]*enabled:[ \t]*false[ \t]*\r?\n/gm, '');
  const declared = parseFleetShips(UNPAUSED_YAML, 'pull_request:opened');

  it('returns the full set of ENABLED pull_request:opened ships (no 12KB truncation loss)', () => {
    expect(ships).not.toBeNull();
    const names = new Set(ships!.map(s => s.name));
    // These all declare `trigger: pull_request:opened` in pd-fleet.yml and
    // carry no `enabled:` key, so they are in service.
    expect(names.has('code-reviewer')).toBe(true);
    expect(names.has('qa')).toBe(true);
    expect(names.has('red-team')).toBe(true);
    expect(names.has('tautology-sniffer')).toBe(true);
    expect(names.has('test-author')).toBe(true);
  });

  it('EXCLUDES the four ideation ships paused with `enabled: false`', () => {
    // The regression this guards: `enabled: false` was honoured by the daemon's
    // FleetConfig parser but ignored here, so pausing a cloud PR ship in
    // pd-fleet.yml changed nothing about the comments it posts. Asserted
    // against the REAL pd-fleet.yml, so re-enabling one in config without
    // meaning to fails this test rather than silently resuming its comments.
    const executing = new Set(ships!.map(s => s.name));
    const listed = new Set((parseFleetShips(REAL_YAML, '*') ?? []).map(s => s.name));
    for (const paused of ['spark', 'spider', 'lookout', 'snipe']) {
      expect(executing.has(paused), `${paused} must not execute`).toBe(false);
      expect(listed.has(paused), `${paused} must not be listed`).toBe(false);
    }
  });

  it('pausing the ideation ships left the blocking review path armed', () => {
    // The point of the split: proposals stop, review does not.
    const names = new Set(ships!.map(s => s.name));
    for (const review of ['qa', 'code-reviewer', 'red-team', 'test-author', 'tautology-sniffer']) {
      expect(names.has(review)).toBe(true);
    }
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
    const spark = declared!.find(s => s.name === 'spark');
    const spider = declared!.find(s => s.name === 'spider');

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

  it('the four ideation ships stay advisory in their declarations', () => {
    // Read from the unpaused fixture: the pause is asserted above. This guards
    // the other direction — that un-pausing one later cannot quietly bring back
    // a BLOCKING ship, which would turn an advisory proposer into a merge gate.
    for (const name of ['spark', 'spider', 'lookout', 'snipe']) {
      const ship = declared!.find(s => s.name === name);
      expect(ship, `${name} should parse from its declaration`).toBeDefined();
      expect(ship!.ideation, `${name} should be ideation`).toBe(true);
      expect(ship!.blocking, `${name} must never block`).toBe(false);
    }
  });

  it('reviewer ships are NOT ideation (they raise findings, not proposals)', () => {
    const reviewer = ships!.find(s => s.name === 'code-reviewer');
    expect(reviewer!.ideation).toBe(false);
  });

  it('lookout carries the trouble-ahead telos and cross-branch awareness in its prompt', () => {
    const lookout = declared!.find(s => s.name === 'lookout');
    expect(lookout).toBeDefined();
    expect(lookout!.prompt).toContain('trouble-ahead');
    expect(lookout!.prompt.toLowerCase()).toContain('branch');
  });

  it('honors deliberate premium pins (code-reviewer kimi, red-team 120b); qa stays cheap', () => {
    // Operator recalibration 2026-08-22: the known-good set guards against
    // silent-blank ids, not price. A ship's DECLARED verified pin is honored —
    // code-reviewer's kimi-k2.7-code and red-team's gpt-oss-120b used to be
    // silently remapped down, which made pd-fleet.yml lie about what ran. The
    // stale gpt-oss-120b pins on the cheap-tier ships (qa and friends) were
    // truthed-up to the cheap id in the same change, so cheap ships stay cheap
    // by CONFIG rather than by a guard overriding config.
    const reviewer = ships!.find(s => s.name === 'code-reviewer');
    expect(reviewer!.cfModel).toBe('@cf/zai-org/glm-5.2');
    // qa moved to the agentic 30B specialist (same cost class, 4x context,
    // 59.2% vs 22% SWE-bench over qwen3-30b) in the 2026-08-22 repertoire
    // expansion; spark stays on qwen3-30b as the A/B control population.
    const qa = ships!.find(s => s.name === 'qa');
    expect(qa!.cfModel).toBe('@cf/zai-org/glm-4.7-flash');
    const spark = declared!.find(s => s.name === 'spark');
    expect(spark!.cfModel).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
    const redTeam = ships!.find(s => s.name === 'red-team');
    expect(redTeam!.cfModel).toBe('@cf/deepseek-ai/deepseek-v4-pro-0813');
  });
});

describe('parseFleetShips — `enabled` is an admission boundary', () => {
  const yamlFor = (enabledLine: string) => `
fleet:
  agents:
    probe:
${enabledLine ? `      ${enabledLine}\n` : ''}      trigger:
        - pull_request:opened
      prompt: |
        A probe ship with a real prompt so it is not skipped as deterministic.
`;
  const parsed = (enabledLine: string) =>
    (parseFleetShips(yamlFor(enabledLine), 'pull_request:opened') ?? []).map(s => s.name);

  it('absent means enabled — every ship predating the field keeps running', () => {
    expect(parsed('')).toContain('probe');
  });

  it('accepts every spelling YAML parses as a real boolean true', () => {
    // true / True / TRUE are all boolean true under the yaml package's core
    // schema, so all three enable. Asserted rather than assumed.
    for (const good of ['enabled: true', 'enabled: True', 'enabled: TRUE']) {
      expect(parsed(good), good).toContain('probe');
    }
  });

  it('an explicit false takes the ship out of service', () => {
    expect(parsed('enabled: false')).not.toContain('probe');
    expect(parsed('enabled: False')).not.toContain('probe');
  });

  it('fails CLOSED on a malformed value — a typo must not re-enable a paused ship', () => {
    // `enabled: flase` is the case this exists for: it is not boolean true, so
    // the ship stays out of service rather than quietly inheriting the default.
    for (const bad of [
      'enabled: flase', 'enabled: yes', 'enabled: 1', 'enabled: 0',
      'enabled: null', 'enabled: {}', "enabled: 'False'",
    ]) {
      expect(parsed(bad), bad).not.toContain('probe');
    }
  });

  it('a QUOTED string fails closed, matching the daemon rather than the neighbour', () => {
    // The one case where the obvious implementation diverges. The daemon's
    // extractBool() takes only `typeof value === 'boolean'`, so a quoted
    // 'true' fails closed there. Accepting it here would mean the cloud ran a
    // ship the daemon had paused — fail-open, on an admission boundary, and
    // the exact disagreement this predicate exists to close.
    expect(parsed("enabled: 'true'"), "quoted 'true' must NOT enable").not.toContain('probe');
    expect(parsed("enabled: 'false'")).not.toContain('probe');
  });

  it('matches the daemon parser, which already treated it this way', () => {
    // lib/fleet-ast.ts: "`enabled` is an admission boundary, so a
    // present-but-malformed value fails closed to false instead of silently
    // inheriting the enabled default." Two parsers over one config file must
    // not disagree about what taking a ship out of service means — and the
    // daemon already had the field (AgentNode.enabled?: BoolNode); the cloud
    // was the side missing it.
    expect(parsed('enabled: false')).toEqual([]);
    expect(parsed('')).toEqual(['probe']);
  });
});

describe('pausing every ship falls back to the built-in roster — a real footgun', () => {
  // fleetShipsFromDocument ends `return ships.length > 0 ? ships : null`, and
  // execute.ts reads `parseFleetShips(...) ?? defaultPRShips()`. So a config
  // that pauses EVERY ship matching a trigger does not disable the fleet for
  // that trigger — it hands the executor the built-in default roster instead.
  //
  // Pinned rather than fixed: changing the collapse-to-null would alter how a
  // repo with no pd-fleet.yml, or one whose ships all mismatch the trigger, is
  // treated, which is a wider decision than this change. Anyone reaching for
  // "turn the whole fleet off by pausing its ships" needs to read this first.
  const allPaused = `
fleet:
  agents:
    only-ship:
      enabled: false
      trigger:
        - pull_request:opened
      prompt: |
        The sole ship, paused.
`;

  it('returns null — NOT an empty roster — when every matching ship is paused', () => {
    expect(parseFleetShips(allPaused, 'pull_request:opened')).toBeNull();
  });

  it('so the executor falls back to defaults: pausing everything runs the defaults', () => {
    const ships = parseFleetShips(allPaused, 'pull_request:opened') ?? defaultPRShips();
    expect(ships.length).toBeGreaterThan(0);
    // The fallback roster is emphatically not "nothing".
    expect(ships).toEqual(defaultPRShips());
  });

  it('the real pd-fleet.yml is NOT in that state — review ships keep the roster non-empty', () => {
    const real = parseFleetShips(REAL_YAML, 'pull_request:opened');
    expect(real).not.toBeNull();
    expect(real!.some(s => s.name === 'qa')).toBe(true);
  });
});

describe('resolveCfModel — the empty-model guard', () => {
  it('passes through the honored cheap model', () => {
    expect(resolveCfModel('@cf/qwen/qwen3-30b-a3b-fp8')).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
  });

  it('passes through every verified id; remaps unverified ones to the cheap fallback', () => {
    // The set guards existence, not price (2026-08-22): a verified premium id
    // is honored, while an id with no verified catalog + rate + context entry
    // is remapped — a nonexistent Workers AI id returns blank, not an error,
    // and a blank reads as "clean" (#654).
    expect(resolveCfModel('@cf/openai/gpt-oss-120b')).toBe('@cf/openai/gpt-oss-120b');
    expect(resolveCfModel('@cf/moonshotai/kimi-k2.7-code')).toBe('@cf/moonshotai/kimi-k2.7-code');
    expect(resolveCfModel('@cf/openai/gpt-oss-20b')).toBe('@cf/openai/gpt-oss-20b');
    // Full-universe admission: qwen2.5-coder is verified+priced, so it now
    // passes through too. Only unverified ids remap.
    expect(resolveCfModel('@cf/qwen/qwen2.5-coder-32b-instruct')).toBe('@cf/qwen/qwen2.5-coder-32b-instruct');
    // The #654 phantom tombstone stays OUT until a witnessed live call.
    expect(resolveCfModel('@cf/moonshotai/kimi-k2.6')).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
    expect(resolveCfModel('@cf/some/nonexistent-model')).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
  });
});

describe('parseFleetShips — model derivation + blocking coercion', () => {
  const yaml = (body: string) => `fleet:\n  agents:\n${body}\n`;

  it('routes reviewer-named ships (the review bot) to gpt-oss-120b when they have no honored @cf/ pin', () => {
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
    expect(ships![0].cfModel).toBe('@cf/openai/gpt-oss-120b');
  });

  it('falls back to the cheap general model (qwen3-30b) for non-reviewer ships with no @cf/ fallback', () => {
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

describe('ship-level pins: both spellings, and admission at the resolver', () => {
  const purser = (pin: string) =>
    parseFleetShips(
      `fleet:\n  agents:\n    purser:\n      class: purser\n      trigger: pull_request:opened\n${pin}\n      prompt: |\n        anything.\n`,
      'pull_request:opened',
    )!.find((s) => s.name === 'purser')!;

  // EVERY fixture here pins something DIFFERENT from the ship default on
  // purpose. A regression in this exact function hid behind a fixture that
  // pinned the default value: the pin was being dropped entirely, and the
  // assertion still passed because the fallback produced the same id. A pin
  // test whose expected value equals the default proves nothing.
  it('honors a ship-level `model:` literal — pd-fleet.yml\'s spelling', () => {
    expect(CF_ROLE_MODELS.reviewBot).not.toBe(CF_ROLE_MODELS.shipDefault);
    expect(purser(`      model: '${CF_ROLE_MODELS.reviewBot}'`).cfModel).toBe(
      CF_ROLE_MODELS.reviewBot,
    );
  });

  it('honors a ship-level `cf_role:` token', () => {
    expect(purser('      cf_role: reviewBot').cfModel).toBe(CF_ROLE_MODELS.reviewBot);
  });

  it('drops an unadmitted role rather than running it', () => {
    // `embed` resolves to a real catalogued model the fleet must never run: the
    // ideas-store index would return vectors where a review should be. The
    // resolver refuses it, so the ship falls back rather than being handed it.
    expect(CF_ADMITTED_MODELS).not.toContain(CF_ROLE_MODELS.embed);
    const cfModel = purser('      cf_role: embed').cfModel;
    expect(cfModel).not.toBe(CF_ROLE_MODELS.embed);
    expect(CF_ADMITTED_MODELS).toContain(cfModel);
  });
});
