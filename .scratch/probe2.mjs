// Second probe: thinking + plain assistant text, no tools.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

function getSecret(key) {
  if (process.env[key]) return process.env[key];
  try {
    const out = execFileSync('/usr/bin/security',
      ['find-generic-password', '-s', 'port-daddy', '-a', `env:${key}`, '-w'],
      { encoding: 'utf8' }).trim();
    if (!out) return undefined;
    if (!out.startsWith('AIza')) {
      try {
        const d = Buffer.from(out, 'base64').toString('utf8');
        if (/^[\x20-\x7e]+$/.test(d)) return d;
      } catch {}
    }
    return out;
  } catch { return undefined; }
}

const apiKey = getSecret('GEMINI_API_KEY');
const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
  body: JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: 'In one sentence, what is the capital of France?' }] }],
    generationConfig: { thinkingConfig: { includeThoughts: true, thinkingBudget: 512 }, maxOutputTokens: 512 },
  }),
});
console.error(`HTTP ${res.status}`);
const data = await res.json();
const out = JSON.stringify(data, null, 2);
writeFileSync(new URL('./gemini-response-text.json', import.meta.url), out);
console.log(out);
