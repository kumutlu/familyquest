import { execSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { countFamiliesForE2E } from './utils/adultInvite';
import { completePostAuth, driveToStep, getOnboardingOutcome } from './utils/onboardingFlow';

test.beforeEach(() => execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' }));

test('real verification link preserves and resumes UID-bound family onboarding', async ({ page, context }) => {
  const email = `verify-${Date.now()}@example.com`;
  const familyCountBeforeAuth = await countFamiliesForE2E();
  const persona = {
    parent: 'Pending Parent', relationship: 'Dad', child: 'QA Child',
    family: 'Verified QA Family', email, password: 'password123',
  };
  await page.goto('/onboarding');
  await driveToStep(page, persona, 's7');
  await page.getByRole('button', { name: /continue with email/i }).click();
  await page.locator('input[type="text"]').fill(persona.parent);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(persona.password);
  await page.getByRole('button', { name: /^sign up$/i }).click();

  await expect(page).toHaveURL(/\/verify-email$/);
  await expect(page.getByRole('heading', { name: /verify your email/i })).toBeVisible();
  expect(await countFamiliesForE2E()).toBe(familyCountBeforeAuth);
  await page.reload();
  await expect(page).toHaveURL(/\/verify-email$/);
  await expect(page.getByRole('heading', { name: /verify your email/i })).toBeVisible();

  const verificationLink = execSync('npx tsx tests/e2e/utils/readVerificationLink.ts', {
    encoding: 'utf8', env: { ...process.env, ONBOARDING_EMAIL: email },
  });
  const firebaseAction = new URL(verificationLink.trim());
  const handlerSearch = new URLSearchParams({
    mode: firebaseAction.searchParams.get('mode') ?? 'verifyEmail',
    oobCode: firebaseAction.searchParams.get('oobCode') ?? '',
    continueUrl: 'https://evil.example/steal',
    lang: firebaseAction.searchParams.get('lang') ?? 'en',
  });
  const verificationPage = await context.newPage();
  await verificationPage.goto(`/auth/action?${handlerSearch}`);
  await expect(verificationPage.getByRole('heading', { name: /email verified/i })).toBeVisible();
  await verificationPage.getByRole('button', { name: /^continue$/i }).click();
  await expect(verificationPage).toHaveURL(url => url.pathname === '/verify-email');
  expect(new URL(verificationPage.url()).hostname).not.toBe('evil.example');
  const verified = JSON.parse(execSync('npx tsx tests/e2e/utils/readEmailVerified.ts', {
    encoding: 'utf8', env: { ...process.env, ONBOARDING_EMAIL: email },
  }));
  expect(verified.emailVerified).toBe(true);
  await verificationPage.close();

  await page.getByRole('button', { name: /i've verified my email/i }).click();
  await expect(page).toHaveURL(/\/onboarding\?mode=create$/);
  await expect(page.getByRole('button', { name: 'Create a family' })).toHaveCount(0);
  await completePostAuth(page, persona);
  const outcome = await getOnboardingOutcome(email);
  expect(outcome).toMatchObject({
    familyCount: 1,
    childCount: 1,
    walletCount: 1,
    taskCount: 1,
    feedCount: 1,
  });
  expect(await countFamiliesForE2E()).toBe(familyCountBeforeAuth + 1);
});
