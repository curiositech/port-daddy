/**
 * lib/squid/bridge-client-home.ts — a clean, isolated Claude Code config home
 * for bridged (Codex-piloted) sessions.
 *
 * THE PROBLEM this solves: when `pd squid codex` points Claude Code at the local
 * bridge with a bearer token, Claude Code ALSO sees the operator's stored
 * claude.ai login and warns "Auth conflict: Both a token and an API key are
 * set." It may also stop for a folder-trust prompt and onboarding. None of that
 * is something a user running one `pd squid codex` command should ever face.
 *
 * THE FIX: give the bridged session its own CLAUDE_CONFIG_DIR, pre-seeded so it
 * has NO stored login (so the bridge bearer token is the sole credential — no
 * conflict), onboarding marked complete, and the launch directory already
 * trusted. Combined with bearer-only auth (no ANTHROPIC_API_KEY), the session
 * boots straight into a working REPL with the ◆ PD⇄CODEX badge.
 *
 * Project-level config (`<cwd>/.claude/settings.json` — the statusline, hooks)
 * is read from the working directory and is unaffected by CLAUDE_CONFIG_DIR, so
 * the harness identity and coordination hooks still apply.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PD_HOME } from '../../shared/paths.js';

/** Where the isolated bridge-client config home lives. */
export function squidClaudeHomeDir(): string {
  return process.env.PD_SQUID_CLAUDE_HOME || join(PD_HOME, 'squid-claude-home');
}

interface ClaudeConfigSeed {
  hasCompletedOnboarding?: boolean;
  theme?: string;
  projects?: Record<string, Record<string, unknown>>;
  [k: string]: unknown;
}

/** Best-effort read of the operator's theme so the bridged UI isn't jarring. */
function operatorTheme(home = process.env.HOME || ''): string {
  try {
    const cfg = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')) as { theme?: string };
    if (typeof cfg.theme === 'string' && cfg.theme) return cfg.theme;
  } catch {
    /* fall through */
  }
  return 'dark';
}

/**
 * Ensure the isolated Claude config home exists and trusts `cwd`. Idempotent and
 * additive: re-running for a new directory adds that directory to the trusted
 * projects map without disturbing prior entries. Returns the home path to hand
 * to CLAUDE_CONFIG_DIR. Never throws — on any failure it returns null and the
 * caller simply launches without isolation (degraded, not broken).
 */
export function ensureSquidClaudeHome(cwd: string, home = process.env.HOME || ''): string | null {
  try {
    const dir = squidClaudeHomeDir();
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, '.claude.json');

    let seed: ClaudeConfigSeed = {};
    if (existsSync(configPath)) {
      try {
        seed = JSON.parse(readFileSync(configPath, 'utf8')) as ClaudeConfigSeed;
      } catch {
        seed = {}; // corrupt → reseed from scratch
      }
    }

    seed.hasCompletedOnboarding = true;
    if (!seed.theme) seed.theme = operatorTheme(home);
    if (!seed.projects || typeof seed.projects !== 'object') seed.projects = {};
    seed.projects[cwd] = {
      ...(seed.projects[cwd] as Record<string, unknown> | undefined),
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
      projectOnboardingSeenCount: 9,
      allowedTools: [],
    };

    writeFileSync(configPath, JSON.stringify(seed, null, 2) + '\n', 'utf8');
    return dir;
  } catch {
    return null;
  }
}
