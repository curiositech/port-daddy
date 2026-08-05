#!/bin/bash
# Validate fig-swk-continuity-organs.tex structure

grep -q '\\Built' whitepaper/figures/fig-swk-continuity-organs.tex || exit 1
grep -q '\\BuiltWeak' whitepaper/figures/fig-swk-continuity-organs.tex || exit 1

grep -q 'partial: notes' whitepaper/figures/fig-swk-continuity-organs.tex || exit 1
grep -q 'partial: commitments' whitepaper/figures/fig-swk-continuity-organs.tex || exit 1

grep -q 'hhsanddeep' whitepaper/figures/fig-swk-continuity-organs.tex || exit 1
grep -q 'hhink' whitepaper/figures/fig-swk-continuity-organs.tex || exit 1

echo 'Figure validation passed'