#!/usr/bin/env tsx
/**
 * refresh-model-registry — keep config/model-registry.json current per build.
 *
 * Model IDs churn (ADR-0057). This script is the "refreshed every version build"
 * half of the declarative-registry directive: it asks each provider what models
 * actually exist right now, flags any ID the registry maps to that has DISAPPEARED
 * (the churn landmine, caught before it ships), and — with --write — restamps
 * provenance. It deliberately does NOT auto-re-rank tiers: which concrete model is
 * "high" vs "max-thinking" is a judgment call. The script surfaces drift; a human
 * (or a follow-up LLM pass) makes the tier call.
 *
 * Usage:
 *   tsx scripts/refresh-model-registry.ts            # report drift, exit 1 if any
 *   tsx scripts/refresh-model-registry.ts --write    # also restamp generatedAt
 *
 * Keys (optional; a provider with no key is skipped with a note, not an error):
 *   ANTHROPIC_API_KEY, OPENAI_API_KEY
 *
 * Cloudflare/Gemini/Groq model-list endpoints differ per account; those providers
 * are reported as "manual review" rather than guessed. Prefix-matched IDs (e.g.
 * `claude-haiku-4-5-20251001` vs the live `claude-haiku-4-5`) count as present.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REGISTRY_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'config',
  'model-registry.json',
);

interface Registry {
  generatedAt: string;
  generatedBy: string;
  source: string;
  backends: Record<string, Record<string, string>>;
  [k: string]: unknown;
}

/** Provider model-list fetchers. Return null when unqueryable (no key / no endpoint). */
const PROVIDERS: Record<string, () => Promise<string[] | null>> = {
  anthropic: async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return null;
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1000', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    });
    if (!res.ok) throw new Error(`anthropic /models ${res.status}`);
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    return (body.data ?? []).map((m) => m.id);
  },
  openai: async () => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return null;
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`openai /models ${res.status}`);
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    return (body.data ?? []).map((m) => m.id);
  },
};

/** Which backends in the registry map onto which queryable provider family. */
const BACKEND_PROVIDER: Record<string, string> = {
  anthropic: 'anthropic',
  claude: 'anthropic',
  'claude-cli': 'anthropic',
  openai: 'openai',
  codex: 'openai',
  aider: 'openai',
};

/** A registry ID is "present" if any live id equals it or is a prefix of it. */
function isPresent(id: string, live: string[]): boolean {
  return live.some((l) => id === l || id.startsWith(l) || l.startsWith(id));
}

async function main() {
  const write = process.argv.includes('--write');
  const reg = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as Registry;

  const liveByProvider: Record<string, string[] | null> = {};
  for (const [provider, fetcher] of Object.entries(PROVIDERS)) {
    try {
      liveByProvider[provider] = await fetcher();
    } catch (err) {
      console.error(`! ${provider}: ${(err as Error).message}`);
      liveByProvider[provider] = null;
    }
  }

  const drift: string[] = [];
  const manual: string[] = [];
  for (const [backend, table] of Object.entries(reg.backends)) {
    const provider = BACKEND_PROVIDER[backend];
    const live = provider ? liveByProvider[provider] : undefined;
    for (const [capability, id] of Object.entries(table)) {
      if (!provider || live === undefined) {
        manual.push(`${backend}.${capability} = ${id}`);
        continue;
      }
      if (live === null) {
        manual.push(`${backend}.${capability} = ${id}  (${provider}: no key — manual review)`);
        continue;
      }
      if (!isPresent(id, live)) {
        drift.push(`${backend}.${capability} = ${id}  (NOT FOUND in live ${provider} models)`);
      }
    }
  }

  if (manual.length) {
    console.log('\nManual-review tiers (provider not auto-queryable):');
    for (const m of [...new Set(manual)]) console.log(`  - ${m}`);
  }

  if (drift.length) {
    console.error('\n✗ DRIFT — registry maps to model IDs that no longer exist:');
    for (const d of drift) console.error(`  - ${d}`);
    console.error('\nUpdate config/model-registry.json to a live ID for each, then re-run.');
    process.exit(1);
  }

  console.log('\n✓ No drift: every auto-checkable registry ID is still live.');

  if (write) {
    const today = new Date().toISOString().slice(0, 10);
    reg.generatedAt = today;
    reg.generatedBy = `refresh-model-registry.ts --write on ${today}`;
    writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + '\n');
    console.log(`Restamped generatedAt=${today}.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
