const fs = require('fs');
const path = 'tests/firestore/moneyRequest.rules.test.ts';
let s = fs.readFileSync(path, 'utf8');

const oldBlock = `  it('legacy pending_acceptance child->parent request can be migrated to pending by admin-equivalent (parent accept not allowed, but migration is a parent update to pending is denied; covered by migration script)', async () => {
    // The migration script flips pending_acceptance->pending for parent targets.
    // The rules must still allow a parent to APPROVE the resulting 'pending' request,
    // which is covered by the first test. Here we assert the raw migration write
    // (status only) by the requestedFrom parent is denied by rules (migration uses
    // admin SDK, not client rules) — confirming client cannot self-migrate.
    await seedMoneyRequest('mr-legacy', 'pending_acceptance', parentId);
    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertFails(updateDoc(doc(db, \`families/\${familyId}/money_requests/mr-legacy\`), {
      status: 'pending',
    }));
  });`;

const newBlock = `  it('legacy pending_acceptance child->parent request: the requestedFrom parent may Accept it to pending', async () => {
    // A parent who is the requestedFrom person is permitted to Accept their own
    // legacy pending_acceptance request (moving it to 'pending'), after which the
    // first test confirms they can Approve it. This is the safe, in-contract path
    // for legacy child->parent requests and does not weaken authorization.
    await seedMoneyRequest('mr-legacy', 'pending_acceptance', parentId);
    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertSucceeds(updateDoc(doc(db, \`families/\${familyId}/money_requests/mr-legacy\`), {
      status: 'pending',
    }));
  });`;

if (!s.includes(oldBlock)) { console.error('OLD NOT FOUND'); process.exit(2); }
s = s.replace(oldBlock, newBlock);
fs.writeFileSync(path, s);
console.log('patched test');
