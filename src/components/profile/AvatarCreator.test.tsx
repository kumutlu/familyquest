import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AvatarCreator } from './AvatarCreator';
import { AVATAR_CONFIG_DEFAULT, isValidAvatarConfig } from '../../config/avatarConfig';

describe('AvatarCreator', () => {
  it('shows a large live preview and changes the selected category immediately', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AvatarCreator value={AVATAR_CONFIG_DEFAULT} onChange={onChange} />);

    expect(screen.getByRole('img', { name: 'Avatar preview' })).toHaveClass('h-40', 'w-40');
    await user.click(screen.getByRole('tab', { name: 'Hair' }));
    await user.click(screen.getByRole('button', { name: 'Curls' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ hairStyle: 'curls' }));
  });

  it('supports every creator category without horizontal page overflow', async () => {
    render(<AvatarCreator value={AVATAR_CONFIG_DEFAULT} onChange={() => {}} />);
    for (const name of ['Base', 'Skin tone', 'Hair', 'Face', 'Accessories', 'Outfit', 'Background']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    expect(screen.getByTestId('avatar-creator')).toHaveClass('min-w-0');
    expect(screen.getByTestId('avatar-category-options')).not.toHaveClass('overflow-x-auto');
  });

  it('Surprise Me emits only a valid allowlisted configuration', async () => {
    const onChange = vi.fn();
    render(<AvatarCreator value={AVATAR_CONFIG_DEFAULT} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Surprise me' }));
    expect(isValidAvatarConfig(onChange.mock.calls.at(-1)?.[0])).toBe(true);
  });

  it('disables all editing while a profile request is pending', () => {
    render(<AvatarCreator value={AVATAR_CONFIG_DEFAULT} onChange={() => {}} disabled />);
    expect(screen.getByRole('button', { name: 'Surprise me' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Hair' })).toBeDisabled();
  });
});
