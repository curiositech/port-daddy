#!/usr/bin/env python3
"""
R6 Figures: sheaf verdict (cohomology of equivocation)
- r6_relation.png: RELATION-MAP (wristwatches → gossip cohomology)
- r6_regime.png: REGIME DIAGRAM (three topologies: cycle relayed, cut edge, severed edge)
"""

from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt
plt.rcParams['font.family'] = 'serif'  # match the LaTeX body's serif face, not matplotlib's sans default
from matplotlib.patches import Rectangle, FancyArrowPatch, Circle

FIGURES_DIR = Path(__file__).resolve().parents[1]

# House colors (from task)
HARBORBLUE = (30/255, 70/255, 110/255)
SHIPRED = (140/255, 30/255, 30/255)
SEAGREEN = (31/255, 110/255, 70/255)
GREY = (0.5, 0.5, 0.5)

def create_relation_map():
    """
    Create r6_relation.png - the RELATION-MAP figure.
    Base: wristwatches around a table (loop-sum must be zero).
    Target: gossip logs on a communication graph (cocycle / completion residual).
    Three substantive rows carry the mapping: topology setup, cycle-vs-bridge
    fork, and the detection numbers — each row a labeled two-way arrow.
    """
    fig, ax = plt.subplots(figsize=(12, 7.6), dpi=150)
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 10.6)
    ax.axis('off')

    ax.text(6, 10.3, "R6 — equivocation is a watch that cannot add up around the table",
            fontsize=12, weight='bold', ha='center', va='top', color=HARBORBLUE)

    # Base domain (left): wristwatches around a table
    ax.add_patch(Rectangle((0.2, 0.7), 3.6, 8.7, edgecolor=HARBORBLUE,
                           facecolor=HARBORBLUE, alpha=0.12, linewidth=1.5))
    ax.text(2.0, 9.05, "Base: watches around a table", fontsize=10.5, weight='bold',
            ha='center', va='center')

    # Target domain (right): gossip logs on a graph
    ax.add_patch(Rectangle((8.2, 0.7), 3.6, 8.7, edgecolor=SEAGREEN,
                           facecolor=SEAGREEN, alpha=0.12, linewidth=1.5))
    ax.text(10.0, 9.05, "Target: gossip logs on a graph", fontsize=10.5, weight='bold',
            ha='center', va='center')

    rows = [
        # (y, base lines, target lines, arrow label lines)
        (7.4,
         ["Offsets between", "neighboring watches:", "consistent iff they", "sum to ZERO around", "every loop"],
         ["Edge disagreements", "on the comm. graph:", "cocycle condition —", "sum to zero around", "every cycle"],
         ["loop-sum", "⇔ cocycle condition"]),
        (4.6,
         ["One handshake skipped", "ON the loop: the other", "watches still relay", "the missing check", "around it"],
         ["Uncompared edge ON a cycle:", "relayed reports substitute;", "uncompared edge is a BRIDGE", "(tree-δ surjective): nothing", "loops back to catch it"],
         ["cycle ⇒ relay substitutes", "bridge ⇒ silent by construction"]),
        (1.9,
         ["A lying watch can't hide:", "neighbors' relayed times", "force a mismatch", "around the table"],
         ["Completion residual r > 0", "proves no global story exists:", "C₆ relayed-cycle lie 1.225;", "P₆ bridge/cut-edge lie 0.000", "[sheaf_harness_v2.py]"],
         ["nonzero r convicts —", "beyond pairwise comparison"]),
    ]

    for y, base_lines, target_lines, label_lines in rows:
        for i, s in enumerate(base_lines):
            ax.text(2.0, y + 0.75 - 0.42 * i, s, fontsize=8.5, ha='center', va='center')
        for i, s in enumerate(target_lines):
            ax.text(10.0, y + 0.75 - 0.42 * i, s, fontsize=8.5, ha='center', va='center')
        arrow = FancyArrowPatch((3.9, y - 0.15), (8.1, y - 0.15), arrowstyle='<->',
                                connectionstyle="arc3,rad=0.08",
                                mutation_scale=20, linewidth=1.8, color=SHIPRED, alpha=0.85)
        ax.add_patch(arrow)
        for i, s in enumerate(label_lines):
            ax.text(6.0, y + 0.62 - 0.38 * i, s, fontsize=9, ha='center',
                    va='center', color=SHIPRED, weight='bold')

    ax.text(6.0, 0.25,
            "Cohomology detects equivocation beyond pairwise comparison iff the missing edge lies on a cycle — on a cut edge, never.",
            fontsize=8.5, ha='center', va='center', style='italic')

    plt.tight_layout()
    plt.savefig(FIGURES_DIR / 'r6_relation.png',
                dpi=150, bbox_inches='tight')
    plt.close()


