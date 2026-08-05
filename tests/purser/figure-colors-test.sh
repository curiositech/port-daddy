#!/bin/bash
# Validate color codes in figure

grep -q 'hhsand!30' whitepaper/figures/fig-swk-continuity-organs.tex || exit 1
grep -q 'hhsanddeep' whitepaper/figures/fig-swk-continuity-organs.tex || exit 1

grep -q 'hhink' whitepaper/figures/fig-swk-continuity-organs.tex || exit 1
grep -q 'hhteal' whitepaper/figures/fig-swk-continuity-organs.tex || exit 1

echo 'Figure color validation passed'