/**
 * Briefing Module — Project-Local Agent Intelligence
 *
 * Generates `.portdaddy/` folder contents as a projection of daemon state
 * scoped to a specific project. Agents read these files on startup to
 * understand what happened before they arrived.
 *
 * Design: Daemon writes, agents read. SQLite remains source of truth.
 */

import type Database from 'better-sqlite3';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { getWorktreeInfo } from './worktree.js';
import { loadConfig } from './config.js';

// =============================================================================
// Types
// =============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
interface BriefingDeps {
  sessions: any;
  agents: any;
  resurrection: any;
  activityLog: any;
  services: any;
  messaging: any;
}

interface FormattedSession {
  id: string;
  purpose: string;
  status: string;
  phase: string;
  agentId: string | null;
  identityProject: string | null;
  worktreeId: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

interface FormattedNote {
  id: number;
  sessionId: string;
  content: string;
  type: string;
  createdAt: number;
}

interface FormattedFile {
  sessionId: string;
  filePath: string;
  claimedAt: number;
  releasedAt: number | null;
}

interface FileClaim {
  sessionId: string;
  filePath: string;
  claimedAt: number;
  purpose: string;
  agentId: string | null;
  phase: string;
}

interface FormattedAgent {
  id: string;
  name: string | null;
  isActive: boolean;
  lastHeartbeat: number;
  identityProject?: string | null;
  identityStack?: string | null;
  identityContext?: string | null;
  purpose?: string | null;
}

interface StaleAgent {
  id: string;
  name: string;
  purpose: string | null;
  sessionId: string | null;
  lastHeartbeat: number;
  staleSince: number;
  status: string;
  notes?: string[];
  identityProject: string | null;
}

interface ActivityEntry {
  id: number;
  timestamp: number;
  type: string;
  agentId: string | null;
  targetId: string | null;
  details: string | null;
}

interface ServiceEntry {
  id: string;
  port: number;
  status: string;
}

interface ChannelEntry {
  channel: string;
  count: number;
}

interface MessageEntry {
  payload: string;
  sender: string | null;
  createdAt: number;
}

interface BriefingData {
  project: string;
  generatedAt: string;
  activeSessions: FormattedSession[];
  activeAgents: FormattedAgent[];
  salvageQueue: StaleAgent[];
  fileClaims: FileClaim[];
  recentActivity: ActivityEntry[];
  recentNotes: FormattedNote[];
  integrationSignals: { channel: string; type: string; payload: unknown; sender: string | null; timestamp: number }[];
  activeServices: ServiceEntry[];
}

interface GenerateResult {
  success: boolean;
  briefingPath?: string;
  files?: string[];
  briefing?: BriefingData;
  error?: string;
}

interface SyncResult {
  success: boolean;
  briefingPath?: string;
  files?: string[];
  archivedSessions?: number;
  archivedAgents?: number;
  error?: string;
}

// =============================================================================
// Module factory
// =============================================================================

export function createBriefing(db: Database.Database, deps: BriefingDeps) {
  const { sessions, agents, resurrection, activityLog, services, messaging } = deps;

  /**
   * Detect the project name for a given directory.
   * Priority: explicit override > .portdaddyrc project > worktree directory name
   */
  function detectProject(projectRoot: string, explicitProject?: string | null): string {
    if (explicitProject) return explicitProject;

    // Check .portdaddyrc
    try {
      const config = loadConfig(projectRoot);
      if (config?.project) return config.project;
    } catch {
      // No config found
    }

    // Fall back to worktree name
    const info = getWorktreeInfo(projectRoot);
    if (info) return info.name;

    // Last resort: directory basename
    return resolve(projectRoot).split('/').pop() || 'unknown';
  }

  /**
   * Gather all project-scoped data for the briefing.
   */
  function gatherData(project: string, projectRoot: string): BriefingData {
    // Get worktree info for worktree-scoped queries
    const worktreeInfo = getWorktreeInfo(projectRoot);

    // Active sessions — filter by worktree if available, otherwise show all
    const sessionOpts: Record<string, unknown> = { status: 'active', allWorktrees: true, includeNotes: false, limit: 50 };
    const allSessions = sessions.list(sessionOpts);
    const activeSessions = (allSessions.sessions || []).filter((s: FormattedSession) => {
      // Match by identity_project if set, or by worktree if available
      if (s.identityProject) return s.identityProject === project;
      if (worktreeInfo && s.worktreeId) return s.worktreeId === worktreeInfo.id;
      return true; // Include sessions with no project/worktree scoping
    });

    // Active agents — filter by identity_project
    const allAgents = agents.list();
    const activeAgents = (allAgents.agents || []).filter((a: FormattedAgent) => {
      if (a.identityProject) return a.identityProject === project;
      return false; // Only include agents explicitly registered to this project
    });

    // Salvage queue — filter by identity_project
    const pendingResult = resurrection.pending({ project });
    const salvageQueue = pendingResult.agents || [];

    // File claims — already global, we filter client-side
    const claimsResult = sessions.listAllActiveClaims();
    const fileClaims = (claimsResult.claims || []).filter((c: FileClaim) => {
      // Match via session's agent being in our active sessions
      return activeSessions.some((s: FormattedSession) => s.id === c.sessionId);
    });

    // Recent activity — filter by target_id prefix matching project
    const activityResult = activityLog.getRecent({ limit: 100, targetPattern: `${project}:*` });
    const recentActivity = (activityResult.entries || []).slice(0, 30);

    // Recent notes from active sessions
    const recentNotes: FormattedNote[] = [];
    for (const session of activeSessions.slice(0, 10)) {
      const notesResult = sessions.getNotes(session.id);
      if (notesResult.notes) {
        recentNotes.push(...notesResult.notes);
      }
    }
    // Also get notes from recently completed sessions (last 7 days)
    const recentSessions = sessions.list({ allWorktrees: true, includeNotes: false, limit: 20 });
    for (const session of (recentSessions.sessions || []).filter((s: FormattedSession) =>
      s.status !== 'active' && s.completedAt && (Date.now() - s.completedAt) < 7 * 24 * 60 * 60 * 1000
    )) {
      if (session.identityProject === project || (worktreeInfo && session.worktreeId === worktreeInfo.id)) {
        const notesResult = sessions.getNotes(session.id);
        if (notesResult.notes) {
          recentNotes.push(...notesResult.notes);
        }
      }
    }
    recentNotes.sort((a, b) => b.createdAt - a.createdAt);

    // Integration signals from messaging channels
    const integrationSignals: BriefingData['integrationSignals'] = [];
    try {
      const channelsResult = messaging.listChannels();
      const integrationChannels = (channelsResult.channels || []).filter(
        (c: ChannelEntry) => c.channel.startsWith(`integration:${project}:`)
      );
      for (const ch of integrationChannels) {
        const msgs = messaging.getMessages(ch.channel, { limit: 10 });
        for (const msg of (msgs.messages || [])) {
          let payload: unknown;
          try { payload = JSON.parse(msg.payload); } catch { payload = msg.payload; }
          const type = ch.channel.split(':').pop() || 'unknown';
          integrationSignals.push({
            channel: ch.channel,
            type,
            payload,
            sender: msg.sender,
            timestamp: msg.createdAt,
          });
        }
      }
      integrationSignals.sort((a, b) => b.timestamp - a.timestamp);
    } catch {
      // Messaging may not be available
    }

    // Active services matching project prefix
    const allServices = services.find(`${project}:*`);
    const activeServices = (allServices.services || []).filter((s: ServiceEntry) =>
      s.status === 'assigned'
    );

    return {
      project,
      generatedAt: new Date().toISOString(),
      activeSessions,
      activeAgents,
      salvageQueue,
      fileClaims,
      recentActivity,
      recentNotes: recentNotes.slice(0, 50),
      integrationSignals: integrationSignals.slice(0, 20),
      activeServices,
    };
  }

  /**
   * Render briefing.md markdown from structured data.
   */
  function renderMarkdown(data: BriefingData): string {
    const lines: string[] = [];
    const ts = (ms: number) => new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

    lines.push(`# Project Briefing: ${data.project}`);
    lines.push(`Generated: ${data.generatedAt} by Port Daddy`);
    lines.push('');

    // Current State
    lines.push('## Current State');
    lines.push(`- **Active sessions:** ${data.activeSessions.length}${data.activeSessions.length > 0 ? ` (${data.activeSessions.map(s => s.purpose).join(', ')})` : ''}`);
    lines.push(`- **Active agents:** ${data.activeAgents.length}${data.activeAgents.length > 0 ? ` (${data.activeAgents.map(a => a.id).join(', ')})` : ''}`);
    lines.push(`- **Dead agents needing salvage:** ${data.salvageQueue.length}${data.salvageQueue.length > 0 ? ` (${data.salvageQueue.map(a => `${a.id} -- ${a.purpose || 'unknown purpose'}`).join(', ')})` : ''}`);
    lines.push(`- **Claimed files:** ${data.fileClaims.length} across ${new Set(data.fileClaims.map(c => c.sessionId)).size} session(s)`);
    if (data.activeServices.length > 0) {
      lines.push(`- **Active ports:** ${data.activeServices.map(s => `${s.id} -> ${s.port}`).join(', ')}`);
    }
    lines.push('');

    // Salvage Queue
    if (data.salvageQueue.length > 0) {
      lines.push('## Salvage Queue');
      for (const agent of data.salvageQueue) {
        const ago = Math.round((Date.now() - agent.staleSince) / 60000);
        lines.push(`### ${agent.id} (dead ${ago}m ago)`);
        lines.push(`- **Purpose:** ${agent.purpose || 'unknown'}`);
        if (agent.sessionId) lines.push(`- **Last session:** ${agent.sessionId}`);
        if (agent.notes && agent.notes.length > 0) {
          lines.push(`- **Last note:** "${agent.notes[agent.notes.length - 1]}"`);
        }
        lines.push(`- **Claim this work:** \`pd salvage --claim ${agent.id}\``);
        lines.push('');
      }
    }

    // File Ownership Map
    if (data.fileClaims.length > 0) {
      lines.push('## File Ownership Map');
      lines.push('| File | Owner | Session | Phase |');
      lines.push('|------|-------|---------|-------|');
      for (const claim of data.fileClaims) {
        const isDead = data.salvageQueue.some(a => a.sessionId === claim.sessionId);
        const ownerSuffix = isDead ? ' (DEAD)' : '';
        lines.push(`| ${claim.filePath} | ${claim.agentId || 'unknown'}${ownerSuffix} | ${claim.purpose} | ${claim.phase} |`);
      }
      lines.push('');
    }

    // Recent Activity
    if (data.recentActivity.length > 0) {
      lines.push('## Recent Activity');
      for (const entry of data.recentActivity.slice(0, 15)) {
        const time = ts(entry.timestamp).split(' ')[1] || '';
        lines.push(`- [${time}] ${entry.details || `${entry.type} ${entry.targetId || ''}`}`);
      }
      lines.push('');
    }

    // Integration Signals
    if (data.integrationSignals.length > 0) {
      lines.push('## Recent Handoffs & Signals');
      for (const signal of data.integrationSignals.slice(0, 10)) {
        const time = ts(signal.timestamp).split(' ')[1] || '';
        const desc = typeof signal.payload === 'object' && signal.payload !== null
          ? (signal.payload as Record<string, string>).description || JSON.stringify(signal.payload)
          : String(signal.payload);
        lines.push(`- [${time}] ${signal.type}: ${desc}${signal.sender ? ` (from ${signal.sender})` : ''}`);
      }
      lines.push('');
    }

    // Key Notes
    if (data.recentNotes.length > 0) {
      lines.push('## Key Notes (recent)');
      for (const note of data.recentNotes.slice(0, 20)) {
        const time = ts(note.createdAt).split(' ')[1] || '';
        const prefix = note.type !== 'note' ? `[${note.type}] ` : '';
        lines.push(`- [${time}] ${prefix}${note.content}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Render a session archive markdown file.
   */
  function renderSessionArchive(session: FormattedSession, notes: FormattedNote[], files: FormattedFile[]): string {
    const lines: string[] = [];
    const ts = (ms: number) => new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

    lines.push(`# Session: ${session.id}`);
    lines.push(`Purpose: ${session.purpose}`);
    if (session.agentId) lines.push(`Agent: ${session.agentId}`);
    lines.push(`Started: ${ts(session.createdAt)}`);
    if (session.completedAt) lines.push(`Completed: ${ts(session.completedAt)}`);
    lines.push(`Status: ${session.status}`);
    lines.push(`Phase: ${session.phase}`);
    lines.push('');

    if (notes.length > 0) {
      lines.push('## Notes');
      for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        const time = ts(note.createdAt).split(' ')[1] || '';
        const prefix = note.type !== 'note' ? `[${note.type}] ` : '';
        lines.push(`${i + 1}. [${time}] ${prefix}${note.content}`);
      }
      lines.push('');
    }

    if (files.length > 0) {
      lines.push('## Files Claimed');
      for (const file of files) {
        const claimed = ts(file.claimedAt).split(' ')[1] || '';
        const released = file.releasedAt ? ts(file.releasedAt).split(' ')[1] : 'still held';
        lines.push(`- ${file.filePath} (claimed ${claimed}, ${file.releasedAt ? `released ${released}` : released})`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Ensure the .portdaddy/ directory structure exists.
   */
  function ensureDir(projectRoot: string): string {
    const pdDir = join(projectRoot, '.portdaddy');
    mkdirSync(join(pdDir, 'agents'), { recursive: true });
    mkdirSync(join(pdDir, 'sessions'), { recursive: true });

    // Write .gitignore if it doesn't exist
    const gitignorePath = join(pdDir, '.gitignore');
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, [
        '# Ephemeral/verbose -- do not track',
        'activity.log',
        '',
        '# Track briefing + archives (valuable team context)',
        '!briefing.md',
        '!briefing.json',
        '!sessions/',
        '!agents/',
        '',
      ].join('\n'));
    }

    return pdDir;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Generate briefing.md and briefing.json in .portdaddy/
   */
  function generate(projectRoot: string, options: { project?: string | null; writeToDisk?: boolean } = {}): GenerateResult {
    if (!projectRoot || typeof projectRoot !== 'string') {
      return { success: false, error: 'projectRoot must be a non-empty string' };
    }

    const resolvedRoot = resolve(projectRoot);
    const project = detectProject(resolvedRoot, options.project);
    const data = gatherData(project, resolvedRoot);

    // If writeToDisk is false, just return the data
    if (options.writeToDisk === false) {
      return { success: true, briefing: data };
    }

    const pdDir = ensureDir(resolvedRoot);
    const files: string[] = [];

    // Write briefing.md
    const md = renderMarkdown(data);
    const mdPath = join(pdDir, 'briefing.md');
    writeFileSync(mdPath, md);
    files.push(mdPath);

    // Write briefing.json
    const jsonPath = join(pdDir, 'briefing.json');
    writeFileSync(jsonPath, JSON.stringify(data, null, 2));
    files.push(jsonPath);

    return {
      success: true,
      briefingPath: pdDir,
      files,
      briefing: data,
    };
  }

  /**
   * Full sync: generate briefing + archive completed sessions + write activity log.
   */
  function sync(projectRoot: string, options: { project?: string | null; full?: boolean } = {}): SyncResult {
    if (!projectRoot || typeof projectRoot !== 'string') {
      return { success: false, error: 'projectRoot must be a non-empty string' };
    }

    const resolvedRoot = resolve(projectRoot);
    const project = detectProject(resolvedRoot, options.project);

    // Generate the briefing first
    const genResult = generate(resolvedRoot, { project });
    if (!genResult.success) {
      return { success: false, error: genResult.error };
    }

    const pdDir = ensureDir(resolvedRoot);
    const files = genResult.files ? [...genResult.files] : [];
    let archivedSessions = 0;
    let archivedAgents = 0;

    // Archive completed/abandoned sessions
    const completedSessions = sessions.list({ allWorktrees: true, includeNotes: false, limit: 100 });
    for (const session of (completedSessions.sessions || []).filter(
      (s: FormattedSession) => (s.status === 'completed' || s.status === 'abandoned')
    )) {
      // Check if this session belongs to our project
      const belongsToProject = session.identityProject === project ||
        (getWorktreeInfo(resolvedRoot)?.id && session.worktreeId === getWorktreeInfo(resolvedRoot)?.id);

      if (belongsToProject) {
        const result = archiveSession(resolvedRoot, session.id);
        if (result) {
          files.push(result);
          archivedSessions++;
        }
      }
    }

    // Write activity log if full sync requested
    if (options.full) {
      const activityResult = activityLog.getRecent({ limit: 500, targetPattern: `${project}:*` });
      if (activityResult.entries && activityResult.entries.length > 0) {
        const logLines = activityResult.entries.map((e: ActivityEntry) => {
          const ts = new Date(e.timestamp).toISOString();
          return `[${ts}] ${e.type} ${e.targetId || ''} ${e.details || ''}`.trim();
        });
        const logPath = join(pdDir, 'activity.log');
        writeFileSync(logPath, logLines.join('\n') + '\n');
        files.push(logPath);
      }
    }

    return {
      success: true,
      briefingPath: pdDir,
      files,
      archivedSessions,
      archivedAgents,
    };
  }

  /**
   * Archive a single session to .portdaddy/sessions/<id>.md
   */
  function archiveSession(projectRoot: string, sessionId: string): string | null {
    const sessionData = sessions.get(sessionId);
    if (!sessionData || !sessionData.session) return null;

    const pdDir = ensureDir(resolve(projectRoot));
    const md = renderSessionArchive(
      sessionData.session,
      sessionData.notes || [],
      sessionData.files || []
    );

    const filePath = join(pdDir, 'sessions', `${sessionId}.md`);
    writeFileSync(filePath, md);
    return filePath;
  }

  /**
   * Read the current briefing from disk (if it exists).
   */
  function read(projectRoot: string): BriefingData | null {
    const jsonPath = join(resolve(projectRoot), '.portdaddy', 'briefing.json');
    if (!existsSync(jsonPath)) return null;

    try {
      return JSON.parse(readFileSync(jsonPath, 'utf8')) as BriefingData;
    } catch {
      return null;
    }
  }

  return {
    generate,
    sync,
    archiveSession,
    read,
    detectProject,
    gatherData,
    renderMarkdown,
  };
}
