type: added

- Add signed-in repository-admin cloud ship controls with immediate saved read-back, per-ship and repository-wide Off permissions, fresh executor enforcement, and atomic decision history. Turning On permits future events rather than launching work; schema-first production deployment is required.
- Add repository and per-ship activity drawers with 14-day recorded cost graphs, model/token usage, call errors/timeouts and latency, recent run steps, and authorized transcript links. Missing cost is not shown as zero, and incomplete/clipped history is explicit. These are stored estimates, not Cloudflare invoices or live-running indicators.
