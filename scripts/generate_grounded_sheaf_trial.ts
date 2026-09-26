#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';

// Define the 7 global capability dimensions
const dimensionNames: Record<number, string> = {
    0: 'Sitemap Completeness',
    1: 'Requirements Clarity',
    2: 'Theme Consistency (Dark/Light)',
    3: 'WCAG Compliance Score',
    4: 'Visual Asset Readiness',
    5: 'Code Coverage / Implementation',
    6: 'UI Polish Score'
};

type AgentId = 'PM' | 'Design' | 'Dev' | 'Critic';

const agentObservationIndices: Record<AgentId, number[]> = {
    'PM': [0, 1, 3],
    'Design': [0, 2, 3, 4, 6],
    'Dev': [0, 2, 4, 5, 6],
    'Critic': [1, 2, 3, 5, 6]
};

const agentRoles: Record<AgentId, string> = {
    'PM': 'System Architect & Product Manager',
    'Design': 'UI/UX Designer & Design System Lead',
    'Dev': 'Frontend & Fullstack Engineer',
    'Critic': 'QA Auditor & WCAG Accessibility Lead'
};

type EdgeDef = { u: AgentId; v: AgentId; sharedDims: number[] };
const edges: EdgeDef[] = [
    { u: 'PM', v: 'Design', sharedDims: [0, 3] },
    { u: 'PM', v: 'Dev', sharedDims: [0] },
    { u: 'PM', v: 'Critic', sharedDims: [1, 3] },
    { u: 'Design', v: 'Dev', sharedDims: [0, 2, 4, 6] },
    { u: 'Design', v: 'Critic', sharedDims: [2, 3, 6] },
    { u: 'Dev', v: 'Critic', sharedDims: [2, 5, 6] }
];

type SimplexDef = { id: string; name: string; agents: [AgentId, AgentId, AgentId]; sharedDims: number[] };
const simplices: SimplexDef[] = [
    { id: 'tau_sitemap', name: 'Architecture Review Triad', agents: ['PM', 'Design', 'Dev'], sharedDims: [0] },
    { id: 'tau_wcag', name: 'Accessibility Review Triad', agents: ['PM', 'Design', 'Critic'], sharedDims: [3] },
    { id: 'tau_ui', name: 'Design-Code Review Triad', agents: ['Design', 'Dev', 'Critic'], sharedDims: [2, 6] }
];

function getLocalIndex(agent: AgentId, globalDim: number): number {
    const idx = agentObservationIndices[agent].indexOf(globalDim);
    if (idx === -1) throw new Error(`Agent ${agent} does not observe dim ${globalDim}`);
    return idx;
}

function restrict(agent: AgentId, state: number[], sharedDims: number[]): number[] {
    return sharedDims.map(dim => state[getLocalIndex(agent, dim)]);
}

// 12 Concrete Grounded Turns
interface RawTurn {
    turn: number;
    activeAgent: AgentId;
    stageCue: string;
    thoughtBubble: string;
    teamMessage: string;
    toolCall: {
        toolName: string;
        args: Record<string, any>;
        result: Record<string, any>;
    };
    stateDelta: Record<AgentId, number[]>;
    edgeOverrides?: Record<string, number>;
}

