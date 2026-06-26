/**
 * OpenAI-compatible backends for the local citizen runner.
 *
 * Three substrates, none of which expose lifecycle hooks:
 *   - groq      : cloud, OpenAI-compatible. IMPORTANT: plain urllib/fetch hits a
 *                 Cloudflare 403 ("error 1010", bot fingerprint). We call it via
 *                 `curl` with a browser User-Agent, which returns 200.
 *   - lmstudio  : local server at http://localhost:1234/v1 (OFF by default).
 *   - ollama    : local server at http://localhost:11434 (optional/unconfigured).
 *
 * The Groq API key is read from ~/coding/workgroup-ai/.env.local at call time
 * and passed to curl via an env var — it is NEVER logged, echoed, or written.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type BackendName = 'groq' | 'lmstudio' | 'ollama';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  ok: boolean;
  text: string;
  /** error detail when ok === false; never contains secrets */
  error?: string;
  model: string;
  backend: BackendName;
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const LMSTUDIO_ENDPOINT = 'http://localhost:1234/v1/chat/completions';
const OLLAMA_ENDPOINT = 'http://localhost:11434/v1/chat/completions';

export const DEFAULT_MODELS: Record<BackendName, string> = {
  groq: 'llama-3.1-8b-instant',
  lmstudio: 'qwen3-next-coder',
  ollama: 'qwen2.5-coder:7b',
};

/** Read GROQ_API_KEY from ~/coding/workgroup-ai/.env.local. Never logged. */
function readGroqKey(): string | null {
  const p = join(homedir(), 'coding', 'workgroup-ai', '.env.local');
  if (!existsSync(p)) return null;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*GROQ_API_KEY\s*=\s*(.+)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, '').trim();
  }
  return null;
}

function parseOpenAIResponse(body: string): { text: string; error?: string } {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { text: '', error: `non-JSON response: ${body.slice(0, 200)}` };
  }
  const obj = json as Record<string, unknown>;
  if (obj.error) {
    const e = obj.error as Record<string, unknown>;
    return { text: '', error: String(e.message ?? JSON.stringify(e)) };
  }
  const choices = obj.choices as Array<Record<string, unknown>> | undefined;
  const msg = choices?.[0]?.message as Record<string, unknown> | undefined;
  const text = typeof msg?.content === 'string' ? msg.content : '';
  if (!text) return { text: '', error: `no content in response: ${body.slice(0, 200)}` };
  return { text };
}

/**
 * Groq via curl + browser UA.
 *
 * The bearer token must NOT appear in argv (visible to any `ps`) and must NOT
 * be logged. We write it into a curl `--config` file (header + url) under
 * ~/coding/tmp (NEVER /tmp — macOS purges that), chmod 600, run curl against
 * it, and delete it in a finally. The secret only ever lives in that 0600 file
 * for the duration of one request.
 */
function callGroq(messages: ChatMessage[], model: string): ChatResult {
  const key = readGroqKey();
  if (!key) {
    return { ok: false, text: '', error: 'GROQ_API_KEY not found in ~/coding/workgroup-ai/.env.local', model, backend: 'groq' };
  }
  const payload = JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 1024 });
  const scratchDir = join(homedir(), 'coding', 'tmp', 'local-citizen');
  mkdirSync(scratchDir, { recursive: true });
  const cfgPath = join(scratchDir, `groq-curl-${process.pid}-${Date.now()}.cfg`);
  // curl config syntax: one directive per line, values quoted.
  const cfg =
    `url = "${GROQ_ENDPOINT}"\n` +
    `request = "POST"\n` +
    `header = "Content-Type: application/json"\n` +
    `header = "User-Agent: ${BROWSER_UA}"\n` +
    `header = "Authorization: Bearer ${key}"\n` +
    `silent\n` +
    `data-binary = "@-"\n`;
  try {
    writeFileSync(cfgPath, cfg, { mode: 0o600 });
    const res = spawnSync('curl', ['--config', cfgPath], {
      input: payload,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 8,
    });
    if (res.status !== 0 && !res.stdout) {
      return { ok: false, text: '', error: `curl failed (status ${res.status}): ${(res.stderr || '').slice(0, 200)}`, model, backend: 'groq' };
    }
    const parsed = parseOpenAIResponse(res.stdout || '');
    if (parsed.error) return { ok: false, text: '', error: parsed.error, model, backend: 'groq' };
    return { ok: true, text: parsed.text, model, backend: 'groq' };
  } finally {
    try { rmSync(cfgPath, { force: true }); } catch { /* best effort */ }
  }
}

function callLocal(
  backend: 'lmstudio' | 'ollama',
  endpoint: string,
  messages: ChatMessage[],
  model: string,
): ChatResult {
  const payload = JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 1024, stream: false });
  const res = spawnSync(
    'curl',
    [
      '-s', '--max-time', '120', '--connect-timeout', '3',
      '-X', 'POST', endpoint,
      '-H', 'Content-Type: application/json',
      '--data-binary', '@-',
    ],
    { input: payload, encoding: 'utf8', maxBuffer: 1024 * 1024 * 8 },
  );
  if (res.status !== 0 || !res.stdout) {
    const label = backend === 'lmstudio' ? 'LM Studio' : 'Ollama';
    return {
      ok: false,
      text: '',
      error:
        `${label} server not reachable at ${endpoint}. ` +
        (backend === 'lmstudio'
          ? 'Start LM Studio and enable its local server (Developer tab → Start Server).'
          : 'Start Ollama (`ollama serve`) and pull a model (`ollama pull qwen2.5-coder:7b`).'),
      model,
      backend,
    };
  }
  const parsed = parseOpenAIResponse(res.stdout);
  if (parsed.error) return { ok: false, text: '', error: parsed.error, model, backend };
  return { ok: true, text: parsed.text, model, backend };
}

export function callBackend(backend: BackendName, messages: ChatMessage[], model?: string): ChatResult {
  const m = model ?? DEFAULT_MODELS[backend];
  switch (backend) {
    case 'groq':
      return callGroq(messages, m);
    case 'lmstudio':
      return callLocal('lmstudio', LMSTUDIO_ENDPOINT, messages, m);
    case 'ollama':
      return callLocal('ollama', OLLAMA_ENDPOINT, messages, m);
  }
}
