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
import { mkdirSync, writeFileSync, existsSync, readFileSync, realpathSync } from 'fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { getWorktreeInfo } from './worktree.js';
import { findConfig, loadConfig } from './config.js';
import { findFleetConfigPath, loadFleetConfig } from './fleet-engine.js';
import { validateProjectRoot } from './utils.js';

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
  sessionPurpose?: string;
  agentId?: string | null;
  identityProject?: string | null;
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
  metadata?: Record<string, unknown> | null;
  summary?: string | null;
  files?: string[];
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

  function cleanText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  function collectMetadataFiles(entry: ActivityEntry, key: 'files' | 'releasedFiles'): string[] {
    const values = entry.metadata?.[key];
    if (!Array.isArray(values)) return [];
    return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  }

  function summarizeTouchedFiles(files: string[], label: string): string {
    if (files.length === 0) return '';
    const preview = files.slice(0, 3).join(', ');
    const suffix = files.length > 3 ? ` +${files.length - 3} more` : '';
    return `${label}: ${preview}${suffix}`;
  }

  function summarizeActivityEntry(entry: ActivityEntry): string {
    const details = cleanText(entry.details);
    const files = collectMetadataFiles(entry, 'files');
    const releasedFiles = collectMetadataFiles(entry, 'releasedFiles');
    const sessionId = cleanText(entry.metadata?.sessionId);

    switch (entry.type) {
      case 'agent.heartbeat':
      case 'session.note':
        return '';
      case 'session.start':
      case 'sugar_begin':
        return details;
      case 'session.end':
        if (details.length > 0) return details;
        if (releasedFiles.length > 0) return summarizeTouchedFiles(releasedFiles, 'Released');
        return '';
      case 'message.publish':
        return details.length > 4 ? details : '';
      case 'file.claim':
        return summarizeTouchedFiles(files, 'Claimed');
      case 'file.release':
        return summarizeTouchedFiles(files.length > 0 ? files : releasedFiles, 'Released');
      default:
        if (details.length > 0) return details;
        if (files.length > 0) return summarizeTouchedFiles(files, 'Files');
        if (releasedFiles.length > 0) return summarizeTouchedFiles(releasedFiles, 'Released');
        if (sessionId) return sessionId;
        return '';
    }
  }

  function activityTouchedFiles(entry: ActivityEntry): string[] {
    return [...new Set([...collectMetadataFiles(entry, 'files'), ...collectMetadataFiles(entry, 'releasedFiles')])];
  }

  function sessionBelongsToProject(session: FormattedSession, project: string, worktreeId: string | null): boolean {
    if (session.identityProject) return session.identityProject === project;
    if (worktreeId && session.worktreeId) return session.worktreeId === worktreeId;
    return false;
  }

  function activityBelongsToProject(
    entry: ActivityEntry,
    project: string,
    worktreeId: string | null,
    sessionIds: Set<string>,
    agentIds: Set<string>
  ): boolean {
    const metadata = entry.metadata && typeof entry.metadata === 'object'
      ? entry.metadata as Record<string, unknown>
      : null;

    const metadataProject = typeof metadata?.identityProject === 'string'
      ? metadata.identityProject
      : typeof metadata?.project === 'string'
        ? metadata.project
        : null;
    const metadataWorktreeId = typeof metadata?.worktreeId === 'string' ? metadata.worktreeId : null;
    const metadataSessionId = typeof metadata?.sessionId === 'string' ? metadata.sessionId : null;
    const metadataAgentId = typeof metadata?.agentId === 'string' ? metadata.agentId : null;

    if (metadataProject === project) return true;
    if (worktreeId && metadataWorktreeId === worktreeId) return true;
    if (metadataSessionId && sessionIds.has(metadataSessionId)) return true;
    if (entry.agentId && agentIds.has(entry.agentId)) return true;
    if (metadataAgentId && agentIds.has(metadataAgentId)) return true;

    if (entry.targetId) {
      if (entry.targetId === project || entry.targetId.startsWith(`${project}:`)) return true;
      if (worktreeId && (entry.targetId === worktreeId || entry.targetId.startsWith(`${worktreeId}:`))) return true;
    }

    return false;
  }

  function getProjectActivity(
    project: string,
    worktreeId: string | null,
    projectSessions: FormattedSession[],
    activeAgents: FormattedAgent[],
    limit = 30,
    scanLimit = 500
  ): ActivityEntry[] {
    const sessionIds = new Set(projectSessions.map(session => session.id));
    const agentIds = new Set<string>();
    for (const session of projectSessions) {
      if (session.agentId) agentIds.add(session.agentId);
    }
    for (const agent of activeAgents) {
      if (agent.id) agentIds.add(agent.id);
    }

    const activityResult = activityLog.getRecent({ limit: scanLimit });
    return (activityResult.entries || [])
      .filter((entry: ActivityEntry) => activityBelongsToProject(entry, project, worktreeId, sessionIds, agentIds))
      .map((entry: ActivityEntry) => ({
        ...entry,
        summary: summarizeActivityEntry(entry),
        files: activityTouchedFiles(entry),
      }))
      .slice(0, limit);
  }

  /**
   * Detect the project name for a given directory.
   * Priority: explicit override > root fleet name > root .portdaddyrc > root name.
   * A linked worktree's directory name is not its configured project identity.
   */
  function detectProject(projectRoot: string, explicitProject?: string | null): string {
    if (explicitProject) return explicitProject;

    const physicalDirectory = existsSync(projectRoot) ? realpathSync(projectRoot) : resolve(projectRoot);
    const info = getWorktreeInfo(physicalDirectory);
    const root = info ? realpathSync(info.root) : physicalDirectory;
    const withinRoot = relative(root, physicalDirectory);
    if (withinRoot === '..' || withinRoot.startsWith(`..${sep}`) || isAbsolute(withinRoot)) {
      throw new Error('Briefing worktree root does not contain projectRoot');
    }

    // Resolve only the selected physical root's config. Never inherit a sibling
    // repository's config through parent traversal or a config-file symlink.
    const fleetPath = findFleetConfigPath(root);
    if (fleetPath && dirname(realpathSync(fleetPath)) === root) {
      const fleet = loadFleetConfig(root);
      if (fleet?.name) return fleet.name;
    }

    // Keep the existing local rc contract, but not an ancestor's project name.
    try {
      const configPath = findConfig(root);
      if (configPath && dirname(realpathSync(configPath)) === root) {
        const config = loadConfig(root);
        if (config?.project) return config.project;
      }
    } catch {
      // No usable root-local rc config found.
    }

    return basename(root) || 'unknown';
  }

  /**
   * Gather all project-scoped data for the briefing.
   */
  function gatherData(project: string, projectRoot: string): BriefingData {
    // Get worktree info for worktree-scoped queries
    const worktreeInfo = getWorktreeInfo(projectRoot);
    const worktreeId = worktreeInfo?.id ?? null;

    // Active sessions — filter by worktree if available, otherwise show all
    const sessionOpts: Record<string, unknown> = { status: 'active', allWorktrees: true, includeNotes: false, limit: 50 };
    const allSessions = sessions.list(sessionOpts);
    const activeSessions = (allSessions.sessions || []).filter((s: FormattedSession) =>
      sessionBelongsToProject(s, project, worktreeId)
    );

    const recentSessions = sessions.list({ allWorktrees: true, includeNotes: false, limit: 100 });
    const projectSessions = (recentSessions.sessions || []).filter((s: FormattedSession) =>
      sessionBelongsToProject(s, project, worktreeId)
    );

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
      return projectSessions.some((s: FormattedSession) => s.id === c.sessionId);
    });

    // Recent activity — prefer explicit metadata/session ownership over brittle target prefix matching
    const recentActivity = getProjectActivity(project, worktreeId, projectSessions, activeAgents, 30, 500);

    // Recent notes from active sessions
    const recentNotes: FormattedNote[] = [];
    for (const session of activeSessions.slice(0, 10)) {
      const notesResult = sessions.getNotes(session.id);
      if (notesResult.notes) {
        recentNotes.push(...notesResult.notes);
      }
    }
    // Also get notes from recently completed sessions (last 7 days)
    for (const session of projectSessions.filter((s: FormattedSession) =>
      s.status !== 'active' && s.completedAt && (Date.now() - s.completedAt) < 7 * 24 * 60 * 60 * 1000
    )) {
      const notesResult = sessions.getNotes(session.id);
      if (notesResult.notes) {
        recentNotes.push(...notesResult.notes);
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
    const activeAgentIds = new Set(data.activeAgents.map(agent => agent.id));
    const liveBodySessions = data.activeSessions.filter(session => session.agentId && activeAgentIds.has(session.agentId));
    const orphanedActiveSessions = data.activeSessions.filter(session => !session.agentId || !activeAgentIds.has(session.agentId));
    lines.push(`- **Active sessions with live agents:** ${liveBodySessions.length}${liveBodySessions.length > 0 ? ` (${liveBodySessions.map(s => s.purpose).join(', ')})` : ''}`);
    if (orphanedActiveSessions.length > 0) {
      lines.push(`- **Orphaned active sessions:** ${orphanedActiveSessions.length} (${orphanedActiveSessions.map(s => s.purpose).join(', ')})`);
    }
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
        const summary = cleanText(entry.summary) || cleanText(entry.details) || `${entry.type} ${entry.targetId || ''}`.trim();
        lines.push(`- [${time}] ${summary}`);
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

    // Defence-in-depth: validate even if route layer already checked
    const pathCheck = validateProjectRoot(projectRoot);
    if (!pathCheck.ok) {
      return { success: false, error: pathCheck.error };
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

    // Defence-in-depth: validate even if route layer already checked
    const pathCheck = validateProjectRoot(projectRoot);
    if (!pathCheck.ok) {
      return { success: false, error: pathCheck.error };
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
      const activityEntries = getProjectActivity(project, getWorktreeInfo(resolvedRoot)?.id ?? null, genResult.briefing?.activeSessions || [], genResult.briefing?.activeAgents || [], 500, 500);
      if (activityEntries.length > 0) {
        const logLines = activityEntries.map((e: ActivityEntry) => {
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

  /**
   * Generate a context-budget-aware compressed briefing for an agent.
   *
   * Compact-from-artifacts: all tiers query the DB directly.
   * The on-disk briefing.md / briefing.json is a CACHE — never a source here.
   *
   * Every retained item carries a (type, id) pointer so the receiving agent
   * can fetch full content. This is zoom enforcement: no terminal summaries.
   *
   * Budget tiers (tokens):
   *   > 80k → full   (current generate() content)
   *   40k–80k → summary (top 5 notes + salvage queue)
   *   20k–40k → minimal (handoff notes + salvage count only)
   *   < 20k  → emergency (unresolved handoffs + spawn new agent advisory)
   */
  function generateCompressed(agentId: string, contextBudgetTokens: number): CompressedBriefing {
    const now = Date.now();

    if (contextBudgetTokens > 80_000) {
      // Full tier: pull all active sessions, notes, claims from DB
      const activeSessions = db.prepare(`
        SELECT id, agent_id, purpose, phase, identity_project, updated_at, status
        FROM sessions WHERE status = 'active' ORDER BY updated_at DESC LIMIT 20
      `).all() as Array<Record<string, unknown>>;

      const recentNotes = db.prepare(`
        SELECT sn.id, sn.session_id, sn.content, sn.type, sn.created_at,
               s.purpose as session_purpose, s.identity_project
        FROM session_notes sn
        JOIN sessions s ON s.id = sn.session_id
        WHERE sn.created_at > ?
        ORDER BY sn.created_at DESC LIMIT 30
      `).all(now - 24 * 60 * 60 * 1000) as Array<Record<string, unknown>>;

      return {
        tier: 'full',
        agentId,
        contextBudgetTokens,
        generatedAt: new Date().toISOString(),
        activeSessions: activeSessions.map(s => ({
          type: 'session' as const, id: s.id as string,
          purpose: s.purpose as string, phase: s.phase as string,
          identityProject: s.identity_project as string | null,
        })),
        recentNotes: recentNotes.map(n => ({
          type: 'note' as const, id: String(n.id),
          content: (n.content as string).slice(0, 500),
          noteType: n.type as string,
          sessionPurpose: n.session_purpose as string | null,
        })),
        handoffs: [],
        advisory: null,
      };
    }

    // All tiers below: recall pass — pull handoff notes first (load-bearing facts)
    const handoffs = db.prepare(`
      SELECT sn.id, sn.session_id, sn.content, sn.created_at,
             s.purpose as session_purpose, s.identity_project
      FROM session_notes sn
      JOIN sessions s ON s.id = sn.session_id
      WHERE sn.type = 'handoff' AND s.status = 'active'
      ORDER BY sn.created_at DESC LIMIT 10
    `).all() as Array<Record<string, unknown>>;

    const salvageCount: number = (db.prepare(
      `SELECT COUNT(*) as c FROM sessions WHERE status = 'abandoned' AND updated_at > ?`
    ).get(now - 7 * 24 * 60 * 60 * 1000) as { c: number } | undefined)?.c ?? 0;

    if (contextBudgetTokens >= 40_000) {
      // Summary tier
      const topNotes = db.prepare(`
        SELECT sn.id, sn.session_id, sn.content, sn.type, sn.created_at,
               s.purpose as session_purpose, s.identity_project
        FROM session_notes sn
        JOIN sessions s ON s.id = sn.session_id
        WHERE sn.type IN ('handoff','finding','design','idea')
        ORDER BY sn.created_at DESC LIMIT 5
      `).all() as Array<Record<string, unknown>>;

      const activeCount: number = (db.prepare(
        `SELECT COUNT(*) as c FROM sessions WHERE status = 'active'`
      ).get() as { c: number } | undefined)?.c ?? 0;

      return {
        tier: 'summary',
        agentId,
        contextBudgetTokens,
        generatedAt: new Date().toISOString(),
        activeSessions: [{ type: 'meta' as const, id: 'count', count: activeCount }],
        recentNotes: topNotes.map(n => ({
          type: 'note' as const, id: String(n.id),
          content: (n.content as string).slice(0, 300),
          noteType: n.type as string,
          sessionPurpose: n.session_purpose as string | null,
        })),
        handoffs: handoffs.map(n => ({
          type: 'note' as const, id: String(n.id),
          noteType: 'handoff',
          content: (n.content as string).slice(0, 500),
          sessionPurpose: n.session_purpose as string | null,
        })),
        advisory: salvageCount > 0 ? `Salvage queue: ${salvageCount} sessions. Run pd salvage to review.` : null,
      };
    }

    if (contextBudgetTokens >= 20_000) {
      // Minimal tier
      return {
        tier: 'minimal',
        agentId,
        contextBudgetTokens,
        generatedAt: new Date().toISOString(),
        activeSessions: [],
        recentNotes: [],
        handoffs: handoffs.slice(0, 3).map(n => ({
          type: 'note' as const, id: String(n.id),
          noteType: 'handoff',
          content: (n.content as string).slice(0, 200),
          sessionPurpose: n.session_purpose as string | null,
        })),
        advisory: `Context low. Open handoffs: ${handoffs.length}. Salvage queue: ${salvageCount}. Consider spawning a continuation agent.`,
      };
    }

    // Emergency tier
    return {
      tier: 'emergency',
      agentId,
      contextBudgetTokens,
      generatedAt: new Date().toISOString(),
      activeSessions: [],
      recentNotes: [],
      handoffs: handoffs.slice(0, 2).map(n => ({
        type: 'note' as const, id: String(n.id),
        noteType: 'handoff',
        content: (n.content as string).slice(0, 100),
        sessionPurpose: n.session_purpose as string | null,
      })),
      advisory: `CONTEXT CRITICAL. Spawn new agent immediately. Open handoffs: ${handoffs.length}. Pending approvals: 0.`,
    };
  }

  return {
    generate,
    sync,
    archiveSession,
    read,
    detectProject,
    gatherData,
    renderMarkdown,
    generateCompressed,
  };
}

export interface BriefingPointer {
  type: 'note' | 'session' | 'episode' | 'claim' | 'meta';
  id: string;
  count?: number;
  content?: string;
  noteType?: string;
  sessionPurpose?: string | null;
  purpose?: string;
  phase?: string;
  identityProject?: string | null;
}

export interface CompressedBriefing {
  tier: 'full' | 'summary' | 'minimal' | 'emergency';
  agentId: string;
  contextBudgetTokens: number;
  generatedAt: string;
  activeSessions: BriefingPointer[];
  recentNotes: BriefingPointer[];
  handoffs: BriefingPointer[];
  advisory: string | null;
}