const rawTurns: RawTurn[] = [
    {
        turn: 1,
        activeAgent: 'PM',
        stageCue: '🎬 Turn 1: PM scaffolds Product Spec and specifies initial Web & Mobile sitemap hierarchy.',
        thoughtBubble: 'I need to lay down a rock-solid sitemap for both desktop and mobile viewports, defining our 6 core pages: Home, Pricing, Docs, Dashboard, Settings, and Auth. I will also lock the acceptance criteria: AA WCAG compliance is mandatory.',
        teamMessage: 'Team: I have initialized the repository spec. Our sitemap requires 6 distinct route trees with mobile navigation drawers. Design, please establish our token palette; Critic, prepare the automated contrast test harness.',
        toolCall: {
            toolName: 'pm_scaffold_sitemap',
            args: { routes: ['/', '/pricing', '/docs', '/dashboard', '/settings', '/auth'], viewports: ['mobile-390px', 'desktop-1440px'] },
            result: { status: 'COMMITTED', sitemapVersion: '1.0.0', routeCount: 6, completeness: 50 }
        },
        stateDelta: {
            'PM': [50, 70, 0],
            'Design': [0, 0, 0, 0, 0],
            'Dev': [0, 0, 0, 0, 0],
            'Critic': [0, 0, 0, 0, 0]
        }
    },
    {
        turn: 2,
        activeAgent: 'Design',
        stageCue: '🎬 Turn 2: Design exports token system and dark/light palettes with initial Nano Banana visual assets.',
        thoughtBubble: 'I will establish CSS design tokens for Dark and Light themes. Let’s pick modern slate neutrals and electric cyan accents. I will also export SVG hero illustrations. Note: I am setting primary button text to #8892b0 on dark background.',
        teamMessage: 'I have checked in the design system tokens in tokens.json! Dark mode (#0f172a base) and Light mode (#f8fafc base) are fully specified. Dev can begin consuming the token variables.',
        toolCall: {
            toolName: 'design_export_tokens',
            args: { themeModes: ['light', 'dark'], primaryColor: '#38bdf8', secondaryColor: '#8892b0', assetFormat: 'svg' },
            result: { tokensExported: 48, assetCount: 6, themeConsistency: 80, assetReadiness: 70 }
        },
        stateDelta: {
            'PM': [50, 70, 0],
            'Design': [50, 80, 80, 70, 60],
            'Dev': [0, 0, 0, 0, 0],
            'Critic': [0, 0, 0, 0, 0]
        }
    },
    {
        turn: 3,
        activeAgent: 'Dev',
        stageCue: '🎬 Turn 3: Dev scaffolds Next.js App Router structure and integrates Tailwind v4 token system.',
        thoughtBubble: 'Reading the sitemap from PM and tokens from Design. I am scaffolding the layout.tsx and all 6 page routes with responsive breakpoints. The sitemap structure is now 100% matched in code.',
        teamMessage: 'Routes scaffolded! All 6 paths are created with dynamic layout wrappers for mobile drawer and desktop navbar. Design tokens are mapped into Tailwind CSS.',
        toolCall: {
            toolName: 'dev_scaffold_routes',
            args: { framework: 'Next.js App Router', routesCreated: 6, tokenBindings: 48 },
            result: { tscExitCode: 0, routesOperational: 6, sitemapCoverage: 100, codeCoverage: 35 }
        },
        stateDelta: {
            'PM': [100, 70, 0],
            'Design': [100, 80, 80, 70, 60],
            'Dev': [100, 80, 70, 35, 50],
            'Critic': [0, 0, 0, 0, 0]
        }
    },
    {
        turn: 4,
        activeAgent: 'Critic',
        stageCue: '⚠️ Turn 4: Critic runs automated axe-core accessibility audit; flags critical WCAG contrast failure on theme tokens.',
        thoughtBubble: 'Audit time. Let’s run axe-core against Design’s tokens. Look at this: text color #8892b0 against #0f172a gives a contrast ratio of only 3.2:1! WCAG AA requires minimum 4.5:1 for body and 3.0:1 for large text. Design claimed WCAG was 80%, but this fails compliance hard!',
        teamMessage: 'BLOCKER: Axe-core audit failed on Dark Mode tokens. Secondary text (#8892b0 on #0f172a) yields 3.2:1 contrast ratio, violating WCAG AA 1.4.3. Design must bump luminosity to at least #94a3b8.',
        toolCall: {
            toolName: 'critic_axe_core_audit',
            args: { standard: 'WCAG-2.1-AA', foreground: '#8892b0', background: '#0f172a', targetRatio: 4.5 },
            result: { measuredRatio: 3.22, compliant: false, violations: ['1.4.3 Contrast (Minimum)'], wcagScore: 35 }
        },
        stateDelta: {
            'PM': [100, 85, 40],
            'Design': [100, 80, 85, 70, 60],
            'Dev': [100, 80, 70, 40, 50],
            'Critic': [85, 80, 35, 40, 50]
        },
        edgeOverrides: {
            'Design-Critic': 30.0,
            'Dev-Critic': -25.0
        }
    },
    {
        turn: 5,
        activeAgent: 'Design',
        stageCue: '🛠️ Turn 5: Design patches token palette to #cbd5e1, elevating contrast ratio to 7.1:1 (AAA compliance).',
        thoughtBubble: 'Critic is completely right. My secondary neutral was too dim. I am updating secondaryColor to #cbd5e1 which delivers a 7.1:1 ratio. Re-exporting tokens.json now.',
        teamMessage: 'Patched! I have revised tokens.json: secondary neutral is now #cbd5e1, which delivers 7.1:1 contrast against #0f172a. Critic, please re-run the verification.',
        toolCall: {
            toolName: 'design_patch_tokens',
            args: { secondaryColor: '#cbd5e1', testTarget: '#0f172a' },
            result: { expectedRatio: 7.14, level: 'AAA', tokensReplaced: 12, wcagConfidence: 95 }
        },
        stateDelta: {
            'PM': [100, 85, 80],
            'Design': [100, 95, 95, 85, 75],
            'Dev': [100, 80, 70, 45, 50],
            'Critic': [85, 80, 35, 40, 50]
        },
        edgeOverrides: {
            'Design-Dev': 25.0
        }
    },
    {
        turn: 6,
        activeAgent: 'Critic',
        stageCue: '✅ Turn 6: Critic re-verifies contrast tokens; certifies WCAG AAA compliance and clears triadic review curl.',
        thoughtBubble: 'Testing the updated token file. Contrast ratio is 7.14:1! Clean pass across both dark (#0f172a) and light (#ffffff) backdrops. WCAG score is now verified at 95. Triadic residual with Design drops to 0.',
        teamMessage: 'Axe audit PASSED! Contrast verified at 7.14:1. All color tokens are certified WCAG AAA compliant. Dev has green light to finalize component theming.',
        toolCall: {
            toolName: 'critic_verify_tokens',
            args: { file: 'tokens.json', standard: 'WCAG-2.1-AAA' },
            result: { status: 'CERTIFIED', measuredRatio: 7.14, violations: [], wcagScore: 95 }
        },
        stateDelta: {
            'PM': [100, 90, 95],
            'Design': [100, 95, 95, 85, 75],
            'Dev': [100, 80, 70, 50, 50],
            'Critic': [90, 95, 95, 50, 70]
        }
    },
    {
        turn: 7,
        activeAgent: 'Dev',
        stageCue: '🎬 Turn 7: Dev implements Theme Provider, Navigation Drawer, and Vitest component suites.',
        thoughtBubble: 'Integrating the patched tokens into our theme toggle component and navigation drawer. Writing automated tests using Vitest and React Testing Library. Code coverage is climbing to 75%.',
        teamMessage: 'Theme toggle (light/dark with system preference fallback) and responsive mobile drawer are wired up. 24 unit tests passing in Vitest.',
        toolCall: {
            toolName: 'dev_run_vitest',
            args: { suites: ['ThemeToggle.test.tsx', 'NavDrawer.test.tsx'], coverageThreshold: 70 },
            result: { testsPassed: 24, testsFailed: 0, coveragePercentage: 76.5, tscErrors: 0 }
        },
        stateDelta: {
            'PM': [100, 90, 95],
            'Design': [100, 95, 95, 85, 75],
            'Dev': [100, 95, 85, 75, 70],
            'Critic': [90, 95, 95, 75, 70]
        }
    },
    {
        turn: 8,
        activeAgent: 'Design',
        stageCue: '⚠️ Turn 8: DIVERGENCE INJECTED — Design secretly switches font family from Inter to Outfit, creating an uncoordinated style skew.',
        thoughtBubble: 'I want a fresher look for the brand! I just changed font-family in Figma to Outfit and altered the letter-spacing tokens, but I haven’t posted to the team chat yet. My UI Polish is 95, but Dev is still on Inter (UI Polish 70).',
        teamMessage: 'Visual assets are 100% complete with custom SVG illustrations for Docs and Pricing! I also polished the card elevation shadows.',
        toolCall: {
            toolName: 'design_update_typography',
            args: { fontFamily: 'Outfit, sans-serif', letterSpacing: '-0.02em', announced: false },
            result: { fontTokensUpdated: 8, noticeSent: false, designUiPolish: 95 }
        },
        stateDelta: {
            'PM': [100, 90, 95],
            'Design': [100, 100, 95, 100, 95],
            'Dev': [100, 95, 85, 75, 70],
            'Critic': [90, 95, 95, 75, 70]
        },
        edgeOverrides: {
            'Design-Dev': 20.0
        }
    },
    {
        turn: 9,
        activeAgent: 'Critic',
        stageCue: '⚡ Turn 9: Critic detects typography token drift via visual regression test; Sheaf Cohomology isolates circulation curl.',
        thoughtBubble: 'Playwright visual snapshot test flagged a 18% pixel difference on heading elements! Dev is rendering Inter, but Design’s token bundle has Outfit. The residual on the Design-Dev edge spikes! Triadic curl on tau_ui is active.',
        teamMessage: 'ALERT: Visual regression discrepancy detected between Design tokens and Dev build. Font mismatch: Outfit vs Inter causing layout shift on /pricing. Dev needs to update @font-source.',
        toolCall: {
            toolName: 'critic_visual_regression',
            args: { routes: ['/pricing', '/dashboard'], threshold: 0.05 },
            result: { diffPercentage: 18.2, mismatchedToken: 'font-heading', reportedTo: 'Dev' }
        },
        stateDelta: {
            'PM': [100, 90, 95],
            'Design': [100, 100, 95, 100, 95],
            'Dev': [100, 95, 85, 75, 70],
            'Critic': [90, 95, 95, 75, 70]
        },
        edgeOverrides: {
            'Design-Dev': 25.0,
            'Dev-Critic': -25.0
        }
    },
    {
        turn: 10,
        activeAgent: 'Dev',
        stageCue: '🔧 Turn 10: Dev imports Outfit webfont via next/font; aligns typography tokens and restores cycle consistency.',
        thoughtBubble: 'Pulling the font tokens from Design and configuring next/font/google with Outfit. Running visual regression test locally: 0.0% pixel delta. Rebuilding production bundle.',
        teamMessage: 'Typography aligned! Loaded Outfit font via next/font with zero layout shift. Visual regression now shows 0.0% diff.',
        toolCall: {
            toolName: 'dev_sync_typography',
            args: { font: 'Outfit', subsets: ['latin'], optimization: 'next/font' },
            result: { visualDiff: 0.0, buildStatus: 'OPTIMIZED', codeCoverage: 90, uiPolish: 95 }
        },
        stateDelta: {
            'PM': [100, 95, 95],
            'Design': [100, 100, 95, 100, 95],
            'Dev': [100, 100, 100, 90, 95],
            'Critic': [95, 100, 95, 90, 95]
        }
    },
    {
        turn: 11,
        activeAgent: 'PM',
        stageCue: '📋 Turn 11: PM audits final sitemap deliverables, acceptance criteria, and mobile touch targets.',
        thoughtBubble: 'Verifying all requirements against our original spec: 6 responsive routes, dark/light theme toggle, AAA WCAG contrast, Outfit typography, and 90%+ test coverage. All requirements satisfied.',
        teamMessage: 'PM review complete: Every requirement in our spec is fulfilled. Mobile touch targets exceed 48x48px, all routes hydrate cleanly. Critic, run final deployment gate.',
        toolCall: {
            toolName: 'pm_spec_audit',
            args: { checklist: ['sitemap', 'wcag', 'theme', 'assets', 'tests'] },
            result: { allChecksPassed: true, specCoverage: 100 }
        },
        stateDelta: {
            'PM': [100, 100, 100],
            'Design': [100, 100, 100, 100, 100],
            'Dev': [100, 100, 100, 95, 95],
            'Critic': [100, 100, 100, 95, 95]
        }
    },
    {
        turn: 12,
        activeAgent: 'Critic',
        stageCue: '🚀 Turn 12: Critic certifies 100% consensus across all stalks; Sheaf completion residual vanishes (r = 0.00).',
        thoughtBubble: 'Full test suite passing: 32 unit tests, 6 Playwright E2E flows, 0 axe-core violations, zero lint errors. All stalks across all agents are in exact algebraic consensus. Total Sheaf Residual = 0.0.',
        teamMessage: 'FINAL CERTIFICATION: Swarm consensus is 100.0%. Total Cohomological Residual r = 0.00 across all 6 edges. All 3 triadic review contracts have zero curl. Ready for production release!',
        toolCall: {
            toolName: 'critic_final_gate',
            args: { testSuites: 'ALL', targetResidual: 0.0 },
            result: { e2ePassed: 6, unitPassed: 32, wcagPassed: true, globalResidual: 0.0, status: 'RELEASE_APPROVED' }
        },
        stateDelta: {
            'PM': [100, 100, 100],
            'Design': [100, 100, 100, 100, 100],
            'Dev': [100, 100, 100, 100, 100],
            'Critic': [100, 100, 100, 100, 100]
        }
    }
];

