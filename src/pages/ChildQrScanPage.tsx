import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../lib/firebase';
import {
  scanChildQrToken,
  submitChildQrJoinRequest,
  getChildQrJoinStatus,
  exchangeApprovedChildQrRequest,
  storeQrJoinRequestHandle,
  readQrJoinRequestHandle,
  clearQrJoinRequestHandle,
  type ChildQrRequestHandle,
} from '../lib/childQrOnboardingApi';
import { QrCode, Smartphone, Clock, RefreshCw, CheckCircle2, XCircle, ArrowRight, ShieldCheck } from 'lucide-react';

type Step = 'scan' | 'submitting' | 'waiting' | 'approved' | 'rejected' | 'expired' | 'error';

export function ChildQrScanPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('scan');
  const [tokenInput, setTokenInput] = useState('');
  const [_handle, setHandle] = useState<ChildQrRequestHandle | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);


  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const handleApprovedExchange = useCallback(async (h: ChildQrRequestHandle) => {
    stopPolling();
    setStep('approved');
    try {
      const exchangeRes = await exchangeApprovedChildQrRequest(h);
      await signInWithCustomToken(auth, exchangeRes.customToken);
      clearQrJoinRequestHandle();
      setTimeout(() => {
        navigate('/');
      }, 1000);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to complete device binding.');
      setStep('error');
    }
  }, [stopPolling, navigate]);

  const startPolling = useCallback((h: ChildQrRequestHandle) => {
    stopPolling();
    setHandle(h);
    setStep('waiting');

    const checkStatus = async () => {
      try {
        const res = await getChildQrJoinStatus(h);
        if (res.status === 'approved') {
          handleApprovedExchange(h);
        } else if (res.status === 'rejected') {
          stopPolling();
          clearQrJoinRequestHandle();
          setStep('rejected');
        } else if (res.status === 'expired') {
          stopPolling();
          clearQrJoinRequestHandle();
          setStep('expired');
        }
      } catch (err: any) {
        /* Silently ignore intermittent polling network glitches, keep retrying */
      }
    };

    void checkStatus();
    pollingRef.current = setInterval(checkStatus, 2500);
  }, [stopPolling, handleApprovedExchange]);

  const processToken = useCallback(async (token: string) => {
    setErrorMessage(null);
    setStep('submitting');
    try {
      await scanChildQrToken(token);
      const subRes = await submitChildQrJoinRequest(token);
      const newHandle: ChildQrRequestHandle = {
        requestId: subRes.requestId,
        requestSecret: subRes.requestSecret,
      };
      storeQrJoinRequestHandle(newHandle);
      startPolling(newHandle);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Invalid or expired QR code');
      setStep('error');
    }
  }, [startPolling]);

  // Initial check for URL token or saved local handle
  useEffect(() => {
    const urlToken = searchParams.get('token');
    if (urlToken) {
      processToken(urlToken);
      return;
    }

    const savedHandle = readQrJoinRequestHandle();
    if (savedHandle) {
      startPolling(savedHandle);
    }

    return () => stopPolling();
  }, [searchParams, processToken, startPolling, stopPolling]);

  const handleSubmitInput = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    processToken(tokenInput.trim());
  };

  const handleReset = () => {
    stopPolling();
    clearQrJoinRequestHandle();
    setHandle(null);
    setTokenInput('');
    setErrorMessage(null);
    setStep('scan');
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-800/80 backdrop-blur-xl border border-slate-700/60 rounded-3xl p-6 sm:p-8 shadow-2xl">
        {/* Brand Header */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30">
            <Smartphone className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-white">Queki</h1>
            <p className="text-xs text-indigo-400 font-semibold uppercase tracking-wider">
              Child Device Join
            </p>
          </div>
        </div>

        {/* Step 1: Scan / Enter Token */}
        {step === 'scan' && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-lg font-bold text-slate-100">Scan QR Code</h2>
              <p className="text-xs text-slate-400">
                Ask your parent to open <span className="text-indigo-400 font-medium">Connect Child Device</span> on their phone, then scan or paste the code below.
              </p>
            </div>

            <form onSubmit={handleSubmitInput} className="space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-300">
                  QR Token or Join Code
                </label>
                <div className="relative">
                  <input
                    data-testid="qr-token-input"
                    type="text"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="Paste QR token here..."
                    className="w-full py-3 px-4 rounded-xl bg-slate-900/80 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                  />
                  <QrCode className="absolute right-3.5 top-3.5 w-4 h-4 text-slate-500" />
                </div>
              </div>

              <button
                data-testid="submit-qr-token-button"
                type="submit"
                disabled={!tokenInput.trim()}
                className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/25"
              >
                <span>Send Join Request</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}

        {/* Step 2: Submitting */}
        {step === 'submitting' && (
          <div className="py-8 text-center space-y-4">
            <RefreshCw className="w-10 h-10 text-indigo-400 animate-spin mx-auto" />
            <div>
              <h2 className="text-lg font-bold text-white">Submitting Request...</h2>
              <p className="text-xs text-slate-400 mt-1">Connecting to your family server</p>
            </div>
          </div>
        )}

        {/* Step 3: Waiting for Parent Approval */}
        {step === 'waiting' && (
          <div className="py-6 text-center space-y-6">
            <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-indigo-500/20 animate-ping" />
              <div className="relative w-16 h-16 rounded-full bg-indigo-600/30 border border-indigo-400/50 flex items-center justify-center text-indigo-400">
                <Clock className="w-8 h-8 animate-spin" style={{ animationDuration: '6s' }} />
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="text-lg font-bold text-white">Waiting for Parent Approval</h2>
              <p className="text-xs text-slate-300 max-w-xs mx-auto">
                Your join request has been sent! Ask your parent to select your profile in their <span className="text-indigo-400 font-semibold">Approval Center</span>.
              </p>
            </div>

            <div className="p-3 rounded-2xl bg-slate-900/60 border border-slate-700/50 text-xs text-slate-400 flex items-center justify-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Request active. Polling status automatically...</span>
            </div>
          </div>
        )}

        {/* Step 4: Approved */}
        {step === 'approved' && (
          <div className="py-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Request Approved!</h2>
              <p className="text-xs text-slate-300 mt-1">Signing you into your family account...</p>
            </div>
          </div>
        )}

        {/* Step 5: Rejected */}
        {step === 'rejected' && (
          <div className="py-6 text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mx-auto">
              <XCircle className="w-10 h-10" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-white">Request Declined</h2>
              <p className="text-xs text-slate-300">
                Your parent rejected this join request.
              </p>
            </div>
            <button
              onClick={handleReset}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-medium text-xs transition-colors"
            >
              Scan New QR Code
            </button>
          </div>
        )}

        {/* Step 6: Expired */}
        {step === 'expired' && (
          <div className="py-6 text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
              <Clock className="w-10 h-10" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-white">QR Code Expired</h2>
              <p className="text-xs text-slate-300">
                This QR code or join request has expired. Please request a new QR code from your parent.
              </p>
            </div>
            <button
              onClick={handleReset}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-medium text-xs transition-colors"
            >
              Scan New QR Code
            </button>
          </div>
        )}

        {/* Error */}
        {step === 'error' && (
          <div className="py-6 text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mx-auto">
              <XCircle className="w-10 h-10" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-white">Unable to Join</h2>
              <p className="text-xs text-red-400 font-medium">
                {errorMessage || 'An error occurred during QR onboarding.'}
              </p>
            </div>
            <button
              onClick={handleReset}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-medium text-xs transition-colors"
            >
              Try Scanning Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
