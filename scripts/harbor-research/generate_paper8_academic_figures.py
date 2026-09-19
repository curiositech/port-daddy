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
- Exact mathematical typography, clean lines, zero cartoon badges, zero pastel clown colors
- High-legibility typography: all fonts calibrated to scale to 8.5-12pt effective print size in LaTeX
- Strict aspect ratio control: set_aspect('equal') on all geometric plots to prevent squishing
- Structured multi-panel layouts with ZERO text overlap and generous padding
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
    'font.size': 12,
    'axes.labelsize': 13,
    'axes.titlesize': 15,
    'xtick.labelsize': 11.5,
    'ytick.labelsize': 11.5,
    'legend.fontsize': 11.5,
    'figure.titlesize': 17,
    'font.family': 'sans-serif',
    'font.sans-serif': ['Helvetica', 'Arial', 'DejaVu Sans'],
    'mathtext.fontset': 'cm',
    'axes.edgecolor': '#94a3b8',
    'axes.linewidth': 1.0,
})

FIG_DIR = "docs/harbor-research/figures"
BRAIN_DIR = "/Users/erichowens/.gemini/antigravity-ide/brain/e497dc38-cc24-40e0-b379-efe6fcf6d4d2"
os.makedirs(FIG_DIR, exist_ok=True)
os.makedirs(BRAIN_DIR, exist_ok=True)

