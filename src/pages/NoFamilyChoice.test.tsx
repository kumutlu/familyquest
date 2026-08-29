import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n/config';
import { readCreateFamilyIntent } from '../auth/createFamilyIntent';
import { ONBOARDING_DRAFT_KEY, saveDraft } from '../onboarding/lib/onboardingDraft';
import { useStore } from '../store/useStore';
import { NoFamilyChoice } from './NoFamilyChoice';

const membershipApi = vi.hoisted(() => ({ requestFamilyJoin: vi.fn() }));
vi.mock('../lib/familyMembershipApi', () => membershipApi);
const inviteAnalytics = vi.hoisted(() => ({ recordInviteEvent: vi.fn() }));
vi.mock('../auth/inviteAnalytics', () => inviteAnalytics);
vi.mock('../lib/firebase', () => ({ app: {}, auth: {}, db: {}, functions: {}, googleProvider: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn(() => () => {}) }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDocFromServer: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocsFromServer: vi.fn(),
}));

function renderChoice() {
  return render(
    <MemoryRouter initialEntries={['/no-family']}>
      <Routes>
        <Route path="/no-family" element={<NoFamilyChoice />} />
        <Route path="/onboarding" element={<div>Creation onboarding</div>} />
        <Route path="/join/pending" element={<div>Membership pending</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  useStore.setState({
    authStatus: 'authenticated',
    authUser: { uid: 'uid-a' } as never,
    currentUser: { id: 'uid-a', role: 'parent' } as never,
  });
  await i18n.loadNamespaces(['onboarding', 'common']);
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

describe('NoFamilyChoice', () => {
  it('does not record a render for unauthenticated redirects', () => {
    useStore.setState({ authStatus: 'unauthenticated', authUser: null, currentUser: null });

    renderChoice();

    expect(inviteAnalytics.recordInviteEvent).not.toHaveBeenCalledWith(
      'no_family_choice_rendered',
      expect.anything(),
    );
  });

  it('records one render for an authenticated choice mount under StrictMode', () => {
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/no-family']}>
          <Routes>
            <Route path="/no-family" element={<NoFamilyChoice />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    expect(inviteAnalytics.recordInviteEvent).toHaveBeenCalledTimes(1);
    expect(inviteAnalytics.recordInviteEvent).toHaveBeenCalledWith(
      'no_family_choice_rendered',
      { source: 'no_family_choice' },
    );
  });

  it('renders explicit Create and Join choices without starting creation or membership writes', () => {
    renderChoice();

    expect(screen.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Create a family' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Join an existing family' })).toBeVisible();
    expect(readCreateFamilyIntent('uid-a')).toBeNull();
    expect(membershipApi.requestFamilyJoin).not.toHaveBeenCalled();
  });

  it('records an intent only after Create, clears stale reconciliation ids, and enters the exact create route', async () => {
    const user = userEvent.setup();
    saveDraft({
      version: 1,
      step: 'p1',
      parentFirstName: 'Kemal',
      parentRoleDisplay: 'parent',
      childFirstName: 'Osman',
      familyName: 'Kemal Family',
      familyId: 'stale-family',
      childId: 'stale-child',
      firstTaskId: 'stale-task',
      updatedAt: Date.now(),
    });
    renderChoice();

    await user.click(screen.getByRole('button', { name: 'Create a family' }));

    expect(readCreateFamilyIntent('uid-a')).toMatchObject({
      version: 1,
      kind: 'create-family',
      authUid: 'uid-a',
    });
    expect(JSON.parse(sessionStorage.getItem(ONBOARDING_DRAFT_KEY)!)).toMatchObject({
      step: 'p1',
      parentFirstName: 'Kemal',
      familyName: 'Kemal Family',
    });
    expect(JSON.parse(sessionStorage.getItem(ONBOARDING_DRAFT_KEY)!)).not.toHaveProperty('familyId');
    expect(await screen.findByText('Creation onboarding')).toBeVisible();
  });

  it('opens the authenticated role-less manual join entry without writing on choice', async () => {
    const user = userEvent.setup();
    renderChoice();

    await user.click(screen.getByRole('button', { name: 'Join an existing family' }));

    expect(screen.getByRole('textbox', { name: 'Family code' })).toBeVisible();
    expect(membershipApi.requestFamilyJoin).not.toHaveBeenCalled();
    expect(readCreateFamilyIntent('uid-a')).toBeNull();
  });

  it('submits a manual join without any requester-controlled role', async () => {
    const user = userEvent.setup();
    membershipApi.requestFamilyJoin.mockResolvedValue({ familyId: 'family-a', status: 'pending' });
    renderChoice();

    await user.click(screen.getByRole('button', { name: 'Join an existing family' }));
    await user.type(screen.getByRole('textbox', { name: 'Family code' }), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Send join request' }));

    await waitFor(() => expect(membershipApi.requestFamilyJoin).toHaveBeenCalledWith('ABC123'));
    expect(membershipApi.requestFamilyJoin.mock.calls[0]?.[0]).toBe('ABC123');
    expect(await screen.findByText('Membership pending')).toBeVisible();
  });
});
