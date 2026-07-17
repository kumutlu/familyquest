const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src/lib/transactionErrors.ts');
const lines = fs.readFileSync(file, 'utf8').split('\n');

// Remove the stale duplicate comment block at lines 55..59 (1-based).
const start = 55;
const end = 59;
const before = lines.slice(0, start - 1);
const after = lines.slice(end);
const out = before.concat(after);
fs.writeFileSync(file, out.join('\n'));
console.log('Removed stale comment lines', start, '-', end);
