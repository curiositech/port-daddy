import * as fs from 'fs';
import { execSync } from 'child_process';

function publish(channel: string, payload: any) {
  console.log(`Publishing to ${channel}...`);
  try {
    const payloadStr = JSON.stringify(payload);
    // Use the PD CLI directly
    const cmd = `pd pub ${channel} '${payloadStr}'`;
    const result = execSync(cmd).toString();
    console.log(`Published to ${channel}. Result:`, result);
  } catch (err) {
    console.error('Failed to publish to Port Daddy via CLI:', err);
  }
}

console.log('Swarm Dev Watcher (Polling Mode + PD CLI) starting...');

const filesToWatch = [
  'lib/agents.ts',
  'lib/orchestrator.ts',
  'server.ts'
];

filesToWatch.forEach(file => {
  console.log(`Watching ${file}`);
  fs.watchFile(file, { interval: 1000 }, (curr, prev) => {
    if (curr.mtime !== prev.mtime) {
      console.log(`File ${file} changed. Signaling swarm...`);
      publish('fs:changed', { path: file, timestamp: Date.now() });
    }
  });
});

process.on('SIGINT', () => {
  process.exit();
});
