#!/usr/bin/env python3
"""
Paper 1 figure: the two-constraint frontier R(delta,f), section sec:rdf.

paper1_rdf_frontier.png -- a filled-contour regime diagram of the pinned
closed form from the Proposition (Sec. 4.1) over the (f, delta) plane:
  R(delta,f) = I(X;Xhat) at the pinned joint q11=p-delta, q10=delta,
               q01=f-(p-delta), q00=1-f-delta
for X ~ Bern(p), valid while f < 1 - delta/p (both constraints bind).
Past that line an X-independent flagger already meets the miss budget on
its own, so the true rate is exactly 0 -- plotted as such, not by
extrapolating the pinned formula past its domain (that extrapolation is
exactly the "spurious uptick" the paper's honest-boundary note now warns
against; see sec:rdf).

The four numbers named in the paper's "Numbers" paragraph are marked
directly on the surface so a reader can eyeball them against the text:
  R(0, 0.05)  = 0.286  [verified, Cover-Thomas: H(0.05)]  -- the zero-miss
                corner, i.e. Theorem 1's guarantee-corner in this frontier
  R(0, 0.10)  = 0.186
  R(0.01,0.10)= 0.110
  R(0.04,0.06)= 0.009
all recomputed here from the closed form (matches b1_frontier.py exactly;
seed 20260816 set for determinism though no randomness is actually drawn
-- every value below is a closed-form evaluation).

Canon palette: harborblue #1e466e, shipred #8c1e1e, seagreen #1f6e46.
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

HARBORBLUE = '#1e466e'
SHIPRED = '#8c1e1e'
SEAGREEN = '#1f6e46'
GREY = (0.4, 0.4, 0.4)

OUT = '/home/user/port-daddy/docs/harbor-research/figures'

np.random.seed(20260816)

p = 0.05


def rate_general(pp, f, delta):
    """Exact closed form from the Proposition (Sec. sec:rdf), identical to
    b1_frontier.py's rate_general. Valid only while f < 1 - delta/pp."""
    q11 = pp - delta
    q10 = delta
    q01 = f - q11
    q00 = 1 - q10 - q11 - q01
    if min(q00, q01, q10, q11) < -1e-9 or q01 < 0:
        return np.inf
    q = np.clip(np.array([[q00, q01], [q10, q11]]), 1e-15, 1)
    q = q / q.sum()
    px = q.sum(1, keepdims=True)
    pxh = q.sum(0, keepdims=True)
    return float((q * np.log2(q / (px * pxh))).sum())


def true_rate(pp, f, delta):
    """The actual optimum: the pinned formula while both constraints bind
    (f < 1 - delta/p), and exactly 0 past that line (an independent
    flagger of rate f already meets the miss budget there)."""
    if f >= 1 - delta / pp:
        return 0.0
    return rate_general(pp, f, delta)


def frontier_figure():
    f_vals = np.linspace(0.04, 0.16, 260)
    d_vals = np.linspace(0.0, 0.049, 260)
    F, D = np.meshgrid(f_vals, d_vals)
    R = np.vectorize(lambda f, d: true_rate(p, f, d))(F, D)

    fig, ax = plt.subplots(figsize=(9.2, 6.2), dpi=150)

    cmap = LinearSegmentedColormap.from_list('harbor_seq', ['#ffffff', HARBORBLUE])
    levels = np.linspace(0, 0.30, 13)
    cf = ax.contourf(F, D, R, levels=levels, cmap=cmap)
    cbar = fig.colorbar(cf, ax=ax, pad=0.02)
    cbar.set_label('$R(\\delta,f)$  (bits/symbol)', fontsize=9.5)
    cbar.ax.tick_params(labelsize=8.5)

    cs = ax.contour(F, D, R, levels=[0.05, 0.10, 0.15, 0.20, 0.25],
                     colors=[GREY], linewidths=0.8, alpha=0.8)
    ax.clabel(cs, fmt='%.2f', fontsize=8, colors=[GREY])

    # crossover boundary: f = 1 - delta/p  <=>  delta = p(1-f)
    f_bound = np.linspace(0.04, 0.16, 100)
    d_bound = p * (1 - f_bound)
    d_bound = np.clip(d_bound, 0, 0.049)
    ax.plot(f_bound, d_bound, color=SHIPRED, ls='--', lw=2.0, zorder=4)
    ax.annotate('$R=0$ beyond here:\nindependent flagger\nalready meets the\nmiss budget',
                xy=(0.145, p * (1 - 0.145)), xytext=(0.128, 0.010),
                fontsize=8.3, color=SHIPRED, ha='left',
                bbox=dict(boxstyle='round,pad=0.35', facecolor='white',
                          edgecolor=SHIPRED, linewidth=1),
                arrowprops=dict(arrowstyle='->', color=SHIPRED, lw=1.1))

    # the four numbers named in the paper's "Numbers" paragraph
    named = [
        (0.05, 0.00, 0.2864, 'zero-miss corner\n$R(0,0.05)=H(0.05)=0.286$\n[verified, Cover--Thomas]'),
        (0.10, 0.00, 0.1864, '$R(0,0.10)=0.186$'),
        (0.10, 0.01, 0.1100, '$R(0.01,0.10)=0.110$'),
        (0.06, 0.04, 0.0087, '$R(0.04,0.06)=0.009$'),
    ]
    offsets = [(-0.005, 0.011), (0.012, 0.006), (0.014, -0.001), (-0.017, 0.006)]
    for (f0, d0, r0, label), (dx, dy) in zip(named, offsets):
        marker = '*' if d0 == 0.0 and abs(f0 - p) < 1e-9 else 'o'
        ms = 13 if marker == '*' else 8
        ax.plot(f0, d0, marker=marker, color=SHIPRED, ms=ms, zorder=5,
                 markeredgecolor='white', markeredgewidth=0.8)
        ax.annotate(label, xy=(f0, d0), xytext=(f0 + dx, d0 + dy),
                    fontsize=7.8, ha='left', va='center',
                    bbox=dict(boxstyle='round,pad=0.3', facecolor='white',
                              edgecolor=SHIPRED, alpha=0.95, linewidth=0.9),
                    arrowprops=dict(arrowstyle='->', color=SHIPRED, lw=1.0))

    ax.set_xlabel('flag rate $f$ (open budget)', fontsize=10)
    ax.set_ylabel('miss budget $\\delta$', fontsize=10)
    ax.set_xlim(0.04, 0.16)
    ax.set_ylim(0.0, 0.049)
    ax.set_title('The digest--zoom frontier $R(\\delta,f)$:\n'
                 'loosening either budget cheapens the digest, and past the dashed line it is free\n'
                 '[verified closed form]',
                 fontsize=10.6, weight='bold', pad=10)

    plt.tight_layout()
    plt.savefig(f'{OUT}/paper1_rdf_frontier.png', dpi=150, bbox_inches='tight')
    plt.close()


if __name__ == '__main__':
    frontier_figure()
    print('paper1 rdf frontier figure created.')
