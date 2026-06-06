PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE services (
    id TEXT PRIMARY KEY,
    port INTEGER UNIQUE,
    pid INTEGER,
    cmd TEXT,
    cwd TEXT,
    status TEXT DEFAULT 'assigned',
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    expires_at INTEGER,
    restart_policy TEXT DEFAULT 'never',
    health_url TEXT,
    tunnel_provider TEXT,
    tunnel_url TEXT,
    paired_with TEXT,
    metadata TEXT
  );
INSERT INTO services VALUES('port-daddy:api:main',3100,51696,NULL,NULL,'assigned',1780717435586,1780717435586,NULL,'never',NULL,NULL,NULL,NULL,NULL);
INSERT INTO services VALUES('port-daddy:website:dev',3101,51711,NULL,NULL,'assigned',1780717436337,1780717436337,NULL,'never',NULL,NULL,NULL,NULL,NULL);
INSERT INTO services VALUES('port-daddy:worker:main',3102,51727,NULL,NULL,'assigned',1780717437088,1780717437088,NULL,'never',NULL,NULL,NULL,NULL,NULL);
CREATE TABLE endpoints (
    service_id TEXT NOT NULL,
    env TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (service_id, env)
  );
INSERT INTO endpoints VALUES('port-daddy:api:main','local','http://localhost:3100',1780717435586,1780717435586);
INSERT INTO endpoints VALUES('port-daddy:website:dev','local','http://localhost:3101',1780717436337,1780717436337);
INSERT INTO endpoints VALUES('port-daddy:worker:main','local','http://localhost:3102',1780717437088,1780717437088);
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    payload TEXT NOT NULL,
    sender TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER
  , content_type TEXT DEFAULT "text");
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    root TEXT NOT NULL,
    type TEXT DEFAULT 'single',
    config TEXT,
    services TEXT,
    tags TEXT,
    last_scanned INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    metadata TEXT
  );
CREATE TABLE harbors (
    name TEXT PRIMARY KEY,
    scope TEXT,
    capabilities TEXT NOT NULL DEFAULT '[]',
    channels TEXT NOT NULL DEFAULT '[]',
    agent_patterns TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    metadata TEXT
  , envelope TEXT);
CREATE TABLE harbor_members (
    harbor_name TEXT NOT NULL REFERENCES harbors(name) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    identity TEXT,
    capabilities TEXT,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (harbor_name, agent_id)
  );
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    purpose TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    phase TEXT DEFAULT 'in_progress',
    agent_id TEXT,
    worktree_id TEXT,
    identity_project TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    metadata TEXT
  , wrapped_session_key TEXT);
INSERT INTO sessions VALUES('session-implement-oauth-token-refresh-72ad2acc9d64','Implement OAuth token refresh','active','in_progress','agent-implement-oauth-token-refresh-a26efd3c','f3252159','port-daddy',1780717437939,1780717437939,NULL,'{"sessionWorktreePolicy":{"requireLinkedWorktree":true,"allowMainWorktree":true},"worktree":{"id":"f3252159","root":"/Users/erichowens/coding/tmp/db-fixtures","name":"db-fixtures","branch":"feat/recordings-db-fixtures","isMain":false}}','{"iv":"BOXd9fGcNJvgLP5e","ct":"SWGdEjYkJdkfzjA76qML7m4pt5Tv6ZFVj/xcQfX4eKM=","tag":"Lt5oPbMqntscPfjXadpsVQ==","v":2,"scope":"port-daddy:fleet","kdf":"hmac-sha256"}');
INSERT INTO sessions VALUES('session-backfill-search-index-bd524b216785','Backfill search index','active','in_progress','agent-backfill-search-index-6e733ef5','f3252159','port-daddy',1780717438787,1780717438787,NULL,'{"sessionWorktreePolicy":{"requireLinkedWorktree":true,"allowMainWorktree":true},"worktree":{"id":"f3252159","root":"/Users/erichowens/coding/tmp/db-fixtures","name":"db-fixtures","branch":"feat/recordings-db-fixtures","isMain":false}}','{"iv":"UAIr1VgyaSD4CDBm","ct":"2SRg3mkSKE+pN2AW7gApNFIUJ7kx8Gtw0ikFBK+3DTQ=","tag":"exK8kuBiP1gdqyNoKz0Fzg==","v":2,"scope":"port-daddy:fleet","kdf":"hmac-sha256"}');
CREATE TABLE session_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    start_line INTEGER,
    end_line INTEGER,
    symbol TEXT,
    symbol_path TEXT,
    claimed_at INTEGER NOT NULL,
    released_at INTEGER
  );
CREATE TABLE session_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'note',
    created_at INTEGER NOT NULL
  );
INSERT INTO session_notes VALUES(1,'session-backfill-search-index-bd524b216785','{"iv":"/GVqh4RNQ3dEl5bf","ct":"DnyC931SWXkosfCIGbJcdAw+CvzswypiuH6Q9I4xjIVbFHPoGRUQA4ZWwnbl6A==","tag":"2oFcP6CNgCXVF9RHNjrB2w==","v":1}','note',1780717439634);
INSERT INTO session_notes VALUES(2,'session-backfill-search-index-bd524b216785','{"iv":"SoEfsq95dEOkTUnl","ct":"uMUhYpAu+RTOgtJ6sviU/uin1OeEMmM2fPCg2uueNeDyCIEoTLF41ISaQECwurtZHKq+w18gXnI=","tag":"e5WG9jcGYCooKjW1zu5Rbw==","v":1}','note',1780717440487);
INSERT INTO session_notes VALUES(3,'session-backfill-search-index-bd524b216785','{"iv":"8u4sAAUepExzwr8K","ct":"Bns7KhyUrazAyezssrPFUaLaVelcOlWn3Sa3uGDFY5Wg/2MigSJEDyWV8PwIVXI=","tag":"rFwFKXk5y+9eZ42htNbjNQ==","v":1}','note',1780717441335);
CREATE TABLE graph_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    project_dir TEXT,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    edge_type TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
INSERT INTO graph_edges VALUES(1,'memory:episode:session:session-backfill-search-index-bd524b216785:note:1:note',NULL,'memory_episode','session:session-backfill-search-index-bd524b216785:note:1:note','about','semantic_term','agent-backfill-search-index-6e733ef5 note',1.0,'{"raw":"agent-backfill-search-index-6e733ef5 note","tokens":["agent-backfill-search-index-6e733ef5","note"],"fingerprint":"487ba45a0432dfbf"}',1780717439636,1780717439636);
INSERT INTO graph_edges VALUES(2,'memory:episode:session:session-backfill-search-index-bd524b216785:note:1:note',NULL,'memory_episode','session:session-backfill-search-index-bd524b216785:note:1:note','about','semantic_term','auth jose jwk library support switched',1.0,'{"raw":"Switched auth library to jose for JWKS support","tokens":["auth","jose","jwk","library","support","switched"],"fingerprint":"b96bc3323f9be862"}',1780717439636,1780717439636);
INSERT INTO graph_edges VALUES(3,'memory:episode:session:session-backfill-search-index-bd524b216785:note:1:note',NULL,'semantic_term','Switched auth library to jose for JWKS support','alias_of','semantic_term','auth jose jwk library support switched',1.0,'{"sourceType":"session","sourceId":"session-backfill-search-index-bd524b216785:note:1","episodeType":"note"}',1780717439636,1780717439636);
INSERT INTO graph_edges VALUES(4,'semantic:resolution:session:session-backfill-search-index-bd524b216785:note:1:note:auth jose jwk library support switched',NULL,'semantic_term','auth jose jwk library support switched','embedding_candidate','semantic_term','agent-backfill-search-index-6e733ef5 note',0.0356172622353171514,'{"sourceType":"session","sourceId":"session-backfill-search-index-bd524b216785:note:1:note","rawTerm":"Switched auth library to jose for JWKS support","decision":"reject","model":"Xenova/all-MiniLM-L6-v2","thresholdAuto":0.88,"thresholdReview":0.8,"topCandidates":[{"term":"agent-backfill-search-index-6e733ef5 note","similarity":0.03561726223531715}]}',1780717439924,1780717439924);
INSERT INTO graph_edges VALUES(5,'memory:episode:session:session-backfill-search-index-bd524b216785:note:2:note',NULL,'memory_episode','session:session-backfill-search-index-bd524b216785:note:2:note','about','semantic_term','agent-backfill-search-index-6e733ef5 note',1.0,'{"raw":"agent-backfill-search-index-6e733ef5 note","tokens":["agent-backfill-search-index-6e733ef5","note"],"fingerprint":"487ba45a0432dfbf"}',1780717440488,1780717440488);
INSERT INTO graph_edges VALUES(6,'memory:episode:session:session-backfill-search-index-bd524b216785:note:2:note',NULL,'memory_episode','session:session-backfill-search-index-bd524b216785:note:2:note','about','semantic_term','0042 added applied db migration refresh_token table',1.0,'{"raw":"DB migration 0042 applied — added refresh_tokens table","tokens":["0042","added","applied","db","migration","refresh_token","table"],"fingerprint":"9f7f04fa0bd54316"}',1780717440488,1780717440488);
INSERT INTO graph_edges VALUES(7,'memory:episode:session:session-backfill-search-index-bd524b216785:note:2:note',NULL,'semantic_term','DB migration 0042 applied — added refresh_tokens table','alias_of','semantic_term','0042 added applied db migration refresh_token table',1.0,'{"sourceType":"session","sourceId":"session-backfill-search-index-bd524b216785:note:2","episodeType":"note"}',1780717440488,1780717440488);
INSERT INTO graph_edges VALUES(8,'semantic:resolution:session:session-backfill-search-index-bd524b216785:note:2:note:agent-backfill-search-index-6e733ef5 note',NULL,'semantic_term','agent-backfill-search-index-6e733ef5 note','embedding_candidate','semantic_term','auth jose jwk library support switched',0.0356172622353171514,'{"sourceType":"session","sourceId":"session-backfill-search-index-bd524b216785:note:2:note","rawTerm":"agent-backfill-search-index-6e733ef5 note","decision":"reject","model":"Xenova/all-MiniLM-L6-v2","thresholdAuto":0.88,"thresholdReview":0.8,"topCandidates":[{"term":"auth jose jwk library support switched","similarity":0.03561726223531715}]}',1780717440488,1780717440488);
INSERT INTO graph_edges VALUES(9,'semantic:resolution:session:session-backfill-search-index-bd524b216785:note:2:note:0042 added applied db migration refresh_token table',NULL,'semantic_term','0042 added applied db migration refresh_token table','embedding_candidate','semantic_term','auth jose jwk library support switched',0.1954857221345956408,'{"sourceType":"session","sourceId":"session-backfill-search-index-bd524b216785:note:2:note","rawTerm":"DB migration 0042 applied — added refresh_tokens table","decision":"reject","model":"Xenova/all-MiniLM-L6-v2","thresholdAuto":0.88,"thresholdReview":0.8,"topCandidates":[{"term":"auth jose jwk library support switched","similarity":0.19548572213459564},{"term":"agent-backfill-search-index-6e733ef5 note","similarity":0.09678638081393517}]}',1780717440491,1780717440491);
INSERT INTO graph_edges VALUES(10,'memory:episode:session:session-backfill-search-index-bd524b216785:note:3:note',NULL,'memory_episode','session:session-backfill-search-index-bd524b216785:note:3:note','about','semantic_term','agent-backfill-search-index-6e733ef5 note',1.0,'{"raw":"agent-backfill-search-index-6e733ef5 note","tokens":["agent-backfill-search-index-6e733ef5","note"],"fingerprint":"487ba45a0432dfbf"}',1780717441336,1780717441336);
INSERT INTO graph_edges VALUES(11,'memory:episode:session:session-backfill-search-index-bd524b216785:note:3:note',NULL,'memory_episode','session:session-backfill-search-index-bd524b216785:note:3:note','about','semantic_term','412 checkpoint indexer page resumed search',1.0,'{"raw":"Search indexer resumed from checkpoint page 412","tokens":["412","checkpoint","indexer","page","resumed","search"],"fingerprint":"ba2103d2b7a42dae"}',1780717441336,1780717441336);
INSERT INTO graph_edges VALUES(12,'memory:episode:session:session-backfill-search-index-bd524b216785:note:3:note',NULL,'semantic_term','Search indexer resumed from checkpoint page 412','alias_of','semantic_term','412 checkpoint indexer page resumed search',1.0,'{"sourceType":"session","sourceId":"session-backfill-search-index-bd524b216785:note:3","episodeType":"note"}',1780717441336,1780717441336);
INSERT INTO graph_edges VALUES(13,'semantic:resolution:session:session-backfill-search-index-bd524b216785:note:3:note:agent-backfill-search-index-6e733ef5 note',NULL,'semantic_term','agent-backfill-search-index-6e733ef5 note','embedding_candidate','semantic_term','0042 added applied db migration refresh_token table',0.0967863808139351745,'{"sourceType":"session","sourceId":"session-backfill-search-index-bd524b216785:note:3:note","rawTerm":"agent-backfill-search-index-6e733ef5 note","decision":"reject","model":"Xenova/all-MiniLM-L6-v2","thresholdAuto":0.88,"thresholdReview":0.8,"topCandidates":[{"term":"0042 added applied db migration refresh_token table","similarity":0.09678638081393517},{"term":"auth jose jwk library support switched","similarity":0.03561726223531715}]}',1780717441337,1780717441337);
INSERT INTO graph_edges VALUES(14,'semantic:resolution:session:session-backfill-search-index-bd524b216785:note:3:note:412 checkpoint indexer page resumed search',NULL,'semantic_term','412 checkpoint indexer page resumed search','embedding_candidate','semantic_term','agent-backfill-search-index-6e733ef5 note',0.3892725933287564111,'{"sourceType":"session","sourceId":"session-backfill-search-index-bd524b216785:note:3:note","rawTerm":"Search indexer resumed from checkpoint page 412","decision":"reject","model":"Xenova/all-MiniLM-L6-v2","thresholdAuto":0.88,"thresholdReview":0.8,"topCandidates":[{"term":"agent-backfill-search-index-6e733ef5 note","similarity":0.3892725933287564},{"term":"0042 added applied db migration refresh_token table","similarity":0.2596268701181801},{"term":"auth jose jwk library support switched","similarity":-0.010593484027947419}]}',1780717441339,1780717441339);
CREATE TABLE roadmap_items (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    summary_md TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'backlog'
      CHECK(status IN ('now','backlog','parked','merge','done')),
    promoted_from_feedback_id TEXT,
    promoted_by_agent_id TEXT,
    promoted_at INTEGER,
    last_touched_at INTEGER NOT NULL,
    dependencies_json TEXT NOT NULL DEFAULT '[]',
    notes_json TEXT NOT NULL DEFAULT '[]',
    harbor TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(slug, harbor)
  );
