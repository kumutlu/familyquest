const fs = require('fs');
const path = 'tests/e2e/approval.spec.ts';
let s = fs.readFileSync(path, 'utf8');

// Fix selectOption: Playwright expects a string label, not a regex.
// The option text rendered is "Parent Dad (Parent)".
s = s.split("selectOption({ label: /Parent Dad/ })").join("selectOption({ label: 'Parent Dad (Parent)' })");

fs.writeFileSync(path, s);
console.log('fixed selectOption label');
