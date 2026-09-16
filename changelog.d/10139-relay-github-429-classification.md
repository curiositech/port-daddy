type: fixed

- **Ship Controls now identifies GitHub HTTP 429 responses as API throttling.** Bare 429 responses no longer appear as generic GitHub connectivity outages, while ordinary 403 permission denials remain distinct and every failed authorization still precedes telemetry reads or ship-control writes.
