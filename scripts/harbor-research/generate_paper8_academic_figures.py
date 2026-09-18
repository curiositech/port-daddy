#!/usr/bin/env python3
"""
Generate publication-grade academic figures for Paper 8:
"The Cohomology of Swarms: Triadic Simplicial Sheaves, Discrete Hodge Legibility, and Optimal Repair"

Conforms strictly to docs/harbor-research/figures/CONVENTION.md:
- Harbor Research Palette:
    harborblue: #1e466e (RGB 30, 70, 110)
    shipred:    #8c1e1e (RGB 140, 30, 30)
    seagreen:   #1f6e46 (RGB 31, 110, 70)
    neutrals:   #1e293b, #475569, #cbd5e1, #ffffff
- Minimalist, austere, high-density scientific styling (SIAM / IEEE / Nature)
- Exact mathematical typography, clean thin lines, zero cartoon badges, zero pastel clown colors
- Strict aspect ratio control: set_aspect('equal') on all geometric plots to prevent squishing
- Structured multi-panel layouts with zero text overlap and generous padding
"""

import os
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import numpy as np

# Standard Harbor Research Color Palette
HARBOR_BLUE = '#1e466e'
SHIP_RED    = '#8c1e1e'
SEA_GREEN   = '#1f6e46'
SLATE_DARK  = '#1e293b'
SLATE_MID   = '#475569'
SLATE_LIGHT = '#94a3b8'
LINE_GRAY   = '#cbd5e1'
BG_LIGHT    = '#f8fafc'
BG_WHITE    = '#ffffff'

plt.rcParams.update({
    'font.size': 9,
    'axes.labelsize': 9.5,
    'axes.titlesize': 10.5,
    'xtick.labelsize': 8.5,
    'ytick.labelsize': 8.5,
    'legend.fontsize': 8.5,
    'figure.titlesize': 11.5,
    'font.family': 'sans-serif',
    'font.sans-serif': ['Helvetica', 'Arial', 'DejaVu Sans'],
    'mathtext.fontset': 'cm',
    'axes.edgecolor': '#94a3b8',
    'axes.linewidth': 0.8,
})

FIG_DIR = "docs/harbor-research/figures"
BRAIN_DIR = "/Users/erichowens/.gemini/antigravity-ide/brain/e497dc38-cc24-40e0-b379-efe6fcf6d4d2"
os.makedirs(FIG_DIR, exist_ok=True)
os.makedirs(BRAIN_DIR, exist_ok=True)

def draw_circle(ax, cx, cy, r_in, fc, ec, lw=1.0, zorder=4):
    """Draws a mathematically true circle on the page regardless of axes aspect ratio."""
    bbox = ax.get_position()
    fig_w, fig_h = ax.figure.get_size_inches()
    ax_w_in = bbox.width * fig_w
    ax_h_in = bbox.height * fig_h
    xlim = ax.get_xlim()
    ylim = ax.get_ylim()
    w_data = 2 * r_in * (xlim[1] - xlim[0]) / ax_w_in
    h_data = 2 * r_in * (ylim[1] - ylim[0]) / ax_h_in
    patch = patches.Ellipse((cx, cy), width=w_data, height=h_data,
                            facecolor=fc, edgecolor=ec, lw=lw, zorder=zorder)
    ax.add_patch(patch)
    return patch

