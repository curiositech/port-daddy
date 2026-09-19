type: fixed

- **pd-console now uses the signed-in operator account for HITL interruptions.** Interruptions and Cloud Fleet share `~/.port-daddy/account.json`, observe sign-in and token rotation without an app restart, reject malformed tokens and unsafe relay addresses, never mix partial development overrides with stored credentials, park rejected unchanged credentials, and direct signed-out or rejected operators to FleetBar Credentials without exposing environment-variable setup.