CREATE TABLE roadmap_item_status_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    status TEXT NOT NULL
      CHECK(status IN ('now','backlog','parked','merge','done')),
    by_agent_id TEXT,
    at INTEGER NOT NULL,
    harbor TEXT NOT NULL
  );
CREATE TABLE symbols (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    symbol_name TEXT NOT NULL,
    symbol_type TEXT NOT NULL,
    symbol_path TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    parent_symbol TEXT,
    signature TEXT,
    body_hash TEXT,
    exported INTEGER DEFAULT 0,
    parsed_at INTEGER NOT NULL
  );
CREATE TABLE symbol_dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_file TEXT NOT NULL,
    source_symbol TEXT,
    target_file TEXT NOT NULL,
    target_symbol TEXT,
    dependency_type TEXT NOT NULL,
    parsed_at INTEGER NOT NULL
  );
CREATE TABLE parsed_files (
    file_path TEXT PRIMARY KEY,
    file_hash TEXT NOT NULL,
    symbol_count INTEGER,
    dependency_count INTEGER,
    language TEXT,
    parsed_at INTEGER NOT NULL
  );
CREATE TABLE tuples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      harbor TEXT,
      fields TEXT NOT NULL,
      written_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      expires_at INTEGER
    );
INSERT INTO tuples VALUES(1,'port-daddy','["memory:episode",null,"port-daddy","note","session","session-backfill-search-index-bd524b216785:note:1","agent-backfill-search-index-6e733ef5 note","Switched auth library to jose for JWKS support",["agent-backfill-search-index-6e733ef5 note","auth jose jwk library support switched"],{"sessionId":"session-backfill-search-index-bd524b216785","noteType":"note"}]','agent-backfill-search-index-6e733ef5',1780717439635,1783309439635);
INSERT INTO tuples VALUES(2,'port-daddy','["semantic:alias","memory","agent-backfill-search-index-6e733ef5 note","agent-backfill-search-index-6e733ef5 note",{"fingerprint":"487ba45a0432dfbf","tokens":["agent-backfill-search-index-6e733ef5","note"],"sourceType":"session","sourceId":"session-backfill-search-index-bd524b216785:note:1","episodeType":"note"}]','agent-backfill-search-index-6e733ef5',1780717439635,1783309439635);
INSERT INTO tuples VALUES(3,'port-daddy','["semantic:alias","memory","Switched auth library to jose for JWKS support","auth jose jwk library support switched",{"fingerprint":"b96bc3323f9be862","tokens":["auth","jose","jwk","library","support","switched"],"sourceType":"session","sourceId":"session-backfill-search-index-bd524b216785:note:1","episodeType":"note"}]','agent-backfill-search-index-6e733ef5',1780717439635,1783309439635);
INSERT INTO tuples VALUES(4,NULL,'["semantic:resolution","seeded","agent-backfill-search-index-6e733ef5 note",null,null,{"sourceType":"session","sourceId":"session-backfill-search-index-bd524b216785:note:1:note","rawTerm":"agent-backfill-search-index-6e733ef5 note","thresholds":{"auto":0.88,"review":0.8,"margin":0.02},"model":"Xenova/all-MiniLM-L6-v2","candidates":[]}]','agent-backfill-search-index-6e733ef5',1780717439917,1783309439917);
INSERT INTO tuples VALUES(5,NULL,'["semantic:resolution","reject","auth jose jwk library support switched","agent-backfill-search-index-6e733ef5 note",0.03561726223531715,{"sourceType":"session","sourceId":"session-backfill-search-index-bd524b216785:note:1:note","rawTerm":"Switched auth library to jose for JWKS support","thresholds":{"auto":0.88,"review":0.8,"margin":0.02},"model":"Xenova/all-MiniLM-L6-v2","candidates":[{"term":"agent-backfill-search-index-6e733ef5 note","similarity":0.03561726223531715}]}]','agent-backfill-search-index-6e733ef5',1780717439924,1783309439924);
INSERT INTO tuples VALUES(6,'port-daddy','["memory:episode",null,"port-daddy","note","session","session-backfill-search-index-bd524b216785:note:2","agent-backfill-search-index-6e733ef5 note","DB migration 0042 applied — added refresh_tokens table",["agent-backfill-search-index-6e733ef5 note","0042 added applied db migration refresh_token table"],{"sessionId":"session-backfill-search-index-bd524b216785","noteType":"note"}]','agent-backfill-search-index-6e733ef5',1780717440488,1783309440488);
INSERT INTO tuples VALUES(7,'port-daddy','["semantic:alias","memory","agent-backfill-search-index-6e733ef5 note","agent-backfill-search-index-6e733ef5 note",{"fingerprint":"487ba45a0432dfbf","tokens":["agent-backfill-search-index-6e733ef5","note"],"sourceType":"session","sourceId":"session-backfill-search-index-bd524b216785:note:2","episodeType":"note"}]','agent-backfill-search-index-6e733ef5',1780717440488,1783309440488);
INSERT INTO tuples VALUES(8,'port-daddy','["semantic:alias","memory","DB migration 0042 applied — added refresh_tokens table","0042 added applied db migration refresh_token table",{"fingerprint":"9f7f04fa0bd54316","tokens":["0042","added","applied","db","migration","refresh_token","table"],"sourceType":"session","sourceId":"session-backfill-search-index-bd524b216785:note:2","episodeType":"note"}]','agent-backfill-search-index-6e733ef5',1780717440488,1783309440488);
INSERT INTO tuples VALUES(9,NULL,'["semantic:resolution","reject","agent-backfill-search-index-6e733ef5 note","auth jose jwk library support switched",0.03561726223531715,{"sourceType":"session","sourceId":"session-backfill-search-index-bd524b216785:note:2:note","rawTerm":"agent-backfill-search-index-6e733ef5 note","thresholds":{"auto":0.88,"review":0.8,"margin":0.02},"model":"Xenova/all-MiniLM-L6-v2","candidates":[{"term":"auth jose jwk library support switched","similarity":0.03561726223531715}]}]','agent-backfill-search-index-6e733ef5',1780717440488,1783309440488);
INSERT INTO tuples VALUES(10,NULL,'["semantic:resolution","reject","0042 added applied db migration refresh_token table","auth jose jwk library support switched",0.19548572213459564,{"sourceType":"session","sourceId":"session-backfill-search-index-bd524b216785:note:2:note","rawTerm":"DB migration 0042 applied — added refresh_tokens table","thresholds":{"auto":0.88,"review":0.8,"margin":0.02},"model":"Xenova/all-MiniLM-L6-v2","candidates":[{"term":"auth jose jwk library support switched","similarity":0.19548572213459564},{"term":"agent-backfill-search-index-6e733ef5 note","similarity":0.09678638081393517}]}]','agent-backfill-search-index-6e733ef5',1780717440491,1783309440491);
INSERT INTO tuples VALUES(11,'port-daddy','["memory:episode",null,"port-daddy","note","session","session-backfill-search-index-bd524b216785:note:3","agent-backfill-search-index-6e733ef5 note","Search indexer resumed from checkpoint page 412",["agent-backfill-search-index-6e733ef5 note","412 checkpoint indexer page resumed search"],{"sessionId":"session-backfill-search-index-bd524b216785","noteType":"note"}]','agent-backfill-search-index-6e733ef5',1780717441336,1783309441336);
INSERT INTO tuples VALUES(12,'port-daddy','["semantic:alias","memory","agent-backfill-search-index-6e733ef5 note","agent-backfill-search-index-6e733ef5 note",{"fingerprint":"487ba45a0432dfbf","tokens":["agent-backfill-search-index-6e733ef5","note"],"sourceType":"session","sourceId":"session-backfill-search-index-bd524b216785:note:3","episodeType":"note"}]','agent-backfill-search-index-6e733ef5',1780717441336,1783309441336);
INSERT INTO tuples VALUES(13,'port-daddy','["semantic:alias","memory","Search indexer resumed from checkpoint page 412","412 checkpoint indexer page resumed search",{"fingerprint":"ba2103d2b7a42dae","tokens":["412","checkpoint","indexer","page","resumed","search"],"sourceType":"session","sourceId":"session-backfill-search-index-bd524b216785:note:3","episodeType":"note"}]','agent-backfill-search-index-6e733ef5',1780717441336,1783309441336);
INSERT INTO tuples VALUES(14,NULL,'["semantic:resolution","reject","agent-backfill-search-index-6e733ef5 note","0042 added applied db migration refresh_token table",0.09678638081393517,{"sourceType":"session","sourceId":"session-backfill-search-index-bd524b216785:note:3:note","rawTerm":"agent-backfill-search-index-6e733ef5 note","thresholds":{"auto":0.88,"review":0.8,"margin":0.02},"model":"Xenova/all-MiniLM-L6-v2","candidates":[{"term":"0042 added applied db migration refresh_token table","similarity":0.09678638081393517},{"term":"auth jose jwk library support switched","similarity":0.03561726223531715}]}]','agent-backfill-search-index-6e733ef5',1780717441336,1783309441336);
INSERT INTO tuples VALUES(15,NULL,'["semantic:resolution","reject","412 checkpoint indexer page resumed search","agent-backfill-search-index-6e733ef5 note",0.3892725933287564,{"sourceType":"session","sourceId":"session-backfill-search-index-bd524b216785:note:3:note","rawTerm":"Search indexer resumed from checkpoint page 412","thresholds":{"auto":0.88,"review":0.8,"margin":0.02},"model":"Xenova/all-MiniLM-L6-v2","candidates":[{"term":"agent-backfill-search-index-6e733ef5 note","similarity":0.3892725933287564},{"term":"0042 added applied db migration refresh_token table","similarity":0.2596268701181801},{"term":"auth jose jwk library support switched","similarity":-0.010593484027947419}]}]','agent-backfill-search-index-6e733ef5',1780717441339,1783309441339);
CREATE TABLE metric_counters (
      key          TEXT    NOT NULL,
      dims_json    TEXT    NOT NULL DEFAULT '{}',
      bucket_minute INTEGER NOT NULL,
      bucket_hour   INTEGER NOT NULL,
      value         INTEGER NOT NULL DEFAULT 0,
      updated_at    INTEGER NOT NULL,
      PRIMARY KEY (key, dims_json, bucket_minute)
    );
