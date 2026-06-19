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

    // 1. Get recent activity entries
    const activityResult = activityLog.getRecent({ limit, agentId });
    const activityEntries: TimelineEntry[] = (activityResult.entries || []).map((e: any) => ({
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
    const notesResult = sessions.getNotes(sessionId, { limit, agentId });
    const noteEntries: TimelineEntry[] = (notesResult.notes || []).map((n: any) => ({
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
