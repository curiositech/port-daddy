#!/usr/bin/env python3
"""
Paper 5 figures: engine substitution (R13) and the probation cliff (B6).
Produces r13_regime.png and b6_figure.png.

All curves are closed forms from the worked instances quoted in paper5.tex
(theta_H=1, theta_L=0.4, c_H=0.5, c_L=0.2; delta_h=0.95, delta_f=0.60,
G_max=20), so the figures are deterministic; the seed is set for house-rule
uniformity with the rest of the corpus.
"""

from pathlib import Path

import numpy as np
import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
plt.rcParams['font.family'] = 'serif'  # match the LaTeX body's serif face, not matplotlib's sans default

# Canon palette
harborblue = (30 / 255, 70 / 255, 110 / 255)
shipred = (140 / 255, 30 / 255, 30 / 255)
seagreen = (31 / 255, 110 / 255, 70 / 255)

np.random.seed(20260816)

OUT = Path(__file__).resolve().parents[1]

# Worked instance (R13)
theta_H, theta_L = 1.0, 0.4
c_H, c_L = 0.5, 0.2
d_theta = theta_H - theta_L          # 0.6
d_c = c_H - c_L                      # 0.3
mu_star = (c_H - theta_L) / d_theta  # 1/6


def make_r13_regime():
    """Two panels: (a) participation threshold mu*; (b) the IC flip."""
    fig, (axa, axb) = plt.subplots(1, 2, figsize=(11, 4.6), dpi=150)

    # --- Panel (a): pooled price vs committed share mu ---
    mu = np.linspace(0.0, 1.0, 200)
    price = mu * theta_H + (1 - mu) * theta_L
    axa.fill_betweenx([0.3, 1.05], 0, mu_star, color=shipred, alpha=0.08)
    axa.fill_betweenx([0.3, 1.05], mu_star, 1.0, color=seagreen, alpha=0.08)
    axa.plot(mu, price, color=harborblue, linewidth=2.5,
             label='pooled price  $\\mu\\theta_H+(1-\\mu)\\theta_L$')
    axa.axhline(c_H, color=shipred, linestyle='--', linewidth=1.8,
                label='high-engine cost  $c_H=0.5$')
    axa.axvline(mu_star, color='black', linestyle=':', linewidth=1.4)
    axa.plot([mu_star], [c_H], 'o', color='black', markersize=7, zorder=5)
    axa.text(mu_star + 0.03, 0.42, '$\\mu^\\star=1/6$', fontsize=10,
             ha='left', va='center', color='black')
    axa.text(0.085, 0.66, 'death spiral to $\\theta_L$', fontsize=9.5,
             ha='center', va='center', rotation=90, color=shipred,
             weight='bold')
    axa.text(0.62, 0.42, 'committed sellers stay', fontsize=9.5,
             ha='center', color=seagreen, weight='bold')
    axa.set_xlabel('committed high-engine share  $\\mu$', fontsize=10,
                   weight='bold')
    axa.set_ylabel('price the pool clears', fontsize=10, weight='bold')
    axa.set_xlim(0, 1)
    axa.set_ylim(0.3, 1.05)
    axa.set_title('(a) unattested: the pool must clear $c_H$',
                  fontsize=11, weight='bold')
    axa.legend(loc='upper left', fontsize=9, framealpha=0.95)
    axa.spines['top'].set_visible(False)
    axa.spines['right'].set_visible(False)
    axa.tick_params(labelsize=9)

    # --- Panel (b): swap gain, unattested vs attested ---
    dt = np.linspace(0.0, 0.8, 200)
    axb.fill_between([0, 0.8], 0, 0.45, color=shipred, alpha=0.08)
    axb.fill_between([0, 0.8], -0.65, 0, color=seagreen, alpha=0.08)
    axb.axhline(0, color='black', linewidth=1.0)
    axb.axhline(d_c, color=shipred, linewidth=2.5,
                label='unattested gain $=\\Delta c$ (any price)')
    axb.plot(dt, d_c - dt, color=seagreen, linewidth=2.5,
             label='attested gain $=\\Delta c-\\Delta\\theta$')
    axb.plot([d_c], [0.0], 'o', color='black', markersize=7, zorder=5)
    axb.text(d_c, 0.06, 'flip at $\\Delta\\theta=\\Delta c$', fontsize=9.5,
             ha='center', color='black')
    axb.plot([d_theta], [d_c - d_theta], 'o', color=seagreen,
             markersize=8, zorder=5)
    axb.annotate('worked instance: keep 0.5 vs swap 0.2',
                 xy=(d_theta, d_c - d_theta), xytext=(0.18, -0.44),
                 fontsize=9, ha='center', color=seagreen, weight='bold',
                 bbox=dict(boxstyle='round,pad=0.35', facecolor='white',
                           edgecolor=seagreen, linewidth=1),
                 arrowprops=dict(arrowstyle='->', color=seagreen, lw=1.5))
    axb.text(0.68, 0.36, 'swap pays', fontsize=9.5, ha='center',
             color=shipred, weight='bold')
    axb.text(0.55, -0.13, 'keeping the strong engine pays', fontsize=9.5,
             ha='center', color=seagreen, weight='bold')
    axb.set_xlabel('quality gap  $\\Delta\\theta$', fontsize=10,
                   weight='bold')
    axb.set_ylabel('one-period gain from swapping', fontsize=10,
                   weight='bold')
    axb.set_xlim(0, 0.8)
    axb.set_ylim(-0.65, 0.45)
    axb.set_yticks([-0.6, -0.4, -0.2, 0.0, 0.2, 0.4])
    axb.set_title('(b) attestation flips the incentive to the planner\'s rule',
                  fontsize=11, weight='bold')
    axb.legend(loc='lower right', fontsize=9, framealpha=0.95)
    axb.spines['top'].set_visible(False)
    axb.spines['right'].set_visible(False)
    axb.tick_params(labelsize=9)

    fig.suptitle('R13 regime — the engine behind the reputation '
                 '($\\theta_H{=}1$, $\\theta_L{=}0.4$, $c_H{=}0.5$, '
                 '$c_L{=}0.2$)', fontsize=12, weight='bold', y=1.02)
    plt.tight_layout()
    plt.savefig(OUT / 'r13_regime.png', dpi=150, bbox_inches='tight')
    plt.close()