// Discrete Hodge decomposition matrices
// 6 edges, 4 vertices (PM=0, Design=1, Dev=2, Critic=3)
const d0 = [
    [-1,  1,  0,  0], // e0: PM -> Design
    [-1,  0,  1,  0], // e1: PM -> Dev
    [-1,  0,  0,  1], // e2: PM -> Critic
    [ 0, -1,  1,  0], // e3: Design -> Dev
    [ 0, -1,  0,  1], // e4: Design -> Critic
    [ 0,  0, -1,  1]  // e5: Dev -> Critic
];

// 3 2-simplices: tau_sitemap (0,1,2), tau_wcag (0,1,3), tau_ui (1,2,3)
const d1 = [
    [ 1, -1,  0,  1,  0,  0], // tau_sitemap: e0 - e1 + e3
    [ 1,  0, -1,  0,  1,  0], // tau_wcag: e0 - e2 + e4
    [ 0,  0,  0,  1, -1,  1]  // tau_ui: e3 - e4 + e5
];

function matMul(A: number[][], B: number[][]): number[][] {
    const m = A.length, n = B[0].length, p = A[0].length;
    const res = Array.from({length: m}, () => Array(n).fill(0));
    for (let i = 0; i < m; i++)
        for (let j = 0; j < n; j++)
            for (let k = 0; k < p; k++)
                res[i][j] += A[i][k] * B[k][j];
    return res;
}

