---
category: Fixed
---

Fleetbot now requests the GitHub App's Workflows write permission only when a governed publication adds, changes, or removes a file under `.github/workflows/`. Ordinary code publication keeps its narrower Contents and Pull Requests permissions. An installation that has not granted Workflows permission cannot mint the workflow-changing token, so publication fails before a GitHub repository mutation.
