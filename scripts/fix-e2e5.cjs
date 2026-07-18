const fs = require('fs');
const path = 'tests/e2e/approval.spec.ts';
let lines = fs.readFileSync(path, 'utf8').split('\n');

// Remove the premature describe-closing "});" at line 68 (index 67)
const closeIdx = lines.findIndex((l, i) => i > 60 && i < 75 && l.trim() === '});');
if (closeIdx === -1) {
  console.error('could not find describe close at ~68');
  process.exit(1);
}
lines.splice(closeIdx, 1);
// Trim trailing blank lines
while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
// Append the describe close at the very end
lines.push('});');
fs.writeFileSync(path, lines.join('\n') + '\n');
console.log('moved describe close to end of file');