# -------------------------------------------------------------------------
# FIGURE 0: The AI Developer's Field Guide: Core Concepts Defined
# -------------------------------------------------------------------------
def make_fig0():
    fig = plt.figure(figsize=(13.0, 8.8), dpi=300)
    fig.patch.set_facecolor(BG_WHITE)
    
    gs = fig.add_gridspec(2, 2, hspace=0.36, wspace=0.25,
                          left=0.05, right=0.96, top=0.92, bottom=0.07)
    
    fig.suptitle("The AI Engineer's Field Guide: Cellular Sheaves & Cohomology in Multi-Agent Swarms",
                 fontsize=12.5, fontweight='bold', color=SLATE_DARK)

    # ---------------------------------------------------------------------
    # Panel (a): The Stalk F(v) - Inside an AI Agent's State Vector
    # ---------------------------------------------------------------------
    ax_a = fig.add_subplot(gs[0, 0])
    ax_a.set_facecolor(BG_WHITE)
    ax_a.set_title(r"(a) What is a Stalk $\mathcal{F}(v)$? (An Agent's Operational State)",
                   fontsize=9.8, fontweight='bold', color=SLATE_DARK, pad=8)
    ax_a.set_xlim(-0.04, 1.04)
    ax_a.set_ylim(-0.20, 1.05)
    ax_a.axis('off')

    # Central Agent Circle (strictly circular via physical inch calibration)
    draw_circle(ax_a, 0.14, 0.52, 0.42, BG_LIGHT, HARBOR_BLUE, lw=1.5, zorder=2)
    ax_a.text(0.14, 0.56, "AgentNode", ha='center', va='center', fontsize=8.0, fontweight='bold', color=HARBOR_BLUE, zorder=5)
    ax_a.text(0.14, 0.47, r"($v \in V$)", ha='center', va='center', fontsize=7.2, color=SLATE_MID, zorder=5)

    # Exploded Stalk Vector Box with generous width and padding
    rect_stalk = patches.Rectangle((0.32, 0.14), 0.66, 0.78, facecolor=BG_WHITE, edgecolor=LINE_GRAY, lw=0.8)
    ax_a.add_patch(rect_stalk)
    ax_a.text(0.65, 0.84, r"Stalk Vector $x_v \in \mathbb{R}^D$ (Local State)", ha='center', va='center',
              fontsize=8.5, fontweight='bold', color=HARBOR_BLUE)

    stalk_fields = [
        (r"1. Local Turn / Epoch ($t_v \in \mathbb{N}$)", "Execution step counter"),
        (r"2. Token Budget ($b_v \in \mathbb{R}_+$)", "Accumulated LLM spend"),
        (r"3. AST Claim Lease ($h_L \in \mathbb{R}$)", "Hash of claimed symbol / file"),
        (r"4. Git State Hash ($d_v \in \mathbb{R}$)", "Working tree commit root")
    ]
    y_pos = 0.70
    for f_title, f_desc in stalk_fields:
        ax_a.text(0.35, y_pos, f_title, fontsize=7.6, fontweight='bold', color=SLATE_DARK)
        ax_a.text(0.35, y_pos - 0.052, f_desc, fontsize=7.0, color=SLATE_MID, fontstyle='italic')
        y_pos -= 0.14

    # Connecting arrow
    ax_a.annotate('', xy=(0.31, 0.52), xytext=(0.23, 0.52),
                  arrowprops=dict(arrowstyle="-|>", color=HARBOR_BLUE, lw=1.2, mutation_scale=9))
    ax_a.text(0.27, 0.56, r"$\mathcal{F}(v)$", ha='center', va='bottom', fontsize=8.2, color=HARBOR_BLUE, fontweight='bold')

    card_a = patches.Rectangle((0.02, -0.16), 0.96, 0.22, facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.7)
    ax_a.add_patch(card_a)
    ax_a.text(0.50, -0.01, r"$\mathbf{Why\ AI\ Engineers\ Care:}\ \text{Automated Proofs vs Log Archaeology}$",
              ha='center', va='center', fontsize=7.8, fontweight='bold', color=SLATE_DARK)
    ax_a.text(0.50, -0.10, "Abstracting agent state into numeric stalks allows instant linear-algebraic verification\nwithout parsing hundreds of thousands of LLM chat tokens.",
              ha='center', va='center', fontsize=7.0, color=SLATE_MID)

    # ---------------------------------------------------------------------
    # Panel (b): The Cochain Complex - Agents, Channels, and Review Joins
    # ---------------------------------------------------------------------
    ax_b = fig.add_subplot(gs[0, 1])
    ax_b.set_facecolor(BG_WHITE)
    ax_b.set_title(r"(b) What is a Cochain Complex? ($C^0 \to C^1 \to C^2$)",
                   fontsize=9.8, fontweight='bold', color=SLATE_DARK, pad=8)
    ax_b.set_xlim(-0.04, 1.04)
    ax_b.set_ylim(-0.20, 1.05)
    ax_b.axis('off')

    stages = [
        ("0-Cochains $C^0$", "Agent Nodes", "State stalks $x_v$", 0.02, 0.28, HARBOR_BLUE),
        ("1-Cochains $C^1$", "Channels & PRs", "Edge diffs $g_e$", 0.36, 0.28, SEA_GREEN),
        ("2-Cochains $C^2$", "3-Way Joins", "Review contracts $\\tau$", 0.70, 0.28, SHIP_RED)
    ]
    for title, role, desc, sx, sw, col in stages:
        box = patches.Rectangle((sx, 0.40), sw, 0.52, facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.8)
        ax_b.add_patch(box)
        ax_b.text(sx + sw/2, 0.83, title, ha='center', va='center', fontsize=8.5, fontweight='bold', color=col)
        ax_b.text(sx + sw/2, 0.66, role, ha='center', va='center', fontsize=8.0, fontweight='bold', color=SLATE_DARK)
        ax_b.text(sx + sw/2, 0.50, desc, ha='center', va='center', fontsize=7.5, color=SLATE_MID)

    ax_b.annotate('', xy=(0.35, 0.66), xytext=(0.31, 0.66),
                  arrowprops=dict(arrowstyle="-|>", color=SLATE_MID, lw=1.2, mutation_scale=9))
    ax_b.text(0.33, 0.72, r"$\delta_0$", ha='center', va='bottom', fontsize=8.8, fontweight='bold', color=SLATE_DARK)

    ax_b.annotate('', xy=(0.69, 0.66), xytext=(0.65, 0.66),
                  arrowprops=dict(arrowstyle="-|>", color=SLATE_MID, lw=1.2, mutation_scale=9))
    ax_b.text(0.67, 0.72, r"$\delta_1$", ha='center', va='bottom', fontsize=8.8, fontweight='bold', color=SLATE_DARK)

    rect_id = patches.Rectangle((0.02, -0.16), 0.96, 0.46, facecolor=BG_WHITE, edgecolor=LINE_GRAY, lw=0.8)
    ax_b.add_patch(rect_id)
    ax_b.text(0.50, 0.21, r"$\mathbf{Fundamental\ Simplicial\ Identity:}\ \delta_1 \circ \delta_0 = 0$",
              ha='center', va='center', fontsize=8.2, fontweight='bold', color=SLATE_DARK)
    ax_b.text(0.50, 0.10, "(The curl of a gradient is identically zero across any 3-agent join)",
              ha='center', va='center', fontsize=7.2, color=SLATE_MID, fontstyle='italic')
    ax_b.text(0.50, -0.01, r"$\mathbf{Why\ AI\ Engineers\ Care:}\ \text{Zero False-Alarm Guarantee}$",
              ha='center', va='center', fontsize=7.8, fontweight='bold', color=SLATE_DARK)
    ax_b.text(0.50, -0.09, "Legitimate asynchronous agent progress never produces spurious review-cycle alerts,\neliminating developer alert fatigue in high-throughput swarms.",
              ha='center', va='center', fontsize=7.0, color=SLATE_MID)

    # ---------------------------------------------------------------------
    # Panel (c): Gossip Tree vs Review Cycle - Why Open Trees Swallow Lies
    # ---------------------------------------------------------------------
    ax_c = fig.add_subplot(gs[1, 0])
    ax_c.set_facecolor(BG_WHITE)
    ax_c.set_title("(c) What is a Gossip Tree? (Why Open Trees Miss Lies)",
                   fontsize=9.8, fontweight='bold', color=SLATE_DARK, pad=8)
    ax_c.set_xlim(-0.04, 1.04)
    ax_c.set_ylim(-0.20, 1.05)
    ax_c.axis('off')

    # Sub-panel 1: Tree (left)
    ax_c.text(0.24, 0.94, "Open Delegation Tree\n(LangChain / AutoGen)", ha='center', va='center', fontsize=7.8, fontweight='bold', color=SLATE_DARK)
    tree_nodes = {0: (0.24, 0.72), 1: (0.10, 0.42), 2: (0.38, 0.42), 3: (0.10, 0.14), 4: (0.38, 0.14)}
    for u, v in [(0, 1), (0, 2), (1, 3), (2, 4)]:
        x1, y1 = tree_nodes[u]
        x2, y2 = tree_nodes[v]
        ax_c.annotate('', xy=(x2, y2), xytext=(x1, y1),
                      arrowprops=dict(arrowstyle="-|>", color=SLATE_MID, lw=1.0, shrinkA=8, shrinkB=8, mutation_scale=8))

    for n, (x, y) in tree_nodes.items():
        fc = SHIP_RED if n == 1 else HARBOR_BLUE
        draw_circle(ax_c, x, y, 0.16, fc, SLATE_DARK, lw=0.8, zorder=4)
        ax_c.text(x, y, f"v{n}", ha='center', va='center', fontsize=7.2, color=BG_WHITE, fontweight='bold', zorder=5)

    card_c1 = patches.Rectangle((0.02, -0.16), 0.44, 0.22, facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.6)
    ax_c.add_patch(card_c1)
    ax_c.text(0.24, -0.01, r"$\ker(\delta_0^T) = \{0\}$ (Silent!)", ha='center', va='center', fontsize=7.5, fontweight='bold', color=SHIP_RED)
    ax_c.text(0.24, -0.10, "Acyclic trees swallow lies\nas benign network delays", ha='center', va='center', fontsize=6.8, color=SLATE_MID)

    # Sub-panel 2: Cycle (right)
    ax_c.text(0.76, 0.94, "Closed Review Cycle\n(Port Daddy / Harbor)", ha='center', va='center', fontsize=7.8, fontweight='bold', color=SLATE_DARK)
    cycle_nodes = {0: (0.64, 0.68), 1: (0.88, 0.68), 2: (0.88, 0.26), 3: (0.64, 0.26)}
    for u, v, lie in [(0, 1, False), (1, 2, True), (2, 3, False), (3, 0, False)]:
        x1, y1 = cycle_nodes[u]
        x2, y2 = cycle_nodes[v]
        col = SHIP_RED if lie else HARBOR_BLUE
        ax_c.annotate('', xy=(x2, y2), xytext=(x1, y1),
                      arrowprops=dict(arrowstyle="-|>", color=col, lw=1.4 if lie else 1.0, shrinkA=8, shrinkB=8, mutation_scale=8))

    for n, (x, y) in cycle_nodes.items():
        fc = SHIP_RED if n == 1 else HARBOR_BLUE
        draw_circle(ax_c, x, y, 0.16, fc, SLATE_DARK, lw=0.8, zorder=4)
        ax_c.text(x, y, f"u{n}", ha='center', va='center', fontsize=7.2, color=BG_WHITE, fontweight='bold', zorder=5)

    arc = patches.Arc((0.76, 0.47), 0.22, 0.22, angle=0, theta1=20, theta2=310, color=SHIP_RED, lw=1.1, ls='--')
    ax_c.add_patch(arc)
    ax_c.text(0.76, 0.47, r"$\rho \neq 0$", ha='center', va='center', fontsize=7.2, color=SHIP_RED)

    card_c2 = patches.Rectangle((0.54, -0.16), 0.44, 0.22, facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.6)
    ax_c.add_patch(card_c2)
    ax_c.text(0.76, -0.01, r"$\ker(\delta_0^T) \neq \{0\}$ (Trapped!)", ha='center', va='center', fontsize=7.5, fontweight='bold', color=HARBOR_BLUE)
    ax_c.text(0.76, -0.10, "Cycle traps hallucination\nwith certified residual $r > 0$", ha='center', va='center', fontsize=6.8, color=SLATE_MID)

    # ---------------------------------------------------------------------
    # Panel (d): Gauge vs Triadic Curl - Benign Lag vs Hallucination
    # ---------------------------------------------------------------------
    ax_d = fig.add_subplot(gs[1, 1])
    ax_d.set_facecolor(BG_WHITE)
    ax_d.set_title(r"(d) Gauge Process ($\delta_0 x$) vs Triadic Curl ($\delta_1^* \psi$)",
                   fontsize=9.8, fontweight='bold', color=SLATE_DARK, pad=8)
    ax_d.set_xlim(-0.04, 1.04)
    ax_d.set_ylim(-0.20, 1.05)
    ax_d.axis('off')

    # Left: Gauge (Benign Turn Delay)
    ax_d.text(0.24, 0.94, "Gauge Skew\n(Benign Turn Lag)", ha='center', va='center', fontsize=7.8, fontweight='bold', color=SEA_GREEN)
    g_pts = [(0.10, 0.26), (0.38, 0.26), (0.24, 0.70)]
    for (x1, y1), (x2, y2) in [(g_pts[0], g_pts[1]), (g_pts[1], g_pts[2]), (g_pts[0], g_pts[2])]:
        ax_d.annotate('', xy=(x2, y2), xytext=(x1, y1),
                      arrowprops=dict(arrowstyle="-|>", color=SEA_GREEN, lw=1.2, shrinkA=8, shrinkB=8, mutation_scale=8))

    for i, (x, y) in enumerate(g_pts):
        draw_circle(ax_d, x, y, 0.17, BG_WHITE, SEA_GREEN, lw=1.2, zorder=4)
        ax_d.text(x, y, f"t{i}", ha='center', va='center', fontsize=7.2, color=SLATE_DARK, zorder=5)

    ax_d.text(0.24, 0.42, r"$\delta_1 g = 0$" + "\nCurl-free", ha='center', va='center', fontsize=7.5, color=SEA_GREEN)
    
    card_d1 = patches.Rectangle((0.02, -0.16), 0.44, 0.22, facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.6)
    ax_d.add_patch(card_d1)
    ax_d.text(0.24, -0.01, "Action: Do Nothing!", ha='center', va='center', fontsize=7.5, fontweight='bold', color=SEA_GREEN)
    ax_d.text(0.24, -0.10, "Benign step latency;\nself-resolves on next turn", ha='center', va='center', fontsize=6.8, color=SLATE_MID)

    # Right: Triadic Curl (Hallucination Bug)
    ax_d.text(0.76, 0.94, "Triadic Curl\n(Review Bug)", ha='center', va='center', fontsize=7.8, fontweight='bold', color=SHIP_RED)
    c_pts = [(0.62, 0.26), (0.90, 0.26), (0.76, 0.70)]
    poly = plt.Polygon(c_pts, facecolor=BG_LIGHT, edgecolor=SHIP_RED, lw=1.2, zorder=2)
    ax_d.add_patch(poly)

    arc_d = patches.Arc((0.76, 0.43), 0.20, 0.20, angle=0, theta1=20, theta2=310, color=SHIP_RED, lw=1.1, ls='--')
    ax_d.add_patch(arc_d)
    ax_d.annotate('', xy=(0.86, 0.47), xytext=(0.86, 0.42), arrowprops=dict(arrowstyle="-|>", color=SHIP_RED, lw=1.0))

    role_lbls = ["Coder", "Critic", "Mgr"]
    for i, (x, y) in enumerate(c_pts):
        draw_circle(ax_d, x, y, 0.17, BG_WHITE, SHIP_RED, lw=1.2, zorder=4)
        ax_d.text(x, y, role_lbls[i], ha='center', va='center', fontsize=6.5, color=SLATE_DARK, zorder=5)

    ax_d.text(0.76, 0.43, r"$\delta_1 g \neq 0$" + "\nParadox!", ha='center', va='center', fontsize=7.2, color=SHIP_RED)

    card_d2 = patches.Rectangle((0.54, -0.16), 0.44, 0.22, facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.6)
    ax_d.add_patch(card_d2)
    ax_d.text(0.76, -0.01, "Action: Re-prompt Triad!", ha='center', va='center', fontsize=7.5, fontweight='bold', color=SHIP_RED)
    ax_d.text(0.76, -0.10, "Review contract violated;\nre-prompt dissent loop", ha='center', va='center', fontsize=6.8, color=SLATE_MID)

    plt.savefig(os.path.join(FIG_DIR, "fig-paper8-agent-foundations.png"), dpi=300, facecolor=BG_WHITE)
    plt.savefig(os.path.join(BRAIN_DIR, "fig-paper8-agent-foundations.png"), dpi=300, facecolor=BG_WHITE)
    plt.close()
    print("Regenerated Figure 0 (Agent Foundations).")

