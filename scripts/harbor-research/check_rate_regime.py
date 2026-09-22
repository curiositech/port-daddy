#!/usr/bin/env python3
"""Independent source and boundary checks for the proposed rate-regime plot."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "whitepaper/figures/legible-swarm-rate-regime.tex").read_text(encoding="utf-8")

p = 0.05
panel_top = 0.4


def zero_rate_boundary(delta: float) -> float:
    return 1.0 - delta / p


def main() -> None:
    # The exact theorem boundary enters the panel at delta=.03 and is above
    # the panel for every smaller delta. These checks reject the old false
    # horizontal f=.4 interpretation directly from the domain math.
    assert zero_rate_boundary(0.03) == panel_top
    for delta in (0.0, 0.01, 0.02, 0.029):
        assert zero_rate_boundary(delta) > panel_top
        assert zero_rate_boundary(delta) != panel_top

    # The source must draw the exact boundary only on its in-frame domain.
    assert "min(1-x/0.05,0.4)" not in SOURCE
    assert "min(1-x/0.05,0.4)" not in SOURCE.replace(" ", "")
    exact_in_frame = re.search(
        r"domain=0\.03:0\.05,samples=60\]\s*\n\s*\{1-x/0\.05\}", SOURCE
    )
    assert exact_in_frame, "exact zero-rate boundary must be plotted only for delta=.03..05"
    assert "continues above" in SOURCE
    assert "axis cs:0.03,0.4) -- (axis cs:0.028,0.44)" in SOURCE
    assert "fill between" not in SOURCE
    assert "(axis cs:0.03,0.4) -- (axis cs:0.024,0.4)" not in SOURCE

    # Region fills are explicit closed polygons with no stroked fill edges.
    # Checking vertices independently of the formula catches the prior
    # mismatched-domain fillbetween artifact in rendered output.
    polygons = (
        "(axis cs:0,0.05) -- (axis cs:0,0.4) -- (axis cs:0.03,0.4) -- (axis cs:0.03,0.02) -- cycle",
        "(axis cs:0.03,0.02) -- (axis cs:0.03,0.4) -- (axis cs:0.05,0) -- cycle",
        "(axis cs:0.03,0.4) -- (axis cs:0.05,0.4) -- (axis cs:0.05,0) -- cycle",
        "(axis cs:0,0) -- (axis cs:0,0.05) -- (axis cs:0.05,0) -- cycle",
    )
    for polygon in polygons:
        assert polygon in " ".join(SOURCE.split()), polygon
    assert SOURCE.count("\\path[fill=") == 4
    assert SOURCE.count("draw=none]") == 4

    # Retained source anchors: infeasible/priced/zero labels and all three
    # worked values remain present after the boundary repair.
    for marker in ("infeasible", "R(\\delta,f)>0", "rate $=0$",
                   "H(p){=}0.2864", "R{=}0.1864", "R{=}0.0087"):
        assert marker in SOURCE, marker

    print("PASS: exact boundary enters at delta=.03; delta<.03 rejects f=.4")
    print("PASS: no clipped min(...) boundary remains")
    print("PASS: four explicit draw=none polygon vertices match theorem geometry")
    print("PASS: region labels and worked values retained")


if __name__ == "__main__":
    main()