INSERT INTO metric_counters VALUES('http.requests','{"method":"GET","route":"/health","status":"2xx"}',1780717380000,1780714800000,1,1780717444771);
INSERT INTO metric_counters VALUES('http.requests','{"method":"POST","route":"/claim","status":"2xx"}',1780717380000,1780714800000,3,1780717444771);
INSERT INTO metric_counters VALUES('http.requests','{"method":"POST","route":"/usage/trace","status":"2xx"}',1780717380000,1780714800000,6,1780717444771);
INSERT INTO metric_counters VALUES('http.requests','{"method":"POST","route":"/sugar/begin","status":"2xx"}',1780717380000,1780714800000,2,1780717444771);
INSERT INTO metric_counters VALUES('http.requests','{"method":"GET","route":"/sugar/whoami","status":"2xx"}',1780717380000,1780714800000,1,1780717444771);
INSERT INTO metric_counters VALUES('semantic.embedding.cache_miss','{"model":"Xenova/all-MiniLM-L6-v2"}',1780717380000,1780714800000,2,1780717444771);
INSERT INTO metric_counters VALUES('http.requests','{"method":"POST","route":"/notes","status":"2xx"}',1780717380000,1780714800000,1,1780717444771);
INSERT INTO metric_counters VALUES('semantic.resolution.events','{"band":"none","decision":"seeded","model":"Xenova/all-MiniLM-L6-v2","sourceType":"session"}',1780717380000,1780714800000,1,1780717444771);
INSERT INTO metric_counters VALUES('semantic.resolution.seeded','{"model":"Xenova/all-MiniLM-L6-v2","sourceType":"session"}',1780717380000,1780714800000,1,1780717444771);
INSERT INTO metric_counters VALUES('semantic.resolution.events','{"band":"<0.70","decision":"reject","model":"Xenova/all-MiniLM-L6-v2","sourceType":"session"}',1780717380000,1780714800000,1,1780717444771);
INSERT INTO metric_counters VALUES('semantic.resolution.reject','{"model":"Xenova/all-MiniLM-L6-v2","sourceType":"session"}',1780717380000,1780714800000,1,1780717444771);
INSERT INTO metric_counters VALUES('http.requests','{"method":"GET","route":"/sugar/whoami","status":"2xx"}',1780717440000,1780714800000,2,1780717444771);
INSERT INTO metric_counters VALUES('semantic.embedding.cache_hit','{"model":"Xenova/all-MiniLM-L6-v2"}',1780717440000,1780714800000,2,1780717444771);
INSERT INTO metric_counters VALUES('semantic.resolution.events','{"band":"<0.70","decision":"reject","model":"Xenova/all-MiniLM-L6-v2","sourceType":"session"}',1780717440000,1780714800000,4,1780717444771);
INSERT INTO metric_counters VALUES('semantic.resolution.reject','{"model":"Xenova/all-MiniLM-L6-v2","sourceType":"session"}',1780717440000,1780714800000,4,1780717444771);
INSERT INTO metric_counters VALUES('semantic.embedding.cache_miss','{"model":"Xenova/all-MiniLM-L6-v2"}',1780717440000,1780714800000,2,1780717444771);
INSERT INTO metric_counters VALUES('http.requests','{"method":"POST","route":"/notes","status":"2xx"}',1780717440000,1780714800000,2,1780717444771);
INSERT INTO metric_counters VALUES('http.requests','{"method":"POST","route":"/usage/trace","status":"2xx"}',1780717440000,1780714800000,5,1780717444771);
INSERT INTO metric_counters VALUES('http.requests','{"method":"POST","route":"/channels/ensure","status":"2xx"}',1780717440000,1780714800000,2,1780717444771);
INSERT INTO metric_counters VALUES('http.requests','{"method":"DELETE","route":"/agents/:id/inbox","status":"2xx"}',1780717440000,1780714800000,1,1780717444771);
CREATE TABLE semantic_terms (
      term TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector_json TEXT NOT NULL,
      fingerprint TEXT,
      tokens_json TEXT,
      first_project_dir TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (term, model)
    );
