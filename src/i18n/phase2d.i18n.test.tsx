import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from './config';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const store = vi.hoisted(() => ({
  currentUser: {
    id: 'u1',
    uid: 'u1',
    familyId: 'f1',
    role: 'parent',
    displayName: 'Sam',
    email: 'sam@example.com',
    rewardPoints: 0,
  },
  authUser: { email: 'sam@example.com' },
  familyData: { id: 'f1', name: 'The Smiths', currency: '£', inviteCode: 'ABC123' },
  familyMembers: [] as any[],
  profileUpdateRequests: [] as any[],
  behaviourEvents: [] as any[],
  funds: [] as any[],
  fundTransactions: [] as any[],
  petboxRequests: [] as any[],
  reversals: [] as any[],
  myWallet: { balance: 0 },
  loading: false,
}));

vi.mock('../store/useStore', () => ({
  useStore: Object.assign(() => store, { getState: () => store }),
}));

vi.mock('../lib/roles', () => ({
  isOwnerRole: (role: string) => role === 'owner',
  isParentRole: (role: string) => role === 'parent' || role === 'owner',
  isChildRole: (role: string) => role === 'child',
  getRoleLabel: (role: string) => role,
}));

const api = vi.hoisted(() => ({
  addBehaviourEvent: vi.fn(),
  signOut: vi.fn(),
  sendPasswordReset: vi.fn(),
  getAuthProviderInfo: vi.fn(() => ({ isEmailPassword: true, primaryProviderLabel: 'Email' })),
  mapAuthErrorMessage: vi.fn((err: any) => err?.message || 'Error'),
}));
vi.mock('../lib/api', () => api);

vi.mock('../lib/pushNotifications', () => ({
  loadPushState: vi.fn(async () => null),
  registerCurrentDevice: vi.fn(async () => ({ support: 'supported', status: 'enabled', error: null, lastRegisteredAt: null })),
  unregisterCurrentDevice: vi.fn(async () => {}),
}));

vi.mock('../lib/useNotifications', () => ({
  useNotifications: () => ({
    connectionState: 'connected',
    retry: vi.fn(),
    notifications: [],
    loading: false,
    error: null,
    markAllRead: vi.fn(),
    markRead: vi.fn(),
    unreadCount: 0,
  }),
}));

vi.mock('../components/profile/ProfileEditorModal', () => ({
  ProfileEditorModal: () => null,
}));

vi.mock('../components/reversals/HistoryActionControl', () => ({
  HistoryActionControl: () => null,
}));

import { BehaviourFormModal } from '../components/forms/BehaviourFormModal';
import { FundsDashboard } from '../pages/FundsDashboard';
import { FundCard } from '../components/funds/FundCard';
import { PetLeaderboard } from '../components/funds/PetLeaderboard';
import { MemberProfile } from '../pages/MemberProfile';
import { Notifications } from '../pages/Notifications';
import { Settings } from '../pages/Settings';
import { ErrorState } from '../components/wallet/WalletStates';

const NAMESPACES = ['common', 'behaviour', 'funds', 'profile', 'notifications', 'settings', 'wallet'];

const withRouter = (ui: React.ReactNode) => <MemoryRouter>{ui}</MemoryRouter>;

const setLanguage = async (lang: 'en' | 'tr') => {
  await act(async () => {
    await i18n.changeLanguage(lang);
  });
  await i18n.loadNamespaces(NAMESPACES);
};