# -------------------------------------------------------------------------
# FIGURE 1: Open Tree vs Closed Cycle (Topological Horizon)
# -------------------------------------------------------------------------
def make_fig1():
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10.5, 4.4), dpi=300)
    fig.patch.set_facecolor(BG_WHITE)

    # Panel A: Open Tree
    ax1.set_facecolor(BG_WHITE)
    ax1.set_title("(a) Acyclic Gossip Tree ($r = 0$, Provably Silent)", pad=10, fontweight='bold', color=SLATE_DARK)
    ax1.set_aspect('equal')
    
    pos_tree = {
        0: (0.5, 0.82),
        1: (0.25, 0.48),
        2: (0.75, 0.48),
        3: (0.12, 0.14),
        4: (0.38, 0.14),
        5: (0.75, 0.14)
    }
    tree_edges = [
        (0, 1, -0.06, 0.02),
        (0, 2,  0.06, 0.02),
        (1, 3, -0.06, 0.00),
        (1, 4,  0.06, 0.00),
        (2, 5,  0.06, 0.00)
    ]
    
    for u, v, dx, dy in tree_edges:
        x1, y1 = pos_tree[u]
        x2, y2 = pos_tree[v]
        ax1.annotate('', xy=(x2, y2), xytext=(x1, y1),
                     arrowprops=dict(arrowstyle="-|>", color=SLATE_MID, lw=1.2, mutation_scale=10, shrinkA=8, shrinkB=8))
        mx, my = (x1 + x2)/2, (y1 + y2)/2
        ax1.text(mx + dx, my + dy, r"$g_e = x_v - x_u$", fontsize=7.2, color=SLATE_MID, fontstyle='italic', ha='center')

    for node, (x, y) in pos_tree.items():
        fc = SHIP_RED if node == 1 else HARBOR_BLUE
        circle = plt.Circle((x, y), 0.045, facecolor=fc, edgecolor=SLATE_DARK, lw=1.0, zorder=4)
        ax1.add_patch(circle)
        label = r"$v_1^*$" if node == 1 else f"$v_{node}$"
        ax1.text(x, y, label, ha='center', va='center', fontsize=8, color=BG_WHITE, fontweight='bold', zorder=5)

    ax1.text(0.5, -0.05, 
             r"Theorem CR-1: $\ker(\delta_0^T) = \{0\} \Rightarrow \Pi_T = 0 \Rightarrow r = 0$" + "\n"
             r"Any uninspected edge lie is absorbed by vertex potentials; equivocation is dark.",
             ha='center', va='top', fontsize=8, color=SLATE_DARK,
             bbox=dict(boxstyle="square,pad=0.4", facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.8))

    ax1.set_xlim(-0.05, 1.05)
    ax1.set_ylim(-0.15, 0.95)
    ax1.axis('off')

    # Panel B: Closed Cycle
    ax2.set_facecolor(BG_WHITE)
    ax2.set_title("(b) Cycle Topology ($r > 0$, Certified Lower Bound)", pad=10, fontweight='bold', color=SLATE_DARK)
    ax2.set_aspect('equal')

    pos_cycle = {0: (0.22, 0.75), 1: (0.78, 0.75), 2: (0.78, 0.22), 3: (0.22, 0.22)}
    cycle_edges = [
        (0, 1, r"$g_{01} = 0$", False),
        (1, 2, r"$g_{12} = +3.0$ (Lie)", True),
        (2, 3, r"$g_{23} = 0$", False),
        (3, 0, r"$g_{30} = 0$", False)
    ]

    for u, v, lbl, is_lie in cycle_edges:
        x1, y1 = pos_cycle[u]
        x2, y2 = pos_cycle[v]
        col = SHIP_RED if is_lie else HARBOR_BLUE
        lw = 1.6 if is_lie else 1.2
        ax2.annotate('', xy=(x2, y2), xytext=(x1, y1),
                     arrowprops=dict(arrowstyle="-|>", color=col, lw=lw, mutation_scale=10, shrinkA=8, shrinkB=8))
        mx, my = (x1 + x2)/2, (y1 + y2)/2
        dx, dy = (0, 0.05) if y1 == y2 else (0.05, 0)
        ax2.text(mx + dx, my + dy, lbl, ha='center', va='center', fontsize=7.8,
                 color=SHIP_RED if is_lie else SLATE_DARK, fontweight='bold' if is_lie else 'normal')

    arc = patches.Arc((0.5, 0.485), 0.24, 0.24, angle=0, theta1=20, theta2=310, color=SHIP_RED, lw=1.2, ls='--')
    ax2.add_patch(arc)
    ax2.annotate('', xy=(0.61, 0.53), xytext=(0.62, 0.49),
                 arrowprops=dict(arrowstyle="-|>", color=SHIP_RED, lw=1.2, mutation_scale=8))
    ax2.text(0.5, 0.485, r"$\rho \in \ker(B^T)$" + "\n" + r"$\|\rho\|_2 = 1.500$",
             ha='center', va='center', fontsize=7.8, color=SHIP_RED)

    for node, (x, y) in pos_cycle.items():
        fc = SHIP_RED if node == 1 else HARBOR_BLUE
        circle = plt.Circle((x, y), 0.045, facecolor=fc, edgecolor=SLATE_DARK, lw=1.0, zorder=4)
        ax2.add_patch(circle)
        label = r"$v_1^*$" if node == 1 else f"$v_{node}$"
        ax2.text(x, y, label, ha='center', va='center', fontsize=8, color=BG_WHITE, fontweight='bold', zorder=5)

    ax2.text(0.5, -0.05, 
             r"Closed form: $r = |s|\sqrt{1 - R_{\mathrm{eff}}(e)} = 3.0\sqrt{1 - 3/4} = 1.500$" + "\n"
             r"The cycle constraint traps the uninspected lie with certified lower bound $r \leq \|\varepsilon\|_2$.",
             ha='center', va='top', fontsize=8, color=SLATE_DARK,
             bbox=dict(boxstyle="square,pad=0.4", facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.8))

    ax2.set_xlim(-0.05, 1.05)
    ax2.set_ylim(-0.15, 0.95)
    ax2.axis('off')

    plt.tight_layout()
    plt.savefig(os.path.join(FIG_DIR, "fig-paper8-topological-loop.png"), dpi=300, facecolor=BG_WHITE)
    plt.savefig(os.path.join(BRAIN_DIR, "fig-paper8-topological-loop.png"), dpi=300, facecolor=BG_WHITE)
    plt.close()
    print("Regenerated Figure 1.")

