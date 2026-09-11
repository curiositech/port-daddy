type: fixed

- **CI metadata checks no longer request Fleetbot reviews.** PR Requirements has read-only authority, macOS unit tests feed `ci-gate`, and thirteen release/deployment jobs reference the operator-protected `production` environment. Roadmap validation supports offline PR files and reports snapshot freshness separately from recorded intent. These source changes do not enable disabled workflows or lift an operator shutdown.
