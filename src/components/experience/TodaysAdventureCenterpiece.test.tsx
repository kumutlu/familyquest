import { describe, it, expect } from 'vitest';
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
        presentation={{ kind: 'normal', reason: 'no_special_opportunity' }}
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
        presentation={{ kind: 'normal', reason: 'no_special_opportunity' }}
        normalQuestCount={0}
        allCaughtUp={true}
      />,
    ));
    expect(screen.getByTestId('adventure-centerpiece-normal')).toHaveAttribute('data-normal-state', 'all-caught-up');
  });

  it('renders surge state with the eligible task and the surge bonus chip', () => {
    render(wrap(
      <TodaysAdventureCenterpiece
        presentation={{ kind: 'surge', reason: 'active_surge' }}
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
        presentation={{ kind: 'mystery_ready', reason: 'mystery_unlocked' }}
        mysteryDrop={{ id: 'd-1', rarity: 'rare', messageKey: 'k', isRevealReady: true }}
        onPressMysteryDrop={() => {}}
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
        presentation={{ kind: 'mystery_available', reason: 'mystery_progressing' }}
        mysteryDrop={{ id: 'd-1', rarity: 'common', messageKey: 'k', isRevealReady: false, progressLabel: '0 / 1' }}
      />,
    ));
    const locked = screen.getByTestId('adventure-centerpiece-mystery-locked');
    expect(locked).toBeInTheDocument();
    expect(locked).toHaveAttribute('data-mystery-state', 'locked');
    expect(locked).toHaveTextContent('0 / 1');
  });

  it('renders comeback shell without guilt language and surfaces tier XP pill', () => {
    render(wrap(
      <TodaysAdventureCenterpiece
        presentation={{ kind: 'comeback', reason: 'comeback_active' }}
        comeback={{ tier: 'return_3d', inactivityDays: 3, missionCompleted: false }}
      />,
    ));
    const card = screen.getByTestId('adventure-centerpiece-comeback');
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute('data-comeback-tier', 'return_3d');
    expect(card).toHaveAttribute('data-comeback-state', 'has-xp');
    // The XP pill surfaces the authoritative tier reward (25 XP for
    // return_3d). The number is bound to the resolver tier; it is not
    // invented copy.
    expect(card.textContent ?? '').toMatch(/\+\s*25\s*XP/);
    // No guilt language and no "since you checked in" repetition leak.
    expect(card.textContent ?? '').not.toMatch(/since you checked in/i);
    expect(card.textContent ?? '').not.toMatch(/Long time, no see/);
  });

  it('renders seasonal shell when nothing outranks', () => {
    render(wrap(
      <TodaysAdventureCenterpiece presentation={{ kind: 'seasonal', reason: 'seasonal_only' }} />,
    ));
    expect(screen.getByTestId('adventure-centerpiece-seasonal')).toBeInTheDocument();
  });

  it('never invents an XP number — only mirrors the host-provided count', () => {
    // Normal state with 0 quests should not display "X quests" with an invented number.
    render(wrap(
      <TodaysAdventureCenterpiece
        presentation={{ kind: 'normal', reason: 'no_special_opportunity' }}
        normalQuestCount={0}
        allCaughtUp={false}
      />,
    ));
    // Display: "0 quests waiting"
    expect(screen.getByText(/0 quests waiting/i)).toBeInTheDocument();
  });

  // ------------------------------------------------------------------
  // Comeback body i18n leak — pin EN/TR parity, no raw key leak.
  // ------------------------------------------------------------------

  it('comeback body shows resolved EN copy for return_1d (1 day)', async () => {
    render(wrap(
      <TodaysAdventureCenterpiece
        presentation={{ kind: 'comeback', reason: 'comeback_active' }}
        comeback={{ tier: 'return_1d', inactivityDays: 1, missionCompleted: false }}
      />,
    ));
    const card = screen.getByTestId('adventure-centerpiece-comeback');
    expect(card).toBeInTheDocument();
    // No raw i18n key may ever be rendered to the child.
    expect(card.textContent ?? '').not.toMatch(/child\.adventure\.comeback\.body/);
    // Resolved copy must mention the days count.
    expect(card.textContent ?? '').toMatch(/day/i);
  });

  it('comeback body shows resolved EN copy for return_3d', () => {
    render(wrap(
      <TodaysAdventureCenterpiece
        presentation={{ kind: 'comeback', reason: 'comeback_active' }}
        comeback={{ tier: 'return_3d', inactivityDays: 3, missionCompleted: false }}
      />,
    ));
    const card = screen.getByTestId('adventure-centerpiece-comeback');
    expect(card.textContent ?? '').not.toMatch(/child\.adventure\.comeback\.body/);
    // New PO 2026-09-03 copy: warm welcome + comeback bonus pill instead of
    // repeating the days-since-checked-in phrasing.
    expect(card.textContent ?? '').toMatch(/comeback bonus/i);
    expect(card.textContent ?? '').toMatch(/\+\s*25\s*XP/);
  });

  it('comeback body shows resolved EN copy for return_7d', () => {
    render(wrap(
      <TodaysAdventureCenterpiece
        presentation={{ kind: 'comeback', reason: 'comeback_active' }}
        comeback={{ tier: 'return_7d', inactivityDays: 7, missionCompleted: false }}
      />,
    ));
    const card = screen.getByTestId('adventure-centerpiece-comeback');
    expect(card.textContent ?? '').not.toMatch(/child\.adventure\.comeback\.body/);
    // New PO 2026-09-03 copy: 'Great to see you again' + comeback bonus +50 XP
    expect(card.textContent ?? '').toMatch(/Great to see you again/i);
    expect(card.textContent ?? '').toMatch(/\+\s*50\s*XP/);
    expect(card.textContent ?? '').toMatch(/comeback bonus/i);
  });

  it('comeback body shows resolved TR copy for return_7d', async () => {
    await i18n.changeLanguage('tr')
    render(wrap(
      <TodaysAdventureCenterpiece
        presentation={{ kind: 'comeback', reason: 'comeback_active' }}
        comeback={{ tier: 'return_7d', inactivityDays: 7, missionCompleted: false }}
      />,
    ))
    const card = screen.getByTestId('adventure-centerpiece-comeback')
    expect(card.textContent ?? '').not.toMatch(/child\.adventure\.comeback\.body/)
    // Turkish body resolves to a localised sentence.
    expect(card.textContent ?? '').toMatch(/g[uü]n/i)
    await i18n.changeLanguage('en')
  })

  // ------------------------------------------------------------------
  // Today's Adventure hierarchy — preserved through seasonal events.
  // ------------------------------------------------------------------

  it('seasonal shell preserves Today\'s Adventure as the daily anchor', () => {
    render(wrap(
      <TodaysAdventureCenterpiece presentation={{ kind: 'seasonal', reason: 'seasonal_only' }} />,
    ));
    const shell = screen.getByTestId('adventure-centerpiece-seasonal');
    expect(shell).toBeInTheDocument();
    // The dominant heading must read "Today's Adventure" so the child
    // never loses the daily-loop anchor even when a seasonal event
    // replaces the inner beat.
    expect(shell.textContent ?? '').toMatch(/Today's Adventure/i);
    // The seasonal chip surfaces the seasonal context as secondary
    // information, NEVER as the heading.
    expect(screen.getByTestId('adventure-centerpiece-seasonal-chip')).toBeInTheDocument();
    // The previous leak ("This week's world") is GONE.
    expect(shell.textContent ?? '').not.toMatch(/This week's world/i);
  });

  it('seasonal shell preserves Today\'s Adventure under TR locale', async () => {
    await i18n.changeLanguage('tr');
    render(wrap(
      <TodaysAdventureCenterpiece presentation={{ kind: 'seasonal', reason: 'seasonal_only' }} />,
    ));
    const shell = screen.getByTestId('adventure-centerpiece-seasonal');
    expect(shell.textContent ?? '').toMatch(/Bug[uü]n[uü]n Macerası/i);
    // Previous leak is gone.
    expect(shell.textContent ?? '').not.toMatch(/Bu haftan[uı]n d[uü]nyas[iı]/i);
    await i18n.changeLanguage('en');
  });
});