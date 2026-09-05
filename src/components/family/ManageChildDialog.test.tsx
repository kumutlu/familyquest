import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/config';

const mockDeleteChild = vi.fn();
const mockUpdateDoc = vi.fn();

vi.mock('../../lib/childLoginApi', () => ({
  deleteChild: (...args: unknown[]) => mockDeleteChild(...args),
  mapChildLoginError: (err: any) => err?.message || 'Delete failed',
  disableChildLogin: vi.fn(),
  enableChildLogin: vi.fn(),
  resetChildPassword: vi.fn(),
  validatePasswordClient: () => null,
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, coll, id) => ({ path: `${coll}/${id}` })),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
}));

vi.mock('../../lib/firebase', () => ({
  db: {},
}));

vi.mock('../ConnectChildDeviceQrModal', () => ({
  ConnectChildDeviceQrModal: ({ isOpen, intent, targetChildId, targetChildName, onClose }: any) =>
    isOpen ? (
      <div
        data-testid="scoped-qr-modal"
        data-intent={intent}
        data-target-child-id={targetChildId}
        data-target-child-name={targetChildName}
      >
        <button onClick={onClose}>Close QR Modal</button>
      </div>
    ) : null,
}));

vi.mock('../profile/AvatarPicker', () => ({
  AvatarPicker: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect('cat-1')}>
      Pick Cat
    </button>
  ),
}));

import { ManageChildDialog } from './ManageChildDialog';

const testChild = {
  id: 'child-123',
  displayName: 'Leo',
  avatarId: 'cat-1',
  role: 'child',
  isManaged: true,
  hasLogin: true,
  username: 'leo.smith',
  walletBalance: 2500,
};

describe('ManageChildDialog canonical surface', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.loadNamespaces(['family', 'common']);
    await i18n.changeLanguage('en');
  });

  it('renders all canonical management sections: Profile, Devices, Wallet, Settings, and Danger Zone', () => {
    render(<ManageChildDialog member={testChild} onClose={vi.fn()} />);

    // Section 1: Profile
    expect(screen.getByRole('textbox', { name: /name/i })).toHaveValue('Leo');
    expect(screen.getByText('Pick Cat')).toBeInTheDocument();

    // Section 2: Devices & Access
    expect(screen.getByTestId('connect-child-device-button')).toBeInTheDocument();

    // Section 3: Money & Wallet
    expect(screen.getByText('Money & Wallet')).toBeInTheDocument();
    expect(screen.getByText('Current Balance')).toBeInTheDocument();

    // Section 4: Child Settings / Login
    expect(screen.getByText('leo.smith')).toBeInTheDocument();

    // Section 5: Danger Zone
    expect(screen.getByTestId('remove-child-button')).toBeInTheDocument();
  });

  it('clicking "Connect personal device" opens QR modal with intent existing_child_device_bind and pinned targetChildId', async () => {
    const user = userEvent.setup();
    render(<ManageChildDialog member={testChild} onClose={vi.fn()} />);

    expect(screen.queryByTestId('scoped-qr-modal')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('connect-child-device-button'));

    const qrModal = screen.getByTestId('scoped-qr-modal');
    expect(qrModal).toBeInTheDocument();
    expect(qrModal).toHaveAttribute('data-intent', 'existing_child_device_bind');
    expect(qrModal).toHaveAttribute('data-target-child-id', 'child-123');
    expect(qrModal).toHaveAttribute('data-target-child-name', 'Leo');
  });

  it('saving profile updates user document with new name and avatar', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ManageChildDialog member={testChild} onClose={onClose} />);

    const input = screen.getByRole('textbox', { name: /name/i });
    await user.clear(input);
    await user.type(input, 'Leonardo');

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { path: 'users/child-123' },
      expect.objectContaining({ displayName: 'Leonardo' }),
    );
  });

  it('danger zone remove child confirms and invokes deleteChild API', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onChildDeleted = vi.fn();
    mockDeleteChild.mockResolvedValue({ success: true });

    render(
      <ManageChildDialog
        member={testChild}
        onClose={onClose}
        onChildDeleted={onChildDeleted}
      />,
    );

    await user.click(screen.getByTestId('remove-child-button'));

    // Confirmation dialog appears asking for confirmation
    const confirmInput = screen.getByPlaceholderText('Leo');
    await user.type(confirmInput, 'Leo');
    await user.click(screen.getByTestId('confirm-delete-child-button'));

    await waitFor(() => {
      expect(mockDeleteChild).toHaveBeenCalledWith('child-123', 'Leo');
    });
    expect(onChildDeleted).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
