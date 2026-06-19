// Live probe of Cloudflare Workers AI to capture the real `result` JSON shape.
// Creds passed via env (retrieved from keychain by the runner shell).
// Sequential, cheap models. NEVER writes to /tmp.

const ACCOUNT = process.env.CF_ACCT;
const TOKEN = process.env.CF_TOKEN;

if (!ACCOUNT || !TOKEN) {
  console.error('Missing CF_ACCT / CF_TOKEN env');
  process.exit(1);
}

async function run(model, body, label) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${model}`;
  console.log(`\n=== ${label} :: ${model} ===`);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log('HTTP', res.status);
    try {
      const json = JSON.parse(text);
      // Print the full result object shape
      console.log(JSON.stringify(json, null, 2).slice(0, 4000));
    } catch {
      console.log('RAW:', text.slice(0, 2000));
    }
  } catch (err) {
    console.log('ERR', err.message);
  }
}

// (a) Reasoning-capable model (default model) with think-step-by-step prompt.
await run('@cf/zai-org/glm-4.7-flash', {
  messages: [{ role: 'user', content: 'Think step by step: what is 17 * 23? Show your reasoning then the answer.' }],
  max_tokens: 512,
}, 'reasoning-probe (default model, glm-4.7-flash)');

// (b) Tool-calling probe: pass a `tools` param and a prompt that should invoke it.
await run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
  messages: [{ role: 'user', content: 'What is the weather in Paris? Use the get_weather tool.' }],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get the current weather for a city',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string', description: 'City name' } },
          required: ['city'],
        },
      },
    },
  ],
  max_tokens: 512,
}, 'tool-call-probe (llama-3.3-70b)');

// (c) Try a second reasoning model that emits a distinct reasoning field.
await run('@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', {
  messages: [{ role: 'user', content: 'Think step by step: is 91 prime? Reason then answer.' }],
  max_tokens: 512,
}, 'reasoning-probe-2 (deepseek-r1-distill)');
