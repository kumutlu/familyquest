import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => h.navigate };
});

import { QuickActions } from './QuickActions';

describe('QuickActions', () => {
  beforeEach(() => h.navigate.mockClear());

  it('invokes the New Task handler', () => {
    const onNewTask = vi.fn();
    render(
      <MemoryRouter>
        <QuickActions onAddChild={vi.fn()} onNewTask={onNewTask} onNewReward={vi.fn()} onLogBehaviour={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'New Task' }));
    expect(onNewTask).toHaveBeenCalledTimes(1);
  });

  it('invokes the New Reward handler', () => {
    const onNewReward = vi.fn();
    render(
      <MemoryRouter>
        <QuickActions onAddChild={vi.fn()} onNewTask={vi.fn()} onNewReward={onNewReward} onLogBehaviour={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'New Reward' }));
    expect(onNewReward).toHaveBeenCalledTimes(1);
  });

  it('invokes the Log Behaviour handler', () => {
    const onLogBehaviour = vi.fn();
    render(
      <MemoryRouter>
        <QuickActions onAddChild={vi.fn()} onNewTask={vi.fn()} onNewReward={vi.fn()} onLogBehaviour={onLogBehaviour} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Log Behaviour' }));
    expect(onLogBehaviour).toHaveBeenCalledTimes(1);
  });

  it('navigates to the wallet page for Manage Wallet', () => {
    render(
      <MemoryRouter>
        <QuickActions onAddChild={vi.fn()} onNewTask={vi.fn()} onNewReward={vi.fn()} onLogBehaviour={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Manage Wallet' }));
    expect(h.navigate).toHaveBeenCalledWith('/wallets');
  });

  it('navigates to the pet box page', () => {
    render(
      <MemoryRouter>
        <QuickActions onAddChild={vi.fn()} onNewTask={vi.fn()} onNewReward={vi.fn()} onLogBehaviour={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pet Box' }));
    expect(h.navigate).toHaveBeenCalledWith('/pet-box');
  });

  it('navigates to settings for Invite Member', () => {
    render(
      <MemoryRouter>
        <QuickActions onAddChild={vi.fn()} onNewTask={vi.fn()} onNewReward={vi.fn()} onLogBehaviour={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Invite Member' }));
    expect(h.navigate).toHaveBeenCalledWith('/settings');
  });

  it('renders all six quick actions with visible labels', () => {
    render(
      <MemoryRouter>
        <QuickActions onAddChild={vi.fn()} onNewTask={vi.fn()} onNewReward={vi.fn()} onLogBehaviour={vi.fn()} />
      </MemoryRouter>,
    );
    ['Add a child', 'New Task', 'New Reward', 'Log Behaviour', 'Manage Wallet', 'Pet Box', 'Invite Member'].forEach(label => {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    });
  });
});
