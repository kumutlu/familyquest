import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/config';
import { DailyCheckinModal } from './DailyCheckinModal';

const animalLabels = [
  'Cheetah, energetic',
  'Lion, brave',
  'Monkey, playful',
  'Owl, ready to learn',
  'Fox, curious',
  'Panda, calm',
  'Turtle, taking it slowly',
  'Sloth, tired',
];

async function renderModal(overrides: Partial<React.ComponentProps<typeof DailyCheckinModal>> = {}) {
  const props: React.ComponentProps<typeof DailyCheckinModal> = {
    open: true,
    locked: false,
    error: null,
    onSelect: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  const user = userEvent.setup();
  render(<DailyCheckinModal {...props} />);
  return { user, props };
}

beforeEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
    await i18n.loadNamespaces(['checkins']);
  });
});

afterEach(async () => {
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe('DailyCheckinModal', () => {
  it('submits immediately with accessible animal and feeling text', async () => {
    const onSelect = vi.fn();
    const { user } = await renderModal({ onSelect });

    await user.click(screen.getByRole('button', { name: /Cheetah, energetic/i }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('cheetah');
    expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument();
  });

  it('renders all eight choices as keyboard-operable buttons in catalog order', async () => {
    const onSelect = vi.fn();
    const { user } = await renderModal({ onSelect });
    const choices = screen.getAllByRole('button').filter(choice =>
      animalLabels.includes(choice.getAttribute('aria-label') ?? ''),
    );

    expect(choices.map((choice) => choice.getAttribute('aria-label'))).toEqual(animalLabels);
    choices[0].focus();
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith('cheetah');
  });

  it.each(['close', 'escape', 'backdrop', 'skip'] as const)(
    'routes %s through the shared dismissal callback',
    async (route) => {
      const onDismiss = vi.fn();
      const { user } = await renderModal({ onDismiss });

      if (route === 'close') await user.click(screen.getByRole('button', { name: /close/i }));
      if (route === 'escape') await user.keyboard('{Escape}');
      if (route === 'backdrop') await user.click(screen.getByTestId('modal-backdrop'));
      if (route === 'skip') {
        await user.click(screen.getByRole('button', { name: /Skip for today/i }));
      }

      expect(onDismiss).toHaveBeenCalledOnce();
    },
  );

  it('locks every selection and dismissal control during a mutation', async () => {
    const onSelect = vi.fn();
    const onDismiss = vi.fn();
    const { user } = await renderModal({ locked: true, onSelect, onDismiss });
    const animal = screen.getByRole('button', { name: /Cheetah, energetic/i });
    const skip = screen.getByRole('button', { name: /Skip for today/i });
    const close = screen.getByRole('button', { name: /close/i });

    expect(animal).toBeDisabled();
    expect(skip).toBeDisabled();
    expect(close).toHaveAttribute('aria-disabled', 'true');
    await user.click(animal);
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('modal-backdrop'));
    await user.click(skip);
    await user.click(close);

    expect(onSelect).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('announces pending and error feedback without implying completion', async () => {
    const { rerender } = render(
      <DailyCheckinModal
        open
        locked
        error={null}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toHaveTextContent('Saving your check-in…');

    rerender(
      <DailyCheckinModal
        open
        locked={false}
        error="We couldn't save that yet. Please try again."
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't save that yet. Please try again.");
  });

  it('uses the loaded locale for visible copy and screen-reader labels', async () => {
    await act(async () => { await i18n.changeLanguage('tr'); });
    await renderModal();

    expect(screen.getByRole('dialog', { name: 'Bugün hangisisin?' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Çita, enerjik' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Bugünlük geç' })).toBeVisible();
  });

  it('does not render while closed and uses the modal reduced-motion treatment when open', async () => {
    const { rerender } = render(
      <DailyCheckinModal
        open={false}
        locked={false}
        error={null}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <DailyCheckinModal
        open
        locked={false}
        error={null}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId('modal-panel')).toHaveClass('motion-reduce:animate-none');
  });
});
