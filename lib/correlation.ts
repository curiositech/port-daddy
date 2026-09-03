export interface TimelineEntry {
  id: string | number;
  timestamp: number;
  source: 'activity' | 'note';
  type: string;
  agentId: string | null;
  targetId: string | null;
  content: string;
  metadata?: any;
}

export function createCorrelationEngine(activityLog: any, sessions: any) {
  
  async function getTimeline(options: { limit?: number; agentId?: string; sessionId?: string } = {}): Promise<TimelineEntry[]> {
    const { limit = 100, agentId, sessionId } = options;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw Object.assign(new Error('timeline limit must be an integer from 1 to 1000'), { code: 'VALIDATION_ERROR' });
    }

    // 1. Get recent activity entries
    let activityResult;
    try { activityResult = activityLog.getRecent({ limit, agentId }); }
    catch { throw Object.assign(new Error('timeline activity is unavailable'), { code: 'TIMELINE_SOURCE_UNAVAILABLE' }); }
    if (activityResult?.success === false || !Array.isArray(activityResult?.entries)
      || activityResult.entries.some((entry: any) => !entry || !Number.isFinite(entry.timestamp) || typeof entry.type !== 'string')) {
      throw Object.assign(new Error('timeline activity is unavailable'), { code: 'TIMELINE_SOURCE_UNAVAILABLE' });
    }
    const activityEntries: TimelineEntry[] = activityResult.entries.map((e: any) => ({
      id: `act-${e.id}`,
      timestamp: e.timestamp,
      source: 'activity',
      type: e.type,
      agentId: e.agentId,
      targetId: e.targetId,
      content: e.details || e.type,
      metadata: e.metadata
    }));

    // 2. Get recent session notes
    let notesResult;
    try { notesResult = sessions.getNotes(sessionId, { limit, agentId }); }
    catch { throw Object.assign(new Error('timeline notes are unavailable'), { code: 'TIMELINE_SOURCE_UNAVAILABLE' }); }
    if (notesResult?.success !== true || !Array.isArray(notesResult?.notes)
      || notesResult.notes.some((note: any) => !note || !Number.isFinite(note.createdAt)
        || typeof note.content !== 'string' || typeof note.type !== 'string')) {
      throw Object.assign(new Error('timeline notes are unavailable'), { code: 'TIMELINE_SOURCE_UNAVAILABLE' });
    }
    const noteEntries: TimelineEntry[] = notesResult.notes.map((n: any) => ({
      id: `note-${n.id}`,
      timestamp: n.createdAt,
      source: 'note',
      type: n.type,
      agentId: agentId || null, // Session notes don't always have agentId directly in the note row
      targetId: n.sessionId,
      content: n.content,
      metadata: { sessionId: n.sessionId, sessionPurpose: n.sessionPurpose }
    }));

    // 3. Merge and sort
    const merged = [...activityEntries, ...noteEntries]
      .sort((a, b) => b.timestamp - a.timestamp) // Newest first
      .slice(0, limit);

    return merged;
  }

  return {
    getTimeline
  };
}
