type: changed

- **Claim-tree trouble now carries claim-forest provenance and graph-backed reachability.** `WATCH` only appears when the reverse-dependency graph can prove the path, and both the scan route and claim-write route now thread that proof through to the suggestion payload.