INSERT INTO semantic_terms VALUES('agent-backfill-search-index-6e733ef5 note','Xenova/all-MiniLM-L6-v2',384,'[-0.02583659440279007,0.03945539519190788,-0.0776435062289238,0.03591667488217354,-0.009991205297410488,0.07111687958240509,0.0013483421644195914,-0.043641164898872375,-0.01801305264234543,-0.022611942142248154,-0.004246302414685488,0.043721456080675125,0.03437276557087898,-0.09553281962871552,-0.06229211762547493,0.005452720448374748,-0.059210848063230515,0.04842175170779228,-0.026149338111281395,-0.002601811196655035,0.009727036580443382,0.08226287364959717,0.009805135428905487,-0.05384454503655434,-0.0599307082593441,0.038150154054164886,-0.01408974640071392,-0.0749947652220726,-0.03184538334608078,-0.027872607111930847,-0.020691920071840286,0.0523141510784626,0.03482966125011444,0.09173354506492615,0.09679565578699112,0.08777827769517899,-0.12278959155082703,-0.005171251483261585,0.03709210455417633,0.04055339843034744,0.03156520053744316,-0.019146209582686424,0.008549449034035206,0.017565136775374413,-0.06210221350193024,-0.017376279458403587,-0.0456501729786396,-0.005910139996558428,0.09164118766784668,-0.02224261686205864,-0.04685646668076515,0.03469766303896904,-0.06745132803916931,0.02087242528796196,0.0055890013463795185,0.02026556245982647,-0.034744955599308014,-0.011685963720083237,-0.01958824321627617,-0.06101017817854881,0.1448979675769806,-0.022013317793607712,-0.016356786713004112,-0.06161804124712944,-0.01181954424828291,-0.03139989450573921,-0.07967358827590942,-0.08718603849411011,-0.006324702873826027,-0.10040818154811859,0.05813871696591377,0.04020567610859871,0.0042793345637619495,-0.03515128046274185,0.03580524027347565,0.029424702748656273,-0.04080478101968765,0.038774777203798294,0.019922219216823578,-0.025995628908276558,0.007902289740741253,-0.0972435250878334,0.03635549545288086,0.08916635811328888,-0.04106992855668068,-0.031210850924253464,0.007931129075586796,-0.08859197050333023,0.06819901615381241,-0.042467888444662094,0.0910182073712349,-0.061718497425317764,-0.008527171798050404,0.019686033949255943,-0.006051916629076004,0.11095480620861053,-0.0501759871840477,0.008315838873386383,-0.019734302535653114,0.03395361825823784,-0.027437590062618256,0.010861823335289955,0.05542014166712761,0.10691932588815689,0.029088610783219337,0.00983112771064043,0.0448988676071167,0.02206668071448803,0.03250659257173538,-0.04814094305038452,-0.05958240479230881,-0.020943116396665573,0.07263321429491043,0.05636729672551155,0.09289183467626572,-0.038246262818574905,0.017208049073815346,0.026941539719700813,0.037244025617837906,-0.0050592077895998955,0.0816890299320221,0.052700407803058624,-0.12465525418519974,-0.03226521983742714,0.05676393583416939,0.010410163551568985,-0.00982492696493864,8.673327211179669e-34,0.011972613632678986,0.07867632806301117,0.03329477459192276,0.034940533339977264,-0.016596589237451553,-0.009027088060975075,0.02084922231733799,-0.035205259919166565,-0.03548748046159744,0.06337783485651016,-0.035352256149053574,-0.014011465013027191,-0.03713347762823105,0.005752639379352331,-0.07817042618989944,-0.08694779872894287,0.024290088564157486,0.10727804899215698,0.00948574859648943,-0.03651905059814453,0.057843443006277084,0.024511899799108505,0.052021998912096024,-0.042996205389499664,-0.0030345346312969923,0.06275692582130432,-0.0435592383146286,-0.10983273386955261,0.055810023099184036,-0.0004008643445558846,0.037250325083732605,0.05663789063692093,0.012612810358405113,-0.048061057925224304,-0.06295204907655716,0.05405653640627861,-0.07070739567279816,0.041476234793663025,-0.06028874218463898,-0.02027527242898941,0.007964114658534527,0.035260945558547974,-0.008257168345153332,-0.059821732342243195,0.01734262891113758,-0.08254234492778778,-0.019835302606225014,0.0077485209330916405,0.0928247794508934,0.05648448318243027,-0.05643259733915329,0.03099978342652321,-0.032034553587436676,-0.01022257562726736,0.026072613894939423,-0.018103010952472687,0.043618496507406235,0.09953116625547409,-0.04647441208362579,0.004903625231236219,0.0613878034055233,-0.017395587638020515,-0.017965611070394516,0.03225138783454895,0.009335587732493877,-0.06785967200994492,0.049361396580934525,0.055554453283548355,0.0005455508944578469,0.05062936246395111,-0.009942233562469482,0.001082584960386157,0.03936871513724327,-0.006233435124158859,-0.03131735697388649,-0.1333770602941513,-0.03505197912454605,-0.058472178876399994,0.01857387274503708,-0.11866194009780884,-0.06551907956600189,-0.05206921696662903,-0.020535148680210114,-0.005805256776511669,0.07975123077630997,0.019127925857901573,-0.05351535975933075,-0.0726991519331932,0.08015201985836029,0.01583358459174633,-0.05236672982573509,-0.0035872680600732565,-0.09982628375291824,-0.05027851089835167,-0.07193349301815033,-1.6945450853584e-33,-0.023231279104948044,-0.1307457536458969,-0.03358229994773865,-0.004271244630217552,-0.003678243374451995,-0.005558926146477461,0.0475570410490036,0.03523573651909828,0.04552772268652916,0.06548675894737244,0.03349268436431885,0.044745780527591705,0.053520314395427704,-0.055165715515613556,-0.030058367177844048,0.09577329456806183,-0.01452647801488638,-0.0023907292634248734,0.010777890682220459,-0.03815126046538353,-0.04196092486381531,-0.007099284790456295,-0.06485999375581741,0.09237512201070786,-0.04253691807389259,-0.030138177797198296,0.08888448029756546,0.0666118860244751,0.07805141806602478,-0.05220431461930275,0.04369514808058739,-0.06325795501470566,-0.049048833549022675,0.10929654538631439,-0.06051311269402504,0.03743702918291092,-0.04136251285672188,0.06283494085073471,-0.03754961118102074,0.0744946077466011,0.024045713245868683,-0.003487069858238101,-0.011719859205186367,-0.008041362278163433,-0.01578643172979355,-0.04429611563682556,-0.01988632045686245,0.042812198400497437,0.06718132644891739,-0.01734067127108574,0.032397862523794174,-0.0362674705684185,0.030954627320170403,-0.048479191958904266,-0.08158297836780548,0.06639587134122849,0.053373295813798904,0.06754039227962494,-0.07480534166097641,0.017500413581728935,-0.010521940886974335,0.07561688870191574,-0.0011270149843767285,-0.007611169945448637,0.007955454289913177,0.007522895000874996,-0.06829331815242767,-0.005892664659768343,0.006265394855290651,-0.08272527158260345,0.017490094527602196,-0.02625911869108677,-0.01579107716679573,0.046020179986953735,0.09137257933616638,0.0035043214447796345,-0.016031324863433838,0.0064270636066794395,0.06385692209005356,0.005503302440047264,-0.03137894719839096,0.08365744352340698,-0.02368907816708088,0.01926259510219097,-0.010883898474276066,0.01270383968949318,0.0175507552921772,0.14707688987255096,-0.06835361570119858,0.04126964509487152,0.026470251381397247,-0.03295169770717621,0.020863031968474388,-0.0033266593236476183,0.010605803690850735,-1.9435161036085447e-8,-0.035693030804395676,0.036782898008823395,0.011934833601117134,-0.018344972282648087,0.04545344039797783,-0.031553108245134354,0.04385652765631676,0.029964497312903404,-0.06231647729873657,-0.09001972526311874,0.031695690006017685,-0.028891557827591896,-0.01891731657087803,0.03864959999918938,0.032820168882608414,-0.08052518218755722,-0.044649653136730194,-0.06272591650485992,-0.021483633667230606,-0.07570035755634308,-0.021356860175728798,-0.020734110847115517,-0.009918279945850372,-0.00907522439956665,0.08427548408508301,0.0225695688277483,-0.06398208439350128,0.03369864448904991,-0.034027282148599625,0.09697683155536652,0.076970174908638,0.024515319615602493,0.02457576058804989,-0.0511920191347599,-0.005531379021704197,0.05026751756668091,0.05727086961269379,-0.11510275304317474,-0.05773848667740822,0.003444322617724538,0.0792846754193306,0.03719070181250572,0.03600890934467316,-0.07135248184204102,-0.025444287806749344,-0.01775362901389599,0.011317897588014603,0.007962443865835667,0.10235128551721573,-0.08892839401960373,-0.08286378532648087,-0.08385668694972992,-0.010011919774115086,0.0032718214206397533,0.05610562860965729,-0.0027897984255105257,0.027439717203378677,-0.001017380622215569,0.07882518321275711,0.04442034289240837,0.002246138174086809,0.019604315981268883,-0.017224987968802452,-0.01629047282040119]','487ba45a0432dfbf','["agent-backfill-search-index-6e733ef5","note"]',NULL,1780717439916,1780717439916);
INSERT INTO semantic_terms VALUES('auth jose jwk library support switched','Xenova/all-MiniLM-L6-v2',384,'[-0.13156215846538544,-0.02832850068807602,-0.08486859500408173,-0.07344590127468109,0.01895340532064438,-0.010769574902951717,-0.013171058148145676,0.006797431502491236,-0.00934291910380125,-0.013997487723827362,-0.013081241399049759,0.008486376143991947,0.026862315833568573,-0.053544092923402786,0.08844961225986481,0.07887301594018936,-0.02159055508673191,0.11039158701896667,0.013958664610981941,-0.04680713266134262,-0.0865933895111084,-0.023707523941993713,-0.02877487614750862,-0.041186343878507614,0.058083802461624146,-0.08821539580821991,0.05237600952386856,0.043868619948625565,-0.06877608597278595,0.03341953456401825,-0.0005123174632899463,-0.07505182921886444,-0.032475296407938004,0.0044971974566578865,-0.06529220193624496,0.11440393328666687,0.01562575437128544,-0.007506708148866892,0.04638112336397171,-0.04154913127422333,-0.01805453933775425,0.02800358645617962,-0.0021431075874716043,-0.023896850645542145,-0.0931730717420578,0.019306158646941185,-0.03968290984630585,-0.0550837442278862,-0.0355672687292099,0.04852338507771492,0.00420764135196805,-0.026203671470284462,0.019039129838347435,-0.029584532603621483,-0.03593195974826813,0.018775923177599907,-0.06197609007358551,0.08602755516767502,0.07309025526046753,0.005685777403414249,0.0225954819470644,0.044107913970947266,-0.02190278097987175,0.035331226885318756,-0.004745798651129007,-0.01313515193760395,-0.005528831854462624,-0.022355668246746063,0.05799512192606926,-0.029865562915802002,-0.08069959282875061,0.0005292459391057491,0.011591363698244095,-0.03609343618154526,0.004074473865330219,0.0034876603167504072,-0.02618374116718769,0.014827565290033817,0.10112042725086212,-0.10023985058069229,0.03893473744392395,-0.0017922119004651904,-0.03444782644510269,0.06087392941117287,-0.0048827617429196835,0.004904722794890404,-0.10232337564229965,0.0916852205991745,-0.026494808495044708,0.07666733860969543,0.15614911913871765,0.039684802293777466,0.07492485642433167,-0.034028321504592896,-0.05287504196166992,-0.059390630573034286,0.02055751159787178,0.0549190379679203,0.01298369187861681,0.07965452969074249,-0.07390230894088745,0.09252195060253143,0.037248749285936356,0.006447059568017721,0.06154559925198555,-0.1254727989435196,0.0027940364088863134,0.05490076541900635,0.017284516245126724,0.0036515260580927134,0.05468440055847168,-0.013156900182366371,-0.012907683849334717,-0.04478742927312851,-0.0104074040427804,0.03568604588508606,0.013772556558251381,-0.028599174693226814,-0.008482979610562325,0.004686119966208935,-0.03341526538133621,0.05156434327363968,0.03840208426117897,-0.05995183810591698,0.024005470797419548,0.027520133182406425,-0.05767173692584038,2.7555115725930488e-33,-0.010027364827692509,0.08260535448789597,0.06036660447716713,-0.04235709831118584,-0.05525496229529381,-0.09603778272867203,0.01903289556503296,-0.07261676341295242,-0.0980960801243782,-0.0487823523581028,0.08436209708452225,0.06845739483833313,0.01560012437403202,-0.08527234196662903,-0.015064248815178871,-0.013178098015487194,-0.07373835891485214,-0.054500512778759,0.06141011044383049,0.08111313730478287,0.005212883930653334,-0.02223098836839199,-0.004993423353880644,0.041997477412223816,-0.013574756681919098,-0.02989012934267521,0.06780149787664413,-0.021659696474671364,0.03143448755145073,0.053565412759780884,-0.027192728593945503,0.01930900104343891,-0.053329624235630035,0.014927764423191547,0.04698137193918228,-0.024023303762078285,0.01482096966356039,-0.053929977118968964,-0.0034290484618395567,-0.1260414719581604,0.000426867394708097,-0.015348787419497967,-0.016815312206745148,0.023765763267874718,0.019233277067542076,-0.020311303436756134,0.00009186854003928602,0.034397877752780914,0.13411074876785278,0.009788058698177338,-0.019751720130443573,-0.008769229985773563,-0.03318863734602928,0.018654581159353256,0.052227456122636795,-0.06220964714884758,-0.019638121128082275,0.10524316877126694,-0.004149154759943485,-0.060705918818712234,0.03391611576080322,0.0177108533680439,-0.023189907893538475,0.04702640324831009,0.05440701171755791,-0.03655146807432175,-0.04745231196284294,-0.0882391482591629,-0.06584339588880539,0.06695090979337692,0.04155266657471657,0.002329637063667178,0.023697825148701668,-0.0073279221542179585,-0.14423824846744537,-0.006849896628409624,-0.04278050735592842,0.05689796060323715,0.005645911209285259,0.05292492359876633,0.03906797245144844,0.020157819613814354,-0.019243407994508743,0.031364791095256805,0.1222931444644928,-0.007888903841376305,0.04352213814854622,-0.022730078548192978,-0.0617116242647171,-0.011828923597931862,0.16510316729545593,0.06619010120630264,0.018661078065633774,0.040872011333703995,-0.05840688571333885,-3.17296745279446e-33,-0.01717766933143139,-0.0711209625005722,-0.014377686195075512,0.09943277388811111,0.010347563773393631,0.018947074189782143,0.03396326303482056,-0.020652448758482933,0.062893807888031,0.006099946331232786,0.10660421848297119,-0.02222333289682865,0.0062975394539535046,0.005092339590191841,0.04602789506316185,-0.04755772277712822,-0.038767166435718536,0.06554034352302551,0.031843677163124084,-0.02124064415693283,-0.014680667780339718,0.050790801644325256,0.07077130675315857,0.031139956787228584,0.05273909121751785,-0.024055615067481995,-0.028072519227862358,0.09570847451686859,-0.003538573859259486,-0.018627017736434937,0.08833075314760208,0.0477323904633522,-0.07404916733503342,-0.01722051203250885,-0.032802287489175797,-0.05117940157651901,-0.04758814349770546,0.13273677229881287,-0.031383149325847626,0.00659369258210063,0.04376520588994026,-0.0516304112970829,-0.0765979215502739,-0.03234562277793884,0.04168783128261566,0.02427755668759346,-0.036807868629693985,0.03353673592209816,-0.02383469045162201,-0.07615749537944794,0.002644950058311224,-0.029769470915198326,0.08039132505655289,-0.054793503135442734,-0.0422854945063591,0.11529780924320221,0.1036837100982666,0.02291230298578739,0.007941220887005329,0.022823594510555267,0.005621459800750017,-0.060170978307724,0.029709210619330406,0.05687279999256134,-0.011690476909279823,-0.02714536525309086,0.01442883163690567,0.06070149689912796,0.030198831111192703,-0.008585365489125252,0.031717363744974136,-0.040305059403181076,0.025574803352355957,-0.07190024107694626,0.07756649702787399,-0.024754894897341728,0.007942239753901958,0.02481870725750923,-0.05850711837410927,0.01575002819299698,-0.017214469611644745,0.05532943829894066,0.03233606368303299,0.09130790084600449,0.03006066381931305,-0.05485469847917557,-0.05069611221551895,0.03712552785873413,-0.01489809900522232,-0.014078864827752113,-0.038520388305187225,0.033284444361925125,0.0014679485466331244,-0.02862459421157837,0.015499645844101906,-1.608943556163922e-8,-0.022626494988799095,0.0078115640208125114,-0.028862370178103447,-0.02646501734852791,0.028627600520849228,0.0699351355433464,-0.08781476318836212,-0.06327275186777115,-0.04415171593427658,0.05508457496762276,-0.014912606216967106,0.027758939191699028,-0.02110353112220764,0.0047628749161958694,-0.11597643792629242,-0.002078916411846876,0.008440940640866756,0.03853897005319595,-0.03447812795639038,-0.03865678980946541,-0.060164034366607666,0.004363995511084795,0.04867618903517723,-0.0066347368992865086,-0.049643099308013916,0.07363671064376831,0.038222502917051315,0.0015749916201457381,0.046119607985019684,-0.11216910928487778,-0.09680239856243134,0.026055527850985527,-0.023794187232851982,-0.045015849173069,-0.07018724828958511,0.014427105896174908,-0.07275097072124481,-0.029779136180877686,0.0045380862429738045,0.023101551458239555,-0.020040759816765785,-0.0353245884180069,-0.12480199337005615,0.04684259742498398,-0.07783058285713196,0.002840793691575527,-0.013898776844143867,0.054926320910453796,-0.00115247315261513,-0.012700721621513367,0.035640764981508255,-0.01009860448539257,0.004934105556458235,0.025799458846449852,0.06278049945831299,0.0626329630613327,-0.012831631116569042,-0.01243404671549797,0.0723014697432518,-0.016015127301216125,0.027554037049412727,-0.05863051488995552,0.006641620770096779,-0.010503618977963924]','b96bc3323f9be862','["auth","jose","jwk","library","support","switched"]',NULL,1780717439919,1780717439919);
INSERT INTO semantic_terms VALUES('0042 added applied db migration refresh_token table','Xenova/all-MiniLM-L6-v2',384,'[0.02983059734106064,-0.09572096914052963,0.01120272371917963,-0.004302493762224913,0.023691941052675247,-0.03924978896975517,0.01291964016854763,-0.023694945499300957,-0.022915862500667572,0.087699294090271,0.08103077113628387,-0.05906530097126961,0.05252544954419136,-0.061029158532619476,-0.014271148480474949,0.051664866507053375,-0.06469888985157013,-0.018321389332413673,-0.039953455328941345,0.05705932527780533,-0.03772168606519699,-0.008657457306981087,-0.03754586726427078,-0.020812207832932472,0.07708387821912766,-0.028482679277658463,-0.038416627794504166,0.0005528435576707125,0.0012019940186291933,0.014148646034300327,-0.06486546993255615,0.08958510309457779,-0.10592152923345566,0.03048701398074627,0.03070889040827751,0.0642910823225975,0.11567450314760208,-0.02662070095539093,0.08910918980836868,-0.03475775569677353,0.030589396134018898,-0.08991068601608276,0.0037882195319980383,0.06519018858671188,0.03757164999842644,0.04994820058345795,0.008604507893323898,-0.04807135462760925,-0.013067306019365788,0.0423240140080452,0.01683640293776989,0.062216076999902725,-0.06044044345617294,0.0511905699968338,-0.05916779860854149,0.08883830159902573,0.03482401743531227,0.0368058942258358,0.060572549700737,0.020720958709716797,0.027344390749931335,0.027002276852726936,0.12046095728874207,-0.0071798874996602535,-0.12331046909093857,-0.07219121605157852,-0.08011791110038757,-0.09695564955472946,0.09022831171751022,-0.0010832353727892041,0.07529132068157196,0.031721606850624084,-0.09108894318342209,-0.0602930523455143,-0.005866778548806906,-0.017797334119677544,0.010775268077850342,0.07295548915863037,-0.0022031739354133606,-0.03385729342699051,0.053112782537937164,-0.053982626646757126,-0.025652972981333733,-0.04748709127306938,0.006097296718508005,-0.04053443297743797,-0.027097906917333603,-0.09219639003276825,0.02072140946984291,0.036980029195547104,0.04964287579059601,-0.02969144470989704,-0.018852951005101204,0.005516489036381245,-0.08164330571889877,-0.1052841916680336,0.020251508802175522,0.02962128259241581,0.06538417190313339,0.07351384311914444,-0.0426684133708477,0.012710131704807281,-0.054420433938503265,0.041449498385190964,-0.03765752539038658,-0.04722238704562187,0.03996249660849571,0.044181205332279205,-0.030621862038969994,-0.02104489877820015,0.04104135185480118,0.025545405223965645,-0.05969392880797386,-0.029018428176641464,-0.05761222913861275,0.03605085238814354,-0.13748496770858765,-0.07620122283697128,-0.04085910692811012,0.02659785933792591,0.034259356558322906,-0.0147659070789814,-0.0300295390188694,-0.01845705881714821,-0.10307881981134415,0.018443811684846878,-0.03778290003538132,1.8341317334406848e-33,-0.10240137577056885,0.04654288664460182,0.044092997908592224,-0.025182362645864487,0.0261867456138134,0.020938053727149963,-0.008898151107132435,0.022017132490873337,0.039303869009017944,-0.044772591441869736,-0.012737663462758064,-0.027351312339305878,0.007439431268721819,-0.04190542548894882,-0.09566120058298111,-0.015582366846501827,-0.019971134141087532,-0.026008548215031624,0.07163946330547333,-0.010327394120395184,0.05678090825676918,0.06079738214612007,-0.021375834941864014,0.02346888557076454,0.03830154985189438,0.11345372349023819,-0.024319572374224663,-0.0455610454082489,0.08457472175359726,0.04827728495001793,-0.0008096863166429102,-0.008354686200618744,-0.006776947528123856,-0.023139746859669685,-0.02644384652376175,0.0762239396572113,0.10336443036794662,-0.04295305162668228,-0.05388997867703438,0.0006637394544668496,0.033359721302986145,0.0229093749076128,-0.04421481117606163,-0.005134994629770517,0.0428706593811512,-0.01057070679962635,0.04199501872062683,0.0424162782728672,0.10065271705389023,-0.005379748996347189,-0.0779799073934555,-0.0404869019985199,-0.027034059166908264,-0.010239621624350548,-0.05902687460184097,-0.11689049750566483,-0.09611194580793381,0.000010177574949921109,-0.029862161725759506,-0.014454638585448265,0.008055103942751884,0.009129036217927933,0.049329038709402084,0.018461821600794792,0.10406709462404251,0.057015519589185715,0.015188192948698997,-0.0012088443618267775,0.03160932660102844,-0.013922855257987976,-0.036609672009944916,0.08715470135211945,0.03820697218179703,0.004632779862731695,-0.03821961209177971,-0.0535673126578331,0.003500230610370636,-0.030256099998950958,0.0028519711922854185,-0.007571524009108543,0.12430326640605927,-0.014780894853174686,-0.1453743427991867,-0.008647467941045761,-0.008173965848982334,-0.024268170818686485,-0.06693916767835617,-0.05766047537326813,-0.04581286758184433,-0.012139623053371906,0.1273089051246643,0.018075235188007355,0.0293411985039711,0.033993352204561234,-0.07035087049007416,-2.0892380684691146e-33,0.0313880480825901,-0.001979697961360216,0.004144854843616486,-0.0068193282932043076,0.012485094368457794,-0.04739254713058472,0.02966465801000595,0.10919816046953201,-0.03724116459488869,0.01630459539592266,0.0005942960851825774,-0.042846642434597015,0.022931169718503952,0.0010484503582119942,-0.09142328798770905,0.014840287156403065,-0.020937031134963036,0.03746257349848747,-0.020685944706201553,0.036291465163230896,0.02226894162595272,0.13191545009613037,0.007066190708428621,0.07068129628896713,0.011300049722194672,0.07387851923704147,-0.1015465036034584,0.010091172531247139,0.019825804978609085,-0.013035575859248638,0.016426753252744675,-0.015557773411273956,-0.018533919006586075,0.09778827428817749,0.04072997719049454,-0.025711871683597565,0.012907760217785835,0.02813624031841755,0.027575243264436722,0.05137801542878151,-0.014662523753941059,0.009492845274508,-0.0037502585910260677,0.01489864569157362,0.027208048850297928,0.11112429946660995,0.041276976466178894,0.012146491557359695,0.033853475004434586,-0.09539967775344849,0.10862042009830475,-0.01711701601743698,-0.0078562768176198,-0.0026155090890824795,0.07584500312805176,0.022870618849992752,0.06344572454690933,-0.00025142528465949,-0.029587918892502785,-0.05564415454864502,0.05067877471446991,0.024635469540953636,0.0804649144411087,0.0032211688812822104,0.036653779447078705,0.012792332097887993,0.011421965435147285,0.04618365690112114,-0.02844987064599991,-0.06627944856882095,-0.0540243424475193,-0.02268916927278042,-0.07893969118595123,0.06392410397529602,0.008262219838798046,-0.038050804287195206,-0.00039793268661014736,-0.0694483295083046,-0.038511600345373154,0.027670178562402725,-0.08966438472270966,-0.07959327846765518,0.0449751541018486,-0.020895028486847878,-0.015897832810878754,-0.056962255388498306,-0.018977107480168343,0.051914334297180176,0.0064770532771945,0.07121951878070831,-0.07483129948377609,-0.0416826456785202,-0.038279447704553604,0.03683778643608093,0.0011032185284420848,-1.870401966641566e-8,0.005545934196561575,0.036942657083272934,-0.024448029696941376,-0.009956245310604572,0.07627544552087784,-0.05010140687227249,0.01078889798372984,0.09035452455282211,-0.05498936027288437,-0.0769532322883606,-0.0765969380736351,0.10482911765575409,0.014330096542835236,0.01707904413342476,-0.057617876678705215,0.0013305378379300237,-0.020532969385385513,-0.03977428376674652,0.006799227092415094,-0.0218486450612545,-0.06399752199649811,0.04122393950819969,0.049107231199741364,-0.08434546738862991,0.010014132596552372,0.04750847816467285,0.0027463992591947317,0.05905771255493164,-0.005379488691687584,-0.10636451095342636,-0.034020159393548965,0.012681685388088226,-0.01745542138814926,0.0029754387214779854,-0.030872097238898277,0.04462023451924324,0.0425206683576107,0.03661450743675232,-0.07963771373033524,0.009619387798011303,-0.07310883700847626,0.01045696809887886,-0.014862160198390484,0.02494577132165432,0.007328955456614494,-0.008081506937742233,-0.02302107773721218,0.06398078054189682,-0.026363549754023552,-0.05666312202811241,0.002961277961730957,-0.041973043233156204,-0.03825616464018822,0.0005720279295928776,-0.057161979377269745,0.03652723878622055,-0.09809620678424835,0.0913141593337059,0.029597695916891098,0.006678663659840822,0.04193396493792534,0.03838181123137474,-0.01654815301299095,-0.0834486186504364]','9f7f04fa0bd54316','["0042","added","applied","db","migration","refresh_token","table"]',NULL,1780717440490,1780717440490);
INSERT INTO semantic_terms VALUES('412 checkpoint indexer page resumed search','Xenova/all-MiniLM-L6-v2',384,'[0.01350835245102644,-0.003417917527258396,-0.014771925285458565,0.022577350959181786,0.030215859413146973,0.003684719791635871,-0.0438738651573658,-0.0745089054107666,-0.040229346603155136,-0.015787648037075996,0.021814770996570587,0.09956227242946625,0.03524503856897354,-0.07323513180017471,-0.10793707519769669,-0.02834114246070385,-0.06861734390258789,-0.037553951144218445,0.03540023788809776,-0.0195891335606575,-0.0763443112373352,0.03489428386092186,0.028865715488791466,0.0036929778289049864,-0.0734037235379219,0.03996284306049347,-0.0696038231253624,-0.05402305722236633,0.025222282856702805,-0.05073076859116554,-0.03737381845712662,0.022770805284380913,-0.07635460048913956,0.045321568846702576,0.10683831572532654,-0.02983027696609497,-0.04950307682156563,-0.02111826092004776,0.02747277356684208,-0.059887439012527466,0.0884784683585167,-0.034428466111421585,-0.019539665430784225,0.055162735283374786,-0.0075739906169474125,-0.022171808406710625,-0.004008987452834845,-0.04484916105866432,0.11381089687347412,-0.03599819168448448,-0.028202759101986885,0.014576947316527367,0.020300602540373802,-0.015499462373554707,0.03619538992643356,-0.023792624473571777,0.017612461000680923,-0.03030361235141754,0.018553167581558228,-0.0114367650821805,0.04491535201668739,0.015481427311897278,-0.006923852954059839,-0.04606694355607033,0.05867374688386917,-0.042352307587862015,0.0728050246834755,-0.09009476006031036,0.08534662425518036,0.011429637670516968,0.03569682687520981,0.08933910727500916,-0.011281503364443779,0.014352948404848576,0.06007299944758415,0.007331019267439842,-0.008398745208978653,0.046169210225343704,0.006310560740530491,-0.0384240597486496,-0.038012176752090454,-0.08866115659475327,0.06691312044858932,0.04536603391170502,-0.0518561527132988,-0.03641527146100998,-0.028118198737502098,-0.04654119908809662,0.17253515124320984,0.039167311042547226,0.024746565148234367,0.021048245951533318,-0.02767799235880375,-0.1065710037946701,-0.05084381625056267,-0.02386465296149254,0.042717836797237396,0.12184817343950272,0.0741918608546257,0.011475766077637672,0.002723150420933962,-0.04668926075100899,-0.000040571248973719776,-0.004255988635122776,-0.051356520503759384,0.03466811031103134,0.03506682813167572,0.022299939766526222,-0.03308774530887604,-0.01703047938644886,0.05125605687499046,-0.010965359397232533,0.04605056345462799,0.00024364396813325584,0.03527798503637314,0.042042531073093414,-0.02839944325387478,-0.05231450870633125,0.016246451064944267,0.013320130296051502,0.02591337077319622,0.01049338560551405,0.039367057383060455,-0.10869099944829941,-0.0021268553100526333,0.07154063135385513,0.019956359639763832,-1.2701292684096628e-33,-0.003924955148249865,0.02240978740155697,-0.048558589071035385,0.003249315544962883,0.005860903766006231,-0.03794725611805916,0.02599370665848255,0.025526877492666245,-0.050255678594112396,-0.033191513270139694,-0.08434455096721649,-0.01831980235874653,-0.025806205347180367,-0.018896082416176796,-0.044208135455846786,-0.0259562935680151,0.06623523682355881,0.07749779522418976,-0.11939521133899689,-0.0588209368288517,0.09059320390224457,-0.06071008741855621,0.0032743457704782486,-0.009314930997788906,0.034774526953697205,0.10744507610797882,-0.07936328649520874,-0.01229810155928135,-0.010334241203963757,0.02592591941356659,-0.04499192163348198,0.09507156163454056,0.02021247334778309,-0.004963133484125137,0.003548337146639824,0.0700736865401268,-0.002244909293949604,0.06695818901062012,-0.031790729612112045,-0.071689173579216,-0.028552129864692688,0.009476231411099434,-0.049505919218063354,-0.04073728993535042,-0.02834910899400711,-0.07442587614059448,-0.062153108417987823,0.031102998182177544,0.05334644392132759,0.05150880292057991,-0.07476653903722763,0.03607004135847092,-0.01622461900115013,-0.047105636447668076,-0.01696079783141613,0.03167016804218292,-0.0016247192397713661,0.016439523547887802,-0.03235417231917381,0.09672554582357407,0.08865988999605179,0.006562267895787954,0.01902639865875244,0.03618299216032028,0.10151107609272003,-0.040071792900562286,-0.01867840811610222,0.07044848054647446,0.027834909036755562,0.08184732496738434,0.002231521299108863,-0.054298970848321915,0.17232206463813782,0.024424487724900246,0.06383122503757477,-0.06330075860023499,-0.10152124613523483,0.0008006622083485126,-0.015812143683433533,-0.016198474913835526,0.08156009018421173,-0.15059441328048706,-0.0614364854991436,-0.07526913285255432,0.07659482955932617,-0.055023666471242905,-0.014659833163022995,-0.018686974421143532,-0.07744032889604568,-0.018118828535079956,-0.003535541472956538,0.009794051758944988,0.018350595608353615,-0.006808230187743902,-0.06801260262727737,-5.858684966662397e-34,0.024312982335686684,-0.02313033677637577,0.002490837359800935,0.0076872543431818485,-0.021641168743371964,-0.009865978732705116,0.07053273916244507,0.00596071919426322,-0.0761813148856163,0.017672782763838768,0.02867804653942585,0.02713118866086006,0.061752986162900925,0.08892489969730377,-0.12526102364063263,0.07537185400724411,0.021718818694353104,0.005756920203566551,-0.013181114569306374,0.04455311596393585,-0.024675674736499786,-0.0637262761592865,-0.05480170622467995,0.011473309248685837,-0.08536843955516815,0.00173806375823915,0.06633991003036499,0.029659299179911613,-0.01553055178374052,0.035267628729343414,0.03719976171851158,-0.00592265697196126,0.04088719189167023,0.05795972794294357,0.08189106732606888,-0.0004743352474179119,0.01827755942940712,-0.042991090565919876,-0.03301079571247101,0.0512927770614624,0.04001915454864502,0.011522719636559486,0.008025784976780415,0.043506164103746414,0.04455942288041115,0.03418571874499321,0.007808579597622156,0.03253697231411934,-0.02284790202975273,-0.05283283442258835,0.03896138444542885,-0.01631002500653267,0.05551156401634216,0.02279854193329811,-0.0037078012246638536,0.031232507899403572,0.00022445803915616125,0.030048660933971405,-0.050128526985645294,0.04648062214255333,0.009892619214951992,0.04957956075668335,-0.09026039391756058,0.05701342225074768,0.10809454321861267,-0.04142708331346512,0.022570285946130753,0.006225029472261667,-0.08362150192260742,-0.034377653151750565,-0.07397939264774323,-0.011923191137611866,0.021556532010436058,0.04343058913946152,0.012539641000330448,-0.0115059744566679,0.005610480438917875,0.0003757827798835933,0.007577989250421524,0.02108100987970829,-0.05617314949631691,-0.022709837183356285,-0.028902435675263405,-0.031805653125047684,0.02249053306877613,0.052488163113594055,-0.03335486352443695,0.0730762779712677,-0.033232130110263824,0.03760973736643791,-0.038444578647613525,-0.07876066863536835,-0.07780059427022934,0.060717951506376266,0.01445710938423872,-1.4989703700507562e-8,-0.015584256500005722,0.04734150320291519,-0.0076386937871575356,0.058979954570531845,0.11965383589267731,-0.043285470455884933,0.017194926738739014,0.10138881206512451,-0.14124591648578644,-0.015090594068169594,0.006686377339065075,-0.024584483355283737,0.007106811739504337,0.045608364045619965,0.018094075843691826,-0.11376745253801346,0.01135664526373148,0.0165820624679327,-0.02967667020857334,-0.025062579661607742,-0.02643660642206669,-0.024719752371311188,0.005005648825317621,-0.004340360872447491,-0.0009758856613188982,0.02608271688222885,-0.011701096780598164,0.06599035114049911,-0.006102560553699732,-0.04521704465150833,-0.033367134630680084,0.013464893214404583,-0.02391437254846096,-0.021474862471222878,-0.06080641597509384,-0.0028913775458931923,0.026162229478359222,-0.05790811777114868,-0.0025600914377719164,-0.013959977775812149,0.06716465204954147,0.05891580879688263,0.03033287078142166,-0.03649500757455826,0.021311648190021515,0.05428982526063919,-0.09722461551427841,0.0023050366435199976,0.046688493341207504,-0.07896632701158524,-0.08352219313383102,-0.0834478810429573,0.032269544899463654,0.09779728204011917,0.034481946378946304,-0.04122575372457504,-0.023680686950683594,0.0012156475568190217,0.0426296629011631,0.01995740830898285,0.15385206043720245,-0.024608653038740158,-0.06908754259347916,-0.09567929804325104]','ba2103d2b7a42dae','["412","checkpoint","indexer","page","resumed","search"]',NULL,1780717441339,1780717441339);
CREATE TABLE semantic_resolution_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_dir TEXT,
      harbor TEXT,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      raw_term TEXT NOT NULL,
      canonical_term TEXT NOT NULL,
      candidate_term TEXT,
      similarity REAL,
      decision TEXT NOT NULL,
      threshold_auto REAL NOT NULL,
      threshold_review REAL NOT NULL,
      model TEXT NOT NULL,
      metadata TEXT,
      review_action TEXT,
      reviewed_by TEXT,
      review_note TEXT,
      reviewed_at INTEGER,
      created_at INTEGER NOT NULL
    );
