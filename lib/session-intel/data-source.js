'use strict';
// data-source.js — normalize real port-daddy coordination records into the flat
// shape the miner consumes: { sessions, claims, notes, agents }.
//
// Two adapters:
//   loadFromSqlite(dbPath)  — read-only pull from the daemon's SQLite store
//                             (~/.port-daddy/**/port-daddy.db). Never writes.
//   loadFromSnapshot(obj)   — pass-through for a captured JSON slice (used by the
//                             selftest so it can run offline against a fixture).
//
// All field names are normalized to camelCase so the miner never sees raw column
// names. Timestamps are epoch-ms integers exactly as the daemon stores them.

const fs = require('fs');

function normalizeSnapshot(obj) {
  const sessions = (obj.sessions || []).map((s) => ({
    id: s.id,
    purpose: s.purpose || null,
    agentId: s.agentId ?? s.agent_id ?? null,
    status: s.status || 'active',
    identityProject: s.identityProject ?? s.identity_project ?? null,
    createdAt: num(s.createdAt ?? s.created_at),
    updatedAt: num(s.updatedAt ?? s.updated_at),
    completedAt: num(s.completedAt ?? s.completed_at),
  }));
  const claims = (obj.claims || obj.files || []).map((c) => ({
    sessionId: c.sessionId ?? c.session_id,
    filePath: c.filePath ?? c.file_path,
    startLine: num(c.startLine ?? c.start_line),
    endLine: num(c.endLine ?? c.end_line),
    symbolPath: c.symbolPath ?? c.symbol_path ?? null,
    claimedAt: num(c.claimedAt ?? c.claimed_at),
    releasedAt: num(c.releasedAt ?? c.released_at),
  }));
  const notes = (obj.notes || []).map((n) => ({
    id: n.id,
    sessionId: n.sessionId ?? n.session_id,
    type: n.type || 'note',
    createdAt: num(n.createdAt ?? n.created_at),
    content: n.content || '',
  }));
  const agents = (obj.agents || []).map((a) => ({
    id: a.id,
    sessionId: a.sessionId ?? a.session_id ?? null,
    status: a.status || null,
    lastHeartbeat: num(a.lastHeartbeat ?? a.last_heartbeat),
    identityProject: a.identityProject ?? a.identity_project ?? null,
  }));
  return { sessions, claims, notes, agents };
}

function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Read-only pull from a daemon SQLite store. Uses better-sqlite3 (a real repo
// dependency); falls back to node:sqlite if better-sqlite3 is unavailable.
function loadFromSqlite(dbPath, opts = {}) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`data-source: db not found: ${dbPath}`);
  }
  const project = opts.project || null; // filter by identity_project when given
  const limitSessions = opts.limitSessions || null; // most-recent N sessions

  const db = openReadOnly(dbPath);
  try {
    let sessionRows = db
      .prepare(
        `SELECT id, purpose, agent_id, status, identity_project,
                created_at, updated_at, completed_at
           FROM sessions
          ${project ? 'WHERE identity_project = ?' : ''}
          ORDER BY updated_at DESC`
      )
      .all(...(project ? [project] : []));
    if (limitSessions) sessionRows = sessionRows.slice(0, limitSessions);

    const ids = new Set(sessionRows.map((s) => s.id));
    const claimRows = db
      .prepare(
        `SELECT session_id, file_path, start_line, end_line, symbol_path,
                claimed_at, released_at FROM session_files`
      )
      .all()
      .filter((c) => ids.has(c.session_id));
    const noteRows = db
      .prepare(`SELECT id, session_id, type, content, created_at FROM session_notes`)
      .all()
      .filter((n) => ids.has(n.session_id));

    let agentRows = [];
    try {
      agentRows = db
        .prepare(
          `SELECT id, status, last_heartbeat, identity_project FROM agents
            ${project ? 'WHERE identity_project = ?' : ''}`
        )
        .all(...(project ? [project] : []));
    } catch {
      /* agents table optional */
    }

    return normalizeSnapshot({
      sessions: sessionRows,
      claims: claimRows,
      notes: noteRows,
      agents: agentRows,
    });
  } finally {
    db.close();
  }
}

function openReadOnly(dbPath) {
  try {
    const Database = require('better-sqlite3');
    return wrapBetter(new Database(dbPath, { readonly: true, fileMustExist: true }));
  } catch (e) {
    // Fall back to the built-in node:sqlite (Node 22+).
    const { DatabaseSync } = require('node:sqlite');
    return wrapNode(new DatabaseSync(dbPath, { readOnly: true }));
  }
}

function wrapBetter(db) {
  return {
    prepare: (sql) => {
      const st = db.prepare(sql);
      return { all: (...a) => st.all(...a) };
    },
    close: () => db.close(),
  };
}
function wrapNode(db) {
  return {
    prepare: (sql) => {
      const st = db.prepare(sql);
      return { all: (...a) => st.all(...a) };
    },
    close: () => db.close(),
  };
}

module.exports = { loadFromSqlite, loadFromSnapshot: normalizeSnapshot, normalizeSnapshot };
