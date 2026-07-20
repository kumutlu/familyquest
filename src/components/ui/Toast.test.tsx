import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import i18n from '../../i18n/config';
import { Toast } from './Toast';
import type { ToastData } from './Toast';

const toast: ToastData = { id: 1, message: 'Saved!', type: 'success' };

function renderToast(onDismiss = () => {}) {
  return render(<Toast toast={toast} onDismiss={onDismiss} />);
}

beforeEach(async () => {
  await act(async () => { await i18n.changeLanguage('en'); });
});

afterEach(async () => {
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe('Toast — shared labels', () => {
  it('renders the message and an English dismiss label', () => {
    renderToast();
    expect(screen.getByText('Saved!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss notification/i })).toBeInTheDocument();
  });

  it('renders a Turkish dismiss label when language is tr', async () => {
    await act(async () => { await i18n.changeLanguage('tr'); });
    renderToast();
    expect(screen.getByRole('button', { name: /bildirimi kapat/i })).toBeInTheDocument();
  });

  it('switches the dismiss label when the language changes', async () => {
    const { rerender } = renderToast();
    expect(screen.getByRole('button', { name: /dismiss notification/i })).toBeInTheDocument();
    await act(async () => { await i18n.changeLanguage('tr'); });
    rerender(<Toast toast={toast} onDismiss={() => {}} />);
    expect(screen.getByRole('button', { name: /bildirimi kapat/i })).toBeInTheDocument();
  });
});
