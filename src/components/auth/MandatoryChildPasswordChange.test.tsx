import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MandatoryChildPasswordChange } from './MandatoryChildPasswordChange';

const api = vi.hoisted(() => ({ complete: vi.fn() }));

vi.mock('../../lib/childLoginApi', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/childLoginApi')>();
  return { ...actual, completeChildPasswordChange: api.complete };
});

vi.mock('firebase/auth', () => ({ signOut: vi.fn() }));
vi.mock('../../lib/firebase', () => ({ auth: {} }));

describe('MandatoryChildPasswordChange', () => {
  beforeEach(() => vi.clearAllMocks());

  it('submits only the new private password and never asks for the temporary password again', async () => {
    api.complete.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<MandatoryChildPasswordChange />);

    expect(screen.queryByLabelText(/temporary/i)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('New private password'), 'Pr1vatePass!');
    await user.type(screen.getByLabelText('Confirm private password'), 'Pr1vatePass!');
    await user.click(screen.getByRole('button', { name: 'Save password and continue' }));
    expect(api.complete).toHaveBeenCalledWith('Pr1vatePass!');
  });

  it('keeps the blocking screen active and shows feedback when replacement fails', async () => {
    api.complete.mockRejectedValue({ code: 'internal', message: 'internal' });
    const user = userEvent.setup();
    render(<MandatoryChildPasswordChange />);
    await user.type(screen.getByLabelText('New private password'), 'Pr1vatePass!');
    await user.type(screen.getByLabelText('Confirm private password'), 'Pr1vatePass!');
    await user.click(screen.getByRole('button', { name: 'Save password and continue' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create your private password' })).toBeInTheDocument();
  });
});
