import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { useStore } from '../../store/useStore';
import { DailyCheckinSettings } from './DailyCheckinSettings';

const apiMocks = vi.hoisted(() => ({
  updateFamilySettings: vi.fn(async () => {}),
  updateParentDailyCheckinPreference: vi.fn(async () => {}),
}));

vi.mock('../../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...actual,
    updateFamilySettings: apiMocks.updateFamilySettings,
    updateParentDailyCheckinPreference: apiMocks.updateParentDailyCheckinPreference,
  };
});

function renderSettings(role: 'owner' | 'parent' | 'child') {
  act(() => {
    useStore.setState({
      currentUser: {
        id: 'user-1',
        familyId: 'family-1',
        displayName: 'Test User',
        role,
        dailyCheckins: { parentParticipationEnabled: false },
      },
      familyData: {
        id: 'family-1',
        name: 'Test Family',
        dailyCheckins: { childrenEnabled: true, historyVisibleToParents: false },
      },
    });
  });

  return render(<DailyCheckinSettings />);
}

beforeEach(async () => {
  apiMocks.updateFamilySettings.mockReset();
  apiMocks.updateFamilySettings.mockResolvedValue(undefined);
  apiMocks.updateParentDailyCheckinPreference.mockReset();
  apiMocks.updateParentDailyCheckinPreference.mockResolvedValue(undefined);
  await act(async () => {
    await i18n.changeLanguage('en');
    await i18n.loadNamespaces(['checkins']);
  });
});

