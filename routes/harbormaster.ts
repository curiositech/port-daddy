/**
 * Harbormaster Routes — read-only daemon surface for the merge-owning actor.
 *
 * GET /harbormaster/status
 *
 * FleetBar polls this route to show whether the merge owner is alive and what
 * queue shape it sees. The route does not start, stop, or merge anything.
 */

import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHarbormaster, HARBORMASTER_ACTOR_ID } from '../lib/harbormaster.js';
import type Database from 'better-sqlite3';

const DEFAULT_PID_FILE = join(homedir(), '.port-daddy', 'harbormaster.pid');

interface HarbormasterRouteDeps {
  deps: {
    db?: Database.Database;
    harbormasterPidFile?: string;
  };
}

function readPidFile(pidFile = DEFAULT_PID_FILE): number | null {
  if (!existsSync(pidFile)) return null;
  try {
    const raw = readFileSync(pidFile, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const harbormasterPlugin: FastifyPluginAsync<HarbormasterRouteDeps> = async (fastify, { deps }) => {
  fastify.get('/harbormaster/status', async (_request, reply: FastifyReply) => {
    if (!deps.db) {
      return reply.code(503).send({
        ok: false,
        actor: HARBORMASTER_ACTOR_ID,
        error: 'harbormaster status requires daemon db',
      });
    }

    const pid = readPidFile(deps.harbormasterPidFile);
    const hm = createHarbormaster({ db: deps.db });
    return reply.send({
      ok: true,
      actor: HARBORMASTER_ACTOR_ID,
      body: {
        pid,
        alive: pid ? processAlive(pid) : false,
      },
      schemaReady: hm.schemaHasDispatchColumns(),
      queue: hm.queueSummary(),
    });
  });
};

export { harbormasterPlugin, readPidFile };
