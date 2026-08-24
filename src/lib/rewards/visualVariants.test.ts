import { describe, it, expect } from 'vitest';
import { getRewardVisualVariant, REWARD_ACCENT_STYLES } from './visualVariants';

describe('Reward visual variants', () => {
  it('maps known icons to designated positive accent families', () => {
    expect(getRewardVisualVariant({ icon: 'Gamepad2' })).toBe('blue');
    expect(getRewardVisualVariant({ icon: 'Pizza' })).toBe('gold');
    expect(getRewardVisualVariant({ icon: 'Gift' })).toBe('violet');
    expect(getRewardVisualVariant({ icon: 'Ticket' })).toBe('mint');
  });

  it('deterministically assigns an accent variant for arbitrary rewards', () => {
    const rewardA = { id: 'reward-123', title: 'Custom Book', icon: 'Book' };
    const variant1 = getRewardVisualVariant(rewardA);
    const variant2 = getRewardVisualVariant(rewardA);
    expect(variant1).toBe(variant2);
    expect(['violet', 'blue', 'mint', 'gold']).toContain(variant1);
  });

  it('never assigns coral or red to rewards', () => {
    const allVariants = ['Gamepad2', 'Pizza', 'Gift', 'Ticket', 'Star', 'Custom', 'Other'].map(icon =>
      getRewardVisualVariant({ icon }),
    );
    for (const v of allVariants) {
      expect(v).not.toBe('coral');
      expect(v).not.toBe('red');
    }
  });

  it('provides accessible light/dark style tokens for all variants', () => {
    for (const variant of ['violet', 'blue', 'mint', 'gold'] as const) {
      const styles = REWARD_ACCENT_STYLES[variant];
      expect(styles.iconBg).toBeDefined();
      expect(styles.iconBg).not.toContain('coral');
      expect(styles.iconBg).not.toContain('red');
    }
  });
});
