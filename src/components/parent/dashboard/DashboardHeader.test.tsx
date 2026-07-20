import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ current: {} as any }));
vi.mock('../../../store/useStore', () => ({ useStore: () => state.current }));

import { getGreeting, DashboardHeader } from './DashboardHeader';

describe('getGreeting', () => {
  it('returns the correct part-of-day greeting key', () => {
    expect(getGreeting(new Date('2026-07-14T08:00:00Z'))).toBe('morning');
    expect(getGreeting(new Date('2026-07-14T14:00:00Z'))).toBe('afternoon');
    expect(getGreeting(new Date('2026-07-14T20:00:00Z'))).toBe('evening');
  });
});

describe('DashboardHeader', () => {
  it('shows the first name and the family badge', () => {
    state.current = {
      currentUser: { displayName: 'Kemal Yilmaz' },
      familyData: { name: 'Umutlu' },
    };
    render(<DashboardHeader />);
    expect(screen.getByText(/Kemal/)).toBeInTheDocument();
    expect(screen.getByText(/Umutlu family/)).toBeInTheDocument();
  });

  it('falls back to a generic name and omits the badge when data is missing', () => {
    state.current = { currentUser: {}, familyData: {} };
    const { container } = render(<DashboardHeader />);
    expect(screen.getByText(/there/)).toBeInTheDocument();
    // No family badge (the only bg-primary-50 element is the badge).
    expect(container.querySelector('.bg-primary-50')).toBeNull();
  });
});
