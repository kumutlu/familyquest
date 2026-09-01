import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import { QuestPreviewList } from './QuestPreviewRow';

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('QuestPreviewList', () => {
  it('renders one row per quest and forwards presses', () => {
    const onPress = vi.fn();
    const onViewAll = vi.fn();
    render(wrap(
      <QuestPreviewList
        quests={[
          { id: 'q1', title: 'Make bed', pointsReward: 5 },
          { id: 'q2', title: 'Brush teeth', pointsReward: 3, isCompletedToday: true },
        ]}
        onPressQuest={onPress}
        onViewAll={onViewAll}
      />,
    ));
    expect(screen.getByTestId('quest-preview-q1')).toBeInTheDocument();
    expect(screen.getByTestId('quest-preview-q2')).toBeInTheDocument();
    expect(screen.getByTestId('quest-preview-q1')).toHaveAttribute('data-quest-completed', '0');
    expect(screen.getByTestId('quest-preview-q2')).toHaveAttribute('data-quest-completed', '1');
  });

  it('hides itself when the list is empty', () => {
    const { container } = render(wrap(
      <QuestPreviewList quests={[]} onPressQuest={vi.fn()} />,
    ));
    expect(container.firstChild).toBeNull();
  });

  it('caps the visible list at the requested maximum', () => {
    render(wrap(
      <QuestPreviewList
        quests={[
          { id: 'q1', title: 'A', pointsReward: 1 },
          { id: 'q2', title: 'B', pointsReward: 1 },
          { id: 'q3', title: 'C', pointsReward: 1 },
          { id: 'q4', title: 'D', pointsReward: 1 },
        ]}
        maxItems={2}
        onPressQuest={vi.fn()}
      />,
    ));
    expect(screen.getByTestId('quest-preview-q1')).toBeInTheDocument();
    expect(screen.getByTestId('quest-preview-q2')).toBeInTheDocument();
    expect(screen.queryByTestId('quest-preview-q3')).toBeNull();
    expect(screen.queryByTestId('quest-preview-q4')).toBeNull();
  });
});