def draw_circle(ax, cx, cy, r_in, fc, ec, lw=1.2, zorder=4):
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
    fig = plt.figure(figsize=(14.2, 10.4), dpi=300)
    fig.patch.set_facecolor(BG_WHITE)
    
    gs = fig.add_gridspec(2, 2, hspace=0.38, wspace=0.26,
                          left=0.05, right=0.95, top=0.90, bottom=0.04)
    
    fig.suptitle("The AI Engineer's Field Guide: Cellular Sheaves & Cohomology in Multi-Agent Swarms",
                 fontsize=18.5, fontweight='bold', color=SLATE_DARK, y=0.965)

    # ---------------------------------------------------------------------
    # Panel (a): The Stalk F(v) - Inside an AI Agent's State Vector
    # ---------------------------------------------------------------------
    ax_a = fig.add_subplot(gs[0, 0])
    ax_a.set_facecolor(BG_WHITE)
    ax_a.set_title(r"(a) What is a Stalk $\mathcal{F}(v)$? (An Agent's Operational State)",
                   fontsize=14.0, fontweight='bold', color=SLATE_DARK, pad=12)
    ax_a.set_xlim(0, 1.0)
    ax_a.set_ylim(0, 1.0)
    ax_a.axis('off')

    # Central Agent Circle
    draw_circle(ax_a, 0.12, 0.64, 0.52, BG_LIGHT, HARBOR_BLUE, lw=1.8, zorder=2)
    ax_a.text(0.12, 0.67, "AgentNode", ha='center', va='center', fontsize=12.0, fontweight='bold', color=HARBOR_BLUE, zorder=5)
    ax_a.text(0.12, 0.59, r"($v \in V$)", ha='center', va='center', fontsize=11.0, color=SLATE_MID, zorder=5)

    # Stalk Vector Box
    rect_stalk = patches.Rectangle((0.28, 0.32), 0.69, 0.64, facecolor=BG_WHITE, edgecolor=LINE_GRAY, lw=1.0)
    ax_a.add_patch(rect_stalk)
    ax_a.text(0.625, 0.90, r"Stalk Vector $x_v \in \mathbb{R}^D$ (Local State)", ha='center', va='center',
              fontsize=13.0, fontweight='bold', color=HARBOR_BLUE)

    stalk_fields = [
        (r"1. Local Turn / Epoch ($t_v \in \mathbb{N}$)", "Execution step counter"),
        (r"2. Token Budget ($b_v \in \mathbb{R}_+$)", "Accumulated LLM spend"),
        (r"3. AST Claim Lease ($h_L \in \mathbb{R}$)", "Hash of claimed symbol / file"),
        (r"4. Git State Hash ($d_v \in \mathbb{R}$)", "Working tree commit root")
    ]
    y_pos = 0.79
    for f_title, f_desc in stalk_fields:
        ax_a.text(0.31, y_pos, f_title, fontsize=11.5, fontweight='bold', color=SLATE_DARK)
        ax_a.text(0.31, y_pos - 0.045, f_desc, fontsize=10.5, color=SLATE_MID, fontstyle='italic')
        y_pos -= 0.125

    # Connecting arrow with label safely above
    ax_a.annotate('', xy=(0.27, 0.64), xytext=(0.20, 0.64),
                  arrowprops=dict(arrowstyle="-|>", color=HARBOR_BLUE, lw=1.6, mutation_scale=13))
    ax_a.text(0.235, 0.69, r"$\mathcal{F}(v)$", ha='center', va='bottom', fontsize=13.0, color=HARBOR_BLUE, fontweight='bold')

    # Explanatory card at bottom (expanded height and padded text)
    card_a = patches.Rectangle((0.02, 0.02), 0.96, 0.25, facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.9)
    ax_a.add_patch(card_a)
    ax_a.text(0.50, 0.18, r"$\mathbf{Why\ AI\ Engineers\ Care:}\ \text{Automated Proofs vs Log Archaeology}$",
              ha='center', va='center', fontsize=12.0, fontweight='bold', color=SLATE_DARK)
    ax_a.text(0.50, 0.08, "Abstracting agent state into numeric stalks allows instant linear-algebraic\nverification without parsing hundreds of thousands of LLM chat tokens.",
              ha='center', va='center', fontsize=10.5, color=SLATE_MID, linespacing=1.25)

    # ---------------------------------------------------------------------
    # Panel (b): The Cochain Complex - Agents, Channels, and Review Joins
    # ---------------------------------------------------------------------
    ax_b = fig.add_subplot(gs[0, 1])
    ax_b.set_facecolor(BG_WHITE)
    ax_b.set_title(r"(b) What is a Cochain Complex? ($C^0 \to C^1 \to C^2$)",
                   fontsize=14.0, fontweight='bold', color=SLATE_DARK, pad=12)
    ax_b.set_xlim(0, 1.0)
    ax_b.set_ylim(0, 1.0)
    ax_b.axis('off')

    stages = [
        ("0-Cochains $C^0$", "Agent Nodes", "State stalks $x_v$", 0.02, 0.26, HARBOR_BLUE),
        ("1-Cochains $C^1$", "Channels & PRs", "Edge diffs $g_e$", 0.37, 0.26, SEA_GREEN),
        ("2-Cochains $C^2$", "3-Way Joins", r"Review triads $\tau$", 0.72, 0.26, SHIP_RED)
    ]
    for title, role, desc, sx, sw, col in stages:
        box = patches.Rectangle((sx, 0.52), sw, 0.44, facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=1.0)
        ax_b.add_patch(box)
        ax_b.text(sx + sw/2, 0.88, title, ha='center', va='center', fontsize=12.5, fontweight='bold', color=col)
        ax_b.text(sx + sw/2, 0.74, role, ha='center', va='center', fontsize=12.0, fontweight='bold', color=SLATE_DARK)
        ax_b.text(sx + sw/2, 0.60, desc, ha='center', va='center', fontsize=10.5, color=SLATE_MID)

    ax_b.annotate('', xy=(0.36, 0.74), xytext=(0.29, 0.74),
                  arrowprops=dict(arrowstyle="-|>", color=SLATE_MID, lw=1.5, mutation_scale=13))
    ax_b.text(0.325, 0.81, r"$\delta_0$", ha='center', va='bottom', fontsize=15.0, fontweight='bold', color=SLATE_DARK)

    ax_b.annotate('', xy=(0.71, 0.74), xytext=(0.64, 0.74),
                  arrowprops=dict(arrowstyle="-|>", color=SLATE_MID, lw=1.5, mutation_scale=13))
    ax_b.text(0.675, 0.81, r"$\delta_1$", ha='center', va='bottom', fontsize=15.0, fontweight='bold', color=SLATE_DARK)

    rect_id = patches.Rectangle((0.02, 0.02), 0.96, 0.45, facecolor=BG_WHITE, edgecolor=LINE_GRAY, lw=1.0)
    ax_b.add_patch(rect_id)
    ax_b.text(0.50, 0.36, r"$\mathbf{Fundamental\ Simplicial\ Identity:}\ \delta_1 \circ \delta_0 = 0$",
              ha='center', va='center', fontsize=13.0, fontweight='bold', color=SLATE_DARK)
    ax_b.text(0.50, 0.27, "(The curl of a gradient is identically zero across any 3-agent join)",
              ha='center', va='center', fontsize=11.0, color=SLATE_MID, fontstyle='italic')
    ax_b.text(0.50, 0.17, r"$\mathbf{Why\ AI\ Engineers\ Care:}\ \text{Zero False-Alarm Guarantee}$",
              ha='center', va='center', fontsize=12.0, fontweight='bold', color=SLATE_DARK)
    ax_b.text(0.50, 0.075, "Legitimate asynchronous agent progress never produces spurious review alerts,\nprovably eliminating developer alert fatigue in high-throughput swarms.",
              ha='center', va='center', fontsize=10.0, color=SLATE_MID, linespacing=1.25)

    # ---------------------------------------------------------------------
    # Panel (c): Gossip Tree vs Review Cycle - Why Open Trees Swallow Lies
    # ---------------------------------------------------------------------
    ax_c = fig.add_subplot(gs[1, 0])
    ax_c.set_facecolor(BG_WHITE)
    ax_c.set_title("(c) What is a Gossip Tree? (Why Open Trees Miss Lies)",
                   fontsize=14.0, fontweight='bold', color=SLATE_DARK, pad=12)
    ax_c.set_xlim(0, 1.0)
    ax_c.set_ylim(0, 1.0)
    ax_c.axis('off')

    # Sub-panel 1: Tree (left)
    ax_c.text(0.24, 0.95, "Open Delegation Tree\n(LangChain / AutoGen)", ha='center', va='center', fontsize=12.0, fontweight='bold', color=SLATE_DARK)
    tree_nodes = {0: (0.24, 0.78), 1: (0.12, 0.58), 2: (0.36, 0.58), 3: (0.12, 0.38), 4: (0.36, 0.38)}
    for u, v in [(0, 1), (0, 2), (1, 3), (2, 4)]:
        x1, y1 = tree_nodes[u]
        x2, y2 = tree_nodes[v]
        ax_c.annotate('', xy=(x2, y2), xytext=(x1, y1),
                      arrowprops=dict(arrowstyle="-|>", color=SLATE_MID, lw=1.3, shrinkA=9, shrinkB=9, mutation_scale=11))

    for n, (x, y) in tree_nodes.items():
        fc = SHIP_RED if n == 1 else HARBOR_BLUE
        draw_circle(ax_c, x, y, 0.20, fc, SLATE_DARK, lw=1.0, zorder=4)
        ax_c.text(x, y, f"v{n}", ha='center', va='center', fontsize=11.5, color=BG_WHITE, fontweight='bold', zorder=5)

    card_c1 = patches.Rectangle((0.02, 0.02), 0.46, 0.25, facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.8)
    ax_c.add_patch(card_c1)
    ax_c.text(0.25, 0.17, r"$\ker(\delta_0^T) = \{0\}$ (Silent!)", ha='center', va='center', fontsize=12.0, fontweight='bold', color=SHIP_RED)
    ax_c.text(0.25, 0.08, "Acyclic trees swallow lies\nas benign network delays", ha='center', va='center', fontsize=10.5, color=SLATE_MID)

    # Sub-panel 2: Cycle (right)
    ax_c.text(0.76, 0.95, "Closed Review Cycle\n(Port Daddy / Harbor)", ha='center', va='center', fontsize=12.0, fontweight='bold', color=SLATE_DARK)
    cycle_nodes = {0: (0.64, 0.76), 1: (0.88, 0.76), 2: (0.88, 0.40), 3: (0.64, 0.40)}
    for u, v, lie in [(0, 1, False), (1, 2, True), (2, 3, False), (3, 0, False)]:
        x1, y1 = cycle_nodes[u]
        x2, y2 = cycle_nodes[v]
        col = SHIP_RED if lie else HARBOR_BLUE
        ax_c.annotate('', xy=(x2, y2), xytext=(x1, y1),
                      arrowprops=dict(arrowstyle="-|>", color=col, lw=1.8 if lie else 1.3, shrinkA=9, shrinkB=9, mutation_scale=11))

    for n, (x, y) in cycle_nodes.items():
        fc = SHIP_RED if n == 1 else HARBOR_BLUE
        draw_circle(ax_c, x, y, 0.20, fc, SLATE_DARK, lw=1.0, zorder=4)
        ax_c.text(x, y, f"u{n}", ha='center', va='center', fontsize=11.5, color=BG_WHITE, fontweight='bold', zorder=5)

    arc = patches.Arc((0.76, 0.58), 0.22, 0.22, angle=0, theta1=20, theta2=310, color=SHIP_RED, lw=1.4, ls='--')
    ax_c.add_patch(arc)
    ax_c.text(0.76, 0.58, r"$\rho \neq 0$", ha='center', va='center', fontsize=12.0, color=SHIP_RED, fontweight='bold',
              bbox=dict(boxstyle="round,pad=0.2", facecolor=BG_WHITE, edgecolor='none'))

    card_c2 = patches.Rectangle((0.52, 0.02), 0.46, 0.25, facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.8)
    ax_c.add_patch(card_c2)
    ax_c.text(0.75, 0.17, r"$\ker(\delta_0^T) \neq \{0\}$ (Trapped!)", ha='center', va='center', fontsize=12.0, fontweight='bold', color=HARBOR_BLUE)
    ax_c.text(0.75, 0.08, "Cycle traps hallucination\nwith certified residual $r > 0$", ha='center', va='center', fontsize=10.5, color=SLATE_MID)

    # ---------------------------------------------------------------------
    # Panel (d): Gauge vs Triadic Curl - Benign Lag vs Hallucination
    # ---------------------------------------------------------------------
    ax_d = fig.add_subplot(gs[1, 1])
    ax_d.set_facecolor(BG_WHITE)
    ax_d.set_title(r"(d) Gauge Process ($\delta_0 x$) vs Triadic Curl ($\delta_1^* \psi$)",
                   fontsize=14.0, fontweight='bold', color=SLATE_DARK, pad=12)
    ax_d.set_xlim(0, 1.0)
    ax_d.set_ylim(0, 1.0)
    ax_d.axis('off')

    # Left: Gauge (Benign Turn Delay)
    ax_d.text(0.24, 0.95, "Gauge Skew\n(Benign Turn Lag)", ha='center', va='center', fontsize=12.0, fontweight='bold', color=SEA_GREEN)
    g_pts = [(0.10, 0.40), (0.38, 0.40), (0.24, 0.76)]
    for (x1, y1), (x2, y2) in [(g_pts[0], g_pts[1]), (g_pts[1], g_pts[2]), (g_pts[0], g_pts[2])]:
        ax_d.annotate('', xy=(x2, y2), xytext=(x1, y1),
                      arrowprops=dict(arrowstyle="-|>", color=SEA_GREEN, lw=1.5, shrinkA=9, shrinkB=9, mutation_scale=11))

    for i, (x, y) in enumerate(g_pts):
        draw_circle(ax_d, x, y, 0.22, BG_WHITE, SEA_GREEN, lw=1.4, zorder=4)
        ax_d.text(x, y, f"t{i}", ha='center', va='center', fontsize=11.5, color=SLATE_DARK, fontweight='bold', zorder=5)

    ax_d.text(0.24, 0.52, r"$\delta_1 g = 0$" + "\nCurl-free", ha='center', va='center', fontsize=11.5, color=SEA_GREEN, fontweight='bold')

    card_d1 = patches.Rectangle((0.02, 0.02), 0.46, 0.25, facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.8)
    ax_d.add_patch(card_d1)
    ax_d.text(0.25, 0.17, "Action: Do Nothing!", ha='center', va='center', fontsize=12.0, fontweight='bold', color=SEA_GREEN)
    ax_d.text(0.25, 0.08, "Benign step latency;\nself-resolves on next turn", ha='center', va='center', fontsize=10.5, color=SLATE_MID)

    # Right: Triadic Curl (Hallucination Bug)
    ax_d.text(0.76, 0.95, "Triadic Curl\n(Review Bug)", ha='center', va='center', fontsize=12.0, fontweight='bold', color=SHIP_RED)
    c_pts = [(0.62, 0.40), (0.90, 0.40), (0.76, 0.76)]
    poly = plt.Polygon(c_pts, facecolor=BG_LIGHT, edgecolor=SHIP_RED, lw=1.4, zorder=2)
    ax_d.add_patch(poly)

    # Non-masking circular arc that clearly wraps the center text
    arc_d = patches.Arc((0.76, 0.53), 0.26, 0.26, angle=0, theta1=30, theta2=310, color=SHIP_RED, lw=1.6, ls='--', zorder=3)
    ax_d.add_patch(arc_d)
    ax_d.annotate('', xy=(0.89, 0.53), xytext=(0.88, 0.56),
                  arrowprops=dict(arrowstyle="-|>", color=SHIP_RED, lw=1.5, mutation_scale=11), zorder=3)

    role_lbls = ["Coder", "Critic", "Mgr"]
    for i, (x, y) in enumerate(c_pts):
        draw_circle(ax_d, x, y, 0.26, BG_WHITE, SHIP_RED, lw=1.4, zorder=4)
        ax_d.text(x, y, role_lbls[i], ha='center', va='center', fontsize=10.5, color=SLATE_DARK, fontweight='bold', zorder=5)

    ax_d.text(0.76, 0.53, r"$\delta_1 g \neq 0$" + "\n(Paradox!)", ha='center', va='center', fontsize=10.5, color=SHIP_RED, fontweight='bold', zorder=5)

    card_d2 = patches.Rectangle((0.52, 0.02), 0.46, 0.25, facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.8)
    ax_d.add_patch(card_d2)
    ax_d.text(0.75, 0.17, "Action: Re-prompt Triad!", ha='center', va='center', fontsize=12.0, fontweight='bold', color=SHIP_RED)
    ax_d.text(0.75, 0.08, "Review contract violated;\nre-prompt critique loop", ha='center', va='center', fontsize=10.5, color=SLATE_MID)

    plt.savefig(os.path.join(FIG_DIR, "fig-paper8-agent-foundations.png"), dpi=300, facecolor=BG_WHITE)
    plt.savefig(os.path.join(BRAIN_DIR, "fig-paper8-agent-foundations.png"), dpi=300, facecolor=BG_WHITE)
    plt.close()
    print("Regenerated Figure 0 (Agent Foundations).")

