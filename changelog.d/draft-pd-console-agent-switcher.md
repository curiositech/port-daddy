type: added

- **pd-console now has a durable cross-backend Agents switcher.** The daemon exposes one fail-closed directory over every running local berth, deduplicated by stable session identity with sortable lifecycle, provider evidence, workspace, claims, notes, transcript, receipt, and location metadata. Selecting an active actor routes the shared Mission composer and Lane controls to it across console restarts; offline ledgers remain visible without cross-opening their SQLite state, and named daemon profiles now report their real berth identity.
