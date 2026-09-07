type: fixed

- **The distress drill's step 3 no longer flakes under CI load.** `scripts/pd-distress-drill.sh` wrote each register line to the machine-wide and repo-scoped `DISTRESS` files with two separate appends, then compared the files with a single instantaneous `cmp`; on a busy CI runner that could sample mid-write and report a false divergence. The check now waits one listening interval for the files to converge, the same way the drill already waits for each entity's `COMPLIED` line.