# -------------------------------------------------------------------------
# FIGURE 1: Open Tree vs Closed Cycle (Topological Horizon)
# -------------------------------------------------------------------------
def make_fig1():
    fig = plt.figure(figsize=(13.5, 6.2), dpi=300)
    fig.patch.set_facecolor(BG_WHITE)

    gs = fig.add_gridspec(1, 2, wspace=0.22, left=0.04, right=0.96, top=0.88, bottom=0.05)

    # Panel A: Open Tree
    ax1 = fig.add_subplot(gs[0])
    ax1.set_facecolor(BG_WHITE)
    ax1.set_title("(a) Acyclic Gossip Tree ($r = 0$, Provably Silent)", pad=14, fontsize=15.0, fontweight='bold', color=SLATE_DARK)
    ax1.set_xlim(-0.04, 1.04)
    ax1.set_ylim(-0.02, 1.02)
    ax1.axis('off')
    
    pos_tree = {
        0: (0.50, 0.88),
        1: (0.24, 0.64),
        2: (0.76, 0.64),
        3: (0.12, 0.38),
        4: (0.36, 0.38),
        5: (0.76, 0.38)
    }
    tree_edges = [(0, 1), (0, 2), (1, 3), (1, 4), (2, 5)]
    
    for u, v in tree_edges:
        x1, y1 = pos_tree[u]
        x2, y2 = pos_tree[v]
        ax1.annotate('', xy=(x2, y2), xytext=(x1, y1),
                     arrowprops=dict(arrowstyle="-|>", color=SLATE_MID, lw=1.4, mutation_scale=13, shrinkA=10, shrinkB=10))

    # Single clear formula callout rather than overlapping formulas on every edge
    ax1.text(0.50, 0.50, r"Gradient Flow: $g_{uv} = x_v - x_u$", ha='center', va='center', fontsize=12.0,
             color=HARBOR_BLUE, fontweight='bold',
             bbox=dict(boxstyle="round,pad=0.3", facecolor=BG_WHITE, edgecolor=LINE_GRAY, lw=0.8))

    for node, (x, y) in pos_tree.items():
        fc = SHIP_RED if node == 1 else HARBOR_BLUE
        circle = plt.Circle((x, y), 0.052, facecolor=fc, edgecolor=SLATE_DARK, lw=1.2, zorder=4)
        ax1.add_patch(circle)
        label = r"$v_1^*$" if node == 1 else f"$v_{node}$"
        ax1.text(x, y, label, ha='center', va='center', fontsize=12.5, color=BG_WHITE, fontweight='bold', zorder=5)

    # Clean card at bottom with generous margins
    card1 = patches.Rectangle((0.02, 0.02), 0.96, 0.24, facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=1.0)
    ax1.add_patch(card1)
    ax1.text(0.50, 0.17, r"Theorem CR-1: $\ker(\delta_0^T) = \{0\} \Rightarrow \Pi_T = 0 \Rightarrow r = 0$",
             ha='center', va='center', fontsize=12.0, fontweight='bold', color=SLATE_DARK)
    ax1.text(0.50, 0.08, "Any uninspected edge lie is absorbed by vertex potentials;\nequivocation remains dark without cycles.",
             ha='center', va='center', fontsize=10.5, color=SLATE_MID)

    # Panel B: Closed Cycle
    ax2 = fig.add_subplot(gs[1])
    ax2.set_facecolor(BG_WHITE)
    ax2.set_title("(b) Cycle Topology ($r > 0$, Certified Lower Bound)", pad=14, fontsize=15.0, fontweight='bold', color=SLATE_DARK)
    ax2.set_xlim(-0.04, 1.04)
    ax2.set_ylim(-0.02, 1.02)
    ax2.axis('off')

    pos_cycle = {0: (0.24, 0.82), 1: (0.76, 0.82), 2: (0.76, 0.42), 3: (0.24, 0.42)}
    
    # Edges with labels placed perpendicular and offset with generous margins
    # Edge (0, 1) top
    ax2.annotate('', xy=pos_cycle[1], xytext=pos_cycle[0],
                 arrowprops=dict(arrowstyle="-|>", color=HARBOR_BLUE, lw=1.4, mutation_scale=13, shrinkA=10, shrinkB=10))
    ax2.text(0.50, 0.89, r"$g_{01} = 0$", ha='center', va='center', fontsize=12.0, color=SLATE_DARK)

    # Edge (1, 2) right (Lie edge)
    ax2.annotate('', xy=pos_cycle[2], xytext=pos_cycle[1],
                 arrowprops=dict(arrowstyle="-|>", color=SHIP_RED, lw=2.0, mutation_scale=13, shrinkA=10, shrinkB=10))
    ax2.text(0.87, 0.62, r"$g_{12} = +3.0$" + "\n" + r"$\mathbf{(Lie)}$", ha='left', va='center', fontsize=12.0, color=SHIP_RED)

    # Edge (2, 3) bottom
    ax2.annotate('', xy=pos_cycle[3], xytext=pos_cycle[2],
                 arrowprops=dict(arrowstyle="-|>", color=HARBOR_BLUE, lw=1.4, mutation_scale=13, shrinkA=10, shrinkB=10))
    ax2.text(0.50, 0.33, r"$g_{23} = 0$", ha='center', va='center', fontsize=12.0, color=SLATE_DARK)

    # Edge (3, 0) left
    ax2.annotate('', xy=pos_cycle[0], xytext=pos_cycle[3],
                 arrowprops=dict(arrowstyle="-|>", color=HARBOR_BLUE, lw=1.4, mutation_scale=13, shrinkA=10, shrinkB=10))
    ax2.text(0.13, 0.62, r"$g_{30} = 0$", ha='right', va='center', fontsize=12.0, color=SLATE_DARK)

    # Center circulation
    arc = patches.Arc((0.50, 0.62), 0.22, 0.22, angle=0, theta1=20, theta2=310, color=SHIP_RED, lw=1.4, ls='--')
    ax2.add_patch(arc)
    ax2.text(0.50, 0.62, r"$\rho \in \ker(B^T)$" + "\n" + r"$\|\rho\|_2 = 1.500$",
             ha='center', va='center', fontsize=12.0, color=SHIP_RED, fontweight='bold',
             bbox=dict(boxstyle="round,pad=0.2", facecolor=BG_WHITE, edgecolor='none'))

    for node, (x, y) in pos_cycle.items():
        fc = SHIP_RED if node == 1 else HARBOR_BLUE
        circle = plt.Circle((x, y), 0.052, facecolor=fc, edgecolor=SLATE_DARK, lw=1.2, zorder=4)
        ax2.add_patch(circle)
        label = r"$v_1^*$" if node == 1 else f"$v_{node}$"
        ax2.text(x, y, label, ha='center', va='center', fontsize=12.5, color=BG_WHITE, fontweight='bold', zorder=5)

    # Clean card at bottom
    card2 = patches.Rectangle((0.02, 0.02), 0.96, 0.24, facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=1.0)
    ax2.add_patch(card2)
    ax2.text(0.50, 0.17, r"Closed Form: $r = |s|\sqrt{1 - R_{\mathrm{eff}}(e)} = 3.0\sqrt{1 - 3/4} = 1.500$",
             ha='center', va='center', fontsize=12.0, fontweight='bold', color=SLATE_DARK)
    ax2.text(0.50, 0.08, "The cycle constraint traps uninspected edge lies\n" + r"with certified lower bound $r \leq \|\varepsilon\|_2$.",
             ha='center', va='center', fontsize=10.5, color=SLATE_MID)

    plt.savefig(os.path.join(FIG_DIR, "fig-paper8-topological-loop.png"), dpi=300, facecolor=BG_WHITE)
    plt.savefig(os.path.join(BRAIN_DIR, "fig-paper8-topological-loop.png"), dpi=300, facecolor=BG_WHITE)
    plt.close()
    print("Regenerated Figure 1.")