INSERT INTO semantic_resolution_events VALUES(1,NULL,NULL,'session','session-backfill-search-index-bd524b216785:note:1:note','agent-backfill-search-index-6e733ef5 note','agent-backfill-search-index-6e733ef5 note',NULL,NULL,'seeded',0.8800000000000000044,0.8000000000000000444,'Xenova/all-MiniLM-L6-v2','{"fingerprint":"487ba45a0432dfbf","tokens":["agent-backfill-search-index-6e733ef5","note"],"candidates":[]}',NULL,NULL,NULL,NULL,1780717439917);
INSERT INTO semantic_resolution_events VALUES(2,NULL,NULL,'session','session-backfill-search-index-bd524b216785:note:1:note','Switched auth library to jose for JWKS support','auth jose jwk library support switched','agent-backfill-search-index-6e733ef5 note',0.0356172622353171514,'reject',0.8800000000000000044,0.8000000000000000444,'Xenova/all-MiniLM-L6-v2','{"fingerprint":"b96bc3323f9be862","tokens":["auth","jose","jwk","library","support","switched"],"candidates":[{"term":"agent-backfill-search-index-6e733ef5 note","similarity":0.03561726223531715}]}',NULL,NULL,NULL,NULL,1780717439924);
INSERT INTO semantic_resolution_events VALUES(3,NULL,NULL,'session','session-backfill-search-index-bd524b216785:note:2:note','agent-backfill-search-index-6e733ef5 note','agent-backfill-search-index-6e733ef5 note','auth jose jwk library support switched',0.0356172622353171514,'reject',0.8800000000000000044,0.8000000000000000444,'Xenova/all-MiniLM-L6-v2','{"fingerprint":"487ba45a0432dfbf","tokens":["agent-backfill-search-index-6e733ef5","note"],"candidates":[{"term":"auth jose jwk library support switched","similarity":0.03561726223531715}]}',NULL,NULL,NULL,NULL,1780717440488);
INSERT INTO semantic_resolution_events VALUES(4,NULL,NULL,'session','session-backfill-search-index-bd524b216785:note:2:note','DB migration 0042 applied — added refresh_tokens table','0042 added applied db migration refresh_token table','auth jose jwk library support switched',0.1954857221345956408,'reject',0.8800000000000000044,0.8000000000000000444,'Xenova/all-MiniLM-L6-v2','{"fingerprint":"9f7f04fa0bd54316","tokens":["0042","added","applied","db","migration","refresh_token","table"],"candidates":[{"term":"auth jose jwk library support switched","similarity":0.19548572213459564},{"term":"agent-backfill-search-index-6e733ef5 note","similarity":0.09678638081393517}]}',NULL,NULL,NULL,NULL,1780717440491);
INSERT INTO semantic_resolution_events VALUES(5,NULL,NULL,'session','session-backfill-search-index-bd524b216785:note:3:note','agent-backfill-search-index-6e733ef5 note','agent-backfill-search-index-6e733ef5 note','0042 added applied db migration refresh_token table',0.0967863808139351745,'reject',0.8800000000000000044,0.8000000000000000444,'Xenova/all-MiniLM-L6-v2','{"fingerprint":"487ba45a0432dfbf","tokens":["agent-backfill-search-index-6e733ef5","note"],"candidates":[{"term":"0042 added applied db migration refresh_token table","similarity":0.09678638081393517},{"term":"auth jose jwk library support switched","similarity":0.03561726223531715}]}',NULL,NULL,NULL,NULL,1780717441336);
INSERT INTO semantic_resolution_events VALUES(6,NULL,NULL,'session','session-backfill-search-index-bd524b216785:note:3:note','Search indexer resumed from checkpoint page 412','412 checkpoint indexer page resumed search','agent-backfill-search-index-6e733ef5 note',0.3892725933287564111,'reject',0.8800000000000000044,0.8000000000000000444,'Xenova/all-MiniLM-L6-v2','{"fingerprint":"ba2103d2b7a42dae","tokens":["412","checkpoint","indexer","page","resumed","search"],"candidates":[{"term":"agent-backfill-search-index-6e733ef5 note","similarity":0.3892725933287564},{"term":"0042 added applied db migration refresh_token table","similarity":0.2596268701181801},{"term":"auth jose jwk library support switched","similarity":-0.010593484027947419}]}',NULL,NULL,NULL,NULL,1780717441339);
CREATE TABLE semantic_resolution_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_key TEXT NOT NULL,
      project_dir TEXT,
      canonical_term TEXT NOT NULL,
      candidate_term TEXT NOT NULL,
      action TEXT NOT NULL,
      reviewer TEXT,
      note TEXT,
      source_event_id INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
