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
        <QuickActions onNewTask={onNewTask} onNewReward={vi.fn()} onLogBehaviour={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'New Task' }));
    expect(onNewTask).toHaveBeenCalledTimes(1);
  });

  it('invokes the New Reward handler', () => {
    const onNewReward = vi.fn();
    render(
      <MemoryRouter>
        <QuickActions onNewTask={vi.fn()} onNewReward={onNewReward} onLogBehaviour={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'New Reward' }));
    expect(onNewReward).toHaveBeenCalledTimes(1);
  });

  it('invokes the Log Behaviour handler', () => {
    const onLogBehaviour = vi.fn();
    render(
      <MemoryRouter>
        <QuickActions onNewTask={vi.fn()} onNewReward={vi.fn()} onLogBehaviour={onLogBehaviour} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Log Behaviour' }));
    expect(onLogBehaviour).toHaveBeenCalledTimes(1);
  });

  it('navigates to the wallet page for Manage Wallet', () => {
    render(
      <MemoryRouter>
        <QuickActions onNewTask={vi.fn()} onNewReward={vi.fn()} onLogBehaviour={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Manage Wallet' }));
    expect(h.navigate).toHaveBeenCalledWith('/wallets');
  });

  it('renders exactly four quick actions with visible labels', () => {
    render(
      <MemoryRouter>
        <QuickActions onNewTask={vi.fn()} onNewReward={vi.fn()} onLogBehaviour={vi.fn()} />
      </MemoryRouter>,
    );
    ['New Task', 'New Reward', 'Log Behaviour', 'Manage Wallet'].forEach(label => {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    });
  });
});
