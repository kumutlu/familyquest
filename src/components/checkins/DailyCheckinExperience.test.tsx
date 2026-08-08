import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/config';
import * as api from '../../lib/api';
import type { DailyCheckinRecord } from '../../lib/dailyCheckins';
import { submitDailyCheckin, skipDailyCheckin } from '../../lib/dailyCheckinsApi';
import * as notifications from '../../lib/notifications';
import { useStore } from '../../store/useStore';
import { DailyCheckinExperience } from './DailyCheckinExperience';

vi.mock('../../lib/dailyCheckinsApi', () => ({
  submitDailyCheckin: vi.fn(),
  skipDailyCheckin: vi.fn(),
}));

const initialStore = useStore.getState();
const child = {
  id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Alex',
};
const parent = {
  id: 'parent-1', familyId: 'family-1', role: 'parent', displayName: 'Pat',
  dailyCheckins: { parentParticipationEnabled: true },
};
const enabledFamily = {
  id: 'family-1', timezone: 'Europe/London',
  dailyCheckins: { childrenEnabled: true, historyVisibleToParents: true },
};
const cheetahRecord: DailyCheckinRecord = {
  id: 'child-1_2026-08-01',
  familyId: 'family-1',
  userId: 'child-1',
  localDate: '2026-08-01',
  animal: 'cheetah',
  catalogVersion: 1,
  createdAt: {},
  updatedAt: {},
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function seedStore(overrides: Record<string, unknown> = {}) {
  useStore.setState({
    ...initialStore,
    currentUser: child,
    familyData: enabledFamily,
    dailyCheckinDay: '2026-08-01',
    dailyCheckinStateResolved: true,
    todayDailyCheckin: null,
    todayDailyCheckinSkip: null,
    ...overrides,
  }, true);
}

function seedStoreUpdate(overrides: Record<string, unknown>) {
  act(() => { useStore.setState(overrides); });
}

function renderExperience() {
  const user = userEvent.setup();
  render(
    <DailyCheckinExperience>
      <main aria-label="dashboard content">dashboard</main>
    </DailyCheckinExperience>,
  );
  return user;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await act(async () => {
    await i18n.changeLanguage('en');
    await i18n.loadNamespaces(['checkins']);
  });
  seedStore();
});

