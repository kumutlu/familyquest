import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { RequestDetailSheet } from './RequestDetailSheet';

interface RequestDetailContextValue {
  /** Open the detail sheet for any raw request (must carry a `category`). */
  openRequest: (request: any) => void;
  closeRequest: () => void;
}

const RequestDetailContext = createContext<RequestDetailContextValue | null>(null);

export function RequestDetailProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<any | null>(null);
  // Remember which element opened the sheet so we can return focus to it on close.
  const triggerRef = useRef<HTMLElement | null>(null);

  const openRequest = useCallback((next: any) => {
    triggerRef.current = (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null) ?? null;
    setRequest(next);
  }, []);

  const closeRequest = useCallback(() => {
    setRequest(null);
    // Return focus to the element that opened the sheet (best-effort, after unmount).
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (trigger && typeof trigger.focus === 'function') {
      requestAnimationFrame(() => trigger.focus());
    }
  }, []);

  const value = useMemo(() => ({ openRequest, closeRequest }), [openRequest, closeRequest]);

  return (
    <RequestDetailContext.Provider value={value}>
      {children}
      <RequestDetailSheet request={request} onClose={closeRequest} />
    </RequestDetailContext.Provider>
  );
}

export function useRequestDetail(): RequestDetailContextValue {
  const ctx = useContext(RequestDetailContext);
  if (!ctx) {
    // Graceful degradation: when rendered outside a provider (e.g. isolated
    // unit tests) opening a detail is a no-op rather than a hard crash. In the
    // real app the provider is always mounted at the App root.
    return { openRequest: () => {}, closeRequest: () => {} };
  }
  return ctx;
}
