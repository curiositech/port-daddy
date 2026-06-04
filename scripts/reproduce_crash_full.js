/**
 * Full-Sweep Reproduction - Repro of Daemon Crash across all routes
 */
import http from 'http';

const ROUTES = [
  '/status',
  '/services',
  '/agents',
  '/locks',
  '/harbors',
  '/activity/timeline'
];

async function sweep() {
  console.log(`🔨 Hammering all routes...`);
  
  const promises = ROUTES.flatMap((path, i) => {
    return Array.from({ length: 10 }).map((_, j) => {
      return new Promise((resolve) => {
        http.get(`http://localhost:9876${path}`, (res) => {
          console.log(`[${path}] Status: ${res.statusCode}`);
          res.on('data', () => {});
          res.on('end', resolve);
        }).on('error', (err) => {
          console.error(`[${path}] Error: ${err.message}`);
          resolve(null);
        });
      });
    });
  });

  await Promise.all(promises);
  console.log('✅ Sweep complete.');
}

sweep();
