# pd-console story-linework visual proof - 20260712-2254

Branch: `codex/pd-console-story-linework-motion`

Captured from the optimized native GPUI binary on virtual display selector `2`,
off the operator's physical screen. Settled frames were extracted after daemon
refresh and PTY output landed; they are not first-visible-window captures.

## Whole App

- Fleet, CLI closed: ![Fleet](./pane-fleet.png)
- Conjure wave plan: ![Conjure](./pane-conjure.png)
- Fleet with real `pd status` PTY: ![CLI open](./cli-open.png)
- Reduced motion: ![reduced motion](./pane-fleet-reduced-motion.png)
- 800x600 logical window: ![narrow window](./pane-fleet-narrow.png)

The frame uses the story-linework title deck, L0-L3 navigation rules, corner
ticks, square hairline panels, color-block state labels, paired micro-flags,
flat action/status rails, and text-first dry-dock/Sextant states. No anchor emoji
remains in the pd-console source or current proof.

## Motion

![sampled native frames](./motion-contact-sheet.png)

- `113` native frames, `1200x800`, `4s`, approximately `28fps`
- Daemon `connecting` resolves to confirmed fleet truth.
- PTY content arrives through the event bus without a polling spinner.
- The liveness dot is the only repeating cue in this composition.
- Reduced motion keeps status color, label, edge, and position while removing
  reveal/pulse travel.

## Video

- [proof.mp4](./proof.mp4) - web-friendly
- [proof.mov](./proof.mov) - native capture

## CLI Fallback

- [`cli-story-linework.txt`](./cli-story-linework.txt) captures `NO_COLOR=1`
  output with corner ticks, the left state rail, and paired micro-flags.