beforeEach(async () => {
  vi.clearAllMocks();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  store.currentUser = {
    id: 'u1',
    uid: 'u1',
    familyId: 'f1',
    role: 'parent',
    displayName: 'Sam',
    email: 'sam@example.com',
    rewardPoints: 0,
  };
  store.authUser = { email: 'sam@example.com' };
  store.familyData = { id: 'f1', name: 'The Smiths', currency: '£', inviteCode: 'ABC123' };
  store.familyMembers = [];
  store.profileUpdateRequests = [];
  store.behaviourEvents = [];
  store.funds = [];
  store.fundTransactions = [];
  store.petboxRequests = [];
  store.myWallet = { balance: 0 };
  store.loading = false;
  await i18n.loadNamespaces(NAMESPACES);
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------
describe('Phase 2D i18n — Behaviour (English)', () => {
  it('renders the behaviour form dialog in English', () => {
    render(
      <BehaviourFormModal
        isOpen
        onClose={() => {}}
        childrenList={[{ id: 'c1', displayName: 'Kid' }]}
      />,
    );
    expect(screen.getByText('Log Behaviour')).toBeInTheDocument();
    expect(screen.getByText('Positive')).toBeInTheDocument();
    expect(screen.getByText('Negative')).toBeInTheDocument();
    expect(screen.getByText('Penalty')).toBeInTheDocument();
    expect(screen.getByText('Child')).toBeInTheDocument();
    expect(screen.getByText('Reason')).toBeInTheDocument();
    expect(screen.getByText('Points')).toBeInTheDocument();
    expect(screen.getByText('Log Event')).toBeInTheDocument();
  });
});

describe('Phase 2D i18n — Behaviour (Turkish)', () => {
  it('renders the behaviour form dialog in Turkish', async () => {
    await setLanguage('tr');
    render(
      <BehaviourFormModal
        isOpen
        onClose={() => {}}
        childrenList={[{ id: 'c1', displayName: 'Kid' }]}
      />,
    );
    expect(screen.getByText('Davranış Ekle')).toBeInTheDocument();
    expect(screen.getByText('Olumlu')).toBeInTheDocument();
    expect(screen.getByText('Olumsuz')).toBeInTheDocument();
    expect(screen.getByText('Ceza')).toBeInTheDocument();
    expect(screen.getByText('Çocuk')).toBeInTheDocument();
    expect(screen.getByText('Sebep')).toBeInTheDocument();
    expect(screen.getByText('Puan')).toBeInTheDocument();
    expect(screen.getByText('Olayı Kaydet')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Funds — empty states
// ---------------------------------------------------------------------------
describe('Phase 2D i18n — Funds dashboard empty state (English)', () => {
  it('renders the funds dashboard headings and empty state in English', () => {
    render(withRouter(<FundsDashboard />));
    expect(screen.getByText('Pet Box')).toBeInTheDocument();
    expect(screen.getByText('Active Funds')).toBeInTheDocument();
    expect(screen.getByText('Top Helpers')).toBeInTheDocument();
    expect(screen.getByText('No pets added yet.')).toBeInTheDocument();
    expect(screen.getByText('Add Pet')).toBeInTheDocument();
  });
});

describe('Phase 2D i18n — Funds dashboard empty state (Turkish)', () => {
  it('renders the funds dashboard headings and empty state in Turkish', async () => {
    await setLanguage('tr');
    render(withRouter(<FundsDashboard />));
    expect(screen.getByText('Evcil Kutusu')).toBeInTheDocument();
    expect(screen.getByText('Aktif Fonlar')).toBeInTheDocument();
    expect(screen.getByText('En İyi Yardımcılar')).toBeInTheDocument();
    expect(screen.getByText('Henüz evcil eklenmedi.')).toBeInTheDocument();
    expect(screen.getByText('Evcil Ekle')).toBeInTheDocument();
  });
});

describe('Phase 2D i18n — FundCard empty states (English)', () => {
  it('renders balance, donation and expense empty states in English', () => {
    render(
      <FundCard
        fund={{ id: 'p1', name: 'Rex', species: 'dog', balance: 0, monthlyBudget: 0, emergencyGoal: 0 }}
        fundTransactions={[]}
        petboxRequests={[]}
        isParent
        currencySymbol="£"
      />,
    );
    expect(screen.getByText('Balance')).toBeInTheDocument();
    expect(screen.getByText('Donations')).toBeInTheDocument();
    expect(screen.getByText('No donations yet.')).toBeInTheDocument();
    expect(screen.getByText('Recent Expenses')).toBeInTheDocument();
    expect(screen.getByText('No expenses recorded yet.')).toBeInTheDocument();
    expect(screen.getByText('Add Expense')).toBeInTheDocument();
  });
});

describe('Phase 2D i18n — FundCard empty states (Turkish)', () => {
  it('renders balance, donation and expense empty states in Turkish', async () => {
    await setLanguage('tr');
    render(
      <FundCard
        fund={{ id: 'p1', name: 'Rex', species: 'dog', balance: 0, monthlyBudget: 0, emergencyGoal: 0 }}
        fundTransactions={[]}
        petboxRequests={[]}
        isParent
        currencySymbol="£"
      />,
    );
    expect(screen.getByText('Bakiye')).toBeInTheDocument();
    expect(screen.getByText('Bağışlar')).toBeInTheDocument();
    expect(screen.getByText('Henüz bağış yok.')).toBeInTheDocument();
    expect(screen.getByText('Son Giderler')).toBeInTheDocument();
    expect(screen.getByText('Henüz gider kaydedilmedi.')).toBeInTheDocument();
    expect(screen.getByText('Gider Ekle')).toBeInTheDocument();
  });
});

describe('Phase 2D i18n — PetLeaderboard empty state (English/Turkish)', () => {
  it('renders the no-contributions empty state in English', () => {
    render(
      <PetLeaderboard
        fundTransactions={[]}
        familyMembers={[{ id: 'c1', role: 'child', displayName: 'Kid' }]}
        reversals={[]}
        currencySymbol="£"
      />,
    );
    expect(
      screen.getByText('No contributions yet. Start helping out to appear on the leaderboard!'),
    ).toBeInTheDocument();
  });

  it('renders the no-contributions empty state in Turkish', async () => {
    await setLanguage('tr');
    render(
      <PetLeaderboard
        fundTransactions={[]}
        familyMembers={[{ id: 'c1', role: 'child', displayName: 'Kid' }]}
        reversals={[]}
        currencySymbol="£"
      />,
    );
    expect(
      screen.getByText('Henüz katkı yok. Liderlik tablosunda görünmek için yardım etmeye başlayın!'),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
describe('Phase 2D i18n — Member profile (English)', () => {
  it('renders the member profile headings in English', () => {
    store.familyMembers = [{ id: 'c1', displayName: 'Kid', rewardPoints: 0, lifetimeXP: 0, currentStreak: 0, longestStreak: 0, avatarUrl: '' }];
    render(
      <MemoryRouter initialEntries={['/family/member/c1']}>
        <Routes>
          <Route path="/family/member/:id" element={<MemberProfile />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('0 Reward Points')).toBeInTheDocument();
    expect(screen.getByText('Level 1')).toBeInTheDocument();
    expect(screen.getByText('0 Total XP')).toBeInTheDocument();
    expect(screen.getByText('Day Streak')).toBeInTheDocument();
    expect(screen.getByText('Best Streak')).toBeInTheDocument();
    expect(screen.getByText('Behaviour History')).toBeInTheDocument();
    expect(screen.getByText('No logged events.')).toBeInTheDocument();
    expect(screen.getByText('Achievement Gallery')).toBeInTheDocument();
  });
});

describe('Phase 2D i18n — Member profile (Turkish)', () => {
  it('renders the member profile headings in Turkish', async () => {
    await setLanguage('tr');
    store.familyMembers = [{ id: 'c1', displayName: 'Kid', rewardPoints: 0, lifetimeXP: 0, currentStreak: 0, longestStreak: 0, avatarUrl: '' }];
    render(
      <MemoryRouter initialEntries={['/family/member/c1']}>
        <Routes>
          <Route path="/family/member/:id" element={<MemberProfile />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Profil')).toBeInTheDocument();
    expect(screen.getByText('0 Ödül Puanı')).toBeInTheDocument();
    expect(screen.getByText('Seviye 1')).toBeInTheDocument();
    expect(screen.getByText('0 Toplam XP')).toBeInTheDocument();
    expect(screen.getByText('Gün Serisi')).toBeInTheDocument();
    expect(screen.getByText('En İyi Seri')).toBeInTheDocument();
    expect(screen.getByText('Davranış Geçmişi')).toBeInTheDocument();
    expect(screen.getByText('Kayıtlı olay yok.')).toBeInTheDocument();
    expect(screen.getByText('Başarı Galerisi')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
describe('Phase 2D i18n — Notifications page (English)', () => {
  it('renders the notifications page in English', () => {
    render(withRouter(<Notifications />));
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Unread')).toBeInTheDocument();
    expect(screen.getByText('Mentions')).toBeInTheDocument();
    expect(screen.getByText('No notifications yet.')).toBeInTheDocument();
  });
});

describe('Phase 2D i18n — Notifications page (Turkish)', () => {
  it('renders the notifications page in Turkish', async () => {
    await setLanguage('tr');
    render(withRouter(<Notifications />));
    expect(screen.getByText('Bildirimler')).toBeInTheDocument();
    expect(screen.getByText('Tümü')).toBeInTheDocument();
    expect(screen.getByText('Okunmamış')).toBeInTheDocument();
    expect(screen.getByText('Bahsedilenler')).toBeInTheDocument();
    expect(screen.getByText('Henüz bildirim yok.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Settings + Language selector
// ---------------------------------------------------------------------------
describe('Phase 2D i18n — Settings (English)', () => {
  it('renders the settings sections and language selector in English', () => {
    render(withRouter(<Settings />));
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('Family')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Security')).toBeInTheDocument();
    expect(screen.getByText('About')).toBeInTheDocument();
    expect(screen.getByText('Sign Out')).toBeInTheDocument();
    expect(screen.getByText('Language')).toBeInTheDocument();
    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText('Turkish')).toBeInTheDocument();
  });
});

describe('Phase 2D i18n — Settings (Turkish)', () => {
  it('renders the settings sections and language selector in Turkish', async () => {
    await setLanguage('tr');
    render(withRouter(<Settings />));
    expect(screen.getByText('Ayarlar')).toBeInTheDocument();
    expect(screen.getByText('Profil')).toBeInTheDocument();
    expect(screen.getByText('Aile')).toBeInTheDocument();
    expect(screen.getByText('Bildirimler')).toBeInTheDocument();
    expect(screen.getByText('Güvenlik')).toBeInTheDocument();
    expect(screen.getByText('Hakkında')).toBeInTheDocument();
    expect(screen.getByText('Çıkış Yap')).toBeInTheDocument();
    expect(screen.getByText('Dil')).toBeInTheDocument();
    expect(screen.getByText('İngilizce')).toBeInTheDocument();
    expect(screen.getByText('Türkçe')).toBeInTheDocument();
  });
});

describe('Phase 2D i18n — Language selector switching', () => {
  it('updates the language and shows the saved confirmation', async () => {
    render(withRouter(<Settings />));
    const turkishRadio = screen.getByDisplayValue('tr') as HTMLInputElement;
    expect(turkishRadio).not.toBeChecked();
    await act(async () => {
      fireEvent.click(turkishRadio);
    });
    expect(turkishRadio).toBeChecked();
    expect(screen.getByText('Language updated.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Generic error state
// ---------------------------------------------------------------------------
describe('Phase 2D i18n — Generic error state (English/Turkish)', () => {
  it('renders the error message and retry button in English', () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Something went wrong." onRetry={onRetry} />);
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
  });

  it('renders the retry button in Turkish', async () => {
    await setLanguage('tr');
    const onRetry = vi.fn();
    render(<ErrorState message="Bir şeyler ters gitti." onRetry={onRetry} />);
    expect(screen.getByText('Bir şeyler ters gitti.')).toBeInTheDocument();
    expect(screen.getByText('Tekrar dene')).toBeInTheDocument();
  });
});
