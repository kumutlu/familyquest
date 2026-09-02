import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import { TodaysAdventureCenterpiece } from './TodaysAdventureCenterpiece';

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe("TodaysAdventureCenterpiece (Today's Adventure V1 productization)", () => {
  it('renders normal state with quest count from the host', () => {
    render(wrap(
      <TodaysAdventureCenterpiece
        presentation={{ kind: 'normal' }}
        normalQuestCount={3}
        allCaughtUp={false}
      />,
    ));
    expect(screen.getByTestId('adventure-centerpiece-normal')).toBeInTheDocument();
    expect(screen.getByTestId('adventure-centerpiece-normal')).toHaveAttribute('data-normal-state', 'quests-waiting');
  });

  it('renders normal all-caught-up state', () => {
    render(wrap(
      <TodaysAdventureCenterpiece
        presentation={{ kind: 'normal' }}
        normalQuestCount={0}
        allCaughtUp={true}
      />,
    ));
    expect(screen.getByTestId('adventure-centerpiece-normal')).toHaveAttribute('data-normal-state', 'all-caught-up');
  });

  it('renders surge state with the eligible task and the surge bonus chip', () => {
    render(wrap(
      <TodaysAdventureCenterpiece
        presentation={{ kind: 'surge' }}
        surge={{
          surgeId: 'sg-1',
          eligibleTasks: [{ id: 't-1', title: 'Vacuum the house', pointsReward: 30 }],
          endsAt: Date.now() + 18 * 60_000,
        }}
        onSelectSurgeTask={() => {}}
      />,
    ));
    const surge = screen.getByTestId('adventure-centerpiece-surge');
    expect(surge).toBeInTheDocument();
    expect(surge).toHaveTextContent(/Vacuum the house/);
    expect(surge).toHaveTextContent(/2.*XP/);
  });

  it('renders mystery-ready state as the visual focal point', () => {
    render(wrap(
      <TodaysAdventureCenterpiece
        presentation={{ kind: 'mystery_ready' }}
        mysteryDrop={{ id: 'd-1', rarity: 'rare', messageKey: 'k', isRevealReady: true }}
        onOpen={() => {}}
      />,
    ));
    const ready = screen.getByTestId('adventure-centerpiece-mystery-ready');
    expect(ready).toBeInTheDocument();
    expect(ready).toHaveAttribute('data-mystery-state', 'ready');
    fireEvent.click(ready);
  });

  it('renders mystery-locked state with progress label', () => {
    render(wrap(
      <TodaysAdventureCenterpiece
        presentation={{ kind: 'mystery_available' }}
        mysteryDrop={{ id: 'd-1', rarity: 'common', messageKey: 'k', isRevealReady: false, progressLabel: '0 / 1' }}
      />,
    ));
    const locked = screen.getByTestId('adventure-centerpiece-mystery-locked');
    expect(locked).toBeInTheDocument();
    expect(locked).toHaveAttribute('data-mystery-state', 'locked');
    expect(locked).toHaveTextContent('0 / 1');
  });

  it('renders comeback shell without guilt language and never invents XP', () => {
    render(wrap(
      <TodaysAdventureCenterpiece
        presentation={{ kind: 'comeback' }}
        comeback={{ tier: 'return_3d', inactivityDays: 3, missionCompleted: false }}
      />,
    ));
    const card = screen.getByTestId('adventure-centerpiece-comeback');
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute('data-comeback-tier', 'return_3d');
    // No raw "25 XP" promises — the resolver owns the XP award.
    expect(card.textContent ?? '').not.toMatch(/\+\s*25\s*XP/);
  });

  it('renders seasonal shell when nothing outranks', () => {
    render(wrap(
      <TodaysAdventureCenterpiece presentation={{ kind: 'seasonal' }} />,
    ));
    expect(screen.getByTestId('adventure-centerpiece-seasonal')).toBeInTheDocument();
  });

  it('never invents an XP number — only mirrors the host-provided count', () => {
    // Normal state with 0 quests should not display "X quests" with an invented number.
    render(wrap(
      <TodaysAdventureCenterpiece
        presentation={{ kind: 'normal' }}
        normalQuestCount={0}
        allCaughtUp={false}
      />,
    ));
    // Display: "0 quests waiting"
    expect(screen.getByText(/0 quests waiting/i)).toBeInTheDocument();
  });
});