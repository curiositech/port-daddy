/**
 * Config Module
 *
 * Handles .portdaddyrc configuration files
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { detectStack, suggestIdentity, getDevCommand } from './detect.js';

const CONFIG_NAMES = ['.portdaddyrc', '.portdaddyrc.json', 'portdaddy.config.json'];

export interface ServiceConfig {
  dev?: string | null;
  preferredPort?: number;
  health?: string;
  needs?: string[];
  noPort?: boolean;
  env?: Record<string, string>;
  _detected?: string;
  [key: string]: unknown;
}

export interface PortDaddyRcConfig {
  project: string;
  portRange?: [number, number];
  services: Record<string, ServiceConfig>;
  tunnel?: {
    provider?: string;
    expose?: string[];
  };
  _path?: string;
  [key: string]: unknown;
}

/**
 * Find config file in directory or parents
 */
export function findConfig(dir: string = process.cwd()): string | null {
  let current = dir;

  while (current !== '/') {
    for (const name of CONFIG_NAMES) {
      const configPath = join(current, name);
      if (existsSync(configPath)) {
        return configPath;
      }
    }
    current = join(current, '..');
  }

  return null;
}

/**
 * Load config from file
 */
export function loadConfig(dir: string = process.cwd()): PortDaddyRcConfig | null {
  const configPath = findConfig(dir);
  if (!configPath) return null;

  try {
    const content = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content) as PortDaddyRcConfig;
    return { ...config, _path: configPath };
  } catch (err) {
    throw new Error(`Failed to parse ${configPath}: ${(err as Error).message}`);
  }
}

/**
 * Save config to file
 */
export function saveConfig(config: PortDaddyRcConfig, dir: string = process.cwd()): string {
  const errors = validateConfig(config);
  if (errors.length > 0) {
    throw new Error(`Invalid config: ${errors.join('; ')}`);
  }

  const configPath = join(dir, '.portdaddyrc');
  const { _path, ...rest } = config; // Remove internal _path
  writeFileSync(configPath, JSON.stringify(rest, null, 2) + '\n');
  return configPath;
}

/**
 * Generate initial config based on detection
 */
export function generateConfig(dir: string = process.cwd()): PortDaddyRcConfig {
  const stack = detectStack(dir);
  const identity = suggestIdentity(dir);

  const config: PortDaddyRcConfig = {
    // Project metadata
    project: identity.project,

    // Default port range for this project
    portRange: stack ? [stack.defaultPort, stack.defaultPort + 49] : [3100, 3199],

    // Services defined in this project
    services: {}
  };

  // Add detected service
  if (stack) {
    const serviceId = `${identity.stack}`;
    config.services[serviceId] = {
      // How to start this service
      dev: getDevCommand(stack, '${PORT}'),

      // Preferred port (will use next available if taken)
      preferredPort: stack.defaultPort,

      // Health check endpoint
      health: stack.healthPath || '/',

      // Auto-detected framework
      _detected: stack.name
    };
  }

  return config;
}

/**
 * Get service config by ID
 */
export function getServiceConfig(serviceId: string, config: PortDaddyRcConfig | null): ServiceConfig | null {
  if (!config?.services) return null;

  // Direct match
  if (config.services[serviceId]) {
    return config.services[serviceId];
  }

  // Try stack part only (e.g., "api" from "myapp:api:main")
  const parts = serviceId.split(':');
  if (parts.length > 1 && config.services[parts[1]]) {
    return config.services[parts[1]];
  }

  return null;
}

/**
 * Expand service command with port
 */
export function expandCommand(cmd: string | null | undefined, port: number | string): string | null {
  if (!cmd) return null;

  // Replace ${PORT} placeholder
  return cmd.replace(/\$\{PORT\}/g, String(port)).replace(/\$PORT/g, String(port));
}

/**
 * Validate config structure
 */
export function validateConfig(config: PortDaddyRcConfig): string[] {
  const errors: string[] = [];

  if (!config.project) {
    errors.push('Missing required field: project');
  }

  if (config.portRange) {
    if (!Array.isArray(config.portRange) || config.portRange.length !== 2) {
      errors.push('portRange must be an array of [min, max]');
    } else if (config.portRange[0] >= config.portRange[1]) {
      errors.push('portRange min must be less than max');
    }
  }

  if (config.services) {
    for (const [id, svc] of Object.entries(config.services)) {
      if (typeof svc !== 'object') {
        errors.push(`services.${id} must be an object`);
        continue;
      }

      if (svc.preferredPort && (typeof svc.preferredPort !== 'number' || svc.preferredPort < 1 || svc.preferredPort > 65535)) {
        errors.push(`services.${id}.preferredPort must be a valid port number`);
      }

      if (svc.needs && !Array.isArray(svc.needs)) {
        errors.push(`services.${id}.needs must be an array`);
      }
    }
  }

  return errors;
}

/**
 * Example config structure (for documentation)
 */
export const CONFIG_EXAMPLE: PortDaddyRcConfig = {
  // Project name (used as prefix for service IDs)
  project: 'myapp',

  // Port range for this project
  portRange: [3000, 3099],

  // Services in this project
  services: {
    // Frontend service
    frontend: {
      dev: 'npm run dev -- --port ${PORT}',
      preferredPort: 3000,
      health: '/',
      needs: ['api'] // Wait for API before starting
    },

    // API service
    api: {
      dev: 'npm run dev:api',
      preferredPort: 3001,
      health: '/health',
      env: {
        DATABASE_URL: 'postgresql://localhost:5432/myapp'
      }
    },

    // Worker service
    worker: {
      dev: 'npm run worker',
      needs: ['api'],
      noPort: true // Doesn't need a port
    }
  },

  // Tunnel configuration (optional)
  tunnel: {
    provider: 'ngrok', // or 'cloudflare'
    // Services to expose
    expose: ['frontend', 'api']
  }
};