# -------------------------------------------------------------------------
# FIGURE 2: The Rosetta Stone (Swarm to Cellular Sheaves)
# -------------------------------------------------------------------------
def make_fig2():
    fig, ax = plt.subplots(figsize=(9.8, 4.4), dpi=300)
    fig.patch.set_facecolor(BG_WHITE)
    ax.set_facecolor(BG_WHITE)
    ax.set_title("The Rosetta Stone: Mapping Multi-Agent Swarms to Cellular Sheaves", 
                 pad=12, fontsize=11, fontweight='bold', color=SLATE_DARK)

    cols = [
        (r"0-Cells: AgentNodes ($v \in V$)", 0.04, 0.28, [
            r"Stalk Vector $x_v \in \mathbb{R}^D$:",
            r"$\bullet$ Local Epoch: $t_v \in \mathbb{N}$",
            r"$\bullet$ Token Spend: $b_v \in \mathbb{R}_+$",
            r"$\bullet$ AST Lease Hash: $h_L \in \mathbb{R}$",
            r"$\bullet$ State Root Digest: $d_v \in \mathbb{R}$"
        ]),
        (r"1-Cells: Channels & Claims ($e \in E$)", 0.36, 0.28, [
            r"Restriction Map $P_e: \mathbb{R}^D \to \mathbb{R}^S$:",
            r"$\bullet$ Coordinate-wise selection",
            r"$\bullet$ Edge Discrepancy (1-Cochain):",
            r"  $g_e = P_e x_v - P_e x_u$",
            r"$\bullet$ Coboundary $(\delta_0 x)_e = x_v - x_u$"
        ]),
        (r"2-Cells: Review Contracts ($\tau \in F$)", 0.68, 0.28, [
            r"Triadic Consensus Join:",
            r"$\bullet$ Producer $\leftrightarrow$ Dissenter",
            r"$\bullet$ Dissenter $\leftrightarrow$ Manager",
            r"$\bullet$ Manager $\leftrightarrow$ Producer",
            r"$\bullet$ Boundary: $(\delta_1 g)_\tau = g_{01} + g_{12} - g_{02}$"
        ])
    ]

    for title, x, w, items in cols:
        rect = patches.Rectangle((x, 0.45), w, 0.46, facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.8)
        ax.add_patch(rect)
        ax.text(x + w/2, 0.85, title, ha='center', va='center', fontsize=8.8, fontweight='bold', color=HARBOR_BLUE)
        body = "\n".join(items)
        ax.text(x + 0.015, 0.62, body, ha='left', va='center', fontsize=8.0, color=SLATE_DARK, linespacing=1.35)

    ax.annotate('', xy=(0.355, 0.68), xytext=(0.325, 0.68),
                arrowprops=dict(arrowstyle="-|>", lw=1.2, color=SLATE_MID, mutation_scale=10))
    ax.text(0.34, 0.72, r"$\delta_0$", ha='center', va='center', fontsize=10, fontweight='bold', color=SLATE_DARK)

    ax.annotate('', xy=(0.675, 0.68), xytext=(0.645, 0.68),
                arrowprops=dict(arrowstyle="-|>", lw=1.2, color=SLATE_MID, mutation_scale=10))
    ax.text(0.66, 0.72, r"$\delta_1$", ha='center', va='center', fontsize=10, fontweight='bold', color=SLATE_DARK)

    rect_bottom = patches.Rectangle((0.04, 0.08), 0.92, 0.30, facecolor=BG_WHITE, edgecolor=LINE_GRAY, lw=0.8)
    ax.add_patch(rect_bottom)

    ax.text(0.50, 0.27, 
            r"Discrete Cochain Complex:   "
            r"$0 \longrightarrow C^0(X; \mathcal{F}) \longrightarrow C^1(X; \mathcal{F}) \longrightarrow C^2(X; \mathcal{F}) \longrightarrow 0$",
            ha='center', va='center', fontsize=9.2, color=SLATE_DARK)
    
    ax.text(0.50, 0.15,
            r"Fundamental Simplicial Boundary Identity:   $\delta_1 \circ \delta_0 = 0 \ \Leftrightarrow \ \mathrm{im}(\delta_0) \subseteq \ker(\delta_1)$" + "\n"
            r"(Honest potential gradients automatically satisfy all triadic contracts with zero curl)",
            ha='center', va='center', fontsize=8.2, color=SLATE_MID)

    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis('off')

    plt.tight_layout()
    plt.savefig(os.path.join(FIG_DIR, "fig-paper8-sheaf-rosetta.png"), dpi=300, facecolor=BG_WHITE)
    plt.savefig(os.path.join(BRAIN_DIR, "fig-paper8-sheaf-rosetta.png"), dpi=300, facecolor=BG_WHITE)
    plt.close()
    print("Regenerated Figure 2.")

