// ---------------------------------------------------------------------------
// DELETE FAMILY DIALOG — resume after remount and retry_wait presentation (R8)
// ---------------------------------------------------------------------------
// The deletion job is server-authoritative and durable: if the owner reloads
// the app (or the dialog remounts) while a job is in flight, the dialog must
// resume the progress view instead of asking for the family name again. A job
// waiting for its next automatic attempt (`retry_wait`) must be presented
// distinctly from a running job.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { DeleteFamilyDialog } from './DeleteFamilyDialog';
import i18n from '../../i18n/config';

const mockSignOut = vi.fn(async (..._args: any[]) => {});
const mockRequestFamilyDeletion = vi.fn();
const mockFetchFamilyDeletionStatus = vi.fn();

vi.mock('../../lib/api', () => ({
  signOut: (...args: any[]) => mockSignOut(...args),
}));
vi.mock('../../lib/familyDeletionApi', () => ({
  requestFamilyDeletion: (...args: any[]) => mockRequestFamilyDeletion(...args),
  fetchFamilyDeletionStatus: (...args: any[]) => mockFetchFamilyDeletionStatus(...args),
  generateClientReqId: () => 'test-client-req-00000001',
}));

const FAMILY_ID = 'fam-1';

beforeEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  mockSignOut.mockClear();
  mockRequestFamilyDeletion.mockReset();
  mockFetchFamilyDeletionStatus.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderDialog() {
  return render(
    <DeleteFamilyDialog familyId={FAMILY_ID} familyName="The Smiths" onClose={() => {}} />,
  );
}

describe('DeleteFamilyDialog — resume after remount', () => {
  it('shows the progress view immediately when a job is already running', async () => {
    mockFetchFamilyDeletionStatus.mockResolvedValue({
      familyId: FAMILY_ID, state: 'running', phase: 'delete_family_subcollections',
    });

    renderDialog();

    expect(await screen.findByTestId('delete-family-progress')).toBeInTheDocument();
    expect(screen.queryByLabelText(/type the family name/i)).not.toBeInTheDocument();
    expect(mockRequestFamilyDeletion).not.toHaveBeenCalled();
  });

  it('resumes a queued job as in-progress too', async () => {
    mockFetchFamilyDeletionStatus.mockResolvedValue({ familyId: FAMILY_ID, state: 'queued' });
    renderDialog();
    expect(await screen.findByTestId('delete-family-progress')).toBeInTheDocument();
  });

  it('stays on the warning stage when there is no in-flight job', async () => {
    mockFetchFamilyDeletionStatus.mockResolvedValue({ familyId: FAMILY_ID, state: 'none' });
    renderDialog();
    await waitFor(() => {
      expect(screen.queryByTestId('delete-family-progress')).not.toBeInTheDocument();
    });
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('shows the failed stage on remount when the job hard-failed', async () => {
    mockFetchFamilyDeletionStatus.mockResolvedValue({ familyId: FAMILY_ID, state: 'failed' });
    renderDialog();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('DeleteFamilyDialog — retry_wait presentation', () => {
  it('presents a waiting-for-retry job distinctly from a running one', async () => {
    mockFetchFamilyDeletionStatus.mockResolvedValue({ familyId: FAMILY_ID, state: 'retry_wait' });

    renderDialog();

    const progress = await screen.findByTestId('delete-family-progress');
    expect(progress).toHaveTextContent(
      i18n.t('settings:familySettings.deleteFamilyRetryWait'),
    );
    // Still a progress view, not a failure: no retry button, no alert.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
