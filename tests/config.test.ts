/**
 * Focused regression tests for documentarian:push-reviewed config.
 * Tests the exact-SHA trigger, target-branch logic, and singleton constraints.
 */

import * as fs from 'fs';
import * as yaml from 'yaml';
import { expect } from 'chai';

describe('Documentarian Config', () => {
  let config: any;

  before(() => {
    const content = fs.readFileSync(`${__dirname}/../pd-fleet.yml`, 'utf-8');
    config = yaml.parse(content);
  });

  describe('YAML Structure', () => {
    it('should parse valid YAML', () => {
      expect(config).to.exist;
      expect(config.fleet).to.exist;
    });

    it('should have valid fleet metadata', () => {
      expect(config.fleet.name).to.equal('port-daddy-documentarian');
      expect(config.fleet.harbor).to.be.a('string');
      expect(config.fleet.harbor).to.include('{project}:fleet:documentarian');
    });

    it('should define limits', () => {
      const { limits } = config.fleet;
      expect(limits).to.exist;
      expect(limits.max_concurrent_spawns).to.equal(1);
      expect(limits.max_spawns_per_hour).to.be.greaterThan(0);
      expect(limits.budget_usd_per_day).to.be.greaterThan(0);
    });
  });

  describe('Documentarian Agent', () => {
    let agent: any;

    before(() => {
      agent = config.fleet.agents.documentarian;
    });

    it('should exist and have required fields', () => {
      expect(agent).to.exist;
      expect(agent.trigger).to.exist;
      expect(agent.backend).to.exist;
      expect(agent.fallbacks).to.be.an('array');
      expect(agent.prompt).to.be.a('string');
    });

    describe('Trigger Configuration', () => {
      it('should have github:push and promotion:release-surfaces', () => {
        expect(agent.trigger).to.be.an('array');
        expect(agent.trigger).to.include('github:push');
        expect(agent.trigger).to.include('promotion:release-surfaces');
      });

      it('should support exact-SHA tuple structure', () => {
        // Trigger must be able to extract exact SHA from push event
        // This is implicit in the prompt, verified by regex in the prompt
        const hasShaExtract = /exact source SHA|commit hash/i.test(agent.prompt);
        expect(hasShaExtract).to.be.true;
      });
    });

    describe('Model Tier', () => {
      it('should have model_tier: low', () => {
        expect(agent.model_tier).to.equal('low');
      });

      it('should have appropriate fallbacks', () => {
        expect(agent.fallbacks.length).to.be.greaterThan(0);
        const backends = agent.fallbacks.map((f: any) => f.backend);
        expect(backends).to.include.members(['cli:codex', 'cloudflare']);
      });
    });

    describe('Singleton + Worktree Constraints', () => {
      it('should enforce singleton: true', () => {
        expect(agent.singleton).to.be.true;
      });

      it('should enforce worktree: true', () => {
        expect(agent.worktree).to.be.true;
      });

      it('should have zero cooldown and dedupe for every-push behavior', () => {
        expect(agent.cooldown_ms).to.equal(0);
        expect(agent.dedupe_window_ms).to.equal(0);
      });

      it('should have backoff for API failure resilience', () => {
        expect(agent.backoff_base_ms).to.equal(300000);  // 5 min
        expect(agent.backoff_max_ms).to.equal(3600000);  // 1 hour
      });
    });

    describe('Tool Access', () => {
      it('should restrict to safe tools only', () => {
        expect(agent.allowedTools).to.be.a('string');
        const tools = agent.allowedTools.split(',').map((t: string) => t.trim());

        // Should allow read/write/grep/glob
        expect(tools).to.include('Read');
        expect(tools).to.include('Write');
        expect(tools).to.include('Edit');
        expect(tools).to.include('Grep');
        expect(tools).to.include('Glob');

        // Should restrict bash to git and gh only
        const bashTools = tools.filter((t: string) => t.includes('Bash'));
        bashTools.forEach((tool: string) => {
          const isGitOrGh = /Bash\((git\*|gh\*)\)/.test(tool);
          expect(isGitOrGh).to.be.true;
        });

        // Should NOT allow arbitrary bash
        expect(tools).to.not.include('Bash');
      });
    });

    describe('Prompt Completeness', () => {
      it('should define all four phases', () => {
        const phases = [
          'PHASE 1: CAPTURE & INSPECT',
          'PHASE 2: SURFACE AUDIT',
          'PHASE 3: DRIFT DETECTION & REMEDIATION',
          'PHASE 4: RESULT PUBLICATION',
        ];

        phases.forEach((phase) => {
          expect(agent.prompt).to.include(phase);
        });
      });

      it('should reference tuple publication', () => {
        expect(agent.prompt).to.include('documentarian:push-reviewed');
      });

      it('should enforce "never push main" constraint', () => {
        const constraint = /NEVER push.*main|never push directly to main/i;
        expect(constraint.test(agent.prompt)).to.be.true;
      });

      it('should describe target-branch logic', () => {
        const logic = /target.*feature branch.*if it still exists|Target the pushed feature branch/i;
        expect(logic.test(agent.prompt)).to.be.true;
      });

      it('should mention surfaces to check', () => {
        const surfaces = [
          'AGENTS.md',
          'CLAUDE.md',
          'README.md',
          'port-daddy-agent-skill',
          'port-daddy/SKILL.md',
        ];
        surfaces.forEach((surface) => {
          expect(agent.prompt).to.include(surface);
        });
      });

      it('should describe CLEAN, DRIFT_FIXED, DRIFT_MANUAL_REQUIRED verdicts', () => {
        expect(agent.prompt).to.include('CLEAN');
        expect(agent.prompt).to.include('DRIFT_FIXED');
        expect(agent.prompt).to.include('DRIFT_MANUAL_REQUIRED');
      });
    });

    describe('Identity', () => {
      it('should have a semantic identity', () => {
        expect(agent.identity).to.equal('{project}:fleet:documentarian');
      });

      it('should have a telos statement', () => {
        expect(agent.telos).to.be.a('string');
        expect(agent.telos.length).to.be.greaterThan(10);
      });
    });
  });

  describe('Trigger Behavior', () => {
    let agent: any;

    before(() => {
      agent = config.fleet.agents.documentarian;
    });

    it('should support exact-SHA extraction from github:push', () => {
      // The prompt must be able to handle:
      // - Branch name
      // - Changed files
      // - Exact source SHA
      const required = ['exact source SHA', 'branch name', 'changed files'];
      required.forEach((term) => {
        expect(agent.prompt.toLowerCase()).to.include(term.toLowerCase());
      });
    });

    it('should skip bot-managed branches', () => {
      expect(agent.prompt).to.include('renovate/*');
      expect(agent.prompt).to.include('dependabot/*');
    });

    it('should read back tuple after publication', () => {
      expect(agent.prompt).to.include('READ IT BACK');
      expect(agent.prompt).to.include('verify it persisted');
    });
  });
});
