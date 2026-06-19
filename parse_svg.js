const fs = require('fs');
const svg = fs.readFileSync('website-v2/public/pd_logo.svg', 'utf8');

const matches = svg.match(/<path[^>]*fill="rgb\([^)]+\)"[^>]*>/g);
if (matches) {
  matches.forEach(m => {
    const fill = m.match(/fill="(rgb\([^)]+\))"/)[1];
    const d = m.match(/d="([^"]+)"/)[1];
    console.log(`${fill} - Path length: ${d.length}`);
  });
}
