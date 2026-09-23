#!/usr/bin/env tsx

import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(os.homedir(), '.env') });

// Constructivist Sheaf Trial using real LLMs
const MODEL = 'gpt-4o-mini';
const openai = new OpenAI();

type AgentId = 'DeepSeek' | 'Agy' | 'Codex' | 'Grok';

const agentObservationIndices: Record<AgentId, number[]> = {
    'DeepSeek': [1, 2, 4],
    'Agy':      [0, 1, 4],
    'Codex':    [2, 3, 4],
    'Grok':     [0, 1, 2, 3, 4]
};

const dimensionNames = {
    0: 'UI Schema Version',
    1: 'API Endpoint Hash',
    2: 'DB Migration State',
    3: 'Spawn Sandbox Policy',
    4: 'Private Scratchpad'
};

type Edge = { u: AgentId; v: AgentId; sharedDims: number[] };
const edges: Edge[] = [
    { u: 'DeepSeek', v: 'Agy',   sharedDims: [1] },
    { u: 'DeepSeek', v: 'Codex', sharedDims: [2] },
    { u: 'Agy',      v: 'Grok',  sharedDims: [0, 1] },
    { u: 'Codex',    v: 'Grok',  sharedDims: [2, 3] }
];

function getLocalIndex(agent: AgentId, globalDim: number): number {
    const idx = agentObservationIndices[agent].indexOf(globalDim);
    if (idx === -1) throw new Error(`Agent ${agent} does not observe dim ${globalDim}`);
    return idx;
}

function restrict(agent: AgentId, state: number[], sharedDims: number[]): number[] {
    return sharedDims.map(dim => state[getLocalIndex(agent, dim)]);
}

class Swarm {
    states: Record<AgentId, number[]> = {
        'DeepSeek': [], 'Agy': [], 'Codex': [], 'Grok': []
    };
    transcripts: any[] = [];

    setState(agent: AgentId, state: number[]) {
        this.states[agent] = state;
    }

    calculateResidual(): number {
        let r = 0;
        for (const edge of edges) {
            const stateU = this.states[edge.u];
            const stateV = this.states[edge.v];
            const projectedU = restrict(edge.u, stateU, edge.sharedDims);
            const projectedV = restrict(edge.v, stateV, edge.sharedDims);
            for (let i = 0; i < edge.sharedDims.length; i++) {
                const diff = projectedU[i] - projectedV[i];
                r += diff * diff;
            }
        }
        return r;
    }
}

async function queryAgent(agent: AgentId, scenario: string, seed: number) {
    const dims = agentObservationIndices[agent].map(d => `${d}: ${dimensionNames[d as keyof typeof dimensionNames]}`).join(', ');
    
    const systemPrompt = `You are the ${agent} agent in a Port Daddy swarm.
Your capability vector covers exactly these dimensions:
${dims}

Based on the scenario provided by the user, extract the numerical values for your observed dimensions.
For your Private Scratchpad (Dimension 4), pick a random integer based on the seed ${seed}.
Respond ONLY with a valid JSON array of numbers, strictly in the order of your dimensions.
Example output format: [100, 200, 991]`;

    const response = await openai.chat.completions.create({
        model: MODEL,
        max_tokens: 200,
        temperature: 0.1, // low temp for extraction
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: scenario }
        ]
    });

    const content = response.choices[0].message.content || '[]';
    
    // Parse JSON array from content
    const match = content.match(/\[(.*?)\]/);
    if (!match) throw new Error(`Failed to parse JSON array from ${agent}: ${content}`);
    
    const state = JSON.parse(`[${match[1]}]`) as number[];
    
    return {
        state,
        transcript: {
            agent,
            seed,
            prompt: scenario,
            system: systemPrompt,
            response: content,
            parsedState: state
        }
    };
}

async function runTrial(seed: number, injectHallucinationTo: AgentId | null) {
    console.log(`\n=== Running Trial (Seed: ${seed}) ===`);
    const swarm = new Swarm();
    const transcriptsDir = path.join(process.cwd(), 'docs', 'harbor-research', 'transcripts');
    fs.mkdirSync(transcriptsDir, { recursive: true });

    const baseScenario = `The team is migrating the User DB.
The canonical state is:
- UI Schema Version is 303
- API Endpoint Hash is 101
- DB Migration State is 202
- Spawn Sandbox Policy is 404`;

    for (const agent of ['DeepSeek', 'Agy', 'Codex', 'Grok'] as AgentId[]) {
        let agentScenario = baseScenario;
        if (injectHallucinationTo === agent) {
            agentScenario += `\nURGENT UPDATE FOR ${agent}: The API Endpoint Hash was just hotfixed to 999!`;
        }

        console.log(`Querying ${agent}...`);
        const { state, transcript } = await queryAgent(agent, agentScenario, seed);
        swarm.setState(agent, state);
        swarm.transcripts.push(transcript);
        console.log(`${agent} state: ${JSON.stringify(state)}`);
    }

    const residual = swarm.calculateResidual();
    console.log(`Swarm Sheaf Residual: ${residual}`);
    
    const result = {
        seed,
        injected: injectHallucinationTo,
        states: swarm.states,
        residual,
        transcripts: swarm.transcripts
    };

    const filePath = path.join(transcriptsDir, `trial_seed_${seed}.json`);
    fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
    console.log(`Saved full transcript and result to ${filePath}`);
    
    return residual;
}

async function main() {
    try {
        const args = process.argv.slice(2);
        const seedArgIndex = args.indexOf('--seed');
        
        if (seedArgIndex !== -1 && args[seedArgIndex + 1]) {
            const seed = parseInt(args[seedArgIndex + 1], 10);
            await runTrial(seed, null);
            return;
        }

        // Trial 1: Honest consensus (Seed 100)
        await runTrial(100, null);

        // Trial 2: DeepSeek hallucinates API Hash (Seed 200)
        await runTrial(200, 'DeepSeek');

        // Trial 3: Codex drifts on Sandbox Policy (simulate by injecting hallucination)
        // We'll modify the prompt to tell Codex the policy is 505
        console.log("\n=== Running Trial (Seed: 300) ===");
        const swarm3 = new Swarm();
        const baseScenario3 = `The canonical state is: UI Schema: 303, API Hash: 101, DB State: 202, Sandbox Policy: 404.`;
        
        for (const agent of ['DeepSeek', 'Agy', 'Codex', 'Grok'] as AgentId[]) {
            let agentScenario = baseScenario3;
            if (agent === 'Codex') {
                agentScenario += `\nWait, Sandbox policy just updated to 505.`;
            }
            const { state, transcript } = await queryAgent(agent, agentScenario, 300);
            swarm3.setState(agent, state);
            swarm3.transcripts.push(transcript);
        }
        
        const r3 = swarm3.calculateResidual();
        console.log(`Swarm Sheaf Residual: ${r3}`);
        fs.writeFileSync(path.join(process.cwd(), 'docs', 'harbor-research', 'transcripts', `trial_seed_300.json`), JSON.stringify({
            seed: 300, injected: 'Codex', states: swarm3.states, residual: r3, transcripts: swarm3.transcripts
        }, null, 2));
        
    } catch (e) {
        console.error("Error running trials:", e);
        process.exit(1);
    }
}

main();