afterEach(async () => {
  act(() => {
    useStore.setState({ currentUser: null, familyData: null });
  });
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

describe('DailyCheckinSettings role visibility', () => {
  it('shows all three controls to the owner', () => {
    renderSettings('owner');

    expect(screen.getByRole('switch', { name: /Enable check-ins for children/i })).toBeVisible();
    expect(screen.getByRole('switch', { name: /Participate as a parent/i })).toBeVisible();
    expect(screen.getByRole('switch', { name: /Show check-in history/i })).toBeVisible();
  });

  it('omits owner-only controls for a regular parent', () => {
    renderSettings('parent');

    expect(screen.getByRole('switch', { name: /Participate as a parent/i })).toBeVisible();
    expect(screen.queryByRole('switch', { name: /Enable check-ins for children/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /Show check-in history/i })).not.toBeInTheDocument();
  });

  it('renders no Daily Check-in settings for a child', () => {
    renderSettings('child');

    expect(screen.queryByText(/Daily check-ins/i)).not.toBeInTheDocument();
  });
});

describe('DailyCheckinSettings writes', () => {
  it.each([
    {
      label: /Enable check-ins for children/i,
      expected: { childrenEnabled: false, historyVisibleToParents: false },
    },
    {
      label: /Show check-in history/i,
      expected: { childrenEnabled: true, historyVisibleToParents: true },
    },
  ])('sends a complete sibling-preserving family payload for $label', async ({ label, expected }) => {
    const user = userEvent.setup();
    renderSettings('owner');

    await user.click(screen.getByRole('switch', { name: label }));

    expect(apiMocks.updateFamilySettings).toHaveBeenCalledOnce();
    expect(apiMocks.updateFamilySettings).toHaveBeenCalledWith('family-1', {
      dailyCheckins: expected,
    });
    expect(apiMocks.updateParentDailyCheckinPreference).not.toHaveBeenCalled();
  });

  it('uses only the self-preference API with the current user id', async () => {
    const user = userEvent.setup();
    renderSettings('parent');

    await user.click(screen.getByRole('switch', { name: /Participate as a parent/i }));

    expect(apiMocks.updateParentDailyCheckinPreference).toHaveBeenCalledOnce();
    expect(apiMocks.updateParentDailyCheckinPreference).toHaveBeenCalledWith('user-1', true);
    expect(apiMocks.updateFamilySettings).not.toHaveBeenCalled();
  });

  it('keeps the persisted store value until the authoritative listener updates it', async () => {
    const user = userEvent.setup();
    renderSettings('owner');
    const childrenToggle = screen.getByRole('switch', { name: /Enable check-ins for children/i });

    await user.click(childrenToggle);

    expect(childrenToggle).toBeChecked();
    act(() => {
      useStore.setState({
        familyData: {
          ...useStore.getState().familyData,
          dailyCheckins: { childrenEnabled: false, historyVisibleToParents: false },
        },
      });
    });
    expect(childrenToggle).not.toBeChecked();
  });

  it('locks only the toggle whose write is pending', async () => {
    let resolveWrite!: () => void;
    apiMocks.updateFamilySettings.mockImplementation(() => new Promise<void>(resolve => {
      resolveWrite = resolve;
    }));
    const user = userEvent.setup();
    renderSettings('owner');
    const childrenToggle = screen.getByRole('switch', { name: /Enable check-ins for children/i });

    await user.click(childrenToggle);

    expect(childrenToggle).toBeDisabled();
    expect(screen.getByRole('switch', { name: /Participate as a parent/i })).toBeEnabled();
    expect(screen.getByRole('switch', { name: /Show check-in history/i })).toBeEnabled();

    await act(async () => {
      resolveWrite();
    });
  });

  it('serializes sibling family toggles and builds the second payload from the first persisted result', async () => {
    let resolveFirstWrite!: () => void;
    apiMocks.updateFamilySettings
      .mockImplementationOnce(() => new Promise<void>(resolve => {
        resolveFirstWrite = resolve;
      }))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderSettings('owner');

    await user.click(screen.getByRole('switch', { name: /Enable check-ins for children/i }));
    await user.click(screen.getByRole('switch', { name: /Show check-in history/i }));

    expect(apiMocks.updateFamilySettings).toHaveBeenCalledOnce();
    expect(apiMocks.updateFamilySettings).toHaveBeenNthCalledWith(1, 'family-1', {
      dailyCheckins: { childrenEnabled: false, historyVisibleToParents: false },
    });

    act(() => {
      useStore.setState({
        familyData: {
          ...useStore.getState().familyData,
          dailyCheckins: { childrenEnabled: false, historyVisibleToParents: false },
        },
      });
    });
    await act(async () => {
      resolveFirstWrite();
    });

    await waitFor(() => expect(apiMocks.updateFamilySettings).toHaveBeenCalledTimes(2));
    expect(apiMocks.updateFamilySettings).toHaveBeenNthCalledWith(2, 'family-1', {
      dailyCheckins: { childrenEnabled: false, historyVisibleToParents: true },
    });
  });

  it('guards a rapid double click with a single in-flight write', async () => {
    let resolveWrite!: () => void;
    apiMocks.updateParentDailyCheckinPreference.mockImplementation(() => new Promise<void>(resolve => {
      resolveWrite = resolve;
    }));
    renderSettings('parent');
    const parentToggle = screen.getByRole('switch', { name: /Participate as a parent/i });

    act(() => {
      fireEvent.click(parentToggle);
      fireEvent.click(parentToggle);
    });

    expect(apiMocks.updateParentDailyCheckinPreference).toHaveBeenCalledOnce();
    await act(async () => {
      resolveWrite();
    });
  });

  it('shows a localized error and leaves the persisted checked state unchanged after rejection', async () => {
    apiMocks.updateFamilySettings.mockRejectedValueOnce(new Error('network details'));
    await act(async () => {
      await i18n.changeLanguage('tr');
      await i18n.loadNamespaces(['checkins']);
    });
    const user = userEvent.setup();
    renderSettings('owner');
    const childrenToggle = screen.getByRole('switch', { name: /Çocuklar için yoklamaları etkinleştir/i });

    await user.click(childrenToggle);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bu ayarı kaydedemedik. Lütfen tekrar dene.',
    );
    expect(childrenToggle).toBeChecked();
    await waitFor(() => expect(childrenToggle).toBeEnabled());
    expect(screen.queryByText('network details')).not.toBeInTheDocument();
  });
});
