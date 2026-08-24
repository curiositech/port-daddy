#!/usr/bin/env python3
"""
R6 Figures: sheaf verdict (cohomology of equivocation)
- r6_relation.png: RELATION-MAP (wristwatches → gossip cohomology)
- r6_regime.png: REGIME DIAGRAM (three topologies: cycle relayed, cut edge, severed edge)
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, FancyArrowPatch, Circle

# House colors (from task)
HARBORBLUE = (30/255, 70/255, 110/255)
SHIPRED = (140/255, 30/255, 30/255)
SEAGREEN = (31/255, 110/255, 70/255)
GREY = (0.5, 0.5, 0.5)

def create_relation_map():
    """
    Create r6_relation.png - the RELATION-MAP figure.
    Three columns: base domain | target domain | with labeled arrows.
    Base: wristwatches around a table (loop-sum must be zero)
    Target: signed-log disagreements (coboundary / completion residual)
    Arrows: "loop-sum ⇔ cocycle condition" and "needs a loop through the missing link ⇔
            needs a cycle through the uncompared edge"
    """
    fig, ax = plt.subplots(figsize=(13, 7), dpi=150)
    ax.set_xlim(0, 13)
    ax.set_ylim(0, 10)
    ax.axis('off')

    # Title
    ax.text(6.5, 9.5, "R6 — equivocation is a watch that cannot add up around the table",
            fontsize=11, weight='bold', ha='center', va='top')

    # Column 1: Base Domain (Wristwatches)
    y_base = 7.0
    box1 = Rectangle((0.2, y_base-2.0), 3.2, 2.8,
                          edgecolor=HARBORBLUE, facecolor=HARBORBLUE,
                          alpha=0.15, linewidth=1.5)
    ax.add_patch(box1)
    ax.text(1.8, y_base+0.6, "Base Domain", fontsize=10, weight='bold',
            ha='center', va='center')
    ax.text(1.8, y_base+0.1, "Wristwatches", fontsize=9, ha='center', va='center')
    ax.text(1.8, y_base-0.35, "around a table", fontsize=9, ha='center', va='center')
    ax.text(1.8, y_base-0.8, "Pairwise offsets", fontsize=9, ha='center', va='center')
    ax.text(1.8, y_base-1.2, "sum to ZERO around", fontsize=9, ha='center', va='center')
    ax.text(1.8, y_base-1.6, "any loop if one", fontsize=9, ha='center', va='center')

    # Column 2: Target Domain (Gossip Cohomology)
    y_target = 7.0
    box2 = Rectangle((9.6, y_target-2.0), 3.2, 2.8,
                          edgecolor=SEAGREEN, facecolor=SEAGREEN,
                          alpha=0.15, linewidth=1.5)
    ax.add_patch(box2)
    ax.text(11.2, y_target+0.6, "Target Domain", fontsize=10, weight='bold',
            ha='center', va='center')
    ax.text(11.2, y_target+0.1, "Gossip Cycle", fontsize=9, ha='center', va='center')
    ax.text(11.2, y_target-0.35, "Signed-log disagreements", fontsize=9, ha='center', va='center')
    ax.text(11.2, y_target-0.8, "Completion residual r", fontsize=9, ha='center', va='center')
    ax.text(11.2, y_target-1.2, "convicts equivocator", fontsize=9, ha='center', va='center')
    ax.text(11.2, y_target-1.6, "even across unchecked link", fontsize=9, ha='center', va='center')

    # Arrow 1: Base → Target (top) with top label
    arrow1 = FancyArrowPatch((3.4, y_base+0.4), (9.6, y_target+0.4),
                            arrowstyle='<->', mutation_scale=25,
                            linewidth=2, color=SHIPRED, alpha=0.8)
    ax.add_patch(arrow1)
    ax.text(6.5, y_base+1.1, "loop-sum ⇔ cocycle condition",
            fontsize=9, ha='center', va='bottom', style='italic', weight='bold', color=SHIPRED)

    # Arrow 2: Base → Target (bottom) with bottom label
    arrow2 = FancyArrowPatch((3.4, y_base-1.3), (9.6, y_target-1.3),
                            arrowstyle='<->', mutation_scale=25,
                            linewidth=2, color=SHIPRED, alpha=0.8)
    ax.add_patch(arrow2)
    ax.text(6.5, y_base-2.0, "needs loop through missing link ⇔ needs cycle through uncompared edge",
            fontsize=9, ha='center', va='top', style='italic', weight='bold', color=SHIPRED)

    # Bottom explanatory notes
    ax.text(6.5, 2.8, "Nonzero loop-sum → someone shows different times to different neighbors.",
            fontsize=9, ha='center', va='center', style='italic', color='gray')
    ax.text(6.5, 2.1, "Nonzero completion residual r → no global explanation for the reports exists.",
            fontsize=9, ha='center', va='center', style='italic', color='gray')
    ax.text(6.5, 1.4, "Cohomology detects beyond pairwise comparison: via relayed reports around cycles.",
            fontsize=9, ha='center', va='center', style='italic', color='gray')

    plt.tight_layout()
    plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r6_relation.png',
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
    plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r6_regime.png',
                dpi=150, bbox_inches='tight')
    plt.close()


if __name__ == '__main__':
    # Set seed for deterministic output
    np.random.seed(20260816)

    create_relation_map()
    create_regime_diagram()
    print("R6 figures created successfully.")
