import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BugReportSheet } from './BugReportSheet';
import * as bugReportsApi from '../../lib/bugReports';

vi.mock('../../lib/bugReports', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/bugReports')>();
  return {
    ...actual,
    submitBugReport: vi.fn(),
  };
});

describe('BugReportSheet — Wave 4.2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(bugReportsApi.submitBugReport).mockResolvedValue({ id: 'rep-123' });
  });

  it('14. category selection updates aria-checked and selected styling', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BugReportSheet open onClose={vi.fn()} initialCategory="broken" />
      </MemoryRouter>,
    );

    const brokenBtn = screen.getByTestId('bug-category-broken');
    const visualBtn = screen.getByTestId('bug-category-visual');
    const walletBtn = screen.getByTestId('bug-category-wallet');

    expect(brokenBtn).toHaveAttribute('aria-checked', 'true');
    expect(visualBtn).toHaveAttribute('aria-checked', 'false');

    await user.click(walletBtn);
    expect(walletBtn).toHaveAttribute('aria-checked', 'true');
    expect(brokenBtn).toHaveAttribute('aria-checked', 'false');
  });

  it('15, 16 & 17. textarea node identity survives keystrokes and maintains active focus', async () => {
    render(
      <MemoryRouter>
        <BugReportSheet open onClose={vi.fn()} />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('bug-report-textarea') as HTMLTextAreaElement;
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    const initialTextareaNode = textarea;
    const testText = 'The quick brown fox jumps over the lazy dog';

    for (let i = 0; i < testText.length; i++) {
      fireEvent.change(textarea, { target: { value: testText.slice(0, i + 1) } });
      expect(screen.getByTestId('bug-report-textarea')).toBe(initialTextareaNode);
      expect(document.activeElement).toBe(textarea);
    }

    expect(textarea.value).toBe(testText);
  });

  it('18 & 21. submits exactly once and presents small success feedback', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BugReportSheet open onClose={vi.fn()} initialCategory="tasks" />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('bug-report-textarea');
    await user.type(textarea, 'Quests completed but did not give points');

    const submitBtn = screen.getByTestId('bug-report-submit');
    expect(submitBtn).toBeEnabled();

    await user.click(submitBtn);

    await waitFor(() => {
      expect(bugReportsApi.submitBugReport).toHaveBeenCalledTimes(1);
    });

    const callArg = vi.mocked(bugReportsApi.submitBugReport).mock.calls[0][0];
    expect(callArg.category).toBe('tasks');
    expect(callArg.description).toBe('Quests completed but did not give points');
    expect(callArg.technicalContext).toBeDefined();

    expect(await screen.findByTestId('bug-report-success')).toBeInTheDocument();
    expect(screen.getByText('Thanks — report sent')).toBeInTheDocument();
    expect(screen.getByText('We’ve got it.')).toBeInTheDocument();
  });

  it('22 & 23. failed submission retains entered category/text and supports retry', async () => {
    const user = userEvent.setup();
    vi.mocked(bugReportsApi.submitBugReport).mockRejectedValueOnce(
      new Error('Network transport unavailable'),
    );

    render(
      <MemoryRouter>
        <BugReportSheet open onClose={vi.fn()} initialCategory="wallet" />
      </MemoryRouter>,
    );

    const textarea = screen.getByTestId('bug-report-textarea') as HTMLTextAreaElement;
    await user.type(textarea, 'Wallet balance went negative');

    const submitBtn = screen.getByTestId('bug-report-submit');
    await user.click(submitBtn);

    const errorAlert = await screen.findByTestId('bug-report-error');
    expect(errorAlert).toBeInTheDocument();
    expect(errorAlert).toHaveTextContent('Network transport unavailable');

    // Textarea still has the user's text and category is preserved
    expect(textarea.value).toBe('Wallet balance went negative');
    expect(screen.getByTestId('bug-category-wallet')).toHaveAttribute('aria-checked', 'true');

    // Retry
    vi.mocked(bugReportsApi.submitBugReport).mockResolvedValueOnce({ id: 'rep-retry-123' });
    const retryBtn = screen.getByTestId('bug-report-retry');
    await user.click(retryBtn);

    await waitFor(() => {
      expect(bugReportsApi.submitBugReport).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByTestId('bug-report-success')).toBeInTheDocument();
  });

  it('24. optional technical details expansion discloses safe metadata', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BugReportSheet open onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('bug-report-tech-details')).not.toBeInTheDocument();

    const toggle = screen.getByTestId('bug-report-tech-toggle');
    await user.click(toggle);

    const details = await screen.findByTestId('bug-report-tech-details');
    expect(details).toBeInTheDocument();
    expect(details).toHaveTextContent('App version');
    expect(details).toHaveTextContent('Screen size');
  });
});
