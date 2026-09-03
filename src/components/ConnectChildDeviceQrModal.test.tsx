import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockGenerateToken = vi.fn();
vi.mock('../lib/childQrOnboardingApi', () => ({
  generateChildQrToken: () => mockGenerateToken(),
}));

import { ConnectChildDeviceQrModal } from './ConnectChildDeviceQrModal';

describe('Task 7: Parent Connect Child Device Modal UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Test 45: parent modal renders QR code and copyable join link', async () => {
    mockGenerateToken.mockResolvedValue({
      rawToken: 'test-raw-qr-token-123456789012345678901234567890123456',
      expiresAtMs: Date.now() + 15 * 60 * 1000,
    });

    render(<ConnectChildDeviceQrModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('qr-code-svg')).toBeInTheDocument();
    });

    expect(screen.getByTestId('copy-join-link-button')).toBeInTheDocument();
    expect(mockGenerateToken).toHaveBeenCalledTimes(1);
  });

  it('allows refreshing the QR code', async () => {
    mockGenerateToken.mockResolvedValue({
      rawToken: 'test-raw-qr-token-first',
      expiresAtMs: Date.now() + 15 * 60 * 1000,
    });

    render(<ConnectChildDeviceQrModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('qr-code-svg')).toBeInTheDocument();
    });

    mockGenerateToken.mockResolvedValue({
      rawToken: 'test-raw-qr-token-second',
      expiresAtMs: Date.now() + 15 * 60 * 1000,
    });

    const refreshBtn = screen.getByTestId('refresh-qr-button');
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(mockGenerateToken).toHaveBeenCalledTimes(2);
    });
  });
});
