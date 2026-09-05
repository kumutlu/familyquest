import { useState, useEffect, useCallback, useRef } from 'react';
import { generateChildQrToken, mapChildQrErrorKey } from '../lib/childQrOnboardingApi';
import { QRCodeSVG } from 'qrcode.react';
import { X, RefreshCw, Copy, Check, QrCode, Smartphone, ShieldCheck, Clock } from 'lucide-react';

interface ConnectChildDeviceQrModalProps {
  isOpen: boolean;
  onClose: () => void;
  intent?: 'new_child_join' | 'existing_child_device_bind';
  targetChildId?: string;
  targetChildName?: string;
}

export function ConnectChildDeviceQrModal({
  isOpen,
  onClose,
  intent,
  targetChildId,
  targetChildName,
}: ConnectChildDeviceQrModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(900);
  const [copied, setCopied] = useState(false);
  const fetchedRef = useRef(false);

  const fetchToken = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await generateChildQrToken(intent ? { intent, targetChildId } : undefined);
      setRawToken(res.rawToken);
      setExpiresAtMs(res.expiresAtMs);
    } catch (err: any) {
      const key = mapChildQrErrorKey(err);
      if (key === 'auth:childQr.errors.generic' || err?.message === 'internal' || err?.code === 'functions/internal') {
        setError("We couldn't create the QR code. Please try again.");
      } else {
        setError(err?.message || "We couldn't create the QR code. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [intent, targetChildId]);

  useEffect(() => {
    if (isOpen) {
      if (!fetchedRef.current) {
        fetchedRef.current = true;
        fetchToken();
      }
    } else {
      fetchedRef.current = false;
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

  const isNewChild = intent === 'new_child_join';
  const title = isNewChild
    ? 'Add Child via QR Code'
    : targetChildName
    ? `Connect Device for ${targetChildName}`
    : 'Connect Child Device';

  const description = isNewChild
    ? "Scan this QR code from your child's device to join your family."
    : targetChildName
    ? `Scan this QR code from ${targetChildName}'s device to connect.`
    : "Scan this QR code from your child's device to initiate device join.";

  const step3 = isNewChild
    ? 'Approve to add your child to the family'
    : targetChildName
    ? `Approve to connect device for ${targetChildName}`
    : 'Select existing child profile & approve';

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
              {title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
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
                {description}
              </p>

              {/* QR Container with Standards-Compliant ISO/IEC 18004 QRCodeSVG */}
              <div
                data-testid="qr-code-container"
                className="p-4 rounded-2xl bg-white border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-center"
              >
                <QRCodeSVG
                  value={joinLink}
                  size={200}
                  level="M"
                  marginSize={2}
                  aria-label="Child device onboarding QR code"
                />
              </div>

              {/* Hidden payload input for link test inspection */}
              <input
                type="hidden"
                data-testid="qr-copy-link-input"
                value={joinLink}
                readOnly
              />
              <span data-testid="qr-raw-token" className="hidden">
                {rawToken}
              </span>

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
                  <li>{step3}</li>
                </ol>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
