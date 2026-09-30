import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n/config';
import { Step6FamilyName } from './Step6FamilyName';

describe('Step6FamilyName', () => {
  it('never exposes a full email address in the family-name suggestion', async () => {
    const patch = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <Step6FamilyName
          draft={{ parentFirstName: 'parent@example.com', familyName: '', step: 's6' } as any}
          patch={patch}
          onNext={vi.fn()}
          onBack={vi.fn()}
        />
      </I18nextProvider>,
    );

    expect(screen.queryByText(/parent@example\.com/i)).not.toBeInTheDocument();
    const suggestion = screen.getByRole('button', { name: /family/i });
    await userEvent.click(suggestion);
    expect(patch).not.toHaveBeenCalledWith(expect.objectContaining({ familyName: expect.stringContaining('@') }));
  });
});
