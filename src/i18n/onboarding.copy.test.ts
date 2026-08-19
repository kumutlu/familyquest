import { describe, it, expect, beforeEach } from 'vitest';
import i18n from './config';

/**
 * Onboarding first-name placeholder copy (approved bounded fix).
 *
 * The parent/child first-name fields must use a generic prompt rather than a
 * personalised/example name (e.g. "Kemal", "Osman", "Ben"). These tests pin the
 * exact approved EN/TR strings and guard against example names creeping back.
 */
describe('onboarding copy — first-name placeholders', () => {
  beforeEach(async () => {
    await i18n.loadNamespaces(['onboarding', 'common']);
  });

  it('EN parent first-name placeholder is the generic prompt (no example name)', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('onboarding:s2.placeholder')).toBe('Enter your first name');
    expect(i18n.t('onboarding:s2.placeholder')).not.toMatch(/kemal|osman|ben/i);
  });

  it('EN child first-name placeholder is the generic prompt (no example name)', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('onboarding:s4.placeholder')).toBe("Enter child's first name");
    expect(i18n.t('onboarding:s4.placeholder')).not.toMatch(/kemal|osman|ben/i);
  });

  it('TR parent first-name placeholder is the generic prompt (no example name)', async () => {
    await i18n.changeLanguage('tr');
    expect(i18n.t('onboarding:s2.placeholder')).toBe('Adınızı girin');
    expect(i18n.t('onboarding:s2.placeholder')).not.toMatch(/kemal|osman|ben/i);
  });

  it('TR child first-name placeholder is the generic prompt (no example name)', async () => {
    await i18n.changeLanguage('tr');
    expect(i18n.t('onboarding:s4.placeholder')).toBe('Çocuğunuzun adını girin');
    expect(i18n.t('onboarding:s4.placeholder')).not.toMatch(/kemal|osman|ben/i);
  });
});