# -------------------------------------------------------------------------
# FIGURE 3: Discrete Hodge Decomposition & Legibility Ratio (UNSQUISHED)
# -------------------------------------------------------------------------
def make_fig3():
    fig = plt.figure(figsize=(12.0, 4.8), dpi=300)
    fig.patch.set_facecolor(BG_WHITE)
    
    gs = fig.add_gridspec(1, 4, width_ratios=[1.0, 1.0, 1.0, 0.85], wspace=0.30,
                          left=0.04, right=0.96, top=0.84, bottom=0.12)
    
    fig.suptitle("Simplicial Hodge Decomposition: Categorizing Swarm Disagreements for AI Supervisors",
                 fontsize=11.5, fontweight='bold', color=SLATE_DARK, y=0.96)

    ax1 = fig.add_subplot(gs[0])
    ax2 = fig.add_subplot(gs[1])
    ax3 = fig.add_subplot(gs[2])
    ax4 = fig.add_subplot(gs[3])

    for ax in [ax1, ax2, ax3]:
        ax.set_facecolor(BG_WHITE)
        ax.set_aspect('equal')
        ax.set_xlim(-0.05, 1.05)
        ax.set_ylim(-0.15, 1.05)
        ax.axis('off')

    tri_pts = [(0.18, 0.18), (0.82, 0.18), (0.50, 0.76)]

    # 1. Gauge Gradient delta_0 x
    ax1.set_title(r"1. Gauge Gradient $\delta_0 x$" + "\n" + r"$\mathbf{Benign\ Turn\ Skew}$" + "\n" + r"($\delta_1(\delta_0 x) \equiv 0$, Curl-Free)", 
                  fontsize=8.5, fontweight='bold', color=SEA_GREEN, pad=6)
    
    for (x1, y1), (x2, y2) in [(tri_pts[0], tri_pts[1]), (tri_pts[1], tri_pts[2]), (tri_pts[0], tri_pts[2])]:
        ax1.annotate('', xy=(x2, y2), xytext=(x1, y1),
                     arrowprops=dict(arrowstyle="-|>", color=SEA_GREEN, lw=1.3, shrinkA=8, shrinkB=8, mutation_scale=9))

    for i, (x, y) in enumerate(tri_pts):
        ax1.add_patch(plt.Circle((x, y), 0.065, facecolor=BG_WHITE, edgecolor=SEA_GREEN, lw=1.2, zorder=4))
        ax1.text(x, y, f"v{i}", ha='center', va='center', fontsize=7.8, color=SLATE_DARK, fontweight='bold', zorder=5)

    ax1.text(0.5, 0.36, "Turn skew:\n$x_v - x_u$\n" + r"$\mathbf{\delta_1 g = 0}$", ha='center', va='center', fontsize=7.5, color=SEA_GREEN)
    ax1.text(0.5, -0.10, "Action: Ignore.\nSelf-resolves naturally.", ha='center', va='center', fontsize=7.2, color=SLATE_MID,
             bbox=dict(boxstyle="square,pad=0.3", facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.6))

    # 2. Harmonic Cavity h
    ax2.set_title(r"2. Harmonic Cavity $h \in \mathcal{H}^1$" + "\n" + r"$\mathbf{Network\ Split\ /\ Partition}$" + "\n" + r"($\delta_1 h = 0$, $\delta_0^* h = 0$)", 
                  fontsize=8.5, fontweight='bold', color=HARBOR_BLUE, pad=6)
    
    square_pts = [(0.20, 0.20), (0.80, 0.20), (0.80, 0.74), (0.20, 0.74)]
    for i in range(4):
        ax2.annotate('', xy=square_pts[(i+1)%4], xytext=square_pts[i], 
                     arrowprops=dict(arrowstyle="-|>", color=HARBOR_BLUE, lw=1.3, shrinkA=8, shrinkB=8, mutation_scale=9))
    
    hole = plt.Circle((0.50, 0.47), 0.16, facecolor=BG_LIGHT, edgecolor=HARBOR_BLUE, lw=0.8, ls='--')
    ax2.add_patch(hole)
    ax2.text(0.50, 0.47, "Macro Void\n(Cross-Harbor\nLag)", ha='center', va='center', fontsize=7.0, color=HARBOR_BLUE)

    for i, (x, y) in enumerate(square_pts):
        ax2.add_patch(plt.Circle((x, y), 0.065, facecolor=BG_WHITE, edgecolor=HARBOR_BLUE, lw=1.2, zorder=4))
        ax2.text(x, y, f"u{i}", ha='center', va='center', fontsize=7.8, color=SLATE_DARK, fontweight='bold', zorder=5)

    ax2.text(0.5, -0.10, "Action: Reconnect relay.\nGlobal state drifting.", ha='center', va='center', fontsize=7.2, color=SLATE_MID,
             bbox=dict(boxstyle="square,pad=0.3", facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.6))

    # 3. Triadic Curl delta_1^* psi
    ax3.set_title(r"3. Triadic Curl $\delta_1^* \psi$" + "\n" + r"$\mathbf{Review\ Hallucination}$" + "\n" + r"($\delta_1 g \neq 0$, Divergence-Free)", 
                  fontsize=8.5, fontweight='bold', color=SHIP_RED, pad=6)
    
    poly = plt.Polygon(tri_pts, facecolor=BG_LIGHT, edgecolor=SHIP_RED, lw=1.2, zorder=2)
    ax3.add_patch(poly)
    arc = patches.Arc((0.50, 0.42), 0.22, 0.22, angle=0, theta1=20, theta2=320, color=SHIP_RED, lw=1.1, ls='--')
    ax3.add_patch(arc)
    ax3.annotate('', xy=(0.60, 0.46), xytext=(0.61, 0.42), arrowprops=dict(arrowstyle="-|>", color=SHIP_RED, lw=1.1))
    
    # Position text cleanly below the arc arrow to prevent any overlap
    ax3.text(0.50, 0.32, "Broken 3-Way\nReview Join\n" + r"$(\mathbf{\delta_1 g \neq 0})$", ha='center', va='center', fontsize=7.2, color=SHIP_RED)

    role_labels = ["Coder", "Critic", "Mgr"]
    for i, (x, y) in enumerate(tri_pts):
        ax3.add_patch(plt.Circle((x, y), 0.065, facecolor=BG_WHITE, edgecolor=SHIP_RED, lw=1.2, zorder=4))
        ax3.text(x, y, role_labels[i], ha='center', va='center', fontsize=6.5, color=SLATE_DARK, fontweight='bold', zorder=5)

    ax3.text(0.5, -0.10, "Action: Re-prompt triad!\nPrompt critique loop.", ha='center', va='center', fontsize=7.2, color=SHIP_RED,
             bbox=dict(boxstyle="square,pad=0.3", facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.6))

    # 4. Legibility Ratio Bar Chart
    ax4.set_facecolor(BG_WHITE)
    ax4.set_title(r"$\mathbf{Swarm\ Legibility\ \mathcal{L}(g)}$" + "\n" + r"$\frac{\|h\|^2}{\|h\|^2 + \|\delta_1^*\psi\|^2}$",
                  fontsize=8.5, fontweight='bold', color=SLATE_DARK, pad=8)
    
    categories = ['Review Bug\n(Micro)', 'Network Split\n(Macro)']
    values = [0.00, 1.00]
    bars = ax4.bar(categories, values, width=0.45, color=[SHIP_RED, HARBOR_BLUE], edgecolor=SLATE_DARK, lw=0.8)
    ax4.set_ylabel(r"$\mathcal{L}(g) \in [0, 1]$", fontsize=8.2)
    ax4.set_ylim(0, 1.20)
    ax4.grid(axis='y', linestyle=':', alpha=0.35)
    ax4.text(0, 0.05, "0.00", ha='center', va='bottom', fontsize=8, fontweight='bold', color=SHIP_RED)
    ax4.text(1, 1.03, "1.00", ha='center', va='bottom', fontsize=8, fontweight='bold', color=HARBOR_BLUE)

    plt.savefig(os.path.join(FIG_DIR, "fig-paper8-simplicial-hodge.png"), dpi=300, facecolor=BG_WHITE)
    plt.savefig(os.path.join(BRAIN_DIR, "fig-paper8-simplicial-hodge.png"), dpi=300, facecolor=BG_WHITE)
    plt.close()
    print("Regenerated Figure 3 (Unsquished).")

