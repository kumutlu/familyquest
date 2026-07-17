const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src/lib/transactionErrors.test.ts');
const lines = fs.readFileSync(file, 'utf8').split('\n');

// Fix the mangled `unavailable` test at lines 41..51 (1-based).
const start = 41;
const end = 51;

const clean = [
  "  it('maps unavailable to a connection-friendly profile message', () => {",
  "    const out = mapTransactionError(",
  "      { code: 'unavailable', message: 'backend down' },",
  "      { operation: 'submitProfileUpdateRequest' },",
  "    );",
  "    expect(out).toMatch(/connection|try again/i);",
  "    expect(out).not.toContain('backend down');",
  "  });",
];

const before = lines.slice(0, start - 1);
const after = lines.slice(end);
const out = before.concat(clean, after);
fs.writeFileSync(file, out.join('\n'));
console.log('Fixed unavailable test, lines', start, '-', end);
