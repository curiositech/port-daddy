#!/usr/bin/env python3
"""
Paper 3 figure: the amortization ladder.
- paper3_amortization.png : cumulative audit spend vs. verified-history
  length t under three incentive-compatible schedules -- flat (Theta(T)),
  Model A / loss-only-if-audited (Theta(log T)), Model B / independent
  revelation (O(1)) -- with the paper's measured horizon T=200 and the
  Model-B saturation point t*=333 both marked, so the pre-saturation
  caveat (the measured 35.08 sits below the 41.67 limit because t*>T) is
  visible on the page, not just in a footnote.

Deterministic: seed 20260816, no randomness actually consumed (all curves
are closed-form / cumulative sums over the paper's running parameters).
Canon palette: harborblue #1e466e, shipred #8c1e1e, seagreen #1f6e46.
Numbers reproduce skills/harbor-results/scripts/b2_tower.py exactly.
"""

import numpy as np
import matplotlib.pyplot as plt

HARBORBLUE = '#1e466e'
SHIPRED = '#8c1e1e'
SEAGREEN = '#1f6e46'
GREY = (0.45, 0.45, 0.45)

OUT = '/home/user/port-daddy/docs/harbor-research/figures'

# running parameters, identical to b2_tower.py
G, d, B, a = 10.0, 0.8, 50.0, 1.0
v, r = 0.6, 0.05
rho_star = G / (d * B)


def amortization_figure():
    np.random.seed(20260816)

    T_measured = 200
    T_max = 420
    t = np.arange(T_max)

    rho_flat = np.full(T_max, rho_star)
    rho_A = G / (d * (B + v * t))
    rho_B = np.maximum(0.0, (G - r * v * t) / (d * B))

    spend_flat = a * np.cumsum(rho_flat)
    spend_A = a * np.cumsum(rho_A)
    spend_B = a * np.cumsum(rho_B)

    tstar = G / (r * v)               # 333.33...
    closed_B = a * G**2 / (2 * d * B * r * v)  # 41.67

    fig, ax = plt.subplots(figsize=(9.5, 5.6), dpi=150)

    ax.plot(t, spend_flat, color=SHIPRED, lw=2.2,
             label=r'flat $\rho_t\equiv\rho^\star$:  $\Theta(T)$')
    ax.plot(t, spend_A, color=HARBORBLUE, lw=2.2,
             label=r'Model A (loss only if audited):  $\Theta(\log T)$')
    ax.plot(t, spend_B, color=SEAGREEN, lw=2.2,
             label=r'Model B (independent revelation $r$):  $O(1)$')

    # closed-form O(1) asymptote for Model B
    ax.axhline(closed_B, color=SEAGREEN, ls=':', lw=1.3)
    ax.text(T_max - 4, closed_B + 1.3,
            r'$aG^2/(2dBrv)=%.2f$ (Model B limit)' % closed_B,
            fontsize=8.5, color=SEAGREEN, ha='right')

    # measured horizon T=200, marked on all three curves
    ax.axvline(T_measured, color=GREY, ls='--', lw=1.1)
    idx = T_measured
    for arr, c in ((spend_flat, SHIPRED), (spend_A, HARBORBLUE), (spend_B, SEAGREEN)):
        ax.plot(T_measured, arr[idx], 'o', color=c, ms=6, zorder=4,
                markeredgecolor='white', markeredgewidth=0.8)
    ax.text(T_measured + 6, 4, r'measured horizon $T{=}200$',
            fontsize=8.5, color=GREY, ha='left', va='bottom', rotation=90)

    # Model B saturation point t* = 333
    ax.axvline(tstar, color=SEAGREEN, ls=':', lw=1.1)
    ax.annotate(
        r'$t^\star=G/(rv)=%d$:' % round(tstar) + '\nModel B schedule hits 0,\n'
        r'spend saturates at the limit',
        xy=(tstar, closed_B), xytext=(tstar - 175, closed_B - 16),
        fontsize=8.5, color=SEAGREEN, ha='left',
        arrowprops=dict(arrowstyle='->', color=SEAGREEN, lw=1.1))

    # the pre-saturation caveat, stated on the canvas, not just below it
    ax.annotate(
        'at $T{=}200 < t^\\star{=}333$: measured spend $35.08$\nis the '
        'partial triangle, not yet the full $41.67$ limit\n'
        '-- not error, pre-saturation',
        xy=(T_measured, spend_B[idx]), xytext=(28, spend_B[idx] + 14),
        fontsize=8.5, color=SEAGREEN, ha='left',
        bbox=dict(boxstyle='round,pad=0.4', facecolor='white',
                  edgecolor=SEAGREEN, linewidth=1),
        arrowprops=dict(arrowstyle='->', color=SEAGREEN, lw=1.1))

    ax.set_xlabel('verified-history length $t$', fontsize=10)
    ax.set_ylabel('cumulative audit spend', fontsize=10)
    ax.set_xlim(0, T_max)
    ax.set_ylim(0, 62)
    ax.grid(alpha=0.25)
    ax.legend(fontsize=9, loc='upper left', framealpha=0.92)
    ax.set_title('The amortization ladder: lifetime verification spend by '
                 'schedule\n[internal, b2\\_tower.py]',
                 fontsize=11, weight='bold', pad=10)

    plt.tight_layout()
    plt.savefig(f'{OUT}/paper3_amortization.png', dpi=150,
                bbox_inches='tight')
    plt.close()


if __name__ == '__main__':
    amortization_figure()
    print('paper3 amortization figure created.')
