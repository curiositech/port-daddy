type: fixed

- **Fleetbot workflow publication now asks for Workflows write only when the change set needs it.** A governed publication that adds, changes, or removes a file under `.github/workflows/` requests that permission on its one-repository GitHub App token; ordinary code publication retains narrower Contents and Pull Requests permissions. An installation without Workflows permission fails token minting before any GitHub repository mutation.
