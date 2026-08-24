import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { MoreMenu, getMoreDestinations } from './MoreMenu';

const renderMenu = (role: string | undefined | null, onReportProblem = vi.fn()) =>
  render(
    <MemoryRouter>
      <MoreMenu open onClose={vi.fn()} role={role} onReportProblem={onReportProblem} />
    </MemoryRouter>,
  );

describe('MoreMenu (Queki v2 feature-parity hub)', () => {
  it('shows parent/owner destinations including Goals and Cat Box', () => {
    renderMenu('owner');
    expect(screen.getByTestId('more-goals')).toBeInTheDocument();
    expect(screen.getByTestId('more-wallets')).toBeInTheDocument();
    expect(screen.getByTestId('more-cat-box')).toBeInTheDocument();
    expect(screen.getByTestId('more-cat-box')).toHaveTextContent('Pet Box');
    expect(screen.getByTestId('more-history')).toBeInTheDocument();
    expect(screen.getByTestId('more-notifications')).toBeInTheDocument();
    expect(screen.getByTestId('more-settings')).toBeInTheDocument();
    expect(screen.getByTestId('more-help')).toHaveTextContent('Help & Feedback');
    expect(screen.getByTestId('more-report-problem')).toBeInTheDocument();
    expect(screen.queryByTestId('more-wallet')).not.toBeInTheDocument();
  });

  it('keeps My Wallet out of the parent menu as well as the owner menu', () => {
    const { unmount } = renderMenu('parent');
    expect(screen.queryByTestId('more-wallet')).not.toBeInTheDocument();
    expect(screen.getByTestId('more-wallets')).toBeInTheDocument();
    unmount();

    renderMenu('owner');
    expect(screen.queryByTestId('more-wallet')).not.toBeInTheDocument();
    expect(screen.getByTestId('more-wallets')).toBeInTheDocument();
  });

  it('hides parent-only destinations for children', () => {
    renderMenu('child');
    expect(screen.getByTestId('more-goals')).toBeInTheDocument();
    expect(screen.getByTestId('more-wallet')).toBeInTheDocument();
    expect(screen.queryByTestId('more-cat-box')).not.toBeInTheDocument();
    expect(screen.queryByTestId('more-wallets')).not.toBeInTheDocument();
    expect(screen.getByTestId('more-report-problem')).toBeInTheDocument();
  });

  it('exposes the required parity destinations per role', () => {
    const parentPaths = getMoreDestinations('parent').map(d => d.path);
    const childPaths = getMoreDestinations('child').map(d => d.path);

    for (const path of ['/goals', '/wallets', '/pet-box', '/history', '/notifications', '/settings', '/help']) {
      expect(parentPaths).toContain(path);
    }
    for (const path of ['/goals', '/wallet', '/history', '/notifications', '/settings', '/help']) {
      expect(childPaths).toContain(path);
    }
    expect(childPaths).not.toContain('/pet-box');
  });

  it('opens the existing report-problem flow and closes More', () => {
    const onClose = vi.fn();
    const onReportProblem = vi.fn();
    render(
      <MemoryRouter>
        <MoreMenu open onClose={onClose} role="owner" onReportProblem={onReportProblem} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId('more-report-problem'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onReportProblem).toHaveBeenCalledTimes(1);
  });

  it('navigates to the destination and closes on selection', () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter initialEntries={['/']}>
        <MoreMenu open onClose={onClose} role="owner" onReportProblem={vi.fn()} />
        <Routes>
          <Route path="/goals" element={<span>goals-page</span>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId('more-goals'));
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByText('goals-page')).toBeInTheDocument();
  });
});
