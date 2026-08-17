import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../src/i18n/config';
import {
  REPO_ROOT,
  contrastRatio,
  parseUtility,
  relativeLuminance,
  resolveToken,
  resolveUtility,
  type Rgb,
  type UtilityRef,
} from './themeTokens';

/**
 * Family Bulletin — dark-mode regression test.
 *
 * Production defect (found after 94ac492): in dark mode the announcement card
 * kept the light `bg-amber-50` / `bg-red-50` tint while the title, body and
 * Edit/Archive/Delete labels used neutral text tokens that flip to near-white —
 * an unreadable light-card/light-text surface. The previous automated check only
 * looked for literal `bg-white`, so it never saw it.
 *
 * This test renders the real component in dark mode across every state (unread,
 * read, collapsed, expanded, multiple announcements, history, all three
 * priorities) and computes the effective foreground/background contrast of each
 * rendered node from the project's actual colour tokens.
 */

const state = vi.hoisted(() => ({
  currentUser: { id: 'owner1', familyId: 'f1', role: 'owner' } as any,
  familyMembers: [] as any[],
  tasks: [] as any[],
  items: [] as any[],
  readIds: new Set<string>(),
}));
const api = vi.hoisted(() => ({
  markRead: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
  subscribeAnnouncements: vi.fn(),
  subscribeReads: vi.fn(),
}));

vi.mock('../../src/store/useStore', () => ({
  useStore: (selector: any) => selector(state),
}));
vi.mock('../../src/lib/familyBulletin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/familyBulletin')>();
  return {
    ...actual,
    markAnnouncementRead: api.markRead,
    archiveAnnouncement: api.archive,
    deleteAnnouncement: api.remove,
    subscribeToAnnouncements: api.subscribeAnnouncements,
    subscribeToAnnouncementReads: api.subscribeReads,
  };
});
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => vi.fn() };
});

import { FamilyBulletin } from '../../src/components/bulletin/FamilyBulletin';

const MIN_TEXT_CONTRAST = 4.5;
const MAX_DARK_SURFACE_LUMINANCE = 0.25;

/** Body colour in dark mode (`.dark body { color: #f1f5f9 }`). */
const DARK_BODY_TEXT: Rgb = [241, 245, 249];

function announcement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    familyId: 'f1',
    title: 'Family meeting',
    message: 'Saturday 10:00 in the kitchen.\nBring your charts.',
    type: 'general',
    audienceType: 'family',
    audienceUserIds: [],
    priority: 'important',
    pinned: false,
    status: 'active',
    createdBy: 'owner1',
    createdAt: 3,
    updatedAt: 3,
    ...overrides,
  } as any;
}

/**
 * Effective colour resolution mirroring the browser: within `.dark`, a `dark:`
 * variant wins over the base utility; in light mode only the base utility
 * applies. Colours inherit from the nearest ancestor that declares one.
 */
function pick(element: Element, kind: 'bg' | 'text', mode: 'light' | 'dark'): UtilityRef | null {
  const refs = Array.from(element.classList)
    .map(parseUtility)
    .filter((ref): ref is UtilityRef => ref !== null && ref.kind === kind);
  // Ignore state variants (hover/focus/group-*) — they are not the resting style.
  const resting = refs.filter((ref) =>
    ref.variants.every((variant) => variant === 'dark' || /^(sm|md|lg|xl)$/.test(variant)),
  );
  const base = resting.find((ref) => ref.variants.length === 0) ?? null;
  if (mode === 'light') return base;
  return resting.find((ref) => ref.variants.includes('dark')) ?? base;
}

function inherited(
  element: Element,
  root: Element,
  kind: 'bg' | 'text',
  mode: 'light' | 'dark',
): Rgb | null {
  let node: Element | null = element;
  while (node) {
    const ref = pick(node, kind, mode);
    const colour = ref ? resolveUtility(ref, mode) : null;
    if (colour) return colour;
    if (node === root) break;
    node = node.parentElement;
  }
  return null;
}

function effectiveBackground(element: Element, root: Element, mode: 'light' | 'dark'): Rgb {
  return (
    inherited(element, root, 'bg', mode) ??
    resolveToken('gray-50', mode) ?? [255, 255, 255]
  );
}

function effectiveColour(element: Element, root: Element, mode: 'light' | 'dark'): Rgb {
  return (
    inherited(element, root, 'text', mode) ?? (mode === 'dark' ? DARK_BODY_TEXT : [17, 24, 39])
  );
}