CREATE TABLE episodic_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_dir TEXT,
      project TEXT,
      harbor TEXT,
      agent_id TEXT,
      episode_type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
INSERT INTO episodic_memory VALUES(1,NULL,'port-daddy',NULL,'agent-backfill-search-index-6e733ef5','note','agent-backfill-search-index-6e733ef5 note','Switched auth library to jose for JWKS support','session','session-backfill-search-index-bd524b216785:note:1','{"sessionId":"session-backfill-search-index-bd524b216785","noteType":"note"}',1780717439635,1780717439635);
INSERT INTO episodic_memory VALUES(2,NULL,'port-daddy',NULL,'agent-backfill-search-index-6e733ef5','note','agent-backfill-search-index-6e733ef5 note','DB migration 0042 applied — added refresh_tokens table','session','session-backfill-search-index-bd524b216785:note:2','{"sessionId":"session-backfill-search-index-bd524b216785","noteType":"note"}',1780717440487,1780717440487);
INSERT INTO episodic_memory VALUES(3,NULL,'port-daddy',NULL,'agent-backfill-search-index-6e733ef5','note','agent-backfill-search-index-6e733ef5 note','Search indexer resumed from checkpoint page 412','session','session-backfill-search-index-bd524b216785:note:3','{"sessionId":"session-backfill-search-index-bd524b216785","noteType":"note"}',1780717441336,1780717441336);
CREATE TABLE roadmap_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      kind TEXT NOT NULL,
      feedback_id TEXT,
      claimed_by TEXT NOT NULL,
      claimed_at INTEGER NOT NULL,
      released_at INTEGER,
      released_by TEXT,
      release_reason TEXT,
      summary TEXT,
      surface TEXT,
      payload TEXT,
      session_id TEXT,
      agent_id TEXT
    );