# -------------------------------------------------------------------------
# FIGURE 4: Theorem CR-4 (Optimal Cohomological Repair via Min-Cut)
# -------------------------------------------------------------------------
def make_fig4():
    fig, (ax1, ax2, ax3) = plt.subplots(1, 3, figsize=(11.5, 4.0), dpi=300)
    fig.patch.set_facecolor(BG_WHITE)

    # Panel 1: Residual Flow Graph
    ax1.set_facecolor(BG_WHITE)
    ax1.set_aspect('equal')
    ax1.set_title(r"(a) Residual Flow $\rho = \Pi_K g_K$", fontsize=9.5, fontweight='bold', color=SLATE_DARK)
    pos = {0: (0.18, 0.82), 1: (0.82, 0.82), 2: (0.82, 0.18), 3: (0.18, 0.18)}
    edge_energies = {(0,1): 0.50, (1,2): 2.33, (2,3): 0.80, (3,0): 0.80, (0,2): 1.85}
    
    for (u, v), en in edge_energies.items():
        col = SHIP_RED if en > 1.5 else SLATE_LIGHT
        lw = 1.0 + en * 0.8
        ax1.plot([pos[u][0], pos[v][0]], [pos[u][1], pos[v][1]], color=col, lw=lw, zorder=2)
        mx, my = (pos[u][0] + pos[v][0])/2, (pos[u][1] + pos[v][1])/2
        ax1.text(mx, my, f"{en:.2f}", fontsize=7.2, color=SHIP_RED if en > 1.5 else SLATE_MID,
                 bbox=dict(boxstyle="square,pad=0.15", facecolor=BG_WHITE, edgecolor=LINE_GRAY, lw=0.5))

    for node, (x, y) in pos.items():
        fc = SHIP_RED if node == 2 else HARBOR_BLUE
        ax1.add_patch(plt.Circle((x, y), 0.065, facecolor=fc, edgecolor=SLATE_DARK, lw=0.8, zorder=4))
        ax1.text(x, y, f"$v_{node}$", ha='center', va='center', fontsize=8.5, color=BG_WHITE, fontweight='bold', zorder=5)

    ax1.text(0.5, -0.05, r"Initial $r = 2.683$; Node $v_2$ equivocating", ha='center', va='top', fontsize=7.8, color=SLATE_DARK)
    ax1.set_xlim(0.05, 0.95)
    ax1.set_ylim(-0.12, 0.95)
    ax1.axis('off')

    # Panel 2: Ratio Controller Plot
    ax2.set_facecolor(BG_WHITE)
    ax2.set_title(r"(b) Controller: $\arg\max \frac{E(e)}{w(e)}$", fontsize=9.5, fontweight='bold', color=SLATE_DARK)
    edge_names = ['(0,1)', '(1,2)', '(2,3)', '(3,0)', '(0,2)']
    costs = [5.0, 5.0, 5.0, 5.0, 1.0]
    energies = [0.50, 2.33, 0.80, 0.80, 1.85]
    ratios = [en / c for en, c in zip(energies, costs)]
    
    bars = ax2.bar(edge_names, ratios, width=0.45, color=[SLATE_LIGHT]*4 + [HARBOR_BLUE], edgecolor=SLATE_DARK, lw=0.8)
    ax2.set_ylabel(r"Ratio $E(e)/w(e)$", fontsize=8.5)
    ax2.grid(axis='y', linestyle=':', alpha=0.35)
    ax2.text(4, ratios[4] + 0.06, r"Optimal Cut $e^*$" + "\n" + r"(Ratio=1.85)", ha='center', va='bottom', fontsize=7.5, color=HARBOR_BLUE, fontweight='bold')
    ax2.set_ylim(0, 2.3)

    # Panel 3: Monotonic Decay Curve
    ax3.set_facecolor(BG_WHITE)
    ax3.set_title(r"(c) Residual Collapse: $r(t) \to 0$", fontsize=9.5, fontweight='bold', color=SLATE_DARK)
    rounds = [0, 1, 2]
    residuals = [2.683, 1.528, 0.000]
    
    ax3.plot(rounds, residuals, marker='s', lw=1.4, color=HARBOR_BLUE, markersize=5)
    for r_idx, val in zip(rounds, residuals):
        dy = 0.18 if val > 0 else 0.18
        dx = -0.12 if val == 0 else 0.0
        ax3.text(r_idx + dx, val + dy, f"$r={val:.3f}$", ha='center', va='bottom', fontsize=8, color=HARBOR_BLUE)
    
    ax3.set_xlabel("Intervention Round", fontsize=8.5)
    ax3.set_ylabel("Completion Residual $r$", fontsize=8.5)
    ax3.set_xticks([0, 1, 2])
    ax3.set_ylim(-0.2, 3.2)
    ax3.grid(True, linestyle=':', alpha=0.35)
    ax3.text(1.15, 0.4, r"Bound: $\leq \beta_1(G)$ rounds" + "\n" + r"$\beta_1(G) = 5 - 4 + 1 = 2$",
             fontsize=7.8, color=SEA_GREEN, bbox=dict(boxstyle="square,pad=0.3", facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.6))

    plt.tight_layout()
    plt.savefig(os.path.join(FIG_DIR, "fig-paper8-active-repair.png"), dpi=300, facecolor=BG_WHITE)
    plt.savefig(os.path.join(BRAIN_DIR, "fig-paper8-active-repair.png"), dpi=300, facecolor=BG_WHITE)
    plt.close()
    print("Regenerated Figure 4.")