/** Elements that render their own text (not just layout wrappers). */
function textNodes(root: Element): Element[] {
  return Array.from(root.querySelectorAll<HTMLElement>('*'))
    .concat([root as HTMLElement])
    .filter((element) =>
      Array.from(element.childNodes).some(
        (child) => child.nodeType === 3 && (child.textContent ?? '').trim().length > 0,
      ),
    );
}

/**
 * Every rendered label must clear WCAG AA in dark mode. The one tolerated
 * exception is a colour pair that is *identically* imperfect in light mode
 * (e.g. white on the `primary-500` brand fill sits at 4.47:1 in both themes):
 * that is a pre-existing brand decision, not a dark-theme regression. Dark mode
 * may never be *worse* than the shipped light-mode baseline.
 */
function assertReadable(root: Element, label: string) {
  const surface = effectiveBackground(root, root, 'dark');
  expect(
    relativeLuminance(surface),
    `${label}: announcement surface is light in dark mode → rgb(${surface.join(', ')})`,
  ).toBeLessThan(MAX_DARK_SURFACE_LUMINANCE);

  for (const element of textNodes(root)) {
    const text = (element.textContent ?? '').trim().slice(0, 40);
    const dark = contrastRatio(
      effectiveColour(element, root, 'dark'),
      effectiveBackground(element, root, 'dark'),
    );
    const light = contrastRatio(
      effectiveColour(element, root, 'light'),
      effectiveBackground(element, root, 'light'),
    );
    expect(
      dark >= MIN_TEXT_CONTRAST || dark >= light,
      `${label}: "${text}" (${element.className}) reaches only ${dark.toFixed(2)}:1 in dark mode (light mode: ${light.toFixed(2)}:1)`,
    ).toBe(true);
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  document.documentElement.classList.add('dark');
  state.currentUser = { id: 'owner1', familyId: 'f1', role: 'owner' };
  state.readIds = new Set();
  api.subscribeAnnouncements.mockImplementation((_f: string, _u: any, next: any) => {
    next(state.items);
    return () => {};
  });
  api.subscribeReads.mockImplementation((_f: string, _u: string, next: any) => {
    next(state.readIds);
    return () => {};
  });
  await i18n.loadNamespaces(['bulletin', 'common']);
  await i18n.changeLanguage('en');
});

afterEach(() => {
  document.documentElement.classList.remove('dark');
});

