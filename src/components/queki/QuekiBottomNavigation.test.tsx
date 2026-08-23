import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n/config';
import { QuekiBottomNavigation } from './QuekiBottomNavigation';
import { getRoleAwareAction } from './RoleAwareAction';

describe('QuekiBottomNavigation', () => {
  const renderNav = (role = 'parent', path = '/') =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <QuekiBottomNavigation role={role} onActionPress={() => undefined} />
      </MemoryRouter>,
    );

  beforeEach(async () => {
    await i18n.loadNamespaces(['common']);
    await i18n.changeLanguage('en');
  });

  it('renders the four primary destinations plus the centre action', () => {
    renderNav();
    expect(screen.getByTestId('queki-nav-home')).toHaveAttribute('href', '/');
    expect(screen.getByTestId('queki-nav-quests')).toHaveAttribute('href', '/tasks');
    expect(screen.getByTestId('queki-nav-rewards')).toHaveAttribute('href', '/rewards');
    expect(screen.getByTestId('queki-nav-family')).toHaveAttribute('href', '/family');
    expect(screen.getByTestId('queki-centre-action')).toBeInTheDocument();
  });

  it('marks the active destination with aria-current (not colour alone)', () => {
    renderNav('parent', '/tasks');
    expect(screen.getByTestId('queki-nav-quests')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('queki-nav-home')).not.toHaveAttribute('aria-current');
  });

  it('exposes an accessible name for the role-aware centre action', () => {
    renderNav('owner');
    expect(screen.getByTestId('queki-centre-action')).toHaveAttribute(
      'aria-label',
      'Create something new',
    );
  });
});

describe('getRoleAwareAction', () => {
  it('maps parents to the create action', () => {
    expect(getRoleAwareAction('parent').labelKey).toBe('nav.action.parent');
    expect(getRoleAwareAction('owner').labelKey).toBe('nav.action.parent');
  });

  it('maps children to the do action', () => {
    expect(getRoleAwareAction('child').labelKey).toBe('nav.action.child');
  });

  it('defaults unknown roles to the parent-safe create action', () => {
    expect(getRoleAwareAction(undefined).labelKey).toBe('nav.action.parent');
  });
});
