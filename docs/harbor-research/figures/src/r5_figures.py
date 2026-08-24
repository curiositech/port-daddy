#!/usr/bin/env python3
"""
R5 Figures: hypervisor enforceability = supervisory control
- r5_relation.png: RELATION-MAP (bouncer analogy → daemon control boundary)
- r5_regime.png: REGIME DIAGRAM (regimentable vs detect-only classification)
"""

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.patches import FancyArrowPatch, Rectangle
import matplotlib.lines as mlines

# House colors (from task)
HARBORBLUE = (30/255, 70/255, 110/255)
SHIPRED = (140/255, 30/255, 30/255)
SEAGREEN = (31/255, 110/255, 70/255)

def create_relation_map():
    """
    Create r5_relation.png - the RELATION-MAP figure.
    Three columns: Base (bouncer) | Target (daemon) | with labeled arrows.
    Base: bouncer at door - refuses ENTRY (controllable) but cannot control THOUGHT (uncontrollable).
    Target: daemon refuses mediated effects but cannot refuse internal model steps.
    Arrows show the boundary correspondence.
    """
    fig, ax = plt.subplots(figsize=(12, 7), dpi=150)
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 10)
    ax.axis('off')

    # Title
    ax.text(6, 9.5, "R5 — gate the door, never the thought",
            fontsize=11, weight='bold', ha='center', va='top')

    # ===== BASE DOMAIN (left) =====
    y_base = 7.0
    box1 = Rectangle((0.2, y_base-2.0), 3.2, 2.6,
                          edgecolor=HARBORBLUE, facecolor=HARBORBLUE,
                          alpha=0.15, linewidth=1.5)
    ax.add_patch(box1)
    ax.text(1.8, y_base+0.6, "Base Domain", fontsize=10, weight='bold',
            ha='center', va='center')
    ax.text(1.8, y_base+0.1, "Club's one door", fontsize=9, ha='center', va='center')
    ax.text(1.8, y_base-0.3, "Bouncer can REFUSE:", fontsize=9, ha='center', va='center', weight='bold')
    ax.text(1.8, y_base-0.7, "ENTRY (controllable)", fontsize=8, ha='center', va='center')
    ax.text(1.8, y_base-1.1, "Bouncer cannot REFUSE:", fontsize=9, ha='center', va='center', weight='bold')
    ax.text(1.8, y_base-1.5, "patron THOUGHT", fontsize=8, ha='center', va='center')
    ax.text(1.8, y_base-1.8, "(uncontrollable)", fontsize=8, ha='center', va='center')

    # ===== TARGET DOMAIN (right) =====
    y_target = 7.0
    box2 = Rectangle((8.6, y_target-2.0), 3.2, 2.6,
                          edgecolor=SEAGREEN, facecolor=SEAGREEN,
                          alpha=0.15, linewidth=1.5)
    ax.add_patch(box2)
    ax.text(10.2, y_target+0.6, "Target Domain", fontsize=10, weight='bold',
            ha='center', va='center')
    ax.text(10.2, y_target+0.1, "RL mediation boundary", fontsize=9, ha='center', va='center')
    ax.text(10.2, y_target-0.3, "Daemon can FORBID:", fontsize=9, ha='center', va='center', weight='bold')
    ax.text(10.2, y_target-0.7, "fs_write, net_egress,", fontsize=8, ha='center', va='center')
    ax.text(10.2, y_target-0.95, "exec_tool, git_push, spawn", fontsize=8, ha='center', va='center')
    ax.text(10.2, y_target-1.3, "Daemon cannot forbid:", fontsize=9, ha='center', va='center', weight='bold')
    ax.text(10.2, y_target-1.7, "token emission, in-context read,", fontsize=8, ha='center', va='center')
    ax.text(10.2, y_target-1.95, "internal plan (uncontrollable)", fontsize=8, ha='center', va='center')

    # ===== UPPER ARROW (controllable → regimentable) =====
    y_arrow_top = y_base + 0.5
    arrow1 = FancyArrowPatch((3.4, y_arrow_top), (8.6, y_arrow_top),
                            arrowstyle='<->', mutation_scale=22,
                            linewidth=2.0, color=SHIPRED, alpha=0.85)
    ax.add_patch(arrow1)
    ax.text(6, y_arrow_top + 0.6, "refusable at the boundary",
            fontsize=9, ha='center', va='bottom', style='italic', color=SHIPRED, weight='bold')
    ax.text(6, y_arrow_top + 0.15, "⇔ preventable (regimentable)",
            fontsize=9, ha='center', va='bottom', style='italic', color=SHIPRED, weight='bold')

    # ===== LOWER ARROW (uncontrollable → detect-only) =====
    y_arrow_bot = y_base - 1.6
    arrow2 = FancyArrowPatch((3.4, y_arrow_bot), (8.6, y_arrow_bot),
                            arrowstyle='<->', mutation_scale=22,
                            linewidth=2.0, color=SHIPRED, alpha=0.85)
    ax.add_patch(arrow2)
    ax.text(6, y_arrow_bot - 0.5, "internal ⇔ detect-only forever",
            fontsize=9, ha='center', va='top', style='italic', color=SHIPRED, weight='bold')

    # Bottom note
    ax.text(6, 2.5, "Framework: Ramadge–Wonham (1987) supervisory control theory",
            fontsize=9, ha='center', va='center', color='gray')
    ax.text(6, 1.9, "Criterion: K̄Σᵤ ∩ L̄ ⊆ K̄ — no uncontrollable event exits the specification",
            fontsize=9, ha='center', va='center', color='gray', weight='bold')
    ax.text(6, 1.3, "Regimentable: policy K can be enforced by refusing Σ_c at the mediation boundary",
            fontsize=8, ha='center', va='center', color='gray')

    plt.tight_layout()
    plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r5_relation.png',
                dpi=150, bbox_inches='tight')
    plt.close()