def draw_6node_cycle_graph(ax, title, edge_style_dict=None, annotation_text="",
                          annotation_color=SEAGREEN, annotation_weight='bold'):
    """
    Draw a 6-node cycle graph on axes ax.
    Nodes arranged in a hexagon.
    edge_style_dict: dict mapping (i,j) tuple to style ('normal', 'dashed', 'dotted')
    """
    # Set up axes
    ax.set_xlim(-1.5, 1.5)
    ax.set_ylim(-1.5, 1.5)
    ax.set_aspect('equal')
    ax.axis('off')

    # Title
    ax.text(0, 1.35, title, fontsize=9, ha='center', va='bottom', weight='bold')

    # Node positions (hexagon, cycle C6)
    angles = np.linspace(0, 2*np.pi, 7)  # 7 to close the circle
    radius = 1.0
    node_positions = {i: (radius * np.cos(angles[i]), radius * np.sin(angles[i]))
                      for i in range(6)}

    # Draw edges
    for i in range(6):
        j = (i + 1) % 6
        x0, y0 = node_positions[i]
        x1, y1 = node_positions[j]

        style = 'normal'
        if edge_style_dict:
            style = edge_style_dict.get((i, j), 'normal')

        if style == 'normal':
            ax.plot([x0, x1], [y0, y1], 'k-', linewidth=1.5, zorder=1)
        elif style == 'dashed':
            ax.plot([x0, x1], [y0, y1], 'k--', linewidth=1.5, zorder=1)
        elif style == 'dotted':
            ax.plot([x0, x1], [y0, y1], color=GREY, linestyle=':', linewidth=1.5, zorder=1)

    # Draw nodes
    for i in range(6):
        x, y = node_positions[i]
        circle = Circle((x, y), 0.12, color=HARBORBLUE, zorder=3, edgecolor='black', linewidth=0.8)
        ax.add_patch(circle)
        ax.text(x, y, str(i), fontsize=8, ha='center', va='center', color='white', weight='bold', zorder=4)

    # Annotation text
    if annotation_text:
        ax.text(0, -1.35, annotation_text, fontsize=8, ha='center', va='top',
               color=annotation_color, weight=annotation_weight)