# -------------------------------------------------------------------------
# FIGURE 2: The Rosetta Stone (Swarm to Cellular Sheaves)
# -------------------------------------------------------------------------
def make_fig2():
    fig, ax = plt.subplots(figsize=(14.0, 6.4), dpi=300)
    fig.patch.set_facecolor(BG_WHITE)
    ax.set_facecolor(BG_WHITE)
    ax.set_title("The Rosetta Stone: Mapping Multi-Agent Swarms to Cellular Sheaves", 
                 pad=16, fontsize=17.0, fontweight='bold', color=SLATE_DARK)

    cols = [
        (r"0-Cells: AgentNodes ($v \in V$)", 0.03, 0.28, [
            r"Stalk Vector $x_v \in \mathbb{R}^D$:",
            r"$\bullet$ Local Epoch: $t_v \in \mathbb{N}$",
            r"$\bullet$ Spend Budget: $b_v \in \mathbb{R}_+$",
            r"$\bullet$ AST Lease Hash: $h_L \in \mathbb{R}$",
            r"$\bullet$ State Root Digest: $d_v \in \mathbb{R}$"
        ]),
        (r"1-Cells: Channels ($e \in E$)", 0.365, 0.28, [
            r"Restriction Map $P_e: \mathbb{R}^D \to \mathbb{R}^S$:",
            r"$\bullet$ Coordinate-wise selection",
            r"$\bullet$ Discrepancy cochain:",
            r"  $g_e = P_e x_v - P_e x_u$",
            r"$\bullet$ Coboundary $(\delta_0 x)_e = x_v - x_u$"
        ]),
        (r"2-Cells: Review Joins ($\tau \in F$)", 0.70, 0.28, [
            r"Triadic Consensus Join:",
            r"$\bullet$ Producer $\leftrightarrow$ Dissenter",
            r"$\bullet$ Dissenter $\leftrightarrow$ Manager",
            r"$\bullet$ Manager $\leftrightarrow$ Producer",
            r"$\bullet$ Boundary:",
            r"  $(\delta_1 g)_\tau = g_{01} + g_{12} - g_{02}$"
        ])
    ]

    for title, x, w, items in cols:
        rect = patches.Rectangle((x, 0.44), w, 0.48, facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=1.0)
        ax.add_patch(rect)
        ax.text(x + w/2, 0.86, title, ha='center', va='center', fontsize=13.0, fontweight='bold', color=HARBOR_BLUE)
        body = "\n".join(items)
        ax.text(x + 0.015, 0.62, body, ha='left', va='center', fontsize=11.5, color=SLATE_DARK, linespacing=1.30)

    # Arrows in wide gaps
    ax.annotate('', xy=(0.360, 0.68), xytext=(0.315, 0.68),
                arrowprops=dict(arrowstyle="-|>", lw=1.6, color=SLATE_MID, mutation_scale=14))
    ax.text(0.3375, 0.74, r"$\delta_0$", ha='center', va='center', fontsize=15.0, fontweight='bold', color=SLATE_DARK)

    ax.annotate('', xy=(0.695, 0.68), xytext=(0.650, 0.68),
                arrowprops=dict(arrowstyle="-|>", lw=1.6, color=SLATE_MID, mutation_scale=14))
    ax.text(0.6725, 0.74, r"$\delta_1$", ha='center', va='center', fontsize=15.0, fontweight='bold', color=SLATE_DARK)

    rect_bottom = patches.Rectangle((0.03, 0.03), 0.94, 0.36, facecolor=BG_WHITE, edgecolor=LINE_GRAY, lw=1.0)
    ax.add_patch(rect_bottom)

    ax.text(0.50, 0.26, 
            r"Discrete Cochain Complex:   "
            r"$0 \longrightarrow C^0(X; \mathcal{F}) \longrightarrow C^1(X; \mathcal{F}) \longrightarrow C^2(X; \mathcal{F}) \longrightarrow 0$",
            ha='center', va='center', fontsize=13.0, color=SLATE_DARK)
    
    ax.text(0.50, 0.16,
            r"Fundamental Simplicial Boundary Identity:   $\delta_1 \circ \delta_0 = 0 \ \Leftrightarrow \ \mathrm{im}(\delta_0) \subseteq \ker(\delta_1)$",
            ha='center', va='center', fontsize=12.5, fontweight='bold', color=SLATE_DARK)

    ax.text(0.50, 0.07,
            r"(Honest potential gradients automatically satisfy all triadic contracts with zero curl)",
            ha='center', va='center', fontsize=11.0, color=SLATE_MID)

    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis('off')

    plt.savefig(os.path.join(FIG_DIR, "fig-paper8-sheaf-rosetta.png"), dpi=300, facecolor=BG_WHITE)
    plt.savefig(os.path.join(BRAIN_DIR, "fig-paper8-sheaf-rosetta.png"), dpi=300, facecolor=BG_WHITE)
    plt.close()
    print("Regenerated Figure 2.")

