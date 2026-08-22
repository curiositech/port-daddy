// tests/unit/purser/environment-variable-override.test.ts
import { readFileSync } from 'node:fs';
import { describe, test, expect } from '@jest/globals';
import { INTEGRATIONS } from '../../../website-v2/src/data/integrations.ts';

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('Environment Variable Override – PORT_DADDY_URL', () => {
  test('LangChain integration uses PORT_DADDY_URL and falls back to daemon.port', () => {
    // Find the LangChain integration
    const langchain = INTEGRATIONS.find((i) => i.id === 'langchain');
    expect(langchain).toBeDefined();
    const code = langchain!.setupCode;

    // The code must reference the environment variable
    expect(code).toMatch(/os\.getenv\(['"]PORT_DADDY_URL['"]\)/);

    // It should contain the fallback logic that reads ~/.port-daddy/daemon.port
    expect(code).toMatch(
      /daemon_port_file = os\.path\.expanduser\(['"]~\/\.port-daddy\/daemon\.port['"]\)/
    );
    expect(code).toMatch(/if not base_url:/);
    expect(code).toMatch(/base_url = f'http:\/\/localhost:{daemon_port}'/);

    // Ensure no hard‑coded numeric localhost port remains
    expect(code).not.toMatch(/localhost:9876/);

    // The comment explaining the fallback should be present
    expect(code).toMatch(/LangChain chains use PORT_DADDY_URL if set; else discover from daemon\.port/);
  });

  test('Documentation teaches endpoint discovery via the port file', () => {
    const getStarted = read('../../../../website-v2/src/docs-content/getStarted.ts');
    expect(getStarted).toContain('Discover the daemon endpoint');
    expect(getStarted).toContain('~/.port-daddy/daemon.port');
  });

  test('Hero copy states the daemon publishes its endpoint', () => {
    const hero = read('../../../../website-v2/src/data/hero-copy.ts');
    expect(hero).toContain('publishes its endpoint');
  });
});