def draw_path_graph(ax, title, edge_style_dict=None, annotation_text="",
                   annotation_color=SHIPRED, annotation_weight='bold'):
    """
    Draw a 6-node path graph (P6) on axes ax.
    Nodes arranged in a line.
    """
    ax.set_xlim(-1.5, 1.5)
    ax.set_ylim(-1.5, 1.5)
    ax.set_aspect('equal')
    ax.axis('off')

    # Title
    ax.text(0, 1.35, title, fontsize=9, ha='center', va='bottom', weight='bold')

    # Node positions (linear path)
    node_positions = {i: ((i - 2.5) * 0.4, 0) for i in range(6)}

    # Draw edges
    for i in range(5):
        j = i + 1
        x0, y0 = node_positions[i]
        x1, y1 = node_positions[j]

        style = 'normal'
        if edge_style_dict:
            style = edge_style_dict.get((i, j), 'normal')

        if style == 'normal':
            ax.plot([x0, x1], [y0, y1], 'k-', linewidth=1.5, zorder=1)
        elif style == 'dashed':
            ax.plot([x0, x1], [y0, y1], 'k--', linewidth=1.5, zorder=1)
        elif style == 'dotted':
            ax.plot([x0, x1], [y0, y1], color=GREY, linestyle=':', linewidth=1.5, zorder=1)

    # Draw nodes
    for i in range(6):
        x, y = node_positions[i]
        circle = Circle((x, y), 0.12, color=HARBORBLUE, zorder=3, edgecolor='black', linewidth=0.8)
        ax.add_patch(circle)
        ax.text(x, y, str(i), fontsize=8, ha='center', va='center', color='white', weight='bold', zorder=4)

    # Annotation text
    if annotation_text:
        ax.text(0, -1.35, annotation_text, fontsize=8, ha='center', va='top',
               color=annotation_color, weight=annotation_weight)


def create_regime_diagram():
    """
    Create r6_regime.png - the REGIME DIAGRAM figure.
    Three panels in one row (3 subplots):
    (a) C6 cycle with edge (0,1) dashed (relayed) → seagreen annotation "residual 1.225, detected (200/200 cohomology-only)"
    (b) P6 path with bridge edge (0,5) dashed → shipred annotation "cut edge: residual 0.000, provably silent"
    (c) C6 cycle with edge (0,1) dotted grey (severed) → grey annotation "severed: provably dark (0/200)"

    Shared title: "R6 regime — detection requires a cycle AND relayed reports; cut edges silent, severed edges dark [internal, sheaf_harness_v2.py]"
    """
    fig, axes = plt.subplots(1, 3, figsize=(13, 4.5), dpi=150)

    # Panel (a): C6 with relayed edge (0,1) dashed
    edge_style_a = {(0, 1): 'dashed'}
    draw_6node_cycle_graph(axes[0], "(a) cycle C₆ relayed",
                          edge_style_dict=edge_style_a,
                          annotation_text="residual 1.225\ndetected (200/200\ncohomology-only)",
                          annotation_color=SEAGREEN,
                          annotation_weight='bold')

    # Panel (b): P6 path with bridge (0,5) dashed [note: in a path there's no edge (0,5), so we show (4,5) as dashed bridge]
    # Actually for a path, the "bridge" would be showing it as dashed. Let me think...
    # P6 is a path: 0-1-2-3-4-5. The dashed edge shows the uncompared one, let's make it (4,5)
    edge_style_b = {(4, 5): 'dashed'}
    draw_path_graph(axes[1], "(b) path P₆ bridge",
                   edge_style_dict=edge_style_b,
                   annotation_text="cut edge:\nresidual 0.000\nprovably silent",
                   annotation_color=SHIPRED,
                   annotation_weight='bold')

    # Panel (c): C6 with severed edge (0,1) dotted grey
    edge_style_c = {(0, 1): 'dotted'}
    draw_6node_cycle_graph(axes[2], "(c) cycle C₆ severed",
                          edge_style_dict=edge_style_c,
                          annotation_text="severed:\nprovably dark\n(0/200)",
                          annotation_color=GREY,
                          annotation_weight='bold')

    # Shared title
    fig.suptitle("R6 regime — detection requires a cycle AND relayed reports; cut edges silent, severed edges dark [internal, sheaf_harness_v2.py]",
                fontsize=11, weight='bold', y=0.98)

    plt.tight_layout(rect=[0, 0, 1, 0.96])
    plt.savefig(FIGURES_DIR / 'r6_regime.png',
                dpi=150, bbox_inches='tight')
    plt.close()


if __name__ == '__main__':
    # Set seed for deterministic output
    np.random.seed(20260816)

    create_relation_map()
    create_regime_diagram()
    print("R6 figures created successfully.")
