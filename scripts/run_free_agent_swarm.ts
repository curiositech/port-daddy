#!/usr/bin/env tsx

import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(os.homedir(), '.env') });

const MODEL = 'gpt-4o-mini';
const openai = new OpenAI();

type AgentId = 'PM' | 'Design' | 'Dev' | 'Critic';

const agentObservationIndices: Record<AgentId, number[]> = {
    'PM':     [0, 1, 3],
    'Design': [0, 2, 3, 4, 6],
    'Dev':    [0, 2, 4, 5, 6],
    'Critic': [1, 2, 3, 5, 6]
};

const dimensionNames = {
    0: 'Sitemap Completeness',
    1: 'Requirements Clarity',
    2: 'Theme Consistency (Dark/Light)',
    3: 'WCAG Compliance Score',
    4: 'Visual Asset Readiness',
    5: 'Code Coverage / Implementation',
    6: 'UI Polish Score'
};

type Edge = { u: AgentId; v: AgentId; sharedDims: number[] };
const edges: Edge[] = [
    { u: 'PM',     v: 'Design', sharedDims: [0, 3] },
    { u: 'PM',     v: 'Dev',    sharedDims: [0] },
    { u: 'PM',     v: 'Critic', sharedDims: [1, 3] },
    { u: 'Design', v: 'Dev',    sharedDims: [0, 2, 4, 6] },
    { u: 'Design', v: 'Critic', sharedDims: [2, 3, 6] },
    { u: 'Dev',    v: 'Critic', sharedDims: [2, 5, 6] }
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
        'PM': [0,0,0], 'Design': [0,0,0,0,0], 'Dev': [0,0,0,0,0], 'Critic': [0,0,0,0,0]
    };
    
    setState(agent: AgentId, state: number[]) {
        this.states[agent] = state;
    }

    calculateResiduals(): { total: number; edgeResiduals: Record<string, number> } {
        let total = 0;
        const edgeResiduals: Record<string, number> = {};
        
        for (const edge of edges) {
            const stateU = this.states[edge.u];
            const stateV = this.states[edge.v];
            if (stateU.length === 0 || stateV.length === 0) continue;
            
            const projectedU = restrict(edge.u, stateU, edge.sharedDims);
            const projectedV = restrict(edge.v, stateV, edge.sharedDims);
            
            let r = 0;
            for (let i = 0; i < edge.sharedDims.length; i++) {
                const diff = projectedU[i] - projectedV[i];
                r += (diff * diff) / 100.0; // scale down the residual to avoid massive numbers
            }
            edgeResiduals[`${edge.u}-${edge.v}`] = Math.round(r);
            total += r;
        }
        return { total: Math.round(total), edgeResiduals };
    }
}

type MessageHistory = { sender: AgentId | 'System'; message: string }[];

async function queryAgent(agent: AgentId, turn: number, history: MessageHistory) {
    const dims = agentObservationIndices[agent].map(d => `Index ${agentObservationIndices[agent].indexOf(d)}: ${dimensionNames[d as keyof typeof dimensionNames]} (Global Dim ${d})`).join('\n');
    
    const systemPrompt = `You are the ${agent} agent in a 4-agent swarm (PM, Design, Dev, Critic) building a web app.
Goal: Construct a web app with a detailed sitemap, designs for mobile and web, dark/light theme, and strict WCAG compliance.
You must talk to the other agents to coordinate your work and reach 100 on all completion metrics.

Your specific capability metrics are:
${dims}

The team chat history will be provided. You must read it, internally reason about what to do next, formulate a message to the group, and output your current evaluation of your metrics (0 to 100).
If you just completed some work or reached an agreement, your metrics should increase.

You must reply with a strictly valid JSON object matching this schema:
{
  "thought_bubble": "Your internal, private reasoning.",
  "message_to_team": "The actual message you send to the group chat.",
  "state_vector": [number, number, ...] // Array of integers 0-100 matching EXACTLY your capability indices
}`;

    const formattedHistory = history.map(h => `${h.sender}: ${h.message}`).join('\n\n');

    const response = await openai.chat.completions.create({
        model: MODEL,
        response_format: { type: 'json_object' },
        temperature: 0.8,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Chat History:\n${formattedHistory}\n\nIt is your turn to speak, ${agent}.` }
        ]
    });

    const content = response.choices[0].message.content || '{}';
    
    try {
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed.state_vector) || parsed.state_vector.length !== agentObservationIndices[agent].length) {
            throw new Error(`Invalid state vector length. Expected ${agentObservationIndices[agent].length}`);
        }
        return parsed;
    } catch (e) {
        console.warn(`Failed to parse JSON for ${agent}. Error: ${e}. Content: ${content}`);
        // Fallback safely
        return {
            thought_bubble: "I got confused.",
            message_to_team: "I'm having trouble understanding the current state.",
            state_vector: agentObservationIndices[agent].map(() => 0)
        };
    }
}

async function main() {
    console.log("=== Starting True Free-Swarm Trial ===");
    const transcriptsDir = path.join(process.cwd(), 'docs', 'harbor-research', 'transcripts');
    fs.mkdirSync(transcriptsDir, { recursive: true });
    
    const timeseries = [];
    const swarm = new Swarm();
    const history: MessageHistory = [
        { sender: 'System', message: 'Project Kickoff. Construct a web app with a detailed sitemap, mobile/web designs, dark/light theme, and strict WCAG compliance.' }
    ];
    
    const turnOrder: AgentId[] = ['PM', 'Design', 'Dev', 'Critic'];
    const maxTurns = 15;
    
    for (let turn = 1; turn <= maxTurns; turn++) {
        const activeAgent = turnOrder[(turn - 1) % turnOrder.length];
        console.log(`\n--- Turn ${turn}: ${activeAgent}'s turn ---`);
        
        const response = await queryAgent(activeAgent, turn, history);
        
        console.log(`[${activeAgent} Thought]: ${response.thought_bubble}`);
        console.log(`[${activeAgent} Message]: ${response.message_to_team}`);
        console.log(`[${activeAgent} State]: ${JSON.stringify(response.state_vector)}`);
        
        // Update history and state
        history.push({ sender: activeAgent, message: response.message_to_team });
        swarm.setState(activeAgent, response.state_vector);
        
        const residuals = swarm.calculateResiduals();
        console.log(`Total Sheaf Residual: ${residuals.total}`);
        
        // Deep copy states for logging
        const currentStates = JSON.parse(JSON.stringify(swarm.states));
        
        timeseries.push({
            turn: turn,
            active_agent: activeAgent,
            thought_bubble: response.thought_bubble,
            message_to_team: response.message_to_team,
            states: currentStates,
            residuals: residuals
        });
        
        // Break early if all states are exactly 100
        let allComplete = true;
        for (const key of Object.keys(currentStates)) {
            if (currentStates[key as AgentId].some((v: number) => v < 100)) {
                allComplete = false;
                break;
            }
        }
        
        if (allComplete && turn >= 4) {
            console.log("\n*** Swarm reached 100% consensus and completion! ***");
            break;
        }
    }

    const filePath = path.join(transcriptsDir, `free_swarm_trial.json`);
    fs.writeFileSync(filePath, JSON.stringify({
        metadata: {
            dimensions: dimensionNames,
            agents: agentObservationIndices,
            edges: edges
        },
        timeseries
    }, null, 2));
    
    console.log(`\nSaved full timeseries to ${filePath}`);
}

main().catch(console.error);
