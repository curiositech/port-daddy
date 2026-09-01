#!/usr/bin/env python3
"""
R5 Figures: hypervisor enforceability = supervisory control
- r5_relation.png: RELATION-MAP (bouncer analogy -> daemon control boundary)
- r5_regime.png: REGIME DIAGRAM (nine-policy classification table + compound-case flow)
"""

from pathlib import Path

import matplotlib.pyplot as plt
plt.rcParams['font.family'] = 'serif'  # match the LaTeX body's serif face, not matplotlib's sans default
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

FIGURES_DIR = Path(__file__).resolve().parents[1]

# House colors (from task)
HARBORBLUE = (30/255, 70/255, 110/255)
SHIPRED = (140/255, 30/255, 30/255)
SEAGREEN = (31/255, 110/255, 70/255)


def create_relation_map():
    """
    Create r5_relation.png - the RELATION-MAP figure.
    Two full-height columns (Base / Target) with THREE substantive rows,
    each row carrying real multi-line content on both sides plus a bold
    red connective label describing the relation between them.
    Row 1: the door/thought bouncer analogy, tightened.
    Row 2: the actual Sigma_c (5) vs Sigma_u (3) event classification.
    Row 3: the compound-case punchline -- gate the channel, never the token.
    """
    fig, ax = plt.subplots(figsize=(12, 8.6), dpi=150)
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 11)
    ax.axis('off')

    # Title
    ax.text(6, 10.65, "R5 — gate the door, never the thought",
            fontsize=13, weight='bold', ha='center', va='top')
    ax.text(6, 10.2, "hypervisor enforceability = Ramadge–Wonham supervisory control",
            fontsize=9.5, ha='center', va='top', style='italic', color='#444444')

    col_top, col_bot = 9.7, 0.35
    base_x0, base_x1 = 0.2, 4.05
    tgt_x0, tgt_x1 = 7.95, 11.8

    base_col = FancyBboxPatch((base_x0, col_bot), base_x1 - base_x0, col_top - col_bot,
                               boxstyle="round,pad=0,rounding_size=0.12",
                               edgecolor=HARBORBLUE, facecolor=HARBORBLUE, alpha=0.10, linewidth=1.6)
    ax.add_patch(base_col)
    tgt_col = FancyBboxPatch((tgt_x0, col_bot), tgt_x1 - tgt_x0, col_top - col_bot,
                              boxstyle="round,pad=0,rounding_size=0.12",
                              edgecolor=SEAGREEN, facecolor=SEAGREEN, alpha=0.10, linewidth=1.6)
    ax.add_patch(tgt_col)

    base_cx = (base_x0 + base_x1) / 2
    tgt_cx = (tgt_x0 + tgt_x1) / 2

    ax.text(base_cx, col_top - 0.35, "Base: the door", fontsize=11, weight='bold',
            ha='center', va='top', color=HARBORBLUE)
    ax.text(tgt_cx, col_top - 0.35, "Target: the daemon", fontsize=11, weight='bold',
            ha='center', va='top', color=SEAGREEN)

    # Row centers
    y1, y2, y3 = 8.15, 5.15, 2.15
    row_gap_top = [9.15, 6.15, 3.15]     # header y per row
    arrow_x0, arrow_x1 = base_x1 + 0.15, tgt_x0 - 0.15
    mid_x = (arrow_x0 + arrow_x1) / 2

    def draw_arrow(y, label_lines):
        arrow = FancyArrowPatch((arrow_x0, y), (arrow_x1, y),
                                 arrowstyle='<->', mutation_scale=20,
                                 linewidth=2.2, color=SHIPRED, alpha=0.9,
                                 connectionstyle="arc3,rad=0.0")
        ax.add_patch(arrow)
        n = len(label_lines)
        line_h = 0.32
        top_y = y + 0.18 + (n - 1) * line_h
        for i, line in enumerate(label_lines):
            ax.text(mid_x, top_y - i * line_h, line, fontsize=9.3, ha='center', va='bottom',
                    style='italic', color=SHIPRED, weight='bold')

    # ===== ROW 1: the analogy =====
    ax.text(base_cx, row_gap_top[0], "Bouncer at the one door", fontsize=10, weight='bold',
            ha='center', va='top')
    ax.text(base_cx, row_gap_top[0] - 0.42,
            "Refuses ENTRY at the door\n(controllable). Cannot refuse a\npatron's THOUGHT (uncontrollable) —\nthought never crosses the door.",
            fontsize=8.6, ha='center', va='top', linespacing=1.5)

    ax.text(tgt_cx, row_gap_top[0], "Daemon at the mediation boundary", fontsize=10, weight='bold',
            ha='center', va='top')
    ax.text(tgt_cx, row_gap_top[0] - 0.42,
            "Refuses mediated EFFECTS — writes,\ncalls, spawns (controllable). Cannot\nrefuse internal MODEL STATE\n(uncontrollable) — it never crosses.",
            fontsize=8.6, ha='center', va='top', linespacing=1.5)

    draw_arrow(y1, ["the analogy holds exactly:", "gate the channel, never the mind"])

    # ===== ROW 2: the 5-vs-3 split =====
    ax.text(base_cx, row_gap_top[1], "Σ_c — controllable (5 events)", fontsize=10, weight='bold',
            ha='center', va='top', color=HARBORBLUE)
    ax.text(base_cx, row_gap_top[1] - 0.42,
            "fs_write · net_egress · exec_tool\ngit_push · spawn_child\n\ncross the mediation boundary —\neach one can be refused.",
            fontsize=8.6, ha='center', va='top', linespacing=1.5)

    ax.text(tgt_cx, row_gap_top[1], "Σ_u — uncontrollable (3 events)", fontsize=10, weight='bold',
            ha='center', va='top', color=SEAGREEN)
    ax.text(tgt_cx, row_gap_top[1] - 0.42,
            "model_emit_token\nin_context_read · internal_plan\n\nstay inside the model — they never\nreach the daemon to refuse.",
            fontsize=8.6, ha='center', va='top', linespacing=1.5)

    draw_arrow(y2, ["5 refusable events vs 3 that never arrive", "criterion: K̄Σᵤ ∩ L̄ ⊆ K̄  (Ramadge–Wonham 1987)"])

    # ===== ROW 3: the compound-case punchline =====
    ax.text(base_cx, row_gap_top[2], "naive read: forbid the secret", fontsize=10, weight='bold',
            ha='center', va='top')
    ax.text(base_cx, row_gap_top[2] - 0.42,
            "forbid in_context_read directly →\nthat's a Σ_u event → detect-only\nforever. The daemon can never\nsee it coming to refuse it.",
            fontsize=8.6, ha='center', va='top', linespacing=1.5)

    ax.text(tgt_cx, row_gap_top[2], "regimentable rewrite: gate egress", fontsize=10, weight='bold',
            ha='center', va='top')
    ax.text(tgt_cx, row_gap_top[2] - 0.42,
            "permit the read (Σ_u), record taint,\nforbid net_egress while tainted\n(Σ_c) → regimentable. Worked case:\n\"no egress AFTER secret read.\"",
            fontsize=8.6, ha='center', va='top', linespacing=1.5)

    draw_arrow(y3, ["the clean-room design rule:", "gate the channel, never the token"])

    plt.savefig(FIGURES_DIR / 'r5_relation.png',
                dpi=150, bbox_inches='tight')
    plt.close()