function matVec(A: number[][], x: number[]): number[] {
    return A.map(row => row.reduce((sum, val, i) => sum + val * x[i], 0));
}

function transpose(A: number[][]): number[][] {
    return A[0].map((_, col) => A.map(row => row[col]));
}

function invert3x3(A: number[][]): number[][] {
    const [a, b, c] = A[0];
    const [d, e, f] = A[1];
    const [g, h, i] = A[2];
    const det = a*(e*i - f*h) - b*(d*i - f*g) + c*(d*h - e*g);
    if (Math.abs(det) < 1e-12) throw new Error("Singular 3x3 matrix in Hodge solver");
    const invDet = 1 / det;
    return [
        [(e*i - f*h)*invDet, (c*h - b*i)*invDet, (b*f - c*e)*invDet],
        [(f*g - d*i)*invDet, (a*i - c*g)*invDet, (c*d - a*f)*invDet],
        [(d*h - e*g)*invDet, (b*g - a*h)*invDet, (a*e - b*d)*invDet]
    ];
}

const d0_sub = d0.map(r => r.slice(1));
const d0_sub_T = transpose(d0_sub);
const L0 = matMul(d0_sub_T, d0_sub);
const invL0 = invert3x3(L0);

const d1_T = transpose(d1);
const L1_face = matMul(d1, d1_T);
const invL1_face = invert3x3(L1_face);

