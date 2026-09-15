## Summary

Draw the three Book figures the Wave 11 triage still records as missing: the
issue--delegate--verify ceremony as a sequence ladder, the succession price as a
boundary in the plane the criterion is stated over, and the claim-signaling
threshold as the deviator's own payoff against the discount factor.

## Test Plan

- `tikz_precheck.py` on all three fragments — P10 through P14 all zero.
- `compile_fragment.sh --preamble book` and `--preamble chapter` — six compiles,
  zero failures.
- `figcheck.py --textwidth-cm 11.43` — `"result": "pass"` on all six PDFs.

## Visual Proof

Every figure was compiled under both preambles, rendered to PNG at 1.0× /
150 dpi (what a phone PDF viewer shows, not a generous crop), inspected by eye
at that size, and iterated on what the render actually showed. A before/after
contact sheet was built for all fifteen figures in the Book edition.

```
python3 skills/harbor-chartwork/scripts/figcheck.py <book pdf> --textwidth-cm 11.43
→ "result": "pass"  ×3   (T1–T5 and T8 clean, T6/T7 no warnings)
python3 skills/tufte-evidence-design/scripts/ink_audit.py <artwork png>
→ ladder     ink 0.2248, edges 0.0446, no flags
```

The pixel pass caught a two-line annotation whose first line was silently
clipped by `ymax`, and a `D*` whose star fell outside the axis clip and printed
as a bare `D`. Both fixed and re-rendered. The figures land on pages 8, 9 and
25 of their chapters, directly above the session each one marks.