def create_regime_diagram():
    """
    Create r5_regime.png - the REGIME DIAGRAM figure.
    Left panel: the nine-policy classification as a dense, color-coded
    two-column table (Policy | Verdict).
    Right panel: the compound-case flow rendered as a small directed
    state graph (secret read -> taint recorded -> egress gated), TikZ-style,
    with one edge (the uncontrollable-but-permitted read) highlighted in
    harborblue to draw the eye to the mechanism that makes it regimentable.
    """
    fig = plt.figure(figsize=(14.5, 7.6), dpi=150)
    gs = fig.add_gridspec(1, 2, width_ratios=[1.28, 1.0], wspace=0.05)
    ax1 = fig.add_subplot(gs[0, 0])
    ax2 = fig.add_subplot(gs[0, 1])

    fig.suptitle("R5 regime — the exact boundary between prevented and detected",
                 fontsize=13, weight='bold', y=0.985)

    # ---------------------------------------------------------------
    # LEFT: nine-policy classification table
    # ---------------------------------------------------------------
    ax1.set_xlim(0, 10)
    ax1.set_ylim(0, 10)
    ax1.axis('off')
    ax1.set_title("nine-policy classification", fontsize=11, weight='bold', pad=10)

    rows = [
        ("forbid fs_write", "regimentable", SEAGREEN, False),
        ("forbid net_egress", "regimentable", SEAGREEN, False),
        ("forbid exec_tool", "regimentable", SEAGREEN, False),
        ("forbid git_push", "regimentable", SEAGREEN, False),
        ("forbid spawn_child", "regimentable", SEAGREEN, False),
        ("compound: no net_egress AFTER in_context_read", "regimentable ★", SEAGREEN, True),
        ("forbid model_emit_token", "detect-only forever", SHIPRED, False),
        ("forbid in_context_read", "detect-only forever", SHIPRED, False),
        ("forbid internal_plan", "detect-only forever", SHIPRED, False),
    ]

    n = len(rows)
    top, bottom = 9.15, 0.55
    row_h = (top - bottom) / n
    col1_x0, col1_x1 = 0.15, 6.35
    col2_x0, col2_x1 = 6.45, 9.85

    # Header
    hy = top + 0.42
    ax1.text(col1_x0, hy, "policy", fontsize=9.5, weight='bold', ha='left', va='center', color='#333333')
    ax1.text(col2_x0, hy, "verdict", fontsize=9.5, weight='bold', ha='left', va='center', color='#333333')
    ax1.plot([0.15, 9.85], [top + 0.12, top + 0.12], color='#333333', linewidth=1.1)

    for i, (policy, verdict, color, highlight) in enumerate(rows):
        y0 = top - (i + 1) * row_h
        yc = y0 + row_h / 2
        alpha = 0.30 if highlight else 0.16
        lw = 2.0 if highlight else 0.9
        cell1 = FancyBboxPatch((col1_x0, y0 + row_h * 0.08), col1_x1 - col1_x0, row_h * 0.84,
                                boxstyle="round,pad=0,rounding_size=0.05",
                                edgecolor=color, facecolor=color, alpha=alpha, linewidth=lw)
        cell2 = FancyBboxPatch((col2_x0, y0 + row_h * 0.08), col2_x1 - col2_x0, row_h * 0.84,
                                boxstyle="round,pad=0,rounding_size=0.05",
                                edgecolor=color, facecolor=color, alpha=alpha + 0.10, linewidth=lw)
        ax1.add_patch(cell1)
        ax1.add_patch(cell2)
        ax1.text(col1_x0 + 0.18, yc, policy, fontsize=8.7, ha='left', va='center',
                  weight='bold' if highlight else 'normal')
        ax1.text(col2_x0 + 0.18, yc, verdict,
                  fontsize=8.7, ha='left', va='center', weight='bold', color=color)

    ax1.text(0.15, bottom - 0.42,
              "criterion: K̄Σᵤ ∩ L̄ ⊆ K̄ (Ramadge–Wonham 1987) — no uncontrollable event exits the spec",
              fontsize=8.3, ha='left', va='top', color='#444444', style='italic')

    # ---------------------------------------------------------------
    # RIGHT: compound-case flow as a small directed state graph
    # ---------------------------------------------------------------
    ax2.set_xlim(0, 10)
    ax2.set_ylim(0, 10)
    ax2.axis('off')
    ax2.set_title("compound case: how it becomes regimentable", fontsize=11, weight='bold', pad=10)

    def node(cx, cy, w, h, text, edgecolor, fc_alpha=0.14, fontsize=9.0, weight='bold'):
        box = FancyBboxPatch((cx - w / 2, cy - h / 2), w, h,
                              boxstyle="round,pad=0,rounding_size=0.16",
                              edgecolor=edgecolor, facecolor=edgecolor, alpha=fc_alpha, linewidth=2.0)
        ax2.add_patch(box)
        ax2.text(cx, cy, text, fontsize=fontsize, ha='center', va='center', weight=weight,
                  linespacing=1.35, color='#1a1a1a')
        return (cx, cy, w, h)

    def edge(n_from, n_to, label, color, rad=0.25, label_dy=0.35, lw=2.2, ls='-'):
        x0, y0, w0, h0 = n_from
        x1, y1, w1, h1 = n_to
        arr = FancyArrowPatch((x0, y0), (x1, y1),
                               arrowstyle='-|>', mutation_scale=18,
                               linewidth=lw, linestyle=ls, color=color, alpha=0.95,
                               connectionstyle=f"arc3,rad={rad}",
                               shrinkA=max(w0, h0) * 26, shrinkB=max(w1, h1) * 26)
        ax2.add_patch(arr)
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        # offset perpendicular for curved label placement
        my += label_dy
        ax2.text(mx, my, label, fontsize=8.2, ha='center', va='center', weight='bold',
                  color=color, style='italic',
                  bbox=dict(boxstyle='round,pad=0.18', facecolor='white', edgecolor='none', alpha=0.85))

    n_read = node(5.0, 8.55, 6.4, 1.35,
                  "in_context_read (Σ_u)\nuncontrollable — always PERMITTED",
                  HARBORBLUE)
    n_taint = node(5.0, 5.55, 5.4, 1.35,
                   "taint = 1\nrecorded on the ledger",
                   HARBORBLUE)
    n_egress = node(2.9, 2.4, 4.6, 1.35,
                     "net_egress (Σ_c)\ncontrollable",
                     SHIPRED)
    n_block = node(7.6, 2.4, 4.0, 1.35,
                     "GATED\nwhile taint = 1",
                     SHIPRED, fc_alpha=0.22)

    # Highlighted mechanism edge (the read that stays permitted) -- drawn in harborblue, thicker
    edge(n_read, n_taint, "records taint  (mechanism)", HARBORBLUE, rad=0.0, label_dy=0.0, lw=3.0)
    edge(n_taint, n_egress, "gates", SHIPRED, rad=0.18, label_dy=0.28)
    edge(n_egress, n_block, "refused at the boundary", SHIPRED, rad=0.0, label_dy=0.42, lw=2.2)

    ax2.text(5.0, 0.55,
              "the read is never refused — only the controllable egress it taints is.",
              fontsize=8.6, ha='center', va='center', style='italic', color='#444444')

    plt.savefig(FIGURES_DIR / 'r5_regime.png',
                dpi=150, bbox_inches='tight')
    plt.close()


if __name__ == '__main__':
    create_relation_map()
    create_regime_diagram()
    print("R5 figures created successfully.")
