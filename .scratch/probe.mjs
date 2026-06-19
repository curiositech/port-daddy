// Live Gemini REPL probe for transcript capture.
// Resolves GEMINI_API_KEY exactly the way lib/secret-env.getSecret() does:
//   env first (pre-snapshot), then OS keychain via /usr/bin/security
//   (service 'port-daddy', account 'env:GEMINI_API_KEY').
// NEVER writes to /tmp — output stays in this worktree .scratch/.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

function getSecret(key) {
  if (process.env[key]) return process.env[key];
  try {
    const out = execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-s', 'port-daddy', '-a', `env:${key}`, '-w'],
      { encoding: 'utf8' },
    ).trim();
    // security may hex-dump binary-ish values; decode if it looks like hex
    if (out && /^[0-9a-f]+$/i.test(out) && out.length % 2 === 0 && out.length > 40) {
      try {
        const decoded = Buffer.from(out, 'hex').toString('utf8');
        if (/^[\x20-\x7e]+$/.test(decoded)) return decoded;
      } catch { /* fall through */ }
    }
    if (!out) return undefined;
    // saveManagedSecret base64-encodes before handing to `security`.
    // Gemini keys start with "AIza"; if the raw value doesn't but its
    // base64 decode does, return the decoded form.
    if (!out.startsWith('AIza')) {
      try {
        const decoded = Buffer.from(out, 'base64').toString('utf8');
        if (/^[\x20-\x7e]+$/.test(decoded)) return decoded;
      } catch { /* fall through */ }
    }
    return out;
  } catch (err) {
    return undefined;
  }
}

const apiKey = getSecret('GEMINI_API_KEY');
if (!apiKey) {
  console.error('NO_KEY: GEMINI_API_KEY not resolvable via env or keychain');
  process.exit(2);
}
console.error(`KEY_RESOLVED: len=${apiKey.length} prefix=${apiKey.slice(0, 6)}…`);

const MODEL = 'gemini-2.5-flash';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

const body = {
  contents: [{
    role: 'user',
    parts: [{
      text: 'What is the weather in Paris and Tokyo right now? Use the get_weather tool for each city, then briefly reason about which is warmer.',
    }],
  }],
  tools: [{
    functionDeclarations: [{
      name: 'get_weather',
      description: 'Get the current weather for a city.',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
          unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
        },
        required: ['city'],
      },
    }],
  }],
  generationConfig: {
    thinkingConfig: { includeThoughts: true, thinkingBudget: 2048 },
    maxOutputTokens: 2048,
  },
};

const res = await fetch(`${BASE}/models/${MODEL}:generateContent`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
  body: JSON.stringify(body),
});

console.error(`HTTP ${res.status}`);
const data = await res.json();
const out = JSON.stringify(data, null, 2);
writeFileSync(new URL('./gemini-response.json', import.meta.url), out);
console.log(out);
