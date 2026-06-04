/**
 * Hammer Script - Reproduction of Daemon Crash
 */
import http from 'http';

const REQUESTS = 50;
const URL = 'http://localhost:9876/status';

async function hammer() {
  console.log(`🔨 Hammering ${URL} with ${REQUESTS} requests...`);
  
  const promises = Array.from({ length: REQUESTS }).map((_, i) => {
    return new Promise((resolve) => {
      http.get(URL, (res) => {
        console.log(`[${i}] Status: ${res.statusCode}`);
        res.on('data', () => {});
        res.on('end', resolve);
      }).on('error', (err) => {
        console.error(`[${i}] Error: ${err.message}`);
        resolve(null);
      });
    });
  });

  await Promise.all(promises);
  console.log('✅ Hammering complete.');
}

hammer();
