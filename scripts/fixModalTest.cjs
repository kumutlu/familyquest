const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src/components/profile/ProfileEditorModal.test.tsx');
const lines = fs.readFileSync(file, 'utf8').split('\n');

// Replace lines 133..138 (1-based) — the duplicated callArgs block — with a
// single, correctly-typed version (cast mock.calls[0] to any[] to avoid the
// empty-tuple TS error).
const start = 133;
const end = 138;

const clean = [
  "    await waitFor(() => expect(submitMock).toHaveBeenCalled())",
  "    const callArgs = submitMock.mock.calls[0] as any[]",
  "    expect(callArgs[1]).toBe('Muhammed')",
  "    expect(callArgs[2]).toBeNull()",
  "  })",
];

const before = lines.slice(0, start - 1);
const after = lines.slice(end);
const out = before.concat(clean, after);
fs.writeFileSync(file, out.join('\n'));
console.log('Fixed duplicated callArgs block, lines', start, '-', end);
