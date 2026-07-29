import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/config';

const state = vi.hoisted(() => ({
  currentUser: { id: 'child1', familyId: 'f1', role: 'child' } as any,
  familyMembers: [] as any[],
  tasks: [] as any[],
  items: [] as any[],
}));
const api = vi.hoisted(() => ({
  markRead: vi.fn(),
  subscribeAnnouncements: vi.fn(),
  subscribeReads: vi.fn(),
}));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('../../store/useStore', () => ({
  useStore: (selector: any) => selector(state),
}));
vi.mock('../../lib/familyBulletin', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/familyBulletin')>();
  return {
    ...actual,
    markAnnouncementRead: api.markRead,
    subscribeToAnnouncements: api.subscribeAnnouncements,
    subscribeToAnnouncementReads: api.subscribeReads,
  };
});
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

import { FamilyBulletin } from './FamilyBulletin';

beforeEach(async () => {
  vi.clearAllMocks();
  state.currentUser = { id: 'child1', familyId: 'f1', role: 'child' };
  api.subscribeAnnouncements.mockImplementation((_f: string, _u: any, next: any) => {
    next(state.items);
    return () => {};
  });
  api.subscribeReads.mockImplementation((_f: string, _u: string, next: any) => {
    next(new Set());
    return () => {};
  });
  await i18n.loadNamespaces('bulletin');
  await i18n.changeLanguage('en');
});

describe('FamilyBulletin', () => {
  it('shows pinned/urgent announcements first and opens a linked task', async () => {
    state.items = [
      { id: 'normal', familyId: 'f1', title: 'Normal', message: 'N', type: 'general', audienceType: 'family', audienceUserIds: [], priority: 'normal', pinned: false, status: 'active', createdBy: 'p1', createdAt: 2, updatedAt: 2 },
      { id: 'pinned', familyId: 'f1', title: 'Pinned task', message: 'P', type: 'new_task', audienceType: 'family', audienceUserIds: [], priority: 'urgent', pinned: true, status: 'active', linkedTaskId: 'task1', createdBy: 'p1', createdAt: 1, updatedAt: 1 },
    ];
    const user = userEvent.setup();
    render(<MemoryRouter><FamilyBulletin /></MemoryRouter>);
    expect(screen.getByText('Pinned task')).toBeInTheDocument();
    expect(screen.queryByText('Normal')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View task' }));
    expect(navigate).toHaveBeenCalledWith('/tasks');
  });

  it('reacts to language changes while mounted', async () => {
    state.items = [];
    render(<MemoryRouter><FamilyBulletin /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /Family Bulletin/ })).toBeInTheDocument();
    await act(async () => { await i18n.changeLanguage('tr'); });
    expect(screen.getByRole('heading', { name: /Aile Panosu/ })).toBeInTheDocument();
  });

  it('does not expose authoring to children', () => {
    state.items = [];
    render(<MemoryRouter><FamilyBulletin /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: 'Create announcement' })).not.toBeInTheDocument();
  });
});
