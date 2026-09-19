#!/usr/bin/env python3
"""
FIPA-ACL MULTI-AGENT SWARM SIMULATOR WITH CELLULAR SHEAF COHOMOLOGY
===================================================================
Simulates a 9-agent heterogeneous software engineering swarm communicating
via formal FIPA-ACL speech acts across a 2-simplicial complex topology.

Simulates:
1. Normal asynchronous consensus (t = 0..7s)
2. Bad Operator Suggestion #1: Concurrent AST write-lease race (t = 8..14s)
   -> Operator requests contradictory refactors on AuthDev & TokenService
   -> High-curl triadic collision detected by delta^1 g
   -> Resolved via Theorem CR-4 greedy energy-to-cost repair cut
3. Normal consensus resumption (t = 15..17s)
4. Bad Operator Suggestion #2: Bypassed security review equivocation (t = 18..25s)
   -> Operator requests ClientFrontend bypass security gate
   -> ClientFrontend asserts APPROVED, SecurityCritic asserts REJECTED
   -> Harmonic/Curl mixed breach detected across review triad
   -> Resolved via Theorem CR-4 fencing intervention and attestation proof
5. Clean deployment consensus (t = 26..30s)

Outputs:
  demos/swarm-telemetry-dashboard/telemetry_data.json
"""

import json
import math
import numpy as np

