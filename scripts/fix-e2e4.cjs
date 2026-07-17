const fs = require('fs');
const path = 'tests/e2e/approval.spec.ts';
let lines = fs.readFileSync(path, 'utf8').split('\n');

// Find the index of the orphaned old test (the second "Money Request: child requests")
const orphanIdx = lines.findIndex(l => l.includes("test('Money Request: child requests from parent, parent approves"));
if (orphanIdx === -1) {
  console.log('no orphan found');
  process.exit(0);
}
// Keep everything up to orphanIdx (which is the blank line / closing of describe + orphaned tests)
// We want to truncate at orphanIdx (remove the orphaned tests entirely).
lines = lines.slice(0, orphanIdx);
// Trim trailing blank lines
while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
fs.writeFileSync(path, lines.join('\n') + '\n');
console.log('removed orphaned duplicate tests at line', orphanIdx);
