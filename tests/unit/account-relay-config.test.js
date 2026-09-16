/**
 * Relay/config contract — executable form of the purser's second adversarial
 * demand on PR #7279 (its draft targeted tests/purser/, outside jest's
 * testMatch, and assumed .mcp.json had a top-level `env`; the real shape
 * nests env under mcpServers.<name>.env).
 *
 * Pins: DEFAULT_RELAY targets the branded prod origin, and no MCP server
 * config carries a hardcoded secret again.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('pd account DEFAULT_RELAY', () => {
  const source = readFileSync(join(ROOT, 'cli', 'commands', 'account.ts'), 'utf8');
  const match = source.match(/DEFAULT_RELAY\s*=\s*['"]([^'"]+)['"]/);

  test('is defined and targets the branded prod origin', () => {
    expect(match).not.toBeNull();
    expect(match[1]).toBe('https://relay.portdaddy.dev');
  });

  test('is a valid URL and not the pre-cutover workers.dev origin', () => {
    expect(() => new URL(match[1])).not.toThrow();
    expect(match[1]).not.toContain('workers.dev');
  });
});

describe('.mcp.json secret hygiene', () => {
  const mcp = JSON.parse(readFileSync(join(ROOT, '.mcp.json'), 'utf8'));

  test('parses and declares mcpServers', () => {
    expect(mcp.mcpServers).toBeInstanceOf(Object);
  });

  test('no server env value is a hardcoded hex secret; expansions stay expansions', () => {
    const hex = /^[a-f0-9]{32,}$/i;
    for (const [, server] of Object.entries(mcp.mcpServers)) {
      for (const [key, value] of Object.entries(server.env ?? {})) {
        expect(typeof value).toBe('string');
        expect(hex.test(value)).toBe(false);
        if (key === 'TWENTYFIRST_API_KEY') {
          expect(value).toBe('${TWENTYFIRST_API_KEY}');
        }
      }
    }
  });
});