describe('Family Bulletin — dark mode', () => {
  it('declares an explicit dark surface for every announcement priority', () => {
    const source = readFileSync(
      resolve(REPO_ROOT, 'src/components/bulletin/FamilyBulletin.tsx'),
      'utf8',
    );
    const tone = /const tone[^=]*=\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
    expect(tone, 'tone map not found in FamilyBulletin.tsx').not.toBe('');

    for (const priority of ['normal', 'important', 'urgent']) {
      const line = new RegExp(`${priority}:\\s*'([^']*)'`).exec(tone)?.[1] ?? '';
      expect(line, `no tone entry for ${priority}`).not.toBe('');
      expect(
        line,
        `${priority} announcements have no explicit dark surface (dark:bg-*) — a light tint would survive into dark mode`,
      ).toMatch(/dark:bg-/);

      const surface = line
        .split(/\s+/)
        .map(parseUtility)
        .find((ref) => ref?.kind === 'bg' && ref.variants.includes('dark'));
      const colour = surface ? resolveUtility(surface, 'dark') : null;
      expect(colour, `${priority} dark surface does not resolve`).not.toBeNull();
      expect(
        relativeLuminance(colour as Rgb),
        `${priority} dark surface is not dark`,
      ).toBeLessThan(MAX_DARK_SURFACE_LUMINANCE);
    }
  });

  it.each(['normal', 'important', 'urgent'] as const)(
    'renders a readable unread %s announcement (title, body, Mark as read, Edit, Archive, Delete)',
    (priority) => {
      state.items = [announcement({ priority, id: priority })];
      render(
        <MemoryRouter>
          <FamilyBulletin />
        </MemoryRouter>,
      );

      const card = screen.getByTestId('bulletin-announcement');
      expect(card.getAttribute('data-read')).toBe('false');
      // The states named in the release checklist must all be present.
      expect(within(card).getByTestId('bulletin-title')).toBeInTheDocument();
      expect(within(card).getByTestId('bulletin-message')).toBeInTheDocument();
      for (const name of ['Mark as read', 'Edit', 'Archive', 'Delete']) {
        expect(within(card).getByRole('button', { name })).toBeInTheDocument();
      }
      assertReadable(card, `unread ${priority}`);
    },
  );

  it('renders a readable read announcement (Mark as read removed)', () => {
    state.items = [announcement({ id: 'read1' })];
    state.readIds = new Set(['read1']);
    render(
      <MemoryRouter>
        <FamilyBulletin />
      </MemoryRouter>,
    );

    const card = screen.getByTestId('bulletin-announcement');
    expect(card.getAttribute('data-read')).toBe('true');
    expect(within(card).queryByRole('button', { name: 'Mark as read' })).not.toBeInTheDocument();
    assertReadable(card, 'read announcement');
  });

  it('renders readable collapsed and expanded multi-announcement states', async () => {
    state.items = [
      announcement({ id: 'first', priority: 'urgent', title: 'Urgent one', pinned: true }),
      announcement({ id: 'second', priority: 'important', title: 'Important two', createdAt: 2 }),
      announcement({ id: 'third', priority: 'normal', title: 'Normal three', createdAt: 1 }),
    ];
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <FamilyBulletin />
      </MemoryRouter>,
    );

    // Collapsed: only the first announcement plus the "Show N more" affordance.
    expect(screen.getAllByTestId('bulletin-announcement')).toHaveLength(1);
    assertReadable(screen.getByTestId('bulletin-announcement'), 'collapsed');

    await user.click(screen.getByRole('button', { name: /Show 2 more/ }));
    const expanded = screen.getAllByTestId('bulletin-announcement');
    expect(expanded).toHaveLength(3);
    expanded.forEach((card, index) =>
      assertReadable(card, `expanded #${index + 1} (${card.getAttribute('data-priority')})`),
    );
  });

  it('renders a readable history state', async () => {
    state.items = [
      announcement({ id: 'archived', status: 'archived', title: 'Archived note' }),
      announcement({ id: 'active', title: 'Active note' }),
    ];
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <FamilyBulletin />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'History' }));
    const cards = screen.getAllByTestId('bulletin-announcement');
    expect(cards).toHaveLength(1);
    expect(within(cards[0]).getByText('Archived note')).toBeInTheDocument();
    assertReadable(cards[0], 'history');
  });

  it('keeps the announcement light in light mode (no dark bleed)', () => {
    document.documentElement.classList.remove('dark');
    state.items = [announcement({ id: 'light1' })];
    render(
      <MemoryRouter>
        <FamilyBulletin />
      </MemoryRouter>,
    );

    const card = screen.getByTestId('bulletin-announcement');
    const base = Array.from(card.classList)
      .map(parseUtility)
      .find((ref) => ref?.kind === 'bg' && ref.variants.length === 0);
    const colour = base ? resolveUtility(base, 'light') : null;
    expect(colour, 'no base (light) surface on the announcement').not.toBeNull();
    expect(relativeLuminance(colour as Rgb)).toBeGreaterThan(0.6);
  });

  it('paints a distinct semantic left accent border per priority (native dark card, not a coloured fill)', () => {
    const expected: Record<string, string> = {
      normal: 'border-l-primary-500',
      important: 'border-l-amber-400',
      urgent: 'border-l-red-500',
    };
    for (const priority of ['normal', 'important', 'urgent'] as const) {
      state.items = [announcement({ priority, id: priority })];
      const { container } = render(
        <MemoryRouter>
          <FamilyBulletin />
        </MemoryRouter>,
      );
      const card = container.querySelector('[data-testid="bulletin-announcement"]') as HTMLElement;
      expect(card.className, `${priority} should carry its accent border`).toContain(expected[priority]);
      // The card surface itself stays neutral — no full coloured fill.
      expect(card.className).toContain('bg-white');
      expect(card.className).not.toMatch(/bg-(amber|red|primary)-50/);
    }
  });

  it('shows a "New" badge on unread cards', () => {
    state.items = [announcement({ id: 'unread1' })];
    state.readIds = new Set();
    render(
      <MemoryRouter>
        <FamilyBulletin />
      </MemoryRouter>,
    );
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('hides the "New" badge on read cards', () => {
    state.items = [announcement({ id: 'read1' })];
    state.readIds = new Set(['read1']);
    render(
      <MemoryRouter>
        <FamilyBulletin />
      </MemoryRouter>,
    );
    expect(screen.queryByText('New')).not.toBeInTheDocument();
  });

  it('renders read announcements with a dimmed neutral border and stays readable', () => {
    state.items = [announcement({ id: 'read1', priority: 'important' })];
    state.readIds = new Set(['read1']);
    render(
      <MemoryRouter>
        <FamilyBulletin />
      </MemoryRouter>,
    );
    const card = screen.getByTestId('bulletin-announcement');
    expect(card.className).toContain('border-l-gray-300');
    expect(card.className).not.toContain('border-l-amber-400');
    assertReadable(card, 'read (quiet) announcement');
  });
});