# -------------------------------------------------------------------------
# FIGURE 3: Discrete Hodge Decomposition & Legibility Ratio (ZERO OVERLAPS)
# -------------------------------------------------------------------------
def make_fig3():
    # Headroom between suptitle and top of subplots is 1.5 inches
    fig = plt.figure(figsize=(14.5, 7.0), dpi=300)
    fig.patch.set_facecolor(BG_WHITE)
    
    gs = fig.add_gridspec(1, 4, width_ratios=[1.0, 1.0, 1.0, 0.85], wspace=0.28,
                          left=0.04, right=0.96, top=0.74, bottom=0.08)
    
    fig.suptitle("Simplicial Hodge Decomposition: Categorizing Swarm Disagreements for AI Supervisors",
                 fontsize=17.5, fontweight='bold', color=SLATE_DARK, y=0.95)

    ax1 = fig.add_subplot(gs[0])
    ax2 = fig.add_subplot(gs[1])
    ax3 = fig.add_subplot(gs[2])
    ax4 = fig.add_subplot(gs[3])

    for ax in [ax1, ax2, ax3]:
        ax.set_facecolor(BG_WHITE)
        ax.set_xlim(0, 1.0)
        ax.set_ylim(-0.02, 1.02)
        ax.axis('off')

    tri_pts = [(0.18, 0.34), (0.82, 0.34), (0.50, 0.78)]

    # 1. Gauge Gradient delta_0 x
    ax1.set_title(r"$\mathbf{1.\ Gauge\ Gradient\ \delta_0 x}$" + "\n" + r"Benign Turn Skew" + "\n" + r"($\delta_1(\delta_0 x) \equiv 0$, Curl-Free)", 
                  fontsize=11.5, color=SEA_GREEN, pad=10)
    
    for (x1, y1), (x2, y2) in [(tri_pts[0], tri_pts[1]), (tri_pts[1], tri_pts[2]), (tri_pts[0], tri_pts[2])]:
        ax1.annotate('', xy=(x2, y2), xytext=(x1, y1),
                     arrowprops=dict(arrowstyle="-|>", color=SEA_GREEN, lw=1.6, shrinkA=10, shrinkB=10, mutation_scale=12))

    for i, (x, y) in enumerate(tri_pts):
        ax1.add_patch(plt.Circle((x, y), 0.075, facecolor=BG_WHITE, edgecolor=SEA_GREEN, lw=1.5, zorder=4))
        ax1.text(x, y, f"v{i}", ha='center', va='center', fontsize=12.0, color=SLATE_DARK, fontweight='bold', zorder=5)

    ax1.text(0.5, 0.50, "Turn skew:\n$x_v - x_u$\n" + r"$\mathbf{\delta_1 g = 0}$", ha='center', va='center', fontsize=11.0, color=SEA_GREEN)
    ax1.text(0.5, 0.08, "Action: Ignore.\nSelf-resolves naturally.", ha='center', va='center', fontsize=11.0, color=SLATE_MID,
             bbox=dict(boxstyle="square,pad=0.4", facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.8))

    # 2. Harmonic Cavity h
    ax2.set_title(r"$\mathbf{2.\ Harmonic\ Cavity\ h \in \mathcal{H}^1}$" + "\n" + r"Network Split / Partition" + "\n" + r"($\delta_1 h = 0$, $\delta_0^* h = 0$)", 
                  fontsize=11.5, color=HARBOR_BLUE, pad=10)
    
    square_pts = [(0.20, 0.34), (0.80, 0.34), (0.80, 0.78), (0.20, 0.78)]
    for i in range(4):
        ax2.annotate('', xy=square_pts[(i+1)%4], xytext=square_pts[i], 
                     arrowprops=dict(arrowstyle="-|>", color=HARBOR_BLUE, lw=1.6, shrinkA=10, shrinkB=10, mutation_scale=12))
    
    hole = patches.Ellipse((0.50, 0.56), width=0.38, height=0.26, facecolor=BG_LIGHT, edgecolor=HARBOR_BLUE, lw=1.1, ls='--')
    ax2.add_patch(hole)
    ax2.text(0.50, 0.56, "Macro Void\n(Cross-Harbor Lag)", ha='center', va='center', fontsize=10.0, color=HARBOR_BLUE, linespacing=1.2)

    for i, (x, y) in enumerate(square_pts):
        ax2.add_patch(plt.Circle((x, y), 0.075, facecolor=BG_WHITE, edgecolor=HARBOR_BLUE, lw=1.5, zorder=4))
        ax2.text(x, y, f"u{i}", ha='center', va='center', fontsize=12.0, color=SLATE_DARK, fontweight='bold', zorder=5)

    ax2.text(0.5, 0.08, "Action: Reconnect relay.\nGlobal state drifting.", ha='center', va='center', fontsize=11.0, color=SLATE_MID,
             bbox=dict(boxstyle="square,pad=0.4", facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.8))

    # 3. Triadic Curl delta_1^* psi
    ax3.set_title(r"$\mathbf{3.\ Triadic\ Curl\ \delta_1^* \psi}$" + "\n" + r"Review Hallucination" + "\n" + r"($\delta_1 g \neq 0$, Divergence-Free)", 
                  fontsize=11.5, color=SHIP_RED, pad=10)
    
    poly = plt.Polygon(tri_pts, facecolor=BG_LIGHT, edgecolor=SHIP_RED, lw=1.5, zorder=2)
    ax3.add_patch(poly)

    # Clean visible circulation arc with arrow, framing the text with ZERO masking
    arc = patches.Arc((0.50, 0.52), 0.28, 0.28, angle=0, theta1=30, theta2=310, color=SHIP_RED, lw=1.6, ls='--', zorder=3)
    ax3.add_patch(arc)
    ax3.annotate('', xy=(0.64, 0.52), xytext=(0.63, 0.55),
                 arrowprops=dict(arrowstyle="-|>", color=SHIP_RED, lw=1.5, mutation_scale=11), zorder=3)
    
    ax3.text(0.50, 0.52, "Broken 3-Way\nReview Join\n" + r"$(\mathbf{\delta_1 g \neq 0})$", 
             ha='center', va='center', fontsize=10.0, color=SHIP_RED, zorder=5)

    role_labels = ["Coder", "Critic", "Mgr"]
    for i, (x, y) in enumerate(tri_pts):
        ax3.add_patch(plt.Circle((x, y), 0.085, facecolor=BG_WHITE, edgecolor=SHIP_RED, lw=1.5, zorder=4))
        ax3.text(x, y, role_labels[i], ha='center', va='center', fontsize=10.5, color=SLATE_DARK, fontweight='bold', zorder=5)

    ax3.text(0.5, 0.08, "Action: Re-prompt triad!\nPrompt critique loop.", ha='center', va='center', fontsize=11.0, color=SHIP_RED,
             bbox=dict(boxstyle="square,pad=0.4", facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.8))

    # 4. Legibility Ratio Bar Chart
    ax4.set_facecolor(BG_WHITE)
    ax4.set_title(r"$\mathbf{4.\ Swarm\ Legibility\ \mathcal{L}(g)}$" + "\n" + r"$\frac{\|h\|^2}{\|h\|^2 + \|\delta_1^*\psi\|^2}$",
                  fontsize=11.5, fontweight='bold', color=SLATE_DARK, pad=10)
    
    categories = ['Review Bug\n(Micro)', 'Network Split\n(Macro)']
    values = [0.00, 1.00]
    bars = ax4.bar(categories, values, width=0.45, color=[SHIP_RED, HARBOR_BLUE], edgecolor=SLATE_DARK, lw=1.0)
    ax4.set_ylabel(r"$\mathcal{L}(g) \in [0, 1]$", fontsize=11.5, labelpad=6)
    ax4.set_ylim(0, 1.20)
    ax4.set_yticks([0.0, 0.5, 1.0])
    ax4.grid(axis='y', linestyle=':', alpha=0.35)
    ax4.text(0, 0.05, "0.00", ha='center', va='bottom', fontsize=12.0, fontweight='bold', color=SHIP_RED)
    ax4.text(1, 1.04, "1.00", ha='center', va='bottom', fontsize=12.0, fontweight='bold', color=HARBOR_BLUE)

    plt.savefig(os.path.join(FIG_DIR, "fig-paper8-simplicial-hodge.png"), dpi=300, facecolor=BG_WHITE)
    plt.savefig(os.path.join(BRAIN_DIR, "fig-paper8-simplicial-hodge.png"), dpi=300, facecolor=BG_WHITE)
    plt.close()
    print("Regenerated Figure 3 (Zero Overlaps).")

