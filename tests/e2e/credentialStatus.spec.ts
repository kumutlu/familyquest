import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
// Match the Functions Admin SDK; the root SDK has a separate ESM dependency tree.
const requireAdmin = createRequire(new URL('../../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireAdmin('firebase-admin/app');
const { getFirestore } = requireAdmin('firebase-admin/firestore');
const { getAuth } = requireAdmin('firebase-admin/auth');

test('Manage Child ignores legacy public flags and fails closed on partial private state', async ({ page }) => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('LOCAL_EMULATORS_REQUIRED');
  const app = initializeApp({ projectId: 'demo-qr-review' }, `browser-${Date.now()}`);
  const db = getFirestore(app); const auth = getAuth(app);
  const suffix = Date.now().toString(); const parentId = `browser-parent-${suffix}`;
  const childId = `browser-child-${suffix}`; const familyId = `browser-family-${suffix}`;
  const email = `review-${suffix}@example.test`;
  try {
    await auth.createUser({ uid: parentId, email, emailVerified: true, password: 'ReviewPassword123!' });
    await auth.createUser({ uid: childId, displayName: 'Alex' });
    await db.doc(`families/${familyId}`).set({ name: 'Review Family', ownerId: parentId, inviteCode: 'REV123', currencyCode: 'GBP', currency: '£', createdAt: new Date() });
    await db.doc(`users/${parentId}`).set({ id: parentId, uid: parentId, familyId, role: 'owner', displayName: 'Review Parent', onboardingCompleted: true });
    await db.doc(`users/${childId}`).set({ id: childId, uid: childId, familyId, role: 'child', isManaged: true, displayName: 'Alex', authUid: childId, hasLogin: true, username: 'Alex', loginEnabled: true, rewardPoints: 0 });
    const link = db.doc(`families/${familyId}/childLogins/${childId}`);
    await link.set({ familyId, childId, authUid: childId, status: 'enabled' });
    await db.doc(`families/${familyId}/wallets/${childId}`).set({ balance: 0 });
    // Browser must use the explicitly configured demo project, never production.
    await page.goto('/login');
    await page.locator('input[type=email]').fill(email);
    await page.locator('input[type=password]').fill('ReviewPassword123!');
    await page.locator('button[type=submit]').click();
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 15000 });
    await page.goto('/family');
    await page.getByRole('button', { name: /View Alex/i }).first().click();
    await page.getByRole('button', { name: /Manage Member|Manage child/i }).first().click();
    await expect(page.getByText('Connected via personal device')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Login', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset Password', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Disable Login', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await link.update({ normalizedUsername: 'alex' });
    await page.getByRole('button', { name: /View Alex/i }).first().click();
    await page.getByRole('button', { name: /Manage Member|Manage child/i }).first().click();
    await expect(page.getByText(/Credential status unavailable/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset Password', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create Login', exact: true })).toHaveCount(0);
  } finally { await deleteApp(app); }
});
