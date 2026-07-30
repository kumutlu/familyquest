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

describe('FamilyBulletin — responsive layout', () => {
  it('header uses flex-col on mobile and flex-row on desktop', () => {
    state.items = [];
    const { container } = render(<MemoryRouter><FamilyBulletin /></MemoryRouter>);
    const header = container.querySelector('section > div:first-child');
    expect(header).not.toBeNull();
    expect(header?.className).toContain('flex-col');
    expect(header?.className).toContain('sm:flex-row');
  });

  it('history and create buttons stack vertically on mobile and align horizontally on desktop', () => {
    state.currentUser = { id: 'parent1', familyId: 'f1', role: 'owner' } as any;
    state.items = [];
    const { container } = render(<MemoryRouter><FamilyBulletin /></MemoryRouter>);
    const buttonGroup = container.querySelector('section > div > div:last-child');
    expect(buttonGroup).not.toBeNull();
    expect(buttonGroup?.className).toContain('flex-col');
    expect(buttonGroup?.className).toContain('sm:flex-row');
  });

  it('create announcement button has full-width class on mobile', () => {
    state.currentUser = { id: 'parent1', familyId: 'f1', role: 'owner' } as any;
    state.items = [];
    render(<MemoryRouter><FamilyBulletin /></MemoryRouter>);
    const createBtn = screen.getByRole('button', { name: 'Create announcement' });
    expect(createBtn).toBeInTheDocument();
    expect(createBtn.className).toContain('w-full');
  });

  it('mark as read button is full-width on mobile', () => {
    state.items = [
      { id: 'a1', familyId: 'f1', title: 'Test', message: 'Body', type: 'general', audienceType: 'family', audienceUserIds: [], priority: 'normal', pinned: false, status: 'active', createdBy: 'p1', createdAt: 1, updatedAt: 1 },
    ];
    render(<MemoryRouter><FamilyBulletin /></MemoryRouter>);
    const markReadBtn = screen.getByRole('button', { name: 'Mark as read' });
    expect(markReadBtn).not.toBeNull();
    expect(markReadBtn.className).toContain('w-full');
  });

  it('action buttons (edit, archive, delete) stack vertically on mobile', () => {
    state.currentUser = { id: 'parent1', familyId: 'f1', role: 'owner' } as any;
    state.items = [
      { id: 'a1', familyId: 'f1', title: 'Test', message: 'Body', type: 'general', audienceType: 'family', audienceUserIds: [], priority: 'normal', pinned: false, status: 'active', createdBy: 'p1', createdAt: 1, updatedAt: 1 },
    ];
    const { container } = render(<MemoryRouter><FamilyBulletin /></MemoryRouter>);
    const actionGroup = container.querySelector('article > div:last-child');
    expect(actionGroup).not.toBeNull();
    expect(actionGroup?.className).toContain('flex-col');
    expect(actionGroup?.className).toContain('sm:flex-row');
  });

  it('action buttons are full-width on mobile', () => {
    state.currentUser = { id: 'parent1', familyId: 'f1', role: 'owner' } as any;
    state.items = [
      { id: 'a1', familyId: 'f1', title: 'Test', message: 'Body', type: 'general', audienceType: 'family', audienceUserIds: [], priority: 'normal', pinned: false, status: 'active', createdBy: 'p1', createdAt: 1, updatedAt: 1 },
    ];
    const { container } = render(<MemoryRouter><FamilyBulletin /></MemoryRouter>);
    const actionButtons = container.querySelectorAll('article button');
    actionButtons.forEach(btn => {
      expect(btn.className).toContain('w-full');
    });
  });

  it('show more/less button is full-width on mobile', () => {
    state.items = [
      { id: 'a1', familyId: 'f1', title: 'First', message: 'Body', type: 'general', audienceType: 'family', audienceUserIds: [], priority: 'normal', pinned: false, status: 'active', createdBy: 'p1', createdAt: 1, updatedAt: 1 },
      { id: 'a2', familyId: 'f1', title: 'Second', message: 'Body', type: 'general', audienceType: 'family', audienceUserIds: [], priority: 'normal', pinned: false, status: 'active', createdBy: 'p1', createdAt: 2, updatedAt: 2 },
    ];
    render(<MemoryRouter><FamilyBulletin /></MemoryRouter>);
    const showMoreBtn = screen.getByRole('button', { name: /Show 1 more/ });
    expect(showMoreBtn).not.toBeNull();
    expect(showMoreBtn.className).toContain('w-full');
  });

  it('linked task/reward button is full-width on mobile', () => {
    state.items = [
      { id: 'a1', familyId: 'f1', title: 'Task link', message: 'Body', type: 'general', audienceType: 'family', audienceUserIds: [], priority: 'normal', pinned: false, status: 'active', linkedTaskId: 'task1', createdBy: 'p1', createdAt: 1, updatedAt: 1 },
    ];
    render(<MemoryRouter><FamilyBulletin /></MemoryRouter>);
    const linkBtn = screen.getByRole('button', { name: 'View task' });
    expect(linkBtn).not.toBeNull();
    expect(linkBtn.className).toContain('w-full');
  });

  it('header title and badge remain on the same row on both mobile and desktop', () => {
    state.items = [];
    const { container } = render(<MemoryRouter><FamilyBulletin /></MemoryRouter>);
    const headingGroup = container.querySelector('h2');
    expect(headingGroup).not.toBeNull();
    expect(headingGroup?.className).toContain('flex');
    expect(headingGroup?.className).toContain('items-center');
  });

  it('card content stacks vertically on mobile (title, body, actions)', () => {
    state.items = [
      { id: 'a1', familyId: 'f1', title: 'Test', message: 'Body text', type: 'general', audienceType: 'family', audienceUserIds: [], priority: 'normal', pinned: false, status: 'active', createdBy: 'p1', createdAt: 1, updatedAt: 1 },
    ];
    const { container } = render(<MemoryRouter><FamilyBulletin /></MemoryRouter>);
    const article = container.querySelector('article');
    expect(article).not.toBeNull();
    const contentDiv = article?.querySelector('div:first-child');
    expect(contentDiv?.className).toContain('flex-col');
    expect(contentDiv?.className).toContain('sm:flex-row');
  });
});
