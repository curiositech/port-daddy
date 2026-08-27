type: fixed

- **FleetBar release artifacts now sign every bundled native Mach-O and fail closed on incomplete notarization.** `scripts/package-fleetbar.sh` discovers nested libraries inside `FleetBar.app`, signs them inside-out with Developer ID, keeps Bun JIT entitlements off ordinary `.dylib` files, deep-verifies the sealed app, and prints Apple notary logs when a submission is rejected. The essential release gate now requires valid signing/notary credentials and a signed, notarized manifest bound to the exact FleetBar archive before the update feed or Homebrew promotion can proceed.
