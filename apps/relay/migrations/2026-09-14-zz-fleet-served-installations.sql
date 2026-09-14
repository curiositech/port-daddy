CREATE TABLE IF NOT EXISTS fleet_served_installations (
 installation_id INTEGER PRIMARY KEY,
 state TEXT NOT NULL CHECK(state IN ('served','retired')),
 source_ref TEXT NOT NULL CHECK(length(source_ref)>0),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 FOREIGN KEY(installation_id) REFERENCES fleet_managed_entitlements(installation_id)
);
