type: added

- **Agent Harbor now reconciles the complete Tool2Vec skill catalog in the background.** Setup and the daemon share resumable SQLite checkpoints, an expiring single-builder lease, and a loopback-only automatic generation policy; `pd skill-graft`, Doctor, the API, and read-only MCP status expose coverage and recovery without putting catalog generation on Fleet or query hot paths.
