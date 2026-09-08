# pd-console visual proof operator intervention

Capture stopped before broad capture.

Reason: No virtual display found. pd-console would open on the physical monitor.

No full-screen capture was attempted. No operator browser, terminal, or
unrelated windows were captured. The harness only targets proof-owned
pd-console windows by launched PID and exact window ID.

Recommended intervention:

1. Ensure a BetterDisplay or dummy-plug virtual display is available.
2. Grant Screen Recording permission to the terminal/app running this harness.
3. Re-run the same command. Do not switch to display-wide or full-screen capture.