def make_b6_figure():
    """Honest burden of a deterrence-tight schedule with all mass at t."""
    delta_h, delta_f, G_max, T = 0.95, 0.60, 20.0, 10
    t = np.arange(T)
    H = G_max * (delta_h / delta_f) ** t

    fig, ax = plt.subplots(figsize=(9, 5), dpi=150)
    ax.plot(t[1:], H[1:], 'o-', color=shipred, linewidth=2.2, markersize=7,
            label='gap mass held at period $t$ (deterrence held tight)')
    ax.plot([0], [H[0]], 'o', color=seagreen, markersize=11, zorder=5,
            label='the cliff: all mass at $t=0$, burden $=G_{\\max}$')
    ax.set_yscale('log')

    ax.annotate('cliff $=20.0$ — the minimum',
                xy=(0, H[0]), xytext=(1.4, 24), fontsize=10,
                color=seagreen, weight='bold',
                bbox=dict(boxstyle='round,pad=0.35', facecolor='white',
                          edgecolor=seagreen, linewidth=1),
                arrowprops=dict(arrowstyle='->', color=seagreen, lw=1.5))
    ax.annotate('$t=5$: burden $199.0$ —\nten times the cliff',
                xy=(5, H[5]), xytext=(5.7, 65), fontsize=10, color=shipred,
                weight='bold',
                bbox=dict(boxstyle='round,pad=0.35', facecolor='white',
                          edgecolor=shipred, linewidth=1),
                arrowprops=dict(arrowstyle='->', color=shipred, lw=1.5))
    ax.text(2.6, 480,
            'every step later multiplies the honest tax by '
            '$\\delta_h/\\delta_f = 1.58$\nwhile buying zero extra deterrence',
            fontsize=9.5, color='black', ha='center')

    ax.set_xlabel('period $t$ where the ceiling gap sits', fontsize=10,
                  weight='bold')
    ax.set_ylabel('honest newcomer burden  $H = '
                  'G_{\\max}(\\delta_h/\\delta_f)^t$   (log scale)',
                  fontsize=10, weight='bold')
    ax.set_title('B6 — the newcomer ramp is a cliff '
                 '($\\delta_h{=}0.95$, $\\delta_f{=}0.60$, '
                 '$G_{\\max}{=}20$)', fontsize=12, weight='bold', pad=12)
    ax.set_xticks(t)
    yticks = [20, 50, 100, 200, 500, 1000]
    ax.set_yticks(yticks)
    ax.set_yticklabels([str(v) for v in yticks])
    ax.set_ylim(15, 2000)
    ax.minorticks_off()
    ax.legend(loc='lower right', fontsize=9, framealpha=0.95)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.tick_params(labelsize=9)

    plt.tight_layout()
    plt.savefig(OUT / 'b6_figure.png', dpi=150, bbox_inches='tight')
    plt.close()


if __name__ == '__main__':
    make_r13_regime()
    make_b6_figure()
    print('Generated r13_regime.png and b6_figure.png')
