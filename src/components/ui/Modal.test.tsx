import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import i18n from '../../i18n/config';
import { Modal } from './Modal';

function renderModal(onClose = () => {}) {
  return render(
    <Modal isOpen title="Test dialog" onClose={onClose}>
      <p>Body content</p>
    </Modal>,
  );
}

beforeEach(async () => {
  await act(async () => { await i18n.changeLanguage('en'); });
});

afterEach(async () => {
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe('Modal — shared dialog labels', () => {
  it('renders the title and an English close-dialog label', () => {
    renderModal();
    expect(screen.getByRole('heading', { name: 'Test dialog' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close dialog/i })).toBeInTheDocument();
  });

  it('renders a Turkish close-dialog label when language is tr', async () => {
    await act(async () => { await i18n.changeLanguage('tr'); });
    renderModal();
    expect(screen.getByRole('button', { name: /kapat/i })).toBeInTheDocument();
  });

  it('switches the close-dialog label when the language changes', async () => {
    const { rerender } = renderModal();
    expect(screen.getByRole('button', { name: /close dialog/i })).toBeInTheDocument();
    await act(async () => { await i18n.changeLanguage('tr'); });
    rerender(
      <Modal isOpen title="Test dialog" onClose={() => {}}>
        <p>Body content</p>
      </Modal>,
    );
    expect(screen.getByRole('button', { name: /kapat/i })).toBeInTheDocument();
  });
});
