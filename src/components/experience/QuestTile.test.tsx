import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuestTile, QuestTileList } from './QuestTile';

describe('QuestTile (Child Experience V1)', () => {
  it('renders a quest with title and reward chip', () => {
    render(
      <QuestTile
        id="q-1"
        title="Tidy your room"
        pointsReward={30}
        onPress={() => {}}
      />,
    );
    const btn = screen.getByTestId('quest-tile-q-1');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent(/Tidy your room/);
    expect(btn).toHaveTextContent(/30/);
  });

  it('does not introduce a completion path — clicking only calls onPress', () => {
    const onPress = vi.fn();
    render(
      <QuestTile
        id="q-1"
        title="Walk the dog"
        pointsReward={20}
        onPress={onPress}
      />,
    );
    fireEvent.click(screen.getByTestId('quest-tile-q-1'));
    expect(onPress).toHaveBeenCalledWith('q-1');
  });

  it('marks completed quests visually without hiding them', () => {
    render(
      <QuestTile
        id="q-1"
        title="Read a book"
        pointsReward={15}
        isCompletedToday={true}
        onPress={() => {}}
      />,
    );
    const btn = screen.getByTestId('quest-tile-q-1');
    expect(btn).toHaveAttribute('data-quest-completed', '1');
  });

  it('list caps to 3 items and renders "see all" when present', () => {
    const items = [
      { id: 'a', title: 'A', pointsReward: 5, onPress: () => {} },
      { id: 'b', title: 'B', pointsReward: 5, onPress: () => {} },
      { id: 'c', title: 'C', pointsReward: 5, onPress: () => {} },
      { id: 'd', title: 'D', pointsReward: 5, onPress: () => {} },
    ];
    render(<QuestTileList quests={items} onPressQuest={() => {}} onViewAll={() => {}} />);
    expect(screen.queryByTestId('quest-tile-a')).toBeInTheDocument();
    expect(screen.queryByTestId('quest-tile-d')).not.toBeInTheDocument();
  });

  it('list renders nothing when empty', () => {
    const { container } = render(<QuestTileList quests={[]} onPressQuest={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});