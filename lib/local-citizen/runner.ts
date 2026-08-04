/**
 * Local Citizen Runner — the deterministic-injection agent loop for hookless
 * OpenAI-compatible substrates (Groq, LM Studio, Ollama).
 *
 * Why this exists: these substrates expose NO lifecycle hooks. There is no
 * daemon to intercept a destructive tool call or to inject coordination state
 * on each turn. So the runner OWNS the loop and does the injection itself:
 *
 *   request = [ Port Daddy Citizenship system prompt ]
 *           + [ LIVE COORDINATION STATE block from the Ink Cloud ]
 *           + [ the task ]
 *
 * The system prompt is the suggestibility envelope; the per-turn injection is
 * the live ground truth the hooks can't give. Together they ARE the citizenship
 * mechanism on these backends.
 *
 * Usage (via the scripts/local-citizen.mjs entrypoint or tsx):
 *   tsx lib/local-citizen/runner.ts \
 *     --backend groq --model llama-3.1-8b-instant \
 *     --task "Edit lib/foo.ts to add a retry" \
 *     --target-file lib/foo.ts \
 *     [--ink-cloud <path>] [--self-actor <id>] [--project-root <dir>] [--print-prompt]
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  readInkCloud,
  readInkCloudFromText,
  projectInkCloud,
  type InkCloud,
} from './ink-cloud.js';
import type { VoiceLogEvent } from '../squid/reconcile-contract.js';
import { callBackend, type BackendName, type ChatMessage, type ChatResult } from './backends.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = join(__dirname, '..', '..', 'prompts', 'port-daddy-citizen.md');

export interface RunInput {
  backend: BackendName;
  task: string;
  model?: string;
  targetFiles?: string[];
  selfActor?: string;
  /** override Ink Cloud location; if inkCloudText is set it wins */
  inkCloudPath?: string;
  inkCloudText?: string;
  /**
   * Project root for the exact-root pheromone filter, mirroring the rule
   * `bin/pd-hook-prompt` applies. Defaults to `process.cwd()`; pass it
   * explicitly when the runner is driven from outside the repo it is working.
   */
  projectRoot?: string;
}

export interface ComposedRequest {
  messages: ChatMessage[];
  injection: string;
  cloud: InkCloud;
  /**
   * The VoiceLog receipt for this turn — whether the harness spoke, had nothing
   * to say, or was silenced by its own bounds, in the same shape
   * `bin/pd-hook-prompt` writes. Exposed so a hookless turn can be made as
   * auditable as a hooked one; NOTE that nothing persists it yet, so hookless
   * turns do not appear in `pd squid voice` until a writer lands.
   */
  voice: VoiceLogEvent;
}

export function loadCitizenSystemPrompt(): string {
  return readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
}

/**
 * Compose the OpenAI-style message array: system = citizenship prompt; user =
 * the live injection block (if any) followed by the task. This is the whole
 * point of the runner — deterministic, every turn, no hook required.
 */
export function composeRequest(input: RunInput): ComposedRequest {
  const cloud = input.inkCloudText != null
    ? readInkCloudFromText(input.inkCloudText)
    : readInkCloud(input.inkCloudPath);

  const projection = projectInkCloud(cloud, {
    targetFiles: input.targetFiles,
    selfActor: input.selfActor,
    projectRoot: input.projectRoot,
  });
  const injection = projection.text;

  const userParts: string[] = [];
  if (injection) userParts.push(injection);
  userParts.push(`TASK:\n${input.task}`);

  const messages: ChatMessage[] = [
    { role: 'system', content: loadCitizenSystemPrompt() },
    { role: 'user', content: userParts.join('\n\n') },
  ];
  return { messages, injection, cloud, voice: projection.event };
}

export function runTurn(input: RunInput): { request: ComposedRequest; result: ChatResult } {
  const request = composeRequest(input);
  const result = callBackend(input.backend, request.messages, input.model);
  return { request, result };
}

// ---- CLI ---------------------------------------------------------------

function parseArgs(argv: string[]): RunInput & { printPrompt?: boolean } {
  const out: Record<string, string> = {};
  const targetFiles: string[] = [];
  let printPrompt = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--print-prompt') { printPrompt = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      i++;
      if (key === 'target-file') targetFiles.push(val);
      else out[key] = val;
    }
  }
  if (!out.backend) throw new Error('--backend is required (groq|lmstudio|ollama)');
  if (!out.task && !printPrompt) throw new Error('--task is required');
  return {
    backend: out.backend as BackendName,
    task: out.task ?? '',
    model: out.model,
    targetFiles,
    selfActor: out['self-actor'],
    inkCloudPath: out['ink-cloud'],
    projectRoot: out['project-root'],
    printPrompt,
  };
}

function isMain(): boolean {
  return process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const input = parseArgs(process.argv.slice(2));
  const request = composeRequest(input);

  console.log('--- COMPOSED REQUEST ---');
  console.log(`backend: ${input.backend}  model: ${input.model ?? '(default)'}`);
  if (request.injection) {
    console.log('\n[injected live coordination block]\n' + request.injection);
  } else {
    console.log('\n[no live coordination block — Ink Cloud quiet / no conflicts]');
  }
  if (input.printPrompt) {
    console.log('\n[system prompt length]', request.messages[0].content.length, 'chars');
    process.exit(0);
  }

  console.log('\n--- CALLING BACKEND ---');
  const result = callBackend(input.backend, request.messages, input.model);
  if (!result.ok) {
    console.error(`\n[backend error: ${result.backend}/${result.model}] ${result.error}`);
    process.exit(1);
  }
  console.log(`\n--- MODEL TURN (${result.backend}/${result.model}) ---\n`);
  console.log(result.text);
}
