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
    4: 'Visual Asset Readiness (Nano Banana)',
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
        'PM': [], 'Design': [], 'Dev': [], 'Critic': []
    };
    transcripts: any[] = [];

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
                r += diff * diff;
            }
            edgeResiduals[`${edge.u}-${edge.v}`] = r;
            total += r;
        }
        return { total, edgeResiduals };
    }
}

async function queryAgent(agent: AgentId, epoch: number, scenario: string) {
    const dims = agentObservationIndices[agent].map(d => `${d}: ${dimensionNames[d as keyof typeof dimensionNames]}`).join('\n');
    
    const systemPrompt = `You are the ${agent} agent in a multi-agent swarm tasked with building a web app from 0 to 60 over 30 minutes.
Your role focuses on these specific capability dimensions:
${dims}

Based on the scenario description for Epoch ${epoch}, evaluate the numerical values (0 to 100) for your observed dimensions.
Respond ONLY with a valid JSON array of numbers, strictly in the order of your dimensions.
Example output format: [0, 50, 100]`;

    const response = await openai.chat.completions.create({
        model: MODEL,
        max_tokens: 200,
        temperature: 0.7,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: scenario }
        ]
    });

    const content = response.choices[0].message.content || '[]';
    
    // Parse JSON array from content
    const match = content.match(/\[(.*?)\]/);
    if (!match) {
        console.warn(`Failed to parse JSON array from ${agent}: ${content}. Defaulting to zeros.`);
        return { state: agentObservationIndices[agent].map(() => 0), transcript: null };
    }
    
    const state = JSON.parse(`[${match[1]}]`) as number[];
    
    return {
        state,
        transcript: {
            agent,
            epoch,
            system: systemPrompt,
            response: content,
            parsedState: state
        }
    };
}

const epochs = [
    { e: 1, desc: "Kickoff. PM has drafted the initial requirements and a very rough sitemap. Design hasn't started yet. Nothing is coded." },
    { e: 2, desc: "PM finalizes the Requirements. Design starts mocking up the Theme (Dark/Light) and initial Nano Banana visual assets. Sitemap is 50% done." },
    { e: 3, desc: "Sitemap is locked (100%). Design finishes Theme and Visual Assets (80%). Dev starts looking at the design but hasn't coded much yet." },
    { e: 4, desc: "Dev starts heavy implementation of the Theme. Code Coverage hits 40%. Critic agent reviews the mockups and flags a major WCAG contrast issue." },
    { e: 5, desc: "Design fixes the WCAG contrast issue (WCAG Score 90%). Dev updates the Code to match the fixed Theme. Assets are 100% ready." },
    { e: 6, desc: "Dev pushes hard on implementation. Code Coverage is 70%. UI Polish is starting to improve. PM is happy with Requirements (100%)." },
    { e: 7, desc: "DIVERGENCE INJECT: Dev thinks the Theme is complete (100%), but Design just secretly changed the typography causing a mismatch! Dev's UI Polish is 50, Design's UI Polish is 90." },
    { e: 8, desc: "Critic notices the typography mismatch and yells at Dev. Dev scrambles to fix it. Code Coverage is 90%. WCAG remains 90%." },
    { e: 9, desc: "Dev successfully aligns with Design. Theme, Assets, and Code are all highly synchronized (95%+). UI Polish is looking great." },
    { e: 10, desc: "Final Launch. Everything is complete (100%). Sitemap, Requirements, Theme, WCAG, Assets, Code, and UI Polish are all perfect." }
];

async function main() {
    console.log("=== Starting Web App Swarm Trial (0 to 60) ===");
    const transcriptsDir = path.join(process.cwd(), 'docs', 'harbor-research', 'transcripts');
    fs.mkdirSync(transcriptsDir, { recursive: true });
    
    const timeseries = [];
    
    for (const epoch of epochs) {
        console.log(`\n--- Epoch ${epoch.e} ---`);
        console.log(`Scenario: ${epoch.desc}`);
        
        const swarm = new Swarm();
        
        for (const agent of ['PM', 'Design', 'Dev', 'Critic'] as AgentId[]) {
            let scenarioDesc = epoch.desc;
            
            // Inject the divergence in Epoch 7 directly into their prompts so they output different states
            if (epoch.e === 7) {
                if (agent === 'Dev') scenarioDesc = "You think the Theme is 100% complete and UI Polish is 50. You don't know about the typography change.";
                if (agent === 'Design') scenarioDesc = "You just changed the typography! Theme is 100, UI Polish is 90. Dev hasn't caught up.";
            }
            
            const { state, transcript } = await queryAgent(agent, epoch.e, scenarioDesc);
            swarm.setState(agent, state);
            if (transcript) swarm.transcripts.push(transcript);
            console.log(`[${agent}] state: ${JSON.stringify(state)}`);
        }
        
        const residuals = swarm.calculateResiduals();
        console.log(`Total Sheaf Residual: ${residuals.total}`);
        
        timeseries.push({
            epoch: epoch.e,
            description: epoch.desc,
            states: swarm.states,
            residuals: residuals,
            transcripts: swarm.transcripts
        });
    }

    const filePath = path.join(transcriptsDir, `trial_webapp_0_to_60.json`);
    fs.writeFileSync(filePath, JSON.stringify({
        metadata: {
            dimensions: dimensionNames,
            agents: agentObservationIndices,
            edges: edges
        },
        timeseries
    }, null, 2));
    
    console.log(`\nSaved full 10-epoch timeseries to ${filePath}`);
}

main().catch(console.error);
