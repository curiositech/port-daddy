const fs = require('fs');
const crypto = require('crypto');
// existing code...
const checksum = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
fs.writeFileSync('public/skill-audit.json', JSON.stringify(data, null, 2) + '\n// CHECKSUM: ' + checksum);