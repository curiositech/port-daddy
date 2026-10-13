## Summary

Draw the three Book figures the Wave 11 triage still records as missing: the
issue--delegate--verify ceremony as a sequence ladder, the succession price as a
boundary in the plane the criterion is stated over, and the claim-signaling
threshold as the deviator's own payoff against the discount factor.

## Test Plan

- `tikz_precheck.py` on all three fragments — P10 through P14 all zero.
- `compile_fragment.sh --preamble book` in three editions — six compiles,
  zero failures.
- `figcheck.py --textwidth-cm 11.43` — `"result": "pass"` on all six PDFs.

## Visual Proof

All three rendered at 1.0× / 150 dpi under the Book preamble — page scale, what
a phone PDF viewer shows:

![handshake ladder](https://raw.githubusercontent.com/curiositech/port-daddy/abc123/docs/pr-assets/fig-anchor-handshake-ladder.png)
![succession price](https://raw.githubusercontent.com/curiositech/port-daddy/abc123/docs/pr-assets/fig-he-succession-price.png)
![delta threshold](https://raw.githubusercontent.com/curiositech/port-daddy/abc123/docs/pr-assets/fig-bc-delta-threshold.png)