def build_simulation():
    # 9 Agents
    agents = [
        {"id": "v0", "name": "Operator Proxy", "role": "Executive Human Input"},
        {"id": "v1", "name": "Lead Orchestrator", "role": "Architecture & Routing"},
        {"id": "v2", "name": "AuthDev", "role": "Authentication Backend"},
        {"id": "v3", "name": "TokenService", "role": "Session & Token Issuer"},
        {"id": "v4", "name": "ClientFrontend", "role": "UI & Client SDK"},
        {"id": "v5", "name": "DatabaseDev", "role": "PostgreSQL & Schema"},
        {"id": "v6", "name": "SecurityCritic", "role": "Static Analysis & Vuln Audit"},
        {"id": "v7", "name": "QAVerifier", "role": "Integration & E2E Tests"},
        {"id": "v8", "name": "ReleaseManager", "role": "Deployment Gatekeeper"}
    ]
    
    agent_map = {a["id"]: a for a in agents}
    
    # 16 Oriented Communication Edges
    edges = [
        ("v0", "v1"), # Operator -> Orchestrator
        ("v1", "v2"), # Orchestrator -> AuthDev
        ("v1", "v3"), # Orchestrator -> TokenService
        ("v1", "v4"), # Orchestrator -> ClientFrontend
        ("v2", "v3"), # AuthDev <-> TokenService (Shared auth logic)
        ("v2", "v5"), # AuthDev -> DatabaseDev
        ("v3", "v5"), # TokenService -> DatabaseDev
        ("v2", "v6"), # AuthDev -> SecurityCritic
        ("v3", "v6"), # TokenService -> SecurityCritic
        ("v4", "v2"), # ClientFrontend -> AuthDev
        ("v4", "v7"), # ClientFrontend -> QAVerifier
        ("v6", "v7"), # SecurityCritic -> QAVerifier
        ("v6", "v8"), # SecurityCritic -> ReleaseManager
        ("v7", "v8"), # QAVerifier -> ReleaseManager
        ("v4", "v8"), # ClientFrontend -> ReleaseManager (Bypass channel)
        ("v1", "v8"), # Orchestrator -> ReleaseManager
    ]
    
    # 10 Triadic 2-Simplices (Faces)
    faces = [
        ("v1", "v2", "v3"), # Triad 1: Orchestrator / AuthDev / TokenService
        ("v2", "v3", "v5"), # Triad 2: AuthDev / TokenService / DatabaseDev
        ("v2", "v3", "v6"), # Triad 3: AuthDev / TokenService / SecurityCritic
        ("v1", "v2", "v4"), # Triad 4: Orchestrator / AuthDev / ClientFrontend
        ("v4", "v6", "v7"), # Triad 5: ClientFrontend / SecurityCritic / QAVerifier
        ("v6", "v7", "v8"), # Triad 6: SecurityCritic / QAVerifier / ReleaseManager
        ("v4", "v6", "v8"), # Triad 7: ClientFrontend / SecurityCritic / ReleaseManager (Bypass triad)
        ("v4", "v7", "v8"), # Triad 8: ClientFrontend / QAVerifier / ReleaseManager
        ("v1", "v6", "v8"), # Triad 9: Orchestrator / SecurityCritic / ReleaseManager
        ("v1", "v7", "v8")  # Triad 10: Orchestrator / QAVerifier / ReleaseManager
    ]
    
    num_nodes = len(agents)
    num_edges = len(edges)
    num_faces = len(faces)
    
    # Stalk dimension D = 3 (Commit, AST Lease, Test Status)
    D = 3
    
    # Construct incidence matrix B (num_nodes x num_edges)
    node_id_to_idx = {a["id"]: i for i, a in enumerate(agents)}
    B = np.zeros((num_nodes, num_edges), dtype=np.float64)
    for e_idx, (u, v) in enumerate(edges):
        B[node_id_to_idx[u], e_idx] = -1.0
        B[node_id_to_idx[v], e_idx] = 1.0
        
    delta_0 = np.kron(B.T, np.eye(D, dtype=np.float64))
    
    # Coboundary delta_1
    delta_1_scalar = np.zeros((num_faces, num_edges), dtype=np.float64)
    for f_idx, (u, v, w) in enumerate(faces):
        # boundary of (u, v, w) = (v, w) - (u, w) + (u, v)
        def find_edge_coeff(a, b):
            if (a, b) in edges:
                return edges.index((a, b)), 1.0
            elif (b, a) in edges:
                return edges.index((b, a)), -1.0
            return None, 0.0
            
        e_vw, c_vw = find_edge_coeff(v, w)
        e_uw, c_uw = find_edge_coeff(u, w)
        e_uv, c_uv = find_edge_coeff(u, v)
        
        if e_vw is not None: delta_1_scalar[f_idx, e_vw] += 1.0 * c_vw
        if e_uw is not None: delta_1_scalar[f_idx, e_uw] += -1.0 * c_uw
        if e_uv is not None: delta_1_scalar[f_idx, e_uv] += 1.0 * c_uv
        
    delta_1 = np.kron(delta_1_scalar, np.eye(D, dtype=np.float64))
    
    # Hodge projector
    L_0 = delta_0.T @ delta_0
    L_0_pinv = np.linalg.pinv(L_0)
    Pi = np.eye(num_edges * D, dtype=np.float64) - delta_0 @ L_0_pinv @ delta_0.T
    
    # -------------------------------------------------------------------------
    # GANTT TASKS & FIPA MESSAGES ACROSS 31 TIMESTEPS (t = 0..30s)
    # -------------------------------------------------------------------------
    gantt_tasks = [
        # v0 Operator Proxy
        {"id": "task_op_0", "agentId": "v0", "label": "Release Intent Briefing", "start": 0, "end": 4, "status": "nominal"},
        {"id": "task_op_1", "agentId": "v0", "label": "Bad Instruction: Parallel AST Write", "start": 7, "end": 10, "status": "breach"},
        {"id": "task_op_2", "agentId": "v0", "label": "Bad Instruction: Security Gate Bypass", "start": 17, "end": 20, "status": "breach"},
        {"id": "task_op_3", "agentId": "v0", "label": "Harvest Production Sign-Off", "start": 26, "end": 30, "status": "nominal"},
        
        # v1 Lead Orchestrator
        {"id": "task_orch_0", "agentId": "v1", "label": "Dependency DAG Decomposition", "start": 1, "end": 6, "status": "nominal"},
        {"id": "task_orch_1", "agentId": "v1", "label": "Lease Arbitrage & Supervision", "start": 6, "end": 11, "status": "nominal"},
        {"id": "task_orch_2", "agentId": "v1", "label": "CR-4 Active Fencing & Edge Quench", "start": 12, "end": 15, "status": "repaired"},
        {"id": "task_orch_3", "agentId": "v1", "label": "Bypass Interception & Audit Lock", "start": 21, "end": 25, "status": "repaired"},
        {"id": "task_orch_4", "agentId": "v1", "label": "Consensus Verification", "start": 26, "end": 30, "status": "nominal"},
        
        # v2 AuthDev
        {"id": "task_auth_0", "agentId": "v2", "label": "Passkey Registration Stalk Model", "start": 2, "end": 7, "status": "nominal"},
        {"id": "task_auth_1", "agentId": "v2", "label": "AST Lease Hold: session.ts", "start": 8, "end": 14, "status": "contested"},
        {"id": "task_auth_2", "agentId": "v2", "label": "Rebase on Canonical Head (Commit 102)", "start": 14, "end": 18, "status": "nominal"},
        {"id": "task_auth_3", "agentId": "v2", "label": "Signed Cryptographic Release", "start": 25, "end": 29, "status": "nominal"},
        
        # v3 TokenService
        {"id": "task_token_0", "agentId": "v3", "label": "Ed25519 Token Issuer Setup", "start": 3, "end": 7, "status": "nominal"},
        {"id": "task_token_1", "agentId": "v3", "label": "Concurrent Conflicting Lease Claim", "start": 8, "end": 12, "status": "contested"},
        {"id": "task_token_2", "agentId": "v3", "label": "Fenced by CR-4 (HTTP 409 Yield)", "start": 12, "end": 15, "status": "repaired"},
        {"id": "task_token_3", "agentId": "v3", "label": "Token Refresh Protocol Alignment", "start": 16, "end": 22, "status": "nominal"},
        
        # v4 ClientFrontend
        {"id": "task_client_0", "agentId": "v4", "label": "WebAuthn Client SDK Integration", "start": 4, "end": 9, "status": "nominal"},
        {"id": "task_client_1", "agentId": "v4", "label": "Mock Handshake Tests", "start": 10, "end": 16, "status": "nominal"},
        {"id": "task_client_2", "agentId": "v4", "label": "Unvetted Deployment Push (Bypass)", "start": 18, "end": 22, "status": "contested"},
        {"id": "task_client_3", "agentId": "v4", "label": "Fenced & Re-routed to Gatekeeper", "start": 23, "end": 26, "status": "repaired"},
        
        # v5 DatabaseDev
        {"id": "task_db_0", "agentId": "v5", "label": "PostgreSQL Credential Table Migration", "start": 3, "end": 8, "status": "nominal"},
        {"id": "task_db_1", "agentId": "v5", "label": "Foreign Key Invariants & Row Locks", "start": 9, "end": 16, "status": "nominal"},
        {"id": "task_db_2", "agentId": "v5", "label": "Migration Smoke Verification", "start": 24, "end": 28, "status": "nominal"},
        
        # v6 SecurityCritic
        {"id": "task_sec_0", "agentId": "v6", "label": "Static Analysis Rule Formulation", "start": 4, "end": 9, "status": "nominal"},
        {"id": "task_sec_1", "agentId": "v6", "label": "Token Replay Vulnerability Audit", "start": 10, "end": 15, "status": "nominal"},
        {"id": "task_sec_2", "agentId": "v6", "label": "Disconfirm Client Bypass (CVE-2026)", "start": 19, "end": 24, "status": "nominal"},
        {"id": "task_sec_3", "agentId": "v6", "label": "Cryptographic Attestation Minting", "start": 25, "end": 28, "status": "nominal"},
        
        # v7 QAVerifier
        {"id": "task_qa_0", "agentId": "v7", "label": "Triadic E2E Matrix Generation", "start": 5, "end": 11, "status": "nominal"},
        {"id": "task_qa_1", "agentId": "v7", "label": "Headless Test Harness Execution", "start": 12, "end": 18, "status": "nominal"},
        {"id": "task_qa_2", "agentId": "v7", "label": "Security Regression Assertion", "start": 20, "end": 25, "status": "nominal"},
        {"id": "task_qa_3", "agentId": "v7", "label": "All 24 Tests Green Certification", "start": 26, "end": 30, "status": "nominal"},
        
        # v8 ReleaseManager
        {"id": "task_rel_0", "agentId": "v8", "label": "Deployment Pipeline Standby", "start": 2, "end": 17, "status": "nominal"},
        {"id": "task_rel_1", "agentId": "v8", "label": "Contradictory Gossip Stalled", "start": 19, "end": 23, "status": "contested"},
        {"id": "task_rel_2", "agentId": "v8", "label": "Verified Attestation Adjudication", "start": 25, "end": 28, "status": "nominal"},
        {"id": "task_rel_3", "agentId": "v8", "label": "Staging Deployment Promotion", "start": 28, "end": 30, "status": "nominal"}
    ]
    
    # -------------------------------------------------------------------------
    # FIPA SPEECH ACT TRANSCRIPTS
    # -------------------------------------------------------------------------
    fipa_transcripts = [
        {"t": 1.0, "sender": "v0", "receiver": "v1", "performative": "REQUEST", "conversation": "conv-init",
         "content": "request(decompose_sprint, goal='Ship WebAuthn Passkeys & Refresh Tokens')"},
        {"t": 2.5, "sender": "v1", "receiver": "v2", "performative": "PROPOSE", "conversation": "conv-init",
         "content": "propose(assign_role, target='src/auth/passkeys.ts', mode='EXCLUSIVE_WRITE')"},
        {"t": 3.2, "sender": "v2", "receiver": "v1", "performative": "ACCEPT-PROPOSAL", "conversation": "conv-init",
         "content": "accept-proposal(assign_role, commit_base='4bc6690', lease_acquired=true)"},
        {"t": 4.5, "sender": "v1", "receiver": "v3", "performative": "PROPOSE", "conversation": "conv-init",
         "content": "propose(assign_role, target='src/auth/token_issuer.ts', mode='EXCLUSIVE_WRITE')"},
        {"t": 5.8, "sender": "v3", "receiver": "v1", "performative": "ACCEPT-PROPOSAL", "conversation": "conv-init",
         "content": "accept-proposal(assign_role, commit_base='4bc6690', lease_acquired=true)"},
        {"t": 7.2, "sender": "v2", "receiver": "v5", "performative": "INFORM", "conversation": "conv-schema",
         "content": "inform(schema_delta, table='user_credentials', columns=['credential_id', 'public_key'])"},
         
        # Collision 1: Bad Operator suggestion injected
        {"t": 8.0, "sender": "v0", "receiver": "v2", "performative": "REQUEST", "conversation": "conv-rush-1",
         "content": "request(immediate_patch, symbol='src/auth/session.ts::generateKey', bypass_lock=true)"},
        {"t": 8.5, "sender": "v0", "receiver": "v3", "performative": "REQUEST", "conversation": "conv-rush-2",
         "content": "request(add_refresh_rotation, symbol='src/auth/session.ts::generateKey', speed='max')"},
        {"t": 9.1, "sender": "v2", "receiver": "v1", "performative": "PROPOSE", "conversation": "conv-lease-clash",
         "content": "propose(acquire_lease, symbol='src/auth/session.ts::generateKey', mode='EXCLUSIVE')"},
        {"t": 9.4, "sender": "v3", "receiver": "v1", "performative": "PROPOSE", "conversation": "conv-lease-clash",
         "content": "propose(acquire_lease, symbol='src/auth/session.ts::generateKey', mode='EXCLUSIVE')"},
        {"t": 10.2, "sender": "v2", "receiver": "v3", "performative": "INFORM", "conversation": "conv-race",
         "content": "inform(local_hold, symbol='session.ts::generateKey', commit='101a')"},
        {"t": 10.8, "sender": "v3", "receiver": "v2", "performative": "INFORM", "conversation": "conv-race",
         "content": "inform(local_hold, symbol='session.ts::generateKey', commit='101b_CONCURRENT')"},
        {"t": 11.5, "sender": "v1", "receiver": "v0", "performative": "INFORM", "conversation": "conv-alarm",
         "content": "inform(sheaf_alarm, obstruction_r=14.281, high_curl_triangle=['v1','v2','v3'])"},
         
        # CR-4 Intervention 1
        {"t": 12.5, "sender": "v1", "receiver": "v3", "performative": "REFUSE", "conversation": "conv-cr4-repair",
         "content": "refuse(acquire_lease, reason='CR-4 MIN-CUT: Quenched edge (v2,v3). Revert commit 101b')"},
        {"t": 13.8, "sender": "v3", "receiver": "v1", "performative": "INFORM", "conversation": "conv-cr4-repair",
         "content": "inform(lease_relinquished, symbol='session.ts::generateKey', status='FENCED_WAITING')"},
        {"t": 14.5, "sender": "v2", "receiver": "v3", "performative": "INFORM", "conversation": "conv-sync",
         "content": "inform(canonical_head, commit='102_STABLE', lock_status='EXCLUSIVE_HELD')"},
        {"t": 16.0, "sender": "v3", "receiver": "v2", "performative": "CONFIRM", "conversation": "conv-sync",
         "content": "confirm(rebase_complete, synced_commit='102_STABLE', r=0.0000)"},
         
        # Collision 2: Bad Operator bypass injection
        {"t": 18.0, "sender": "v0", "receiver": "v4", "performative": "REQUEST", "conversation": "conv-bypass",
         "content": "request(force_push, pr='PR#104', target='release/v2.4', skip_ci=true)"},
        {"t": 19.2, "sender": "v4", "receiver": "v8", "performative": "INFORM", "conversation": "conv-deploy",
         "content": "inform(pr_status, pr='PR#104', approved=true, authority='operator_request')"},
        {"t": 20.1, "sender": "v6", "receiver": "v8", "performative": "DISCONFIRM", "conversation": "conv-audit",
         "content": "disconfirm(pr_status, pr='PR#104', reason='CVE-2026-TOKEN-FORGERY in unvetted PR#104')"},
        {"t": 20.8, "sender": "v6", "receiver": "v4", "performative": "REFUSE", "conversation": "conv-audit",
         "content": "refuse(direct_merge, reason='Triadic contract breached on (v4,v6,v8). Attestation absent')"},
        {"t": 21.6, "sender": "v8", "receiver": "v1", "performative": "INFORM", "conversation": "conv-alarm-2",
         "content": "inform(sheaf_alarm, obstruction_r=22.614, harmonic_split=0.642, triad=['v4','v6','v8'])"},
         
        # CR-4 Intervention 2
        {"t": 22.8, "sender": "v1", "receiver": "v4", "performative": "REFUSE", "conversation": "conv-cr4-fence",
         "content": "refuse(force_push, reason='CR-4 INTERVENTION: Fence edge (v4,v8). Operator bypass rejected')"},
        {"t": 23.5, "sender": "v4", "receiver": "v6", "performative": "PROPOSE", "conversation": "conv-remedy",
         "content": "propose(submit_patch, pr='PR#104b_SANITY', token_nonce_validation=true)"},
        {"t": 24.8, "sender": "v6", "receiver": "v8", "performative": "INFORM", "conversation": "conv-cert",
         "content": "inform(attestation_minted, sha256='9e2f4a1...', verdict='CLEARED_PASS')"},
        {"t": 25.5, "sender": "v7", "receiver": "v8", "performative": "INFORM", "conversation": "conv-cert",
         "content": "inform(test_run_pass, total=24, failed=0, code_coverage=99.2)"},
        {"t": 26.8, "sender": "v8", "receiver": "v1", "performative": "CONFIRM", "conversation": "conv-done",
         "content": "confirm(global_consensus, r=0.0000, L=1.0000, release_promoted=true)"},
        {"t": 28.5, "sender": "v1", "receiver": "v0", "performative": "INFORM", "conversation": "conv-done",
         "content": "inform(production_live, version='v2.4.0', status='ACTIVE_GREEN', zero_obstruction=true)"}
    ]
    
    # -------------------------------------------------------------------------
    # COMPUTE JAGGED REAL MATHEMATICAL TELEMETRY ACROSS TIMESTEPS t = 0..30s
    # -------------------------------------------------------------------------
    timeline_epochs = []
    
    # Generate realistic step-by-step edge cochains g(t)
    for t_step in range(31):
        t = float(t_step)
        g_t = np.zeros(num_edges * D, dtype=np.float64)
        
        # Base communication jitter (tiny background noise)
        np.random.seed(42 + t_step)
        base_noise = np.random.normal(0, 0.02, num_edges * D)
        g_t += base_noise
        
        # Injected Collision 1: Lease Clash (t = 8..14)
        if 8 <= t <= 14:
            # Severity peaks at t=11, then drops during CR-4 repair (t=12..14)
            severity_1 = 0.0
            if t == 8: severity_1 = 3.2
            elif t == 9: severity_1 = 8.5
            elif t == 10: severity_1 = 13.8
            elif t == 11: severity_1 = 16.4
            elif t == 12: severity_1 = 11.2 # Repair initiated
            elif t == 13: severity_1 = 4.1
            elif t == 14: severity_1 = 0.8
            
            # Edges involved: (v1,v2), (v1,v3), (v2,v3)
            e_12 = edges.index(("v1", "v2"))
            e_13 = edges.index(("v1", "v3"))
            e_23 = edges.index(("v2", "v3"))
            
            g_t[e_23*D : (e_23+1)*D] += np.array([severity_1, severity_1 * 0.9, 0.0])
            g_t[e_12*D : (e_12+1)*D] += np.array([-severity_1 * 0.4, 0.0, 0.0])
            g_t[e_13*D : (e_13+1)*D] += np.array([severity_1 * 0.5, 0.0, 0.0])
            
        # Injected Collision 2: Security Gate Bypass (t = 18..25)
        if 18 <= t <= 25:
            severity_2 = 0.0
            if t == 18: severity_2 = 4.0
            elif t == 19: severity_2 = 12.1
            elif t == 20: severity_2 = 21.8
            elif t == 21: severity_2 = 25.2
            elif t == 22: severity_2 = 18.0 # CR-4 Fencing fired
            elif t == 23: severity_2 = 9.4
            elif t == 24: severity_2 = 3.2
            elif t == 25: severity_2 = 0.5
            
            # Edges involved: (v4,v8), (v6,v8), (v4,v7), (v6,v7)
            e_48 = edges.index(("v4", "v8")) # Bypass edge
            e_68 = edges.index(("v6", "v8")) # Security report
            e_47 = edges.index(("v4", "v7"))
            
            g_t[e_48*D : (e_48+1)*D] += np.array([severity_2 * 0.8, 0.0, severity_2])
            g_t[e_68*D : (e_68+1)*D] += np.array([0.0, 0.0, -severity_2 * 0.9])
            g_t[e_47*D : (e_47+1)*D] += np.array([severity_2 * 0.3, 0.0, 0.0])
            
        # Exact Sheaf Cohomology Projection
        residual_vec = Pi @ g_t
        r_exact = float(np.linalg.norm(residual_vec))
        
        # Acyclic tree comparator (Spanning tree has Pi_tree = 0 by definition!)
        r_tree = 0.0000
        
        # Discrete Hodge Decomposition: g = delta_0 x + h + delta_1^* psi
        x_grad = L_0_pinv @ (delta_0.T @ g_t)
        g_grad = delta_0 @ x_grad
        
        psi_curl = np.linalg.pinv(delta_1 @ delta_1.T) @ (delta_1 @ g_t)
        g_curl = delta_1.T @ psi_curl
        
        g_harm = g_t - g_grad - g_curl
        
        e_grad = float(np.linalg.norm(g_grad)**2)
        e_curl = float(np.linalg.norm(g_curl)**2)
        e_harm = float(np.linalg.norm(g_harm)**2)
        total_e = e_grad + e_curl + e_harm + 1e-9
        
        # Swarm Legibility Ratio L = E_harm / (E_harm + E_curl)
        if (e_harm + e_curl) < 1e-6:
            legibility = 1.0
        else:
            legibility = float(e_harm / (e_harm + e_curl))
            
        # Top Contested Edges
        contested_edges = []
        for idx, (u, v) in enumerate(edges):
            rho_e = float(np.linalg.norm(residual_vec[idx*D : (idx+1)*D]))
            if rho_e > 0.4:
                contested_edges.append({
                    "edge": f"{u}->{v}",
                    "source": u,
                    "target": v,
                    "sourceName": agent_map[u]["name"],
                    "targetName": agent_map[v]["name"],
                    "residual": round(rho_e, 3)
                })
        contested_edges.sort(key=lambda x: x["residual"], reverse=True)
        
        # Active Status
        status_label = "Consensus"
        if r_exact > 15.0:
            status_label = "Critical Alarm"
        elif r_exact > 5.0:
            status_label = "Contested Clash"
        elif 12 <= t <= 14 or 22 <= t <= 25:
            status_label = "Active CR-4 Repair"
            
        timeline_epochs.append({
            "t": t_step,
            "timeFormatted": f"00:{t_step:02d}",
            "r": round(r_exact, 3),
            "rTree": 0.0,
            "legibility": round(legibility, 3),
            "energyGrad": round(e_grad, 2),
            "energyCurl": round(e_curl, 2),
            "energyHarm": round(e_harm, 2),
            "pctGrad": round(e_grad / total_e * 100, 1),
            "pctCurl": round(e_curl / total_e * 100, 1),
            "pctHarm": round(e_harm / total_e * 100, 1),
            "status": status_label,
            "contestedEdges": contested_edges[:4]
        })
        
    dataset = {
        "metadata": {
            "title": "Port Daddy Sheaf Telemetry Control Plane",
            "protocol": "FIPA-ACL SC00061G Communicative Speech Acts",
            "mathematics": "Cellular Sheaf Cohomology & Discrete Hodge-Helmholtz",
            "agentCount": num_nodes,
            "edgeCount": num_edges,
            "simplexCount": num_faces,
            "stalkDimension": D,
            "totalTimeSeconds": 30
        },
        "agents": agents,
        "edges": [{"source": u, "target": v, "id": f"{u}_{v}"} for u, v in edges],
        "faces": [{"vertices": list(f), "id": f"{f[0]}_{f[1]}_{f[2]}"} for f in faces],
        "ganttTasks": gantt_tasks,
        "fipaTranscripts": fipa_transcripts,
        "timelineEpochs": timeline_epochs
    }
    
    with open("demos/swarm-telemetry-dashboard/telemetry_data.json", "w") as fp:
        json.dump(dataset, fp, indent=2)
        
    print(f"[Simulation Complete] Generated {len(timeline_epochs)} epochs, {len(gantt_tasks)} Gantt tasks, {len(fipa_transcripts)} FIPA transcripts.")
    print("Saved to demos/swarm-telemetry-dashboard/telemetry_data.json")

if __name__ == "__main__":
    build_simulation()
