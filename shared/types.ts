/**
 * Port Daddy Core Types
 *
 * Shared type definitions for the daemon, SDK, CLI, and tests.
 */

import type { Request, Response, NextFunction } from 'express';
import type Database from 'better-sqlite3';

// =============================================================================
// Domain Models
// =============================================================================

/** A claimed port assignment */
export interface Service {
  id: string;
  port: number;
  pid: number | null;
  claimed_at: string;
  last_seen: string;
  metadata: string | null;
}

/** A distributed lock */
export interface Lock {
  name: string;
  owner: string;
  acquired_at: string;
  expires_at: string | null;
  metadata: string | null;
}

/** A registered agent */
export interface Agent {
  id: string;
  name: string | null;
  capabilities: string | null;
  registered_at: string;
  last_heartbeat: string;
  metadata: string | null;
}

/** A pub/sub message */
export interface Message {
  id: number;
  channel: string;
  payload: string;
  sender: string | null;
  published_at: string;
}

/** A webhook subscription */
export interface Webhook {
  id: number;
  url: string;
  events: string;
  secret: string | null;
  created_at: string;
  last_triggered: string | null;
  failure_count: number;
}

/** An activity log entry */
export interface ActivityEntry {
  id: number;
  type: string;
  action: string;
  target: string | null;
  details: string | null;
  agent_id: string | null;
  timestamp: string;
}

/** A registered project */
export interface Project {
  id: string;
  name: string;
  root_dir: string;
  services: string;  // JSON string of service configs
  created_at: string;
  updated_at: string;
  metadata: string | null;
}

// =============================================================================
// Stack Detection
// =============================================================================

export type StackType =
  | 'frontend'
  | 'api'
  | 'ssg'
  | 'mobile'
  | 'desktop'
  | 'worker'
  | 'container'
  | 'static'
  | 'bundler'
  | 'app';

export interface StackSignature {
  name: string;
  stackType: StackType;
  files: string[];
  dependencies: string[];
  pythonDeps?: string[];
  rubyDeps?: string[];
  phpDeps?: string[];
  javaDeps?: string[];
  elixirDeps?: string[];
  dotnetDeps?: string[];
  defaultPort: number;
  devCmd: string;
  startCmd: string;
  healthPath: string;
  portFlag?: string;
  portEnv?: string;
  portArg?: boolean;
}

export interface DetectedStack extends StackSignature {
  detected: 'file' | 'dependency' | 'python' | 'ruby' | 'php' | 'java' | 'elixir' | 'dotnet';
}

export interface SuggestedIdentity {
  project: string;
  stack: string;
  context: string;
  full: string;
}

// =============================================================================
// Module Factory Return Types
// =============================================================================

export interface ServiceManager {
  claim(id: string, preferredPort?: number, pid?: number, metadata?: Record<string, unknown>): Service;
  release(id: string): boolean;
  releaseByPattern(pattern: string): number;
  get(id: string): Service | undefined;
  list(pattern?: string): Service[];
  heartbeat(id: string): boolean;
  cleanup(): number;
}

export interface LockManager {
  acquire(name: string, owner: string, ttl?: number, metadata?: Record<string, unknown>): Lock;
  release(name: string, owner?: string): boolean;
  forceRelease(name: string): boolean;
  get(name: string): Lock | undefined;
  list(): Lock[];
  cleanup(): number;
}

export interface AgentManager {
  register(id: string, name?: string, capabilities?: string[], metadata?: Record<string, unknown>): Agent;
  unregister(id: string): boolean;
  heartbeat(id: string): boolean;
  get(id: string): Agent | undefined;
  list(): Agent[];
  cleanup(staleMs?: number): number;
}

export interface MessagingManager {
  publish(channel: string, payload: unknown, sender?: string): Message;
  getHistory(channel: string, limit?: number, since?: string): Message[];
  subscribe(channel: string, callback: (msg: Message) => void): () => void;
  getChannels(): string[];
  cleanup(maxAge?: number): number;
}

export interface WebhookManager {
  register(url: string, events: string[], secret?: string): Webhook;
  unregister(id: number): boolean;
  list(): Webhook[];
  trigger(event: string, payload: unknown): Promise<void>;
}

export interface ActivityManager {
  log(type: string, action: string, target?: string, details?: unknown, agentId?: string): ActivityEntry;
  query(options?: { type?: string; limit?: number; since?: string; agent?: string }): ActivityEntry[];
  cleanup(maxAge?: number): number;
}

export interface ProjectManager {
  register(project: Omit<Project, 'created_at' | 'updated_at'>): Project;
  get(id: string): Project | undefined;
  list(): Project[];
  remove(id: string): boolean;
  update(id: string, updates: Partial<Project>): Project | undefined;
}

// =============================================================================
// Configuration
// =============================================================================

export interface PortDaddyConfig {
  service?: {
    port?: number;
    socket?: string;
  };
  ports?: {
    min?: number;
    max?: number;
    reserved?: number[];
  };
  cleanup?: {
    intervalMs?: number;
    staleMs?: number;
  };
}

// =============================================================================
// Express Middleware Types
// =============================================================================

export type RouteHandler = (req: Request, res: Response, next?: NextFunction) => void | Promise<void>;

export interface DaemonContext {
  db: Database.Database;
  services: ServiceManager;
  locks: LockManager;
  agents: AgentManager;
  messaging: MessagingManager;
  webhooks: WebhookManager;
  activity: ActivityManager;
  projects: ProjectManager;
}

// =============================================================================
// SDK Types
// =============================================================================

export interface PortDaddyClientOptions {
  url?: string;
  socketPath?: string;
  agentId?: string;
  pid?: number;
  timeout?: number;
}

export interface ClaimResult {
  port: number;
  id: string;
  message: string;
}

export interface ReleaseResult {
  success: boolean;
  released: number;
  message: string;
}

export interface LockResult {
  name: string;
  owner: string;
  acquired_at: string;
  message: string;
}