CREATE TABLE channel_registry (
      physical_channel TEXT PRIMARY KEY,
      logical_name TEXT NOT NULL,
      description TEXT,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      scope TEXT NOT NULL DEFAULT 'branch',
      project_dir TEXT,
      repo_anchor TEXT,
      repo_key TEXT,
      worktree_id TEXT,
      branch TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
INSERT INTO channel_registry VALUES('repo:4bc8ffb2:git:committed','git:committed','commit trigger event','[]','repo','/Users/erichowens/coding/tmp/db-fixtures','/Users/erichowens/coding/port-daddy/.git','4bc8ffb2','f3252159','feat/recordings-db-fixtures','{}',1780717442654,1780717442654);
INSERT INTO channel_registry VALUES('repo:4bc8ffb2:git:pr-opened','git:pr-opened','PR opened trigger','[]','repo','/Users/erichowens/coding/tmp/db-fixtures','/Users/erichowens/coding/port-daddy/.git','4bc8ffb2','f3252159','feat/recordings-db-fixtures','{}',1780717443503,1780717443503);
CREATE TABLE locks (
      name TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      pid INTEGER,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER,
      metadata TEXT
    );
CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT,
      pid INTEGER,
      type TEXT DEFAULT 'cli',
      registered_at INTEGER NOT NULL,
      last_heartbeat INTEGER NOT NULL,
      metadata TEXT,
      agent_card TEXT,
      skills TEXT,
      max_services INTEGER DEFAULT 50,
      max_locks INTEGER DEFAULT 20,
      worktree_id TEXT,
      identity_project TEXT,
      identity_stack TEXT,
      identity_context TEXT,
      purpose TEXT,
      status TEXT DEFAULT 'ready',
      readiness TEXT,
      progress TEXT
    );
INSERT INTO agents VALUES('agent-implement-oauth-token-refresh-a26efd3c','Implement OAuth token refresh',51653,'cli',1780717437938,1780717437938,'{"sessionWorktreePolicy":{"requireLinkedWorktree":true,"allowMainWorktree":true},"worktree":{"id":"f3252159","root":"/Users/erichowens/coding/tmp/db-fixtures","name":"db-fixtures","branch":"feat/recordings-db-fixtures","isMain":false}}',NULL,NULL,50,20,'f3252159','port-daddy','api','main','Implement OAuth token refresh','ready',NULL,NULL);
INSERT INTO agents VALUES('agent-backfill-search-index-6e733ef5','Backfill search index',51653,'cli',1780717438787,1780717438787,'{"sessionWorktreePolicy":{"requireLinkedWorktree":true,"allowMainWorktree":true},"worktree":{"id":"f3252159","root":"/Users/erichowens/coding/tmp/db-fixtures","name":"db-fixtures","branch":"feat/recordings-db-fixtures","isMain":false}}',NULL,NULL,50,20,'f3252159','port-daddy','worker','main','Backfill search index','ready',NULL,NULL);
CREATE TABLE activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      type TEXT NOT NULL,
      agent_id TEXT,
      target_id TEXT,
      details TEXT,
      metadata TEXT
    );
INSERT INTO activity_log VALUES(1,1780717435286,'daemon.start',NULL,NULL,'Port Daddy v3.18.0 started (Fastify)','{"port":9899,"pid":51653,"codeHash":"1a5f50ff669f","socket":"/Users/erichowens/coding/tmp/db-fixtures/website-v2/.recording-daemon/daemon.sock"}');
INSERT INTO activity_log VALUES(2,1780717435586,'service.claim','pid-51696','port-daddy:api:main','claimed port 3100','{"port":3100}');
INSERT INTO activity_log VALUES(3,1780717436338,'service.claim','pid-51711','port-daddy:website:dev','claimed port 3101','{"port":3101}');
INSERT INTO activity_log VALUES(4,1780717437089,'service.claim','pid-51727','port-daddy:worker:main','claimed port 3102','{"port":3102}');
INSERT INTO activity_log VALUES(5,1780717437939,'session.start','agent-implement-oauth-token-refresh-a26efd3c','port-daddy:session:session-implement-oauth-token-refresh-72ad2acc9d64','Session started: Implement OAuth token refresh','{"sessionWorktreePolicy":{"requireLinkedWorktree":true,"allowMainWorktree":true},"worktree":{"id":"f3252159","root":"/Users/erichowens/coding/tmp/db-fixtures","name":"db-fixtures","branch":"feat/recordings-db-fixtures","isMain":false},"sessionId":"session-implement-oauth-token-refresh-72ad2acc9d64","purpose":"Implement OAuth token refresh","agentId":"agent-implement-oauth-token-refresh-a26efd3c","identityProject":"port-daddy","worktreeId":"f3252159"}');
INSERT INTO activity_log VALUES(6,1780717437939,'sugar_begin','agent-implement-oauth-token-refresh-a26efd3c','port-daddy:session:session-implement-oauth-token-refresh-72ad2acc9d64','Agent agent-implement-oauth-token-refresh-a26efd3c began: Implement OAuth token refresh','{"sessionWorktreePolicy":{"requireLinkedWorktree":true,"allowMainWorktree":true},"worktree":{"id":"f3252159","root":"/Users/erichowens/coding/tmp/db-fixtures","name":"db-fixtures","branch":"feat/recordings-db-fixtures","isMain":false},"agentId":"agent-implement-oauth-token-refresh-a26efd3c","sessionId":"session-implement-oauth-token-refresh-72ad2acc9d64","identity":"port-daddy:api:main","identityProject":"port-daddy"}');
INSERT INTO activity_log VALUES(7,1780717438787,'session.start','agent-backfill-search-index-6e733ef5','port-daddy:session:session-backfill-search-index-bd524b216785','Session started: Backfill search index','{"sessionWorktreePolicy":{"requireLinkedWorktree":true,"allowMainWorktree":true},"worktree":{"id":"f3252159","root":"/Users/erichowens/coding/tmp/db-fixtures","name":"db-fixtures","branch":"feat/recordings-db-fixtures","isMain":false},"sessionId":"session-backfill-search-index-bd524b216785","purpose":"Backfill search index","agentId":"agent-backfill-search-index-6e733ef5","identityProject":"port-daddy","worktreeId":"f3252159"}');
INSERT INTO activity_log VALUES(8,1780717438787,'sugar_begin','agent-backfill-search-index-6e733ef5','port-daddy:session:session-backfill-search-index-bd524b216785','Agent agent-backfill-search-index-6e733ef5 began: Backfill search index','{"sessionWorktreePolicy":{"requireLinkedWorktree":true,"allowMainWorktree":true},"worktree":{"id":"f3252159","root":"/Users/erichowens/coding/tmp/db-fixtures","name":"db-fixtures","branch":"feat/recordings-db-fixtures","isMain":false},"agentId":"agent-backfill-search-index-6e733ef5","sessionId":"session-backfill-search-index-bd524b216785","identity":"port-daddy:worker:main","identityProject":"port-daddy"}');
INSERT INTO activity_log VALUES(9,1780717439636,'session.note','agent-backfill-search-index-6e733ef5','port-daddy:session:session-backfill-search-index-bd524b216785','Note added to session session-backfill-search-index-bd524b216785','{"sessionId":"session-backfill-search-index-bd524b216785","noteId":1,"type":"note","agentId":"agent-backfill-search-index-6e733ef5","identityProject":"port-daddy"}');
INSERT INTO activity_log VALUES(10,1780717439636,'session_note',NULL,NULL,'Note added to session session-backfill-search-index-bd524b216785','{"noteId":1,"sessionId":"session-backfill-search-index-bd524b216785","type":"note"}');
INSERT INTO activity_log VALUES(11,1780717440488,'session.note','agent-backfill-search-index-6e733ef5','port-daddy:session:session-backfill-search-index-bd524b216785','Note added to session session-backfill-search-index-bd524b216785','{"sessionId":"session-backfill-search-index-bd524b216785","noteId":2,"type":"note","agentId":"agent-backfill-search-index-6e733ef5","identityProject":"port-daddy"}');
INSERT INTO activity_log VALUES(12,1780717440488,'session_note',NULL,NULL,'Note added to session session-backfill-search-index-bd524b216785','{"noteId":2,"sessionId":"session-backfill-search-index-bd524b216785","type":"note"}');
INSERT INTO activity_log VALUES(13,1780717441336,'session.note','agent-backfill-search-index-6e733ef5','port-daddy:session:session-backfill-search-index-bd524b216785','Note added to session session-backfill-search-index-bd524b216785','{"sessionId":"session-backfill-search-index-bd524b216785","noteId":3,"type":"note","agentId":"agent-backfill-search-index-6e733ef5","identityProject":"port-daddy"}');
INSERT INTO activity_log VALUES(14,1780717441336,'session_note',NULL,NULL,'Note added to session session-backfill-search-index-bd524b216785','{"noteId":3,"sessionId":"session-backfill-search-index-bd524b216785","type":"note"}');
INSERT INTO activity_log VALUES(15,1780717444771,'daemon.stop',NULL,NULL,'Port Daddy stopped (SIGTERM)','{"signal":"SIGTERM","uptime":9747}');
CREATE TABLE commitments (
      id TEXT PRIMARY KEY,
      owner_actor_id TEXT NOT NULL,
      object_text TEXT NOT NULL,
      success_check TEXT,
      impossible_check TEXT,
      motivation_check TEXT,
      due_at INTEGER NOT NULL,
      commitment_strategy TEXT NOT NULL DEFAULT 'single',
      scope TEXT NOT NULL DEFAULT 'default',
      state TEXT NOT NULL DEFAULT 'open',
      closed_by_oracle_ref TEXT,
      created_at INTEGER NOT NULL,
      last_touched_at INTEGER NOT NULL,
      overdue_emitted_at INTEGER
    );
CREATE TABLE webhooks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      secret TEXT,
      events TEXT NOT NULL,
      filter_pattern TEXT,
      active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_triggered INTEGER,
      success_count INTEGER DEFAULT 0,
      failure_count INTEGER DEFAULT 0,
      metadata TEXT
    );
CREATE TABLE webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      event TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      last_attempt INTEGER,
      response_status INTEGER,
      response_body TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
    );
CREATE TABLE agent_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      from_agent TEXT,
      content TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'text',
      type TEXT NOT NULL DEFAULT 'message',
      read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
CREATE TABLE resurrection_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL UNIQUE,
      agent_name TEXT NOT NULL,
      session_id TEXT,
      purpose TEXT,
      detected_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      resurrection_attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at INTEGER,
      metadata TEXT,
      identity_project TEXT,
      identity_stack TEXT,
      identity_context TEXT
    );
CREATE TABLE changelog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      identity TEXT NOT NULL,
      session_id TEXT,
      agent_id TEXT,
      type TEXT NOT NULL DEFAULT 'feature',
      summary TEXT NOT NULL,
      description TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL
    );
