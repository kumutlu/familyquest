import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n/config';
import { PrivacyPolicy } from './PrivacyPolicy';
import { TermsOfService } from './TermsOfService';
import { AccountDeletion } from './AccountDeletion';
import { getLegalLinks, normaliseLegalUrl } from '../../config/legalLinks';

function renderAt(path: string, element: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('public legal pages', () => {
  beforeEach(async () => {
    await i18n.loadNamespaces(['legal']);
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the privacy policy in English without authentication', async () => {
    renderAt('/privacy', <PrivacyPolicy />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Information we collect' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Authentication data' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Account deletion and family deletion' })).toBeInTheDocument();
    // Public page: no authenticated navigation is rendered.
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('sets an SEO title and meta description', async () => {
    renderAt('/privacy', <PrivacyPolicy />);
    await waitFor(() => expect(document.title).toBe('Privacy Policy · Queki'));
    const meta = document.querySelector('meta[name="description"]');
    expect(meta?.getAttribute('content')).toMatch(/Queki collects/);
  });

  it('renders the terms of service with the reward and wallet disclaimers', async () => {
    renderAt('/terms', <TermsOfService />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Terms of Service' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Rewards disclaimer' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Wallet disclaimer' })).toBeInTheDocument();
    expect(screen.getByText(/not a bank, payment institution or money transmitter/)).toBeInTheDocument();
  });

  it('renders the account deletion page with the in-app path and recent-auth requirement', async () => {
    renderAt('/account-deletion', <AccountDeletion />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Account Deletion' })).toBeInTheDocument();
    expect(screen.getAllByText(/Settings → Danger Zone → Delete Account/).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 2, name: 'Recent authentication requirement' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Sign Out' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Delete Family' })).toBeInTheDocument();
    // Support email must not be presented as the normal deletion route.
    expect(screen.getByText(/never requires an email to support/)).toBeInTheDocument();
  });

  it('supports switching to Turkish from the page itself (no signed-in profile)', async () => {
    const user = userEvent.setup();
    renderAt('/privacy', <PrivacyPolicy />);
    await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' });
    await user.click(screen.getByRole('button', { name: 'Türkçe' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Gizlilik Politikası' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Topladığımız bilgiler' })).toBeInTheDocument();
  });

  it('cross-links the three legal surfaces', async () => {
    renderAt('/terms', <TermsOfService />);
    await screen.findByRole('heading', { level: 1, name: 'Terms of Service' });
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'Account Deletion' })).toHaveAttribute('href', '/account-deletion');
  });
});

describe('legal link configuration', () => {
  it('accepts the production URLs', () => {
    const links = getLegalLinks({
      VITE_PRIVACY_POLICY_URL: 'https://queki.app/privacy',
      VITE_TERMS_URL: 'https://queki.app/terms',
      VITE_ACCOUNT_DELETION_URL: 'https://queki.app/account-deletion',
    });
    expect(links.privacyPolicy).toBe('https://queki.app/privacy');
    expect(links.terms).toBe('https://queki.app/terms');
    expect(links.accountDeletion).toBe('https://queki.app/account-deletion');
  });

  it('rejects invalid or unsafe URLs', () => {
    expect(normaliseLegalUrl('javascript:alert(1)')).toBeNull();
    expect(normaliseLegalUrl('/privacy')).toBeNull();
    expect(normaliseLegalUrl('   ')).toBeNull();
    expect(normaliseLegalUrl(undefined)).toBeNull();
    expect(getLegalLinks({}).privacyPolicy).toBeNull();
  });
});