function computeExactHodgeDecomposition(g: number[]) {
    // 1. Gradient component: projection onto im(delta_0)
    const rhs_grad = matVec(d0_sub_T, g);
    const x_sub = matVec(invL0, rhs_grad);
    const grad = matVec(d0_sub, x_sub);

    // 2. Remainder: w = g - grad
    const w = g.map((v, i) => v - grad[i]);

    // 3. Curl component: projection onto im(delta_1^T)
    const rhs_curl = matVec(d1, w);
    const psi = matVec(invL1_face, rhs_curl);
    const curl = matVec(d1_T, psi);

    // 4. Harmonic component: h = w - curl
    const h = w.map((v, i) => v - curl[i]);

    const normSq = (v: number[]) => v.reduce((s, x) => s + x*x, 0);

    const gradEnergy = Math.round(normSq(grad) * 10) / 10;
    const curlEnergy = Math.round(normSq(curl) * 10) / 10;
    const harmEnergy = Math.round(normSq(h) * 10) / 10;

    const denom = harmEnergy + curlEnergy;
    const legibilityRatio = denom > 1e-6 ? Math.round((harmEnergy / denom) * 100) / 100 : 1.0;

    const totalE = gradEnergy + curlEnergy + harmEnergy;
    const classification = totalE < 1.0
        ? 'Consensual Alignment'
        : curlEnergy > 5.0
        ? 'Triadic Review Bug'
        : harmEnergy > 5.0
        ? 'Macro Partition Cavity'
        : 'Benign Velocity Differential';

    return {
        gradEnergy,
        curlEnergy,
        harmEnergy,
        legibilityRatio,
        classification
    };
}

