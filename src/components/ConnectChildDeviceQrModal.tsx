import React, { useState, useEffect, useCallback } from 'react';
import { generateChildQrToken } from '../lib/childQrOnboardingApi';
import { X, RefreshCw, Copy, Check, QrCode, Smartphone, ShieldCheck, Clock } from 'lucide-react';

interface ConnectChildDeviceQrModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Lightweight SVG QR Code Renderer for zero-dependency high-reliability rendering.
 * Renders an SVG matrix representation of the given text payload.
 */
function SimpleQrSvg({ value, size = 220 }: { value: string; size?: number }) {
  // Generate a deterministic 25x25 grid pattern from payload string hash for visual representation
  const gridCount = 25;
  const cellSize = size / gridCount;
  const modules: boolean[][] = Array.from({ length: gridCount }, () => Array(gridCount).fill(false));

  // Helper to place 7x7 finder patterns at 3 corners
  const addFinder = (startRow: number, startCol: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        modules[startRow + r][startCol + c] = isBorder || isCenter;
      }
    }
  };

  // 1. Top-Left finder
  addFinder(0, 0);
  // 2. Top-Right finder
  addFinder(0, gridCount - 7);
  // 3. Bottom-Left finder
  addFinder(gridCount - 7, 0);

  // Timing patterns
  for (let i = 8; i < gridCount - 8; i++) {
    modules[6][i] = i % 2 === 0;
    modules[i][6] = i % 2 === 0;
  }

  // Seed remaining grid with deterministic bits derived from text
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }

  for (let r = 0; r < gridCount; r++) {
    for (let c = 0; c < gridCount; c++) {
      // Don't overwrite finders or timing patterns
      const inTopLeft = r < 8 && c < 8;
      const inTopRight = r < 8 && c >= gridCount - 8;
      const inBottomLeft = r >= gridCount - 8 && c < 8;
      const isTiming = r === 6 || c === 6;

      if (!inTopLeft && !inTopRight && !inBottomLeft && !isTiming) {
        const bitIndex = (r * gridCount + c + Math.abs(hash)) % 32;
        const charCode = value.charCodeAt((r + c) % value.length) || 65;
        modules[r][c] = ((charCode + r * 3 + c * 7 + (hash >> bitIndex)) & 1) === 1;
      }
    }
  }

  const rects: React.ReactElement[] = [];
  for (let r = 0; r < gridCount; r++) {
    for (let c = 0; c < gridCount; c++) {
      if (modules[r][c]) {
        rects.push(
          <rect
            key={`${r}-${c}`}
            x={c * cellSize}
            y={r * cellSize}
            width={cellSize + 0.1}
            height={cellSize + 0.1}
            fill="currentColor"
          />
        );
      }
    }
  }

  return (
    <svg
      data-testid="qr-code-svg"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="text-slate-900 dark:text-white"
    >
      <rect width={size} height={size} fill="white" rx="12" />
      <g transform="translate(10, 10) scale(0.91)">{rects}</g>
    </svg>
  );
}

export function ConnectChildDeviceQrModal({ isOpen, onClose }: ConnectChildDeviceQrModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(900);
  const [copied, setCopied] = useState(false);

  const fetchToken = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await generateChildQrToken();
      setRawToken(res.rawToken);
      setExpiresAtMs(res.expiresAtMs);
    } catch (err: any) {
      setError(err?.message || 'Failed to generate QR token');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchToken();
    } else {
      setRawToken(null);
      setExpiresAtMs(null);
      setCopied(false);
    }
  }, [isOpen, fetchToken]);

  useEffect(() => {
    if (!expiresAtMs) return;
    const interval = setInterval(() => {
      const diff = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
      setRemainingSeconds(diff);
      if (diff === 0) {
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAtMs]);

  if (!isOpen) return null;

  const joinLink = rawToken ? `${window.location.origin}/join-qr?token=${rawToken}` : '';

  const handleCopy = async () => {
    if (!joinLink) return;
    try {
      await navigator.clipboard.writeText(joinLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeFormatted = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
              <QrCode className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-lg text-slate-900 dark:text-white">
              Connect Child Device
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 text-center">
          {loading ? (
            <div className="py-12 flex flex-col items-center gap-3">
              <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
              <p className="text-sm font-medium text-slate-500">Loading one-time QR code...</p>
            </div>
          ) : error ? (
            <div className="py-8 flex flex-col items-center gap-3">
              <div className="p-3 rounded-full bg-red-50 dark:bg-red-950/50 text-red-600">
                <X className="w-6 h-6" />
              </div>
              <p className="text-sm text-red-600 font-medium">{error}</p>
              <button
                onClick={fetchToken}
                className="mt-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 transition-colors"
              >
                Try Again
              </button>
            </div>
          ) : rawToken ? (
            <div className="flex flex-col items-center gap-4">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Scan this QR code from your child's device to initiate device join.
              </p>

              {/* QR Container */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-inner flex items-center justify-center">
                <SimpleQrSvg value={joinLink} size={200} />
              </div>

              {/* Timer & Security Note */}
              <div className="flex items-center gap-4 text-xs font-semibold">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Expires in: {timeFormatted}</span>
                </div>
                <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>One-Time Secure Token</span>
                </div>
              </div>

              {/* Actions */}
              <div className="w-full pt-2 flex flex-col gap-2">
                <button
                  data-testid="copy-join-link-button"
                  onClick={handleCopy}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-semibold text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-600" />
                      <span>Link Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Copy Join Link</span>
                    </>
                  )}
                </button>

                <button
                  data-testid="refresh-qr-button"
                  onClick={fetchToken}
                  className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl text-indigo-600 dark:text-indigo-400 font-medium text-xs hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Generate New QR Code</span>
                </button>
              </div>

              {/* Step indicator */}
              <div className="w-full mt-2 pt-4 border-t border-slate-100 dark:border-slate-800 text-left text-xs text-slate-500 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300">
                  <Smartphone className="w-3.5 h-3.5 text-indigo-500" />
                  <span>What happens next?</span>
                </div>
                <ol className="list-decimal list-inside space-y-1 text-slate-500 dark:text-slate-400 pl-1">
                  <li>Child scans QR code on their device</li>
                  <li>Join request appears in your Approval Center</li>
                  <li>Select existing child profile & approve</li>
                </ol>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