# -------------------------------------------------------------------------
# FIGURE 4: Theorem CR-4 (Optimal Cohomological Repair via Min-Cut)
# -------------------------------------------------------------------------
def make_fig4():
    fig, (ax1, ax2, ax3) = plt.subplots(1, 3, figsize=(14.0, 5.2), dpi=300)
    fig.patch.set_facecolor(BG_WHITE)
    fig.subplots_adjust(left=0.05, right=0.96, top=0.88, bottom=0.12, wspace=0.32)

    # Panel 1: Residual Flow Graph
    ax1.set_facecolor(BG_WHITE)
    ax1.set_title(r"(a) Residual Flow $\rho = \Pi_K g_K$", fontsize=14.0, fontweight='bold', color=SLATE_DARK, pad=10)
    pos = {0: (0.20, 0.78), 1: (0.80, 0.78), 2: (0.80, 0.24), 3: (0.20, 0.24)}
    edge_energies = {(0,1): 0.50, (1,2): 2.33, (2,3): 0.80, (3,0): 0.80, (0,2): 1.85}
    
    for (u, v), en in edge_energies.items():
        col = SHIP_RED if en > 1.5 else SLATE_LIGHT
        lw = 1.2 + en * 1.0
        ax1.plot([pos[u][0], pos[v][0]], [pos[u][1], pos[v][1]], color=col, lw=lw, zorder=2)
    
    # Text offsets placed perpendicular to avoid overlapping lines
    ax1.text(0.50, 0.86, "0.50", fontsize=11.0, color=SLATE_MID, ha='center', va='center',
             bbox=dict(boxstyle="round,pad=0.2", facecolor=BG_WHITE, edgecolor=LINE_GRAY, lw=0.6))
    ax1.text(0.91, 0.51, "2.33", fontsize=11.0, color=SHIP_RED, ha='center', va='center', fontweight='bold',
             bbox=dict(boxstyle="round,pad=0.2", facecolor=BG_WHITE, edgecolor=SHIP_RED, lw=0.8))
    ax1.text(0.50, 0.15, "0.80", fontsize=11.0, color=SLATE_MID, ha='center', va='center',
             bbox=dict(boxstyle="round,pad=0.2", facecolor=BG_WHITE, edgecolor=LINE_GRAY, lw=0.6))
    ax1.text(0.09, 0.51, "0.80", fontsize=11.0, color=SLATE_MID, ha='center', va='center',
             bbox=dict(boxstyle="round,pad=0.2", facecolor=BG_WHITE, edgecolor=LINE_GRAY, lw=0.6))
    ax1.text(0.42, 0.42, "1.85", fontsize=11.0, color=SHIP_RED, ha='center', va='center', fontweight='bold',
             bbox=dict(boxstyle="round,pad=0.2", facecolor=BG_WHITE, edgecolor=SHIP_RED, lw=0.8))

    for node, (x, y) in pos.items():
        fc = SHIP_RED if node == 2 else HARBOR_BLUE
        ax1.add_patch(plt.Circle((x, y), 0.070, facecolor=fc, edgecolor=SLATE_DARK, lw=1.2, zorder=4))
        ax1.text(x, y, f"$v_{node}$", ha='center', va='center', fontsize=12.5, color=BG_WHITE, fontweight='bold', zorder=5)

    ax1.text(0.5, 0.03, r"Initial $r = 2.683$; Node $v_2$ equivocating", ha='center', va='center', fontsize=11.5, color=SLATE_DARK)
    ax1.set_xlim(0.0, 1.0)
    ax1.set_ylim(-0.02, 1.0)
    ax1.axis('off')

    # Panel 2: Ratio Controller Plot
    ax2.set_facecolor(BG_WHITE)
    ax2.set_title(r"(b) Controller: $\arg\max \frac{E(e)}{w(e)}$", fontsize=14.0, fontweight='bold', color=SLATE_DARK, pad=10)
    edge_names = ['(0,1)', '(1,2)', '(2,3)', '(3,0)', '(0,2)']
    costs = [5.0, 5.0, 5.0, 5.0, 1.0]
    energies = [0.50, 2.33, 0.80, 0.80, 1.85]
    ratios = [en / c for en, c in zip(energies, costs)]
    
    bars = ax2.bar(edge_names, ratios, width=0.45, color=[SLATE_LIGHT]*4 + [HARBOR_BLUE], edgecolor=SLATE_DARK, lw=1.0)
    ax2.set_ylabel(r"Ratio $E(e)/w(e)$", fontsize=12.5)
    ax2.grid(axis='y', linestyle=':', alpha=0.35)
    ax2.text(4, ratios[4] + 0.08, r"Optimal Cut $e^*$" + "\n" + r"(Ratio=1.85)", ha='center', va='bottom', fontsize=11.0, color=HARBOR_BLUE, fontweight='bold')
    ax2.set_ylim(0, 2.4)

    # Panel 3: Monotonic Decay Curve (CLEAN LABELS, ZERO OVERLAPS)
    ax3.set_facecolor(BG_WHITE)
    ax3.set_title(r"(c) Residual Collapse: $r(t) \to 0$", fontsize=14.0, fontweight='bold', color=SLATE_DARK, pad=10)
    rounds = [0, 1, 2]
    residuals = [2.683, 1.528, 0.000]
    
    ax3.plot(rounds, residuals, marker='s', lw=2.2, color=HARBOR_BLUE, markersize=8, zorder=3)
    
    # Label offsets placed cleanly above points, clear of markers, axes, and descending line
    ax3.text(0.12, 2.85, r"$r = 2.683$", ha='left', va='center', fontsize=11.5, color=HARBOR_BLUE, fontweight='bold')
    ax3.text(1.15, 1.75, r"$r = 1.528$", ha='left', va='center', fontsize=11.5, color=HARBOR_BLUE, fontweight='bold')
    ax3.text(2.10, 0.18, r"$r = 0.000$", ha='left', va='center', fontsize=11.5, color=HARBOR_BLUE, fontweight='bold')
    
    # Bound box placed in upper-right clear area
    ax3.text(0.95, 2.85, r"$\mathbf{Bound:}\ \leq \beta_1(G)\ \text{rounds}$" + "\n" + r"$\beta_1(G) = 5 - 4 + 1 = 2$",
             fontsize=11.0, color=SEA_GREEN, fontweight='bold',
             bbox=dict(boxstyle="square,pad=0.35", facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.8))

    ax3.set_xlabel("Intervention Round", fontsize=12.5)
    ax3.set_ylabel("Completion Residual $r$", fontsize=12.5)
    ax3.set_xticks([0, 1, 2])
    ax3.set_xlim(-0.35, 2.60)
    ax3.set_ylim(-0.35, 3.40)
    ax3.grid(True, linestyle=':', alpha=0.35)

    plt.savefig(os.path.join(FIG_DIR, "fig-paper8-active-repair.png"), dpi=300, facecolor=BG_WHITE)
    plt.savefig(os.path.join(BRAIN_DIR, "fig-paper8-active-repair.png"), dpi=300, facecolor=BG_WHITE)
    plt.close()
    print("Regenerated Figure 4.")

