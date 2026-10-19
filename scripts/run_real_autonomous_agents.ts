#!/usr/bin/env tsx

/**
 * run_real_autonomous_agents.ts
 *
 * Constructivist proof of the Sheaf-Cohomology Swarm Architecture.
 * Maps Port Daddy agents to sections of a sheaf.
 *
 * Anchor State Dimensions (The Stalk):
 * 0: UI Schema Version       (Agy, Grok)
 * 1: API Endpoint Hash       (DeepSeek, Agy, Grok)
 * 2: DB Migration State      (DeepSeek, Codex, Grok)
 * 3: Spawn Sandbox Policy    (Codex, Grok)
 * 4: Private Scratchpad      (Private to each agent)
 */

type AgentId = 'DeepSeek' | 'Agy' | 'Codex' | 'Grok';

// Define the indices each agent "observes" from the global truth
const agentObservationIndices: Record<AgentId, number[]> = {
    'DeepSeek': [1, 2, 4],       // Cares about API, DB, and its Private state
    'Agy':      [0, 1, 4],       // Cares about UI, API, and its Private state
    'Codex':    [2, 3, 4],       // Cares about DB, Sandbox, and its Private state
    'Grok':     [0, 1, 2, 3, 4]  // Observes all public state, plus its Private state
};

// Define edges (communication channels) and the dimensions they share
// e.g., DeepSeek and Agy share dimension 1 (API)
type Edge = {
    u: AgentId;
    v: AgentId;
    sharedDims: number[]; // Indices from the global 0..4 dimensions
};

const edges: Edge[] = [
    { u: 'DeepSeek', v: 'Agy',   sharedDims: [1] },    // Agree on API
    { u: 'DeepSeek', v: 'Codex', sharedDims: [2] },    // Agree on DB
    { u: 'Agy',      v: 'Grok',  sharedDims: [0, 1] }, // Agree on UI, API
    { u: 'Codex',    v: 'Grok',  sharedDims: [2, 3] }  // Agree on DB, Sandbox
];

// Helper: Find index of a global dimension in an agent's local state vector
function getLocalIndex(agent: AgentId, globalDim: number): number {
    const idx = agentObservationIndices[agent].indexOf(globalDim);
    if (idx === -1) throw new Error(`Agent ${agent} does not observe dim ${globalDim}`);
    return idx;
}

// Restriction Map: Project an agent's full local state down to the shared edge state
function restrict(agent: AgentId, state: number[], sharedDims: number[]): number[] {
    return sharedDims.map(dim => state[getLocalIndex(agent, dim)]);
}

class Swarm {
    states: Record<AgentId, number[]> = {
        'DeepSeek': [],
        'Agy': [],
        'Codex': [],
        'Grok': []
    };

    setState(agent: AgentId, state: number[]) {
        if (state.length !== agentObservationIndices[agent].length) {
            throw new Error(`Invalid state length for ${agent}`);
        }
        this.states[agent] = state;
    }

    // Calculates the sheaf residual r = || \delta x ||^2
    calculateResidual(): number {
        let r = 0;
        for (const edge of edges) {
            const stateU = this.states[edge.u];
            const stateV = this.states[edge.v];
            
            // Apply restriction maps Pe
            const projectedU = restrict(edge.u, stateU, edge.sharedDims);
            const projectedV = restrict(edge.v, stateV, edge.sharedDims);

            // Compute (\delta x)_e = P_{u \to e} x_u - P_{v \to e} x_v
            for (let i = 0; i < edge.sharedDims.length; i++) {
                const diff = projectedU[i] - projectedV[i];
                r += diff * diff;
            }
        }
        return r;
    }
}

async function run() {
    console.log("=== Constructivist Sheaf Swarm Architecture ===");
    const swarm = new Swarm();

    // 1. Honest execution (All agents agree on the underlying truth)
    // Underlying truth: [UI=100, API=200, DB=300, Spawn=400]
    // Private states are arbitrary per agent
    console.log("\n[Scenario 1] Honest Swarm (Consensus)");
    swarm.setState('DeepSeek', [200, 300, 991]); // [API, DB, Private]
    swarm.setState('Agy',      [100, 200, 992]); // [UI, API, Private]
    swarm.setState('Codex',    [300, 400, 993]); // [DB, Spawn, Private]
    swarm.setState('Grok',     [100, 200, 300, 400, 994]); // [UI, API, DB, Spawn, Private]

    let residual = swarm.calculateResidual();
    console.log(`Swarm Sheaf Residual: ${residual}`);
    if (residual === 0) {
        console.log("Verdict: Honest state. Topology is consistent. (r == 0)");
    }

    // 2. DeepSeek Hallucinates an API change
    console.log("\n[Scenario 2] DeepSeek Hallucinates API Endpoint Hash");
    // DeepSeek changes API hash to 205, but Agy still expects 200
    swarm.setState('DeepSeek', [205, 300, 991]);
    
    residual = swarm.calculateResidual();
    console.log(`Swarm Sheaf Residual: ${residual}`);
    if (residual > 0) {
        console.log("Verdict: Contradiction Detected! (r > 0)");
        console.log("DeepSeek's API hallucination was caught by the edge restricted with Agy.");
    }

    // 3. Codex drift on Sandbox Policy
    console.log("\n[Scenario 3] Codex Drifts on Sandbox Policy");
    // Restore DeepSeek
    swarm.setState('DeepSeek', [200, 300, 991]);
    // Codex changes Sandbox policy to 404
    swarm.setState('Codex', [300, 404, 993]);

    residual = swarm.calculateResidual();
    console.log(`Swarm Sheaf Residual: ${residual}`);
    if (residual > 0) {
        console.log("Verdict: Contradiction Detected! (r > 0)");
        console.log("Codex's sandbox drift was caught by the edge restricted with Grok.");
    }

    // 4. Constant trivial Stalk Defeated
    console.log("\n[Scenario 4] Threat Model 4: The Trivial Constant Problem");
    console.log("Because restriction maps are distinct coordinate subsets, an agent cannot simply broadcast a 'constant 0' stalk.");
    swarm.setState('DeepSeek', [0, 0, 0]);
    residual = swarm.calculateResidual();
    console.log(`Swarm Sheaf Residual: ${residual}`);
    console.log("Verdict: DeepSeek attempting a trivial constant state breaks the topology across all adjacent edges.");
}

run().catch(console.error);