// Calculation functions
function computeTrial() {
    const timeseries: any[] = [];

    for (const raw of rawTurns) {
        const states = raw.stateDelta;

        // Compute edge residuals and cochains
        const edgeResiduals: Record<string, number> = {};
        const edgeCochains: Record<string, { u_proj: number[]; v_proj: number[]; diff: number[]; normSq: number; restriction_u: string; restriction_v: string }> = {};
        let totalResidual = 0;

        const edgeScalarVector: number[] = [];

        for (const edge of edges) {
            const uState = states[edge.u];
            const vState = states[edge.v];
            const uProj = restrict(edge.u, uState, edge.sharedDims);
            const vProj = restrict(edge.v, vState, edge.sharedDims);

            const edgeKey = `${edge.u}-${edge.v}`;
            const override = raw.edgeOverrides ? raw.edgeOverrides[edgeKey] : undefined;

            const diff = [];
            let normSq = 0;
            for (let i = 0; i < edge.sharedDims.length; i++) {
                let d = vProj[i] - uProj[i];
                if (override !== undefined && i === edge.sharedDims.length - 1) {
                    d += override;
                }
                diff.push(d);
                normSq += d * d;
            }

            const scaledNorm = Math.round((normSq / 100.0) * 10) / 10;
            edgeResiduals[edgeKey] = scaledNorm;

            // Representative scalar for global Hodge decomposition
            const meanDiff = diff.length > 0 ? diff.reduce((a, b) => a + b, 0) / diff.length : 0;
            edgeScalarVector.push(meanDiff);

            // Build restriction map descriptions
            const uIndices = edge.sharedDims.map(d => agentObservationIndices[edge.u].indexOf(d));
            const vIndices = edge.sharedDims.map(d => agentObservationIndices[edge.v].indexOf(d));

            edgeCochains[edgeKey] = {
                u_proj: uProj,
                v_proj: vProj,
                diff: diff,
                normSq: scaledNorm,
                restriction_u: `P_${edge.u} maps indices [${uIndices.join(', ')}] -> F(e)`,
                restriction_v: `P_${edge.v} maps indices [${vIndices.join(', ')}] -> F(e)`
            };
            totalResidual += scaledNorm;
        }

        // Compute 2-simplices (triads) curl: (delta_1 g)_tau = g_01 + g_12 - g_02
        const simplexResiduals: Record<string, { curl: number; boundaryEdges: string[]; description: string }> = {};

        for (const simp of simplices) {
            const [u, v, w] = simp.agents;
            const key_uv = `${u}-${v}`;
            const key_vw = `${v}-${w}`;
            const key_uw = `${u}-${w}`;

            let curlMag = 0;
            for (const dim of simp.sharedDims) {
                const edge_uv_def = edges.find(e => (e.u === u && e.v === v) || (e.u === v && e.v === u))!;
                const edge_vw_def = edges.find(e => (e.u === v && e.v === w) || (e.u === w && e.v === v))!;
                const edge_uw_def = edges.find(e => (e.u === u && e.v === w) || (e.u === w && e.v === u))!;

                const idx_uv = edge_uv_def.sharedDims.indexOf(dim);
                const idx_vw = edge_vw_def.sharedDims.indexOf(dim);
                const idx_uw = edge_uw_def.sharedDims.indexOf(dim);

                const sign_uv = (edge_uv_def.u === u && edge_uv_def.v === v) ? 1 : -1;
                const sign_vw = (edge_vw_def.u === v && edge_vw_def.v === w) ? 1 : -1;
                const sign_uw = (edge_uw_def.u === u && edge_uw_def.v === w) ? 1 : -1;

                const val_uv = sign_uv * (edgeCochains[key_uv] ? edgeCochains[key_uv].diff[idx_uv] : 0);
                const val_vw = sign_vw * (edgeCochains[key_vw] ? edgeCochains[key_vw].diff[idx_vw] : 0);
                const val_uw = sign_uw * (edgeCochains[key_uw] ? edgeCochains[key_uw].diff[idx_uw] : 0);

                // Boundary curl: g_uv + g_vw - g_uw
                const c = val_uv + val_vw - val_uw;
                curlMag += Math.abs(c);
            }

            const scaledCurl = Math.round((curlMag / 10.0) * 10) / 10;

            simplexResiduals[simp.id] = {
                curl: scaledCurl,
                boundaryEdges: [key_uv, key_vw, key_uw],
                description: `${simp.name}: curl (delta_1 g) = ${scaledCurl}`
            };
        }

        // Exact Discrete Hodge Decomposition (Theorem CR-5)
        const hodge = computeExactHodgeDecomposition(edgeScalarVector);

        timeseries.push({
            turn: raw.turn,
            active_agent: raw.activeAgent,
            stage_cue: raw.stageCue,
            thought_bubble: raw.thoughtBubble,
            message_to_team: raw.teamMessage,
            tool_call: raw.toolCall,
            states: states,
            residuals: {
                total: Math.round(totalResidual * 10) / 10,
                edgeResiduals: edgeResiduals
            },
            cochains: edgeCochains,
            simplices: simplexResiduals,
            hodge: {
                gradientEnergy: hodge.gradEnergy,
                harmonicEnergy: hodge.harmEnergy,
                triadicCurlEnergy: hodge.curlEnergy,
                legibilityRatio: hodge.legibilityRatio,
                classification: hodge.classification
            }
        });
    }

    return {
        metadata: {
            project: 'Web App Swarm: Sheaf Cohomology & Triadic Hodge Visualizer',
            theory: 'Theorems CR-1 through CR-5 (Owens 2026)',
            dimensions: dimensionNames,
            agents: agentObservationIndices,
            agentRoles: agentRoles,
            edges: edges,
            simplices: simplices
        },
        timeseries
    };
}

const trialData = computeTrial();
const outPath = path.join(process.cwd(), 'docs', 'harbor-research', 'transcripts', 'sheaf_swarm_grounded.json');
fs.writeFileSync(outPath, JSON.stringify(trialData, null, 2));
console.log(`Generated grounded trial with 12 turns at ${outPath}`);
