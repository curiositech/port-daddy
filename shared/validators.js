/**
 * Input Validation Functions
 *
 * All validation functions used across routes, extracted from server.js.
 * Each validator returns { valid: boolean, error?: string, ...parsed }
 */

import { parseIdentity } from '../lib/identity.js';

// =============================================================================
// CONSTANTS
// =============================================================================

export const PROJECT_NAME_REGEX = /^[a-zA-Z0-9._-]+$/;
export const IDENTITY_REGEX = /^[a-zA-Z0-9._:*-]+$/;
export const PROJECT_NAME_MAX_LENGTH = 255;
export const PID_MIN = 1;
export const PID_MAX = 99999;

// =============================================================================
// VALIDATORS
// =============================================================================

/**
 * Validate a v1 project name
 */
export function validateProjectName(project) {
  if (!project || typeof project !== 'string') {
    return { valid: false, error: 'project name must be a non-empty string' };
  }
  if (project.length > PROJECT_NAME_MAX_LENGTH) {
    return { valid: false, error: `project name too long (max ${PROJECT_NAME_MAX_LENGTH} characters)` };
  }
  if (!PROJECT_NAME_REGEX.test(project)) {
    return { valid: false, error: 'project name contains invalid characters (use alphanumeric, dash, underscore, dot)' };
  }
  return { valid: true };
}

/**
 * Validate a v2 semantic identity
 */
export function validateIdentity(id) {
  if (!id || typeof id !== 'string') {
    return { valid: false, error: 'identity must be a non-empty string' };
  }
  if (id.length > 200) {
    return { valid: false, error: 'identity too long (max 200 characters)' };
  }
  if (!IDENTITY_REGEX.test(id)) {
    return { valid: false, error: 'identity contains invalid characters' };
  }
  return parseIdentity(id);
}

/**
 * Validate a process ID
 */
export function validatePid(pidValue) {
  if (pidValue === undefined || pidValue === null) {
    return { valid: true, pid: null };
  }
  const pid = parseInt(pidValue, 10);
  if (isNaN(pid) || pid < PID_MIN || pid > PID_MAX) {
    return { valid: false, error: `PID must be between ${PID_MIN} and ${PID_MAX}` };
  }
  return { valid: true, pid };
}

/**
 * Validate a port number
 */
export function validatePort(portValue) {
  if (portValue === undefined || portValue === null) {
    return { valid: true, port: null };
  }
  const port = parseInt(portValue, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    return { valid: false, error: 'port must be between 1 and 65535' };
  }
  return { valid: true, port };
}

/**
 * Validate a preferred port against range and reserved list
 */
export function validatePreferredPort(portValue, rangeStart, rangeEnd, reservedPorts) {
  const baseValidation = validatePort(portValue);
  if (!baseValidation.valid) return baseValidation;
  if (baseValidation.port === null) return { valid: true, port: null };

  const port = baseValidation.port;
  if (port < rangeStart || port > rangeEnd) {
    return { valid: false, error: `preferred port must be in range ${rangeStart}-${rangeEnd}` };
  }
  if (reservedPorts.includes(port)) {
    return { valid: false, error: 'preferred port is reserved and cannot be assigned' };
  }
  return { valid: true, port };
}

/**
 * Validate a channel name
 */
export function validateChannel(channel) {
  if (!channel || typeof channel !== 'string') {
    return { valid: false, error: 'channel must be a non-empty string' };
  }
  if (channel.length > 100) {
    return { valid: false, error: 'channel name too long (max 100 characters)' };
  }
  if (!/^[a-zA-Z0-9._:*-]+$/.test(channel)) {
    return { valid: false, error: 'channel contains invalid characters' };
  }
  return { valid: true };
}

/**
 * Validate a URL
 */
export function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'url must be a non-empty string' };
  }
  if (url.length > 2048) {
    return { valid: false, error: 'url too long (max 2048 characters)' };
  }
  try {
    const parsed = new URL(url);
    const allowed = ['http:', 'https:', 'ws:', 'wss:'];
    if (!allowed.includes(parsed.protocol)) {
      return { valid: false, error: 'invalid URL protocol (must be http, https, ws, or wss)' };
    }
    return { valid: true, url };
  } catch {
    return { valid: false, error: 'malformed URL' };
  }
}

/**
 * Validate an environment name
 */
export function validateEnv(env) {
  if (!env || typeof env !== 'string') {
    return { valid: false, error: 'env must be a non-empty string' };
  }
  if (env.length > 50) {
    return { valid: false, error: 'env name too long (max 50 characters)' };
  }
  if (!/^[a-z0-9_-]+$/.test(env)) {
    return { valid: false, error: 'env contains invalid characters (use lowercase alphanumeric, dash, underscore)' };
  }
  return { valid: true };
}

/**
 * Validate metadata object
 */
export function validateMetadata(metadata) {
  if (metadata === undefined || metadata === null) {
    return { valid: true, metadata: null };
  }
  const str = JSON.stringify(metadata);
  if (str.length > 10000) {
    return { valid: false, error: 'metadata too large (max 10KB)' };
  }
  return { valid: true, metadata };
}

/**
 * Validate service status
 */
export function validateStatus(status) {
  const allowed = ['assigned', 'running', 'stopped', 'crashed'];
  if (!status) {
    return { valid: true, status: undefined };
  }
  if (!allowed.includes(status)) {
    return { valid: false, error: `invalid status (must be one of: ${allowed.join(', ')})` };
  }
  return { valid: true, status };
}

/**
 * Validate lock name
 */
export function validateLockName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'lock name must be a non-empty string' };
  }
  if (name.length > 100) {
    return { valid: false, error: 'lock name too long (max 100 characters)' };
  }
  if (!/^[a-zA-Z0-9._:*-]+$/.test(name)) {
    return { valid: false, error: 'lock name must be alphanumeric with dashes, underscores, dots, colons, or stars' };
  }
  return { valid: true };
}

/**
 * Validate agent ID
 */
export function validateAgentId(id) {
  if (!id || typeof id !== 'string') {
    return { valid: false, error: 'agent id must be a non-empty string' };
  }
  if (id.length > 100) {
    return { valid: false, error: 'agent id too long (max 100 characters)' };
  }
  if (!/^[a-zA-Z0-9._:*-]+$/.test(id)) {
    return { valid: false, error: 'agent id contains invalid characters' };
  }
  return { valid: true };
}
