import { describe, expect, it, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '../i18n/config';
import enHelp from '../i18n/locales/en/help.json';
import { HelpHome } from './pages/HelpHome';
import { HelpArticlePage } from './pages/HelpArticlePage';
import { HelpCategoryPage } from './pages/HelpCategoryPage';
import { HelpSearchResults } from './pages/HelpSearchResults';
import { HelpButton } from './components/HelpButton';

beforeAll(async () => {
  i18n.addResourceBundle('en', 'help', enHelp, true, true);
  await i18n.changeLanguage('en');
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/help" element={<HelpHome />} />
        <Route path="/help/search" element={<HelpSearchResults />} />
        <Route path="/help/category/:categoryId" element={<HelpCategoryPage />} />
        <Route path="/help/:articleId" element={<HelpArticlePage />} />
        <Route path="/wallet" element={<HelpButton />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Help Center', () => {
  it('renders the home page with search, getting started, popular and categories', async () => {
    renderAt('/help');
    expect(await screen.findByRole('searchbox')).toBeInTheDocument();
    // The heading, not the "Getting started" article card that also appears.
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Getting started' })
    ).toBeInTheDocument();
    expect(await screen.findByText('Popular articles')).toBeInTheDocument();
    expect(await screen.findByText('Browse by category')).toBeInTheDocument();
    expect(await screen.findByText('Recently updated')).toBeInTheDocument();
  });

  it('renders a full article with all mandated sections', async () => {
    renderAt('/help/wallet');
    expect(await screen.findByRole('heading', { level: 1, name: 'Wallet' })).toBeInTheDocument();
    for (const heading of [
      'What it is',
      'Why it exists',
      'Who can use it',
      'How it works',
      'Step by step',
      'Tips',
      'Common mistakes',
      'Related features',
    ]) {
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    }
  });

  it('shows a friendly message for an unknown article', async () => {
    renderAt('/help/does-not-exist');
    expect(await screen.findByText('We couldn’t find that article')).toBeInTheDocument();
  });

  it('lists the articles of a category', async () => {
    renderAt('/help/category/money');
    expect(await screen.findByRole('heading', { level: 1, name: 'Money' })).toBeInTheDocument();
    expect(await screen.findByText('Weekly allowance')).toBeInTheDocument();
  });

  it('shows search results for a query', async () => {
    renderAt('/help/search?q=allowance');
    await waitFor(() =>
      expect(screen.getByText(/result[s]? for/i)).toBeInTheDocument()
    );
    expect(screen.getByText('Weekly allowance')).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    renderAt('/help/search?q=zzzznotaword');
    expect(await screen.findByText(/No results for/)).toBeInTheDocument();
  });

  it('contextual help button targets the article for the current route', async () => {
    renderAt('/wallet');
    const button = await screen.findByTestId('help-button');
    expect(button).toHaveAttribute('data-help-article', 'wallet');
    await userEvent.click(button);
    expect(await screen.findByRole('heading', { level: 1, name: 'Wallet' })).toBeInTheDocument();
    // The article offers a way back to the page the user came from.
    expect(screen.getByText('Back to the page you came from')).toBeInTheDocument();
  });
});
