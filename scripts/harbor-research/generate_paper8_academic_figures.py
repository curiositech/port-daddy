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
"""

import os
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import networkx as nx
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

# -------------------------------------------------------------------------
# FIGURE 1: Open Tree vs Closed Cycle (Topological Horizon)
# -------------------------------------------------------------------------
def make_fig1():
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 4.2), dpi=300)
    fig.patch.set_facecolor(BG_WHITE)

    # Panel A: Open Tree
    ax1.set_facecolor(BG_WHITE)
    ax1.set_title("(a) Acyclic Gossip Tree ($r = 0$, Provably Silent)", pad=10, fontweight='bold', color=SLATE_DARK)
    
    pos_tree = {
        0: (0.5, 0.82),
        1: (0.25, 0.48),
        2: (0.75, 0.48),
        3: (0.12, 0.14),
        4: (0.38, 0.14),
        5: (0.75, 0.14)
    }
    tree_edges = [(0, 1), (0, 2), (1, 3), (1, 4), (2, 5)]
    
    for u, v in tree_edges:
        x1, y1 = pos_tree[u]
        x2, y2 = pos_tree[v]
        ax1.annotate('', xy=(x2, y2), xytext=(x1, y1),
                     arrowprops=dict(arrowstyle="-|>", color=SLATE_MID, lw=1.2, mutation_scale=10, shrinkA=8, shrinkB=8))
        mx, my = (x1 + x2)/2, (y1 + y2)/2
        ax1.text(mx + 0.03, my, r"$g_e = x_v - x_u$", fontsize=7.5, color=SLATE_MID, fontstyle='italic')

    for node, (x, y) in pos_tree.items():
        fc = SHIP_RED if node == 1 else HARBOR_BLUE
        circle = plt.Circle((x, y), 0.042, facecolor=fc, edgecolor=SLATE_DARK, lw=1.0, zorder=4)
        ax1.add_patch(circle)
        label = r"$v_1^*$" if node == 1 else f"$v_{node}$"
        ax1.text(x, y, label, ha='center', va='center', fontsize=8, color=BG_WHITE, fontweight='bold', zorder=5)

    ax1.text(0.5, -0.05, 
             r"Theorem CR-1: $\ker(\delta_0^T) = \{0\} \Rightarrow \Pi_T = 0 \Rightarrow r = 0$" + "\n"
             r"Any uninspected edge lie is absorbed by vertex potentials; equivocation is dark.",
             ha='center', va='top', fontsize=8, color=SLATE_DARK,
             bbox=dict(boxstyle="square,pad=0.4", facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.8))

    ax1.set_xlim(-0.02, 1.02)
    ax1.set_ylim(-0.12, 0.95)
    ax1.axis('off')

    # Panel B: Closed Cycle
    ax2.set_facecolor(BG_WHITE)
    ax2.set_title("(b) Cycle Topology ($r > 0$, Certified Lower Bound)", pad=10, fontweight='bold', color=SLATE_DARK)

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

    # Subtle central circulation indicator
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

    ax2.set_xlim(0.05, 0.95)
    ax2.set_ylim(-0.12, 0.95)
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

    # 3 Clean Columns (0-Cells, 1-Cells, 2-Cells)
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

    # Clean connecting coboundary arrows
    ax.annotate('', xy=(0.355, 0.68), xytext=(0.325, 0.68),
                arrowprops=dict(arrowstyle="-|>", lw=1.2, color=SLATE_MID, mutation_scale=10))
    ax.text(0.34, 0.72, r"$\delta_0$", ha='center', va='center', fontsize=10, fontweight='bold', color=SLATE_DARK)

    ax.annotate('', xy=(0.675, 0.68), xytext=(0.645, 0.68),
                arrowprops=dict(arrowstyle="-|>", lw=1.2, color=SLATE_MID, mutation_scale=10))
    ax.text(0.66, 0.72, r"$\delta_1$", ha='center', va='center', fontsize=10, fontweight='bold', color=SLATE_DARK)

    # Bottom Complex Banner
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
# FIGURE 3: Discrete Hodge Decomposition & Legibility Ratio
# -------------------------------------------------------------------------
def make_fig3():
    fig = plt.figure(figsize=(11, 4.6), dpi=300)
    fig.patch.set_facecolor(BG_WHITE)
    gs = fig.add_gridspec(1, 4, width_ratios=[1, 1, 1, 0.85], wspace=0.25)
    
    ax1 = fig.add_subplot(gs[0])
    ax2 = fig.add_subplot(gs[1])
    ax3 = fig.add_subplot(gs[2])
    ax4 = fig.add_subplot(gs[3])

    for ax in [ax1, ax2, ax3]:
        ax.set_facecolor(BG_WHITE)
        ax.set_xlim(-0.1, 1.1)
        ax.set_ylim(-0.1, 1.1)
        ax.axis('off')

    pos_tri = [(0.15, 0.18), (0.85, 0.18), (0.50, 0.82)]

    # 1. Gauge Gradient delta_0 x
    ax1.set_title(r"1. Gauge Gradient $\delta_0 x$" + "\n" + r"(Curl-free, $\delta_1(\delta_0 x) \equiv 0$)", 
                  fontsize=8.8, fontweight='bold', color=SEA_GREEN)
    ax1.annotate('', xy=pos_tri[1], xytext=pos_tri[0], arrowprops=dict(arrowstyle="-|>", color=SEA_GREEN, lw=1.4, shrinkA=6, shrinkB=6))
    ax1.annotate('', xy=pos_tri[2], xytext=pos_tri[1], arrowprops=dict(arrowstyle="-|>", color=SEA_GREEN, lw=1.4, shrinkA=6, shrinkB=6))
    ax1.annotate('', xy=pos_tri[2], xytext=pos_tri[0], arrowprops=dict(arrowstyle="-|>", color=SEA_GREEN, lw=1.4, shrinkA=6, shrinkB=6))
    ax1.text(0.5, 0.38, "Explainable\nClock Lag\n" + r"$\delta_1 g = 0$", ha='center', va='center', fontsize=7.8, color=SEA_GREEN)
    for i, (x, y) in enumerate(pos_tri):
        ax1.add_patch(plt.Circle((x, y), 0.06, facecolor=BG_WHITE, edgecolor=SEA_GREEN, lw=1.2, zorder=4))
        ax1.text(x, y, f"$v_{i}$", ha='center', va='center', fontsize=8, color=SLATE_DARK)

    # 2. Harmonic Cavity h
    ax2.set_title(r"2. Harmonic Cavity $h \in \mathcal{H}^1$" + "\n" + r"($\delta_1 h = 0$, $\delta_0^* h = 0$)", 
                  fontsize=8.8, fontweight='bold', color=HARBOR_BLUE)
    ring = [(0.18, 0.18), (0.82, 0.18), (0.82, 0.82), (0.18, 0.82)]
    for i in range(4):
        ax2.annotate('', xy=ring[(i+1)%4], xytext=ring[i], 
                     arrowprops=dict(arrowstyle="-|>", color=HARBOR_BLUE, lw=1.4, shrinkA=6, shrinkB=6))
    hole = plt.Circle((0.5, 0.5), 0.18, facecolor=BG_LIGHT, edgecolor=HARBOR_BLUE, lw=0.8, ls='--')
    ax2.add_patch(hole)
    ax2.text(0.5, 0.5, "Macro Cavity\n(Partition Void)", ha='center', va='center', fontsize=7.5, color=HARBOR_BLUE)
    for i, (x, y) in enumerate(ring):
        ax2.add_patch(plt.Circle((x, y), 0.06, facecolor=BG_WHITE, edgecolor=HARBOR_BLUE, lw=1.2, zorder=4))
        ax2.text(x, y, f"$u_{i}$", ha='center', va='center', fontsize=8, color=SLATE_DARK)

    # 3. Triadic Curl delta_1^* psi
    ax3.set_title(r"3. Triadic Curl $\delta_1^* \psi$" + "\n" + r"(Divergence-free, $\delta_0^* = 0$)", 
                  fontsize=8.8, fontweight='bold', color=SHIP_RED)
    poly = plt.Polygon(pos_tri, facecolor=BG_LIGHT, edgecolor=SHIP_RED, lw=1.2, zorder=2)
    ax3.add_patch(poly)
    arc = patches.Arc((0.5, 0.40), 0.28, 0.28, angle=0, theta1=20, theta2=320, color=SHIP_RED, lw=1.2, ls='--')
    ax3.add_patch(arc)
    ax3.annotate('', xy=(0.63, 0.45), xytext=(0.64, 0.41), arrowprops=dict(arrowstyle="-|>", color=SHIP_RED, lw=1.2))
    ax3.text(0.5, 0.40, "Broken 3-Way\nReview Join\n" + r"$(\delta_1 g \neq 0)$", ha='center', va='center', fontsize=7.5, color=SHIP_RED)
    for i, (x, y) in enumerate(pos_tri):
        ax3.add_patch(plt.Circle((x, y), 0.06, facecolor=BG_WHITE, edgecolor=SHIP_RED, lw=1.2, zorder=4))
        ax3.text(x, y, f"$v_{i}$", ha='center', va='center', fontsize=8, color=SLATE_DARK)

    # 4. Legibility Ratio Bar Chart
    ax4.set_facecolor(BG_WHITE)
    ax4.set_title(r"Swarm Legibility $\mathcal{L}(g)$" + "\n" + r"$\frac{\|h\|^2}{\|h\|^2 + \|\delta_1^*\psi\|^2}$",
                  fontsize=8.8, fontweight='bold', color=SLATE_DARK, pad=8)
    
    categories = ['Review Bug\n(Micro)', 'Network Split\n(Macro)']
    values = [0.00, 1.00]
    bars = ax4.bar(categories, values, width=0.45, color=[SHIP_RED, HARBOR_BLUE], edgecolor=SLATE_DARK, lw=0.8)
    ax4.set_ylabel(r"$\mathcal{L}(g) \in [0, 1]$", fontsize=8.5)
    ax4.set_ylim(0, 1.15)
    ax4.grid(axis='y', linestyle=':', alpha=0.35)
    ax4.text(0, 0.05, "0.00", ha='center', va='bottom', fontsize=8, fontweight='bold', color=SHIP_RED)
    ax4.text(1, 1.02, "1.00", ha='center', va='bottom', fontsize=8, fontweight='bold', color=HARBOR_BLUE)

    plt.tight_layout()
    plt.savefig(os.path.join(FIG_DIR, "fig-paper8-simplicial-hodge.png"), dpi=300, facecolor=BG_WHITE)
    plt.savefig(os.path.join(BRAIN_DIR, "fig-paper8-simplicial-hodge.png"), dpi=300, facecolor=BG_WHITE)
    plt.close()
    print("Regenerated Figure 3.")

# -------------------------------------------------------------------------
# FIGURE 4: Theorem CR-4 (Optimal Cohomological Repair via Min-Cut)
# -------------------------------------------------------------------------
def make_fig4():
    fig, (ax1, ax2, ax3) = plt.subplots(1, 3, figsize=(11, 3.8), dpi=300)
    fig.patch.set_facecolor(BG_WHITE)

    # Panel 1: Residual Flow Graph
    ax1.set_facecolor(BG_WHITE)
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
        ax1.text(x, y, f"$v_{node}$", ha='center', va='center', fontsize=8, color=BG_WHITE, fontweight='bold')

    ax1.text(0.5, -0.04, r"Initial $r = 2.683$; Node $v_2$ equivocating", ha='center', va='top', fontsize=7.8, color=SLATE_DARK)
    ax1.set_xlim(0.05, 0.95)
    ax1.set_ylim(-0.1, 0.95)
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
        ax3.text(r_idx, val + 0.12, f"$r={val:.3f}$", ha='center', va='bottom', fontsize=8, color=HARBOR_BLUE)
    
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
# FIGURE 5: 16-Agent Clustered Enterprise Matrix (Mixed Failure)
# -------------------------------------------------------------------------
def make_fig5():
    fig, (ax_graph, ax_stats) = plt.subplots(1, 2, figsize=(11, 4.8), dpi=300, width_ratios=[1.25, 0.75])
    fig.patch.set_facecolor(BG_WHITE)
    ax_graph.set_facecolor(BG_WHITE)
    ax_stats.set_facecolor(BG_WHITE)

    ax_graph.set_title("16-Agent Enterprise Organization: Mixed Failure Triage", 
                       fontsize=10.5, fontweight='bold', color=SLATE_DARK, pad=10)

    # 4 Team Quadrants (subtle, clean, neutral borders)
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
        # Frontend: 0,1,2,3
        0: (0.15, 0.83), 1: (0.35, 0.83), 2: (0.38, 0.62), 3: (0.18, 0.62),
        # Backend: 4,5,6,7
        4: (0.62, 0.62), 5: (0.82, 0.62), 6: (0.85, 0.83), 7: (0.65, 0.83),
        # Data: 8,9,10,11
        8: (0.62, 0.38), 9: (0.82, 0.38), 10: (0.85, 0.15), 11: (0.65, 0.15),
        # Security: 12,13,14,15
        12: (0.38, 0.15), 13: (0.18, 0.15), 14: (0.15, 0.38), 15: (0.35, 0.38),
    }

    # Micro failure: Backend triangle (4,5,6)
    poly_err = plt.Polygon([pos[4], pos[5], pos[6]], facecolor=BG_WHITE, edgecolor=SHIP_RED, lw=1.4, zorder=2)
    ax_graph.add_patch(poly_err)
    ax_graph.text(0.76, 0.69, r"Triad Bug" + "\n" + r"$\delta_1^* \psi = 3.46$",
                 ha='center', va='center', fontsize=7.2, color=SHIP_RED, zorder=5)

    # Normal review triangles
    for pts in [[pos[0], pos[1], pos[2]], [pos[8], pos[9], pos[10]], [pos[12], pos[13], pos[14]]]:
        poly = plt.Polygon(pts, facecolor=BG_WHITE, edgecolor=LINE_GRAY, lw=0.8, zorder=2)
        ax_graph.add_patch(poly)

    # Intra-team links
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

    # Inter-team bridge links
    inter_edges = [(2, 4), (3, 5), (6, 8), (7, 9), (10, 12), (11, 13), (0, 14), (15, 6)]
    for u, v in inter_edges:
        is_lag = (u, v) in [(2, 4), (3, 5)]
        col = HARBOR_BLUE if is_lag else LINE_GRAY
        lw = 1.4 if is_lag else 0.8
        ls = '--' if is_lag else ':'
        ax_graph.plot([pos[u][0], pos[v][0]], [pos[u][1], pos[v][1]], color=col, lw=lw, ls=ls, zorder=3)

    ax_graph.text(0.50, 0.69, r"Partition Cavity" + "\n" + r"$h = 2.50$",
                 ha='center', va='center', fontsize=7.2, color=HARBOR_BLUE,
                 bbox=dict(boxstyle="square,pad=0.2", facecolor=BG_WHITE, edgecolor=HARBOR_BLUE, lw=0.6), zorder=6)

    # Nodes
    for node, (x, y) in pos.items():
        fc = SHIP_RED if node in [4, 5, 6] else (HARBOR_BLUE if node in [2, 3] else SLATE_DARK)
        ax_graph.add_patch(plt.Circle((x, y), 0.030, facecolor=fc, edgecolor=SLATE_DARK, lw=0.8, zorder=4))
        ax_graph.text(x, y, f"{node}", ha='center', va='center', fontsize=7.5, color=BG_WHITE, zorder=5)

    ax_graph.set_xlim(0.0, 1.0)
    ax_graph.set_ylim(0.0, 1.0)
    ax_graph.axis('off')

    # Right Panel: Energy Stats
    ax_stats.set_title("Hodge Decomposition Energy", fontsize=10.5, fontweight='bold', color=SLATE_DARK, pad=10)

    components = ['Gauge Progress\n($\\|\\delta_0 x\\| = 3.13$)',
                  'Harmonic Cavity\n($\\|h\\| = 2.50$)',
                  'Triadic Curl\n($\\|\\delta_1^* \\psi\\| = 3.46$)']
    energies = [3.126**2, 2.496**2, 3.464**2]
    colors = [SEA_GREEN, HARBOR_BLUE, SHIP_RED]

    bars = ax_stats.barh(components, energies, color=colors, edgecolor=SLATE_DARK, lw=0.8, height=0.45)
    ax_stats.set_xlabel(r"Energy Metric ($\|\cdot\|_2^2$)", fontsize=8.5)
    ax_stats.grid(axis='x', linestyle=':', alpha=0.35)

    for bar, val in zip(bars, energies):
        ax_stats.text(val + 0.3, bar.get_y() + bar.get_height()/2, f"{val:.1f}", 
                     va='center', fontsize=8, color=SLATE_DARK)

    summary_text = (
        r"$\mathbf{Swarm\ Legibility\ Ratio:}$" + "\n"
        r"$\mathcal{L}(g) = \frac{\|h\|^2}{\|h\|^2 + \|\delta_1^* \psi\|^2} = \mathbf{0.342}$" + "\n\n"
        r"$\mathbf{Prescriptive\ Triage:}$" + "\n"
        r"$\bullet\ \mathbf{65.8\%\ Micro:}$ Review bug in $(v_4, v_5, v_6)$." + "\n"
        r"  $\rightarrow$ Re-prompt Backend triad." + "\n"
        r"$\bullet\ \mathbf{34.2\%\ Macro:}$ Lag on bridge $(v_2, v_4)$." + "\n"
        r"  $\rightarrow$ Reconcile API interface."
    )
    ax_stats.text(0.5, 0.16, summary_text, transform=ax_stats.transAxes,
                  ha='center', va='center', fontsize=7.8, color=SLATE_DARK, linespacing=1.3,
                  bbox=dict(boxstyle="square,pad=0.4", facecolor=BG_LIGHT, edgecolor=LINE_GRAY, lw=0.8))

    plt.tight_layout()
    plt.savefig(os.path.join(FIG_DIR, "fig-paper8-16agent-matrix.png"), dpi=300, facecolor=BG_WHITE)
    plt.savefig(os.path.join(BRAIN_DIR, "fig-paper8-16agent-matrix.png"), dpi=300, facecolor=BG_WHITE)
    plt.close()
    print("Regenerated Figure 5.")

if __name__ == '__main__':
    make_fig1()
    make_fig2()
    make_fig3()
    make_fig4()
    make_fig5()
    print("All 5 academic figures regenerated with Harbor Research styling!")