afterEach(() => {
  act(() => { useStore.setState(initialStore, true); });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('DailyCheckinExperience persisted rendering', () => {
  it.each([child, parent])('renders dashboard content for $role without flashing a modal until every input resolves', member => {
    seedStore({ dailyCheckinStateResolved: false, currentUser: member });

    renderExperience();

    expect(screen.getByRole('main', { name: 'dashboard content' })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens only when a fully resolved member is eligible', () => {
    renderExperience();

    expect(screen.getByRole('dialog', { name: /who are you today/i })).toBeVisible();
    expect(screen.getByRole('main', { name: 'dashboard content' })).toBeVisible();
  });

  it('keeps participation-disabled and already-submitted members resolved-ineligible', () => {
    seedStore({ familyData: { ...enabledFamily, dailyCheckins: { ...enabledFamily.dailyCheckins, childrenEnabled: false } } });
    const { rerender } = render(
      <DailyCheckinExperience><div>dashboard</div></DailyCheckinExperience>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    seedStoreUpdate({
      familyData: enabledFamily,
      todayDailyCheckin: cheetahRecord,
    });
    rerender(<DailyCheckinExperience><div>dashboard</div></DailyCheckinExperience>);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the badge and confirmation only from the persisted current-day record', async () => {
    vi.mocked(submitDailyCheckin).mockResolvedValue({ status: 'written' });
    const user = renderExperience();

    await user.click(screen.getByRole('button', { name: /Cheetah, energetic/i }));

    expect(screen.queryByText("Today I'm a Cheetah")).not.toBeInTheDocument();
    expect(screen.queryByText("Today you're a Cheetah.")).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeVisible();

    seedStoreUpdate({ todayDailyCheckin: cheetahRecord });

    expect(await screen.findByText("Today I'm a Cheetah")).toBeVisible();
    expect(screen.getByText("Today you're a Cheetah.")).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(skipDailyCheckin).not.toHaveBeenCalled();
  });
});

describe('DailyCheckinExperience mutation truthfulness', () => {
  it('serializes animal, Escape, Close, backdrop and Skip behind one same-tick lock', () => {
    const pending = deferred<{ status: 'written' }>();
    vi.mocked(submitDailyCheckin).mockReturnValue(pending.promise);
    renderExperience();
    const animal = screen.getByRole('button', { name: /Cheetah, energetic/i });
    const close = screen.getByRole('button', { name: /close/i });
    const backdrop = screen.getByTestId('modal-backdrop');
    const skip = screen.getByRole('button', { name: /Skip for today/i });

    act(() => {
      animal.click();
      fireEvent.keyDown(document, { key: 'Escape' });
      close.click();
      backdrop.click();
      skip.click();
    });

    expect(submitDailyCheckin).toHaveBeenCalledOnce();
    expect(skipDailyCheckin).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('retains the modal and permits retry after an unavailable submission rejection', async () => {
    vi.mocked(submitDailyCheckin)
      .mockRejectedValueOnce({ code: 'unavailable' })
      .mockReturnValueOnce(deferred<{ status: 'written' }>().promise);
    const user = renderExperience();

    await user.click(screen.getByRole('button', { name: /Cheetah, energetic/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't save/i);
    expect(screen.getByRole('dialog')).toBeVisible();
    const retry = screen.getByRole('button', { name: /Cheetah, energetic/i });
    expect(retry).toBeEnabled();
    await user.click(retry);
    expect(submitDailyCheckin).toHaveBeenCalledTimes(2);
  });

  it('keeps an offline-pending submission neutral until the listener confirms persistence', async () => {
    vi.mocked(submitDailyCheckin).mockReturnValue(deferred<{ status: 'written' }>().promise);
    const user = renderExperience();

    await user.click(screen.getByRole('button', { name: /Cheetah, energetic/i }));

    expect(screen.getByRole('status')).toHaveTextContent('Saving your check-in…');
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.queryByText("Today I'm a Cheetah")).not.toBeInTheDocument();
    expect(screen.queryByText("Today you're a Cheetah.")).not.toBeInTheDocument();
  });

  it('releases an old pending operation when the same member and day move to another family', async () => {
    const oldRequest = deferred<{ status: 'written' }>();
    vi.mocked(submitDailyCheckin).mockReturnValue(oldRequest.promise);
    const user = renderExperience();
    await user.click(screen.getByRole('button', { name: /Cheetah, energetic/i }));
    expect(screen.getByRole('status')).toHaveTextContent('Saving your check-in…');

    seedStoreUpdate({
      currentUser: { ...child, familyId: 'family-2' },
      familyData: { ...enabledFamily, id: 'family-2' },
      todayDailyCheckin: null,
      todayDailyCheckinSkip: null,
    });

    const newFamilyChoice = screen.getByRole('button', { name: /Cheetah, energetic/i });
    expect(newFamilyChoice).toBeEnabled();
    expect(screen.getByRole('status')).not.toHaveTextContent('Saving your check-in…');

    await act(async () => { oldRequest.resolve({ status: 'written' }); });

    expect(newFamilyChoice).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText("Today you're a Cheetah.")).not.toBeInTheDocument();
  });

  it('resets a pending operation on role transition and ignores its late rejection during a new request', async () => {
    const oldRequest = deferred<{ status: 'written' }>();
    const newRequest = deferred<{ status: 'written' }>();
    vi.mocked(submitDailyCheckin)
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    const user = renderExperience();
    await user.click(screen.getByRole('button', { name: /Cheetah, energetic/i }));

    seedStoreUpdate({
      currentUser: {
        ...child,
        role: 'parent',
        dailyCheckins: { parentParticipationEnabled: true },
      },
    });

    const newRoleChoice = screen.getByRole('button', { name: /Lion, brave/i });
    expect(newRoleChoice).toBeEnabled();
    await user.click(newRoleChoice);
    expect(submitDailyCheckin).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('Saving your check-in…');

    await act(async () => { oldRequest.reject({ code: 'unavailable' }); });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Saving your check-in…');
    expect(screen.getByRole('button', { name: /Lion, brave/i })).toBeDisabled();
  });

  it('closes a skip only after the current-day listener persists it and never confirms a mood', async () => {
    vi.mocked(skipDailyCheckin).mockResolvedValue({ status: 'written' });
    const user = renderExperience();

    await user.click(screen.getByRole('button', { name: /Skip for today/i }));

    expect(skipDailyCheckin).toHaveBeenCalledWith({
      familyId: 'family-1', userId: 'child-1', localDate: '2026-08-01',
    });
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Saving your check-in…');

    seedStoreUpdate({
      todayDailyCheckinSkip: {
        id: 'child-1_2026-08-01', familyId: 'family-1', userId: 'child-1',
        localDate: '2026-08-01', createdAt: {},
      },
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText(/Today I'm/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Today you're/i)).not.toBeInTheDocument();
  });

  it('does not remember a failed skip in session state and keeps dashboard content accessible', async () => {
    sessionStorage.clear();
    vi.mocked(skipDailyCheckin).mockRejectedValue({ code: 'unavailable' });
    const user = renderExperience();

    await user.click(screen.getByRole('button', { name: /close/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't save/i);
    expect(screen.getByRole('main', { name: 'dashboard content' })).toBeVisible();
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(sessionStorage).toHaveLength(0);
  });

  it('ignores stale-day records, refreshes on a short recurrence clock and removes the prior-day badge', () => {
    vi.useFakeTimers();
    const refreshDailyCheckinDay = vi.fn();
    seedStore({ todayDailyCheckin: cheetahRecord, refreshDailyCheckinDay });
    renderExperience();
    expect(screen.getByText("Today I'm a Cheetah")).toBeVisible();

    act(() => { vi.advanceTimersByTime(60_000); });

    expect(refreshDailyCheckinDay).toHaveBeenCalled();
    seedStoreUpdate({ dailyCheckinDay: '2026-08-02', dailyCheckinStateResolved: false });
    expect(screen.queryByText("Today I'm a Cheetah")).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('routes selection only to the daily check-in API, isolated from gamification and other features', async () => {
    const unrelatedCalls = [
      vi.spyOn(api, 'createTask'),
      vi.spyOn(api, 'depositToWallet'),
      vi.spyOn(api, 'awardPoints'),
      vi.spyOn(api, 'redeemReward'),
      vi.spyOn(api, 'addBehaviourEvent'),
      vi.spyOn(notifications, 'queueNotificationInTransaction'),
      vi.spyOn(api, 'unlockAvatar'),
    ];
    vi.mocked(submitDailyCheckin).mockReturnValue(deferred<{ status: 'written' }>().promise);
    const user = renderExperience();

    await user.click(screen.getByRole('button', { name: /Cheetah, energetic/i }));

    expect(submitDailyCheckin).toHaveBeenCalledOnce();
    expect(submitDailyCheckin).toHaveBeenCalledWith({
      familyId: 'family-1', userId: 'child-1', localDate: '2026-08-01', animal: 'cheetah',
    });
    for (const unrelatedCall of unrelatedCalls) expect(unrelatedCall).not.toHaveBeenCalled();
  });
});
