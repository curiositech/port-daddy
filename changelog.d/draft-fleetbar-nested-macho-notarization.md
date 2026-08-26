type: fixed

- **FleetBar release artifacts now sign every bundled native Mach-O before notarization.** `scripts/package-fleetbar.sh` discovers nested libraries inside `FleetBar.app`, signs them inside-out with Developer ID, keeps Bun JIT entitlements off ordinary `.dylib` files, deep-verifies the sealed app, and prints Apple notary logs when a submission is rejected.
