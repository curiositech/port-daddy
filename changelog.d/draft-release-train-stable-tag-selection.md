type: fixed

- **The release train now excludes prerelease tags before picking the newest stable release.** `scripts/release-workflow-state.mjs` owns latest-stable-tag selection in tested code, so mixed tag sets like `v3.30.2` plus `v3.30.2-rc.1` no longer let git version sorting nominate the RC as the "latest stable" and strand publication before `v3.30.3`. The same slice also corrects ADR-0054’s runbook text to reflect the current `release.yml` contract: FleetBar and `latest.json` are required for Homebrew promotion, with no bypass path.