def create_regime_diagram():
    """
    Create r5_regime.png - the REGIME DIAGRAM figure.
    A 2×N classification chart with matplotlib patches.
    Row 1: "regimentable (Ramadge–Wonham controllable)" - seagreen boxes for policies
    Row 2: "detect-only forever" - shipred boxes for policies
    A harborblue divider between them with the criterion.
    """
    fig, ax = plt.subplots(figsize=(13, 6), dpi=150)
    ax.set_xlim(0, 13)
    ax.set_ylim(0, 6)
    ax.axis('off')

    # Title
    ax.text(6.5, 5.7, "R5 regime — the exact boundary between prevented and detected",
            fontsize=11, weight='bold', ha='center', va='top')

    # ===== ROW 1: REGIMENTABLE (top) =====
    y_row1 = 4.2

    # Row label
    ax.text(0.3, y_row1, "regimentable\n(Ramadge–Wonham)", fontsize=9, weight='bold', ha='left', va='center')

    # Define regimentable policies
    regimentable_policies = [
        "forbid\nfs_write",
        "forbid\nnet_egress",
        "forbid\nexec_tool",
        "forbid\ngit_push",
        "forbid\nspawn",
        "compound:\nno egress\nAFTER\nsecret read",
    ]

    box_width = 1.5
    x_start = 2.0
    for idx, policy in enumerate(regimentable_policies):
        x_pos = x_start + idx * (box_width + 0.15)
        box = Rectangle((x_pos, y_row1 - 0.55), box_width, 1.1,
                            edgecolor=SEAGREEN, facecolor=SEAGREEN,
                            alpha=0.25, linewidth=1.5)
        ax.add_patch(box)
        ax.text(x_pos + box_width/2, y_row1, policy, fontsize=8, ha='center', va='center',
               weight='bold')

    # ===== HARBORBLUE DIVIDER =====
    y_divider = 2.0
    divider_line = Rectangle((0.2, y_divider - 0.15), 12.6, 0.3,
                            facecolor=HARBORBLUE, alpha=0.3, edgecolor=HARBORBLUE, linewidth=2)
    ax.add_patch(divider_line)

    # Criterion text on divider
    ax.text(0.5, y_divider, "K̄Σᵤ ∩ L̄ ⊆ K̄", fontsize=9, weight='bold', ha='left', va='center',
           color=HARBORBLUE, bbox=dict(boxstyle='round,pad=0.3', facecolor='white', alpha=0.9))
    ax.text(2.5, y_divider, "no uncontrollable event exits the spec", fontsize=9, ha='left', va='center',
           style='italic', color=HARBORBLUE, weight='bold')

    # ===== ROW 2: DETECT-ONLY (bottom) =====
    y_row2 = 0.8

    # Row label
    ax.text(0.3, y_row2, "detect-only\nforever", fontsize=9, weight='bold', ha='left', va='center')

    # Define detect-only policies
    detect_only_policies = [
        "forbid\ntoken\nemission",
        "forbid\nin-context\nread",
        "forbid\ninternal\nplan",
        "forbid\nconfident-\nfalsehood",
    ]

    x_start = 2.0
    for idx, policy in enumerate(detect_only_policies):
        x_pos = x_start + idx * (box_width + 0.15)
        box = Rectangle((x_pos, y_row2 - 0.55), box_width, 1.1,
                            edgecolor=SHIPRED, facecolor=SHIPRED,
                            alpha=0.25, linewidth=1.5)
        ax.add_patch(box)
        ax.text(x_pos + box_width/2, y_row2, policy, fontsize=8, ha='center', va='center',
               weight='bold')

    plt.tight_layout()
    plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r5_regime.png',
                dpi=150, bbox_inches='tight')
    plt.close()

if __name__ == '__main__':
    create_relation_map()
    create_regime_diagram()
    print("R5 figures created successfully.")
