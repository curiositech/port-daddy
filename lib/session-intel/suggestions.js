'use strict';
// suggestions.js — the suggestibility pipeline. Aggregate recurring MISSES in the
// ledger into a RANKED list of actionable build items for port-daddy coordination.
//
// Ranking is deterministic and evidence-weighted:
//   score = Σ over grouped misses of severityWeight(entry)
//   severityWeight: high=5, medium=3, low=1
// Ties broken by occurrence count, then group id. Hits are summarized separately
// as "keep-doing" reinforcement, but only misses generate build items.

const SEV_WEIGHT = { high: 5, medium: 3, low: 1 };

// Group key per kind: hot files get their own build item; session-scoped misses
// (abandoned, hygiene) roll up per kind into one systemic item.
function groupIdFor(entry) {
  switch (entry.kind) {
    case 'claim-conflict':
      return `conflict-guard:${entry.refs.file}`;
    case 'duplicate-work':
      return `dup-guard:${entry.refs.file}`;
    case 'abandoned':
      return `salvage-nudge`;
    case 'note-hygiene':
      return `scope-note-gate`;
    default:
      return entry.kind;
  }
}

const TITLES = {
  'conflict-guard': (file) => `Region-aware claim guard for hot file ${file}`,
  'dup-guard': (file) => `"Recently edited" warning on claim of ${file}`,
  'salvage-nudge': () => `Auto-salvage handoff when a session with open claims goes stale`,
  'scope-note-gate': () => `Require a scope note before the first file claim`,
};

function rankSuggestions(entries, opts = {}) {
  const misses = entries.filter((e) => e.verdict === 'miss');
  const groups = new Map();
  for (const e of misses) {
    const gid = groupIdFor(e);
    let g = groups.get(gid);
    if (!g) {
      g = { id: gid, kind: e.kind, occurrences: 0, score: 0, severities: {}, files: new Set(), sessions: new Set(), examples: [] };
      groups.set(gid, g);
    }
    g.occurrences++;
    g.score += SEV_WEIGHT[e.severity] || 1;
    g.severities[e.severity] = (g.severities[e.severity] || 0) + 1;
    if (e.refs && e.refs.file) g.files.add(e.refs.file);
    for (const s of (e.refs && e.refs.sessions) || []) g.sessions.add(s);
    if (g.examples.length < 3) g.examples.push({ key: e.key, observation: e.observation, suggestedChange: e.suggestedChange });
  }

  const items = [...groups.values()].map((g) => {
    const [prefix, arg] = g.id.split(':');
    const titleFn = TITLES[prefix] || (() => g.id);
    return {
      id: g.id,
      kind: g.kind,
      title: titleFn(arg),
      occurrences: g.occurrences,
      score: g.score,
      severityBreakdown: g.severities,
      affectedFiles: [...g.files].sort(),
      affectedSessionCount: g.sessions.size,
      recommendation: g.examples[0] ? g.examples[0].suggestedChange : '',
      examples: g.examples,
    };
  });

  items.sort((a, b) => b.score - a.score || b.occurrences - a.occurrences || (a.id < b.id ? -1 : 1));
  items.forEach((it, i) => (it.rank = i + 1));

  const limit = opts.limit || items.length;
  return items.slice(0, limit);
}

// Compact reinforcement summary of what's WORKING (hits) — the "keep doing" side.
function summarizeHits(entries) {
  const hits = entries.filter((e) => e.verdict === 'hit');
  const byKind = {};
  for (const h of hits) byKind[h.kind] = (byKind[h.kind] || 0) + 1;
  return { total: hits.length, byKind };
}

module.exports = { rankSuggestions, summarizeHits, SEV_WEIGHT };
