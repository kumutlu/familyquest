import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockGenerateToken = vi.fn();
vi.mock('../lib/childQrOnboardingApi', () => ({
  generateChildQrToken: () => mockGenerateToken(),
  mapChildQrErrorKey: (err: unknown) => {
    const raw = err as { code?: string; message?: string } | undefined;
    const msg = raw?.message || '';
    if (msg === 'internal' || raw?.code === 'functions/internal' || raw?.code === 'functions/not-found') {
      return 'auth:childQr.errors.generic';
    }
    return 'auth:childQr.errors.generic';
  },
}));

import { ConnectChildDeviceQrModal } from './ConnectChildDeviceQrModal';

describe('Task 7: Parent Connect Child Device Modal UI & Standard QR Renderer', () => {
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
      expect(screen.getByTestId('qr-code-container')).toBeInTheDocument();
    });

    expect(screen.getByTestId('copy-join-link-button')).toBeInTheDocument();
    expect(mockGenerateToken).toHaveBeenCalledTimes(1);
  });

  it('renders standards-compliant QRCodeSVG with canonical join URL payload and no pseudo matrix', async () => {
    mockGenerateToken.mockResolvedValue({
      rawToken: 'token-std-qr-987654321',
      expiresAtMs: Date.now() + 15 * 60 * 1000,
    });

    render(<ConnectChildDeviceQrModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('qr-code-container')).toBeInTheDocument();
    });

    const qrContainer = screen.getByTestId('qr-code-container');
    const svgElement = qrContainer.querySelector('svg');
    expect(svgElement).not.toBeNull();

    // Verify pseudo-matrix class / data attributes are absent
    expect(qrContainer.querySelector('[data-testid="pseudo-qr-grid"]')).toBeNull();

    // Verify canonical join URL is passed as encoded value to qrcode.react
    const expectedUrl = `${window.location.origin}/join-qr?token=token-std-qr-987654321`;
    const copyLinkInput = screen.getByTestId('qr-copy-link-input') as HTMLInputElement;
    expect(copyLinkInput.value).toBe(expectedUrl);
  });

  it('resolves production origin https://queki.app when rendered in production environment', async () => {
    mockGenerateToken.mockResolvedValue({
      rawToken: 'prod-token-abc-123',
      expiresAtMs: Date.now() + 15 * 60 * 1000,
    });

    const originalLocation = window.location;
    delete (window as any).location;
    (window as any).location = { origin: 'https://queki.app' };

    try {
      render(<ConnectChildDeviceQrModal isOpen={true} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByTestId('qr-code-container')).toBeInTheDocument();
      });

      const copyLinkInput = screen.getByTestId('qr-copy-link-input') as HTMLInputElement;
      expect(copyLinkInput.value).toBe('https://queki.app/join-qr?token=prod-token-abc-123');
    } finally {
      (window as any).location = originalLocation;
    }
  });

  it('displays user-friendly error message instead of raw "internal" string on backend failure', async () => {
    mockGenerateToken.mockRejectedValue({
      code: 'functions/internal',
      message: 'internal',
    });

    render(<ConnectChildDeviceQrModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

    // Must NOT show raw internal string to user
    expect(screen.queryByText(/^internal$/i)).toBeNull();

    // MUST show user-friendly error message
    expect(screen.getByText("We couldn't create the QR code. Please try again.")).toBeInTheDocument();
  });


  it('allows refreshing the QR code', async () => {
    mockGenerateToken.mockResolvedValue({
      rawToken: 'test-raw-qr-token-first',
      expiresAtMs: Date.now() + 15 * 60 * 1000,
    });

    render(<ConnectChildDeviceQrModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('qr-code-container')).toBeInTheDocument();
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
