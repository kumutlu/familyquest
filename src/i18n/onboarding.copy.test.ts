import { describe, expect, it } from 'vitest';
import i18n from '../i18n/config';

describe('onboarding copy', () => {
  it('uses "Savings goals" (not "Saving goals") in the teaser and support copy', () => {
    expect(i18n.t('s5.teaserBullets.saving', { ns: 'onboarding' })).toBe('Savings goals');
    expect(i18n.t('p3.support', { ns: 'onboarding' })).toMatch(/savings goals/i);
  });

  it('exposes localized parent/child role labels without a separator', () => {
    expect(i18n.t('p1.roleParent', { ns: 'onboarding' })).toBe('Parent');
    expect(i18n.t('p1.roleChild', { ns: 'onboarding' })).toBe('Child');
    // Turkish must also resolve (no raw key leakage).
    i18n.changeLanguage('tr');
    expect(i18n.t('p1.roleParent', { ns: 'onboarding' })).toBe('Ebeveyn');
    expect(i18n.t('p1.roleChild', { ns: 'onboarding' })).toBe('Çocuk');
    i18n.changeLanguage('en');
  });
});