# -------------------------------------------------------------------------
# FIGURE 5: 16-Agent Clustered Enterprise Matrix (NO OVERLAPS!)
# -------------------------------------------------------------------------
def make_fig5():
    fig = plt.figure(figsize=(12.5, 6.2), dpi=300)
    fig.patch.set_facecolor(BG_WHITE)
    
    gs = fig.add_gridspec(2, 2, width_ratios=[1.25, 0.95], height_ratios=[1.0, 1.25],
                          wspace=0.26, hspace=0.36,
                          left=0.05, right=0.96, top=0.91, bottom=0.09)

    fig.suptitle("16-Agent Enterprise Swarm: Simplicial Hodge Triage of Mixed Failures",
                 fontsize=11.5, fontweight='bold', color=SLATE_DARK)

    # 1. Left: 16-Agent Graph (Spans both rows)
    ax_graph = fig.add_subplot(gs[:, 0])
    ax_graph.set_facecolor(BG_WHITE)
    ax_graph.set_aspect('equal')
    ax_graph.set_title(r"Enterprise Architecture: 4 Clusters, 28 Edges ($\mathcal{L} = 0.342$)", 
                       fontsize=9.8, fontweight='bold', color=SLATE_DARK, pad=8)

    team_boxes = {
        'Frontend': (0.05, 0.52, 0.40, 0.42),
        'Backend':  (0.55, 0.52, 0.40, 0.42),
        'Data':     (0.55, 0.05, 0.40, 0.42),
        'Security': (0.05, 0.05, 0.40, 0.42)
    }

    for name, (bx, by, bw, bh) in team_boxes.items():
        rect = patches.Rectangle((bx, by), bw, bh, facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.8, zorder=1)
        ax_graph.add_patch(rect)
        ax_graph.text(bx + 0.03, by + bh - 0.045, f"Team: {name}", fontsize=8.2, fontweight='bold', color=HARBOR_BLUE, zorder=2)

    pos = {
        0: (0.15, 0.83), 1: (0.35, 0.83), 2: (0.38, 0.62), 3: (0.18, 0.62),
        4: (0.62, 0.62), 5: (0.82, 0.62), 6: (0.85, 0.83), 7: (0.65, 0.83),
        8: (0.62, 0.38), 9: (0.82, 0.38), 10: (0.85, 0.15), 11: (0.65, 0.15),
        12: (0.38, 0.15), 13: (0.18, 0.15), 14: (0.15, 0.38), 15: (0.35, 0.38),
    }

    # Red shaded triangle for backend review bug
    poly_err = plt.Polygon([pos[4], pos[5], pos[6]], facecolor=BG_WHITE, edgecolor=SHIP_RED, lw=1.4, zorder=2)
    ax_graph.add_patch(poly_err)
    ax_graph.text(0.77, 0.72, r"Triad Bug" + "\n" + r"$\delta_1^* \psi = 3.46$",
                 ha='center', va='center', fontsize=7.0, color=SHIP_RED,
                 bbox=dict(boxstyle="square,pad=0.2", facecolor=BG_WHITE, edgecolor=SHIP_RED, lw=0.6), zorder=6)

    for pts in [[pos[0], pos[1], pos[2]], [pos[8], pos[9], pos[10]], [pos[12], pos[13], pos[14]]]:
        poly = plt.Polygon(pts, facecolor=BG_WHITE, edgecolor=LINE_GRAY, lw=0.8, zorder=2)
        ax_graph.add_patch(poly)

    intra_edges = [
        (0,1), (1,2), (0,2), (1,3), (2,3),
        (4,5), (5,6), (4,6), (5,7), (6,7),
        (8,9), (9,10), (8,10), (9,11), (10,11),
        (12,13), (13,14), (12,14), (13,15), (14,15)
    ]
    for u, v in intra_edges:
        col = SHIP_RED if (u in [4,5,6] and v in [4,5,6]) else SLATE_LIGHT
        lw = 1.4 if (u in [4,5,6] and v in [4,5,6]) else 0.9
        ax_graph.plot([pos[u][0], pos[v][0]], [pos[u][1], pos[v][1]], color=col, lw=lw, zorder=3)

    inter_edges = [(2, 4), (3, 5), (6, 8), (7, 9), (10, 12), (11, 13), (0, 14), (15, 6)]
    for u, v in inter_edges:
        is_lag = (u, v) in [(2, 4), (3, 5)]
        col = HARBOR_BLUE if is_lag else LINE_GRAY
        lw = 1.4 if is_lag else 0.8
        ls = '--' if is_lag else ':'
        ax_graph.plot([pos[u][0], pos[v][0]], [pos[u][1], pos[v][1]], color=col, lw=lw, ls=ls, zorder=3)

    ax_graph.text(0.50, 0.72, r"Partition Cavity" + "\n" + r"$h = 2.50$",
                 ha='center', va='center', fontsize=7.0, color=HARBOR_BLUE,
                 bbox=dict(boxstyle="square,pad=0.2", facecolor=BG_WHITE, edgecolor=HARBOR_BLUE, lw=0.6), zorder=6)

    for node, (x, y) in pos.items():
        fc = SHIP_RED if node in [4, 5, 6] else (HARBOR_BLUE if node in [2, 3] else SLATE_DARK)
        ax_graph.add_patch(plt.Circle((x, y), 0.030, facecolor=fc, edgecolor=SLATE_DARK, lw=0.8, zorder=4))
        ax_graph.text(x, y, f"{node}", ha='center', va='center', fontsize=7.2, color=BG_WHITE, zorder=5)

    ax_graph.set_xlim(0.0, 1.0)
    ax_graph.set_ylim(0.0, 1.0)
    ax_graph.axis('off')

    # 2. Right Top: Energy Stats Bar Chart
    ax_stats = fig.add_subplot(gs[0, 1])
    ax_stats.set_facecolor(BG_WHITE)
    ax_stats.set_title("Hodge Component Energy Breakdown", fontsize=9.5, fontweight='bold', color=SLATE_DARK, pad=6)

    components = ['1. Benign Skew\n($\\|\\delta_0 x\\|^2$)',
                  '2. Macro Void\n($\\|h\\|^2$)',
                  '3. Review Bug\n($\\|\\delta_1^* \\psi\\|^2$)']
    energies = [3.126**2, 2.496**2, 3.464**2]
    colors = [SEA_GREEN, HARBOR_BLUE, SHIP_RED]

    bars = ax_stats.barh(components, energies, color=colors, edgecolor=SLATE_DARK, lw=0.8, height=0.50)
    ax_stats.set_xlabel(r"Energy Metric ($\|\cdot\|_2^2$)", fontsize=8.0)
    ax_stats.grid(axis='x', linestyle=':', alpha=0.35)
    ax_stats.set_xlim(0, 15.0)

    for bar, val in zip(bars, energies):
        ax_stats.text(val + 0.3, bar.get_y() + bar.get_height()/2, f"{val:.1f}", 
                     va='center', fontsize=8.0, color=SLATE_DARK)

    # 3. Right Bottom: Dedicated Prescriptive Triage Card (ZERO OVERLAPS!)
    ax_triage = fig.add_subplot(gs[1, 1])
    ax_triage.set_facecolor(BG_LIGHT)
    ax_triage.set_xlim(0, 1)
    ax_triage.set_ylim(0, 1)
    ax_triage.axis('off')

    card_rect = patches.Rectangle((0.02, 0.04), 0.96, 0.92, facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.8)
    ax_triage.add_patch(card_rect)

    ax_triage.text(0.06, 0.88, r"$\mathbf{Automated\ Swarm\ Triage\ Report}$", fontsize=9.0, fontweight='bold', color=SLATE_DARK)
    
    ax_triage.text(0.06, 0.75, r"$\bullet\ \mathbf{Swarm\ Legibility\ Ratio:}\ \mathcal{L}(g) = \frac{\|h\|^2}{\|h\|^2 + \|\delta_1^* \psi\|^2} = \mathbf{0.342}$",
                   fontsize=8.2, color=SLATE_DARK)
    ax_triage.text(0.10, 0.64, "(34.2% Macro Partition Cavity vs. 65.8% Micro Review Curl)", fontsize=7.5, color=SLATE_MID, fontstyle='italic')

    ax_triage.text(0.06, 0.50, r"$\mathbf{Prescriptive\ Supervisor\ Interventions:}$", fontsize=8.2, fontweight='bold', color=SLATE_DARK)
    
    ax_triage.text(0.08, 0.36, r"1. $\mathbf{65.8\%\ Micro\ Action:}$ Re-prompt Backend Triad $(v_4, v_5, v_6)$",
                   fontsize=7.8, fontweight='bold', color=SHIP_RED)
    ax_triage.text(0.12, 0.26, "Broken 3-way review join detected. Inject dissent diff into next prompt.",
                   fontsize=7.2, color=SLATE_MID)

    ax_triage.text(0.08, 0.14, r"2. $\mathbf{34.2\%\ Macro\ Action:}$ Sync API Bridge $(v_2, v_4)$ via Harbor Relay",
                   fontsize=7.8, fontweight='bold', color=HARBOR_BLUE)
    ax_triage.text(0.12, 0.05, "Global partition detected across clusters. Trigger outbound SSE sync.",
                   fontsize=7.2, color=SLATE_MID)

    plt.savefig(os.path.join(FIG_DIR, "fig-paper8-16agent-matrix.png"), dpi=300, facecolor=BG_WHITE)
    plt.savefig(os.path.join(BRAIN_DIR, "fig-paper8-16agent-matrix.png"), dpi=300, facecolor=BG_WHITE)
    plt.close()
    print("Regenerated Figure 5 (No Overlaps).")

if __name__ == '__main__':
    make_fig0()
    make_fig1()
    make_fig2()
    make_fig3()
    make_fig4()
    make_fig5()
    print("All 6 academic figures regenerated with Harbor Research styling & zero overlaps!")
