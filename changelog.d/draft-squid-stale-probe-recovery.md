type: fixed

- **Squid recovery status no longer gets stuck in a phantom half-open state.** Hook wrappers and FleetBar now share one five-second recovery-probe lease, reclaim expired or clock-skewed markers, show whether recovery is cooling down, ready, or actively probing, and expose the probe's actual start and expected-finish timestamps without capturing hook payloads.
