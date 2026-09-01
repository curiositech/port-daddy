/**
 * Executable evidence contract for implementation grades shared by the
 * Coordination Papers.  These assertions deliberately bind each PARTIAL /
 * BuiltWeak claim to both (a) the code and focused tests that justify the
 * shipped slice and (b) the explicit non-provision that keeps the papers from
 * implying the stronger, unbuilt security property.
 */

import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

const kernelPaper = read('whitepaper/source/single-writer-kernel.tex');
const economyPaper = read('whitepaper/source/harbor-economy.tex');
const roadmap = read('docs/roadmap/whitepaper-research-program.md');

describe('Coordination Papers implementation-status contract', () => {
  test('witnessed-outcome ledger stays PARTIAL: commitment substrate exists and richer outcomes do not', () => {
    const commitments = read('lib/commitments.ts');
    const obligationMonitor = read('lib/obligation-monitor.ts');
    const commitmentTests = read('tests/unit/commitments.test.js');
    const monitorTests = read('tests/unit/obligation-monitor.test.js');

    // Shipped evidence named by the papers.
    expect(commitments).toContain('closed_by_oracle_ref');
    expect(commitments).toContain('due_at` is DERIVED');
    expect(obligationMonitor).toContain("WHERE state = 'open' AND due_at < ?");
    expect(commitmentTests).toContain('closure binds to an oracle');
    expect(monitorTests).toContain('finds an open commitment past its due_at');

    // The grade and its upper boundary must remain explicit in both companions.
    expect(kernelPaper).toContain('A \\BuiltWeak{}\nsubstrate now ships: durable commitments');
    expect(kernelPaper).toContain(
      'Neutral graded outcome events,\nsanctions, identity binding, and reputation updates remain absent.',
    );
    expect(economyPaper).toMatch(
      /Outcome ledger \(organ 3 --- reputation keys here\) & \\BuiltWeak\{\}/,
    );
    expect(roadmap).toContain(
      'Neutral graded outcomes, sanctions, and reputation binding do not.',
    );
  });

  test('local identity stays PARTIAL: minted credentials and the shared pool exist, universal gating does not', () => {
    const actorSouls = read('lib/actor-souls.ts');
    const identityTests = read('tests/unit/actor-souls.test.js');
    const poolTests = read('tests/unit/budget-guard-newcomer-pool.test.js');

    // Shipped evidence named by the papers.
    expect(actorSouls).toContain('CREATE TABLE IF NOT EXISTS actor_souls');
    expect(actorSouls).toContain('function verifyCredential');
    expect(actorSouls).toContain('CREATE TABLE IF NOT EXISTS newcomer_pool');
    expect(identityTests).toContain('forged / self-asserted rejection');
    expect(poolTests).toContain(
      'minting N fresh newcomer ids does NOT multiply the per-project budget',
    );

    // The papers and roadmap must reject the stronger end-to-end interpretation.
    expect(kernelPaper).toContain(
      'I12 is \\BuiltWeak: daemon-minted actor souls, lookup credentials, and a\n  bounded newcomer pool enforced by the budget guard ship; universal\n  write-boundary enforcement does not.',
    );
    expect(kernelPaper).toContain(
      'partial local identity enforcement (I12)',
    );
    expect(economyPaper).toContain(
      'full write gating does not ship',
    );
    expect(roadmap).toContain(
      'Universal write-boundary enforcement and legacy migration do not.',
    );
  });

  test('the edition roadmap names the exact code needed to promote either grade', () => {
    expect(roadmap).toContain(
      'Extend the shipped commitment substrate into a reputation-grade',
    );
    expect(roadmap).toContain(
      'Require daemon-minted actor credentials at every security-relevant write',
    );
    expect(roadmap).toMatch(
      /The production library must publish the\s+same edition and implementation grades/,
    );
  });
});
