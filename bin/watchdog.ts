import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { getDaemonTcpUrl } from '../shared/daemon-discovery.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PID_FILE = join(__dirname, '../.portdaddy/watchdog.pid');
const DAEMON_URL = getDaemonTcpUrl(process.env.PORT_DADDY_URL);

async function checkHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${DAEMON_URL}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}

function startDaemon() {
  console.log(`[Watchdog] ⚓ Daemon not responding at ${DAEMON_URL}. Initiating restart...`);
  const out = spawn('npm', ['run', 'daemon:start'], {
    detached: true,
    stdio: 'ignore',
    cwd: join(__dirname, '..')
  });
  out.unref();
}

async function watch() {
  // Save watchdog PID
  writeFileSync(PID_FILE, process.pid.toString());
  
  process.on('SIGINT', () => {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
    process.exit(0);
  });

  console.log(`[Watchdog] 🐕 Port Daddy Watchdog active. Monitoring ${DAEMON_URL}...`);

  while (true) {
    const isHealthy = await checkHealth();
    if (!isHealthy) {
      startDaemon();
      // Wait longer after a restart attempt
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  watch();
}