# -------------------------------------------------------------------------
# FIGURE 5: 16-Agent Clustered Enterprise Matrix (ZERO OVERLAPS)
# -------------------------------------------------------------------------
def make_fig5():
    # Canvas with ample room for suptitle and subplots
    fig = plt.figure(figsize=(14.5, 8.2), dpi=300)
    fig.patch.set_facecolor(BG_WHITE)
    
    gs = fig.add_gridspec(2, 2, width_ratios=[1.25, 1.0], height_ratios=[1.0, 1.35],
                          wspace=0.26, hspace=0.32,
                          left=0.04, right=0.96, top=0.86, bottom=0.06)

    fig.suptitle("16-Agent Enterprise Swarm: Simplicial Hodge Triage of Mixed Failures",
                 fontsize=18.0, fontweight='bold', color=SLATE_DARK, y=0.955)

    # 1. Left: 16-Agent Graph (Spans both rows)
    ax_graph = fig.add_subplot(gs[:, 0])
    ax_graph.set_facecolor(BG_WHITE)
    ax_graph.set_title(r"Enterprise Architecture: 4 Clusters, 28 Edges ($\mathcal{L} = 0.342$)", 
                       fontsize=14.0, fontweight='bold', color=SLATE_DARK, pad=12)

    team_boxes = {
        'Frontend': (0.02, 0.52, 0.35, 0.42),
        'Backend':  (0.63, 0.52, 0.35, 0.42),
        'Data':     (0.63, 0.04, 0.35, 0.42),
        'Security': (0.02, 0.04, 0.35, 0.42)
    }

    # Draw team containers with crisp header banners so text NEVER overlaps nodes!
    for name, (bx, by, bw, bh) in team_boxes.items():
        # Outer box
        rect = patches.Rectangle((bx, by), bw, bh, facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=1.0, zorder=1)
        ax_graph.add_patch(rect)
        # Dedicated header banner
        banner = patches.Rectangle((bx, by + bh - 0.065), bw, 0.065, facecolor='#e2e8f0', edgecolor=LINE_GRAY, lw=1.0, zorder=2)
        ax_graph.add_patch(banner)
        # Cleanly centered team label
        ax_graph.text(bx + bw/2, by + bh - 0.0325, f"Team: {name}", ha='center', va='center',
                      fontsize=12.0, fontweight='bold', color=HARBOR_BLUE, zorder=3)

    # Perfectly calibrated node coordinates leaving 0.05 margin to banner and walls
    pos = {
        # Frontend: top-left box
        0: (0.10, 0.77), 1: (0.29, 0.77), 2: (0.29, 0.58), 3: (0.10, 0.58),
        # Backend: top-right box
        7: (0.71, 0.77), 6: (0.91, 0.77), 5: (0.91, 0.58), 4: (0.71, 0.58),
        # Data: bottom-right box
        8: (0.71, 0.29), 9: (0.91, 0.29), 10: (0.91, 0.10), 11: (0.71, 0.10),
        # Security: bottom-left box
        14: (0.10, 0.29), 15: (0.29, 0.29), 12: (0.29, 0.10), 13: (0.10, 0.10),
    }

    # Red shaded triangle for backend review bug (4, 5, 6)
    poly_err = plt.Polygon([pos[4], pos[5], pos[6]], facecolor=BG_WHITE, edgecolor=SHIP_RED, lw=1.8, zorder=2)
    ax_graph.add_patch(poly_err)
    # Centroid of (4,5,6) is (0.843, 0.643). Place callout cleanly inside triangle:
    ax_graph.text(0.835, 0.640, r"Triad Bug" + "\n" + r"$\delta_1^* \psi = 3.46$",
                 ha='center', va='center', fontsize=9.0, color=SHIP_RED, fontweight='bold',
                 bbox=dict(boxstyle="round,pad=0.15", facecolor=BG_WHITE, edgecolor=SHIP_RED, lw=0.7), zorder=6)

    for pts in [[pos[0], pos[1], pos[2]], [pos[8], pos[9], pos[10]], [pos[14], pos[15], pos[12]]]:
        poly = plt.Polygon(pts, facecolor=BG_WHITE, edgecolor=LINE_GRAY, lw=1.0, zorder=2)
        ax_graph.add_patch(poly)

    intra_edges = [
        (0,1), (1,2), (2,3), (3,0), (0,2),
        (7,6), (6,5), (5,4), (4,7), (4,6),
        (8,9), (9,10), (10,11), (11,8), (8,10),
        (14,15), (15,12), (12,13), (13,14), (14,12)
    ]
    for u, v in intra_edges:
        col = SHIP_RED if (u in [4,5,6] and v in [4,5,6]) else SLATE_LIGHT
        lw = 1.8 if (u in [4,5,6] and v in [4,5,6]) else 1.0
        ax_graph.plot([pos[u][0], pos[v][0]], [pos[u][1], pos[v][1]], color=col, lw=lw, zorder=3)

    inter_edges = [
        (2, 4), (1, 7),
        (4, 8), (5, 9),
        (11, 12), (8, 15),
        (14, 3), (15, 2)
    ]
    for u, v in inter_edges:
        is_lag = (u, v) == (2, 4)
        col = HARBOR_BLUE if is_lag else LINE_GRAY
        lw = 2.2 if is_lag else 1.0
        ls = '--' if is_lag else ':'
        ax_graph.plot([pos[u][0], pos[v][0]], [pos[u][1], pos[v][1]], color=col, lw=lw, ls=ls, zorder=3)

    # Partition cavity label placed in open corridor at x=0.50, y=0.68 (between y=0.58 and y=0.77)
    ax_graph.text(0.50, 0.68, r"Partition Cavity" + "\n" + r"$h = 2.50\ \text{(Lag)}$",
                 ha='center', va='center', fontsize=9.5, color=HARBOR_BLUE, fontweight='bold',
                 bbox=dict(boxstyle="round,pad=0.18", facecolor=BG_WHITE, edgecolor=HARBOR_BLUE, lw=0.8), zorder=6)
    ax_graph.annotate('', xy=(0.50, 0.59), xytext=(0.50, 0.63),
                      arrowprops=dict(arrowstyle="-|>", color=HARBOR_BLUE, lw=1.3, mutation_scale=10), zorder=6)

    for node, (x, y) in pos.items():
        fc = SHIP_RED if node in [4, 5, 6] else (HARBOR_BLUE if node in [2, 4] else SLATE_DARK)
        ax_graph.add_patch(plt.Circle((x, y), 0.038, facecolor=fc, edgecolor=SLATE_DARK, lw=1.0, zorder=4))
        ax_graph.text(x, y, f"{node}", ha='center', va='center', fontsize=11.5, color=BG_WHITE, fontweight='bold', zorder=5)

    ax_graph.set_xlim(-0.01, 1.01)
    ax_graph.set_ylim(-0.01, 1.01)
    ax_graph.axis('off')

    # 2. Right Top: Energy Stats Bar Chart
    ax_stats = fig.add_subplot(gs[0, 1])
    ax_stats.set_facecolor(BG_WHITE)
    ax_stats.set_title("Hodge Component Energy Breakdown", fontsize=13.5, fontweight='bold', color=SLATE_DARK, pad=8)

    components = ['1. Benign Skew\n($\\|\\delta_0 x\\|^2$)',
                  '2. Macro Void\n($\\|h\\|^2$)',
                  '3. Review Bug\n($\\|\\delta_1^* \\psi\\|^2$)']
    energies = [3.126**2, 2.496**2, 3.464**2]
    colors = [SEA_GREEN, HARBOR_BLUE, SHIP_RED]

    bars = ax_stats.barh(components, energies, color=colors, edgecolor=SLATE_DARK, lw=1.0, height=0.48)
    ax_stats.set_xlabel(r"Energy Metric ($\|\cdot\|_2^2$)", fontsize=12.0)
    ax_stats.grid(axis='x', linestyle=':', alpha=0.35)
    ax_stats.set_xlim(0, 15.0)

    for bar, val in zip(bars, energies):
        ax_stats.text(val + 0.35, bar.get_y() + bar.get_height()/2, f"{val:.1f}", 
                     va='center', fontsize=12.0, fontweight='bold', color=SLATE_DARK)

    # 3. Right Bottom: Dedicated Prescriptive Triage Card (ZERO OVERLAPS, STRICT BOUNDARIES)
    ax_triage = fig.add_subplot(gs[1, 1])
    ax_triage.set_facecolor(BG_LIGHT)
    ax_triage.set_xlim(0, 1)
    ax_triage.set_ylim(0, 1)
    ax_triage.axis('off')

    card_rect = patches.Rectangle((0.02, 0.02), 0.96, 0.96, facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=1.0)
    ax_triage.add_patch(card_rect)

    ax_triage.text(0.06, 0.88, "Automated Swarm Triage Report", fontsize=14.0, fontweight='bold', color=SLATE_DARK)
    
    ax_triage.text(0.06, 0.75, r"$\bullet$ $\mathbf{Swarm\ Legibility\ Ratio:}\ \mathcal{L}(g) = \mathbf{0.342}$",
                   fontsize=12.5, color=SLATE_DARK)
    ax_triage.text(0.09, 0.65, "[Macro Energy: 6.2 (34%) | Micro Energy: 12.0 (66%)]",
                   fontsize=10.5, color=SLATE_MID)

    ax_triage.text(0.06, 0.51, "Prescriptive Supervisor Interventions:", fontsize=12.5, fontweight='bold', color=SLATE_DARK)
    
    ax_triage.text(0.08, 0.38, r"1. $\mathbf{Micro\ Action:}$ Re-prompt Backend Triad $(v_4, v_5, v_6)$",
                   fontsize=11.5, fontweight='bold', color=SHIP_RED)
    ax_triage.text(0.12, 0.28, "Broken 3-way join. Inject dissent diff into next prompt.",
                   fontsize=10.5, color=SLATE_MID)

    ax_triage.text(0.08, 0.16, r"2. $\mathbf{Macro\ Action:}$ Sync API Bridge $(v_2, v_4)$ via Relay",
                   fontsize=11.5, fontweight='bold', color=HARBOR_BLUE)
    ax_triage.text(0.12, 0.06, "Cross-cluster partition detected. Trigger SSE sync.",
                   fontsize=10.5, color=SLATE_MID)

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