CREATE TABLE dns_records (
      identity TEXT PRIMARY KEY,
      hostname TEXT NOT NULL UNIQUE,
      port INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
CREATE TABLE attention_subscriptions (
      agent_id   TEXT NOT NULL,
      channel    TEXT NOT NULL,
      cursor     INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (agent_id, channel)
    );
CREATE TABLE daemon_keys (
      id       TEXT PRIMARY KEY,
      key_hex  TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
CREATE TABLE harbor_token_signing_keys (
      id              TEXT PRIMARY KEY,
      alg             TEXT NOT NULL,
      private_key_pem TEXT NOT NULL,
      public_key_pem  TEXT NOT NULL,
      created_at      INTEGER NOT NULL
    );
INSERT INTO harbor_token_signing_keys VALUES('harbor-daemon-ed25519-v1','Ed25519','',replace('-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA+Rd/9MkzoTx8FJnGsOyaborBAQkgsezJdN9NFMrbVBU=\n-----END PUBLIC KEY-----\n','\n',char(10)),1780717435099);
CREATE TABLE harbor_issued_tokens (
      jti         TEXT PRIMARY KEY,
      agent_id    TEXT NOT NULL,
      harbor_name TEXT NOT NULL,
      issued_at   INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL
    );
CREATE TABLE harbor_token_revocations (
      jti        TEXT PRIMARY KEY,
      agent_id   TEXT NOT NULL,
      revoked_at INTEGER NOT NULL,
      expires_at INTEGER
    );
CREATE TABLE sorties (
      id TEXT PRIMARY KEY,
      project_dir TEXT NOT NULL,
      project TEXT NOT NULL,
      harbor TEXT NOT NULL,
      goal TEXT NOT NULL,
      recipe TEXT,
      status TEXT NOT NULL,
      backend TEXT NOT NULL,
      model TEXT,
      model_tier TEXT,
      budget_usd REAL NOT NULL,
      expected_output TEXT,
      spawn_agent_id TEXT,
      result_output TEXT,
      error TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
CREATE TABLE sortie_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sortie_id TEXT NOT NULL REFERENCES sorties(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      summary TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL
    );
CREATE TABLE project_wallets (
      project           TEXT PRIMARY KEY,
      balance_usd       REAL NOT NULL DEFAULT 0,
      commons_pool_usd  REAL NOT NULL DEFAULT 0,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    , budget_usd_per_day REAL);
CREATE TABLE bond_escrow (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      project      TEXT NOT NULL,
      agent_id     TEXT NOT NULL,
      archetype    TEXT,
      bond_usd     REAL NOT NULL,
      state        TEXT NOT NULL CHECK (state IN
                     ('escrowed','running','exiting','refunded','slashed')),
      escrowed_at  INTEGER NOT NULL,
      resolved_at  INTEGER,
      slash_reason TEXT
    );
CREATE TABLE budget_ledger (
      project       TEXT NOT NULL,
      agent_id      TEXT NOT NULL,
      day           TEXT NOT NULL,
      spend_usd     REAL NOT NULL DEFAULT 0,
      kill_armed_at INTEGER,
      PRIMARY KEY (project, agent_id, day)
    );
CREATE TABLE cost_events (
      id           TEXT    PRIMARY KEY,
      ts           INTEGER NOT NULL,
      backend      TEXT    NOT NULL,
      model        TEXT    NOT NULL,
      project_name TEXT,
      project_dir  TEXT,
      identity     TEXT,
      spawn_id     TEXT,
      input_tokens  INTEGER,
      cached_input_tokens INTEGER,
      output_tokens INTEGER,
      cost_usd     REAL    NOT NULL DEFAULT 0,
      is_estimate  INTEGER NOT NULL DEFAULT 0
    );
CREATE TABLE orchestrator_plugins (
      name TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      registered_at INTEGER NOT NULL,
      is_active INTEGER DEFAULT 0,
      metadata TEXT
    );
INSERT INTO orchestrator_plugins VALUES('fifo','1.0.0',1780717435132,1,NULL);
CREATE TABLE merge_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      session_id TEXT,
      branch TEXT NOT NULL,
      repository TEXT NOT NULL,
      base_branch TEXT NOT NULL DEFAULT 'main',
      claims TEXT,
      conflict_surface REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      priority INTEGER DEFAULT 0,
      submitted_at INTEGER NOT NULL,
      merged_at INTEGER,
      merge_commit TEXT,
      failure_reason TEXT,
      metadata TEXT
    );
CREATE TABLE orchestrator_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, channel_pattern TEXT NOT NULL, condition TEXT, action TEXT NOT NULL, payload TEXT NOT NULL, enabled INTEGER DEFAULT 1);
DELETE FROM sqlite_sequence;
INSERT INTO sqlite_sequence VALUES('activity_log',15);
INSERT INTO sqlite_sequence VALUES('session_notes',3);
INSERT INTO sqlite_sequence VALUES('episodic_memory',3);
INSERT INTO sqlite_sequence VALUES('tuples',15);
INSERT INTO sqlite_sequence VALUES('graph_edges',14);
INSERT INTO sqlite_sequence VALUES('semantic_resolution_events',6);
CREATE INDEX idx_services_port ON services(port);
CREATE INDEX idx_services_status ON services(status);
CREATE INDEX idx_messages_channel ON messages(channel, created_at);
CREATE INDEX idx_harbors_expires ON harbors(expires_at)
    WHERE expires_at IS NOT NULL;
CREATE INDEX idx_harbors_created ON harbors(created_at);
CREATE INDEX idx_harbor_members_agent ON harbor_members(agent_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_agent ON sessions(agent_id);
CREATE INDEX idx_sessions_worktree ON sessions(worktree_id);
CREATE INDEX idx_sessions_identity_project ON sessions(identity_project);
CREATE INDEX idx_session_files_path ON session_files(file_path);
CREATE INDEX idx_session_notes_session ON session_notes(session_id, created_at);
CREATE INDEX idx_session_notes_type ON session_notes(type);
CREATE INDEX idx_graph_edges_scope ON graph_edges(scope);
CREATE INDEX idx_graph_edges_project ON graph_edges(project_dir, updated_at DESC);
CREATE INDEX idx_graph_edges_source ON graph_edges(source_type, source_id);
CREATE INDEX idx_graph_edges_target ON graph_edges(target_type, target_id);
CREATE INDEX idx_graph_edges_type ON graph_edges(edge_type, updated_at DESC);
CREATE UNIQUE INDEX idx_graph_edges_unique
    ON graph_edges(scope, source_type, source_id, edge_type, target_type, target_id);
CREATE INDEX idx_roadmap_items_harbor_status
    ON roadmap_items(harbor, status);
CREATE INDEX idx_roadmap_items_last_touched
    ON roadmap_items(last_touched_at);
CREATE INDEX idx_roadmap_status_events_item
    ON roadmap_item_status_events(item_id, at);
CREATE INDEX idx_session_files_symbol_path ON session_files(file_path, symbol_path);
CREATE INDEX idx_symbols_file ON symbols(file_path);
CREATE INDEX idx_symbols_path ON symbols(symbol_path);
CREATE UNIQUE INDEX idx_symbols_file_path ON symbols(file_path, symbol_path);
CREATE INDEX idx_deps_source ON symbol_dependencies(source_file);
CREATE INDEX idx_deps_target ON symbol_dependencies(target_file, target_symbol);
CREATE INDEX idx_tuples_harbor ON tuples(harbor);
CREATE INDEX idx_tuples_expires ON tuples(expires_at);
CREATE INDEX idx_mc_key_hour ON metric_counters(key, bucket_hour);
CREATE INDEX idx_mc_hour     ON metric_counters(bucket_hour);
CREATE INDEX idx_semantic_terms_updated ON semantic_terms(updated_at DESC);
CREATE INDEX idx_semantic_resolution_created ON semantic_resolution_events(created_at DESC);
CREATE INDEX idx_semantic_resolution_decision ON semantic_resolution_events(decision, created_at DESC);
CREATE INDEX idx_semantic_resolution_project ON semantic_resolution_events(project_dir, created_at DESC);
CREATE UNIQUE INDEX idx_semantic_override_pair
      ON semantic_resolution_overrides(project_key, canonical_term, candidate_term);
CREATE UNIQUE INDEX idx_episodic_memory_source
      ON episodic_memory(source_type, source_id, episode_type);
CREATE INDEX idx_episodic_memory_project
      ON episodic_memory(project_dir, updated_at DESC);
CREATE INDEX idx_episodic_memory_agent
      ON episodic_memory(agent_id, updated_at DESC);
CREATE INDEX idx_episodic_memory_type
      ON episodic_memory(episode_type, updated_at DESC);
CREATE UNIQUE INDEX idx_roadmap_claims_active_slug
     ON roadmap_claims(slug) WHERE released_at IS NULL;
CREATE INDEX idx_roadmap_claims_claimed_by
     ON roadmap_claims(claimed_by) WHERE released_at IS NULL;
CREATE INDEX idx_roadmap_claims_session
     ON roadmap_claims(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_messages_expiry ON messages(expires_at);
CREATE INDEX idx_channel_registry_logical ON channel_registry(logical_name);
CREATE INDEX idx_channel_registry_repo_scope ON channel_registry(repo_key, worktree_id, branch, scope);
CREATE INDEX idx_channel_registry_project_dir ON channel_registry(project_dir);
CREATE INDEX idx_locks_expires ON locks(expires_at);
CREATE INDEX idx_agents_heartbeat ON agents(last_heartbeat);
CREATE INDEX idx_agents_worktree ON agents(worktree_id);
CREATE INDEX idx_agents_project ON agents(identity_project);
CREATE INDEX idx_activity_timestamp ON activity_log(timestamp);
CREATE INDEX idx_activity_type ON activity_log(type);
CREATE INDEX idx_activity_agent ON activity_log(agent_id);
CREATE INDEX idx_activity_target ON activity_log(target_id);
CREATE INDEX idx_commitments_owner ON commitments(owner_actor_id);
CREATE INDEX idx_commitments_state ON commitments(state);
CREATE INDEX idx_commitments_state_due ON commitments(state, due_at);
CREATE INDEX idx_webhooks_active ON webhooks(active);
CREATE INDEX idx_deliveries_webhook ON webhook_deliveries(webhook_id, created_at);
CREATE INDEX idx_deliveries_status ON webhook_deliveries(status);
CREATE INDEX idx_sessions_status_updated ON sessions(status, updated_at DESC);
CREATE INDEX idx_session_files_session ON session_files(session_id);
CREATE INDEX idx_session_files_region ON session_files(file_path, start_line, end_line);
CREATE INDEX idx_agent_inbox_agent ON agent_inbox(agent_id, created_at);
CREATE INDEX idx_agent_inbox_unread ON agent_inbox(agent_id) WHERE read = 0;
CREATE INDEX idx_resurrection_status ON resurrection_queue(status);
CREATE INDEX idx_resurrection_project ON resurrection_queue(identity_project);
CREATE INDEX idx_resurrection_project_stack ON resurrection_queue(identity_project, identity_stack);
CREATE INDEX idx_changelog_identity ON changelog(identity);
CREATE INDEX idx_changelog_created ON changelog(created_at DESC);
CREATE INDEX idx_changelog_session ON changelog(session_id);
CREATE INDEX idx_changelog_agent ON changelog(agent_id);
CREATE INDEX idx_dns_hostname ON dns_records(hostname);
CREATE INDEX idx_dns_port ON dns_records(port);
CREATE INDEX idx_attention_subs_agent
      ON attention_subscriptions(agent_id);
CREATE INDEX idx_hit_agent   ON harbor_issued_tokens(agent_id);
CREATE INDEX idx_hit_expires ON harbor_issued_tokens(expires_at);
CREATE INDEX idx_revocations_agent ON harbor_token_revocations(agent_id);
CREATE INDEX idx_revocations_expires ON harbor_token_revocations(expires_at)
      WHERE expires_at IS NOT NULL;
CREATE INDEX idx_sorties_project_dir ON sorties(project_dir, created_at DESC);
CREATE INDEX idx_sorties_status ON sorties(status, created_at DESC);
CREATE INDEX idx_sorties_project ON sorties(project, created_at DESC);
CREATE INDEX idx_sortie_events_sortie ON sortie_events(sortie_id, created_at ASC);
CREATE INDEX idx_bond_agent
            ON bond_escrow(agent_id, state);
CREATE INDEX idx_bond_project_state
            ON bond_escrow(project, state);
CREATE INDEX idx_budget_project_day
            ON budget_ledger(project, day);
CREATE INDEX idx_ce_ts      ON cost_events(ts);
CREATE INDEX idx_ce_project ON cost_events(project_name, ts);
CREATE INDEX idx_ce_backend ON cost_events(backend, ts);
CREATE INDEX idx_ce_project_dir ON cost_events(project_dir, ts);
CREATE INDEX idx_merge_queue_status ON merge_queue(status);
CREATE INDEX idx_merge_queue_agent ON merge_queue(agent_id);
CREATE INDEX idx_merge_queue_repo ON merge_queue(repository);
CREATE INDEX idx_merge_queue_submitted ON merge_queue(submitted_at);
COMMIT;
