const fs = require('fs');
let content = fs.readFileSync('tests/firestore/behaviour.rules.test.ts', 'utf8');

const newCode = `  test.each([
    ['deposit', { type: 'deposit', childId: CHILD_ID, amount: 500, note: 'Pocket money', parentRef: PARENT_ID, createdAt: serverTimestamp() }],
    ['withdrawal', { type: 'withdrawal', childId: CHILD_ID, amount: 200, note: 'Shop', parentRef: PARENT_ID, createdAt: serverTimestamp() }],
    ['transfer', { type: 'transfer', childId: CHILD_ID, fromChildId: CHILD_ID, amount: 100, note: 'Share', parentRef: PARENT_ID, createdAt: serverTimestamp() }],
  ])('preserves the existing %s wallet transaction shape atomically', async (type, entry) => {
    const db = user(PARENT_ID);
    const batch = writeBatch(db);
    batch.set(doc(db, \`families/\${FAMILY_ID}/wallet_transactions/\${type}\`), entry);
    if (type !== 'transfer') {
      batch.update(doc(db, \`families/\${FAMILY_ID}/wallets/\${CHILD_ID}\`), {
        balance: type === 'deposit' ? 500 : -200,
        lastManualTxId: type
      });
    }
    await assertSucceeds(batch.commit());
  });`;

const oldCode = `  test.each([
    ['deposit', { type: 'deposit', childId: CHILD_ID, amount: 500, note: 'Pocket money', parentRef: PARENT_ID, createdAt: serverTimestamp() }],
    ['withdrawal', { type: 'withdrawal', childId: CHILD_ID, amount: 200, note: 'Shop', parentRef: PARENT_ID, createdAt: serverTimestamp() }],
    ['transfer', { type: 'transfer', childId: CHILD_ID, fromChildId: CHILD_ID, amount: 100, note: 'Share', parentRef: PARENT_ID, createdAt: serverTimestamp() }],
  ])('preserves the existing %s wallet transaction shape', async (type, entry) => {
    await assertSucceeds(setDoc(doc(user(PARENT_ID), \`families/\${FAMILY_ID}/wallet_transactions/\${type}\`), entry));
  });`;

content = content.replace(newCode, oldCode);
fs.writeFileSync('tests/firestore/behaviour.rules.test.ts', content);
