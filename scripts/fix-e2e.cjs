const fs = require('fs');
const path = 'tests/e2e/approval.spec.ts';
let s = fs.readFileSync(path, 'utf8');

// Fix child wallet route: /wallets -> /wallet (child uses singular /wallet)
s = s.split('a[href="/wallets"]').join('a[href="/wallet"]');

fs.writeFileSync(path, s);
console.log('fixed e2e child wallet routes');
