import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import { TodaysAdventure, type MysteryDropDisplay } from './TodaysAdventure';

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

const PRESENTATION_NORMAL = { kind: 'normal' as const, reason: 'no_special_opportunity' as const };
const PRESENTATION_LOADING = { kind: 'loading' as const, reason: 'state_unresolved' as const };
const PRESENTATION_SEASONAL = { kind: 'seasonal' as const, reason: 'seasonal_only' as const };
const PRESENTATION_COMEBACK = { kind: 'comeback' as const, reason: 'comeback_active' as const };
const PRESENTATION_MYSTERY_READY = { kind: 'mystery_ready' as const, reason: 'mystery_unlocked' as const };
const PRESENTATION_MYSTERY_AVAILABLE = { kind: 'mystery_available' as const, reason: 'mystery_progressing' as const };

describe('TodaysAdventure', () => {
  it('renders the calm loading card when the host has not resolved state', () => {
    render(wrap(
      <TodaysAdventure
        onSelectSurgeTask={vi.fn()}
        presentation={PRESENTATION_LOADING}
      />,
    ));
    expect(screen.getByTestId('todays-adventure')).toBeInTheDocument();
    expect(screen.getByTestId('todays-adventure-loading')).toBeInTheDocument();
    expect(screen.getByTestId('todays-adventure')).toHaveAttribute('data-adventure-kind', 'loading');
  });

  it('renders the calm normal fallback when there is no special opportunity', () => {
    render(wrap(
      <TodaysAdventure
        onSelectSurgeTask={vi.fn()}
        presentation={PRESENTATION_NORMAL}
        normalQuestCount={3}
        onViewQuests={vi.fn()}
      />,
    ));
    expect(screen.getByTestId('todays-adventure-normal')).toBeInTheDocument();
    expect(screen.getByTestId('todays-adventure-normal')).toHaveAttribute('data-normal-state', 'quests-waiting');
  });

  it('renders the all-caught-up normal fallback when there are zero quests', () => {
    render(wrap(
      <TodaysAdventure
        onSelectSurgeTask={vi.fn()}
        presentation={PRESENTATION_NORMAL}
        normalQuestCount={0}
        allCaughtUp
      />,
    ));
    expect(screen.getByTestId('todays-adventure-normal')).toHaveAttribute('data-normal-state', 'all-caught-up');
  });

  it('renders the seasonal accent when no other opportunity outranks it', () => {
    render(wrap(
      <TodaysAdventure
        onSelectSurgeTask={vi.fn()}
        presentation={PRESENTATION_SEASONAL}
      />,
    ));
    expect(screen.getByTestId('todays-adventure-seasonal')).toBeInTheDocument();
  });

  it('renders the comeback card when presentation is comeback', () => {
    render(wrap(
      <TodaysAdventure
        onSelectSurgeTask={vi.fn()}
        presentation={PRESENTATION_COMEBACK}
        comeback={{ tier: 'return_3d', inactivityDays: 3, missionCompleted: false }}
        onPressComeback={vi.fn()}
      />,
    ));
    expect(screen.getByTestId('comeback-mission-card')).toBeInTheDocument();
  });

  it('renders the MYSTERY READY card when presentation is mystery_ready', () => {
    const drop: MysteryDropDisplay = {
      id: 'm1',
      rarity: 'rare',
      messageKey: 'child.adventure.mystery.lockedLead',
      isRevealReady: true,
    };
    render(wrap(
      <TodaysAdventure
        onSelectSurgeTask={vi.fn()}
        presentation={PRESENTATION_MYSTERY_READY}
        mysteryDrop={drop}
        onPressMysteryDrop={vi.fn()}
      />,
    ));
    const ready = screen.getByTestId('todays-adventure-mystery-ready');
    expect(ready).toBeInTheDocument();
    expect(ready).toHaveAttribute('data-mystery-state', 'ready');
    expect(ready).toHaveAttribute('data-mystery-rarity', 'rare');
  });

  it('renders the LOCKED Mystery card when presentation is mystery_available', () => {
    const drop: MysteryDropDisplay = {
      id: 'm2',
      rarity: 'common',
      messageKey: 'child.adventure.mystery.lockedLead',
      isRevealReady: false,
      progressLabel: '0 / 1',
    };
    render(wrap(
      <TodaysAdventure
        onSelectSurgeTask={vi.fn()}
        presentation={PRESENTATION_MYSTERY_AVAILABLE}
        mysteryDrop={drop}
      />,
    ));
    const locked = screen.getByTestId('todays-adventure-mystery-locked');
    expect(locked).toBeInTheDocument();
    expect(locked).toHaveAttribute('data-mystery-state', 'locked');
  });

  it('does not show the urgency badge without an active surge', () => {
    render(wrap(
      <TodaysAdventure
        urgency="ending"
        presentation={PRESENTATION_COMEBACK}
        comeback={{ tier: 'return_3d', inactivityDays: 3, missionCompleted: false }}
        onSelectSurgeTask={vi.fn()}
      />,
    ));
    expect(screen.queryByTestId('todays-adventure-urgency')).toBeNull();
  });

  it('NEVER flashes a special opportunity when the host reports loading', () => {
    // Even if a host accidentally passes surge + comeback while still
    // loading, the loading kind MUST win so we never flash a reward
    // before authoritative state has settled.
    render(wrap(
      <TodaysAdventure
        urgency="ending"
        presentation={PRESENTATION_LOADING}
        comeback={{ tier: 'return_3d', inactivityDays: 3, missionCompleted: false }}
        onSelectSurgeTask={vi.fn()}
      />,
    ));
    expect(screen.queryByTestId('comeback-mission-card')).toBeNull();
    expect(screen.getByTestId('todays-adventure-loading')).toBeInTheDocument();
  });
});