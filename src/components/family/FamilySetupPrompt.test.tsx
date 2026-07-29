import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/config';
import enAuth from '../../i18n/locales/en/auth.json';

const complete = vi.fn();
vi.mock('../../lib/api', () => ({
  completeFamilyWelcomeSetup: (...args: unknown[]) => complete(...args),
}));
vi.mock('./AddChildModal', () => ({
  AddChildModal: ({ onChildAdded }: { onChildAdded: () => void }) => (
    <button onClick={onChildAdded}>Finish child creation</button>
  ),
}));

import { FamilySetupPrompt } from './FamilySetupPrompt';

beforeAll(() => i18n.addResourceBundle('en', 'auth', enAuth, true, true));
afterAll(() => i18n.removeResourceBundle('en', 'auth'));

const renderPrompt = (members: any[] = []) => render(
  <MemoryRouter>
    <FamilySetupPrompt familyId="family-1" ownerId="owner-1" familyCode="ABC123" familyMembers={members} onHide={vi.fn()} />
  </MemoryRouter>,
);

describe('FamilySetupPrompt', () => {
  beforeEach(() => complete.mockReset().mockResolvedValue(undefined));

  it('uses child-count-aware wording', () => {
    const { rerender } = renderPrompt();
    expect(screen.getByRole('button', { name: 'Add a child' })).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <FamilySetupPrompt
          familyId="family-1"
          ownerId="owner-1"
          familyCode="ABC123"
          familyMembers={[{ id: 'child-1', role: 'child' }]}
          onHide={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Add another child' })).toBeInTheDocument();
    expect(screen.queryByText(/first child/i)).not.toBeInTheDocument();
  });

  it('persists completion after Skip and after successful child creation', async () => {
    const user = userEvent.setup();
    renderPrompt();
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(complete).toHaveBeenCalledWith('family-1', 'owner-1');

    complete.mockClear();
    await user.click(screen.getByRole('button', { name: 'Add a child' }));
    await user.click(screen.getByRole('button', { name: 'Finish child creation' }));
    expect(complete).toHaveBeenCalledWith('family-1', 'owner-1');
  });

  it('opens the existing invitation section without marking completion', async () => {
    const user = userEvent.setup();
    renderPrompt([{ id: 'child-1', role: 'child' }]);
    await user.click(screen.getByRole('button', { name: 'Let them join' }));
    expect(screen.getByText('ABC123')).toBeInTheDocument();
    expect(complete).not.toHaveBeenCalled();
  });

});
