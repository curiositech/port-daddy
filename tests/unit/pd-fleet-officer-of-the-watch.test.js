// tests/unit/pd-fleet-officer-of-the-watch.test.js
//
// Guards the SHIPPED fleet config (the repo's own pd-fleet.yml), not the
// starter template. fleet-ast.test.js parses templates/pd-fleet-starter.yml;
// nothing else parse-validates the real pd-fleet.yml, so a schema typo in an
// agent block would ride to production silently.
//
// This locks officer-of-the-watch (the solely-responsible log watcher added
// for the 2026-06-10 "File not found: ollama/qwen2.5-coder" flood) into the
// fleet: it must parse with the real parser, carry its 4-hour watch schedule,
// be a singleton, fall back off the primary CLI backend, and point at its
// behavior contract in fleet/ships/.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FLEET_PATH = join(ROOT, 'pd-fleet.yml');
const CONTRACT_PATH = join(ROOT, 'fleet', 'ships', 'officer-of-the-watch.md');

const { parseFleetSource, astToConfig } = await import('../../lib/fleet-ast.js');

const SOURCE = readFileSync(FLEET_PATH, 'utf-8');

describe('pd-fleet.yml (shipped config) parses with the real parser', () => {
  it('parseFleetSource returns a fleet AST with no thrown error', () => {
    const ast = parseFleetSource(SOURCE);
    expect(ast).not.toBeNull();
    expect(ast.kind).toBe('fleet');
    expect(ast.name?.value).toBe('port-daddy');
  });

  it('astToConfig projects the shipped config to an agent array', () => {
    const cfg = astToConfig(parseFleetSource(SOURCE));
    expect(Array.isArray(cfg.agents)).toBe(true);
    // The fleet is non-trivial — many ships. Assert a sane floor rather than
    // an exact count so adding/removing a ship doesn't break this guard.
    expect(cfg.agents.length).toBeGreaterThanOrEqual(10);
  });
});

describe('officer-of-the-watch ship', () => {
  let ast;
  let officer;       // AST node
  let officerCfg;    // projected config

  beforeAll(() => {
    ast = parseFleetSource(SOURCE);
    officer = ast.agents.get('officer-of-the-watch');
    officerCfg = astToConfig(ast).agents.find((a) => a.name === 'officer-of-the-watch');
  });

  it('is present in the shipped fleet', () => {
    expect(officer).toBeDefined();
    expect(officerCfg).toBeDefined();
  });

  it('stands a four-hour watch (cron every 4h)', () => {
    expect(officer.schedule?.kind).toBe('cron');
    expect(officer.schedule?.expression).toBe('0 */4 * * *');
    expect(officerCfg.schedule).toBe('0 */4 * * *');
  });

  it('is a singleton — exactly one watch officer at a time', () => {
    expect(officerCfg.singleton).toBe(true);
  });

  it('declares a primary backend and at least one fallback (fails loud, never silent-degrades to nothing)', () => {
    expect(officer.backend).toBeDefined();
    expect(Array.isArray(officer.fallbacks)).toBe(true);
    expect(officer.fallbacks.length).toBeGreaterThanOrEqual(1);
  });

  it('carries its fleet identity', () => {
    expect(officerCfg.identity).toBe('{project}:fleet:officer-of-the-watch');
  });

  it('prompt directs the ship to read its behavior contract before acting', () => {
    expect(typeof officerCfg.prompt).toBe('string');
    expect(officerCfg.prompt).toMatch(/fleet\/ships\/officer-of-the-watch\.md/);
    // The sole-responsibility / deck-log spine must be in the short form too,
    // so the ship still functions if the contract file is unreachable.
    expect(officerCfg.prompt).toMatch(/watch-log:/);
    expect(officerCfg.prompt.toLowerCase()).toContain('relieve the watch');
  });
});

describe('officer-of-the-watch behavior contract', () => {
  it('the contract file the prompt points at actually exists', () => {
    expect(existsSync(CONTRACT_PATH)).toBe(true);
  });

  it('the contract covers the sole-responsibility spine: watch procedure, escalation, deck log', () => {
    const md = readFileSync(CONTRACT_PATH, 'utf-8').toLowerCase();
    expect(md).toContain('deck log');
    expect(md).toContain('escalat');
    // The watch metaphor + the originating incident should both be documented
    // so the contract explains *why* this ship is solely responsible.
    expect(md).toContain('watch');
  });
});
